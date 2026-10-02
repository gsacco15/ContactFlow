import { DEFAULT_PATTERNS, type Candidate, type Pattern, type Template } from "./types.ts";
import { TEMPLATES } from "./schemas.ts";
import { nicknameVariant, type NormalizedName } from "./normalize.ts";

const MAX = 3;

function fill(template: string, f: string, l: string, m = ""): string | null {
  if (!f && /\{f(irst)?\}/.test(template)) return null;
  if (!l && /\{l(ast)?\}/.test(template)) return null;
  if (!m && template.includes("{m}")) return null;
  const local = template
    .replace("{first}", f)
    .replace("{last}", l)
    .replace("{f}", f[0] ?? "")
    .replace("{m}", m)
    .replace("{l}", l[0] ?? "");
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(local)) return null;
  return local;
}

/** Pattern template without braces, for display/export: "{first}.{last}" → "first.last". */
export function patternLabel(template: string): string {
  return template.replace(/[{}]/g, "");
}

/** Does `template` need a middle initial? */
export const needsMiddle = (template: string) => template.includes("{m}");

/**
 * Which templates turn this name into this local part? An unknown middle initial is
 * treated as a wildcard ("ajb" for Alex Behn → {f}{m}{l}, middle "j").
 */
export function inferTemplates(name: NormalizedName, local: string): { template: Template; middle?: string }[] {
  const out: { template: Template; middle?: string }[] = [];
  const surnames = [name.last, name.lastAlt].filter((x): x is string => !!x);
  for (const t of TEMPLATES) {
    for (const l of surnames.length ? surnames : [""]) {
      if (needsMiddle(t) && !name.middle) {
        const guess = /^[a-z]$/.test(local[1] ?? "") ? local[1] : "";
        if (guess && fill(t, name.first, l, guess) === local) out.push({ template: t, middle: guess });
      } else if (fill(t, name.first, l, name.middle) === local) out.push({ template: t });
      if (out.at(-1)?.template === t) break;
    }
  }
  return out;
}

/**
 * Apply the top patterns to a normalized name. Max 3 candidates, ranked by pattern confidence.
 * Hyphenated surnames fill remaining slots with the first-part variant; nickname variants
 * (opt-in) only take a slot that is still free.
 */
export function generateCandidates(
  name: NormalizedName,
  domain: string,
  patterns: Pattern[],
  opts: { nicknames?: boolean } = {},
): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const push = (p: Pattern, f: string, l: string) => {
    if (out.length >= MAX) return;
    const local = fill(p.template, f, l, name.middle);
    if (!local) return;
    const email = `${local}@${domain}`;
    if (seen.has(email)) return;
    seen.add(email);
    out.push({ email, pattern: p.template, rank: (out.length + 1) as 1 | 2 | 3, verify_status: "unverified" });
  };

  const ranked = patterns.slice().sort((a, b) => b.confidence - a.confidence);
  // Found patterns first; statistical defaults only fill slots that are still free.
  const fallback = DEFAULT_PATTERNS.filter((d) => !ranked.some((p) => p.template === d.template));
  const all = [...ranked, ...fallback];

  push(all[0], name.first, name.last);
  if (name.lastAlt) push(all[0], name.first, name.lastAlt); // Álvarez-Ruiz → also "alvarez"
  for (const p of ranked) push(p, name.first, name.last);
  // Nickname variant (opt-in) outranks statistical fill but never a found pattern.
  const nick = opts.nicknames ? nicknameVariant(name.first) : undefined;
  if (nick) push(all[0], nick, name.last);
  for (const p of fallback) push(p, name.first, name.last);
  return out;
}
