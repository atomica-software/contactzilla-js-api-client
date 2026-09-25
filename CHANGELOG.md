# Changelog

## 0.1.0

First release.

- `ContactzillaClient` with a typed method for every public API operation (43), generated from Contactzilla's OpenAPI 3.1 description.
- Types for every response and request body.
- Token as a string or an async function (for refresh); timeouts; cancellation; automatic retry of rate-limited requests (Retry-After).
- Typed errors: `ContactzillaAuthError`, `ContactzillaForbiddenError`, `ContactzillaNotFoundError`, `ContactzillaValidationError`, `ContactzillaRateLimitError`.
- `paginateContacts` to iterate every contact of a search.
- Adapters, and `@atomica-software/contactzilla/extend` for apps inside a Contactzilla Extend stack.
- Zero runtime dependencies. Node 18+, browsers, Deno, Bun.
