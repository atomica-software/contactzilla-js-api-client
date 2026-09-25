import { afterEach, describe, expect, it } from "vitest";
import { ContactzillaClient, ContactzillaError } from "../src/index.js";
import { createExtendClient, extendAdapter, ExtendNotConnectedError } from "../src/extend.js";
import { json, mockFetch } from "./helpers.js";

describe("Extend adapter", () => {
  const original = process.env.CZ_API_BASE;
  afterEach(() => {
    if (original === undefined) delete process.env.CZ_API_BASE;
    else process.env.CZ_API_BASE = original;
  });

  it("calls the stack's proxy with the viewer and never a token", async () => {
    process.env.CZ_API_BASE = "http://control:8080/cz";
    const { fetch, calls } = mockFetch(json(200, { data: [] }));

    await createExtendClient({ viewer: { id: 42 }, fetch }).listAddressBooks({ team: "acme" });

    expect(calls[0]!.url).toBe("http://control:8080/cz/teams/acme/address-books");
    expect(calls[0]!.headers["X-CZ-User-Id"]).toBe("42");
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("drops a token even if one is given", async () => {
    const { fetch, calls } = mockFetch(json(200, {}));
    const cz = new ContactzillaClient({ token: "leak-me", fetch, adapter: extendAdapter({ baseUrl: "http://proxy/cz" }) });

    await cz.getCurrentUser();

    expect(calls[0]!.url).toBe("http://proxy/cz/user");
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("explains a stack that isn't connected", async () => {
    const { fetch } = mockFetch(json(503, { error: "cz_not_connected", message: "not connected" }));
    const e = await createExtendClient({ baseUrl: "http://proxy/cz", fetch }).getCurrentUser().catch((x: unknown) => x);

    expect(e).toBeInstanceOf(ExtendNotConnectedError);
    expect(e).toBeInstanceOf(ContactzillaError);
    expect((e as Error).message).toContain("Builder console");
  });

  it("needs CZ_API_BASE outside an explicit baseUrl", () => {
    delete process.env.CZ_API_BASE;
    expect(() => createExtendClient()).toThrow("CZ_API_BASE is not set");
  });

  it("an explicit baseUrl on the client wins over the adapter's", async () => {
    const { fetch, calls } = mockFetch(json(200, {}));
    await new ContactzillaClient({ baseUrl: "http://other/api/v1", fetch, adapter: extendAdapter({ baseUrl: "http://proxy/cz" }) }).getCurrentUser();
    expect(calls[0]!.url).toBe("http://other/api/v1/user");
  });
});
