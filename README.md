# @atomica-software/contactzilla

A typed JavaScript/TypeScript client for the [Contactzilla](https://contactzilla.com) API.

- **Every endpoint is a typed method.** `listContacts`, `getContact`, `createContact` and the rest are generated from Contactzilla's [OpenAPI 3.1 description](https://contactzilla.com/api/v1/openapi.json). Arguments and responses are exactly typed, so your editor completes them and a wrong field is a compile error, not a surprise at runtime.
- **Zero dependencies.** Uses the platform's `fetch`: Node 18+, browsers, Deno, Bun, edge runtimes.
- **Production-ready basics:**
  - tokens that refresh
  - timeouts and cancellation
  - automatic retry when rate limited
  - typed errors
  - a paging iterator.
- **Adapters** for environments that reach Contactzilla another way, such as apps inside a [Contactzilla Extend](#contactzilla-extend) stack.

```ts
import { ContactzillaClient } from "@atomica-software/contactzilla";

const cz = new ContactzillaClient({ token: process.env.CONTACTZILLA_TOKEN });

const { results, count } = await cz.listContacts({
  team: "acme",
  address_book: "customers",
  labels: ["VIP"],
});
console.log(`${count} VIP contacts; the first is ${results[0]?.first_name}`);
```

## Install

```sh
npm install @atomica-software/contactzilla
```

The package is ESM with bundled type definitions.

## Authentication

Every request needs a token that can reach the team:
- **OAuth access token:** for apps that act for Contactzilla users. Use the authorization code flow with PKCE, at `/oauth/authorize` and `/oauth/token`.
- **Personal access token:** for your own scripts and integrations.

Tokens carry **scopes**, and every method's documentation lists the scope it needs (for example `contacts.read`). Teams also have to allow API access, in **Team Settings › API/MCP**.

```ts
// A fixed token
new ContactzillaClient({ token: "…" });

// Or a function, called before every request: return a fresh token after refreshing it.
new ContactzillaClient({ token: async () => (await getSession()).accessToken });
```

Keep tokens on the server. In a browser, anyone who can use the page can read them.

## Usage

Each method takes one object. It holds the path parameters (`team`, `address_book`, `contact`, …) and the query parameters. A request body goes under `body`:

```ts
// Teams and address books are addressed by slug.
const { data: teams } = await cz.listTeams();
const { data: books } = await cz.listAddressBooks({ team: teams[0].slug });

// Read one contact (contacts are addressed by uuid).
const { data: contact } = await cz.getContact({ team: "acme", address_book: "customers", contact: "01a0b2c5-…" });

// Create one. Field ids come from listContactFields(); label ids from listContactFieldLabels().
const { data: created } = await cz.createContact({
  team: "acme",
  address_book: "customers",
  body: {
    contactData: [
      { contact_field_id: 1, field_value: "Ada" },
      { contact_field_id: 2, field_value: "Lovelace" },
      { contact_field_id: 8, contact_field_label_id: 21, field_value: "ada@example.com" },
    ],
  },
});

// Labels
await cz.addContactLabel({ team: "acme", address_book: "customers", contact: created.id, body: { field_value: "VIP" } });
```

Responses are exactly what the API returns. The envelope differs between endpoints, and the types tell you which one you have:

| Method | Returns |
|---|---|
| `listContacts` | `{ count, total_address_book_count, results: Contact[], … }` |
| `getContact`, `createContact`, `updateContact` | `{ data: Contact }` |
| `listTeams` | `{ data: Team[], links, meta }` |
| `listAddressBookLabels` | `{ activeLabels, unusedLabels, archivedLabels }` |
| `listContactFieldLabels` | `ContactFieldLabel[]` |

Every schema is exported as a type (`Contact`, `ContactData`, `Team`, `AddressBook`, `AddressBookLabel`, …). So is every operation's `…Args`, `…Body` and `…Response`, e.g. `ListContactsArgs` and `ListContactsResponse`.

### Every contact of a search

`listContacts` returns 50 contacts at a time. `paginateContacts` fetches the pages for you:

```ts
import { paginateContacts } from "@atomica-software/contactzilla";

for await (const contact of paginateContacts(cz, { team: "acme", address_book: "customers", updated_since: "2026-09-01T00:00:00Z" })) {
  await sync(contact);
}
```

### Anything else

`request` calls any endpoint, for example one newer than your version of this package:

```ts
const result = await cz.request("GET", "/teams/acme/address-books/customers/contacts", { query: { labels: ["VIP"] } });
```

## Errors

A failed call throws a `ContactzillaError`, or one of its subclasses. Each carries the HTTP `status`, the API's `message`, any validation `errors` by field, the parsed `body`, and the `method` and `url`:

| Class | When |
|---|---|
| `ContactzillaAuthError` | 401: no token, or it expired or was revoked |
| `ContactzillaForbiddenError` | 403: missing scope, API access off for the team, or no access to that address book |
| `ContactzillaNotFoundError` | 404: unknown team, address book, contact, label or field |
| `ContactzillaValidationError` | 422: invalid input; see `errors` |
| `ContactzillaRateLimitError` | 429 after retrying; `retryAfter` is in seconds |
| `ContactzillaError` with `status: 0` | Network failure (`code: "network_error"`), `"timeout"` or `"aborted"` |

```ts
import { ContactzillaValidationError } from "@atomica-software/contactzilla";

try {
  await cz.createContact({ team, address_book, body });
} catch (e) {
  if (e instanceof ContactzillaValidationError) console.error(e.errors);
  else throw e;
}
```

## Options

```ts
new ContactzillaClient({
  baseUrl: "https://contactzilla.com/api/v1", // the API root, including /api/v1
  token: "…",                                  // or () => string | Promise<string>
  headers: { "X-Request-Id": "…" },            // added to every request
  timeoutMs: 30_000,                           // per request; 0 disables
  maxRetries: 2,                               // retries after a 429, honouring Retry-After (max 60 s each)
  fetch: customFetch,                          // default: global fetch
  userAgent: "my-integration/1.0",
  adapter: undefined,                          // see below
});
```

Each call also takes request options: `{ signal, headers, timeoutMs }`.

```ts
const controller = new AbortController();
await cz.listContacts({ team, address_book }, { signal: controller.signal });
```

## Adapters

An adapter fits the client to an environment that reaches Contactzilla differently, such as a proxy that adds credentials. It can supply default options, adjust each request just before it's sent, and translate errors:

```ts
import { ContactzillaClient, type ClientAdapter } from "@atomica-software/contactzilla";

const viaMyProxy: ClientAdapter = {
  name: "my-proxy",
  defaults: { baseUrl: "https://proxy.internal/contactzilla" },
  beforeRequest(req) {
    req.headers["X-Tenant"] = "acme";
  },
  mapError(error) {
    return error;
  },
};

const cz = new ContactzillaClient({ adapter: viaMyProxy });
```

### Contactzilla Extend

Apps built inside a Contactzilla Extend stack don't hold a token. They call the stack's proxy, which the stack sets in `CZ_API_BASE`. The proxy adds the stack's credentials and records which user acted. `@atomica-software/contactzilla/extend` sets this up:

```ts
import { createExtendClient, ExtendNotConnectedError } from "@atomica-software/contactzilla/extend";

// Server code only (e.g. a React Router loader). `viewer` comes from the X-CZ-* request headers.
const cz = createExtendClient({ viewer: { id: viewer.id } });

try {
  const { results } = await cz.listContacts({ team: viewer.team, address_book: "customers" });
} catch (e) {
  if (e instanceof ExtendNotConnectedError) {
    // The stack isn't connected to Contactzilla: an admin connects it from the Builder console.
  }
  throw e;
}
```

The Extend adapter:
- reads `CZ_API_BASE`, or a `baseUrl` you pass
- never sends a token
- sends the viewer as `X-CZ-User-Id`
- turns the proxy's `503 cz_not_connected` into `ExtendNotConnectedError`.

A stack can only reach its own team.

## The OpenAPI description

The document this package was generated from ships with it:

```ts
import spec from "@atomica-software/contactzilla/openapi.json" with { type: "json" };
```

The live one is at <https://contactzilla.com/api/v1/openapi.json>. `SPEC_VERSION` and `SPEC_HASH` say which version of it this package was built from.

## Development

```sh
npm install
npm run update-spec      # fetch the latest OpenAPI document and regenerate (or: npm run update-spec -- <url>)
npm run generate         # regenerate src/generated/api.ts from openapi/contactzilla.openapi.json
npm run typecheck
npm test                 # unit tests (mocked fetch)
npm run build
```

**Live tests:** these call a real Contactzilla and are read-only.

```sh
CONTACTZILLA_BASE_URL=https://contactzilla.com/api/v1 CONTACTZILLA_TOKEN=… npm run test:live
```

**How the code is made:**
- `src/generated/api.ts` is generated by `scripts/generate.mjs`, a small dependency-free generator. Don't edit it by hand; CI fails if it's out of date with the vendored spec.
- The hand-written parts are the transport (`src/client.ts`), errors, paging and adapters.

**Releasing:** bump `version` in `package.json`, update `CHANGELOG.md`, merge, then publish a GitHub release tagged `v<version>`. The *Publish to npm* workflow checks, tests, builds and publishes it with provenance.

## Licence

MIT © Atomica Software
