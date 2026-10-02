// The tools ContactFlow exposes to ChatGPT / Claude (v2 build sheet §1b). The host model reads the
// paste itself and calls these with structured names, so our own reading step (classify_extract)
// never runs here. Same stages, caches, evidence and verification as the website.
import {
  LOW_DOMAIN_CONFIDENCE, MCP_LIMITS, TEMPLATES, enrichCompany, generateCandidates, normalizeDomain, normalizeName, parseEnrichRequest,
  patternLabel, resolveDomain, runPipeline, slug, toEnrichPattern, toEnrichResponse, toExtract,
  type Company, type Ctx, type EnrichResponse, type Pattern, type Template,
} from "@cf/core";
import type { Tool, ToolResult } from "./protocol.ts";

export type Deps = {
  /** A fresh pipeline context for one tool call. */
  ctx: (o?: { verify?: boolean; roleFilter?: string }) => Ctx;
};

export const INSTRUCTIONS = [
  "ContactFlow finds work email addresses for named people at companies, with the source of each company's email format.",
  "Read the user's paste yourself (LinkedIn results, team pages, notes) and pass structured names to find_emails, at most 3 companies per call; call it again (in parallel is fine) for more companies.",
  "Emails are built from each company's email format. Only verified 'yes' or 'format proven' means a mailbox check confirmed it; present everything else as likely, not confirmed, and never invent addresses.",
  "Never pass linkedin.com URLs as domains. ContactFlow does not open LinkedIn or login-walled pages.",
].join(" ");

const str = (description: string) => ({ type: "string", description });
const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({ text, data });
const err = (text: string): ToolResult => ({ text, isError: true });
const clip = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const pct = (x: number) => `${Math.round(x * 100)}%`;
const READ_ONLY = { readOnlyHint: true, openWorldHint: true, destructiveHint: false };

// ── find_emails ──────────────────────────────────────────────────────────────

const findEmails: Tool<Deps> = {
  name: "find_emails",
  title: "Find work emails",
  description:
    `Find work emails for named people at up to ${MCP_LIMITS.companiesPerCall} companies per call (max ${MCP_LIMITS.peoplePerCall} people). ` +
    "Looks up each company's domain and email format (with its source), builds up to 3 ranked emails per person, and optionally checks a mailbox to prove the format. " +
    "Pass companies with roles instead of people to find people on the company's own team page. Takes 10–60 seconds.",
  inputSchema: {
    type: "object",
    properties: {
      people: {
        type: "array",
        maxItems: MCP_LIMITS.peoplePerCall,
        items: {
          type: "object",
          properties: {
            first: str("Given name"),
            last: str('Family name ("" if unknown)'),
            middle: str("Middle name or initial, if known"),
            title: str("Job title as written"),
            company: str("Current employer"),
            domain: str("Company email domain if already known, e.g. acme.com"),
            ref: str("Your id for this row; echoed back"),
          },
          required: ["first", "last", "company"],
          additionalProperties: false,
        },
      },
      companies: {
        type: "array",
        maxItems: MCP_LIMITS.companiesPerCall,
        description: "Companies to search when no people are named; ContactFlow reads their own team page",
        items: {
          type: "object",
          properties: { name: str("Company name"), domain: str("Domain if known"), roles: str('Who to find, e.g. "Managing Partner, HR Director"') },
          required: ["name"],
          additionalProperties: false,
        },
      },
      looking_for: str('Optional: who the user wants, e.g. "partners, not clerks". Others are skipped before anything is spent.'),
      verify: { type: "boolean", description: "Check one mailbox per company to prove its format (small extra cost). Only when the user asks for verified emails." },
      include_guesses: { type: "boolean", description: "Also return common-format guesses with no source. Default false." },
    },
    additionalProperties: false,
  },
  annotations: { ...READ_ONLY, title: "Find work emails" },
  async run(args, deps) {
    const people = Array.isArray(args.people) ? args.people : [];
    const companies = Array.isArray(args.companies) ? args.companies : [];
    if (people.length > MCP_LIMITS.peoplePerCall) return err(`At most ${MCP_LIMITS.peoplePerCall} people per call. Split the list and call find_emails again.`);
    const names = new Set([...people.map((p: any) => clip(p?.company)), ...companies.map((c: any) => clip(c?.name))].filter(Boolean).map((n) => slug(n)));
    if (names.size > MCP_LIMITS.companiesPerCall) return err(`At most ${MCP_LIMITS.companiesPerCall} companies per call (got ${names.size}). Call find_emails again for the rest, in parallel if you like.`);
    const parsed = parseEnrichRequest({
      people: people.length ? people : undefined,
      companies: companies.length ? companies : undefined,
      options: { looking_for: typeof args.looking_for === "string" ? args.looking_for : undefined, include_guesses: args.include_guesses === true },
    });
    if (!parsed.ok) return err(`Invalid input: ${parsed.errors.join("; ")}`);
    const { extract, refs } = toExtract(parsed.value);
    const ctx = deps.ctx({ verify: args.verify === true, roleFilter: parsed.value.options?.looking_for });
    const result = await runPipeline(extract, ctx);
    const res = toEnrichResponse(result, parsed.value.options, refs);
    return ok(summarize(res), res as unknown as Record<string, unknown>);
  },
};

/** Plain-text table the host model can show or reshape. */
export function summarize(res: EnrichResponse): string {
  const lines: string[] = [];
  for (const co of res.companies) {
    const top = co.patterns[0];
    const format = top ? `format ${top.format} ${pct(top.confidence)} (${top.confidence_basis}${top.source ? `, ${top.source}` : ""})` : "no sourced format found";
    lines.push(`${co.name} — ${co.domain ?? "domain not found"} · ${format}${co.verification ? ` · ${co.verification}` : ""}${co.note ? ` · ${co.note}` : ""}`);
    for (const p of res.people.filter((x) => x.company === co.name)) {
      const who = [p.first, p.middle, p.last].filter(Boolean).join(" ") || "(no name)";
      const [first, ...rest] = p.emails;
      const email = first ? `${first.address} [verified: ${p.verified}]` : `no email (${p.status})`;
      lines.push(`  - ${who}${p.title ? `, ${p.title}` : ""}: ${email}${rest.length ? ` · backups: ${rest.map((e) => e.address).join(", ")}` : ""}${p.flag ? ` · ⚠ ${p.flag}` : ""}${p.note && !first ? ` · ${p.note}` : ""}`);
    }
  }
  if (!lines.length) lines.push("Nothing found.");
  lines.push("", "Only [verified: yes] or [verified: format proven] were confirmed by a mailbox check; the rest are likely addresses from the company's sourced format.");
  return lines.join("\n");
}

// ── find_domain ──────────────────────────────────────────────────────────────

const findDomain: Tool<Deps> = {
  name: "find_domain",
  title: "Find a company's domain",
  description: "Find a company's official website / email domain, with the source and a confidence. Use a hint (industry, city, parent company) when the name is ambiguous.",
  inputSchema: {
    type: "object",
    properties: { company: str("Company name"), hint: str("Optional: industry, city, parent company or a person's title there") },
    required: ["company"],
    additionalProperties: false,
  },
  annotations: { ...READ_ONLY, title: "Find a company's domain" },
  async run(args, deps) {
    const name = clip(args.company);
    if (!name) return err("company is required");
    const ctx = deps.ctx();
    const key = `company:${slug(name)}`;
    const cached = (await ctx.cache.get(key).catch(() => undefined)) as { domain?: string; domain_confidence?: number; domain_source_url?: string } | undefined;
    let data: { domain: string | null; confidence: number; source_url: string | null; alternatives: string[] };
    if (cached?.domain) data = { domain: cached.domain, confidence: cached.domain_confidence ?? 0.5, source_url: cached.domain_source_url ?? null, alternatives: [] };
    else {
      const d = await resolveDomain({ name, hint: clip(args.hint) || undefined }, ctx, { maxSearches: 2 });
      if (!d.ok || !d.data) return err(`Domain lookup failed: ${d.error ?? "no answer"}`);
      data = { domain: d.data.domain, confidence: d.data.confidence, source_url: d.data.source_url ?? null, alternatives: d.data.alternatives ?? [] };
      if (data.domain) await ctx.cache.set(key, { domain: data.domain, domain_confidence: data.confidence, domain_source_url: data.source_url ?? undefined }, ctx.budget.cacheTtlDays).catch(() => {});
    }
    if (!data.domain) return ok(`No domain found for ${name}.`, { company: name, ...data });
    const unsure = data.confidence < LOW_DOMAIN_CONFIDENCE ? " — low confidence, ask the user to confirm" : "";
    return ok(`${name}: ${data.domain} (${pct(data.confidence)}${data.source_url ? `, source ${data.source_url}` : ""})${unsure}${data.alternatives.length ? ` · alternatives: ${data.alternatives.join(", ")}` : ""}`, { company: name, ...data });
  },
};

// ── get_email_format ─────────────────────────────────────────────────────────

const getEmailFormat: Tool<Deps> = {
  name: "get_email_format",
  title: "Get a company's email format",
  description: "How a domain writes its email addresses (first.last, flast…): up to 3 formats with confidence and the source that states each one, and whether the domain receives mail.",
  inputSchema: { type: "object", properties: { domain: str("Bare domain, e.g. acme.com") }, required: ["domain"], additionalProperties: false },
  annotations: { ...READ_ONLY, title: "Get a company's email format" },
  async run(args, deps) {
    const domain = normalizeDomain(clip(args.domain));
    if (!domain || /(^|\.)linkedin\.com$/.test(domain)) return err("Give a company's own domain, e.g. acme.com");
    const ctx = deps.ctx();
    const co: Company = { id: slug(domain), name: domain, website: domain, patterns: [] };
    await enrichCompany(co, ctx, []);
    const formats = co.patterns.map((p) => toEnrichPattern(p, domain));
    const data = { domain, accepts_mail: co.mx_ok ?? null, formats };
    if (!formats.length) return ok(`No sourced email format found for ${domain}${co.error ? ` (${co.error})` : ""}.`, data);
    const mx = co.mx_ok === false ? " ⚠ this domain has no mail servers (MX)." : "";
    return ok(`${domain}: ${formats.map((f) => `${f.format} ${pct(f.confidence)} (${f.confidence_basis}${f.source ? `, ${f.source}` : ""})`).join(" · ")}${mx}`, data);
  },
};

// ── build_emails (free, no lookups) ──────────────────────────────────────────

const LABELS = TEMPLATES.map((t) => patternLabel(t)).join(", ");

const buildEmails: Tool<Deps> = {
  name: "build_emails",
  title: "Build emails from a known format",
  description: `Free and instant: apply a known email format to names at a domain. Formats: ${LABELS}. Use get_email_format first if the format isn't known.`,
  inputSchema: {
    type: "object",
    properties: {
      domain: str("Bare domain, e.g. acme.com"),
      format: str(`One of: ${LABELS}`),
      people: {
        type: "array",
        maxItems: 200,
        items: { type: "object", properties: { first: str("Given name"), last: str("Family name"), middle: str("Middle name or initial") }, required: ["first", "last"], additionalProperties: false },
      },
    },
    required: ["domain", "format", "people"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, title: "Build emails from a known format" },
  async run(args) {
    const domain = normalizeDomain(clip(args.domain));
    if (!domain) return err("domain is required, e.g. acme.com");
    const f = clip(args.format).toLowerCase();
    const template = TEMPLATES.find((t) => t === f || patternLabel(t) === f) as Template | undefined;
    if (!template) return err(`Unknown format "${f}". Use one of: ${LABELS}`);
    const people = (Array.isArray(args.people) ? args.people : []).slice(0, 200);
    const pattern: Pattern = { template, confidence: 1 };
    const rows = people.map((p: any) => {
      const name = normalizeName([clip(p?.first), clip(p?.middle), clip(p?.last)].filter(Boolean).join(" "));
      const email = generateCandidates(name, domain, [pattern])[0];
      return { first: clip(p?.first), last: clip(p?.last), email: email?.pattern === template ? email.email : null };
    });
    const text = rows.map((r) => `${r.first} ${r.last}: ${r.email ?? `can't build (${patternLabel(template)} needs a part of the name that's missing)`}`).join("\n");
    return ok(`${text}\n\nBuilt from ${patternLabel(template)}@${domain}; not checked.`, { domain, format: patternLabel(template), people: rows });
  },
};

export const TOOLS: Tool<Deps>[] = [findEmails, findDomain, getEmailFormat, buildEmails];
