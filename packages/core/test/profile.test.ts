import { describe, expect, it } from "vitest";
import { buildExtract, domainFitsCompany, profileEmail, runPipeline, type Contact, type ProfileRead } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

const person = (first: string, last: string, middle?: string): Contact => ({ id: "x", first, last, middle, company_id: "", raw_source: "", candidates: [], status: "pending" });
const page = (url: string, emails: [string, string][] = []): ProfileRead => ({ url, ok: true, emails: emails.map(([email, context]) => ({ email, context })) });
const NELA = "National Employment Lawyers Association Illinois Affiliate";
const url = (id: number) => `https://www.nela-illinois.org/content.aspx?page_id=80&club_id=853437&member_id=${id}`;

describe("profileEmail", () => {
  it("takes the address that fits the person's name", () => {
    const emails = [{ email: "info@nela-illinois.org", context: "Contact us" }, { email: "nbringardner@legalaidchicago.org", context: "Nicholas Bringardner nbringardner@legalaidchicago.org | No Published Number" }];
    expect(profileEmail(person("Nicholas", "Bringardner"), emails)).toBe("nbringardner@legalaidchicago.org");
  });

  it("takes the only address with their surname close by when the address doesn't spell the name", () => {
    expect(profileEmail(person("Rachel", "Granetz", "F"), [{ email: "rfg.law@gmail.com", context: "Rachel F Granetz rfg.law@gmail.com" }])).toBe("rfg.law@gmail.com");
  });

  it("takes nothing when it can't tell: two fitting addresses, someone else's, or a shared inbox", () => {
    expect(profileEmail(person("Jane", "Doe"), [{ email: "jdoe@a.com", context: "" }, { email: "jane.doe@b.com", context: "" }])).toBeUndefined();
    expect(profileEmail(person("Jane", "Doe"), [{ email: "bsmith@a.com", context: "Board: Bob Smith" }])).toBeUndefined();
    expect(profileEmail(person("Jane", "Doe"), [{ email: "membership@nela.org", context: "Jane Doe — questions? membership@nela.org" }])).toBeUndefined();
    expect(profileEmail(person("", ""), [{ email: "jdoe@a.com", context: "" }])).toBeUndefined();
  });
});

describe("domainFitsCompany", () => {
  it("matches the company's own domain or its name, not an unrelated employer", () => {
    expect(domainFitsCompany({ id: "k", name: "Kirkland & Ellis", patterns: [] }, "kirkland.com")).toBe(true);
    expect(domainFitsCompany({ id: "a", name: "Acme", website: "https://acme.io", patterns: [] }, "acme.io")).toBe(true);
    expect(domainFitsCompany({ id: "n", name: NELA, patterns: [] }, "nela-illinois.org")).toBe(true);
    expect(domainFitsCompany({ id: "n", name: NELA, patterns: [] }, "legalaidchicago.org")).toBe(false);
    expect(domainFitsCompany({ id: "s", name: "Smith Law Group", patterns: [] }, "lawgroup.com")).toBe(false);
    expect(domainFitsCompany({ id: "w", name: "Wilson Sonsini Goodrich & Rosati", patterns: [] }, "wsgr.com")).toBe(true);
    expect(domainFitsCompany({ id: "l", name: "Legal Aid Chicago", patterns: [] }, "legalaidchicago.org")).toBe(true);
    // A word shared in the middle of a long name is not a match (caught in the NELA browser test).
    expect(domainFitsCompany({ id: "n", name: NELA, patterns: [] }, "example-employment.com")).toBe(false);
    expect(domainFitsCompany({ id: "n", name: NELA, patterns: [] }, "employmentlawgroup.com")).toBe(false);
    // The profile page is on the person's own firm's site.
    expect(domainFitsCompany({ id: "x", name: "Barnes Partners", patterns: [] }, "bp-law.com", "https://www.bp-law.com/people/jane")).toBe(true);
  });
});

describe("runPipeline with profile links", () => {
  it("a member directory: reads each profile, files people under their real employer, never searches the directory", async () => {
    const ex = buildExtract({
      mode: "people",
      companies: [{ name: NELA }],
      people: [
        { first: "Nicholas", last: "Bringardner", company: NELA, profile_url: url(1) },
        { first: "Jordan", last: "Donie", company: NELA, profile_url: url(2) },
        { first: "Rachel", last: "Granetz", company: NELA, profile_url: url(3) },
        { first: "Kasey", last: "Shi", company: NELA, profile_url: url(4) },
        { first: "Miles", last: "Shultz", company: NELA, profile_url: url(5) },
      ],
    });
    const asked: string[][] = [];
    const { ctx, calls } = mockCtx({}, {
      profiles: async (urls) => {
        asked.push(urls);
        return urls.map((u) =>
          u === url(1) ? page(u, [["nbringardner@legalaidchicago.org", "Nicholas Bringardner nbringardner@legalaidchicago.org"]])
          : u === url(2) ? page(u, [["jdonie@legalaidchicago.org", "Jordan Donie jdonie@legalaidchicago.org"]])
          : u === url(3) ? page(u, [["rgranetz@gmail.com", "Rachel Granetz"]])
          : u === url(4) ? { url: u, ok: false, note: "robots.txt disallows", emails: [] }
          : page(u, []),
        );
      },
    });
    const r = await runPipeline(ex, ctx);
    const by = (last: string) => r.contacts.find((c) => c.last === last)!;

    expect(asked.flat()).toHaveLength(5);
    expect(calls).toHaveLength(0); // no paid search: the directory isn't looked up, the employer comes from the addresses
    expect(by("Bringardner")).toMatchObject({ status: "ok", primary_email: "nbringardner@legalaidchicago.org", email_source_url: url(1) });
    const employer = r.companies.find((c) => c.id === by("Bringardner").company_id)!;
    expect(employer).toMatchObject({ name: "legalaidchicago.org", domain: "legalaidchicago.org", domain_from_profile: url(1) });
    expect(by("Donie").company_id).toBe(employer.id);
    expect(by("Granetz")).toMatchObject({ status: "ok", primary_email: "rgranetz@gmail.com", note: "Personal address from their profile page.", company_id: "" });
    expect(by("Shi")).toMatchObject({ status: "no_domain", company_id: "" });
    expect(by("Shi").error).toMatch(/robots\.txt/);
    expect(by("Shultz").error).toMatch(/No email on their profile page/);
    expect(r.companies.some((c) => c.name === NELA)).toBe(false);
  });

  it("members at a firm whose name shares a word with the directory are still filed under the firm", async () => {
    const ex = buildExtract({
      companies: [{ name: NELA }],
      people: [
        { first: "Jamison", last: "Barker", company: NELA, profile_url: url(1) },
        { first: "Alex", last: "Campbell", company: NELA, profile_url: url(2) },
        { first: "Stacy", last: "Coleman", company: NELA, profile_url: url(3) },
      ],
    });
    const mail: Record<string, string> = { [url(1)]: "jbarker@example-employment.com", [url(2)]: "acampbell@example-employment.com" };
    const { ctx, calls } = mockCtx({}, { profiles: async (urls) => urls.map((u) => page(u, mail[u] ? [[mail[u], "member"]] : [])) });
    const r = await runPipeline(ex, ctx);
    expect(calls).toHaveLength(0);
    expect(r.contacts.find((c) => c.last === "Barker")!.company_id).toBe("example-employment-com");
    expect(r.contacts.find((c) => c.last === "Coleman")).toMatchObject({ company_id: "", status: "no_domain", candidates: [] }); // no guess at someone else's firm
  });

  it("a team page with bio links on the firm's own site: the company stays and is looked up as usual", async () => {
    const ex = buildExtract({
      mode: "people",
      companies: [{ name: "Acme", website: "https://acme.com" }],
      people: [
        { first: "Jane", last: "Doe", company: "Acme", profile_url: "https://acme.com/team/jane-doe" },
        { first: "Bo", last: "Li", company: "Acme", profile_url: "https://acme.com/team/bo-li" },
      ],
    });
    const { ctx } = mockCtx({}, { profiles: async (urls) => urls.map((u) => page(u, u.endsWith("jane-doe") ? [["jane.doe@acme.com", "Jane Doe"]] : [])) });
    const r = await runPipeline(ex, ctx);
    expect(r.contacts.map((c) => c.company_id)).toEqual(["acme", "acme"]);
    expect(r.companies.find((c) => c.id === "acme")!.patterns[0]).toMatchObject({ template: "{first}.{last}", from_paste: true });
    expect(r.contacts.find((c) => c.last === "Li")!.primary_email).toBe("bo.li@acme.com"); // format learned from Jane's page
  });

  it("one person elsewhere is not enough to drop the pasted company", async () => {
    const ex = buildExtract({
      mode: "people",
      companies: [{ name: "Acme", website: "https://acme.com" }],
      people: [
        { first: "Jane", last: "Doe", company: "Acme", profile_url: "https://dir.org/p/1" },
        { first: "Bo", last: "Li", company: "Acme" },
      ],
    });
    const { ctx } = mockCtx(
      { discover_pattern: toolResponse("report_patterns", { patterns: [{ template: "{f}{last}", confidence: 0.8, source_url: "https://rocketreach.co/acme" }] }) },
      { profiles: async (urls) => urls.map((u) => page(u, [["jdoe@othercorp.com", "Jane Doe"]])) },
    );
    const r = await runPipeline(ex, ctx);
    expect(r.contacts.find((c) => c.last === "Li")).toMatchObject({ company_id: "acme", primary_email: "bli@acme.com" });
    expect(r.contacts.find((c) => c.last === "Doe")!.primary_email).toBe("jdoe@othercorp.com");
  });

  it("pastes without profile links never read pages, and the step is off without a reader", async () => {
    let called = 0;
    const { ctx } = mockCtx(
      { discover_pattern: toolResponse("report_patterns", { patterns: [{ template: "{f}{last}", confidence: 0.8, source_url: "https://rocketreach.co/acme" }] }) },
      { profiles: async () => (called++, []) },
    );
    await runPipeline(buildExtract({ companies: [{ name: "Acme", website: "https://acme.com" }], people: [{ first: "Bo", last: "Li", company: "Acme" }] }), ctx);
    expect(called).toBe(0);
    const { ctx: off } = mockCtx({});
    const r = await runPipeline(buildExtract({ people: [{ first: "Kasey", last: "Shi", profile_url: url(4) }] }), off);
    expect(r.contacts[0]).toMatchObject({ status: "no_domain", error: "no company found for this person" });
  });

  it("a reader outage marks the rows instead of failing the run", async () => {
    const { ctx } = mockCtx({}, { profiles: async () => { throw new Error("502"); } });
    const r = await runPipeline(buildExtract({ people: [{ first: "Kasey", last: "Shi", profile_url: url(4) }] }), ctx);
    expect(r.contacts[0].error).toMatch(/Couldn't read their profile page \(the page reader is unavailable right now\)/);
  });
});
