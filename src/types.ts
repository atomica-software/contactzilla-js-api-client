/** Something that can make HTTP requests: the global `fetch` or a compatible function. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** A token, or a function that returns one (called before every request, so it can refresh). */
export type TokenSource = string | (() => string | undefined | Promise<string | undefined>);

/** The request about to be sent, which an adapter may change. */
export interface OutgoingRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Adapts the client to an environment, such as a proxy that adds credentials:
 * defaults for the options, a hook before each request, and error translation.
 * See `@atomica-software/contactzilla/extend` for an example.
 */
export interface ClientAdapter {
  /** A name for debugging. */
  name: string;
  /** Defaults for options the caller didn't set (e.g. a proxy's baseUrl). */
  defaults?: Partial<Omit<ClientOptions, "adapter">>;
  /** Called before each request is sent; may change its headers (or URL). */
  beforeRequest?: (request: OutgoingRequest) => void | Promise<void>;
  /** Called with each API error; return a different Error to throw instead. */
  mapError?: (error: import("./errors.js").ContactzillaError) => Error;
}

export interface ClientOptions {
  /**
   * The API root, including `/api/v1`. Default `https://contactzilla.com/api/v1`.
   * Inside an Extend stack, use the stack's proxy: `process.env.CZ_API_BASE`.
   */
  baseUrl?: string;
  /**
   * An OAuth access token or personal access token, sent as `Authorization: Bearer …`.
   * Leave it out when a proxy adds credentials (as in an Extend stack).
   */
  token?: TokenSource;
  /** Headers added to every request. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. Default 30000; 0 disables it. */
  timeoutMs?: number;
  /**
   * How many times to retry a request the API rate-limited (429), waiting as long as
   * its Retry-After header says (at most 60 s each). Default 2; 0 disables retries.
   */
  maxRetries?: number;
  /** A fetch implementation. Default: the global `fetch` (Node 18+, browsers, Deno, Bun). */
  fetch?: FetchLike;
  /** A User-Agent to send (Node only; browsers ignore it). */
  userAgent?: string;
  /** Adapts the client to an environment (a proxy, a platform). */
  adapter?: ClientAdapter;
}

export interface RequestOptions {
  /** Abort the request. */
  signal?: AbortSignal;
  /** Extra headers for this request. */
  headers?: Record<string, string>;
  /** Override the client's timeout for this request. */
  timeoutMs?: number;
}
