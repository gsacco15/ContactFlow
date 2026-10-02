// The tools ContactFlow exposes to ChatGPT / Claude: one per user goal, not one per internal stage.
// The host model reads the paste itself and calls these with structured names, so our reading step
// (classify_extract) never runs here. Domains, caches, the evidence engine, site reading, rescue and
// verification all run underneath, as on the website; the host never needs to know how.
import {
  LOW_DOMAIN_CONFIDENCE, MCP_LIMITS, enrichCompany, normalizeDomain, parseEnrichRequest, runPipeline, slug, toEnrichPattern, toEnrichResponse, toExtract,
  type Company, type Ctx, type EnrichResponse,
} from "@cf/core";
import type { Resource, Tool, ToolResult } from "./protocol.ts";
import { WIDGET_HTML, WIDGET_META, WIDGET_MIME, WIDGET_URI } from "./widget.ts";

export type Deps = {
  /** A fresh pipeline context for one tool call. */
  ctx: (o?: { verify?: boolean; roleFilter?: string }) => Ctx;
};

export const INSTRUCTIONS = [
  "ContactFlow finds work email addresses for named people at companies, with the source of each company's email format.",
  "Read the user's paste yourself (LinkedIn results, team pages, notes) and pass structured names to find_emails, at most 3 companies per call; call it again (in parallel is fine) for more companies.",
  "Emails are built from each company's email format. Only verified 'yes' or 'format proven' means a mailbox check confirmed it; present everything else as likely, not confirmed, and never invent addresses.",
  "When all find_emails calls are done, call show_results once with every person and company together to show the results table.",
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
    `Find work email addresses for named people at up to ${MCP_LIMITS.companiesPerCall} companies per call (max ${MCP_LIMITS.peoplePerCall} people), or find the people in given roles at a company. ` +
    "Each person gets up to 3 ranked emails, the company's email format with its source, and whether a mailbox check confirmed it (checks run by default). Takes 10–60 seconds. Afterwards, call show_results to show them.",
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
      verify: { type: "boolean", description: "Check one mailbox per company to prove its format. On by default; set false only if the user asks for no checks. Companies already proven are free." },
      include_guesses: { type: "boolean", description: "Also return common-format guesses with no source. Default false." },
    },
    additionalProperties: false,
  },
  annotations: { ...READ_ONLY, title: "Find work emails" },
  _meta: { "openai/toolInvocation/invoking": "Finding work emails…", "openai/toolInvocation/invoked": "Found work emails" },
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
    // Mailbox checks on by default in chat: about $0.0025 per new company, and a proven format is
    // remembered for everyone, so repeat lookups cost nothing.
    const ctx = deps.ctx({ verify: args.verify !== false, roleFilter: parsed.value.options?.looking_for });
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

// ── get_email_format ─────────────────────────────────────────────────────────

const getEmailFormat: Tool<Deps> = {
  name: "get_email_format",
  title: "Get a company's email format",
  description: "How a company writes its email addresses (e.g. first.last@acme.com): up to 3 formats, each with a confidence and the source that states it. Give the company name, its domain, or both.",
  inputSchema: {
    type: "object",
    properties: { company: str("Company name"), domain: str("Company domain if known, e.g. acme.com") },
    additionalProperties: false,
  },
  annotations: { ...READ_ONLY, title: "Get a company's email format" },
  _meta: { "openai/toolInvocation/invoking": "Looking up the email format…", "openai/toolInvocation/invoked": "Found the email format" },
  async run(args, deps) {
    const name = clip(args.company);
    const given = clip(args.domain);
    const domain = given ? normalizeDomain(given) : null;
    if (given && (!domain || /(^|\.)linkedin\.com$/.test(domain))) return err("Give the company's own domain, e.g. acme.com, or just its name.");
    if (!name && !domain) return err("Give a company name or domain.");
    const co: Company = { id: slug(name || domain!), name: name || domain!, website: domain ?? undefined, patterns: [] };
    await enrichCompany(co, deps.ctx(), []);
    const label = name || co.domain || domain!;
    const data = { company: label, domain: co.domain ?? null, formats: co.patterns.map((p) => toEnrichPattern(p, co.domain)) };
    if (!co.domain) return ok(`Couldn't find ${label}'s domain. Ask the user for the company website.`, data);
    const unsure = !domain && (co.domain_confidence ?? 1) < LOW_DOMAIN_CONFIDENCE ? ` Not sure ${co.domain} is the right company — confirm with the user.` : "";
    if (!data.formats.length) return ok(`${label} (${co.domain}): no sourced email format found.${unsure}`, data);
    const mx = co.mx_ok === false ? ` ${co.domain} doesn't receive email.` : "";
    return ok(`${label} (${co.domain}): ${data.formats.map((f) => `${f.format}@${co.domain} ${pct(f.confidence)} (${f.confidence_basis}${f.source ? `, ${f.source}` : ""})`).join(" · ")}.${mx}${unsure}`, data);
  },
};

// ── show_results (render tool: owns the results view, no lookups) ─────────────

const SHOW_LIMIT = 200;
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const list = (v: unknown) => (Array.isArray(v) ? v : []);

/** Keep only the fields the view shows, as plain strings and numbers (input comes from the model). */
export function cleanResults(args: Record<string, unknown>) {
  const s = (v: unknown, n = 200) => (typeof v === "string" ? v.slice(0, n) : undefined);
  const pattern = (p: any) => ({ format: s(p?.format, 40), confidence: Number.isFinite(Number(p?.confidence)) ? Number(p.confidence) : undefined, confidence_basis: s(p?.confidence_basis, 60), source: s(p?.source, 60), source_url: s(p?.source_url, 300)?.match(/^https?:\/\//) ? s(p.source_url, 300) : undefined });
  const people = list(args.people).slice(0, SHOW_LIMIT).map((x) => {
    const p = obj(x);
    return {
      first: s(p.first), middle: s(p.middle), last: s(p.last), title: s(p.title), company: s(p.company) ?? "",
      emails: list(p.emails).slice(0, 3).map((e) => ({ address: s(obj(e).address, 120) })).filter((e) => e.address?.includes("@")),
      verified: s(p.verified, 40) ?? "not checked", note: s(p.note, 300), flag: s(p.flag, 200),
    };
  });
  const companies = list(args.companies).slice(0, 50).map((x) => {
    const c = obj(x);
    return { name: s(c.name) ?? "", domain: s(c.domain, 120), patterns: list(c.patterns).slice(0, 1).map(pattern), verification: s(c.verification, 60), note: s(c.note, 300) };
  });
  return { people, companies };
}

const showResults: Tool<Deps> = {
  name: "show_results",
  title: "Show email results",
  description:
    "Show the ContactFlow results table to the user. Call find_emails first (as many times as needed), then call this once with all " +
    "people and companies from those results, unchanged. Does no lookups.",
  inputSchema: {
    type: "object",
    properties: {
      people: { type: "array", maxItems: SHOW_LIMIT, description: "The people arrays from find_emails, combined", items: { type: "object" } },
      companies: { type: "array", maxItems: 50, description: "The companies arrays from find_emails, combined", items: { type: "object" } },
    },
    required: ["people"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false, title: "Show email results" },
  _meta: { ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI, "openai/toolInvocation/invoking": "Preparing your table…", "openai/toolInvocation/invoked": "Here are your results" },
  async run(args) {
    const data = cleanResults(args);
    const withEmail = data.people.filter((p) => p.emails.length).length;
    return ok(`Showing ${data.people.length} people (${withEmail} with an email) in the ContactFlow table.`, data);
  },
};

export const TOOLS: Tool<Deps>[] = [findEmails, getEmailFormat, showResults];

export const RESOURCES: Resource[] = [{ uri: WIDGET_URI, name: "ContactFlow results", mimeType: WIDGET_MIME, text: WIDGET_HTML, _meta: WIDGET_META }];
