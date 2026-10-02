import type { Company, Contact, Pattern, Template } from "./types.ts";
import { FREEMAIL_DOMAINS, GENERIC_LOCAL_PARTS, PASTE_CONFIDENCE } from "./config.ts";
import { inferTemplates } from "./candidates.ts";
import { asciiFold, normalizeName } from "./normalize.ts";
import { isAggregatorDomain, isTemplate, normalizeDomain } from "./validate.ts";

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function cleanEmail(e: unknown): string | undefined {
  if (typeof e !== "string") return undefined;
  const s = e.trim().toLowerCase().replace(/^mailto:/, "");
  return EMAIL.test(s) ? s : undefined;
}

const isWorkDomain = (d: string) => !FREEMAIL_DOMAINS.includes(d) && !isAggregatorDomain(d);

/** info@, contact@, intake@… — a shared inbox, never a person. */
export function isGenericEmail(email: string | undefined): boolean {
  const local = email?.split("@")[0]?.toLowerCase() ?? "";
  return !local || GENERIC_LOCAL_PARTS.includes(local.replace(/[0-9]+$/, ""));
}


/**
 * A company's domain from work emails pasted next to its people or in stated examples.
 * Personal providers (gmail…) never count. Majority wins.
 */
export function domainFromPaste(co: Company, people: Contact[]): string | undefined {
  const votes = new Map<string, number>();
  const emails = [...people.map((p) => p.email), ...(co.stated_formats ?? []).map((s) => s.example_email)];
  for (const e of emails) {
    const d = normalizeDomain(cleanEmail(e));
    if (d && isWorkDomain(d)) votes.set(d, (votes.get(d) ?? 0) + 1);
  }
  return [...votes].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * The format an unnamed address shows, only when it is unambiguous: the address contains a
 * surname from the firm's own name. jfairchild@ at "Croke Fairchild…" → {f}{last};
 * kevin.battle@ at "O'Connor & Battle" → {first}.{last}; battle@ → {last}. Anything else → undefined.
 */
export function formatFromAddress(email: string, companyName: string): Template | undefined {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (isGenericEmail(email)) return undefined;
  const words = new Set(asciiFold(companyName).split(/[^a-z]+/).filter((w) => w.length >= 3));
  const sep = /^([a-z]{2,})([._-])([a-z]{2,})$/.exec(local);
  if (sep) {
    const [, a, s, b] = sep;
    if (words.has(b) && !words.has(a)) return ({ ".": "{first}.{last}", _: "{first}_{last}", "-": "{first}-{last}" } as const)[s as "." | "_" | "-"];
    if (words.has(a) && !words.has(b) && s === ".") return "{last}.{first}";
    return undefined;
  }
  if (!/^[a-z]+$/.test(local)) return undefined;
  if (words.has(local)) return "{last}";
  if (local.length >= 4 && words.has(local.slice(1))) return "{f}{last}";
  return undefined;
}

type Vote = { count: number; examples: number; quote?: string; evidence: string[] };

/**
 * Patterns read from the paste itself. Safeguards: an email only counts when it sits next to
 * a named person (or a named example), its domain is the company's, and its local part is
 * explainable from that person's name. Vague statements are dropped at extraction.
 */
export function pastePatterns(co: Company, people: Contact[]): Pattern[] {
  const domain = co.domain;
  if (!domain) return [];
  const votes = new Map<Template, Vote>();
  const vote = (t: Template, opts: { example?: string; quote?: string }) => {
    const v = votes.get(t) ?? { count: 0, examples: 0, evidence: [] };
    v.count++;
    if (opts.example) {
      v.examples++;
      if (!v.evidence.includes(opts.example)) v.evidence.push(opts.example);
    }
    v.quote ??= opts.quote;
    votes.set(t, v);
  };
  const fromExample = (email: string | undefined, fullName: string | undefined, quote?: string, stated?: Template) => {
    const e = cleanEmail(email);
    if (!e || !fullName) return false;
    const [local, d] = e.split("@");
    if (d !== domain) return false;
    const matches = inferTemplates(normalizeName(fullName), local).map((m) => m.template);
    if (!matches.length) return false;
    vote(stated && matches.includes(stated) ? stated : matches[0], { example: e, quote });
    return true;
  };

  for (const p of people) {
    if (!p.first) {
      // Unnamed address: counts only when it plainly shows a surname from the firm's name.
      const e = cleanEmail(p.email);
      const t = e && e.endsWith(`@${domain}`) ? formatFromAddress(e, co.name) : undefined;
      if (t) vote(t, { example: e, quote: `${e} (surname matches the firm name)` });
      continue;
    }
    if (p.email) fromExample(p.email, [p.first, p.middle, p.last].filter(Boolean).join(" "), `${p.email} (${p.first} ${p.last})`);
  }
  for (const s of co.stated_formats ?? []) {
    if (fromExample(s.example_email, s.example_name, s.quote, s.template)) continue;
    const exampleDomain = normalizeDomain(cleanEmail(s.example_email));
    if (isTemplate(s.template) && (!exampleDomain || exampleDomain === domain)) vote(s.template, { quote: s.quote });
  }

  return [...votes]
    .map(([template, v]): Pattern => {
      const confidence = v.count >= 2 ? PASTE_CONFIDENCE.multiple : v.examples ? PASTE_CONFIDENCE.single : PASTE_CONFIDENCE.stated;
      const p: Pattern = { template, confidence, from_paste: true };
      if (v.quote) p.quote = v.quote.slice(0, 200);
      if (v.evidence.length) p.evidence = v.evidence.slice(0, 5);
      return p;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

/** Paste patterns first; search patterns fill the remaining slots. Flags a disagreement on the top pick. */
export function mergePatterns(paste: Pattern[], search: Pattern[]): { patterns: Pattern[]; conflict?: string } {
  const patterns = [...paste, ...search.filter((s) => !paste.some((p) => p.template === s.template))].slice(0, 3);
  const conflict =
    paste[0] && search[0] && paste[0].template !== search[0].template
      ? `your paste says ${paste[0].template}, search says ${search[0].template}`
      : undefined;
  return { patterns, conflict };
}
