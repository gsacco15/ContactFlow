import { describe, expect, it } from "vitest";
import { buildExtract, matchesRoles, runPipeline } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

describe("matchesRoles", () => {
  const f = "Partner, Attorney, Of Counsel, -Paralegal, -Retired";
  it.each([
    ["Managing Partner", true],
    ["Partner Emeritus", true],
    ["Associate Attorney", true],
    ["Of Counsel", true],
    ["Litigation Paralegal", false],
    ["Legal Assistant", false],
    ["Retired", false],
    ["Partner (Retired)", false],
    [undefined, undefined],
  ])("%s → %s", (title, want) => expect(matchesRoles(title as any, f)).toBe(want));

  it("multi-word terms need all words; VP / vice president and plurals match", () => {
    expect(matchesRoles("VP of Sales", "VP Sales")).toBe(true);
    expect(matchesRoles("Vice President, Sales", "VP Sales")).toBe(true);
    expect(matchesRoles("VP Marketing", "VP Sales")).toBe(false);
    expect(matchesRoles("Head of Partnerships", "Partnership")).toBe(true);
  });

  it("no filter → undefined; only exclusions → keep the rest", () => {
    expect(matchesRoles("Janitor", "")).toBeUndefined();
    expect(matchesRoles("Partner", "-Paralegal")).toBe(true);
    expect(matchesRoles("Paralegal", "-Paralegal")).toBe(false);
  });
});

describe("role filter in the runner", () => {
  const firm = (people: any[]) => buildExtract({ people: people.map((p) => ({ company: "Werman Salas", ...p })) });
  const script = {
    resolve_domain: toolResponse("report_domain", { domain: "flsalaw.com", confidence: 0.9, source_url: "https://x", alternatives: [] }),
    discover_pattern: toolResponse("report_patterns", { patterns: [{ template: "{f}{last}", confidence: 0.6, source_url: "https://y" }] }),
  };

  it("skips non-matching people before any lookup; keeps people with no title", async () => {
    const { ctx } = mockCtx(script);
    ctx.options = { roleFilter: "Partner, -Paralegal" };
    const res = await runPipeline(
      firm([
        { first: "Douglas", last: "Werman", title: "Managing Shareholder Partner" },
        { first: "Lynsey", last: "Major", title: "Paralegal" },
        { first: "Ann", last: "Bell" },
      ]),
      ctx,
    );
    expect(res.contacts.map((c) => [c.first, c.status])).toEqual([
      ["Douglas", "ok"],
      ["Lynsey", "skipped"],
      ["Ann", "ok"],
    ]);
    expect(res.contacts[1].error).toMatch(/target roles/);
  });

  it("a company where nobody matches is not searched and does not trigger a team-page lookup", async () => {
    const { ctx, calls } = mockCtx({});
    ctx.options = { roleFilter: "Partner" };
    const res = await runPipeline(firm([{ first: "Lynsey", last: "Major", title: "Paralegal" }]), ctx);
    expect(calls).toEqual([]);
    expect(res.companies[0].skipped).toMatch(/matches your target roles|filtered-out/);
  });

  it("keep (Include) overrides the filter and the ⚠ flag", async () => {
    const { ctx } = mockCtx(script);
    ctx.options = { roleFilter: "Partner" };
    const res = await runPipeline(firm([{ first: "Lynsey", last: "Major", title: "Paralegal" }]), ctx).then(async (r) => {
      r.extract.people[0].keep = true;
      return runPipeline(r.extract, ctx);
    });
    expect(res.contacts[0].status).toBe("ok");
  });
});
