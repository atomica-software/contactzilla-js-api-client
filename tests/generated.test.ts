import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("generated code", () => {
  it("is up to date with the vendored OpenAPI document", () => {
    const out = execFileSync(process.execPath, ["scripts/generate.mjs", "--check"], { encoding: "utf8" });
    expect(out).toContain("up to date");
  });
});
