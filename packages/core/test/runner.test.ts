import { describe, expect, it } from "vitest";
import { MxVerifier, buildExtract, runPipeline, rerunCompany, type Contact, type ExtractResult } from "../src/index.ts";
import { finish, fixture, mixedNotesExtract, mockCtx, toolResponse } from "./helpers.ts";

const noPatterns = toolResponse("report_patterns", { patterns: [] }, { web_search_requests: 2 });
const firstLast = (src = "https://rocketreach.co/acme") =>
  toolResponse("report_patterns", { patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: src }] }, { web_search_requests: 2 });

describe("runPipeline", () => {
  it("routes a no_pattern row to rescue and accepts a repaired row", async () => {
    const { ctx } = mockCtx(
      {
        classify_extract: toolResponse("extract_contacts", { ...mixedNotesExtract, companies: [mixedNotesExtract.companies[0]] }),
        discover_pattern: noPatterns,
        rescue_agent: finish({ patterns: [{ template: "{first}.{last}", confidence: 0.7, source_url: "https://x" }] }),
      },
      {},
    );
    const rows: Contact[] = [];
    await runPipeline(fixture("mixed_notes"), ctx, { onRow: (r) => rows.push(r) });
    expect(rows[0].status).toBe("ok");
    expect(rows[0].rescued).toBe(true);
    expect(rows[0].candidates[0].email).toBe("jane.doe@acme.com");
  });

  it("skips domain lookup when the input carried a website, and uses role hints company-first", async () => {
    const { ctx, calls } = mockCtx({
      classify_extract: toolResponse("extract_contacts", mixedNotesExtract),
      resolve_domain: toolResponse("report_domain", { domain: "betacorp.com", confidence: 0.9, source_url: "https://betacorp.com", alternatives: [] }, { web_search_requests: 1 }),
      discover_pattern: (req) => firstLast(`https://rocketreach.co/${(req.input as any).domain}`),
      find_people: toolResponse("extract_contacts", { mode: "people", companies: [], people: [{ first: "Sam", last: "Lee", title: "CFO", company: "Wrong Co" }], urls: [], notes: "" }),
    });
    const res = await runPipeline(fixture("mixed_notes"), ctx);
    expect(calls.filter((c) => c.stage === "resolve_domain")).toHaveLength(1); // only Beta Corp
    const find = calls.find((c) => c.stage === "find_people")!;
    expect(find.vars?.role_filter).toBe("CFO");
    const byEmail = res.contacts.map((c) => [c.status, c.company_id, c.primary_email]);
    expect(byEmail).toEqual(
      expect.arrayContaining([
        ["ok", "acme", "jane.doe@acme.com"],
        ["ok", "beta", "sam.lee@betacorp.com"],
      ]),
    );
    const acme = res.companies.find((c) => c.id === "acme")!;
    expect(acme.domain_source_url).toBe("https://acme.com");
    expect(acme.patterns[0].source_url).toBe("https://rocketreach.co/acme.com");
  });

  it("shares one domain lookup and one pattern search across all people at a company", async () => {
    const people = Array.from({ length: 40 }, (_, i) => ({ first: `Person${String.fromCharCode(97 + (i % 26))}`, last: `Last${i}`, company: "Stripe" }));
    const { ctx, calls } = mockCtx({
      classify_extract: toolResponse("extract_contacts", { mode: "people", companies: [{ name: "Stripe" }], people, urls: [], notes: "" }),
      resolve_domain: toolResponse("report_domain", { domain: "stripe.com", confidence: 0.95, source_url: "https://stripe.com", alternatives: [] }),
      discover_pattern: firstLast(),
    });
    const res = await runPipeline("…", ctx);
    expect(res.contacts).toHaveLength(40);
    expect(calls.map((c) => c.stage)).toEqual(["classify_extract", "resolve_domain", "discover_pattern"]);
  });

  it("serves repeat companies from cache with zero searches", async () => {
    const script = {
      resolve_domain: toolResponse("report_domain", { domain: "stripe.com", confidence: 0.95, source_url: "https://stripe.com", alternatives: [] }),
      discover_pattern: firstLast(),
    };
    const { ctx, calls } = mockCtx(script);
    const ex = buildExtract({ mode: "people", companies: [], people: [{ first: "Priya", last: "Raman", company: "Stripe" }], urls: [], notes: "" });
    await runPipeline(ex, ctx);
    const second = await runPipeline(ex, ctx);
    expect(calls).toHaveLength(2);
    expect(second.contacts[0].primary_email).toBe("priya.raman@stripe.com");
  });

  it("never asks for more than the per-company search budget", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "stripe.com", confidence: 0.9, source_url: null, alternatives: [] }, { web_search_requests: 2 }),
      discover_pattern: firstLast(),
    });
    ctx.budget.maxSearchesPerCompany = 4;
    await runPipeline(buildExtract({ people: [{ first: "Ann", last: "Bell", company: "Stripe" }] }), ctx);
    const total = calls.reduce((n, c) => n + (c.maxSearches ?? 0), 0);
    expect(total).toBeLessThanOrEqual(4);
  });

  it("rejects aggregator domains and marks no_domain when nothing is found", async () => {
    const { ctx } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "linkedin.com", confidence: 0.9, source_url: null, alternatives: ["crunchbase.com"] }),
      rescue_agent: finish({ gave_up: true, reason: "no official site" }),
    });
    const res = await runPipeline(buildExtract({ people: [{ first: "A", last: "B", company: "Apex" }] }), ctx);
    expect(res.contacts[0].status).toBe("no_domain");
    expect(res.contacts[0].candidates).toEqual([]);
    expect(res.companies[0].rescue_note).toMatch(/no official site/);
  });

  it("marks every row at a dead (no-MX) domain as no_domain", async () => {
    const ex: ExtractResult = buildExtract({
      mode: "mixed",
      companies: [{ name: "Defunct Widgets", website: "defunct-widgets.invalid" }],
      people: [
        { first: "Carla", last: "Mendes", company: "Defunct Widgets" },
        { first: "Peter", last: "Olsen", company: "Defunct Widgets" },
      ],
    });
    const { ctx } = mockCtx(
      { discover_pattern: noPatterns, rescue_agent: finish({ gave_up: true, reason: "domain is dead" }) },
      { verifier: new MxVerifier(async () => false) },
    );
    const res = await runPipeline(ex, ctx);
    expect(res.contacts.map((c) => c.status)).toEqual(["no_domain", "no_domain"]);
  });

  it("rescues once per company, not once per row", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: null, confidence: 0, source_url: null, alternatives: [] }),
      rescue_agent: finish({ gave_up: true, reason: "nope" }),
    });
    await runPipeline(buildExtract({ people: ["A", "B", "C"].map((f) => ({ first: f, last: "X", company: "Ghost" })) }), ctx);
    expect(calls.filter((c) => c.stage === "rescue_agent")).toHaveLength(1);
  });

  it("rescue agent can call stage tools, then repairs the domain", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: [
        toolResponse("report_domain", { domain: null, confidence: 0, source_url: null, alternatives: [] }),
        toolResponse("report_domain", { domain: "acme.co.uk", confidence: 0.8, source_url: "https://acme.co.uk", alternatives: [] }),
      ],
      discover_pattern: firstLast("https://signalhire.com/acme"),
      rescue_agent: [
        toolResponse("find_domain", { company_name: "Acme", hint: "UK" }),
        toolResponse("find_email_pattern", { domain: "acme.co.uk" }),
        finish({
          domain: "acme.co.uk",
          domain_source_url: "https://acme.co.uk",
          patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: "https://signalhire.com/acme" }],
        }),
      ],
    });
    const res = await runPipeline(buildExtract({ people: [{ first: "Jane", last: "Doe", company: "Acme" }] }), ctx);
    expect(res.contacts[0]).toMatchObject({ status: "ok", rescued: true, primary_email: "jane.doe@acme.co.uk" });
    const rescueTurns = calls.filter((c) => c.stage === "rescue_agent");
    expect(rescueTurns).toHaveLength(3);
    const last = rescueTurns[2].messages!.at(-1) as any;
    expect(last.role).toBe("user");
    expect(last.content[0]).toMatchObject({ type: "tool_result" });
  });

  it("stops the rescue loop at the budget", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: null, confidence: 0, source_url: null, alternatives: [] }),
      rescue_agent: () => toolResponse("find_domain", { company_name: "Ghost" }),
    });
    ctx.budget.maxRescueCalls = 3;
    const res = await runPipeline(buildExtract({ people: [{ first: "A", last: "B", company: "Ghost" }] }), ctx);
    expect(calls.filter((c) => c.stage === "rescue_agent")).toHaveLength(3);
    expect(res.companies[0].rescue_note).toMatch(/budget/);
  });

  it("rescue ignores unsourced patterns from finish", async () => {
    const { ctx } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "acme.com", confidence: 0.9, source_url: "https://acme.com", alternatives: [] }),
      discover_pattern: noPatterns,
      rescue_agent: finish({ patterns: [{ template: "{first}.{last}", confidence: 0.9 }] }),
    });
    const res = await runPipeline(buildExtract({ people: [{ first: "Ann", last: "Bell", company: "Acme" }] }), ctx);
    expect(res.contacts[0].status).toBe("no_pattern");
    expect(res.contacts[0].candidates[0]).toMatchObject({ email: "ann.bell@acme.com", basis: "guess" }); // offered, but only as a backup guess
  });

  it("surfaces stage errors as error rows and does not cache them", async () => {
    const { ctx } = mockCtx({
      resolve_domain: () => {
        throw new Error("rate_limited");
      },
    });
    ctx.options = { rescue: false };
    const res = await runPipeline(buildExtract({ people: [{ first: "A", last: "B", company: "Acme" }] }), ctx);
    expect(res.contacts[0]).toMatchObject({ status: "error", error: "resolve_domain: rate_limited" });
    expect(await ctx.cache.get("company:acme")).toBeUndefined();
  });

  it("people without a company become no_domain rows", async () => {
    const { ctx } = mockCtx({});
    ctx.options = { rescue: false };
    const res = await runPipeline(buildExtract({ people: [{ first: "Lonely", last: "Person" }] }), ctx);
    expect(res.contacts[0].status).toBe("no_domain");
  });

  it("caps contacts at budget.maxContacts", async () => {
    const { ctx } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "xco.com", confidence: 1, source_url: null, alternatives: [] }),
      discover_pattern: firstLast(),
    });
    ctx.budget.maxContacts = 5;
    const people = Array.from({ length: 12 }, (_, i) => ({ first: "P", last: `L${i}`, company: "X" }));
    expect((await runPipeline(buildExtract({ people }), ctx)).contacts).toHaveLength(5);
  });

  it("runs companies concurrently up to the limit", async () => {
    let active = 0;
    let peak = 0;
    const { ctx } = mockCtx({
      resolve_domain: async (req) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return toolResponse("report_domain", { domain: `${(req.input as any).company.toLowerCase()}.com`, confidence: 1, source_url: null, alternatives: [] });
      },
      discover_pattern: firstLast(),
    });
    const people = Array.from({ length: 12 }, (_, i) => ({ first: "P", last: "Q", company: `Co${i}` }));
    await runPipeline(buildExtract({ people }), ctx);
    expect(peak).toBe(5);
  });

  it("URL inputs become companies; LinkedIn URLs are never fetched", async () => {
    const { ctx, calls } = mockCtx({
      classify_extract: toolResponse("extract_contacts", {
        mode: "urls",
        companies: [],
        people: [],
        urls: ["https://linear.app/about", "https://www.linkedin.com/company/ramp/people/"],
        notes: "",
      }),
      discover_pattern: firstLast(),
      find_people: toolResponse("extract_contacts", { mode: "people", companies: [], people: [{ first: "Ava", last: "Thompson", title: "Head of Sales" }], urls: [], notes: "" }),
    });
    ctx.options = { roleFilter: "Head of Sales" };
    const res = await runPipeline(fixture("urls"), ctx);
    expect(res.companies.map((c) => c.domain)).toEqual(["linear.app"]);
    expect(res.contacts[0].primary_email).toBe("ava.thompson@linear.app");
    expect(JSON.stringify(calls)).not.toContain("linkedin.com/company");
  });

  it("rerunCompany bypasses the cache", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "xco.com", confidence: 1, source_url: null, alternatives: [] }),
      discover_pattern: [noPatterns, firstLast()],
    });
    ctx.options = { rescue: false };
    const res = await runPipeline(buildExtract({ people: [{ first: "Ann", last: "Bell", company: "X" }] }), ctx);
    expect(res.contacts[0].status).toBe("no_pattern");
    await rerunCompany(res.companies[0], res.contacts, ctx);
    expect(res.contacts[0].status).toBe("ok");
    expect(calls.filter((c) => c.stage === "discover_pattern")).toHaveLength(2);
  });
});

describe("rerunCompany company-first", () => {
  it("looks people up again when the company has no rows", async () => {
    const { ctx } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "ramp.com", confidence: 1, source_url: null, alternatives: [] }),
      discover_pattern: firstLast(),
      find_people: toolResponse("extract_contacts", { mode: "people", companies: [], people: [{ first: "Daniel", last: "Kim", title: "Head of Sales" }], urls: [], notes: "" }),
    });
    ctx.options = { roleFilter: "Head of Sales" };
    const rows: Contact[] = [];
    await rerunCompany({ id: "ramp", name: "Ramp", patterns: [] }, [], ctx, { onRow: (r) => rows.push(r) });
    expect(rows.map((r) => r.primary_email)).toEqual(["daniel.kim@ramp.com"]);
  });
});

describe("rescued label", () => {
  it("marks every row of a rescued company, not just the first", async () => {
    const { ctx } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: null, confidence: 0, source_url: null, alternatives: [] }),
      rescue_agent: finish({ domain: "acme.co.uk", domain_source_url: "https://acme.co.uk", patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: "https://x" }] }),
    });
    const res = await runPipeline(buildExtract({ people: ["Ann", "Bea", "Cy"].map((f) => ({ first: f, last: "Lee", company: "Acme" })) }), ctx);
    expect(res.contacts.map((c) => [c.status, c.rescued])).toEqual([["ok", true], ["ok", true], ["ok", true]]);
  });
});

describe("incomplete last names", () => {
  it("gives no junk guesses for 'Maria O.' and does not rescue", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "flsalaw.com", confidence: 0.9, source_url: "https://x", alternatives: [] }),
      discover_pattern: firstLast(),
    });
    const res = await runPipeline(buildExtract({ people: [{ first: "Maria", last: "O.", company: "Werman" }, { first: "Doug", last: "Werman", company: "Werman" }] }), ctx);
    expect(res.contacts.map((c) => [c.status, c.candidates.length])).toEqual([["error", 0], ["ok", 3]]);
    expect(res.contacts[0].error).toMatch(/incomplete/);
    expect(calls.some((c) => c.stage === "rescue_agent")).toBe(false);
  });
});
