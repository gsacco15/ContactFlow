import { describe, expect, it } from "vitest";
import { siteFormat, type Contact, type SiteRead } from "../src/index.ts";

const read = (...emails: [string, string][]): SiteRead => ({ pages: ["https://acme.com/team"], emails: emails.map(([email, context]) => ({ email, context, page: "https://acme.com/team" })) });
const person = (first: string, last: string): Contact => ({ id: `${first}-${last}`, first, last, company_id: "acme", status: "pending", candidates: [] }) as unknown as Contact;

describe("siteFormat", () => {
  it("one address with its owner's name next to it proves the format", () => {
    const v = siteFormat(read(["smorris@acme.com", "Sandy Morris Partner Email"]), "acme.com", []);
    expect(v.pattern).toMatchObject({ template: "{f}{last}", confidence: 0.85, from_site: true, source_url: "https://acme.com/team" });
  });

  it("two agreeing addresses give higher confidence; people from the paste count as names too", () => {
    const v = siteFormat(read(["smorris@acme.com", "Email"], ["jpratt@acme.com", "Contact Jon Pratt"]), "acme.com", [person("Sandy", "Morris")]);
    expect(v.pattern).toMatchObject({ template: "{f}{last}", confidence: 0.95 });
    expect(v.pattern!.evidence).toEqual(["smorris@acme.com", "jpratt@acme.com"]);
  });

  it("no name match → not counted (jsmith@ alone proves nothing)", () => {
    const v = siteFormat(read(["jsmith@acme.com", "Email our office"]), "acme.com", []);
    expect(v.pattern).toBeUndefined();
    expect(v.matches).toBe(0);
  });

  it("shared inboxes and other domains never count", () => {
    const v = siteFormat(read(["sales@acme.com", "Sales Team"], ["sandy@other.com", "Sandy Morris"]), "acme.com", [person("Sandy", "Morris")]);
    expect(v.matches).toBe(0);
  });

  it("disagreement: 1 vs 1 is not proven; 2 vs 1 is, and the other format is reported", () => {
    const tie = siteFormat(read(["smorris@acme.com", "Sandy Morris"], ["jon.pratt@acme.com", "Jon Pratt"]), "acme.com", []);
    expect(tie.pattern).toBeUndefined();
    const win = siteFormat(read(["smorris@acme.com", "Sandy Morris"], ["jpratt@acme.com", "Jon Pratt"], ["lee.wong@acme.com", "Lee Wong"]), "acme.com", []);
    expect(win.pattern?.template).toBe("{f}{last}");
    expect(win.conflict).toBe("{first}.{last}");
  });

  it("single-word formats only count for people in the paste, not page text", () => {
    expect(siteFormat(read(["chicago@acme.com", "Chicago Office Hours"]), "acme.com", []).matches).toBe(0);
    // One person on a short format is not enough (could be the founder's personal address)…
    expect(siteFormat(read(["sandy@acme.com", "Email"]), "acme.com", [person("Sandy", "Morris")]).pattern).toBeUndefined();
    // …two agreeing people are.
    expect(siteFormat(read(["sandy@acme.com", "Email"], ["jon@acme.com", "Email"]), "acme.com", [person("Sandy", "Morris"), person("Jon", "Pratt")]).pattern?.template).toBe("{first}");
    expect(siteFormat(read(["sm@acme.com", "Sandy Morris"]), "acme.com", []).pattern).toBeUndefined(); // initials alone: not proven
  });
});
