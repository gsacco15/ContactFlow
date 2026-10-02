import { describe, expect, it } from "vitest";
import { formatReport, parseAnswerKey, parseCsv, scoreBench, toBenchRequest, type EnrichResponse } from "../src/index.ts";

describe("parseCsv", () => {
  it("handles quotes, commas and newlines inside quotes, CRLF and tabs", () => {
    expect(parseCsv('a,b\r\n"Smith, Jr.","say ""hi""\nthere"\n')).toEqual([["a", "b"], ["Smith, Jr.", 'say "hi"\nthere']]);
    expect(parseCsv("a\tb\nx\ty")).toEqual([["a", "b"], ["x", "y"]]);
  });
});

describe("parseAnswerKey", () => {
  it("accepts sending-tool column names and outcome words", () => {
    const k = parseAnswerKey("First Name,Last Name,Company Name,Email,Status\nJane,Doe,Acme,JDoe@Acme.com,Hard Bounce\nSam,Lee,Beta,sam@beta.io,opened\nAl,Ng,Cee,al@cee.com,\n");
    expect(k.errors).toEqual([]);
    expect(k.rows.map((r) => [r.ref, r.real_email, r.outcome])).toEqual([
      ["r2", "jdoe@acme.com", "bounced"],
      ["r3", "sam@beta.io", "delivered"],
      ["r4", "al@cee.com", "confirmed"], // no outcome = you know it's right
    ]);
  });

  it("skips unclear outcomes and reports bad rows without stopping", () => {
    const k = parseAnswerKey("first,last,company,email,outcome\nA,B,C,a@c.com,soft bounce\nD,E,F,not-an-email,delivered\nG,H,I,g@i.com,teleported\nJ,K,L,j@l.com,replied\n");
    expect(k.skipped).toBe(1);
    expect(k.errors).toEqual(["line 3: needs first, company and a valid email", 'line 4: unknown outcome "teleported"']);
    expect(k.rows).toHaveLength(1);
  });

  it("says which columns are missing", () => {
    expect(parseAnswerKey("name,email\nx,y@z.com").errors).toEqual(["missing a column for first", "missing a column for last", "missing a column for company"]);
  });
});

describe("toBenchRequest", () => {
  it("never sends the real email; domain only when asked", () => {
    const { rows } = parseAnswerKey("first,last,company,domain,email\nJane,Doe,Acme,acme.com,jdoe@acme.com\n");
    expect(JSON.stringify(toBenchRequest(rows))).not.toContain("jdoe@");
    expect(toBenchRequest(rows).people![0].domain).toBeUndefined();
    expect(toBenchRequest(rows, { giveDomain: true }).people![0].domain).toBe("acme.com");
  });
});

describe("scoreBench", () => {
  const { rows } = parseAnswerKey(
    [
      "first,last,company,email,outcome",
      "Jane,Doe,Acme,jdoe@acme.com,delivered", // right, 1st, RocketReach 95%
      "Sam,Lee,Acme,sam.lee@acme.com,replied", // right one is 2nd → confident but wrong
      "Ann,Ray,Beta,ann@beta.co,delivered", // wrong domain, no sourced email, guess
      "Bo,Kim,Acme,bkim@acme.com,bounced", // known bounce, ranked 1st (bad)
    ].join("\n"),
  );
  const rr = { format: "flast", template: "{f}{last}" as const, confidence: 0.95, confidence_basis: "stated by source" as const, source: "RocketReach", source_url: "https://rocketreach.co/x" };
  const e = (address: string, rank: 1 | 2 | 3, basis: "sourced" | "guess" = "sourced") => ({ address, rank, basis, verify_status: "unverified" as const });
  const res: EnrichResponse = {
    version: "v1",
    companies: [],
    people: [
      { ref: "r2", first: "Jane", last: "Doe", company: "Acme", domain: "acme.com", domain_source_url: null, emails: [e("jdoe@acme.com", 1), e("jane.doe@acme.com", 2)], pattern: rr, status: "ok" },
      { ref: "r3", first: "Sam", last: "Lee", company: "Acme", domain: "acme.com", domain_source_url: null, emails: [e("slee@acme.com", 1), e("sam.lee@acme.com", 2)], pattern: rr, status: "ok" },
      { ref: "r4", first: "Ann", last: "Ray", company: "Beta", domain: "beta.com", domain_source_url: null, emails: [e("ann.ray@beta.com", 1, "guess")], pattern: null, status: "no_pattern" },
      { ref: "r5", first: "Bo", last: "Kim", company: "Acme", domain: "acme.com", domain_source_url: null, emails: [e("bkim@acme.com", 1)], pattern: rr, status: "ok" },
    ],
  };
  const r = scoreBench(rows, res, { cost_usd: 0.3, seconds: 12, companies: 2, mode: "test", settings: {} }, "2026-10-02T00:00:00Z");

  it("scores the headline numbers", () => {
    expect(r.rows).toEqual({ total: 4, right: 3, bounced: 1 });
    expect([r.top1.hits, r.top1.n]).toEqual([1, 3]);
    expect([r.top3.hits, r.top3.n]).toEqual([2, 3]);
    expect([r.domain.hits, r.domain.n]).toEqual([2, 3]);
    expect([r.no_answer.hits, r.no_answer.n]).toEqual([1, 3]);
    expect([r.confident_wrong.hits, r.confident_wrong.n]).toEqual([1, 2]);
    expect([r.bounced_first.hits, r.bounced_first.n]).toEqual([1, 1]);
  });

  it("checks whether scores mean what they say, by source", () => {
    expect(r.by_confidence["90%+"]).toEqual({ n: 2, hits: 1, rate: 0.5 });
    expect(r.by_source.RocketReach).toEqual({ n: 2, hits: 1, rate: 0.5, avg_confidence: 0.95 });
  });

  it("costs per usable contact", () => {
    expect(r.cost.per_usable).toBeCloseTo(0.3);
    expect(r.seconds_per_company).toBe(6);
  });

  it("the shareable report has no names or addresses, and shows change since last time", () => {
    const md = formatReport(r, { ...r, top1: { n: 3, hits: 0, rate: 0 }, confident_wrong: { n: 2, hits: 0, rate: 0 } });
    expect(md).not.toMatch(/@|Jane|Doe|Acme/);
    expect(md).toContain("**33%** (+33 pts ▲ better)");
    expect(md).toContain("**50%** (+50 pts ▼ worse)");
  });
});
