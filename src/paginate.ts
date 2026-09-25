import type { ContactzillaClient } from "./client.js";
import type { Contact, ListContactsArgs } from "./generated/api.js";
import type { RequestOptions } from "./types.js";

/**
 * Every contact matching a search, page by page (the API returns 50 at a time).
 *
 * ```ts
 * for await (const contact of paginateContacts(cz, { team: "acme", address_book: "customers", labels: ["VIP"] })) {
 *   console.log(contact.first_name);
 * }
 * ```
 */
export async function* paginateContacts(
  client: ContactzillaClient,
  args: Omit<ListContactsArgs, "offset">,
  options?: RequestOptions,
): AsyncGenerator<Contact, void, undefined> {
  let offset = 0;
  for (;;) {
    const page = await client.listContacts({ ...args, offset }, options);
    for (const contact of page.results) yield contact;
    offset += page.results.length;
    if (page.results.length === 0 || offset >= page.count) return;
  }
}
