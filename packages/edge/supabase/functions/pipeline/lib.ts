// Pure helpers for the pipeline function. No Deno or npm imports so Vitest can run them in Node.
import { STAGES, TOOLS, type StageName, type StageSpec } from "./_core/schemas.ts";

export type Env = (key: string) => string | undefined;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Server tool type strings live here and nowhere else. The *_20260209 variants (dynamic
// filtering) need Opus/Sonnet 4.6 or newer; Haiku-class models get the basic variants.
export const WEB_TOOLS = {
  dynamic: { search: "web_search_20260209", fetch: "web_fetch_20260209" },
  basic: { search: "web_search_20250305", fetch: "web_fetch_20250910" },
} as const;

/** Never fetched server-side: login-walled or paid data-vendor pages. */
export const FETCH_BLOCKED_DOMAINS = [
  "linkedin.com", "zoominfo.com", "rocketreach.co", "signalhire.com", "apollo.io", "lusha.com",
  "contactout.com", "leadiq.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
];

export const DEFAULT_MODELS = { extract: "claude-sonnet-5-5", classify: "claude-haiku-4-5" };
const MAX_INPUT_CHARS = 200_000;
const MAX_AGENT_MESSAGES = 40;

export function modelFor(spec: StageSpec, env: Env): string {
  const extract = env("CF_MODEL_EXTRACT") || DEFAULT_MODELS.extract;
  if (spec.model === "classify") return env("CF_MODEL_CLASSIFY") || DEFAULT_MODELS.classify;
  if (spec.model === "domain") return env("CF_MODEL_DOMAIN") || extract;
  return extract;
}

export function webToolVersion(model: string, env: Env): keyof typeof WEB_TOOLS {
  const forced = env("CF_WEB_TOOL_VERSION");
  if (forced === "basic" || forced === "dynamic") return forced;
  return /opus-(4-[6-9]|[5-9])|sonnet-(4-[6-9]|[5-9])|fable|mythos/.test(model) ? "dynamic" : "basic";
}

/** {{name}} placeholders only — single-brace tokens like {first} are template syntax and stay. */
export function fillPrompt(prompt: string, vars: Record<string, unknown> = {}): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    const v = vars[k];
    return typeof v === "string" ? v.replace(/[\r\n]+/g, " ").slice(0, 300) : m;
  });
}

export type LlmBody = {
  stage: StageName;
  input?: unknown;
  vars?: Record<string, string>;
  messages?: unknown[];
  maxSearches?: number;
  maxFetches?: number;
};

export function parseBody(raw: unknown): LlmBody {
  const b = raw as LlmBody;
  if (!b || typeof b !== "object") throw new HttpError(400, "body must be JSON");
  if (!(b.stage in STAGES)) throw new HttpError(400, `unknown stage: ${String(b.stage)}`);
  const spec = STAGES[b.stage];
  if (spec.agentic) {
    if (!Array.isArray(b.messages) || !b.messages.length) throw new HttpError(400, "agentic stage needs messages[]");
    if (b.messages.length > MAX_AGENT_MESSAGES) throw new HttpError(400, "too many messages");
  } else if (b.input === undefined) throw new HttpError(400, "input required");
  const size = JSON.stringify(b.input ?? b.messages).length;
  if (size > MAX_INPUT_CHARS) throw new HttpError(413, `input too large (${size} chars)`);
  return b;
}

const clampUses = (asked: number | undefined, max: number) =>
  Math.max(0, Math.min(max, Number.isFinite(asked) ? Math.floor(asked as number) : max));

/** Build the Messages API params for one stage call. */
export function buildParams(body: LlmBody, prompt: string, env: Env) {
  const spec = STAGES[body.stage];
  const model = modelFor(spec, env);
  const v = WEB_TOOLS[webToolVersion(model, env)];
  const tools: Record<string, unknown>[] = spec.tools.map((n) => TOOLS[n]);
  const searches = clampUses(body.maxSearches, spec.maxSearches);
  const fetches = clampUses(body.maxFetches, spec.maxFetches);
  if (searches > 0) tools.push({ type: v.search, name: "web_search", max_uses: searches });
  if (fetches > 0) tools.push({ type: v.fetch, name: "web_fetch", max_uses: fetches, blocked_domains: FETCH_BLOCKED_DOMAINS });

  const messages = spec.agentic
    ? (body.messages as unknown[])
    : [{ role: "user", content: typeof body.input === "string" ? body.input : JSON.stringify(body.input) }];

  const params: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: fillPrompt(prompt, body.vars),
    messages,
    tools,
    // Forced tool_choice 400s on current Sonnet/Opus and would also block web search;
    // each prompt ends by naming its tool and the function nudges once if it's skipped.
    tool_choice: { type: "auto" },
  };
  const effort = env("CF_EFFORT");
  // Haiku 4.5 rejects the effort parameter, so only models that support it get it.
  if (effort && !/haiku/.test(model)) params.output_config = { effort };
  const fallbacks = env("CF_FALLBACKS") ?? "default";
  const betas: string[] = [];
  if (fallbacks && spec.model !== "classify" && !/haiku/.test(model)) {
    params.fallbacks = fallbacks;
    betas.push("server-side-fallback-2026-07-01");
  }
  return { params, betas, spec, model };
}

export type Usage = { input_tokens: number; output_tokens: number; web_search_requests: number; web_fetch_requests: number };
export const zeroUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0 });

export function addUsage(acc: Usage, u: any): Usage {
  acc.input_tokens += (u?.input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0);
  acc.output_tokens += u?.output_tokens ?? 0;
  acc.web_search_requests += u?.server_tool_use?.web_search_requests ?? 0;
  acc.web_fetch_requests += u?.server_tool_use?.web_fetch_requests ?? 0;
  return acc;
}

/** Client tool calls (not server tools) and every URL seen in search results, fetches and citations. */
export function readContent(content: any[]) {
  const toolCalls = content.filter((b) => b?.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
  const sources = new Set<string>();
  for (const b of content) {
    if (b?.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) r?.url && sources.add(r.url);
    if (b?.type === "web_fetch_tool_result" && b.content?.url) sources.add(b.content.url);
    if (Array.isArray(b?.citations)) for (const c of b.citations) c?.url && sources.add(c.url);
  }
  return { toolCalls, sources: [...sources] };
}

/** Sliding one-minute window per key. In-memory: per isolate, good enough to stop a runaway loop. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private perMinute: number) {}
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= this.perMinute) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear();
    return true;
  }
}

export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = (env("CF_ALLOWED_ORIGINS") || "*").split(",").map((s) => s.trim());
  const allow = allowed.includes("*") ? "*" : origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type, x-session, x-cf-token, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

// TypeSafe Jev (System One). https://docs.typesafe.ai — POST /v1/systemone
export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MAX_BATCH = 100;

/** Validate a batch for /jev: [{ state, questions }] with only typed noul/choice/score questions. */
export function parseJevBatch(raw: any): { state: string; questions: Record<string, unknown> }[] {
  const reqs = raw?.requests;
  if (!Array.isArray(reqs) || !reqs.length) throw new HttpError(400, "requests[] required");
  if (reqs.length > JEV_MAX_BATCH) throw new HttpError(413, `at most ${JEV_MAX_BATCH} requests per batch`);
  return reqs.map((r: any) => {
    if (typeof r?.state !== "string" || !r.state.trim() || r.state.length > 8000) throw new HttpError(400, "each request needs a state (max 8000 chars)");
    const qs = r?.questions;
    if (!qs || typeof qs !== "object" || !Object.keys(qs).length || Object.keys(qs).length > 20) throw new HttpError(400, "1–20 questions per request");
    for (const q of Object.values(qs) as any[]) {
      if (!["noul", "choice", "score"].includes(q?.type) || typeof q?.instructions !== "string") throw new HttpError(400, "questions must be noul/choice/score with instructions");
    }
    return { state: r.state, questions: qs };
  });
}

export const CACHE_KEY = /^(company|domain):[a-z0-9.-]{1,200}$/;
export const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

/** DNS-over-HTTPS JSON answer → has a usable MX? Null MX ("0 .", RFC 7505) counts as none. */
export function mxFromDoh(json: any): boolean {
  if (json?.Status !== 0) return false;
  return (json.Answer ?? []).some((a: any) => a?.type === 15 && typeof a.data === "string" && !/^\d+\s+\.?$/.test(a.data.trim()));
}

export function mxFromRecords(records: { exchange: string }[]): boolean {
  return records.some((r) => r.exchange && r.exchange !== "." && r.exchange !== "");
}
