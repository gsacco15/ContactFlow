import type { Contact, Pattern, Template } from "./types.ts";
import { SITE_CONFIDENCE } from "./config.ts";
import { inferTemplates } from "./candidates.ts";
import { normalizeName } from "./normalize.ts";
import { isGenericEmail } from "./paste.ts";

/** An address found on the company's own website, with the text around it. */
export type SiteEmail = { email: string; context: string; page: string };
export type SiteRead = { emails: SiteEmail[]; pages: string[]; note?: string };

export type SiteVerdict = {
  /** The proven format, when the evidence is strong enough to trust. */
  pattern?: Pattern;
  /** Best-supported template even when not proven (for the shadow log). */
  template?: Template;
  /** Name-matched addresses supporting `template`. */
  matches: number;
  /** Another template also had name-matched support. */
  conflict?: Template;
};

const SHORT_FORMATS = new Set<Template>(["{first}", "{last}", "{f}{l}", "{f}{m}{l}", "{first}{l}"]);

// Runs of capitalised words near an address ("Contact Sandy Morris Partner"); each 2–3 word
// window is tried as a name, so neighbouring words like "Contact" or "Partner" don't block a match.
const NAME_RE = /\b([A-Z][a-zA-Z'’-]+\.?(?:\s+[A-Z][a-zA-Z'’.-]+){1,5})\b/g;

function windows(run: string): string[] {
  const w = run.split(/\s+/);
  const out: string[] = [];
  for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

/**
 * Which format do the company's own addresses prove? An address counts only when it matches a
 * real name — someone in the paste, or a name printed right next to it on the page. Proven =
 * 2+ name-matched addresses agree, or exactly 1 with no other format seen. Shared inboxes and
 * other domains never count.
 */
export function siteFormat(read: SiteRead, domain: string, people: Contact[]): SiteVerdict {
  const votes = new Map<Template, { emails: string[]; page: string }>();
  const pasted = people.filter((p) => p.first && p.last).map((p) => [p.first, p.middle, p.last].filter(Boolean).join(" "));
  for (const e of read.emails) {
    const [local, d] = e.email.split("@");
    if (d !== domain || isGenericEmail(e.email) || !local) continue;
    // Names near the address first (they are about this address), then everyone in the paste.
    const nearby = [...e.context.matchAll(NAME_RE)].flatMap((m) => windows(m[1]));
    let hit: Template | undefined;
    for (const [name, fromPage] of [...nearby.map((n) => [n, true] as const), ...pasted.map((n) => [n, false] as const)]) {
      const t = inferTemplates(normalizeName(name), local)[0]?.template;
      // Single-word formats ("chicago@" next to "Chicago Office") are too easy to match by
      // accident on a page; they only count against a real person from the paste.
      if (t && fromPage && (t === "{first}" || t === "{last}")) continue;
      if (t) {
        hit = t;
        break;
      }
    }
    if (!hit) continue;
    const v = votes.get(hit) ?? { emails: [], page: e.page };
    if (!v.emails.includes(e.email)) v.emails.push(e.email);
    votes.set(hit, v);
  }
  const ranked = [...votes].sort((a, b) => b[1].emails.length - a[1].emails.length);
  const [top, second] = ranked;
  if (!top) return { matches: 0 };
  const [template, v] = top;
  const n = v.emails.length;
  // Short formats (first@, last@, initials) collide easily — one founder's sam@ says little about
  // everyone else — so they always need 2+ agreeing people. Longer formats: 2+, or 1 uncontested.
  const short = SHORT_FORMATS.has(template);
  const proven = (n >= 2 && (!second || n > second[1].emails.length)) || (n === 1 && !second && !short);
  const verdict: SiteVerdict = { template, matches: n, conflict: second?.[0] };
  if (proven) {
    verdict.pattern = {
      template,
      confidence: n >= 2 ? SITE_CONFIDENCE.multiple : SITE_CONFIDENCE.single,
      source_url: v.page,
      evidence: v.emails.slice(0, 5),
      from_site: true,
      stated: false,
    };
  }
  return verdict;
}
