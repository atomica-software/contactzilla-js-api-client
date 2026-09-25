import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ContactzillaAuthError,
  ContactzillaClient,
  ContactzillaError,
  ContactzillaForbiddenError,
  ContactzillaNotFoundError,
  ContactzillaRateLimitError,
  ContactzillaValidationError,
  DEFAULT_BASE_URL,
  operations,
  paginateContacts,
  type Contact,
  type ListContactsResponse,
} from "../src/index.js";
import { json, mockFetch } from "./helpers.js";

const contact = (id: string): Contact =>
  ({ id, first_name: "Ada", last_name: "Lovelace" }) as Contact;

describe("requests", () => {
  it("calls production by default, with the token and JSON headers", async () => {
    const { fetch, calls } = mockFetch(json(200, { id: 1 }));
    const cz = new ContactzillaClient({ token: "tok", fetch });

    await cz.getCurrentUser();

    expect(calls[0]!.url).toBe(`${DEFAULT_BASE_URL}/user`);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers).toMatchObject({ Authorization: "Bearer tok", Accept: "application/json" });
  });

  it("fills path parameters (encoded) and serialises query arrays the way Laravel reads them", async () => {
    const { fetch, calls } = mockFetch(json(200, { count: 0, results: [] }));
    const cz = new ContactzillaClient({ baseUrl: "https://cz.test/api/v1/", fetch });

    await cz.listContacts({ team: "acme co", address_book: "customers", labels: ["VIP", "Customers"], sort_by: "last_name", query: undefined });

    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/v1/teams/acme%20co/address-books/customers/contacts");
    expect(url.searchParams.getAll("labels[]")).toEqual(["VIP", "Customers"]);
    expect(url.searchParams.get("sort_by")).toBe("last_name");
    expect(url.searchParams.has("query")).toBe(false);
    expect(calls[0]!.headers.Authorization).toBeUndefined();
  });

  it("sends the body as JSON and returns the parsed, typed response", async () => {
    const { fetch, calls } = mockFetch(json(201, { data: contact("c-1") }));
    const cz = new ContactzillaClient({ token: "tok", fetch });

    const created = await cz.createContact({
      team: "acme",
      address_book: "customers",
      body: { contactData: [{ contact_field_id: 1, field_value: "Ada" }] },
    });

    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["Content-Type"]).toBe("application/json");
    expect(calls[0]!.body).toEqual({ contactData: [{ contact_field_id: 1, field_value: "Ada" }] });
    expect(created.data.id).toBe("c-1");
    expectTypeOf(created.data).toEqualTypeOf<Contact>();
  });

  it("calls a token function before every request, so it can refresh", async () => {
    const { fetch, calls } = mockFetch(json(200, {}));
    let n = 0;
    const cz = new ContactzillaClient({ token: async () => `t${++n}`, fetch });

    await cz.getCurrentUser();
    await cz.getCurrentUser();

    expect(calls.map((c) => c.headers.Authorization)).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("refuses to call without a path parameter", async () => {
    const { fetch } = mockFetch(json(200, {}));
    const cz = new ContactzillaClient({ fetch });

    await expect(cz.getContact({ team: "acme", address_book: "customers", contact: "" })).rejects.toThrow('missing path parameter "contact"');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reaches any endpoint with request()", async () => {
    const { fetch, calls } = mockFetch(json(200, { ok: true }));
    const cz = new ContactzillaClient({ fetch, headers: { "X-Trace": "1" } });

    await expect(cz.request("post", "/new-endpoint", { query: { a: 1 }, body: { b: 2 }, headers: { "X-Extra": "y" } })).resolves.toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: "POST", url: `${DEFAULT_BASE_URL}/new-endpoint?a=1`, body: { b: 2 } });
    expect(calls[0]!.headers).toMatchObject({ "X-Trace": "1", "X-Extra": "y" });
  });

  it("has a method for every operation in the spec", () => {
    const cz = new ContactzillaClient({ fetch: mockFetch(json(200, {})).fetch });
    for (const id of Object.keys(operations)) {
      expect(typeof (cz as unknown as Record<string, unknown>)[id], id).toBe("function");
    }
    expect(Object.keys(operations).length).toBeGreaterThanOrEqual(40);
  });
});

describe("errors", () => {
  const call = async (response: Response | Error) => {
    const cz = new ContactzillaClient({ fetch: mockFetch(response).fetch, maxRetries: 0 });
    return cz.getTeam({ team: "acme" }).then(
      () => undefined,
      (e: unknown) => e as ContactzillaError,
    );
  };

  it("maps statuses to error classes with the API's message", async () => {
    expect(await call(json(401, { message: "Unauthenticated." }))).toBeInstanceOf(ContactzillaAuthError);
    expect(await call(json(403, { message: "This action is unauthorized." }))).toBeInstanceOf(ContactzillaForbiddenError);
    const notFound = await call(json(404, { message: "Not found" }));
    expect(notFound).toBeInstanceOf(ContactzillaNotFoundError);
    expect(notFound).toMatchObject({ status: 404, message: "Not found", method: "GET" });
  });

  it("keeps validation errors by field, including the API's global errors", async () => {
    const e = await call(json(422, { message: "The name field is required.", errors: { name: ["The name field is required."] } }));
    expect(e).toBeInstanceOf(ContactzillaValidationError);
    expect(e!.errors).toEqual({ name: ["The name field is required."] });

    const g = await call(json(422, { data: null, errors: { global: ["No contact matches."] } }));
    expect(g!.message).toBe("No contact matches.");
    expect(g!.errors).toEqual({ global: ["No contact matches."] });
  });

  it("reports unreachable APIs and non-JSON errors clearly", async () => {
    const network = await call(new TypeError("fetch failed"));
    expect(network).toMatchObject({ status: 0, code: "network_error" });
    expect(network!.message).toContain("Could not reach the Contactzilla API");

    const html = await call(new Response("<h1>Bad gateway</h1>", { status: 502 }));
    expect(html).toMatchObject({ status: 502, message: "<h1>Bad gateway</h1>" });
  });

  it("times out", async () => {
    const slow = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("aborted"))));
    const cz = new ContactzillaClient({ fetch: slow, timeoutMs: 20 });

    await expect(cz.getCurrentUser()).rejects.toMatchObject({ status: 0, code: "timeout" });
  });

  it("retries a rate-limited request after Retry-After, then gives up with the wait time", async () => {
    const ok = mockFetch(json(429, { message: "Too many" }, { "Retry-After": "0" }), json(200, { id: 7 }));
    const cz = new ContactzillaClient({ fetch: ok.fetch });
    await expect(cz.getTeam({ team: "acme" })).resolves.toEqual({ id: 7 });
    expect(ok.calls).toHaveLength(2);

    const limited = mockFetch(json(429, { message: "Too many" }, { "Retry-After": "0" }));
    const e = await new ContactzillaClient({ fetch: limited.fetch, maxRetries: 1 }).getCurrentUser().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ContactzillaRateLimitError);
    expect((e as ContactzillaRateLimitError).retryAfter).toBe(0);
    expect(limited.calls).toHaveLength(2);
  });
});

describe("paginateContacts", () => {
  it("walks every page", async () => {
    const page = (ids: string[], count: number): ListContactsResponse =>
      ({ count, results: ids.map(contact) }) as ListContactsResponse;
    const { fetch, calls } = mockFetch(json(200, page(["a", "b"], 3)), json(200, page(["c"], 3)));
    const cz = new ContactzillaClient({ fetch });

    const ids: string[] = [];
    for await (const c of paginateContacts(cz, { team: "acme", address_book: "customers" })) ids.push(c.id);

    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls.map((c) => new URL(c.url).searchParams.get("offset"))).toEqual(["0", "2"]);
  });
});
