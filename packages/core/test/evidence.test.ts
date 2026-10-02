import { describe, expect, it } from "vitest";
import {
  cleanEvidence, evidenceFromMx, evidenceFromOutcome, evidenceFromSearch, evidenceFromSite, evidenceFromVerification, memoryEvidence, patternFromEvidence,
  runPipeline, scoreEvidence, type Evidence,
} from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

const NOW = Date.parse("2026-10-02T00:00:00Z");
const at = (daysAgo = 0) => new Date(NOW - daysAgo * 86_400_000).toISOString();
const ev = (kind: Evidence["kind"], template: Evidence["template"], extra: Partial<Evidence> = {}): Evidence => ({
  domain: "acme.com", kind, template, outcome: kind === "bounced" || kind === "verifier_invalid" ? "contradicts" : template ? "supports" : "neutral", observed_at: at(), scope: "global", ...extra,
});

describe("scoreEvidence", () => {
  it("adds up support: two addresses on their site + RocketReach 90% is strong enough to skip the search", () => {
    const v = scoreEvidence("acme.com", [ev("site_email", "{f}{last}", { count: 2, source_url: "https://acme.com/team" }), ev("search_stated", "{f}{last}", { strength: 0.9 })], NOW);
    expect(v.best?.template).toBe("{f}{last}");
    expect(v.best?.score).toBeCloseTo(0.7 * 2 + 0.4 * 0.9);
    expect(v.strong).toBe(true);
    expect(v.best?.source_url).toBe("https://acme.com/team");
    expect(patternFromEvidence(v)).toMatchObject({ template: "{f}{last}", from_evidence: true, source_url: "https://acme.com/team" });
  });

  it("the same source seen on every re-search counts once (no echo)", () => {
    const rr = (daysAgo: number) => ev("search_stated", "{f}{last}", { strength: 0.95, source_url: "https://rocketreach.co/acme", observed_at: at(daysAgo) });
    const v = scoreEvidence("acme.com", [rr(0), rr(30), rr(60), rr(90), rr(120)], NOW);
    expect(v.best?.score).toBeCloseTo(0.4 * 0.95); // newest only
    expect(v.strong).toBe(false);
    // …but separate events without a source (two mailbox checks) both count
    const two = scoreEvidence("acme.com", [ev("verifier_valid", "{f}{last}"), ev("verifier_valid", "{f}{last}")], NOW);
    expect(two.best?.score).toBeCloseTo(2);
  });

  it("one search snippet alone is not strong", () => {
    const v = scoreEvidence("acme.com", [ev("search_stated", "{first}.{last}", { strength: 1 })], NOW);
    expect(v.strong).toBe(false);
    expect(patternFromEvidence(v)).toBeUndefined();
  });

  it("bounces count against a format; a close rival is a conflict", () => {
    const v = scoreEvidence("acme.com", [ev("replied", "{first}.{last}"), ev("bounced", "{first}.{last}"), ev("site_email", "{f}{last}")], NOW);
    expect(v.templates.map((t) => t.template)).toEqual(["{f}{last}", "{first}.{last}"]);
    expect(v.conflict).toBe(false); // 0.7 vs 0.1
    const close = scoreEvidence("acme.com", [ev("verifier_valid", "{first}.{last}"), ev("site_email", "{f}{last}")], NOW);
    expect(close.conflict).toBe(true);
    expect(close.strong).toBe(false);
  });

  it("old evidence fades (half-life 180 days)", () => {
    const fresh = scoreEvidence("acme.com", [ev("verifier_valid", "{first}.{last}")], NOW).best!.score;
    const old = scoreEvidence("acme.com", [ev("verifier_valid", "{first}.{last}", { observed_at: at(360) })], NOW).best!.score;
    expect(old / fresh).toBeCloseTo(0.25, 2);
  });

  it("on a catch-all domain, deliveries and 'valid' checks prove nothing", () => {
    const v = scoreEvidence("acme.com", [ev("verifier_catchall", null), ev("delivered", "{first}"), ev("verifier_valid", "{first}"), ev("site_email", "{f}{last}")], NOW);
    expect(v.catch_all).toBe(true);
    expect(v.templates.map((t) => t.template)).toEqual(["{f}{last}"]);
  });

  it("knows whether the domain takes mail; ignores other domains", () => {
    const v = scoreEvidence("acme.com", [ev("mx_none", null, { observed_at: at(1) }), ev("mx_ok", null), ev("site_email", "{first}", { domain: "other.com" })], NOW);
    expect(v.mx).toBe(true);
    expect(v.best).toBeUndefined();
    expect(v.rows).toBe(2);
  });
});

describe("builders", () => {
  it("turn pipeline events into domain-only rows", () => {
    const search = evidenceFromSearch("acme.com", [
      { template: "{f}{last}", confidence: 0.95, source_url: "https://rocketreach.co/acme", stated: true },
      { template: "{first}", confidence: 0.3, source_url: "https://acme.com/about" },
      { template: "{first}.{last}", confidence: 0.9, from_paste: true },
    ], at());
    expect(search.map((r) => [r.kind, r.template, r.source_name])).toEqual([["search_stated", "{f}{last}", "RocketReach"], ["site_stated", "{first}", "their site"]]);
    expect(evidenceFromSite("acme.com", { template: "{f}{last}", matches: 2 })[0]).toMatchObject({ kind: "site_email", count: 2 });
    expect(evidenceFromSite("acme.com", { matches: 0 })).toEqual([]);
    expect(evidenceFromMx("acme.com", undefined)).toEqual([]);
    expect(evidenceFromVerification("acme.com", "{first}", "invalid")[0].outcome).toBe("contradicts");
    expect(evidenceFromVerification("acme.com", "{first}", "risky")).toEqual([]);
    expect(evidenceFromOutcome("acme.com", "{first}", "bounced")[0]).toMatchObject({ kind: "bounced", outcome: "contradicts" });
  });
});

describe("cleanEvidence", () => {
  it("rejects malformed rows and strips anything that could carry a person", () => {
    expect(cleanEvidence({ ...ev("site_email", "{f}{last}"), domain: "not a domain" })).toBeUndefined();
    expect(cleanEvidence({ ...ev("site_email", "{f}{last}"), kind: "gossip" })).toBeUndefined();
    expect(cleanEvidence({ ...ev("site_email", "{f}{last}"), template: "{nickname}" })).toBeUndefined();
    const c = cleanEvidence({ ...ev("search_stated", "{f}{last}"), source_url: "https://rocketreach.co/acme?name=jane+doe", source_name: "jdoe@acme.com", strength: 7, count: 0, extra: "x" })!;
    expect(c.source_url).toBe("https://rocketreach.co/acme");
    expect(c.source_name).toBeUndefined();
    expect(c.strength).toBe(1);
    expect(c.count).toBe(1);
    expect(c).not.toHaveProperty("extra");
  });

  it("the memory store never returns private rows", async () => {
    const store = memoryEvidence();
    await store.record([ev("paste_email", "{first}", { scope: "private" }), ev("site_email", "{f}{last}")]);
    expect((await store.forDomain("acme.com")).map((r) => r.kind)).toEqual(["site_email"]);
  });
});

describe("in the pipeline", () => {
  const extract = toolResponse("extract_contacts", { mode: "people", companies: [{ name: "Acme", website: "acme.com" }], people: [{ first: "Jane", last: "Doe", company: "Acme" }], urls: [], notes: "" });
  const search = toolResponse("report_patterns", { patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: "https://rocketreach.co/acme", stated: true }] });

  it("off: nothing recorded, nothing read", async () => {
    const store = memoryEvidence();
    const { ctx } = mockCtx({ classify_extract: extract, discover_pattern: search }, { evidence: store });
    ctx.options = { evidenceMode: "off" };
    await runPipeline("x", ctx);
    expect(store.rows).toEqual([]);
  });

  it("shadow: records why, results unchanged", async () => {
    const store = memoryEvidence();
    const { ctx, calls } = mockCtx({ classify_extract: extract, discover_pattern: search }, { evidence: store });
    ctx.options = { evidenceMode: "shadow" };
    const res = await runPipeline("x", ctx);
    expect(res.contacts[0].primary_email).toBe("jane.doe@acme.com");
    expect(calls.some((c) => c.stage === "discover_pattern")).toBe(true);
    expect(store.rows.map((r) => [r.domain, r.kind, r.template, r.strength])).toEqual([["acme.com", "search_stated", "{first}.{last}", 0.8]]);
  });

  it("on: strong evidence skips the paid search; weak evidence doesn't", async () => {
    const store = memoryEvidence();
    await store.record([ev("site_email", "{f}{last}", { count: 2, source_url: "https://acme.com/team" }), ev("verifier_valid", "{f}{last}")]);
    const { ctx, calls } = mockCtx({ classify_extract: extract }, { evidence: store });
    ctx.options = { evidenceMode: "on" };
    const res = await runPipeline("x", ctx);
    expect(calls.some((c) => c.stage === "discover_pattern")).toBe(false);
    expect(res.contacts[0].primary_email).toBe("jdoe@acme.com");
    expect(res.companies[0].patterns[0]).toMatchObject({ from_evidence: true });

    const weak = memoryEvidence();
    await weak.record([ev("search_estimated", "{f}{last}", { strength: 0.5 })]);
    const run2 = mockCtx({ classify_extract: extract, discover_pattern: search }, { evidence: weak });
    run2.ctx.options = { evidenceMode: "on" };
    await runPipeline("x", run2.ctx);
    expect(run2.calls.some((c) => c.stage === "discover_pattern")).toBe(true);
  });
});
