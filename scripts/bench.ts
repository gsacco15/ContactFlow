// Benchmark: score ContactFlow against people whose real address is known.
//
//   pnpm bench --mock                       free practice run on bench/sample.csv (fake AI answers)
//   pnpm bench bench/data/sends.csv         real run against the deployed edge function (costs money)
//
// Options: --limit N · --budget USD (default 5) · --site on|shadow|off · --evidence on|shadow|off · --give-domain · --use-cache
// Answer keys hold real addresses: keep them in bench/data/ (git-ignored). Reports go to
// bench/results/ — the .md is aggregates only; the .json has per-row detail for debugging.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import {
  ClaudeDecisions, DEFAULT_BUDGET, MxVerifier, estimateCost, formatReport, memoryCache, memoryEvidence, parseAnswerKey, parseEnrichRequest, runPipeline,
  scoreBench, toBenchRequest, toEnrichResponse, toExtract, type BenchReport, type BenchRow, type Ctx, type DecisionProvider, type LlmRequest,
  type LlmResponse, type RunResult, type UsageEvent,
} from "@cf/core";
import { edgeClient, layeredCache } from "../packages/web/src/lib/edgeClient.ts";

// ── args ──
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const optArgs = new Set(["limit", "budget", "site", "evidence", "out"].flatMap((n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? [i, i + 1] : [];
}));
const file = argv.find((a, i) => !a.startsWith("--") && !optArgs.has(i)) ?? "bench/sample.csv";
const mock = flag("mock");
const limit = Number(opt("limit") ?? Infinity);
const budget = Number(opt("budget") ?? 5);
const site = opt("site") as "on" | "shadow" | "off" | undefined;
const outDir = opt("out") ?? "bench/results";
if (site && !["on", "shadow", "off"].includes(site)) throw new Error("--site must be on, shadow or off");
// Default off in the benchmark so runs don't write into the shared evidence store; --evidence on
// reads (and adds to) it, to test whether strong verdicts are right.
const evidenceMode = (opt("evidence") ?? "off") as "on" | "shadow" | "off";
if (!["on", "shadow", "off"].includes(evidenceMode)) throw new Error("--evidence must be on, shadow or off");

// ── answer key ──
const key = parseAnswerKey(readFileSync(file, "utf8"));
for (const e of key.errors) console.warn(`  ! ${e}`);
if (key.skipped) console.log(`  skipped ${key.skipped} rows with an unclear outcome (soft bounce, unsubscribe…)`);
const rows: BenchRow[] = key.rows.slice(0, limit);
if (!rows.length) throw new Error(`no usable rows in ${file}`);
console.log(`${rows.length} people from ${file}${mock ? " · MOCK (free, fake answers)" : ""}`);

// ── ctx ──
const usage: UsageEvent[] = [];
const onUsage = (u: UsageEvent) => usage.push(u);
const spent = () => usage.reduce((n, u) => n + estimateCost(u), 0);
let ctx: Ctx;
if (mock) {
  ctx = { llm: mockLlm, cache: memoryCache(), decisions: noDecisions(), evidence: memoryEvidence(), budget: { ...DEFAULT_BUDGET }, options: { siteMode: site, evidenceMode }, onUsage };
} else {
  const url = process.env.CF_EDGE_URL ?? process.env.VITE_EDGE_URL;
  if (!url) throw new Error("Set CF_EDGE_URL to the deployed pipeline function URL (or use --mock)");
  const client = edgeClient({ url, session: `bench-${Date.now()}`, token: process.env.CF_ACCESS_TOKEN_CLIENT || undefined, onRateLimited: (s) => console.log(`  rate limited, waiting ${s}s`) });
  const llm: Ctx["llm"] = (r) => client.llm(r);
  ctx = {
    llm,
    // Fresh by default, so the run measures finding, not memory. --use-cache reads the shared memory.
    cache: flag("use-cache") ? layeredCache(memoryCache(), client.cache) : memoryCache(),
    decisions: new ClaudeDecisions({ llm, onUsage }),
    verifier: new MxVerifier(client.mx),
    site: client.site,
    evidence: client.evidence,
    budget: { ...DEFAULT_BUDGET },
    options: { siteMode: site, evidenceMode },
    onUsage,
  };
}

// ── run, in company-sized chunks so the budget can stop it cleanly ──
const byCompany = new Map<string, BenchRow[]>();
for (const r of rows) byCompany.set(r.company.toLowerCase(), [...(byCompany.get(r.company.toLowerCase()) ?? []), r]);
const chunks: BenchRow[][] = [];
let cur: BenchRow[] = [];
for (const group of byCompany.values()) {
  if (cur.length && cur.length + group.length > 25) chunks.push(cur), (cur = []);
  cur.push(...group);
}
if (cur.length) chunks.push(cur);

const t0 = Date.now();
const done: BenchRow[] = [];
const merged: Pick<RunResult, "companies" | "contacts"> = { companies: [], contacts: [] };
const refs = new Map<string, string>();
for (const chunk of chunks) {
  if (spent() >= budget) {
    console.log(`\n  budget of $${budget} reached — scoring the ${done.length} people done so far`);
    break;
  }
  const parsed = parseEnrichRequest(toBenchRequest(chunk, { giveDomain: flag("give-domain") }));
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  const { extract, refs: r } = toExtract(parsed.value);
  r.forEach((v, k) => refs.set(k, v));
  const res = await runPipeline(extract, ctx, { onRow: (c) => process.stdout.write(c.status === "ok" ? "." : "x") });
  merged.companies.push(...res.companies);
  merged.contacts.push(...res.contacts);
  done.push(...chunk);
}
const seconds = (Date.now() - t0) / 1000;
console.log("\n");

// ── score + report ──
const settings: Record<string, string> = {};
if (site) settings.site = site;
if (evidenceMode !== "off") settings.evidence = evidenceMode;
if (flag("give-domain")) settings.domains = "given";
if (flag("use-cache")) settings.cache = "shared";
const response = toEnrichResponse(merged, { include_guesses: true, max_emails: 3 }, refs);
const report = scoreBench(done, response, { cost_usd: spent(), seconds, companies: merged.companies.length, mode: mock ? "mock" : "live", settings });

mkdirSync(outDir, { recursive: true });
const prevFile = readdirSync(outDir).filter((f) => f.endsWith(".json")).sort().at(-1);
const prev: BenchReport | undefined = prevFile ? JSON.parse(readFileSync(`${outDir}/${prevFile}`, "utf8")) : undefined;
const stamp = report.at.replace(/[:.]/g, "-").slice(0, 19);
const md = formatReport(report, prev?.meta.mode === report.meta.mode ? prev : undefined);
writeFileSync(`${outDir}/${stamp}.json`, JSON.stringify(report, null, 2));
writeFileSync(`${outDir}/${stamp}.md`, md);
console.log(md);
console.log(`Saved ${outDir}/${stamp}.md (shareable) and .json (per-row detail, contains addresses).`);

// ── mock mode: deterministic fake answers, no network ──
function mockLlm(req: LlmRequest): Promise<LlmResponse> {
  const input = (req.input ?? {}) as Record<string, string>;
  const respond = (name: string, data: unknown, searches = 1): LlmResponse => ({
    content: [{ type: "tool_use", id: `m${Math.random()}`, name, input: data }],
    toolCalls: [{ id: "m", name, input: data }],
    sources: [],
    usage: { input_tokens: 1500, output_tokens: 150, web_search_requests: searches, web_fetch_requests: 0 },
    model: "mock",
    stop_reason: "tool_use",
  });
  if (req.stage === "resolve_domain") {
    const name = String(input.company ?? input.name ?? JSON.stringify(req.input)).toLowerCase();
    const domain = name.replace(/\b(llc|llp|inc|pc|ltd|corp|co|the|and|&)\b/g, "").replace(/[^a-z0-9]/g, "") + ".com";
    return Promise.resolve(respond("report_domain", { domain, confidence: 0.9, source_url: `https://${domain}`, alternatives: [] }));
  }
  if (req.stage === "discover_pattern") {
    const d = String(req.vars?.domain ?? "");
    const flast = [...d].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 2 === 0;
    return Promise.resolve(
      respond("report_patterns", {
        patterns: flast
          ? [{ template: "{f}{last}", confidence: 0.9, source_url: `https://contactout.com/${d}`, stated: true }]
          : [{ template: "{first}.{last}", confidence: 0.72, source_url: `https://rocketreach.co/${d}`, stated: true }],
      }),
    );
  }
  if (req.stage === "rescue_agent") return Promise.resolve(respond("finish", { gave_up: true, reason: "mock" }, 0));
  return Promise.reject(new Error(`mock: no answer for ${req.stage}`));
}

function noDecisions(): DecisionProvider {
  return { name: "none", calibrated: false, classify: async () => ({}), choose: async () => ({ index: 0, probs: [] }), score: async () => 1, scoreMany: async (items: string[]) => items.map(() => ({ p: 1 })) } as unknown as DecisionProvider;
}

