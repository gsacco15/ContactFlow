import type { Company, Contact } from "../types.ts";
import { patternLabel } from "../candidates.ts";

export const CSV_COLUMNS = [
  "first", "last", "title", "company", "domain", "email_1", "email_2", "email_3",
  "pattern", "pattern_confidence", "pattern_source_url", "domain_source_url",
  "linkedin_url", "verify_status", "status", "opt_out",
] as const;

export type CsvRow = Record<(typeof CSV_COLUMNS)[number], string>;

/** One flat row per contact. Unverified guesses always export as verify_status=unverified. */
export function toRow(c: Contact, co: Company | undefined): CsvRow {
  const primary = c.candidates.find((x) => x.email === c.primary_email) ?? c.candidates[0];
  const pasted = primary?.pattern === "pasted";
  const pattern = primary ? co?.patterns.find((p) => p.template === primary.pattern) : undefined;
  return {
    first: c.first,
    last: c.last,
    title: c.title ?? "",
    company: co?.name ?? "",
    domain: co?.domain ?? "",
    email_1: c.candidates[0]?.email ?? "",
    email_2: c.candidates[1]?.email ?? "",
    email_3: c.candidates[2]?.email ?? "",
    pattern: pasted ? "pasted address" : primary ? patternLabel(primary.pattern) : "",
    pattern_confidence: pasted ? "" : pattern ? pattern.confidence.toFixed(2) : primary ? "default" : "",
    pattern_source_url: pasted || pattern?.from_paste ? "pasted text" : (pattern?.source_url ?? ""),
    domain_source_url: co?.domain_from_paste ? "pasted text" : (co?.domain_source_url ?? ""),
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

export function toCsv(contacts: Contact[], companies: Record<string, Company> | Company[]): string {
  const byId = Array.isArray(companies) ? Object.fromEntries(companies.map((c) => [c.id, c])) : companies;
  const lines = [CSV_COLUMNS.join(",")];
  for (const c of contacts) {
    const row = toRow(c, byId[c.company_id]);
    lines.push(CSV_COLUMNS.map((k) => csvCell(row[k])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** Tab-separated for pasting into Sheets/Excel. */
export function toTsv(contacts: Contact[], companies: Record<string, Company> | Company[]): string {
  const byId = Array.isArray(companies) ? Object.fromEntries(companies.map((c) => [c.id, c])) : companies;
  const cell = (v: string) => safe(v).replace(/[\t\r\n]+/g, " ");
  const lines = [CSV_COLUMNS.join("\t")];
  for (const c of contacts) {
    const row = toRow(c, byId[c.company_id]);
    lines.push(CSV_COLUMNS.map((k) => cell(row[k])).join("\t"));
  }
  return lines.join("\n") + "\n";
}
