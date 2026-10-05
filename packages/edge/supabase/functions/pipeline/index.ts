// Supabase Edge Function `pipeline` — the only server code in v1 and the only place the
// Anthropic API key exists. Routes: POST /llm, /mx, /cache, /site, /shadow, /evidence, /verify, /jev; GET /health.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { STAGES, type StageName } from "./_core/schemas.ts";
import { BUNDLED_PROMPTS } from "./_core/prompts.ts";
import { FREE_TIER, PRICE_PER_VERIFY, estimateCost } from "./_core/pricing.ts";
import {
  CACHE_KEY, DOMAIN, FETCH_BLOCKED_DOMAINS, evidenceRow, type EvidenceRow, VERIFY_PROVIDERS, mockVerify, parseVerifyBody, type VerifyStatusWire, HttpError, JEV_URL, bioLinks, extractEmails, pickLinks, slugName, robotsAllows, sameSite, sitemapLinks, type SiteEmail, RateLimiter, addUsage, buildParams, corsHeaders, mxFromDoh, mxFromRecords,
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

/** A visitor's own Claude key (header x-anthropic-key): used for that request only, never stored or logged. */
function ownKeyClient(req: Request): Anthropic | null {
  const key = req.headers.get("x-anthropic-key")?.trim();
  return key && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key) ? new Anthropic({ apiKey: key }) : null;
}

async function create(params: Record<string, unknown>, betas: string[], client: Anthropic = anthropic): Promise<any> {
  const anthropic = client;
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

async function runLlm(body: LlmBody, client: Anthropic = anthropic) {
  const prompt = await loadPrompt(STAGES[body.stage].prompt);
  const { params, betas, spec, model } = buildParams(body, prompt, env);
  const messages = [...(params.messages as any[])];
  const usage = zeroUsage();
  const content: any[] = [];
  let res: any;

  // Server tools can pause a long turn (pause_turn); resend and the API resumes it.
  for (let i = 0; i < 4; i++) {
    res = await create({ ...params, messages }, betas, client);
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
    res = await create({ ...params, messages }, betas, client);
    addUsage(usage, res.usage);
    content.push(...res.content);
    ({ toolCalls, sources } = readContent(content));
  }
  return { content, toolCalls, sources, usage, model: res.model ?? model, stop_reason: res.stop_reason };
}

async function logUsage(session: string, ipHash: string, stage: StageName, model: string, u: ReturnType<typeof zeroUsage>, byok = false) {
  if (!db) return;
  const cost_usd = estimateCost({ model, ...u });
  const { error } = await db.from("cf_usage").insert({
    session, ip_hash: ipHash, stage, model, cost_usd, byok,
    input_tokens: u.input_tokens, output_tokens: u.output_tokens,
    searches: u.web_search_requests, fetches: u.web_fetch_requests,
    cache_read_tokens: u.cache_read_input_tokens, cache_write_tokens: u.cache_creation_input_tokens,
  });
  if (error) console.error("cf_usage insert", error.message);
}

/**
 * Free tier, in dollars of real spend since 00:00 UTC (cf_usage.cost_usd): the whole site
 * (CF_DAILY_BUDGET_USD) and, if set above 0, each visitor by hashed IP (CF_FREE_PER_VISITOR_USD).
 * Visitors with their own Claude key skip the per-visitor cap. ChatGPT calls share one IP, so only the site cap applies.
 * Returns the error code to send, or null when the request may go ahead. Fails open if the DB errs.
 */
async function overBudget(ipHash: string, opts: { ownKey: boolean; session: string }): Promise<"daily_budget" | "free_limit" | null> {
  if (!db) return null;
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const daily = Number(env("CF_DAILY_BUDGET_USD") ?? FREE_TIER.dailyUsd);
  const site = await db.rpc("cf_spend", { since });
  if (!site.error && Number(site.data) >= daily) return "daily_budget";
  if (opts.ownKey || opts.session.startsWith("mcp-")) return null;
  const perVisitor = Number(env("CF_FREE_PER_VISITOR_USD") ?? FREE_TIER.perVisitorUsd);
  if (!(perVisitor > 0)) return null; // no per-visitor ceiling
  const mine = await db.rpc("cf_spend", { since, ip: ipHash });
  return !mine.error && Number(mine.data) >= perVisitor ? "free_limit" : null;
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

// ── /site (read a company's own public pages for real addresses; no AI, no cost) ──

const SITE_UA = "ContactFlowBot/1.0 (+https://contact-flow-web.vercel.app/#how)";
const PAGE_BYTES = 1_500_000;

async function getText(url: string, ms = 5000): Promise<{ ok: boolean; url: string; text: string; type: string }> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": SITE_UA, accept: "text/html,application/xml;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: ctl.signal });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !/html|xml|text\/plain/i.test(type)) return { ok: false, url: r.url || url, text: "", type };
    const reader = r.body?.getReader();
    let text = "";
    if (reader) {
      const dec = new TextDecoder();
      for (let size = 0; size < PAGE_BYTES; ) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        text += dec.decode(value, { stream: true });
      }
      reader.cancel().catch(() => {});
    }
    return { ok: true, url: r.url || url, text, type };
  } catch {
    return { ok: false, url, text: "", type: "" };
  } finally {
    clearTimeout(t);
  }
}

async function readSite(domain: string, maxPages: number, bioPages: number) {
  if (FETCH_BLOCKED_DOMAINS.some((b) => sameSite(domain, b))) return { emails: [], pages: [], note: "blocked domain" };
  let home = await getText(`https://${domain}/`);
  if (!home.ok) home = await getText(`https://www.${domain}/`);
  if (!home.ok || !sameSite(new URL(home.url).hostname, domain)) return { emails: [], pages: [], note: "homepage unavailable" };
  if (/cf-browser-verification|challenge-platform|captcha/i.test(home.text.slice(0, 20000))) return { emails: [], pages: [], note: "bot check" };
  const origin = new URL(home.url).origin;
  const robots = await getText(`${origin}/robots.txt`, 3000);
  const allowed = (u: string) => !robots.ok || robotsAllows(robots.text, new URL(u).pathname);
  if (!allowed(home.url)) return { emails: [], pages: [], note: "robots.txt disallows" };

  const emails = new Map<string, SiteEmail>();
  const add = (list: SiteEmail[]) => list.forEach((e) => emails.has(e.email) || emails.set(e.email, e));
  const pages = [home.url];
  add(extractEmails(home.text, domain, home.url));

  const sitemap = await getText(`${origin}/sitemap.xml`, 3000);
  const queue = [...new Set([...pickLinks(home.text, home.url, domain), ...(sitemap.ok ? sitemapLinks(sitemap.text, domain) : [])])];
  for (const fallback of ["/contact", "/about", "/team"]) if (queue.length < 3) queue.push(origin + fallback);

  const bios: string[] = [];
  for (const url of queue) {
    if (pages.length >= maxPages) break;
    if (!allowed(url)) continue;
    const page = await getText(url);
    if (!page.ok || !sameSite(new URL(page.url).hostname, domain)) continue;
    pages.push(page.url);
    add(extractEmails(page.text, domain, page.url));
    for (const b of bioLinks(page.text, page.url, domain, bioPages)) if (!bios.includes(b) && !pages.includes(b)) bios.push(b);
  }
  // Bio pages, a few in parallel: the address is usually there, and the URL names the person.
  const picked = bios.filter(allowed).slice(0, bioPages);
  const read = await Promise.all(picked.map((u) => getText(u)));
  for (const page of read) {
    if (!page.ok || !sameSite(new URL(page.url).hostname, domain)) continue;
    pages.push(page.url);
    const who = slugName(page.url);
    add(extractEmails(page.text, domain, page.url).map((e) => (who ? { ...e, context: `${who} · ${e.context}` } : e)));
  }
  return { emails: [...emails.values()].slice(0, 60), pages };
}

// ── /verify (mailbox checks through CF_VERIFIER; the key never leaves this function) ──

async function runVerify(emails: string[]): Promise<{ provider: string; real: boolean; results: Record<string, VerifyStatusWire>; details: string[]; providerDown?: boolean }> {
  const provider = (env("CF_VERIFIER") ?? "").toLowerCase();
  if (!provider) throw new HttpError(501, "verification not set up (CF_VERIFIER)");
  if (provider === "mock") return { provider, real: false, results: Object.fromEntries(emails.map((e) => [e, mockVerify(e)])), details: [] };
  const adapter = VERIFY_PROVIDERS[provider];
  const key = env("CF_VERIFIER_KEY");
  if (!adapter || !key) throw new HttpError(501, `verification provider "${provider}" not configured`);
  const results: Record<string, VerifyStatusWire> = {};
  const details: string[] = [];
  // One call; a provider-side error ("error: …", http 5xx, network) gets one retry with a longer timeout.
  const call = async (email: string, attempt: number): Promise<{ status: VerifyStatusWire; detail: string }> => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 40_000);
    try {
      const r = await fetch(adapter.url(email, key, attempt), { signal: ctl.signal });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { status: adapter.read(j), detail: adapter.detail(j) } : { status: "unverified", detail: `http ${r.status}` };
    } catch (e) {
      return { status: "unverified", detail: ctl.signal.aborted ? "timed out" : `fetch failed: ${String((e as Error)?.message ?? e).slice(0, 60)}` };
    } finally {
      clearTimeout(t);
    }
  };
  const failed = (d: string) => /^(error|http|fetch|timed out)/.test(d);
  for (const email of emails) {
    let a = await call(email, 0);
    if (failed(a.detail)) {
      await new Promise((ok) => setTimeout(ok, 800));
      const b = await call(email, 1);
      a = { status: b.status, detail: failed(b.detail) ? `${a.detail} → retry ${b.detail}` : b.detail };
    }
    results[email] = a.status;
    details.push(a.detail);
  }
  if (details.some(failed)) console.error("verify provider:", provider, details.join(" | "));
  const providerDown = details.every(failed);
  return { provider, real: true, results, details, providerDown };
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
    const byokClient = ownKeyClient(req);
    const ownKey = !!byokClient;
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
    if (path.endsWith("/site")) {
      const domain = String(body?.domain ?? "").toLowerCase();
      if (!DOMAIN.test(domain)) throw new HttpError(400, "bad domain");
      return json(await readSite(domain, Math.min(8, Math.max(1, Number(body?.maxPages ?? 6))), Math.min(6, Math.max(0, Number(body?.bioPages ?? 4)))));
    }
    if (path.endsWith("/shadow")) {
      // Site-reading trial log: domain-level formats and counts only — never names or addresses.
      const r = body ?? {};
      const domain = String(r.domain ?? "").toLowerCase();
      if (!DOMAIN.test(domain)) throw new HttpError(400, "bad domain");
      const tpl = (x: unknown) => (typeof x === "string" && /^[{}a-z._-]{3,24}$/.test(x) ? x : null);
      if (db) {
        const { error } = await db.from("cf_site_shadow").insert({
          domain,
          site_template: tpl(r.site_template),
          site_matches: Math.max(0, Math.min(100, Number(r.site_matches) || 0)),
          site_pages: Math.max(0, Math.min(20, Number(r.site_pages) || 0)),
          search_template: tpl(r.search_template),
          search_confidence: Number.isFinite(Number(r.search_confidence)) ? Number(r.search_confidence) : null,
          agree: typeof r.agree === "boolean" ? r.agree : null,
        });
        if (error) console.error("cf_site_shadow insert", error.message);
      }
      return json({ ok: true });
    }
    if (path.endsWith("/evidence")) {
      // Evidence engine: domain-level format facts (never names or addresses).
      if (!db) return json(body?.op === "get" ? { rows: [] } : { ok: true, stored: 0 });
      if (body?.op === "record") {
        const raw: unknown[] = Array.isArray(body.rows) ? body.rows.slice(0, 50) : [];
        const rows = raw.map(evidenceRow).filter((r): r is EvidenceRow => !!r);
        if (!rows.length) return json({ ok: true, stored: 0 });
        const days = Math.min(730, Math.max(30, Number(env("CF_EVIDENCE_TTL_DAYS") ?? 365)));
        const expires_at = new Date(Date.now() + days * 86_400_000).toISOString();
        const { error } = await db.from("cf_domain_evidence").insert(rows.map((r) => ({ ...r, expires_at })));
        if (error) throw new HttpError(500, error.message);
        return json({ ok: true, stored: rows.length });
      }
      if (body?.op === "get") {
        const domain = String(body.domain ?? "").toLowerCase();
        if (!DOMAIN.test(domain)) throw new HttpError(400, "bad domain");
        const { data, error } = await db
          .from("cf_domain_evidence")
          .select("domain, kind, template, outcome, strength, count, source_url, source_name, observed_at")
          .eq("domain", domain)
          .gt("expires_at", new Date().toISOString())
          .order("observed_at", { ascending: false })
          .limit(200);
        if (error) throw new HttpError(500, error.message);
        return json({ rows: data ?? [] });
      }
      throw new HttpError(400, "op must be record or get");
    }
    if (path.endsWith("/verify")) {
      const emails = parseVerifyBody(body);
      const ipHash = await sha(ip);
      const over = await overBudget(ipHash, { ownKey, session });
      if (over) return json({ error: over }, 429);
      const out = await runVerify(emails);
      // Provider errors aren't charged, so they're logged with 0 verifications. Checks always use our credits.
      const verifications = out.providerDown ? 0 : emails.length;
      if (db && out.real) await db.from("cf_usage").insert({ session, ip_hash: ipHash, stage: "verify", model: `verifier:${out.provider}`, input_tokens: 0, output_tokens: 0, verifications, cost_usd: verifications * PRICE_PER_VERIFY, verify_detail: out.details.join(", ").slice(0, 300) });
      if (out.providerDown) return json({ error: `verifier unavailable: ${out.details[0]}`.slice(0, 200) }, 502);
      return json(out);
    }
    if (path.endsWith("/jev")) {
      const ipHash = await sha(ip);
      const over = await overBudget(ipHash, { ownKey, session });
      if (over) return json({ error: over }, 429);
      const out = await runJev(body);
      const cost_usd = estimateCost({ model: out.model, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, web_search_requests: 0 });
      if (db) await db.from("cf_usage").insert({ session, ip_hash: ipHash, stage: "jev", model: out.model, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens, cost_usd });
      return json(out);
    }
    if (path.endsWith("/llm")) {
      const parsed = parseBody(body);
      const ipHash = await sha(ip);
      // With their own key, the visitor pays Anthropic directly: no cap applies to this call.
      if (!byokClient) {
        const over = await overBudget(ipHash, { ownKey, session });
        if (over) return json({ error: over }, 429);
      }
      const out = await runLlm(parsed, byokClient ?? anthropic);
      await logUsage(session, ipHash, parsed.stage, out.model, out.usage, !!byokClient);
      return json(out);
    }
    throw new HttpError(404, "unknown route");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    if (e instanceof SyntaxError) return json({ error: "invalid JSON" }, 400);
    if (e instanceof Anthropic.AuthenticationError && req.headers.get("x-anthropic-key")) return json({ error: "own_key_rejected" }, 401);
    if (e instanceof Anthropic.RateLimitError) return json({ error: "upstream_rate_limited" }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `anthropic ${e.status}: ${e.message}` }, 502);
    console.error(e);
    return json({ error: e instanceof Error ? e.message : "internal error" }, 500);
  }
});
