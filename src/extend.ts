/**
 * Adapter for apps running inside a Contactzilla Extend stack.
 *
 * Inside a stack, apps call the stack's proxy (CZ_API_BASE) rather than
 * Contactzilla directly. The proxy adds the stack's own credentials, so the
 * app never holds a token, and records which user acted from the viewer
 * header. When the stack isn't connected to Contactzilla it answers
 * 503 `cz_not_connected`, which this adapter turns into ExtendNotConnectedError.
 *
 * ```ts
 * import { createExtendClient } from "@atomica-software/contactzilla/extend";
 *
 * const cz = createExtendClient({ viewer }); // viewer: { id } from the X-CZ-* request headers
 * const { data: books } = await cz.listAddressBooks({ team: viewer.team });
 * ```
 */
import { ContactzillaClient } from "./client.js";
import { ContactzillaError } from "./errors.js";
import type { ClientAdapter, ClientOptions } from "./types.js";

/** The stack isn't connected to Contactzilla: an admin must connect it from the Builder console. */
export class ExtendNotConnectedError extends ContactzillaError {
  override name = "ExtendNotConnectedError";
}

export interface ExtendAdapterOptions {
  /** The proxy's URL. Default: process.env.CZ_API_BASE. */
  baseUrl?: string;
  /** The user the app is acting for; their id is sent so Contactzilla records who did what. */
  viewer?: { id: string | number } | null;
}

/** The Extend adapter, for `new ContactzillaClient({ adapter: extendAdapter() })`. */
export function extendAdapter(options: ExtendAdapterOptions = {}): ClientAdapter {
  const baseUrl = options.baseUrl ?? readEnv("CZ_API_BASE");
  if (!baseUrl) {
    throw new Error("CZ_API_BASE is not set. Inside an Extend stack it is set for the app; elsewhere, use ContactzillaClient with a token.");
  }
  const viewerId = options.viewer?.id;

  return {
    name: "extend",
    defaults: { baseUrl },
    beforeRequest(request) {
      // The proxy authenticates; a token here would only be ignored or leaked.
      delete request.headers.Authorization;
      if (viewerId !== undefined && viewerId !== null && viewerId !== "") {
        request.headers["X-CZ-User-Id"] = String(viewerId);
      }
    },
    mapError(error) {
      if (error.status === 503 && error.code === "cz_not_connected") {
        return new ExtendNotConnectedError({
          status: error.status,
          code: error.code,
          message: "Contactzilla isn't connected to this app. An admin needs to connect it from the Builder console.",
          body: error.body,
          errors: error.errors,
          method: error.method,
          url: error.url,
        });
      }
      return error;
    },
  };
}

/**
 * The Contactzilla host the stack belongs to (CZ_API_HOST, e.g.
 * https://contactzilla.app or https://contactzilla.us), for building links to
 * Contactzilla pages. API calls go through the proxy, not this host.
 */
export function contactzillaHost(): string | undefined {
  return readEnv("CZ_API_HOST")?.replace(/\/+$/, "");
}

/** A client for an Extend app. Cheap to create: make one per request with that request's viewer. */
export function createExtendClient(options: ExtendAdapterOptions & Omit<ClientOptions, "baseUrl" | "host" | "token" | "adapter"> = {}): ContactzillaClient {
  const { baseUrl, viewer, ...rest } = options;
  return new ContactzillaClient({ ...rest, adapter: extendAdapter({ baseUrl, viewer }) });
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}
