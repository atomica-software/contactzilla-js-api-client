#!/usr/bin/env node
/**
 * Generates src/generated/api.ts from openapi/contactzilla.openapi.json:
 * TypeScript types for every schema, argument and response types for every
 * operation, a routing table, and one documented method per operation.
 *
 *   node scripts/generate.mjs          write the file
 *   node scripts/generate.mjs --check  fail if the file is out of date (CI)
 *
 * No dependencies: the spec is plain JSON and the output plain TypeScript.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const specPath = join(root, "openapi/contactzilla.openapi.json");
const outPath = join(root, "src/generated/api.ts");

const specText = readFileSync(specPath, "utf8");
const spec = JSON.parse(specText);
const specHash = createHash("sha256").update(specText).digest("hex").slice(0, 16);

const API_PREFIX = "/api/v1";
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

// ---------------------------------------------------------------- helpers

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const isIdentifier = (s) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(s);
const key = (s) => (isIdentifier(s) ? s : JSON.stringify(s));

/** A JSDoc block (or nothing) for a description. */
function doc(text, indent = "") {
  if (!text) return "";
  const lines = String(text).replace(/\*\//g, "*\\/").split("\n");
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} *${l ? ` ${l}` : ""}`).join("\n")}\n${indent} */\n`;
}

/** A JSON Schema (OpenAPI 3.1 dialect) as a TypeScript type expression. */
function tsType(schema, indent = 0) {
  if (!schema || typeof schema !== "object") return "unknown";
  if (schema.$ref) return schema.$ref.split("/").pop();
  if (schema.oneOf) return schema.oneOf.map((s) => tsType(s, indent)).join(" | ");
  if (schema.anyOf) return schema.anyOf.map((s) => tsType(s, indent)).join(" | ");
  if (schema.allOf) return schema.allOf.map((s) => tsType(s, indent)).join(" & ");
  if (schema.enum) return schema.enum.map((v) => JSON.stringify(v)).join(" | ");
  if (schema.const !== undefined) return JSON.stringify(schema.const);

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length === 0) return "unknown";
  return types
    .map((t) => {
      switch (t) {
        case "string":
          return "string";
        case "integer":
        case "number":
          return "number";
        case "boolean":
          return "boolean";
        case "null":
          return "null";
        case "array": {
          const inner = tsType(schema.items ?? {}, indent);
          return /^[A-Za-z0-9_]+$/.test(inner) ? `${inner}[]` : `Array<${inner}>`;
        }
        case "object":
          return objectType(schema, indent);
        default:
          return "unknown";
      }
    })
    .join(" | ");
}

function objectType(schema, indent) {
  const props = schema.properties ?? {};
  const names = Object.keys(props);
  if (names.length === 0) {
    const extra = schema.additionalProperties;
    return extra && typeof extra === "object" ? `Record<string, ${tsType(extra, indent)}>` : "Record<string, unknown>";
  }
  const required = new Set(schema.required ?? []);
  const pad = "  ".repeat(indent + 1);
  const body = names
    .map((n) => {
      const p = props[n];
      return `${doc(p.description, pad)}${pad}${key(n)}${required.has(n) ? "" : "?"}: ${tsType(p, indent + 1)};`;
    })
    .join("\n");
  return `{\n${body}\n${"  ".repeat(indent)}}`;
}

// ---------------------------------------------------------------- collect

const operations = [];
for (const [fullPath, item] of Object.entries(spec.paths)) {
  for (const method of HTTP_METHODS) {
    const op = item[method];
    if (!op) continue;
    if (!op.operationId) throw new Error(`${method.toUpperCase()} ${fullPath} has no operationId`);
    const path = fullPath.startsWith(API_PREFIX) ? fullPath.slice(API_PREFIX.length) : fullPath;
    const params = op.parameters ?? [];
    const success = Object.entries(op.responses ?? {}).find(([status]) => Number(status) >= 200 && Number(status) < 300);
    const bodySchema = op.requestBody?.content?.["application/json"]?.schema;
    operations.push({
      id: op.operationId,
      method: method.toUpperCase(),
      path,
      summary: op.summary,
      description: op.description,
      tag: op.tags?.[0],
      scopes: op["x-scopes"] ?? [],
      pathParams: params.filter((p) => p.in === "path"),
      queryParams: params.filter((p) => p.in === "query").map((p) => ({ ...p, tsName: p.name.replace(/\[\]$/, "") })),
      body: bodySchema ? { schema: bodySchema, required: !!op.requestBody.required } : null,
      status: success ? Number(success[0]) : 200,
      responseSchema: success?.[1]?.content?.["application/json"]?.schema ?? null,
    });
  }
}
operations.sort((a, b) => a.id.localeCompare(b.id));

const ids = operations.map((o) => o.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length) throw new Error(`Duplicate operationIds: ${dupes.join(", ")}`);

// ---------------------------------------------------------------- emit

let out = "";
out += `/* eslint-disable */\n`;
out += `// Generated by scripts/generate.mjs from openapi/contactzilla.openapi.json. Do not edit.\n`;
out += `// ${spec.info.title} ${spec.info.version}, spec sha256 ${specHash}\n\n`;
out += `import type { RequestOptions } from "../types.js";\n\n`;
out += `/** The version of the OpenAPI document this client was generated from. */\n`;
out += `export const SPEC_VERSION = ${JSON.stringify(spec.info.version)};\n`;
out += `export const SPEC_HASH = ${JSON.stringify(specHash)};\n\n`;

out += `// ---------------------------------------------------------------- schemas\n\n`;
for (const [name, schema] of Object.entries(spec.components?.schemas ?? {})) {
  out += doc(schema.description);
  if (schema.type === "object" && schema.properties) {
    out += `export interface ${name} ${objectType(schema, 0)}\n\n`;
  } else {
    out += `export type ${name} = ${tsType(schema, 0)};\n\n`;
  }
}

out += `// ---------------------------------------------------------------- operations\n\n`;
for (const o of operations) {
  const P = pascal(o.id);
  const fields = [];
  for (const p of o.pathParams) {
    fields.push(`${doc(p.description || `Path parameter ${p.name}.`, "  ")}  ${key(p.name)}: string${p.schema?.type === "integer" ? " | number" : ""};`);
  }
  for (const p of o.queryParams) {
    fields.push(`${doc(p.description, "  ")}  ${key(p.tsName)}${p.required ? "" : "?"}: ${tsType(p.schema)};`);
  }
  if (o.body) {
    fields.push(`  /** The JSON request body. */\n  body${o.body.required ? "" : "?"}: ${P}Body;`);
    out += `export type ${P}Body = ${tsType(o.body.schema, 0)};\n\n`;
  }
  o.hasArgs = fields.length > 0;
  o.argsRequired = o.pathParams.length > 0 || o.queryParams.some((p) => p.required) || !!o.body?.required;
  if (o.hasArgs) out += `export interface ${P}Args {\n${fields.join("\n")}\n}\n\n`;
  out += `export type ${P}Response = ${o.responseSchema ? tsType(o.responseSchema, 0) : "unknown"};\n\n`;
}

out += `/** How each operation maps onto HTTP. Paths are relative to the API root (…/api/v1). */\n`;
out += `export const operations = {\n`;
for (const o of operations) {
  const query = Object.fromEntries(o.queryParams.map((p) => [p.tsName, p.name]));
  out += `  ${o.id}: {\n`;
  out += `    method: ${JSON.stringify(o.method)},\n`;
  out += `    path: ${JSON.stringify(o.path)},\n`;
  out += `    pathParams: ${JSON.stringify(o.pathParams.map((p) => p.name))},\n`;
  out += `    query: ${JSON.stringify(query)},\n`;
  out += `    body: ${o.body ? "true" : "false"},\n`;
  out += `    status: ${o.status},\n`;
  out += `    scopes: ${JSON.stringify(o.scopes)},\n`;
  out += `  },\n`;
}
out += `} as const;\n\n`;
out += `export type OperationId = keyof typeof operations;\n\n`;

out += `/** One method per API operation; ContactzillaClient implements the transport. */\n`;
out += `export abstract class ContactzillaOperations {\n`;
out += `  protected abstract call<T>(operation: OperationId, args: Record<string, unknown> | undefined, options: RequestOptions | undefined): Promise<T>;\n\n`;
for (const o of operations) {
  const P = pascal(o.id);
  const lines = [o.summary, o.description && o.description !== o.summary ? `\n${o.description}` : "", `\n\`${o.method} ${o.path}\``];
  if (o.scopes.length) lines.push(`Scope: ${o.scopes.map((s) => `\`${s}\``).join(", ")}.`);
  out += doc(lines.filter(Boolean).join("\n").replace(/\n{3,}/g, "\n\n"), "  ");
  if (o.hasArgs) {
    out += `  ${o.id}(args${o.argsRequired ? "" : "?"}: ${P}Args, options?: RequestOptions): Promise<${P}Response> {\n`;
    out += `    return this.call<${P}Response>(${JSON.stringify(o.id)}, args as unknown as Record<string, unknown>, options);\n  }\n\n`;
  } else {
    out += `  ${o.id}(options?: RequestOptions): Promise<${P}Response> {\n`;
    out += `    return this.call<${P}Response>(${JSON.stringify(o.id)}, undefined, options);\n  }\n\n`;
  }
}
out += `}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(outPath) ? readFileSync(outPath, "utf8") : "";
  if (current !== out) {
    console.error("src/generated/api.ts is out of date with the OpenAPI document. Run `npm run generate` and commit the result.");
    process.exit(1);
  }
  console.log(`Generated code is up to date (${operations.length} operations, spec ${specHash}).`);
} else {
  writeFileSync(outPath, out);
  console.log(`Wrote src/generated/api.ts: ${operations.length} operations, ${Object.keys(spec.components?.schemas ?? {}).length} schemas (spec ${specHash}).`);
}
