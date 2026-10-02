/**
 * The ContactFlow JSON contract (v1): what callers send and what they get back. One shape for the
 * HTTP API, the MCP server, the ChatGPT app and the benchmark.
 *
 * Input is either structured people / companies (no AI reading step — cheaper and exact) or a raw
 * `text` paste (read by classify_extract, same as the web app). Output mirrors the results table.
 */
import { API_LIMITS } from "./config.ts";
import type { Candidate, Company, Contact, ContactStatus, EmailBasis, ExtractResult, Pattern, RunResult, Template, VerifyStatus } from "./types.ts";
import { buildExtract, contactId } from "./stages/classifyExtract.ts";
import { cleanDisplayName, slug } from "./normalize.ts";
import { patternLabel } from "./candidates.ts";
import { confidenceBasis, visibleCandidates } from "./export/csv.ts";
import { sourceName } from "./validate.ts";

export const API_VERSION = "v1";

// ── Request ──────────────────────────────────────────────────────────────────

export type EnrichPersonIn = {
  /** Your own id for this row; echoed back unchanged. */
  ref?: string;
  first: string;
  last: string;
  middle?: string;
  title?: string;
  company: string;
  /** Company domain if you already know it (skips the domain search). */
  domain?: string;
  /** This person's address if you already have it. */
  email?: string;
  linkedin_url?: string;
};

export type EnrichCompanyIn = {
  ref?: string;
  name: string;
  domain?: string;
  /** Roles to find at this company when no people are given, e.g. "Managing Partner, HR Director". */
  roles?: string;
};

export type EnrichOptions = {
  /** Who you're after; others are skipped before anything is spent (same as "Looking for"). */
  looking_for?: string;
  /** Include common-format guesses with no source behind them. Default false. */
  include_guesses?: boolean;
  /** Emails per person, 1–3. Default 3. */
  max_emails?: number;
};

export type EnrichRequest = {
  version?: typeof API_VERSION;
  people?: EnrichPersonIn[];
  companies?: EnrichCompanyIn[];
  /** Alternative to people/companies: anything pasted (LinkedIn search, team page, notes). */
  text?: string;
  options?: EnrichOptions;
};

// ── Response ─────────────────────────────────────────────────────────────────

export type EnrichEmail = {
  address: string;
  rank: 1 | 2 | 3;
  /** seen = in your input · sourced = built from a sourced format · guess = common format, no source */
  basis: EmailBasis;
  verify_status: VerifyStatus;
};

export type EnrichPattern = {
  /** "first.last", "flast"… */
  format: string;
  template: Template;
  confidence: number;
  confidence_basis: "verified by mailbox check" | "proven by earlier lookups" | "your input" | "company website" | "stated by source" | "estimated";
  /** "RocketReach", "their site", a hostname — null when unknown. */
  source: string | null;
  source_url: string | null;
};

export type EnrichPersonOut = {
  ref?: string;
  first: string;
  middle?: string;
  last: string;
  title?: string;
  company: string;
  domain: string | null;
  domain_source_url: string | null;
  emails: EnrichEmail[];
  pattern: EnrichPattern | null;
  status: ContactStatus;
  /** Why there's no email, what a retry found, or a warning. */
  note?: string;
  /** e.g. their headline names a different employer. */
  flag?: string;
};

export type EnrichCompanyOut = {
  ref?: string;
  name: string;
  domain: string | null;
  patterns: EnrichPattern[];
  note?: string;
};

export type EnrichResponse = {
  version: typeof API_VERSION;
  people: EnrichPersonOut[];
  companies: EnrichCompanyOut[];
};

// ── Validation ───────────────────────────────────────────────────────────────

export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isStr = (v: unknown): v is string => typeof v === "string";
const clip = (v: unknown, n = API_LIMITS.field) => (isStr(v) ? v.trim().slice(0, n) : undefined);

/** Check a request body and return a clean copy, or every problem found (with JSON paths). */
export function parseEnrichRequest(raw: unknown): Parsed<EnrichRequest> {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["body must be a JSON object"] };
  const b = raw as Record<string, unknown>;
  if (b.version !== undefined && b.version !== API_VERSION) errors.push(`version: only "${API_VERSION}" is supported`);

  const out: EnrichRequest = { version: API_VERSION };
  if (b.people !== undefined) {
    if (!Array.isArray(b.people)) errors.push("people: must be an array");
    else if (b.people.length > API_LIMITS.people) errors.push(`people: at most ${API_LIMITS.people} per request`);
    else {
      out.people = [];
      b.people.forEach((p: any, i) => {
        const at = `people[${i}]`;
        if (!p || typeof p !== "object") return void errors.push(`${at}: must be an object`);
        const first = clip(p.first);
        const last = clip(p.last);
        const company = clip(p.company);
        if (!first) errors.push(`${at}.first: required`);
        if (last === undefined) errors.push(`${at}.last: required (use "" if unknown)`);
        if (!company) errors.push(`${at}.company: required`);
        for (const k of ["ref", "middle", "title", "domain", "email", "linkedin_url"]) if (p[k] !== undefined && !isStr(p[k])) errors.push(`${at}.${k}: must be a string`);
        if (first && last !== undefined && company) {
          const row: EnrichPersonIn = { first, last, company };
          for (const k of ["ref", "middle", "title", "domain", "email", "linkedin_url"] as const) {
            const v = clip(p[k], k === "linkedin_url" ? 500 : API_LIMITS.field);
            if (v) row[k] = v;
          }
          out.people!.push(row);
        }
      });
    }
  }
  if (b.companies !== undefined) {
    if (!Array.isArray(b.companies)) errors.push("companies: must be an array");
    else if (b.companies.length > API_LIMITS.companies) errors.push(`companies: at most ${API_LIMITS.companies} per request`);
    else {
      out.companies = [];
      b.companies.forEach((c: any, i) => {
        const at = `companies[${i}]`;
        if (!c || typeof c !== "object") return void errors.push(`${at}: must be an object`);
        const name = clip(c.name);
        if (!name) return void errors.push(`${at}.name: required`);
        for (const k of ["ref", "domain", "roles"]) if (c[k] !== undefined && !isStr(c[k])) errors.push(`${at}.${k}: must be a string`);
        const row: EnrichCompanyIn = { name };
        for (const k of ["ref", "domain", "roles"] as const) {
          const v = clip(c[k]);
          if (v) row[k] = v;
        }
        out.companies!.push(row);
      });
    }
  }
  if (b.text !== undefined) {
    if (!isStr(b.text)) errors.push("text: must be a string");
    else if (b.text.length > API_LIMITS.textChars) errors.push(`text: at most ${API_LIMITS.textChars} characters`);
    else if (b.text.trim()) out.text = b.text;
  }
  if (out.text && (out.people?.length || out.companies?.length)) errors.push("send either text or people/companies, not both");
  if (!out.text && !out.people?.length && !out.companies?.length) errors.push("nothing to do: send people, companies or text");

  if (b.options !== undefined) {
    const o = b.options as Record<string, unknown>;
    if (!o || typeof o !== "object") errors.push("options: must be an object");
    else {
      out.options = {};
      if (o.looking_for !== undefined) {
        if (!isStr(o.looking_for)) errors.push("options.looking_for: must be a string");
        else if (o.looking_for.trim()) out.options.looking_for = clip(o.looking_for);
      }
      if (o.include_guesses !== undefined) {
        if (typeof o.include_guesses !== "boolean") errors.push("options.include_guesses: must be true or false");
        else out.options.include_guesses = o.include_guesses;
      }
      if (o.max_emails !== undefined) {
        if (![1, 2, 3].includes(o.max_emails as number)) errors.push("options.max_emails: must be 1, 2 or 3");
        else out.options.max_emails = o.max_emails as number;
      }
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

// ── Request → pipeline input ─────────────────────────────────────────────────

/** Name as buildExtract cleans it, so refs can be matched back to contact ids. */
const cleanName = (s: string) => cleanDisplayName(s).replace(/,.*$/, "").trim();

/**
 * Structured people/companies → the ExtractResult runPipeline takes directly (no AI reading step).
 * `refs` maps contact / company ids back to the caller's refs.
 */
export function toExtract(req: EnrichRequest): { extract: ExtractResult; refs: Map<string, string> } {
  const refs = new Map<string, string>();
  const companies = [
    ...(req.companies ?? []).map((c) => ({ name: c.name, website: c.domain, role_hint: c.roles })),
    ...(req.people ?? []).map((p) => ({ name: p.company, website: p.domain })),
  ];
  const people = (req.people ?? []).map((p) => ({ first: p.first, middle: p.middle, last: p.last, title: p.title, company: p.company, email: p.email, linkedin_url: p.linkedin_url, raw: "api" }));
  const extract = buildExtract({ mode: people.length ? (req.companies?.length ? "mixed" : "people") : "companies", companies, people, urls: [], notes: "" });
  for (const c of req.companies ?? []) if (c.ref) refs.set(`company:${slug(c.name)}`, c.ref);
  for (const p of req.people ?? []) if (p.ref) refs.set(contactId(cleanName(p.first), cleanName(p.last), slug(p.company)), p.ref);
  return { extract, refs };
}

// ── Pipeline result → response ───────────────────────────────────────────────

function toPattern(p: Pattern, domain?: string): EnrichPattern {
  const basis = confidenceBasis(p);
  return {
    format: patternLabel(p.template),
    template: p.template,
    confidence: Math.round(p.confidence * 100) / 100,
    confidence_basis: basis === "paste" ? "your input" : (basis as EnrichPattern["confidence_basis"]),
    source: p.verified ? "mailbox check" : p.from_paste ? "your input" : p.from_site ? "their site" : (sourceName(p.source_url, domain) ?? null),
    source_url: p.source_url ?? null,
  };
}

function toEmail(c: Candidate): EnrichEmail {
  return { address: c.email, rank: c.rank, basis: c.basis, verify_status: c.verify_status ?? "unverified" };
}

export function toEnrichResponse(result: Pick<RunResult, "companies" | "contacts">, opts: EnrichOptions = {}, refs: Map<string, string> = new Map()): EnrichResponse {
  const byId = new Map<string, Company>(result.companies.map((c) => [c.id, c]));
  const max = opts.max_emails ?? 3;
  const people = result.contacts.map((c: Contact): EnrichPersonOut => {
    const co = byId.get(c.company_id);
    const emails = visibleCandidates(c, { includeGuesses: !!opts.include_guesses }).slice(0, max).map(toEmail);
    const top = c.candidates.find((x) => x.pattern !== "pasted");
    const pattern = top && co ? co.patterns.find((p) => p.template === top.pattern) : undefined;
    const note = [c.note, c.error, co?.rescue_note].filter(Boolean).join(" · ");
    const out: EnrichPersonOut = {
      first: c.first,
      last: c.last,
      company: co?.name ?? "",
      domain: co?.domain ?? null,
      domain_source_url: co?.domain_from_paste ? null : (co?.domain_source_url ?? null),
      emails,
      pattern: pattern ? toPattern(pattern, co?.domain) : null,
      status: c.status,
    };
    const ref = refs.get(c.id);
    if (ref) out.ref = ref;
    if (c.middle) out.middle = c.middle;
    if (c.title) out.title = c.title;
    if (note) out.note = note;
    if (c.flag) out.flag = c.flag;
    return out;
  });
  const companies = result.companies.map((co): EnrichCompanyOut => {
    const out: EnrichCompanyOut = { name: co.name, domain: co.domain ?? null, patterns: co.patterns.map((p) => toPattern(p, co.domain)) };
    const ref = refs.get(`company:${co.id}`);
    if (ref) out.ref = ref;
    const note = co.skipped ?? co.error ?? co.rescue_note;
    if (note) out.note = note;
    return out;
  });
  return { version: API_VERSION, people, companies };
}

// ── JSON Schema (for the HTTP API docs and MCP tool definitions) ─────────────

const s = (description: string) => ({ type: "string", description });

export const ENRICH_REQUEST_SCHEMA = {
  type: "object",
  description: "Find work emails. Send structured people and/or companies, or a raw text paste — not both.",
  properties: {
    version: { type: "string", enum: [API_VERSION] },
    people: {
      type: "array",
      maxItems: API_LIMITS.people,
      items: {
        type: "object",
        properties: {
          ref: s("Your id for this row; echoed back"),
          first: s("Given name"),
          last: s('Family name ("" if unknown)'),
          middle: s("Middle name or initial"),
          title: s("Job title"),
          company: s("Current employer"),
          domain: s("Company domain if known, e.g. acme.com"),
          email: s("Their address if you already have it"),
          linkedin_url: s("LinkedIn profile URL (stored, never fetched)"),
        },
        required: ["first", "last", "company"],
        additionalProperties: false,
      },
    },
    companies: {
      type: "array",
      maxItems: API_LIMITS.companies,
      items: {
        type: "object",
        properties: {
          ref: s("Your id for this row; echoed back"),
          name: s("Company name"),
          domain: s("Company domain if known"),
          roles: s("Roles to find there, e.g. 'Managing Partner, HR Director'"),
        },
        required: ["name"],
        additionalProperties: false,
      },
    },
    text: { type: "string", maxLength: API_LIMITS.textChars, description: "Anything pasted: a LinkedIn search, a team page, notes" },
    options: {
      type: "object",
      properties: {
        looking_for: s("Who you're after, e.g. 'partners'. Others are skipped."),
        include_guesses: { type: "boolean", description: "Include common-format guesses with no source. Default false." },
        max_emails: { type: "integer", enum: [1, 2, 3], description: "Emails per person. Default 3." },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;
