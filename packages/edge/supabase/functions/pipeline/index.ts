// Supabase Edge Function `pipeline` — the only server code in v1 and the only place the
// Anthropic API key exists. Routes: POST /llm, POST /mx, POST /cache, GET /health.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { STAGES, type StageName } from "./_core/schemas.ts";
import { BUNDLED_PROMPTS } from "./_core/prompts.ts";
import {
  CACHE_KEY, DOMAIN, HttpError, JEV_URL, RateLimiter, addUsage, buildParams, corsHeaders, mxFromDoh, mxFromRecords,
  parseBody, parseJevBatch, readContent, zeroUsage, type Env, type LlmBody,
} from "./lib.ts";

const env: Env = (k) => Deno.env.get(k);
const anthropic = new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") });
const perMinute = Number(env("CF_RATE_LIMIT_PER_MIN") ?? 30);
const sessionLimiter = new RateLimiter(perMinute);
const ipLimiter = new RateLimiter(perMinute * 2);

function supabaseAdmin(): SupabaseClient | null {
  const url = env("SUPABASE_URL");
  let key = env("SUPABASE_SERVICE_ROLE_KEY");
  try {
    key ??= JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "{}").default;
  } catch { /* not set */ }
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}
const db = supabaseAdmin();

const promptCache = new Map<string, string>();
async function loadPrompt(name: string): Promise<string> {
  const hit = promptCache.get(name);
  if (hit) return hit;
  let text: string | undefined;
  try {
    text = await Deno.readTextFile(new URL(`./prompts/${name}.md`, import.meta.url));
  } catch {
    text = BUNDLED_PROMPTS[name];
  }
  if (!text) throw new HttpError(500, `prompt ${name}.md missing — run pnpm edge:sync before deploying`);
  promptCache.set(name, text);
  return text;
}

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── /llm ────────────────────────────────────────────────────────────────────

async function create(params: Record<string, unknown>, betas: string[]): Promise<any> {
  if (!betas.length) return anthropic.messages.create(params as any);
  try {
    return await anthropic.beta.messages.create({ ...params, betas } as any);
  } catch (e) {
    // If the fallback beta is rejected (e.g. on another platform), run without it.
    if (e instanceof Anthropic.BadRequestError && /fallback/i.test(e.message)) {
      const { fallbacks: _f, ...rest } = params;
      return anthropic.messages.create(rest as any);
    }
    throw e;
  }
}

async function runLlm(body: LlmBody) {
  const prompt = await loadPrompt(STAGES[body.stage].prompt);
  const { params, betas, spec, model } = buildParams(body, prompt, env);
  const messages = [...(params.messages as any[])];
  const usage = zeroUsage();
  const content: any[] = [];
  let res: any;

  // Server tools can pause a long turn (pause_turn); resend and the API resumes it.
  for (let i = 0; i < 4; i++) {
    res = await create({ ...params, messages }, betas);
    addUsage(usage, res.usage);
    content.push(...res.content);
    if (res.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: res.content });
  }
  if (res.stop_reason === "refusal") throw new HttpError(502, "model declined this request");

  // One nudge if a one-shot stage ended without calling its answer tool.
  let { toolCalls, sources } = readContent(content);
  if (spec.finalTool && !toolCalls.some((c) => c.name === spec.finalTool) && res.stop_reason !== "max_tokens") {
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: `Call the \`${spec.finalTool}\` tool now with your final answer.` });
    res = await create({ ...params, messages }, betas);
    addUsage(usage, res.usage);
    content.push(...res.content);
    ({ toolCalls, sources } = readContent(content));
  }
  return { content, toolCalls, sources, usage, model: res.model ?? model, stop_reason: res.stop_reason };
}

async function logUsage(session: string, ipHash: string, stage: StageName, model: string, u: ReturnType<typeof zeroUsage>) {
  if (!db) return;
  const { error } = await db.from("cf_usage").insert({
    session, ip_hash: ipHash, stage, model,
    input_tokens: u.input_tokens, output_tokens: u.output_tokens,
    searches: u.web_search_requests, fetches: u.web_fetch_requests,
  });
  if (error) console.error("cf_usage insert", error.message);
}

async function underDailyLimit(): Promise<boolean> {
  const limit = Number(env("CF_DAILY_LIMIT") ?? 2000);
  if (!db || !limit) return true;
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error } = await db.from("cf_usage").select("id", { count: "exact", head: true }).gte("created_at", since);
  return error ? true : (count ?? 0) < limit;
}

// ── /mx ─────────────────────────────────────────────────────────────────────

async function hasMx(domain: string): Promise<boolean> {
  try {
    return mxFromRecords(await Deno.resolveDns(domain, "MX"));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return false;
    // resolveDns unavailable or failing in this runtime → DNS-over-HTTPS.
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=MX`, {
      headers: { accept: "application/dns-json" },
    });
    if (!r.ok) throw new HttpError(502, "dns lookup failed");
    return mxFromDoh(await r.json());
  }
}

// ── /cache (domain → patterns only; never names) ────────────────────────────

async function cacheOp(body: any) {
  if (!db) return { value: null };
  const key = String(body?.key ?? "");
  if (!CACHE_KEY.test(key)) throw new HttpError(400, "bad cache key");
  if (body.op === "get") {
    const { data } = await db.from("cf_cache").select("value, expires_at").eq("key", key).maybeSingle();
    return { value: data && new Date(data.expires_at) > new Date() ? data.value : null };
  }
  if (body.op === "set") {
    const raw = JSON.stringify(body.value ?? null);
    if (raw.length > 20_000) throw new HttpError(413, "cache value too large");
    const days = Math.min(90, Math.max(1, Number(body.ttlDays ?? env("CF_CACHE_TTL_DAYS") ?? 30)));
    const { error } = await db.from("cf_cache").upsert({ key, value: body.value, expires_at: new Date(Date.now() + days * 86_400_000).toISOString() });
    if (error) throw new HttpError(500, error.message);
    return { ok: true };
  }
  throw new HttpError(400, "op must be get or set");
}

// ── /jev (TypeSafe Jev decisions; key stays here) ─────────────────────────

async function runJev(body: any) {
  const key = env("TYPESAFE_API_KEY");
  if (!key) throw new HttpError(501, "jev not configured");
  const model = env("CF_JEV_MODEL") || "jev-latest";
  const reqs = parseJevBatch(body);
  const one = async (r: { state: string; questions: Record<string, unknown> }, attempt = 0): Promise<any> => {
    const res = await fetch(env("CF_JEV_URL") || JEV_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model, state: r.state, questions: r.questions }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((ok) => setTimeout(ok, 400 * (attempt + 1)));
      return one(r, attempt + 1);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `jev ${res.status}: ${data?.error?.message ?? data?.error ?? "error"}`);
    return { answers: data.answers ?? {}, usage: data.usage, model: data.model };
  };
  // Small pool so a big batch doesn't trip TypeSafe's rate limit.
  const out: any[] = new Array(reqs.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(10, reqs.length) }, async () => {
    while (next < reqs.length) { const i = next++; out[i] = await one(reqs[i]); }
  }));
  const usage = out.reduce((a, r) => ({ input_tokens: a.input_tokens + (r.usage?.input_tokens ?? 0), output_tokens: a.output_tokens + (r.usage?.output_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0 });
  return { responses: out, usage, model: out[0]?.model ?? model };
}

// ── router ──────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const cors = corsHeaders(req.headers.get("origin"), env);
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const path = new URL(req.url).pathname;
  try {
    if (req.method === "GET" && path.endsWith("/health")) {
      const prompts = await Promise.all(Object.values(STAGES).map((s) => loadPrompt(s.prompt).then(() => s.prompt, () => `${s.prompt} (missing)`)));
      return json({ ok: true, key: !!env("ANTHROPIC_API_KEY"), jev: !!env("TYPESAFE_API_KEY"), db: !!db, prompts });
    }
    if (req.method !== "POST") throw new HttpError(405, "POST only");

    const token = env("CF_ACCESS_TOKEN");
    if (token && req.headers.get("x-cf-token") !== token) throw new HttpError(401, "bad token");

    const session = (req.headers.get("x-session") ?? "anon").slice(0, 64);
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
    if (!sessionLimiter.allow(session) || !ipLimiter.allow(ip)) return json({ error: "rate_limited" }, 429);

    const text = await req.text();
    if (text.length > 1_000_000) throw new HttpError(413, "body too large");
    const body = text ? JSON.parse(text) : {};

    if (path.endsWith("/mx")) {
      const domain = String(body?.domain ?? "").toLowerCase();
      if (!DOMAIN.test(domain)) throw new HttpError(400, "bad domain");
      return json({ ok: await hasMx(domain) });
    }
    if (path.endsWith("/cache")) return json(await cacheOp(body));
    if (path.endsWith("/jev")) {
      if (!(await underDailyLimit())) return json({ error: "daily_limit" }, 429);
      const out = await runJev(body);
      if (db) await db.from("cf_usage").insert({ session, ip_hash: await sha(ip), stage: "jev", model: out.model, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens });
      return json(out);
    }
    if (path.endsWith("/llm")) {
      const parsed = parseBody(body);
      if (!(await underDailyLimit())) return json({ error: "daily_limit" }, 429);
      const out = await runLlm(parsed);
      await logUsage(session, await sha(ip), parsed.stage, out.model, out.usage);
      return json(out);
    }
    throw new HttpError(404, "unknown route");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof SyntaxError) return json({ error: "invalid JSON" }, 400);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "upstream_rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `anthropic ${e.status}: ${e.message}` }, 502);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "internal error" }, 500);
  }
});
