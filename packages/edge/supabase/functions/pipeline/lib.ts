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

  // Prompt caching (CF_CACHE_STAGES, comma list; "" turns it off). The breakpoint on the system
  // block caches tools + system; agentic stages also cache their growing history. Off by default
  // on web-search stages: there the API also caches search results at the write premium.
  const cacheStages = (env("CF_CACHE_STAGES") ?? "classify_extract,rescue_agent").split(",").map((x) => x.trim());
  const cache = cacheStages.includes(body.stage);
  const system = fillPrompt(prompt, body.vars);

  const params: Record<string, unknown> = {
    model,
    max_tokens: 16000,
    system: cache ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
    messages,
    tools,
    // Forced tool_choice 400s on current Sonnet/Opus and would also block web search;
    // each prompt ends by naming its tool and the function nudges once if it's skipped.
    tool_choice: { type: "auto" },
  };
  if (cache && spec.agentic) params.cache_control = { type: "ephemeral" };
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

export type Usage = {
  input_tokens: number; // uncached input
  output_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};
export const zeroUsage = (): Usage => ({ input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });

/** Cache reads and writes are kept apart from plain input so the cost estimate can price them. */
export function addUsage(acc: Usage, u: any): Usage {
  acc.input_tokens += u?.input_tokens ?? 0;
  acc.cache_read_input_tokens += u?.cache_read_input_tokens ?? 0;
  acc.cache_creation_input_tokens += u?.cache_creation_input_tokens ?? 0;
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

// ── Site reading (plain HTTP, no AI): find real @domain addresses on a company's own pages ──

/** Link text / path words that point at people or contact pages, in any industry. */
const PEOPLE_WORDS = /team|people|staff|about|leadership|management|our-?firm|who-?we-?are|attorneys?|lawyers?|professionals|partners|contact|directory|bios?|experts|advisors|doctors|physicians|providers|agents|brokers|press|news|media/i;
const SKIP_EXT = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js)(\?|$)/i;

/** Hostname belongs to the company: the domain itself or a subdomain of it. */
export function sameSite(host: string, domain: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === domain || h.endsWith(`.${domain}`);
}

/** Internal links on a page that look like team/contact pages, best first, de-duplicated. */
export function pickLinks(html: string, pageUrl: string, domain: string, max = 8): string[] {
  const out: { url: string; score: number }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let u: URL;
    try {
      u = new URL(m[1].trim(), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u.hostname, domain) || SKIP_EXT.test(u.pathname)) continue;
    const key = u.origin + u.pathname.replace(/\/+$/, "");
    if (seen.has(key) || key === new URL(pageUrl).origin) continue;
    const text = m[2].replace(/<[^>]+>/g, " ");
    const score = (PEOPLE_WORDS.test(u.pathname) ? 2 : 0) + (PEOPLE_WORDS.test(text) ? 1 : 0);
    if (!score) continue;
    seen.add(key);
    out.push({ url: key, score });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max).map((x) => x.url);
}

/** Page URLs from a sitemap.xml that look like team/contact/bio pages. */
export function sitemapLinks(xml: string, domain: string, max = 8): string[] {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  return urls
    .filter((x) => {
      try {
        const u = new URL(x);
        return sameSite(u.hostname, domain) && PEOPLE_WORDS.test(u.pathname) && !SKIP_EXT.test(u.pathname);
      } catch {
        return false;
      }
    })
    .slice(0, max);
}

/** Minimal robots.txt check for the "*" group (and ours): is this path disallowed? */
export function robotsAllows(robots: string, path: string, agent = "contactflow"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; path: string }[] }[] = [];
  let cur: (typeof groups)[number] | undefined;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const m = /^(user-agent|allow|disallow)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (/user-agent/i.test(k)) {
      if (!cur || cur.rules.length) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(v.toLowerCase());
    } else if (cur) cur.rules.push({ allow: /^allow$/i.test(k), path: v });
  }
  const group = groups.find((g) => g.agents.some((a) => a && agent.includes(a))) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; path: string } | undefined;
  for (const r of group.rules) {
    if (!r.path) continue;
    if (path.startsWith(r.path) && (!best || r.path.length > best.path.length)) best = r;
  }
  return best ? best.allow : true;
}

/** Visible text of a page (enough for finding names next to addresses). */
export function pageText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|td|tr|span|a)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#64;|&commat;/g, "@")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n");
}

export type SiteEmail = { email: string; context: string; page: string };

/**
 * Addresses at the company's domain on one page, with ~160 characters of surrounding text for
 * name matching. Reads mailto: links, plain text, and "name [at] firm [dot] com" styles.
 */
export function extractEmails(html: string, domain: string, page: string): SiteEmail[] {
  const text = pageText(html);
  const deob = text
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/gi, "@")
    .replace(/\s+at\s+(?=[a-z0-9-]+\s*[\[(]\s*dot\s*[\])])/gi, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/gi, ".");
  const found = new Map<string, SiteEmail>();
  const add = (email: string, ctx: string) => {
    const e = email.toLowerCase().replace(/^mailto:/, "").replace(/[.,;:]+$/, "");
    const d = e.split("@")[1];
    if (!d || !sameSite(d, domain) || found.has(e)) return;
    found.set(e, { email: e, context: ctx.replace(/\s+/g, " ").trim().slice(0, 320), page });
  };
  for (const m of html.matchAll(/mailto:([^"'?\s>]+@[^"'?\s>]+)/gi)) {
    const at = text.toLowerCase().indexOf(m[1].toLowerCase());
    // Name for a mailto link: the text around it on the page, or the link's own markup.
    const around = at >= 0 ? text.slice(Math.max(0, at - 160), at + m[1].length + 80) : html.slice(Math.max(0, m.index! - 300), m.index! + 200).replace(/<[^>]+>/g, " ");
    let addr = m[1];
    try {
      addr = decodeURIComponent(addr);
    } catch { /* malformed %-escape: use as written */ }
    add(addr, around);
  }
  for (const m of deob.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
    add(m[0], deob.slice(Math.max(0, m.index! - 160), m.index! + m[0].length + 80));
  }
  return [...found.values()];
}
