#!/usr/bin/env node
/**
 * Refresh openapi/contactzilla.openapi.json from a Contactzilla instance, then
 * regenerate the client:  npm run update-spec -- [url | file]
 * Default: https://contactzilla.app/api/v1/openapi.json. A file is a document
 * exported with `php artisan api:openapi --output=<file>`, e.g. from a branch
 * that isn't deployed yet. The vendored copy always names production as its
 * server, whichever instance it came from.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = process.argv[2] ?? "https://contactzilla.app/api/v1/openapi.json";
const PRODUCTION = "https://contactzilla.app";

const isUrl = /^https?:\/\//.test(source);
let spec;
if (isUrl) {
  const response = await fetch(source, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    console.error(`${source} answered ${response.status}`);
    process.exit(1);
  }
  spec = await response.json();
} else {
  spec = JSON.parse(readFileSync(source, "utf8"));
}
if (typeof spec.openapi !== "string" || !spec.openapi.startsWith("3.")) {
  console.error(`${source} isn't an OpenAPI 3 document`);
  process.exit(1);
}

// The instance's own origin (an exported file names it as its server) becomes production's.
const origin = new URL(isUrl ? source : spec.servers?.[0]?.url ?? PRODUCTION).origin;
let text = JSON.stringify({ ...spec, servers: [{ url: PRODUCTION }] }, null, 2);
if (origin !== PRODUCTION) text = text.split(origin).join(PRODUCTION);
writeFileSync(join(root, "openapi/contactzilla.openapi.json"), text + "\n");
console.log(`Updated the spec from ${source} (${Object.keys(spec.paths).length} paths).`);

execFileSync(process.execPath, [join(root, "scripts/generate.mjs")], { stdio: "inherit" });
