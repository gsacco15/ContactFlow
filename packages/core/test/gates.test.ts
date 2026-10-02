import { describe, expect, it } from "vitest";
import { buildExtract, generateCandidates, normalizeName, runPipeline, visibleCandidates } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

describe("firm list with one email each (no names)", () => {
  const extract = () =>
    buildExtract({
      mode: "companies",
      companies: [{ name: "Croke Fairchild Duarte & Beres LLC" }, { name: "Tristan & Cervantes" }, { name: "CM Law, LLP" }],
      people: [
        { first: "", last: "", email: "jfairchild@crokefairchild.com", company: "Croke Fairchild Duarte & Beres LLC" },
        { first: "", last: "", email: "info@tristancervantes.com", company: "Tristan & Cervantes" },
        { first: "", last: "", email: "AFishman@cm.law", company: "CM Law, LLP" },
      ],
    });

  it("keeps each address as a contact (Unknown name), drops shared inboxes, and searches nothing", async () => {
    const { ctx, calls } = mockCtx({});
    const res = await runPipeline(extract(), ctx);
    expect(calls).toEqual([]);
    expect(res.contacts.map((c) => [c.first, c.status, c.candidates.map((x) => [x.email, x.basis])])).toEqual([
      ["", "ok", [["jfairchild@crokefairchild.com", "seen"]]],
      ["", "ok", [["afishman@cm.law", "seen"]]],
    ]);
    const tc = res.companies.find((c) => c.id === "tristan-cervantes")!;
    expect(tc.skipped).toMatch(/no people/);
  });
});

describe("junk gates", () => {
  it("drops anonymous LinkedIn Member rows", () => {
    const ex = buildExtract({ people: [{ first: "LinkedIn", last: "Member", company: "X" }, { first: "Ann", last: "Bell", company: "X" }] });
    expect(ex.people.map((p) => p.first)).toEqual(["Ann"]);
  });

  it("a company whose only people are ⚠-flagged is not looked up", async () => {
    const { ctx, calls } = mockCtx({});
    const res = await runPipeline(buildExtract({ people: [{ first: "Elaine", last: "Witten", company: "A&E Executive Services", flag: "different employer" }] }), ctx);
    expect(calls).toEqual([]);
    expect(res.contacts[0]).toMatchObject({ status: "skipped" });
    expect(res.companies[0].skipped).toMatch(/flagged/);
  });

  it("companies with no people and no target roles cost nothing", async () => {
    const { ctx, calls } = mockCtx({});
    await runPipeline(buildExtract({ mode: "companies", companies: [{ name: "Stripe" }, { name: "Ramp" }] }), ctx);
    expect(calls).toEqual([]);
  });

  it("no emails on an uncertain domain", async () => {
    const { ctx } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "apex.com", confidence: 0.3, source_url: "https://apex.com", alternatives: [] }),
      discover_pattern: toolResponse("report_patterns", { patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: "https://x" }] }),
      rescue_agent: toolResponse("finish", { gave_up: true, reason: "ambiguous company" }),
    });
    const res = await runPipeline(buildExtract({ people: [{ first: "Ann", last: "Bell", company: "Apex" }] }), ctx);
    expect(res.contacts[0]).toMatchObject({ status: "no_domain", candidates: [] });
    expect(res.contacts[0].error).toMatch(/uncertain \(30%\)/);
  });

  it("weak or unsourced patterns only produce guesses, which are hidden by default", () => {
    const c = {
      candidates: generateCandidates(normalizeName("Ann Bell"), "x.com", [
        { template: "{f}{last}", confidence: 0.3, source_url: "https://x" },
        { template: "{first}.{last}", confidence: 0.7, source_url: "https://y" },
      ]),
    } as any;
    expect(c.candidates.map((x: any) => [x.email, x.basis])).toEqual([
      ["ann.bell@x.com", "sourced"],
      ["abell@x.com", "guess"],
      ["ann@x.com", "guess"],
    ]);
    expect(visibleCandidates(c).map((x: any) => x.email)).toEqual(["ann.bell@x.com"]);
    expect(visibleCandidates(c, { includeGuesses: true })).toHaveLength(3);
  });

  it("an initial alone never fills a {first} format", () => {
    expect(generateCandidates(normalizeName("J Fairchild"), "x.com", [{ template: "{first}.{last}", confidence: 0.9, source_url: "https://x" }]).map((x) => x.email)).toEqual([
      "jfairchild@x.com",
    ]);
  });
});
