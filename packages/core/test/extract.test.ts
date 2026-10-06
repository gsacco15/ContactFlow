import { describe, expect, it } from "vitest";
import { buildExtract, classifyExtract } from "../src/index.ts";
import { expected, fixture, mockCtx, toolResponse } from "./helpers.ts";

const FIXTURES = ["linkedin_results", "team_page", "mixed_notes", "companies_only", "urls", "dead_domain", "thirty_contacts"];

describe("fixtures", () => {
  it.each(FIXTURES)("%s loads with an expected file", (name) => {
    expect(fixture(name).trim().length).toBeGreaterThan(10);
    expect(expected(name)).toHaveProperty("people");
  });
});

describe("buildExtract", () => {
  it("dedupes on first+last+company and links people to companies", () => {
    const ex = buildExtract({
      mode: "people",
      companies: [{ name: "Stripe", website: "https://stripe.com" }],
      people: [
        { first: "Priya", last: "Raman (She/Her)", title: "VP of Sales • 2nd", company: "Stripe" },
        { first: "Priya", last: "Raman", title: "VP Sales", company: "Stripe, Inc." },
        { first: "Priya", last: "Raman", company: "Notion" },
        { first: "", last: "Nobody" },
      ],
      urls: ["https://stripe.com/about", "javascript:alert(1)"],
      notes: "",
    });
    expect(ex.people.map((p) => [p.first, p.last, p.company_id, p.title])).toEqual([
      ["Priya", "Raman", "stripe", "VP of Sales"],
      ["Priya", "Raman", "notion", undefined],
    ]);
    expect(ex.companies.map((c) => c.id)).toEqual(["stripe", "notion"]);
    expect(ex.companies[0].website).toBe("https://stripe.com");
    expect(ex.urls).toEqual(["https://stripe.com/about"]);
  });

  it("keeps a person's own profile link (never LinkedIn), and a profile link is not a company to look up", () => {
    const url = "https://www.nela-illinois.org/content.aspx?page_id=80&club_id=853437&member_id=9918828";
    const ex = buildExtract({
      mode: "people",
      companies: [],
      people: [
        { first: "Nicholas", last: "Bringardner", profile_url: url },
        { first: "Jamison", last: "Barker+A7:D23", profile_url: "https://www.linkedin.com/in/jbarker" },
      ],
      urls: [url, "https://acme.com/team"],
      notes: "",
    });
    expect(ex.people[0]).toMatchObject({ first: "Nicholas", last: "Bringardner", company_id: "", profile_url: url });
    expect(ex.people[1]).toMatchObject({ last: "Barker" });
    expect(ex.people[1].profile_url).toBeUndefined();
    expect(ex.urls).toEqual(["https://acme.com/team"]);
  });

  it("falls back to a sensible mode", () => {
    expect(buildExtract({ mode: "weird", people: [{ first: "A", last: "B" }] }).mode).toBe("people");
    expect(buildExtract({ companies: [{ name: "A" }] }).mode).toBe("companies");
  });
});

describe("classifyExtract", () => {
  it("fails cleanly when the model does not call the tool", async () => {
    const { ctx } = mockCtx({ classify_extract: { ...toolResponse("other", {}), toolCalls: [] } });
    const r = await classifyExtract("x", ctx);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/extract_contacts/);
  });

  it("reports tokens used", async () => {
    const { ctx } = mockCtx({ classify_extract: toolResponse("extract_contacts", { mode: "people", companies: [], people: [], urls: [], notes: "" }) });
    const usage: number[] = [];
    ctx.onUsage = (u) => usage.push(u.input_tokens);
    const r = await classifyExtract("x", ctx);
    expect(r.tokens_used).toBe(120);
    expect(usage).toEqual([100]);
  });
});
