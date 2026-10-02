import { describe, expect, it } from "vitest";
import { buildExtract, formatFromAddress, generateCandidates, inferTemplates, normalizeName, pastePatterns, runPipeline, type Contact } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

describe("inferTemplates", () => {
  it("explains a local part from a name", () => {
    expect(inferTemplates(normalizeName("Mark DeBofsky"), "mdebofsky")).toEqual([{ template: "{f}{last}" }]);
    expect(inferTemplates(normalizeName("Jane Doe"), "jane.doe")[0]).toEqual({ template: "{first}.{last}" });
    expect(inferTemplates(normalizeName("Jane Doe"), "xyz")).toEqual([]);
  });
  it("treats an unknown middle initial as a wildcard", () => {
    expect(inferTemplates(normalizeName("Alex Behn"), "ajb")).toEqual([{ template: "{f}{m}{l}", middle: "j" }]);
    expect(inferTemplates(normalizeName("Alex J. Behn"), "ajb")).toEqual([{ template: "{f}{m}{l}" }]);
  });
});

describe("initials templates", () => {
  it("generates {f}{m}{l} only when the middle initial is known", () => {
    const p = [{ template: "{f}{m}{l}" as const, confidence: 0.9 }];
    expect(generateCandidates(normalizeName("Naomi Bensdorf Frisch"), "ulaw.com", p)[0].email).toBe("nbf@ulaw.com");
    expect(generateCandidates(normalizeName("Matt Pierce"), "ulaw.com", p)[0].email).toBe("matt.pierce@ulaw.com");
  });
});

const co = (extra = {}) => ({ id: "asher", name: "Asher, Gittler & D'Alba", domain: "ulaw.com", patterns: [], ...extra });
const person = (first: string, last: string, email?: string): Contact => ({ id: first, first, last, email, company_id: "asher", raw_source: "", candidates: [], status: "pending" });

describe("pastePatterns safeguards", () => {
  it("uses an email next to a named person at the company domain", () => {
    expect(pastePatterns(co(), [person("Alex", "Behn", "ajb@ulaw.com")])).toEqual([
      { template: "{f}{m}{l}", confidence: 0.85, from_paste: true, quote: "ajb@ulaw.com (Alex Behn)", evidence: ["ajb@ulaw.com"] },
    ]);
  });
  it("ignores other domains, personal mail and addresses that don't fit the name", () => {
    expect(pastePatterns(co(), [person("Alex", "Behn", "alex@gmail.com"), person("Matt", "Pierce", "jsmith@ulaw.com"), person("Fred", "Asher", "fa@asher.com")])).toEqual([]);
  });
  it("ranks agreeing examples above a single one", () => {
    const out = pastePatterns(co(), [person("Alex", "Behn", "abehn@ulaw.com"), person("Matt", "Pierce", "mpierce@ulaw.com"), person("Fred", "Asher", "fred@ulaw.com")]);
    expect(out.map((p) => [p.template, p.confidence])).toEqual([["{f}{last}", 0.95], ["{first}", 0.85]]);
  });
  it("reads stated formats: example with a name, or a template in words; skips other domains", () => {
    const stated = co({
      domain: "debofsky.com",
      stated_formats: [
        { quote: "The firm uses the format mdebofsky@debofsky.com for Mark DeBofsky.", example_email: "mdebofsky@debofsky.com", example_name: "Mark DeBofsky" },
        { quote: "emails are first.last", template: "{first}.{last}" },
        { quote: "x", template: "{first}", example_email: "info@other.com" },
      ],
    });
    expect(pastePatterns(stated, []).map((p) => [p.template, p.confidence])).toEqual([["{f}{last}", 0.85], ["{first}.{last}", 0.8]]);
  });
});

describe("runner with paste evidence", () => {
  const extract = () =>
    buildExtract({
      mode: "people",
      companies: [{ name: "Asher, Gittler & D'Alba, Ltd." }],
      people: [
        { first: "Alex", last: "Behn", email: "AJB@ULAW.COM", company: "Asher, Gittler & D'Alba, Ltd." },
        { first: "Naomi", middle: "Bensdorf", last: "Frisch", company: "Asher, Gittler & D'Alba, Ltd." },
        { first: "Matt", last: "Pierce", company: "Asher, Gittler & D'Alba, Ltd." },
        { first: "Fred", last: "Asher", company: "Asher, Gittler & D'Alba, Ltd.", flag: "Headline says 'Asher' in New York" },
      ],
    });

  it("takes domain and pattern from the paste: no search, no rescue", async () => {
    const { ctx, calls } = mockCtx({});
    const res = await runPipeline(extract(), ctx);
    expect(calls).toEqual([]);
    const by = Object.fromEntries(res.contacts.map((c) => [c.first, c]));
    expect(res.companies[0]).toMatchObject({ domain: "ulaw.com", domain_from_paste: true });
    expect(by.Alex.candidates[0]).toMatchObject({ email: "ajb@ulaw.com", pattern: "pasted" });
    expect(by.Naomi.primary_email).toBe("nbf@ulaw.com");
    expect(by.Matt.note).toMatch(/middle initial/);
    expect(by.Matt.status).toBe("no_pattern"); // only backup guesses for him, and no pointless rescue
    expect(by.Matt.candidates.every((c) => c.basis === "guess")).toBe(true);
    expect(by.Fred).toMatchObject({ status: "skipped", candidates: [] }); // ⚠-flagged: not looked up
    expect(by.Alex.candidates[0].basis).toBe("seen");
    expect(by.Naomi.candidates[0].basis).toBe("sourced");
  });

  it("toggle off: the paste is ignored and the pipeline searches", async () => {
    const { ctx, calls } = mockCtx({
      resolve_domain: toolResponse("report_domain", { domain: "ulaw.com", confidence: 0.9, source_url: "https://ulaw.com", alternatives: [] }),
      discover_pattern: toolResponse("report_patterns", { patterns: [] }),
    });
    ctx.options = { usePasteEvidence: false, rescue: false };
    const res = await runPipeline(extract(), ctx);
    expect(calls.map((c) => c.stage)).toEqual(["resolve_domain", "discover_pattern"]);
    expect(res.contacts.find((c) => c.first === "Alex")!.candidates[0].email).toBe("alex.behn@ulaw.com");
  });

  it("flags when paste and a cached search disagree", async () => {
    const { ctx } = mockCtx({});
    await ctx.cache.set("domain:ulaw.com", { patterns: [{ template: "{first}.{last}", confidence: 0.6, source_url: "https://x" }], mx_ok: true, fetched_at: "" }, 30);
    const res = await runPipeline(extract(), ctx);
    expect(res.companies[0].pattern_conflict).toMatch(/paste says \{f\}\{m\}\{l\}, search says \{first\}\.\{last\}/);
    expect(res.companies[0].patterns.map((p) => p.template)).toEqual(["{f}{m}{l}", "{first}.{last}"]);
  });
});

describe("formatFromAddress (unnamed addresses)", () => {
  it.each([
    ["jfairchild@crokefairchild.com", "Croke Fairchild Duarte & Beres LLC", "{f}{last}"],
    ["kbattle@mokblaw.com", "O'Connor & Battle LLP", "{f}{last}"],
    ["msanchez@sanchezdh.com", "Sanchez Daniels & Hoffman LLP", "{f}{last}"],
    ["kevin.battle@x.com", "O'Connor & Battle LLP", "{first}.{last}"],
    ["emery.harlan@mwhlawgroup.com", "MWH Law Group LLP", undefined],
    ["afishman@cm.law", "CM Law, LLP", undefined],
    ["ken@johnsonblumberg.com", "Johnson, Blumberg & Associates", undefined],
    ["info@tristancervantes.com", "Tristan & Cervantes", undefined],
  ])("%s at %s → %s", (email, firm, want) => {
    expect(formatFromAddress(email, firm)).toBe(want);
  });

  it("an unnamed partner address sets the format for named colleagues at that firm", () => {
    const people = [person("", "", "jfairchild@crokefairchild.com")];
    expect(pastePatterns(co({ name: "Croke Fairchild Duarte & Beres LLC", domain: "crokefairchild.com" }), people).map((p) => p.template)).toEqual(["{f}{last}"]);
  });
});
