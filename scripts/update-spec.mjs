#!/usr/bin/env node
/**
 * Refresh openapi/contactzilla.openapi.json from a Contactzilla instance, then
 * regenerate the client:  npm run update-spec -- [url]
 * Default: https://contactzilla.com/api/v1/openapi.json. The vendored copy
 * always names production as its server, whichever instance it came from.
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ?? "https://contactzilla.com/api/v1/openapi.json";
const PRODUCTION = "https://contactzilla.com";

const response = await fetch(source, { headers: { Accept: "application/json" } });
if (!response.ok) {
  console.error(`${source} answered ${response.status}`);
  process.exit(1);
}
const spec = await response.json();
if (typeof spec.openapi !== "string" || !spec.openapi.startsWith("3.")) {
  console.error(`${source} isn't an OpenAPI 3 document`);
  process.exit(1);
}

const origin = new URL(source).origin;
let text = JSON.stringify({ ...spec, servers: [{ url: PRODUCTION }] }, null, 2);
if (origin !== PRODUCTION) text = text.split(origin).join(PRODUCTION);
writeFileSync(join(root, "openapi/contactzilla.openapi.json"), text + "\n");
console.log(`Updated the spec from ${source} (${Object.keys(spec.paths).length} paths).`);

execFileSync(process.execPath, [join(root, "scripts/generate.mjs")], { stdio: "inherit" });
