// Profile pages linked from the paste — a member directory entry, a firm bio — read for the
// person's own address. Free (the edge function fetches the page; no AI). Guardrails:
//  - only people whose own row links a page (never LinkedIn or a data vendor; blocked at extraction)
//  - an address counts only when it fits the person's name, or is the one address near their name
//  - a person moves to the employer their address shows; a pasted heading is dropped as "the company"
//    only when two or more of its people turn out to work elsewhere and none there
import type { Company, Contact, Ctx } from "./types.ts";
import { FREEMAIL_DOMAINS, PROFILE_LIMITS } from "./config.ts";
import { cleanEmail, isGenericEmail } from "./paste.ts";
import { inferTemplates } from "./candidates.ts";
import { asciiFold, normalizeName, slug } from "./normalize.ts";
import { isAggregatorDomain, normalizeDomain } from "./validate.ts";
import { pMap } from "./pmap.ts";

export type ProfileEmail = { email: string; context: string };
/** One page read by the edge function. `note` says why nothing came back (robots.txt, login, …). */
export type ProfileRead = { url: string; ok: boolean; note?: string; emails: ProfileEmail[] };

/**
 * This person's address on their profile page, or undefined when none is clearly theirs: an address
 * that fits their name (jdoe@ for Jane Doe), else the only address with their surname close by.
 * Shared inboxes never count; two addresses that both fit means we can't tell, so none.
 */
export function profileEmail(c: Contact, emails: ProfileEmail[]): string | undefined {
  const name = normalizeName([c.first, c.middle, c.last].filter(Boolean).join(" "));
  if (!name.first) return undefined;
  const found = new Map<string, string>();
  for (const e of emails) {
    const email = cleanEmail(e.email);
    if (email && !isGenericEmail(email) && !found.has(email)) found.set(email, asciiFold(e.context ?? ""));
  }
  const byName = [...found.keys()].filter((e) => inferTemplates(name, e.split("@")[0]).length > 0);
  if (byName.length) return byName.length === 1 ? byName[0] : undefined;
  const last = name.last.replace(/-/g, " ");
  const near = last.length >= 2 ? [...found].filter(([, ctx]) => ctx.includes(last)).map(([e]) => e) : [];
  return near.length === 1 ? near[0] : undefined;
}

/**
 * Does this email domain belong to the company? Strict on purpose — a wrong "yes" files a person
 * under the wrong employer and guesses everyone's address there. Yes only when it is the company's
 * known website, the site the profile page itself is on, or the domain starts with the company's
 * first word (kirkland.com for "Kirkland & Ellis") or its initials (wsgr.com, nela-illinois.org).
 * A word shared somewhere in the middle ("employment" in an association's name) is not enough.
 */
export function domainFitsCompany(co: Company, domain: string, pageUrl?: string): boolean {
  if (co.domain === domain || normalizeDomain(co.website) === domain) return true;
  const page = normalizeDomain(pageUrl);
  if (page && (page === domain || page.endsWith(`.${domain}`))) return true;
  const label = domain.split(".").slice(0, -1).join("").replace(/[^a-z0-9]/g, "");
  const words = asciiFold(co.name).split(/[^a-z0-9]+/).filter((w) => w && !["the", "and", "of", "for"].includes(w));
  if (words[0] && words[0].length >= 3 && label.startsWith(words[0])) return true;
  const initials = words.map((w) => w[0]).join("");
  return initials.length >= 3 && (label.startsWith(initials) || (initials.length > 4 && label.startsWith(initials.slice(0, 4))));
}

const isPersonal = (domain: string) => FREEMAIL_DOMAINS.includes(domain);

/**
 * Read the profile pages of people with a profile link and no address yet. Fills `email` and
 * `email_source_url`, moves each person to the employer their address shows, and returns the people
 * whose address is personal (gmail…): their row is finished, no company lookup needed.
 * Mutates `companies` (adds employers, drops a heading shown to be a directory) and the people.
 */
export async function readProfiles(people: Contact[], companies: Map<string, Company>, ctx: Ctx, active: (c: Contact) => boolean): Promise<Contact[]> {
  if (!ctx.profiles) return [];
  const targets = people.filter((p) => p.profile_url && !cleanEmail(p.email) && active(p)).slice(0, PROFILE_LIMITS.perRun);
  if (!targets.length) return [];

  const urls = [...new Set(targets.map((p) => p.profile_url!))];
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += PROFILE_LIMITS.perRequest) batches.push(urls.slice(i, i + PROFILE_LIMITS.perRequest));
  const reads = new Map<string, ProfileRead>();
  await pMap(batches, PROFILE_LIMITS.concurrency, async (batch) => {
    if (ctx.signal?.aborted) return;
    try {
      for (const r of await ctx.profiles!(batch)) reads.set(r.url, r);
    } catch (e) {
      for (const url of batch) reads.set(url, { url, ok: false, note: "the page reader is unavailable right now", emails: [] });
    }
  });

  const direct: Contact[] = [];
  // Per original company: people shown to work elsewhere, and people shown to work there.
  const left = new Map<string, number>();
  const stayed = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  for (const p of targets) {
    const read = reads.get(p.profile_url!);
    if (!read?.ok) {
      p.profile_note = `Couldn't read their profile page${read?.note ? ` (${read.note})` : ""}.`;
      continue;
    }
    const email = profileEmail(p, read.emails);
    if (!email) {
      p.profile_note = read.emails.length ? "Their profile page shows an address, but not clearly theirs." : "No email on their profile page.";
      continue;
    }
    delete p.profile_note;
    p.email = email;
    p.email_source_url = read.url;
    const domain = email.split("@")[1];
    const from = companies.get(p.company_id);
    if (isPersonal(domain)) {
      if (from) bump(left, from.id);
      direct.push(p);
      continue;
    }
    if (from && domainFitsCompany(from, domain, read.url)) {
      bump(stayed, from.id);
      continue;
    }
    if (from) bump(left, from.id);
    let to = [...companies.values()].find((c) => c.domain === domain || normalizeDomain(c.website) === domain);
    if (!to && !isAggregatorDomain(domain)) {
      to = { id: slug(domain), name: domain, patterns: [] };
      companies.set(to.id, to);
    }
    if (to) p.company_id = to.id;
  }

  // A pasted heading (a member directory, an association) whose people turn out to work elsewhere:
  // it isn't their employer, so the rest of its people get no company rather than a wrong guess.
  for (const [id, n] of left) {
    if (n < 2 || stayed.get(id)) continue;
    for (const p of people) if (p.company_id === id) p.company_id = "";
  }
  // Companies whose people all moved out have nothing left to look up.
  for (const id of left.keys()) {
    const co = companies.get(id);
    if (co && !co.role_hint && !people.some((p) => p.company_id === id && !direct.includes(p))) companies.delete(id);
  }

  for (const p of direct) {
    Object.assign(p, {
      candidates: [{ email: p.email!, pattern: "pasted", rank: 1, basis: "seen", verify_status: "unverified" }],
      primary_email: p.email,
      status: "ok",
      note: "Personal address from their profile page.",
    });
  }
  return direct;
}
