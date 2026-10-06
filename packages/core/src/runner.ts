import type { Company, Contact, Ctx, ExtractResult, Pattern, RunResult, StageResult, ToolCall } from "./types.ts";
import { classifyExtract, contactId } from "./stages/classifyExtract.ts";
import { resolveDomain } from "./stages/resolveDomain.ts";
import { discoverPattern } from "./stages/discoverPattern.ts";
import { findPeople } from "./stages/findPeople.ts";
import { callLlm, findCall } from "./stages/util.ts";
import { generateCandidates } from "./candidates.ts";
import { normalizeName, slug } from "./normalize.ts";
import { capThirdParty, cleanUrl, isAggregatorDomain, isBlockedUrl, normalizeDomain, validatePatterns } from "./validate.ts";
import { pMap } from "./pmap.ts";
import { EVIDENCE_MODE, LOW_DOMAIN_CONFIDENCE, NO_FORMAT_CACHE_DAYS, SITE_READ_MODE } from "./config.ts";
import { evidenceFromMx, evidenceFromSearch, evidenceFromSite, patternFromEvidence, scoreEvidence } from "./evidence.ts";
import { verifyCompany } from "./verify/company.ts";
import { siteFormat } from "./site.ts";
import { judgeFit, relevance } from "./fit.ts";
import { cleanEmail, domainFromPaste, mergePatterns, pastePatterns } from "./paste.ts";
import { needsMiddle } from "./candidates.ts";
import { readProfiles } from "./profile.ts";
import { checkOwnEmails } from "./verify/own.ts";

export type RunHooks = {
  onExtract?: (ex: ExtractResult) => void;
  onCompany?: (c: Company) => void;
  onRow?: (c: Contact) => void;
};

type DomainCache = { patterns: Pattern[]; mx_ok?: boolean; fetched_at: string };
type CompanyCache = { domain: string; domain_confidence?: number; domain_source_url?: string };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
/** Domains already shadow-tested this session (one website read per domain). */
const shadowed = new Set<string>();

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

  let people = ex.people.slice(0, ctx.budget.maxContacts);
  const want = ctx.options?.roleFilter?.trim();
  if (want && people.length) {
    // One batch: who is worth looking up? Failures fall back to keyword matching.
    await judgeFit(people, want, ctx.decisions, (c) => companies.get(c.company_id)?.name).catch(() => {});
  }
  const contacts: Contact[] = [];
  const emit = (c: Contact) => {
    contacts.push(c);
    hooks.onRow?.(c);
  };

  // Profile pages linked from the paste: their own address, and from it, their employer.
  const direct = await readProfiles(people, companies, ctx, (c) => isActive(c, ctx));
  // "Verify emails" on: each person's own address is checked once; a bounce sends them down the normal path.
  const bounced = await checkOwnEmails(people.filter((p) => isActive(p, ctx)), ctx);
  const finished = direct.filter((p) => !bounced.has(p));
  for (const c of finished) {
    c.candidates[0].verify_status = c.email_status ?? "unverified";
    emit(c);
  }
  for (const c of direct.filter((p) => bounced.has(p))) {
    Object.assign(c, { status: "pending", candidates: [], primary_email: undefined, note: undefined });
    if (!companies.has(c.company_id)) c.company_id = "";
  }
  people = people.filter((p) => !finished.includes(p));

  for (const c of people.filter((p) => !companies.has(p.company_id))) {
    const why = [c.profile_note, c.bounced_email && `Their address ${c.bounced_email} bounced.`].filter(Boolean).join(" ");
    Object.assign(c, { status: "no_domain", candidates: [], error: why ? `No company found. ${why}` : "no company found for this person" });
    emit(c);
  }

  await pMap([...companies.values()], ctx.budget.concurrency, async (co) => {
    if (ctx.signal?.aborted) return;
    const own = people.filter((p) => p.company_id === co.id);
    const active = own.filter((p) => isActive(p, ctx));
    const roleFilter = ctx.options?.roleFilter?.trim() || co.role_hint;

    // Nothing to apply a lookup to → spend nothing on this company.
    if (!active.length && (own.length || !roleFilter)) {
      co.skipped = !own.length
        ? "no people in your paste — add Target roles to look some up"
        : own.some((p) => p.flag && !p.keep)
          ? "only ⚠-flagged or filtered-out people — include one to look this company up"
          : "nobody here matches your target roles";
      hooks.onCompany?.(co);
      for (const c of own) emit(markSkipped(c, ctx));
      return;
    }
    delete co.skipped;
    await enrichCompany(co, ctx, active);
    hooks.onCompany?.(co);

    if (!own.length && roleFilter && co.domain && co.mx_ok !== false) {
      const found = await findPeople(co, roleFilter, ctx);
      if (found.ok && found.data) own.push(...(await judgeFound(found.data.people.slice(0, Math.max(0, ctx.budget.maxContacts - contacts.length)), co, ctx)));
      else if (!found.ok) co.error = `find_people: ${found.error}`;
    }

    for (const c of own) {
      if (ctx.signal?.aborted) return;
      await finishContact(c, co, ctx, hooks);
      emit(c);
    }
    await verifyAndUpdate(co, own, ctx, hooks);
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
  // A company named by its domain (filed from someone's address, or typed as "acme.com") needs no domain search.
  const fromName = !fromInput && !fromPaste ? normalizeDomain(co.name) : undefined;
  delete co.domain_from_paste;
  delete co.domain_from_profile;
  if (fromInput && !isAggregatorDomain(fromInput)) {
    co.domain = fromInput;
    co.domain_confidence = 1;
    co.domain_source_url = cleanUrl(co.website) ?? `https://${fromInput}`;
  } else if (fromPaste) {
    // A work email pasted next to someone at this company — no search needed, not cached (user data).
    co.domain = fromPaste;
    co.domain_confidence = 0.9;
    co.domain_from_paste = true;
    const viaProfile = people.find((p) => p.email_source_url && cleanEmail(p.email)?.endsWith(`@${fromPaste}`));
    if (viaProfile) co.domain_from_profile = viaProfile.email_source_url;
    delete co.domain_source_url;
  } else if (fromName && !isAggregatorDomain(fromName)) {
    co.domain = fromName;
    co.domain_confidence = 0.9;
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
  // Every row already has its own pasted address (or no usable name) → no format needed.
  const needsPattern = !people.length || people.some((p) => p.first && !(usePaste && cleanEmail(p.email)?.endsWith(`@${co.domain}`)));
  // The company's own website (free, no AI). "on": a proven format skips the paid search.
  // "shadow": read alongside the search and log whether they agree; results come from the search.
  const domain = co.domain;
  const mode = ctx.site ? (ctx.options?.siteMode ?? SITE_READ_MODE) : "off";
  const fromSite = async () => {
    try {
      const read = await ctx.site!(domain);
      return { read, verdict: siteFormat(read, domain, people) };
    } catch {
      return undefined;
    }
  };
  const logShadow = async (site: Awaited<ReturnType<typeof fromSite>>, top: Pattern | undefined) => {
    if (!site) return;
    const t = site.verdict.template ?? null;
    await ctx
      .shadow?.({
        domain,
        site_template: t,
        site_matches: site.verdict.matches,
        site_pages: site.read.pages.length,
        search_template: top?.template ?? null,
        search_confidence: top?.confidence ?? null,
        agree: t && top ? t === top.template : null,
      })
      .catch(() => {});
  };
  if (cached) {
    // Shadow test on a remembered domain too (once per domain per session): compare the site
    // with the format found earlier. Runs in the background — the result never waits on it.
    if (mode === "shadow" && needsPattern && cached.patterns.length && !shadowed.has(domain)) {
      shadowed.add(domain);
      void fromSite().then((site) => logShadow(site, cached.patterns[0]));
    }
    co.patterns = cached.patterns.map((p) => capThirdParty(p, domain)); // remembered before the cap existed
    co.mx_ok = cached.mx_ok;
    co.fetched_at = cached.fetched_at;
    return;
  }
  if (!needsPattern) {
    co.mx_ok = ctx.verifier?.domainLive ? await ctx.verifier.domainLive(co.domain) : undefined;
    return;
  }
  const maxSearches = Math.max(1, Math.min(2, ctx.budget.maxSearchesPerCompany - used));
  let p: Awaited<ReturnType<typeof discoverPattern>> | undefined;
  let shadow: Awaited<ReturnType<typeof fromSite>>;
  let siteSeen: Awaited<ReturnType<typeof fromSite>>;
  const found = (pattern: Pattern) => ({ ok: true, data: { patterns: [pattern] }, confidence: pattern.confidence, sources: pattern.source_url ? [pattern.source_url] : [], tokens_used: 0, searches_used: 0 });
  // Evidence engine "on": earlier lookups already proved this domain's format → no search.
  const evMode = ctx.evidence ? (ctx.options?.evidenceMode ?? EVIDENCE_MODE) : "off";
  if (evMode === "on") {
    const verdict = scoreEvidence(domain, await ctx.evidence!.forDomain(domain).catch(() => []));
    const proven = verdict.catch_all ? undefined : patternFromEvidence(verdict);
    if (proven) p = found(proven);
  }
  if (!p && mode === "on") {
    siteSeen = await fromSite();
    if (siteSeen?.verdict.pattern) p = found(siteSeen.verdict.pattern);
  }
  if (!p) [p, shadow] = await Promise.all([discoverPattern(domain, ctx, { maxSearches }), mode === "shadow" ? fromSite() : undefined]);
  if (shadow) {
    shadowed.add(domain);
    await logShadow(shadow, p.ok ? p.data?.patterns[0] : undefined);
  }
  if (p.ok && p.data) co.patterns = p.data.patterns;
  else co.error = `discover_pattern: ${p.error}`;
  co.mx_ok = ctx.verifier?.domainLive ? await ctx.verifier.domainLive(co.domain) : undefined;
  co.fetched_at = new Date().toISOString();
  // Evidence engine "shadow"/"on": keep why we believe this domain's format (domain facts only).
  if (evMode !== "off") {
    const site = shadow ?? siteSeen;
    const rows = [...(p.ok ? evidenceFromSearch(domain, co.patterns) : []), ...evidenceFromSite(domain, site?.verdict, site?.read.pages[0]), ...evidenceFromMx(domain, co.mx_ok)];
    if (rows.length) await ctx.evidence!.record(rows).catch(() => {});
  }
  // Only a search that finished cleanly is remembered (errors never are). "Searched, nothing
  // found" is kept for a shorter time so a newly published format is picked up soon.
  const keep = co.patterns.length ? ttl : Math.min(ttl, NO_FORMAT_CACHE_DAYS);
  if (p.ok && co.mx_ok !== undefined) {
    await ctx.cache.set(`domain:${co.domain}`, { patterns: co.patterns, mx_ok: co.mx_ok, fetched_at: co.fetched_at } satisfies DomainCache, keep);
  } else if (p.ok && !ctx.verifier) {
    await ctx.cache.set(`domain:${co.domain}`, { patterns: co.patterns, fetched_at: co.fetched_at } satisfies DomainCache, keep);
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
  const trusted = !!normalizeDomain(co.website) || co.domain_from_paste || co.rescued;
  if (!trusted && co.domain_confidence !== undefined && co.domain_confidence < LOW_DOMAIN_CONFIDENCE) {
    c.status = "no_domain";
    c.error = `Domain ${co.domain} is uncertain (${Math.round(co.domain_confidence * 100)}%) — check it or Retry.`;
    return;
  }
  const own = ctx.options?.usePasteEvidence !== false ? cleanEmail(c.email) : undefined;
  const ownHere = own?.endsWith(`@${co.domain}`) ? own : undefined;
  const name = normalizeName([c.first, c.middle, c.last].filter(Boolean).join(" "));
  if (!name.first && ownHere) {
    // Email-only row from a firm list: the address itself is the answer.
    c.candidates = [{ email: ownHere, pattern: "pasted", rank: 1, basis: "seen", verify_status: c.email_status ?? "unverified" }];
    c.primary_email = ownHere;
    c.status = "ok";
    if (co.rescued) c.rescued = true;
    return;
  }
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
  // Their own address bounced: never offer it again, even when the firm's format rebuilds it.
  if (c.bounced_email) c.candidates = c.candidates.filter((x) => x.email !== c.bounced_email).map((x, i) => ({ ...x, rank: (i + 1) as 1 | 2 | 3 }));
  // The person's own pasted work address goes first.
  if (ownHere) {
    const rest = c.candidates.filter((x) => x.email !== ownHere);
    c.candidates = [{ email: ownHere, pattern: "pasted", rank: 1, basis: "seen" as const, verify_status: c.email_status ?? ("unverified" as const) }, ...rest]
      .slice(0, 3)
      .map((x, i) => ({ ...x, rank: (i + 1) as 1 | 2 | 3 }));
  }
  if (co.patterns[0] && needsMiddle(co.patterns[0].template) && !name.middle && !own) {
    c.note = "Top pattern uses a middle initial — add it to the name to get that address.";
  }
  if (co.rescued) c.rescued = true;
  if (ctx.verifier && c.candidates.length) {
    const st = await ctx.verifier.verify(c.candidates.map((x) => x.email));
    for (const x of c.candidates) x.verify_status = x.pattern === "pasted" && c.email_status ? c.email_status : (st[x.email] ?? "unverified");
  }
  c.primary_email = (c.candidates.find((x) => x.verify_status === "valid") ?? c.candidates.find((x) => x.basis !== "guess") ?? c.candidates[0])?.email;
  if (c.candidates.some((x) => x.basis !== "guess")) c.status = "ok";
  else if (co.error) {
    c.status = "error";
    c.error = co.error;
  } else c.status = "no_pattern";
}

const INCOMPLETE_LAST = "Last name is incomplete (e.g. “Maria O.”) — click the name to fill it in.";

// One rescue per company per run: the fix is company-level (domain, patterns).
const rescues = new WeakMap<Company, Promise<StageResult<RescueFix>>>();

const SKIPPED_FLAG = "⚠ may not work here — click Include to look them up.";
const SKIPPED_ROLE = "Not relevant to “Looking for” — click Include to look them up.";

/** Looked up only if not ⚠-flagged and not judged irrelevant — unless the user clicked Include. */
function isActive(c: Contact, ctx: Ctx): boolean {
  if (c.keep) return true;
  if (c.flag) return false;
  if (ctx.options?.skipIrrelevant === false) return !c.drop;
  return relevance(c, ctx.options?.roleFilter) !== false;
}

/**
 * People we looked up ourselves were searched for "Looking for", so judge them like pasted people
 * (a team page lists everyone) — and if the judge is unavailable, keep them rather than fall back
 * to keyword matching, which would drop people the search just found for that very description.
 */
async function judgeFound(found: Contact[], co: Company, ctx: Ctx): Promise<Contact[]> {
  const want = ctx.options?.roleFilter?.trim();
  if (!want || !found.length) return found;
  await judgeFit(found, want, ctx.decisions, () => co.name).catch(() => {});
  for (const c of found) {
    if (c.fit?.for !== want) c.fit = { p: 1, tier: "yes", by: "search", for: want, reason: "found by searching for this" };
  }
  return found;
}

function markSkipped(c: Contact, ctx?: Ctx): Contact {
  const error = c.flag
    ? SKIPPED_FLAG
    : ctx && relevance(c, ctx.options?.roleFilter) === false
      ? c.fit?.reason ? `Not relevant: ${c.fit.reason} — click Include to look them up.` : SKIPPED_ROLE
      : "company not looked up";
  return Object.assign(c, { status: "skipped" as const, candidates: [], primary_email: undefined, error });
}

async function finishContact(c: Contact, co: Company, ctx: Ctx, hooks: RunHooks) {
  if (!isActive(c, ctx)) return void markSkipped(c, ctx);
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
  if (ctx.options?.rescue === false || c.error === INCOMPLETE_LAST || c.status === "skipped") return false;
  // The company already has a sourced format (this row just can't use it, e.g. no middle initial) — rescue can't help.
  if (co.patterns.some((p) => p.from_paste || p.source_url)) return false;
  if (c.status !== "ok") return c.status !== "pending" && !!co.name;
  if (!ctx.decisions.calibrated || c.candidates[0]?.basis === "seen") return false;
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
  const active = contacts.filter((c) => isActive(c, ctx));
  if (!active.length && contacts.length) {
    co.skipped = "only ⚠-flagged or filtered-out people — include one to look this company up";
    hooks.onCompany?.(co);
    for (const c of contacts) hooks.onRow?.(markSkipped(c, ctx));
    return;
  }
  delete co.skipped;
  await enrichCompany(co, fresh, active);
  hooks.onCompany?.(co);
  const roleFilter = ctx.options?.roleFilter?.trim() || co.role_hint;
  if (!contacts.length && roleFilter && co.domain && co.mx_ok !== false) {
    const found = await findPeople(co, roleFilter, fresh);
    if (found.ok && found.data) contacts.push(...(await judgeFound(found.data.people, co, ctx)));
    else if (!found.ok) co.error = `find_people: ${found.error}`;
    hooks.onCompany?.(co);
  }
  for (const c of contacts) {
    c.status = "pending";
    delete c.rescued;
    await finishContact(c, co, fresh, hooks);
    hooks.onRow?.(c);
  }
  await verifyAndUpdate(co, contacts, ctx, hooks);
}

/** Mailbox checks for one company, then refresh its rows. Automatic only in VERIFY_MODE "auto". */
async function verifyAndUpdate(co: Company, contacts: Contact[], ctx: Ctx, hooks: RunHooks, opts: { person?: Contact; clicked?: boolean } = {}) {
  const active = contacts.filter((c) => c.status !== "skipped");
  const v = await verifyCompany(co, active, ctx, (c) => applyCompany(c, co, ctx), opts);
  if (!v.checks && !v.verified && !v.catch_all) return v;
  hooks.onCompany?.(co);
  for (const c of active) hooks.onRow?.(c);
  return v;
}

/**
 * The Verify buttons. With `person`: check that row's emails now. Without: check the firm (one
 * sampled person, "Verify all"). A valid result proves the format for everyone at the firm.
 */
export async function verifyRow(co: Company, contacts: Contact[], ctx: Ctx, hooks: RunHooks = {}, person?: Contact) {
  return verifyAndUpdate(co, contacts, ctx, hooks, { person, clicked: true });
}

export { contactId };
