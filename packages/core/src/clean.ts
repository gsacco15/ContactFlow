/**
 * Strip page clutter from a paste before the model reads it. Three layers:
 *  1. Universal rules — safe for any text: blank-line runs, letter-less lines, exact repeats,
 *     repeated multi-line blocks, cookie banners / "skip to content" / copyright lines.
 *  2. Source packs — only when the paste is recognised (today: LinkedIn): menus, buttons,
 *     footer, messaging overlay, "People also viewed" sections, "• 3rd+" suffixes.
 *  3. Never-remove — a line with an email, URL or domain is never dropped by rules 1–2.
 * Unknown sources only get layer 1, and if cleaning would remove most of an unrecognised paste,
 * the original is returned untouched. The user's paste box is never changed — only what the
 * model reads.
 */

export type CleanResult = { text: string; removedChars: number; packs: string[] };

const UNIVERSAL_DROP = new Set([
  "skip to main content", "skip to content", "skip to search", "skip to navigation", "accept all cookies",
  "accept cookies", "accept all", "reject all", "cookie settings", "manage cookies", "cookie preferences",
]);

const LINKEDIN_DROP = new Set([
  "home", "network", "my network", "jobs", "messaging", "notifications", "me", "for business", "search",
  "message", "connect", "follow", "following", "view", "show all", "show more", "see all", "1st", "2nd", "3rd+",
  "locations", "current company", "all filters", "reset", "previous", "next", "people", "posts", "about",
  "accessibility", "help center", "privacy & terms", "ad choices", "advertising", "business services",
  "get the linkedin app", "more", "talent solutions", "professional community policies", "careers",
  "marketing solutions", "sales solutions", "mobile", "small business", "safety center", "questions?",
  "visit our help center.", "manage your account and privacy", "go to your settings.", "recommendation transparency",
  "learn more about recommended content.", "select language", "english (english)", "compose message", "page inboxes",
  "click to see affiliated inboxes", "are these results helpful?", "your feedback helps us improve search results",
  "keyboard shortcuts", "close jump menu", "new feed updates notifications", "pending", "save", "more actions",
  "retry premium", "retry premium for $0", "try premium for $0", "retry recruiter lite for $0", "reactivate premium",
]);

const LINKEDIN_DROP_RE = [
  /^\d+ (new )?(notifications?|messages?)( total| notifications)?$/i,
  /linkedin corporation ©/i,
  /^messaging\s*you are on the messaging overlay/i,
  /^you are on the messaging overlay/i,
  /status is (online|offline|away)$/i,
  /^view .{1,80}[’']s? profile$/i,
  /^(1st|2nd|3rd)\+? degree connection$/i,
  /^[\d,.]+k? followers$/i,
  /other connections? follows? this page$/i,
  /page logo$/i,
  /^retry .{1,40} for \$0$/i,
];

/** Side sections that list *other* people or companies — skipped up to their "Show all". */
const LINKEDIN_SECTIONS = /^(pages )?people (also viewed|also follow|you may know)|^more profiles for you|^people also follow|^explore premium profiles/i;

const KEEP = /@|https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|law|legal|us|uk|ca|ai|app|biz)\b/i;
const NO_LETTERS = /^[^\p{L}@]*$/u;

/** LinkedIn only when at least one unmistakable marker is present; common words alone never count. */
function isLinkedIn(text: string): boolean {
  const strong = [/•\s*(1st|2nd|3rd\+)/, /linkedin corporation ©/i, /degree connection/i, /you are on the messaging overlay/i, /^view .+[’']s? profile$/im].filter((r) => r.test(text)).length;
  const weak = (/^message$/im.test(text) ? 1 : 0) + (/^connect$/im.test(text) ? 1 : 0) + (/^linkedin member$/im.test(text) ? 1 : 0);
  return strong >= 2 || (strong >= 1 && weak >= 1);
}

const RUN = 4; // lines in a row that must repeat before a copy counts as a duplicate

/** Drop later copies of any run of RUN+ identical consecutive lines (the same page pasted twice). */
function dropRepeatedRuns(lines: string[]): string[] {
  const idx = lines.map((l, i) => (l ? i : -1)).filter((i) => i >= 0);
  const firstAt = new Map<string, number>();
  const removed = new Set<number>();
  for (let k = 0; k + RUN <= idx.length; k++) {
    if (removed.has(idx[k])) continue;
    const key = idx.slice(k, k + RUN).map((i) => lines[i]).join("\n");
    const j = firstAt.get(key);
    if (j === undefined || j + RUN > k) {
      if (j === undefined) firstAt.set(key, k);
      continue;
    }
    let n = 0;
    while (k + n < idx.length && j + n < k && lines[idx[k + n]] === lines[idx[j + n]]) removed.add(idx[k + n++]);
  }
  return lines.filter((_, i) => !removed.has(i));
}

export function cleanPaste(input: string): CleanResult {
  const packs = isLinkedIn(input) ? ["linkedin"] : [];
  const li = packs.includes("linkedin");
  const out: string[] = [];
  let skipSection = 0;

  for (const raw of input.split(/\r?\n/)) {
    let line = raw.trim();
    const key = line.toLowerCase();
    if (li) {
      line = line.replace(/\s*•\s*(1st|2nd|3rd\+)\s*$/i, "").replace(/\s*\((she|he|they)\/(her|him|them|hers|his|theirs)\)/gi, "").trim();
    }
    if (!line) {
      if (out.length && out.at(-1) !== "") out.push("");
      continue;
    }
    const keep = KEEP.test(line);
    if (li && !keep) {
      if (LINKEDIN_SECTIONS.test(line)) {
        skipSection = 30;
        continue;
      }
      if (skipSection > 0) {
        skipSection--;
        if (/^show all$/i.test(line)) skipSection = 0;
        continue;
      }
      if (LINKEDIN_DROP.has(key) || LINKEDIN_DROP_RE.some((r) => r.test(line))) continue;
    }
    if (!keep) {
      if (NO_LETTERS.test(line)) continue;
      if (UNIVERSAL_DROP.has(key)) continue;
      if (line.length < 90 && (/^©\s?\d{4}/.test(line) || /all rights reserved\.?$/i.test(line))) continue;
    }
    // Exact repeat of the previous kept line (e.g. a name printed twice).
    const prev = [...out].reverse().find((x) => x !== "");
    if (prev === line) continue;
    out.push(line);
  }

  // The same page pasted twice: later copies of long identical runs go. Short repeats stay
  // (two people titled "Partner" are different people).
  let text = dropRepeatedRuns(out)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Safety cap: an unrecognised paste that would lose most of its text is left alone.
  if (!packs.length && text.length < input.trim().length * 0.3) text = input.trim();
  return { text, removedChars: Math.max(0, input.length - text.length), packs };
}
