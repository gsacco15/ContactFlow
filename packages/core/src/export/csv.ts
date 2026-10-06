import type { Company, Contact, Pattern } from "../types.ts";
import { patternLabel } from "../candidates.ts";

export const CSV_COLUMNS = [
  "first", "last", "title", "company", "domain", "email_1", "verified", "email_2", "email_3",
  "email_1_basis", "email_2_basis", "email_3_basis",
  "pattern", "pattern_confidence", "pattern_confidence_basis", "pattern_source_url", "domain_source_url",
  "linkedin_url", "verify_status", "status", "opt_out",
] as const;

export type ExportOptions = {
  /** Include common-format guesses with no source behind them. Default false. */
  includeGuesses?: boolean;
  /** Adds a trailing `search` column naming the search(es) each row came from. */
  searchOf?: (c: Contact) => string;
};

const columns = (opts: ExportOptions): string[] => (opts.searchOf ? [...CSV_COLUMNS, "search"] : [...CSV_COLUMNS]);

/** The candidates a row should show/export under the given options (guesses dropped unless asked for). */
export function visibleCandidates(c: Contact, opts: ExportOptions = {}) {
  return opts.includeGuesses ? c.candidates : c.candidates.filter((x) => x.basis !== "guess");
}

export const confidenceBasis = (p?: Pattern) => (!p ? "" : p.verified ? "verified by mailbox check" : p.from_evidence ? "proven by earlier lookups" : p.from_paste ? "paste" : p.from_site ? "company website" : p.stated ? "stated by source" : "estimated");

/**
 * Plain-words verification for the row's main email: "yes" (mailbox confirmed), "format proven"
 * (a check at this company proved the format), "no (bounced)", "accept-all server" (can't be
 * proven there), "risky", "not checked", or "demo" for stand-in answers. Empty when no email.
 */
export function verifiedLabel(primary: Contact["candidates"][number] | undefined, co: Company | undefined): string {
  if (!primary) return "";
  const s = primary.verify_status;
  if (primary.pattern === "pasted") return s === "valid" ? "yes" : s === "catch_all" ? "accept-all server" : s === "risky" ? "risky" : "from your paste (not checked)";
  if ((co?.verified_by === "demo" || co?.verified_by === "mock") && s && s !== "unverified") return "demo";
  if (s === "valid") return "yes";
  if (s === "invalid") return "no (bounced)";
  if (s === "catch_all" || co?.catch_all) return "accept-all server";
  if (s === "risky") return "risky";
  if (co?.format_verified && co.format_verified === primary.pattern) return "format proven";
  return "not checked";
}

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

/** One flat row per contact. Unverified guesses always export as verify_status=unverified. */
export function toRow(c: Contact, co: Company | undefined, opts: ExportOptions = {}): CsvRow {
  const cands = visibleCandidates(c, opts);
  const primary = cands.find((x) => x.email === c.primary_email) ?? cands[0];
  const pasted = primary?.pattern === "pasted";
  const viaProfile = pasted && !!c.email_source; // read from their profile page or the firm's site, not the paste
  const where = c.email_source === "site" ? "from the firm's site" : "from their profile page";
  const pattern = primary ? co?.patterns.find((p) => p.template === primary.pattern) : undefined;
  return {
    first: c.first || "Unknown",
    last: c.first ? c.last : "Unknown",
    title: c.title ?? "",
    company: co?.name ?? "",
    domain: co?.domain ?? "",
    email_1: cands[0]?.email ?? "",
    verified: viaProfile && cands[0] === primary && !["valid", "catch_all", "risky"].includes(primary.verify_status ?? "") ? `${where} (not checked)` : verifiedLabel(cands[0], co),
    email_2: cands[1]?.email ?? "",
    email_3: cands[2]?.email ?? "",
    email_1_basis: cands[0]?.basis ?? "",
    email_2_basis: cands[1]?.basis ?? "",
    email_3_basis: cands[2]?.basis ?? "",
    pattern: viaProfile ? (c.email_source === "site" ? "address on the firm's site" : "address on their profile page") : pasted ? "pasted address" : primary ? patternLabel(primary.pattern) : "",
    pattern_confidence: pasted ? "" : pattern ? pattern.confidence.toFixed(2) : primary ? "default" : "",
    pattern_confidence_basis: pasted ? "" : confidenceBasis(pattern),
    pattern_source_url: viaProfile ? (c.email_source_url ?? "") : pasted || pattern?.from_paste ? "pasted text" : (pattern?.source_url ?? ""),
    domain_source_url: co?.domain_from_profile ?? (co?.domain_from_paste ? "pasted text" : (co?.domain_source_url ?? "")),
    linkedin_url: c.linkedin_url ?? "",
    verify_status: primary?.verify_status ?? (primary ? "unverified" : ""),
    status: c.status,
    opt_out: "",
  };
}

// Neutralise spreadsheet formula injection (OWASP): prefix cells that start with = + - @ tab CR.
const safe = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

const csvCell = (v: string) => {
  const s = safe(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * Header + rows as plain strings, for spreadsheet exports (Excel, Google Sheets). Values are
 * raw — the caller writes them as text, never as formulas.
 */
export function toTable(contacts: Contact[], companies: Record<string, Company> | Company[], opts: ExportOptions = {}): string[][] {
  const byId = Array.isArray(companies) ? Object.fromEntries(companies.map((c) => [c.id, c])) : companies;
  const cols = columns(opts);
  return [
    cols,
    ...contacts.map((c) => {
      const row: Record<string, string> = { ...toRow(c, byId[c.company_id], opts), ...(opts.searchOf ? { search: opts.searchOf(c) } : {}) };
      return cols.map((k) => row[k] ?? "");
    }),
  ];
}

export function toCsv(contacts: Contact[], companies: Record<string, Company> | Company[], opts: ExportOptions = {}): string {
  const byId = Array.isArray(companies) ? Object.fromEntries(companies.map((c) => [c.id, c])) : companies;
  const cols = columns(opts);
  const lines = [cols.join(",")];
  for (const c of contacts) {
    const row: Record<string, string> = { ...toRow(c, byId[c.company_id], opts), ...(opts.searchOf ? { search: opts.searchOf(c) } : {}) };
    lines.push(cols.map((k) => csvCell(row[k])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Tab-separated for pasting into Sheets/Excel. */
export function toTsv(contacts: Contact[], companies: Record<string, Company> | Company[], opts: ExportOptions = {}): string {
  const byId = Array.isArray(companies) ? Object.fromEntries(companies.map((c) => [c.id, c])) : companies;
  const cell = (v: string) => safe(v).replace(/[\t\r\n]+/g, " ");
  const cols = columns(opts);
  const lines = [cols.join("\t")];
  for (const c of contacts) {
    const row: Record<string, string> = { ...toRow(c, byId[c.company_id], opts), ...(opts.searchOf ? { search: opts.searchOf(c) } : {}) };
    lines.push(cols.map((k) => cell(row[k])).join("\t"));
  }
  return lines.join("\n") + "\n";
}
