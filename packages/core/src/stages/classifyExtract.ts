import { INPUT_MODES } from "../schemas.ts";
import type { Company, Contact, Ctx, ExtractResult, InputMode, StageResult, StatedFormat } from "../types.ts";
import { cleanDisplayName, slug } from "../normalize.ts";
import { cleanUrl, isBlockedUrl, isTemplate, normalizeDomain } from "../validate.ts";
import { cleanEmail, isGenericEmail } from "../paste.ts";
import { callLlm, done, fail, findCall } from "./util.ts";
import { cleanPaste } from "../clean.ts";
import { CLEAN_PASTE } from "../config.ts";

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
  const statedFormats = (raw: unknown): StatedFormat[] =>
    (Array.isArray(raw) ? raw : [])
      .map((f: any): StatedFormat | undefined => {
        const quote = str(f?.quote).slice(0, 200);
        if (!quote) return undefined;
        const out: StatedFormat = { quote };
        if (isTemplate(f?.template)) out.template = f.template;
        const ex = cleanEmail(f?.example_email);
        if (ex) out.example_email = ex;
        if (str(f?.example_name)) out.example_name = str(f.example_name);
        return out.template || out.example_email ? out : undefined;
      })
      .filter((f): f is StatedFormat => !!f)
      .slice(0, 5);
  const addCompany = (name: string, website?: string, roleHint?: string, formats: StatedFormat[] = []): Company | undefined => {
    const id = slug(name);
    if (!id) return undefined;
    const existing = companies.get(id);
    const site = cleanUrl(website) ?? (normalizeDomain(website) ? website : undefined);
    if (existing) {
      existing.website ??= site;
      existing.role_hint ??= roleHint || undefined;
      if (formats.length) existing.stated_formats = [...(existing.stated_formats ?? []), ...formats];
      return existing;
    }
    const c: Company = { id, name: name.trim(), patterns: [] };
    if (site) c.website = site;
    if (roleHint) c.role_hint = roleHint;
    if (formats.length) c.stated_formats = formats;
    companies.set(id, c);
    return c;
  };

  if (fallbackCompany) companies.set(fallbackCompany.id, fallbackCompany);
  for (const c of Array.isArray(input?.companies) ? input.companies : []) {
    if (str(c?.name)) addCompany(str(c.name), str(c.website) || undefined, str(c.role_hint) || undefined, statedFormats(c.stated_formats));
  }

  const people = new Map<string, Contact>();
  for (const p of Array.isArray(input?.people) ? input.people : []) {
    const first = cleanDisplayName(str(p?.first)).replace(/,.*$/, "").trim();
    const last = cleanDisplayName(str(p?.last)).replace(/,.*$/, "").trim();
    if (/^linkedin$/i.test(first) && /^member$/i.test(last)) continue; // anonymous LinkedIn rows
    const rawEmail = cleanEmail(p?.email);
    const email = rawEmail && !isGenericEmail(rawEmail) ? rawEmail : undefined;
    const companyName = str(p?.company);
    const company = companyName ? addCompany(companyName) : fallbackCompany;
    const company_id = company?.id ?? "";
    // A firm list with one address each: the address is a contact even with no name (shown as Unknown).
    if (!first && !email) continue;
    const id = first ? contactId(first, last, company_id) : slug(email!);
    if (people.has(id)) continue;
    const contact: Contact = { id, first, last, company_id, raw_source: str(p?.raw), candidates: [], status: "pending" };
    const title = cleanTitle(str(p?.title));
    if (title) contact.title = title;
    const middle = cleanDisplayName(str(p?.middle)).replace(/\.$/, "");
    if (middle && middle.length <= 20) contact.middle = middle;
    if (email) contact.email = email;
    const flag = str(p?.flag).slice(0, 160);
    if (flag) contact.flag = flag;
    const li = cleanUrl(p?.linkedin_url);
    if (li) contact.linkedin_url = li;
    // Their own page elsewhere (never LinkedIn or a data vendor): read later for an address.
    const profile = cleanUrl(p?.profile_url);
    if (profile && !isBlockedUrl(profile)) contact.profile_url = profile;
    people.set(id, contact);
  }

  // A person's profile link is not a company to look up, even if the model listed it in urls too.
  const profiles = new Set([...people.values()].map((p) => p.profile_url).filter(Boolean));
  const urls = (Array.isArray(input?.urls) ? input.urls : [])
    .map(cleanUrl)
    .filter((u: string | undefined): u is string => !!u && !profiles.has(u));
  const mode: InputMode = (INPUT_MODES as readonly string[]).includes(input?.mode) ? input.mode : people.size ? "people" : "companies";

  return { mode, companies: [...companies.values()], people: [...people.values()], urls: [...new Set<string>(urls)], notes: str(input?.notes) };
}

/** Stage 1 — classify & extract. No web calls. */
export async function classifyExtract(text: string, ctx: Ctx): Promise<StageResult<ExtractResult>> {
  // Strip page clutter first (menus, footers, repeats); the user's paste itself is unchanged.
  const input = CLEAN_PASTE ? cleanPaste(text).text : text;
  const { res, error } = await callLlm(ctx, { stage: "classify_extract", input });
  if (!res) return fail(error ?? "llm error");
  const call = findCall(res, "extract_contacts");
  if (!call) return fail("model did not return extract_contacts", res);
  return done(keepPastedEmailsOnly(buildExtract(call.input), text), res);
}

/**
 * An email counts only if it is really in the paste (plain, or "name [at] firm [dot] com"). Stops a
 * misread, an invented address, or instructions hidden in pasted text from putting an address on
 * someone. Rows that were only an address and fail this are dropped.
 */
export function keepPastedEmailsOnly(ex: ExtractResult, text: string): ExtractResult {
  const seen = text
    .toLowerCase()
    .replace(/\s*[\[(]\s*at\s*[\])]\s*/g, "@")
    .replace(/\s*[\[(]\s*dot\s*[\])]\s*/g, ".");
  const inPaste = (e?: string) => !!e && seen.includes(e);
  for (const p of ex.people) if (p.email && !inPaste(p.email)) delete p.email;
  ex.people = ex.people.filter((p) => p.first || p.email);
  for (const c of ex.companies) {
    if (!c.stated_formats) continue;
    for (const f of c.stated_formats) if (f.example_email && !inPaste(f.example_email)) delete f.example_email;
    c.stated_formats = c.stated_formats.filter((f) => f.template || f.example_email);
    if (!c.stated_formats.length) delete c.stated_formats;
  }
  return ex;
}
