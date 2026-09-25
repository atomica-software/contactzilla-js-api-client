import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTACTZILLA_HOSTS, ContactzillaClient, resolveBaseUrl } from "../src/index.js";
import { contactzillaHost, createExtendClient } from "../src/extend.js";
import { json, mockFetch } from "./helpers.js";

describe("which Contactzilla host is used", () => {
  const saved = { host: process.env.CZ_API_HOST, base: process.env.CZ_API_BASE };
  beforeEach(() => {
    delete process.env.CZ_API_HOST;
    delete process.env.CZ_API_BASE;
  });
  afterEach(() => {
    for (const [k, v] of Object.entries({ CZ_API_HOST: saved.host, CZ_API_BASE: saved.base })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("defaults to contactzilla.app", () => {
    expect(resolveBaseUrl()).toBe("https://contactzilla.app/api/v1");
    expect(new ContactzillaClient({ fetch: mockFetch(json(200, {})).fetch }).baseUrl).toBe("https://contactzilla.app/api/v1");
  });

  it("uses CZ_API_HOST when set, e.g. the US infrastructure", () => {
    process.env.CZ_API_HOST = "https://contactzilla.us/";
    expect(resolveBaseUrl()).toBe("https://contactzilla.us/api/v1");
  });

  it("an explicit host beats the environment, and baseUrl beats both", () => {
    process.env.CZ_API_HOST = "https://contactzilla.app";
    expect(resolveBaseUrl({ host: CONTACTZILLA_HOSTS.us })).toBe("https://contactzilla.us/api/v1");
    expect(resolveBaseUrl({ host: CONTACTZILLA_HOSTS.us, baseUrl: "http://localhost:8000/api/v1/" })).toBe("http://localhost:8000/api/v1");
  });

  it("doesn't double /api/v1 when a host already includes it", () => {
    expect(resolveBaseUrl({ host: "https://contactzilla.us/api/v1" })).toBe("https://contactzilla.us/api/v1");
  });

  it("sends requests to that host", async () => {
    const { fetch, calls } = mockFetch(json(200, {}));
    await new ContactzillaClient({ host: CONTACTZILLA_HOSTS.us, token: "t", fetch }).getCurrentUser();
    expect(calls[0]!.url).toBe("https://contactzilla.us/api/v1/user");
  });

  it("inside an Extend stack, calls go through the proxy and the host is only for links", async () => {
    process.env.CZ_API_HOST = "https://contactzilla.us";
    process.env.CZ_API_BASE = "http://control:8080/cz";
    const { fetch, calls } = mockFetch(json(200, {}));

    await createExtendClient({ fetch }).getCurrentUser();

    expect(calls[0]!.url).toBe("http://control:8080/cz/user");
    expect(contactzillaHost()).toBe("https://contactzilla.us");
  });
});
