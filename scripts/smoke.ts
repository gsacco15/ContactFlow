// Live smoke test: runs a fixture end to end against the deployed edge function.
//   CF_EDGE_URL=https://<ref>.supabase.co/functions/v1/pipeline pnpm smoke [fixture]
// Pass = ≥ 80 % rows ok and ≤ 4 searches per company.
import { readFileSync } from "node:fs";
import { ClaudeDecisions, DEFAULT_BUDGET, MxVerifier, estimateCost, memoryCache, runPipeline, type Ctx, type UsageEvent } from "@cf/core";
import { edgeClient, layeredCache } from "../packages/web/src/lib/edgeClient.ts";

const url = process.env.CF_EDGE_URL ?? process.env.VITE_EDGE_URL;
if (!url) throw new Error("Set CF_EDGE_URL to the deployed pipeline function URL");
const name = process.argv[2] ?? "linkedin_results";
const text = readFileSync(new URL(`../fixtures/${name}.txt`, import.meta.url), "utf8");
const roles = process.argv[3];

const client = edgeClient({ url, session: `smoke-${Date.now()}`, token: process.env.CF_ACCESS_TOKEN_CLIENT || undefined, onRateLimited: (s) => console.log(`rate limited, waiting ${s}s`) });
const usage: UsageEvent[] = [];
const llm: Ctx["llm"] = (r) => client.llm(r);
const onUsage = (u: UsageEvent) => usage.push(u);
const ctx: Ctx = {
  llm,
  cache: layeredCache(memoryCache(), process.env.SMOKE_NO_EDGE_CACHE ? undefined : client.cache),
  decisions: new ClaudeDecisions({ llm, onUsage }),
  verifier: new MxVerifier(client.mx),
  budget: { ...DEFAULT_BUDGET },
  options: { roleFilter: roles },
  onUsage,
};

const t0 = Date.now();
const res = await runPipeline(text, ctx, { onRow: (c) => process.stdout.write(c.status === "ok" ? "." : "x") });
const secs = ((Date.now() - t0) / 1000).toFixed(1);
console.log("\n");
const byId = Object.fromEntries(res.companies.map((c) => [c.id, c]));
console.table(
  res.contacts.map((c) => ({
    name: `${c.first} ${c.last}`,
    company: byId[c.company_id]?.name,
    domain: byId[c.company_id]?.domain,
    pattern: c.candidates[0]?.pattern,
    email_1: c.candidates[0]?.email,
    status: c.status,
  })),
);
const searches = usage.reduce((n, u) => n + u.web_search_requests, 0);
const tokens = usage.reduce((n, u) => n + u.input_tokens + u.output_tokens, 0);
const cost = usage.reduce((n, u) => n + estimateCost(u), 0);
const ok = res.contacts.filter((c) => c.status === "ok").length;
const perCompany = searches / Math.max(1, res.companies.length);
console.log(`${res.contacts.length} contacts, ${res.companies.length} companies in ${secs}s`);
console.log(`searches: ${searches} (${perCompany.toFixed(1)}/company) · tokens: ${tokens} · ≈ $${cost.toFixed(3)}`);
const pass = ok / Math.max(1, res.contacts.length) >= 0.8 && perCompany <= 4;
console.log(`${pass ? "PASS" : "FAIL"}: ${ok}/${res.contacts.length} ok`);
process.exit(pass ? 0 : 1);
