import { describe, expect, it } from "vitest";
import { JevDecisions, buildExtract, judgeFit, looksLikeKeywords, relevance, runPipeline, type JevRequest } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

const people = () =>
  buildExtract({
    people: [
      { first: "Douglas", last: "Werman", title: "Managing Shareholder", company: "Werman Salas" },
      { first: "Lynsey", last: "Major", title: "Paralegal", company: "Werman Salas" },
      { first: "Jo", last: "Kim", title: "Marketing Manager", company: "Werman Salas" },
    ],
  });
const byTitle: Record<string, number> = { "Managing Shareholder": 0.92, Paralegal: 0.1, "Marketing Manager": 0.45 };

/** A fake Jev endpoint: answers the noul from the title in the state. */
const fakeJev = (seen: JevRequest[][] = []) =>
  new JevDecisions(async (reqs) => {
    seen.push(reqs);
    return reqs.map((r) => ({ answers: { q: { type: "noul", noul: byTitle[/Title: (.*)/.exec(r.state)![1]] ?? 0.5 } }, usage: { input_tokens: 50, output_tokens: 1 }, model: "jev-1.13.0" }));
  });

describe("judgeFit with Jev", () => {
  it("one batched call, tiers from calibrated probabilities, no emails sent", async () => {
    const seen: JevRequest[][] = [];
    const ex = people();
    await judgeFit(ex.people, "decision makers who'd buy legal software", fakeJev(seen), () => "Werman Salas");
    expect(seen).toHaveLength(1);
    expect(seen[0][0].questions.q).toMatchObject({ type: "noul" });
    expect(seen[0][0].questions.q.instructions).toContain("decision makers who'd buy legal software");
    expect(seen[0][0].state).toBe("Name: Douglas Werman\nTitle: Managing Shareholder\nCompany: Werman Salas");
    expect(ex.people.map((c) => c.fit?.tier)).toEqual(["yes", "no", "maybe"]);
    expect(ex.people[0].fit).toMatchObject({ by: "jev", for: "decision makers who'd buy legal software" });
  });

  it("does not re-judge for the same description", async () => {
    const seen: JevRequest[][] = [];
    const ex = people();
    const jev = fakeJev(seen);
    await judgeFit(ex.people, "buyers", jev, () => undefined);
    await judgeFit(ex.people, "buyers", jev, () => undefined);
    expect(seen).toHaveLength(1);
  });
});

describe("relevance in the runner", () => {
  const script = {
    resolve_domain: toolResponse("report_domain", { domain: "flsalaw.com", confidence: 0.9, source_url: "https://x", alternatives: [] }),
    discover_pattern: toolResponse("report_patterns", { patterns: [{ template: "{f}{last}", confidence: 0.6, source_url: "https://y" }] }),
  };

  it("skips ✗ before searching, keeps ? and ✓", async () => {
    const { ctx } = mockCtx(script, { decisions: fakeJev() });
    ctx.options = { roleFilter: "decision makers who'd buy legal software" };
    const res = await runPipeline(people(), ctx);
    expect(res.contacts.map((c) => [c.first, c.status])).toEqual([
      ["Douglas", "ok"],
      ["Lynsey", "skipped"],
      ["Jo", "ok"],
    ]);
  });

  it("with skipping off, everyone is looked up but still labelled", async () => {
    const { ctx } = mockCtx(script, { decisions: fakeJev() });
    ctx.options = { roleFilter: "buyers", skipIrrelevant: false };
    const res = await runPipeline(people(), ctx);
    expect(res.contacts.every((c) => c.status === "ok")).toBe(true);
    expect(res.contacts[1].fit?.tier).toBe("no");
  });

  it("a sentence is never keyword-matched when the judge is down", async () => {
    const { ctx } = mockCtx(script);
    ctx.decisions = { ...ctx.decisions, scoreMany: () => Promise.reject(new Error("down")) };
    ctx.options = { roleFilter: "decision makers at law firms: partners and administrators." };
    const res = await runPipeline(people(), ctx);
    expect(res.contacts.every((c) => c.status === "ok")).toBe(true);
  });

  it("manual keep / drop win over the judge", () => {
    const c: any = { title: "Paralegal", fit: { p: 0.1, tier: "no", by: "jev", for: "x" } };
    expect(relevance(c, "x")).toBe(false);
    expect(relevance({ ...c, keep: true }, "x")).toBe(true);
    expect(relevance({ ...c, fit: { ...c.fit, tier: "yes" }, drop: true }, "x")).toBe(false);
  });

  it("looksLikeKeywords", () => {
    expect(looksLikeKeywords("Partner, Attorney, -Paralegal")).toBe(true);
    expect(looksLikeKeywords("decision makers at law firms who would buy our software")).toBe(false);
  });
});
