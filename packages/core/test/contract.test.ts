// Contract tests: each stage parses a recorded edge-function response into the right
// StageResult. Recordings marked "live" also enforce the M2 acceptance counts (±1);
// "mock" recordings (from scripts/mock-anthropic.mjs) only check shapes.
// Re-record against the deployed function with `pnpm record`.
import { describe, expect, it } from "vitest";
import { ClaudeDecisions, classifyExtract, discoverPattern, findPeople, resolveDomain, type LlmResponse } from "../src/index.ts";
import { expected, mockCtx, recorded } from "./helpers.ts";

const ctxFor = (name: string) => {
  const r = recorded(name);
  return { rec: r, ...mockCtx({ [r.request.stage]: r.response as LlmResponse }) };
};

describe.each(["linkedin_results", "team_page", "mixed_notes", "companies_only", "urls"])("classify_extract on %s", (fixture) => {
  it("parses into an ExtractResult", async () => {
    const { rec, ctx } = ctxFor(`classify_extract.${fixture}`);
    const r = await classifyExtract(rec.request.input, ctx);
    expect(r.ok).toBe(true);
    expect(r.tokens_used).toBeGreaterThan(0);
    for (const p of r.data!.people) expect(p.first).not.toMatch(/\b(1st|2nd|3rd)\b|[\u{1F300}-\u{1FAFF}]/u);
    if (rec.recorded_against === "live") {
      const want = expected(fixture);
      expect(Math.abs(r.data!.people.length - want.people)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.data!.companies.length - want.companies)).toBeLessThanOrEqual(1);
      if (want.urls) expect(r.data!.urls.length).toBe(want.urls);
    }
  });
});

describe("web-search stages", () => {
  it("resolve_domain", async () => {
    const { rec, ctx } = ctxFor("resolve_domain");
    const r = await resolveDomain({ name: rec.request.input.company, hint: rec.request.input.hint }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.domain).toBe("stripe.com");
    expect(r.searches_used).toBeGreaterThanOrEqual(1);
  });

  it("discover_pattern", async () => {
    const { ctx } = ctxFor("discover_pattern");
    const r = await discoverPattern("stripe.com", ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.patterns.length).toBeGreaterThan(0);
    expect(r.data!.patterns[0].source_url).toMatch(/^https?:\/\//);
    expect(r.sources.length).toBeGreaterThan(0);
  });

  it("find_people", async () => {
    const { rec, ctx } = ctxFor("find_people");
    const r = await findPeople({ id: "linear", name: "Linear", domain: "linear.app", website: "https://linear.app/about", patterns: [] }, rec.request.input.role_filter, ctx);
    expect(r.ok).toBe(true);
    expect(r.data!.people.length).toBeGreaterThan(0);
    expect(r.data!.people.every((p) => p.company_id === "linear")).toBe(true);
  });

  it("decide", async () => {
    const { ctx } = ctxFor("decide");
    const p = await new ClaudeDecisions(ctx).score("{}", "q");
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThanOrEqual(1);
  });
});
