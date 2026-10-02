// The tools ContactFlow exposes to ChatGPT / Claude: one per user goal, not one per internal stage.
// The host model reads the paste itself and calls these with structured names, so our reading step
// (classify_extract) never runs here. Domains, caches, the evidence engine, site reading, rescue and
// verification all run underneath, as on the website; the host never needs to know how.
import {
  LOW_DOMAIN_CONFIDENCE, MCP_LIMITS, enrichCompany, normalizeDomain, parseEnrichRequest, runPipeline, slug, toEnrichPattern, toEnrichResponse, toExtract,
  type Company, type Ctx, type EnrichResponse,
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
    `Find work email addresses for named people at up to ${MCP_LIMITS.companiesPerCall} companies per call (max ${MCP_LIMITS.peoplePerCall} people), or find the people in given roles at a company. ` +
    "Each person gets up to 3 ranked emails, the company's email format with its source, and whether a mailbox check confirmed it. Takes 10–60 seconds.",
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

export const TOOLS: Tool<Deps>[] = [findEmails, getEmailFormat];
