/**
 * Calls a real Contactzilla. Skipped unless CONTACTZILLA_TOKEN is set:
 *
 *   CONTACTZILLA_BASE_URL=https://contactzilla.app/api/v1 CONTACTZILLA_TOKEN=… npm run test:live
 *
 * Read-only: it lists and reads, and never changes anything.
 */
import { describe, expect, it } from "vitest";
import { ContactzillaClient, ContactzillaNotFoundError, paginateContacts } from "../src/index.js";

const token = process.env.CONTACTZILLA_TOKEN;
const cz = new ContactzillaClient({ baseUrl: process.env.CONTACTZILLA_BASE_URL, token });

describe.runIf(Boolean(token))("live Contactzilla API", () => {
  it("reads the user, teams, address books, contacts and fields", async () => {
    const user = await cz.getCurrentUser();
    expect(user.id).toEqual(expect.any(Number));
    expect(user).not.toHaveProperty("owned_teams");

    const teams = await cz.listTeams();
    expect(teams.data.length).toBeGreaterThan(0);
    const team = teams.data[0]!;
    expect(team).not.toHaveProperty("stripe_customer_id");

    const books = await cz.listAddressBooks({ team: team.slug });
    const fields = await cz.listContactFields();
    expect(fields.data.some((f) => f.component_key === "Email")).toBe(true);

    const book = books.data[0];
    if (!book) return;
    const page = await cz.listContacts({ team: team.slug, address_book: book.slug });
    expect(page.results).toBeInstanceOf(Array);
    expect(page.count).toEqual(expect.any(Number));

    const first = page.results[0];
    if (first) {
      const one = await cz.getContact({ team: team.slug, address_book: book.slug, contact: first.id });
      expect(one.data.id).toBe(first.id);
    }

    let n = 0;
    for await (const _ of paginateContacts(cz, { team: team.slug, address_book: book.slug })) if (++n >= 60) break;
    expect(n).toBe(Math.min(60, page.count));

    await expect(cz.getContact({ team: team.slug, address_book: book.slug, contact: "00000000-0000-0000-0000-000000000000" })).rejects.toBeInstanceOf(ContactzillaNotFoundError);
  });
});
