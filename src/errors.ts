/** Fields Laravel and Contactzilla put in an error body. */
interface ErrorBody {
  message?: unknown;
  error?: unknown;
  code?: unknown;
  errors?: unknown;
}

/**
 * The API answered with an error status, or couldn't be reached (status 0).
 * `body` is the parsed response; `errors` the validation problems by field when given.
 */
export class ContactzillaError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;
  readonly errors: Record<string, string[]> | undefined;
  readonly method: string;
  readonly url: string;

  constructor(init: { status: number; message: string; code?: string; body?: unknown; errors?: Record<string, string[]>; method: string; url: string; cause?: unknown }) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "ContactzillaError";
    this.status = init.status;
    this.code = init.code;
    this.body = init.body;
    this.errors = init.errors;
    this.method = init.method;
    this.url = init.url;
  }
}

/** 401: no token, or it expired or was revoked. Refresh it, or authorise again. */
export class ContactzillaAuthError extends ContactzillaError {
  override name = "ContactzillaAuthError";
}

/** 403: the token lacks the scope, API access is off for the team, or the user can't see that address book. */
export class ContactzillaForbiddenError extends ContactzillaError {
  override name = "ContactzillaForbiddenError";
}

/** 404: unknown team, address book, contact, label or field. */
export class ContactzillaNotFoundError extends ContactzillaError {
  override name = "ContactzillaNotFoundError";
}

/** 422: invalid input. `errors` lists the problems by field (or under `global`). */
export class ContactzillaValidationError extends ContactzillaError {
  override name = "ContactzillaValidationError";
}

/** 429: rate limited, even after retrying. `retryAfter` is in seconds, when the API said. */
export class ContactzillaRateLimitError extends ContactzillaError {
  override name = "ContactzillaRateLimitError";
  retryAfter: number | undefined;
}

/** Build the right error for a failed response. */
export function errorFor(status: number, body: unknown, method: string, url: string, retryAfter?: number): ContactzillaError {
  const b: ErrorBody = body && typeof body === "object" ? (body as ErrorBody) : {};
  const code = typeof b.code === "string" ? b.code : typeof b.error === "string" ? b.error : undefined;
  const errors = normaliseErrors(b.errors);
  const message =
    (typeof b.message === "string" && b.message) ||
    firstError(errors) ||
    (typeof body === "string" && body.trim() ? body.trim().slice(0, 300) : "") ||
    `Contactzilla API ${method} ${url} failed with ${status}`;
  const init = { status, message, code, body, errors, method, url };

  switch (status) {
    case 401:
      return new ContactzillaAuthError(init);
    case 403:
      return new ContactzillaForbiddenError(init);
    case 404:
      return new ContactzillaNotFoundError(init);
    case 422:
      return new ContactzillaValidationError(init);
    case 429: {
      const e = new ContactzillaRateLimitError(init);
      e.retryAfter = retryAfter;
      return e;
    }
    default:
      return new ContactzillaError(init);
  }
}

function normaliseErrors(errors: unknown): Record<string, string[]> | undefined {
  if (!errors || typeof errors !== "object" || Array.isArray(errors)) return undefined;
  const out: Record<string, string[]> = {};
  for (const [field, value] of Object.entries(errors as Record<string, unknown>)) {
    const list = Array.isArray(value) ? value : [value];
    const messages = list.filter((m): m is string => typeof m === "string");
    if (messages.length) out[field] = messages;
  }
  return Object.keys(out).length ? out : undefined;
}

function firstError(errors: Record<string, string[]> | undefined): string | undefined {
  return errors ? Object.values(errors)[0]?.[0] : undefined;
}
