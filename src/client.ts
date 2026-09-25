import { ContactzillaError, errorFor } from "./errors.js";
import { ContactzillaOperations, operations, type OperationId } from "./generated/api.js";
import type { ClientAdapter, ClientOptions, FetchLike, OutgoingRequest, RequestOptions } from "./types.js";

export const DEFAULT_BASE_URL = "https://contactzilla.com/api/v1";

const MAX_RETRY_WAIT_S = 60;

type QueryValue = string | number | boolean | null | undefined | Array<string | number | boolean>;

/**
 * The Contactzilla API client. Every API operation is a typed method
 * (listContacts, getContact, createContact, …) generated from the API's
 * OpenAPI description; `request` reaches anything else.
 *
 * ```ts
 * const cz = new ContactzillaClient({ token: process.env.CONTACTZILLA_TOKEN });
 * const { results, count } = await cz.listContacts({ team: "acme", address_book: "customers", labels: ["VIP"] });
 * ```
 */
export class ContactzillaClient extends ContactzillaOperations {
  readonly baseUrl: string;
  private readonly options: ClientOptions;
  private readonly adapter: ClientAdapter | undefined;
  private readonly fetchImpl: FetchLike;

  constructor(options: ClientOptions = {}) {
    super();
    this.adapter = options.adapter;
    // The caller's options win over the adapter's defaults.
    options = { ...options.adapter?.defaults, ...stripUndefined(options) };
    this.options = options;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    const f = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!f) {
      throw new Error("No fetch available: use Node 18+ or pass { fetch } to ContactzillaClient.");
    }
    this.fetchImpl = options.fetch ? f : (input, init) => globalThis.fetch(input, init);
  }

  /**
   * Call any endpoint, e.g. one this version of the client doesn't know yet.
   * `path` is relative to the API root: `request("GET", "/teams")`.
   */
  async request<T = unknown>(
    method: string,
    path: string,
    init: { query?: Record<string, QueryValue>; body?: unknown } & RequestOptions = {},
  ): Promise<T> {
    const { query, body, ...options } = init;
    return this.send<T>(method.toUpperCase(), this.url(path, query), body, options);
  }

  protected async call<T>(operation: OperationId, args: Record<string, unknown> | undefined, options: RequestOptions | undefined): Promise<T> {
    const op = operations[operation];
    const a = args ?? {};

    let path: string = op.path;
    for (const name of op.pathParams) {
      const value = a[name];
      if (value === undefined || value === null || value === "") {
        throw new TypeError(`${operation}: missing path parameter "${name}"`);
      }
      path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
    }

    const query: Record<string, QueryValue> = {};
    for (const [tsName, wireName] of Object.entries(op.query as Record<string, string>)) {
      if (a[tsName] !== undefined) query[wireName.replace(/\[\]$/, "")] = a[tsName] as QueryValue;
    }

    return this.send<T>(op.method, this.url(path, query), op.body ? a.body : undefined, options ?? {});
  }

  private url(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}/${path.replace(/^\/+/, "")}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        // Laravel reads repeated `name[]` as an array.
        for (const item of value) url.searchParams.append(`${name}[]`, String(item));
      } else {
        url.searchParams.set(name, String(value));
      }
    }
    return url.toString();
  }

  private async send<T>(method: string, url: string, body: unknown, options: RequestOptions): Promise<T> {
    const maxRetries = this.options.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchOnce(method, url, body, options);
      const parsed = await readBody(response);
      if (response.ok) return parsed as T;

      const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
      if (response.status === 429 && attempt < maxRetries && !options.signal?.aborted) {
        await sleep(Math.min(retryAfter ?? 2 ** attempt, MAX_RETRY_WAIT_S) * 1000, options.signal);
        continue;
      }
      const error = errorFor(response.status, parsed, method, url, retryAfter);
      throw this.adapter?.mapError ? this.adapter.mapError(error) : error;
    }
  }

  private async fetchOnce(method: string, url: string, body: unknown, options: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...this.options.headers, ...options.headers };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.options.userAgent) headers["User-Agent"] = this.options.userAgent;
    const token = typeof this.options.token === "function" ? await this.options.token() : this.options.token;
    if (token) headers.Authorization = `Bearer ${token}`;
    const outgoing: OutgoingRequest = { method, url, headers };
    await this.adapter?.beforeRequest?.(outgoing);
    url = outgoing.url;

    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs ?? 30_000;
    const { signal, cancel } = combineSignals(options.signal, timeoutMs);
    try {
      return await this.fetchImpl(url, {
        method,
        headers: outgoing.headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      const timedOut = signal?.aborted && !options.signal?.aborted;
      throw new ContactzillaError({
        status: 0,
        code: timedOut ? "timeout" : options.signal?.aborted ? "aborted" : "network_error",
        message: timedOut ? `Contactzilla API ${method} ${url} timed out after ${timeoutMs} ms` : `Could not reach the Contactzilla API (${method} ${url}): ${String(cause)}`,
        method,
        url,
        cause,
      });
    } finally {
      cancel();
    }
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, (date - Date.now()) / 1000) : undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** The caller's signal plus a timeout, without AbortSignal.any (Node 18). */
function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal | undefined; cancel: () => void } {
  if (!timeoutMs) return { signal, cancel: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cancel: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}
