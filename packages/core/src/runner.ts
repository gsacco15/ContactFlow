import type { Company, Contact, Ctx, ExtractResult, Pattern, RunResult, StageResult, ToolCall } from "./types.ts";
import { classifyExtract, contactId } from "./stages/classifyExtract.ts";
import { resolveDomain } from "./stages/resolveDomain.ts";
import { discoverPattern } from "./stages/discoverPattern.ts";
import { findPeople } from "./stages/findPeople.ts";
import { callLlm, findCall } from "./stages/util.ts";
import { generateCandidates } from "./candidates.ts";
import { normalizeName, slug } from "./normalize.ts";
import { cleanUrl, isAggregatorDomain, isBlockedUrl, normalizeDomain, validatePatterns } from "./validate.ts";
import { pMap } from "./pmap.ts";
import { cleanEmail, domainFromPaste, mergePatterns, pastePatterns } from "./paste.ts";
import { needsMiddle } from "./candidates.ts";

export type RunHooks = {
  onExtract?: (ex: ExtractResult) => void;
  onCompany?: (c: Company) => void;
  onRow?: (c: Contact) => void;
};

type DomainCache = { patterns: Pattern[]; mx_ok?: boolean; fetched_at: string };
type CompanyCache = { domain: string; domain_confidence?: number; domain_source_url?: string };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * Fixed pipeline: stage 1 (unless an edited extraction is passed in), then companies
 * in parallel (limit = budget.concurrency) and contacts sequentially within each company.
 * Rows that end not-ok go through the bounded rescue agent once per company.
 */
export async function runPipeline(input: string | ExtractResult, ctx: Ctx, hooks: RunHooks = {}): Promise<RunResult> {
  let ex: ExtractResult;
  if (typeof input === "string") {
    const r = await classifyExtract(input, ctx);
    if (!r.ok || !r.data) throw new Error(r.error ?? "extraction failed");
    ex = r.data;
  } else ex = clone(input);
  hooks.onExtract?.(ex);

  const companies = new Map(ex.companies.map((c) => [c.id, c]));
  addUrlCompanies(ex.urls, companies);

  const people = ex.people.slice(0, ctx.budget.maxContacts);
  const contacts: Contact[] = [];
  const emit = (c: Contact) => {
    contacts.push(c);
    hooks.onRow?.(c);
  };

  for (const c of people.filter((p) => !companies.has(p.company_id))) {
    Object.assign(c, { status: "no_domain", candidates: [], error: "no company found for this person" });
    emit(c);
  }

  await pMap([...companies.values()], ctx.budget.concurrency, async (co) => {
    if (ctx.signal?.aborted) return;
    const own = people.filter((p) => p.company_id === co.id);
    await enrichCompany(co, ctx, own);
    hooks.onCompany?.(co);

    const roleFilter = ctx.options?.roleFilter?.trim() || co.role_hint;
    if (!own.length && roleFilter && co.domain && co.mx_ok !== false) {
      const found = await findPeople(co, roleFilter, ctx);
      if (found.ok && found.data) own.push(...found.data.people.slice(0, Math.max(0, ctx.budget.maxContacts - contacts.length)));
      else if (!found.ok) co.error = `find_people: ${found.error}`;
    }

    for (const c of own) {
      if (ctx.signal?.aborted) return;
      await finishContact(c, co, ctx, hooks);
      emit(c);
    }
  });

  return { extract: ex, companies: [...companies.values()], contacts };
}

/** URL inputs become companies keyed by hostname; LinkedIn and data-vendor URLs are skipped. */
function addUrlCompanies(urls: string[], companies: Map<string, Company>) {
  for (const url of urls) {
    if (isBlockedUrl(url)) continue;
    const domain = normalizeDomain(url)!;
    const existing = [...companies.values()].find((c) => c.domain === domain || normalizeDomain(c.website) === domain);
    if (existing) {
      existing.website ??= url;
      continue;
    }
    const id = slug(domain);
    companies.set(id, { id, name: domain, website: url, patterns: [] });
  }
}

/** Stages 2, 3 and MX for one company, read-through the per-company and per-domain caches. */
export async function enrichCompany(co: Company, ctx: Ctx, people: Contact[] = []): Promise<void> {
  const bypass = !!ctx.options?.bypassCache;
  const ttl = ctx.budget.cacheTtlDays;
  delete co.error;
  let used = 0;

  const usePaste = ctx.options?.usePasteEvidence !== false;
  const fromInput = normalizeDomain(co.website);
  const fromPaste = usePaste && !fromInput ? domainFromPaste(co, people) : undefined;
  delete co.domain_from_paste;
  if (fromInput && !isAggregatorDomain(fromInput)) {
    co.domain = fromInput;
    co.domain_confidence = 1;
    co.domain_source_url = cleanUrl(co.website) ?? `https://${fromInput}`;
  } else if (fromPaste) {
    // A work email pasted next to someone at this company — no search needed, not cached (user data).
    co.domain = fromPaste;
    co.domain_confidence = 0.9;
    co.domain_from_paste = true;
    delete co.domain_source_url;
  } else {
    const cached: CompanyCache | undefined = bypass ? undefined : await ctx.cache.get(`company:${co.id}`);
    if (cached?.domain) Object.assign(co, cached);
    else {
      const hint = [...new Set(people.map((p) => p.title).filter(Boolean))].slice(0, 3).join("; ");
      const d = await resolveDomain({ name: co.name, hint }, ctx, { maxSearches: Math.min(2, ctx.budget.maxSearchesPerCompany) });
      used += d.searches_used;
      if (!d.ok || !d.data) co.error = `resolve_domain: ${d.error}`;
      else if (d.data.domain) {
        co.domain = d.data.domain;
        co.domain_confidence = d.data.confidence;
        co.domain_source_url = d.data.source_url;
        await ctx.cache.set(`company:${co.id}`, { domain: co.domain, domain_confidence: co.domain_confidence, domain_source_url: co.domain_source_url } satisfies CompanyCache, ttl);
      } else delete co.domain;
    }
  }
  if (!co.domain) return;

  const cached: DomainCache | undefined = bypass ? undefined : await ctx.cache.get(`domain:${co.domain}`);
  // Emails/formats from the paste beat a search: skip discover_pattern, and keep them out of the shared cache.
  const paste = usePaste ? pastePatterns(co, people) : [];
  delete co.pattern_conflict;
  if (paste.length) {
    const merged = mergePatterns(paste, cached?.patterns ?? []);
    co.patterns = merged.patterns;
    if (merged.conflict) co.pattern_conflict = merged.conflict;
    co.mx_ok = cached ? cached.mx_ok : ctx.verifier?.domainLive ? await ctx.verifier.domainLive(co.domain) : undefined;
    co.fetched_at = new Date().toISOString();
    return;
  }
  if (cached) {
    co.patterns = cached.patterns;
    co.mx_ok = cached.mx_ok;
    co.fetched_at = cached.fetched_at;
    return;
  }
  const maxSearches = Math.max(1, Math.min(2, ctx.budget.maxSearchesPerCompany - used));
  const p = await discoverPattern(co.domain, ctx, { maxSearches });
  if (p.ok && p.data) co.patterns = p.data.patterns;
  else co.error = `discover_pattern: ${p.error}`;
  co.mx_ok = ctx.verifier?.domainLive ? await ctx.verifier.domainLive(co.domain) : undefined;
  co.fetched_at = new Date().toISOString();
  if (p.ok && co.mx_ok !== undefined) {
    await ctx.cache.set(`domain:${co.domain}`, { patterns: co.patterns, mx_ok: co.mx_ok, fetched_at: co.fetched_at } satisfies DomainCache, ttl);
  } else if (p.ok && !ctx.verifier) {
    await ctx.cache.set(`domain:${co.domain}`, { patterns: co.patterns, fetched_at: co.fetched_at } satisfies DomainCache, ttl);
  }
}

/** Stage 4 (+ stage 5 statuses) for one contact given its company's current state. */
export async function applyCompany(c: Contact, co: Company | undefined, ctx: Ctx): Promise<void> {
  delete c.error;
  delete c.note;
  delete c.primary_email;
  c.candidates = [];
  if (!co) return void Object.assign(c, { status: "no_domain", error: "no company found for this person" });
  if (!co.domain) {
    c.status = co.error ? "error" : "no_domain";
    if (co.error) c.error = co.error;
    return;
  }
  if (co.mx_ok === false) {
    c.status = "no_domain";
    c.error = `${co.domain} has no MX records`;
    return;
  }
  const name = normalizeName([c.first, c.middle, c.last].filter(Boolean).join(" "));
  if (!name.first) {
    c.status = "error";
    c.error = "could not parse a name";
    return;
  }
  if (/^\p{L}\.$/u.test(c.last.trim())) {
    // "Maria O." — LinkedIn hides the surname; any guess would be junk.
    c.status = "error";
    c.error = INCOMPLETE_LAST;
    return;
  }
  c.candidates = generateCandidates(name, co.domain, co.patterns, { nicknames: ctx.options?.nicknames });
  // The person's own pasted work address goes first.
  const own = ctx.options?.usePasteEvidence !== false ? cleanEmail(c.email) : undefined;
  if (own?.endsWith(`@${co.domain}`)) {
    const rest = c.candidates.filter((x) => x.email !== own);
    c.candidates = [{ email: own, pattern: "pasted", rank: 1, verify_status: "unverified" as const }, ...rest]
      .slice(0, 3)
      .map((x, i) => ({ ...x, rank: (i + 1) as 1 | 2 | 3 }));
  }
  if (co.patterns[0] && needsMiddle(co.patterns[0].template) && !name.middle && !own) {
    c.note = "Top pattern uses a middle initial — add it to the name to get that address.";
  }
  if (co.rescued) c.rescued = true;
  if (ctx.verifier && c.candidates.length) {
    const st = await ctx.verifier.verify(c.candidates.map((x) => x.email));
    for (const x of c.candidates) x.verify_status = st[x.email] ?? "unverified";
  }
  c.primary_email = (c.candidates.find((x) => x.verify_status === "valid") ?? c.candidates[0])?.email;
  if (co.patterns.length) c.status = "ok";
  else if (co.error) {
    c.status = "error";
    c.error = co.error;
  } else c.status = "no_pattern";
}

const INCOMPLETE_LAST = "Last name is incomplete (e.g. “Maria O.”) — click the name to fill it in.";

// One rescue per company per run: the fix is company-level (domain, patterns).
const rescues = new WeakMap<Company, Promise<StageResult<RescueFix>>>();

async function finishContact(c: Contact, co: Company, ctx: Ctx, hooks: RunHooks) {
  await applyCompany(c, co, ctx);
  if (!(await shouldRescue(c, co, ctx))) return;
  let pending = rescues.get(co);
  if (!pending) {
    pending = runRescue(c, co, ctx).then(async (r) => {
      if (r.ok && r.data) await applyFix(co, r.data, ctx);
      else co.rescue_note = `rescue gave up: ${r.error}`;
      hooks.onCompany?.(co);
      return r;
    });
    rescues.set(co, pending);
  }
  const r = await pending;
  if (r.ok) {
    await applyCompany(c, co, ctx);
    c.rescued = true;
  }
}

/** Gate: v1 is status-only; a calibrated provider (v2) also catches rows that are ok but wrong. */
export async function shouldRescue(c: Contact, co: Company, ctx: Ctx): Promise<boolean> {
  if (ctx.options?.rescue === false || c.error === INCOMPLETE_LAST) return false;
  if (c.status !== "ok") return c.status !== "pending" && !!co.name;
  if (!ctx.decisions.calibrated) return false;
  const p = await ctx.decisions.score(
    JSON.stringify({ company: { name: co.name, domain: co.domain, patterns: co.patterns }, contact: { first: c.first, last: c.last, title: c.title } }),
    "Is this domain and pattern correct given the evidence?",
  );
  return p < ctx.budget.rescueThreshold;
}

export type RescueFix = { domain?: string; domain_source_url?: string; patterns?: Pattern[]; note?: string };

async function applyFix(co: Company, fix: RescueFix, ctx: Ctx) {
  if (fix.domain && fix.domain !== co.domain) {
    co.domain = fix.domain;
    co.domain_source_url = fix.domain_source_url;
    co.domain_confidence = 0.7;
    co.mx_ok = ctx.verifier?.domainLive ? await ctx.verifier.domainLive(fix.domain) : undefined;
    if (!fix.patterns?.length) co.patterns = [];
  }
  if (fix.patterns?.length) co.patterns = fix.patterns;
  delete co.error;
  co.rescued = true;
  co.rescue_note = fix.note ?? "repaired by rescue agent";
  if (co.domain && co.patterns.length) {
    const ttl = ctx.budget.cacheTtlDays;
    await ctx.cache.set(`company:${co.id}`, { domain: co.domain, domain_confidence: co.domain_confidence, domain_source_url: co.domain_source_url } satisfies CompanyCache, ttl);
    await ctx.cache.set(`domain:${co.domain}`, { patterns: co.patterns, mx_ok: co.mx_ok, fetched_at: new Date().toISOString() } satisfies DomainCache, ttl);
  }
}

/**
 * Bounded tool-use loop for one failed row. Tools are the stage functions plus the
 * server-side web tools; ends on `finish` or when the budget is spent.
 */
export async function runRescue(c: Contact, co: Company, ctx: Ctx): Promise<StageResult<RescueFix>> {
  const brief = {
    status: c.status,
    error: c.error ?? co.error ?? null,
    contact: { first: c.first, last: c.last, title: c.title ?? null },
    company: { name: co.name, website: co.website ?? null, domain: co.domain ?? null, domain_source_url: co.domain_source_url ?? null },
    tried: { patterns_found: co.patterns, mx_ok: co.mx_ok ?? null },
  };
  const messages: any[] = [{ role: "user", content: JSON.stringify(brief) }];
  let tokens = 0;
  let searches = 0;
  let toolCalls = 0;
  const sources = new Set<string>();
  const budget = ctx.budget.maxRescueCalls;
  const result = (r: Omit<StageResult<RescueFix>, "tokens_used" | "searches_used" | "sources">): StageResult<RescueFix> => ({
    ...r,
    sources: [...sources],
    tokens_used: tokens,
    searches_used: searches,
  });

  for (let turn = 0; turn < budget; turn++) {
    const { res, error } = await callLlm(ctx, { stage: "rescue_agent", messages, maxSearches: 2, maxFetches: 2 });
    if (!res) return result({ ok: false, error: error ?? "llm error" });
    tokens += res.usage.input_tokens + res.usage.output_tokens;
    searches += res.usage.web_search_requests;
    res.sources.forEach((s) => sources.add(s));

    const finish = findCall(res, "finish");
    if (finish) return result(parseFinish(finish.input));
    if (!res.toolCalls.length) return result({ ok: false, error: "agent stopped without calling finish" });

    messages.push({ role: "assistant", content: res.content });
    const outputs = await Promise.all(
      res.toolCalls.map(async (call) => {
        toolCalls++;
        const out = toolCalls > budget ? { error: "tool budget spent — call finish now" } : await runTool(call, co, ctx);
        if (out && typeof out === "object" && "sources" in out) (out.sources as string[]).forEach((s) => sources.add(s));
        return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) };
      }),
    );
    const content: any[] = outputs;
    if (turn === budget - 2) content.push({ type: "text", text: "One turn left: call finish now with what you have, or gave_up." });
    else if (ctx.decisions.calibrated) {
      const good = await ctx.decisions.score(JSON.stringify(outputs), "Is this row now good enough to stop?");
      if (good > 0.8) content.push({ type: "text", text: "That looks sufficient. Call finish now." });
    }
    messages.push({ role: "user", content });
  }
  return result({ ok: false, error: "rescue budget exhausted" });
}

async function runTool(call: ToolCall, co: Company, ctx: Ctx): Promise<unknown> {
  const i = call.input ?? {};
  switch (call.name) {
    case "find_domain": {
      const r = await resolveDomain({ name: String(i.company_name ?? co.name), hint: i.hint }, ctx, { maxSearches: 2 });
      return r.ok ? { ...r.data, sources: r.sources } : { error: r.error };
    }
    case "find_email_pattern": {
      const domain = normalizeDomain(i.domain);
      if (!domain) return { error: "invalid domain" };
      const r = await discoverPattern(domain, ctx, { maxSearches: 1 });
      return r.ok ? { domain, ...r.data, sources: r.sources } : { error: r.error };
    }
    case "find_people": {
      const domain = normalizeDomain(i.domain);
      if (!domain) return { error: "invalid domain" };
      const r = await findPeople({ ...co, domain, website: undefined, name: String(i.company_name ?? co.name) }, String(i.role_filter ?? ""), ctx, { maxSearches: 1, maxFetches: 2 });
      return r.ok
        ? { people: r.data!.people.slice(0, 15).map((p) => ({ first: p.first, last: p.last, title: p.title })), sources: r.sources }
        : { error: r.error };
    }
    default:
      return { error: `unknown tool ${call.name}` };
  }
}

/** finish → a repaired company fix, or a failure with the agent's reason. Never trusts unsourced values. */
export function parseFinish(input: any): Omit<StageResult<RescueFix>, "tokens_used" | "searches_used" | "sources"> {
  if (input?.gave_up) return { ok: false, error: String(input.reason ?? "gave up") };
  const fix: RescueFix = {};
  const domain = normalizeDomain(input?.domain);
  if (domain && !isAggregatorDomain(domain)) {
    fix.domain = domain;
    fix.domain_source_url = cleanUrl(input?.domain_source_url);
  }
  const patterns = validatePatterns(input?.patterns, domain ?? undefined).filter((p) => p.source_url);
  if (patterns.length) fix.patterns = patterns;
  if (typeof input?.reason === "string") fix.note = input.reason;
  if (!fix.domain && !fix.patterns) return { ok: false, error: String(input?.reason ?? "finish returned nothing usable") };
  return { ok: true, data: fix };
}

/** Retry button: rerun stages 2–4 for one company (cache bypassed), then rescue if still failing. */
export async function rerunCompany(co: Company, contacts: Contact[], ctx: Ctx, hooks: RunHooks = {}): Promise<void> {
  const fresh: Ctx = { ...ctx, options: { ...ctx.options, bypassCache: true } };
  if (!normalizeDomain(co.website)) {
    delete co.domain;
    delete co.domain_source_url;
    delete co.domain_confidence;
  }
  co.patterns = [];
  delete co.mx_ok;
  delete co.rescue_note;
  delete co.rescued;
  rescues.delete(co);
  await enrichCompany(co, fresh, contacts);
  hooks.onCompany?.(co);
  const roleFilter = ctx.options?.roleFilter?.trim() || co.role_hint;
  if (!contacts.length && roleFilter && co.domain && co.mx_ok !== false) {
    const found = await findPeople(co, roleFilter, fresh);
    if (found.ok && found.data) contacts.push(...found.data.people);
    else if (!found.ok) co.error = `find_people: ${found.error}`;
    hooks.onCompany?.(co);
  }
  for (const c of contacts) {
    c.status = "pending";
    delete c.rescued;
    await finishContact(c, co, fresh, hooks);
    hooks.onRow?.(c);
  }
}

export { contactId };
