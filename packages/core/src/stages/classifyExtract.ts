import { INPUT_MODES } from "../schemas.ts";
import type { Company, Contact, Ctx, ExtractResult, InputMode, StageResult } from "../types.ts";
import { cleanDisplayName, slug } from "../normalize.ts";
import { cleanUrl, normalizeDomain } from "../validate.ts";
import { callLlm, done, fail, findCall } from "./util.ts";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Strip ", MBA" style credentials and connection badges from a title-ish string. */
const cleanTitle = (t: string) => t.replace(/[•·]\s*(1st|2nd|3rd\+?)\b/gi, "").replace(/\s+/g, " ").trim();

export function contactId(first: string, last: string, companyId: string): string {
  return slug(`${first} ${last} ${companyId}`);
}

/**
 * Turn the raw `extract_contacts` tool input into typed rows: cleans names, links
 * people to companies, dedupes on first+last+company. Also used by find_people.
 */
export function buildExtract(input: any, fallbackCompany?: Company): ExtractResult {
  const companies = new Map<string, Company>();
  const addCompany = (name: string, website?: string, roleHint?: string): Company | undefined => {
    const id = slug(name);
    if (!id) return undefined;
    const existing = companies.get(id);
    const site = cleanUrl(website) ?? (normalizeDomain(website) ? website : undefined);
    if (existing) {
      existing.website ??= site;
      existing.role_hint ??= roleHint || undefined;
      return existing;
    }
    const c: Company = { id, name: name.trim(), patterns: [] };
    if (site) c.website = site;
    if (roleHint) c.role_hint = roleHint;
    companies.set(id, c);
    return c;
  };

  if (fallbackCompany) companies.set(fallbackCompany.id, fallbackCompany);
  for (const c of Array.isArray(input?.companies) ? input.companies : []) {
    if (str(c?.name)) addCompany(str(c.name), str(c.website) || undefined, str(c.role_hint) || undefined);
  }

  const people = new Map<string, Contact>();
  for (const p of Array.isArray(input?.people) ? input.people : []) {
    const first = cleanDisplayName(str(p?.first)).replace(/,.*$/, "").trim();
    const last = cleanDisplayName(str(p?.last)).replace(/,.*$/, "").trim();
    if (!first) continue;
    const companyName = str(p?.company);
    const company = companyName ? addCompany(companyName) : fallbackCompany;
    const company_id = company?.id ?? "";
    const id = contactId(first, last, company_id);
    if (people.has(id)) continue;
    const contact: Contact = { id, first, last, company_id, raw_source: str(p?.raw), candidates: [], status: "pending" };
    const title = cleanTitle(str(p?.title));
    if (title) contact.title = title;
    const li = cleanUrl(p?.linkedin_url);
    if (li) contact.linkedin_url = li;
    people.set(id, contact);
  }

  const urls = (Array.isArray(input?.urls) ? input.urls : [])
    .map(cleanUrl)
    .filter((u: string | undefined): u is string => !!u);
  const mode: InputMode = (INPUT_MODES as readonly string[]).includes(input?.mode) ? input.mode : people.size ? "people" : "companies";

  return { mode, companies: [...companies.values()], people: [...people.values()], urls: [...new Set<string>(urls)], notes: str(input?.notes) };
}

/** Stage 1 — classify & extract. No web calls. */
export async function classifyExtract(text: string, ctx: Ctx): Promise<StageResult<ExtractResult>> {
  const { res, error } = await callLlm(ctx, { stage: "classify_extract", input: text });
  if (!res) return fail(error ?? "llm error");
  const call = findCall(res, "extract_contacts");
  if (!call) return fail("model did not return extract_contacts", res);
  return done(buildExtract(call.input), res);
}
