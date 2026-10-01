// Records one real edge-function response per stage into fixtures/recorded/ so contract
// tests can parse real API shapes without network. Re-run after prompt or model changes:
//   CF_EDGE_URL=https://<ref>.supabase.co/functions/v1/pipeline pnpm record
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import type { LlmRequest } from "@cf/core";
import { edgeClient } from "../packages/web/src/lib/edgeClient.ts";

const url = process.env.CF_EDGE_URL ?? process.env.VITE_EDGE_URL;
if (!url) throw new Error("Set CF_EDGE_URL");
const against = process.env.RECORD_AGAINST ?? (/localhost|127\.0\.0\.1/.test(url) ? "mock" : "live");
const client = edgeClient({ url, session: `record-${Date.now()}`, token: process.env.CF_ACCESS_TOKEN_CLIENT || undefined });
const dir = new URL("../fixtures/recorded/", import.meta.url);
mkdirSync(dir, { recursive: true });
const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}.txt`, import.meta.url), "utf8");

const requests: Record<string, LlmRequest> = {
  ...Object.fromEntries(
    ["linkedin_results", "team_page", "mixed_notes", "companies_only", "urls"].map((f) => [`classify_extract.${f}`, { stage: "classify_extract", input: fixture(f) } as LlmRequest]),
  ),
  resolve_domain: { stage: "resolve_domain", input: { company: "Stripe", hint: "VP of Sales" }, maxSearches: 2 },
  discover_pattern: { stage: "discover_pattern", input: { domain: "stripe.com" }, vars: { domain: "stripe.com" }, maxSearches: 3 },
  find_people: {
    stage: "find_people",
    input: { company: "Linear", domain: "linear.app", url: "https://linear.app/about", role_filter: "CEO, Head of Sales" },
    vars: { company: "Linear", domain: "linear.app", role_filter: "CEO, Head of Sales" },
    maxSearches: 1,
    maxFetches: 2,
  },
  decide: { stage: "decide", input: { question: "Is this domain the company's own?", options: ["yes", "no"], context: '{"company":"Stripe","domain":"stripe.com"}' } },
};

for (const [name, req] of Object.entries(requests)) {
  process.stdout.write(`${name} … `);
  const res = await client.llm(req);
  writeFileSync(new URL(`${name}.json`, dir), JSON.stringify({ recorded_against: against, recorded_at: new Date().toISOString(), request: req, response: res }, null, 2));
  console.log(`${res.toolCalls.map((c) => c.name).join(",") || "no tool call"} · ${res.usage.input_tokens + res.usage.output_tokens} tokens · ${res.usage.web_search_requests} searches`);
}
