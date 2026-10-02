import { describe, expect, it } from "vitest";
import { estimateCost, memoryEvidence, runPipeline, verifyRow, type Ctx, type MailboxChecker, type UsageEvent, type VerifyStatus } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

const extract = toolResponse("extract_contacts", {
  mode: "people",
  companies: [{ name: "Acme", website: "acme.com" }],
  people: [
    { first: "Jo", last: "Li", company: "Acme" },
    { first: "Priya", last: "Natarajan", company: "Acme" }, // longest name → the one checked
  ],
  urls: [],
  notes: "",
});
const firstLast = toolResponse("report_patterns", { patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: "https://rocketreach.co/acme", stated: true }] });
const nothing = toolResponse("report_patterns", { patterns: [] });

/** A provider that knows which addresses exist. */
function mailbox(answers: Record<string, VerifyStatus>, real = true): MailboxChecker & { asked: string[] } {
  const asked: string[] = [];
  return { name: "test", real, asked, check: async (emails) => Object.fromEntries(emails.map((e) => (asked.push(e), [e, answers[e] ?? "invalid"]))) };
}

function setup(script: Parameters<typeof mockCtx>[0], box: MailboxChecker, verifyMode: "off" | "button" | "auto", extra: Partial<Ctx> = {}) {
  const usage: UsageEvent[] = [];
  const { ctx, calls } = mockCtx({ classify_extract: extract, rescue_agent: toolResponse("finish", { gave_up: true }), ...script }, { mailbox: box, onUsage: (u) => usage.push(u), ...extra });
  ctx.options = { verifyMode, rescue: false, ...ctx.options };
  return { ctx, calls, usage };
}

describe("verification", () => {
  it("off: never checks", async () => {
    const box = mailbox({ "priya.natarajan@acme.com": "valid" });
    await runPipeline("x", setup({ discover_pattern: firstLast }, box, "off").ctx);
    expect(box.asked).toEqual([]);
  });

  it("auto: one valid check proves the format for the whole firm", async () => {
    const box = mailbox({ "priya.natarajan@acme.com": "valid" });
    const evidence = memoryEvidence();
    const { ctx, usage } = setup({ discover_pattern: firstLast }, box, "auto", { evidence });
    ctx.options = { ...ctx.options, evidenceMode: "shadow" };
    const res = await runPipeline("x", ctx);
    expect(box.asked).toEqual(["priya.natarajan@acme.com"]); // one check, not one per person
    expect(res.companies[0]).toMatchObject({ format_verified: "{first}.{last}" });
    expect(res.companies[0].patterns[0]).toMatchObject({ template: "{first}.{last}", verified: true, confidence: 0.97 });
    const priya = res.contacts.find((c) => c.first === "Priya")!;
    expect(priya.candidates[0]).toMatchObject({ email: "priya.natarajan@acme.com", verify_status: "valid" });
    expect(res.contacts.find((c) => c.first === "Jo")!.primary_email).toBe("jo.li@acme.com");
    expect(evidence.rows.filter((r) => r.kind === "verifier_valid")).toHaveLength(1);
    expect(estimateCost(usage.find((u) => u.stage === "verify")!)).toBeCloseTo(0.00245, 5);
  });

  it("cracks a firm with no published format: invalid, then valid", async () => {
    const box = mailbox({ "pnatarajan@acme.com": "valid" }); // first.last and first@ are invalid
    const res = await runPipeline("x", setup({ discover_pattern: nothing }, box, "auto").ctx);
    expect(box.asked).toEqual(["priya.natarajan@acme.com", "priya@acme.com", "pnatarajan@acme.com"]);
    expect(res.companies[0].format_verified).toBe("{f}{last}");
    const jo = res.contacts.find((c) => c.first === "Jo")!;
    expect(jo.status).toBe("ok");
    expect(jo.candidates[0]).toMatchObject({ email: "jli@acme.com", basis: "sourced" }); // no longer a guess
  });

  it("stops at 3 checks; failed formats drop to the bottom", async () => {
    const box = mailbox({});
    const res = await runPipeline("x", setup({ discover_pattern: firstLast }, box, "auto").ctx);
    expect(box.asked).toHaveLength(3);
    expect(res.companies[0].format_verified).toBeUndefined();
    expect(res.companies[0].patterns[0].confidence).toBeLessThan(0.3);
    expect(res.contacts.find((c) => c.first === "Priya")!.candidates.every((x) => x.verify_status === "invalid")).toBe(true);
  });

  it("no clear answer (server hides mailboxes): the firm is flagged as unclear, emails unchanged", async () => {
    const box: MailboxChecker = { name: "test", real: true, check: async (emails) => Object.fromEntries(emails.map((e) => [e, "unverified" as const])) };
    const res = await runPipeline("x", setup({ discover_pattern: firstLast }, box, "auto").ctx);
    expect(res.companies[0].verify_unclear).toBe(true);
    expect(res.companies[0].format_verified).toBeUndefined();
    expect(res.contacts.find((c) => c.first === "Jo")!.primary_email).toBe("jo.li@acme.com");
  });

  it("catch-all: one check, then every row is marked accept-all", async () => {
    const box = mailbox({ "priya.natarajan@acme.com": "catch_all" });
    const res = await runPipeline("x", setup({ discover_pattern: firstLast }, box, "auto").ctx);
    expect(box.asked).toHaveLength(1);
    expect(res.companies[0].catch_all).toBe(true);
    expect(res.contacts.every((c) => c.candidates.every((x) => x.verify_status === "catch_all"))).toBe(true);
  });

  it("a firm proven by an earlier check (any user) needs no new check", async () => {
    const evidence = memoryEvidence();
    const at = new Date().toISOString();
    await evidence.record([1, 2].map(() => ({ domain: "acme.com", kind: "verifier_valid" as const, template: "{f}{last}" as const, outcome: "supports" as const, observed_at: at, scope: "global" as const })));
    const box = mailbox({});
    const res = await runPipeline("x", setup({ discover_pattern: firstLast }, box, "auto", { evidence }).ctx);
    expect(box.asked).toEqual([]);
    expect(res.companies[0].format_verified).toBe("{f}{last}");
  });

  it("button: no checks during the search; the Verify button checks that row", async () => {
    const box = mailbox({ "jo.li@acme.com": "valid" });
    const { ctx } = setup({ discover_pattern: firstLast }, box, "button");
    const res = await runPipeline("x", ctx);
    expect(box.asked).toEqual([]);
    const jo = res.contacts.find((c) => c.first === "Jo")!;
    const rows: string[] = [];
    await verifyRow(res.companies[0], res.contacts, ctx, { onRow: (c) => rows.push(c.first) }, jo);
    expect(box.asked).toEqual(["jo.li@acme.com"]);
    expect(jo.candidates[0].verify_status).toBe("valid");
    expect(res.companies[0].format_verified).toBe("{first}.{last}");
    expect(rows.sort()).toEqual(["Jo", "Priya"]); // both rows refreshed
  });

  it("the stand-in provider is never recorded as evidence; a provider outage never breaks the run", async () => {
    const evidence = memoryEvidence();
    const { ctx } = setup({ discover_pattern: firstLast }, mailbox({ "priya.natarajan@acme.com": "valid" }, false), "auto", { evidence });
    ctx.options = { ...ctx.options, evidenceMode: "shadow" };
    await runPipeline("x", ctx);
    expect(evidence.rows.some((r) => r.kind.startsWith("verifier"))).toBe(false);

    const down: MailboxChecker = { name: "down", real: true, check: async () => Promise.reject(new Error("503")) };
    const res = await runPipeline("x", setup({ discover_pattern: firstLast }, down, "auto").ctx);
    expect(res.contacts.find((c) => c.first === "Jo")!.primary_email).toBe("jo.li@acme.com");
  });
});
