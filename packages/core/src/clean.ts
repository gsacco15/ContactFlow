/**
 * Strip LinkedIn page clutter from a paste before the model reads it — and only from a paste
 * that is unmistakably LinkedIn (see isLinkedIn). Every other input is returned untouched.
 * Inside a LinkedIn paste: menus, buttons, footer, messaging overlay, "People also viewed"
 * sections, "• 3rd+" suffixes, letter-less lines, cookie/copyright lines and repeated pages go.
 * Never-remove: a line with an email, URL or domain always stays. The user's paste box is never
 * changed — only what the model reads.
 */

export type CleanResult = { text: string; removedChars: number; packs: string[] };

const UNIVERSAL_DROP = new Set([
  "skip to main content", "skip to content", "skip to search", "skip to navigation", "accept all cookies",
  "accept cookies", "accept all", "reject all", "cookie settings", "manage cookies", "cookie preferences",
]);

/**
 * LinkedIn's own buttons and labels — phrases that are never someone's name or headline.
 * Removed only when they are the whole line. Generic words (Home, Network, Jobs, People,
 * About, Careers…) are deliberately not here: they could be real content.
 */
const LINKEDIN_DROP = new Set([
  "message", "connect", "follow", "show all", "show more", "see all", "1st", "2nd", "3rd+", "all filters",
  "my network", "messaging", "notifications", "for business", "more actions", "compose message", "page inboxes",
  "click to see affiliated inboxes", "are these results helpful?", "your feedback helps us improve search results",
  "keyboard shortcuts", "close jump menu", "new feed updates notifications", "get the linkedin app",
  "retry premium", "retry premium for $0", "try premium for $0", "retry recruiter lite for $0", "reactivate premium",
]);

/**
 * Footer links. Some are ordinary words a person's headline could be ("Advertising",
 * "Careers", "Mobile"), so they are removed only inside LinkedIn's footer block, which starts
 * at an "About" line followed shortly by "Accessibility" / "Help Center" / "Privacy & Terms".
 */
const LINKEDIN_FOOTER = new Set([
  "about", "accessibility", "help center", "privacy & terms", "ad choices", "advertising", "business services",
  "more", "talent solutions", "professional community policies", "careers", "marketing solutions",
  "sales solutions", "mobile", "small business", "safety center", "questions?", "visit our help center.",
  "manage your account and privacy", "go to your settings.", "recommendation transparency",
  "learn more about recommended content.", "select language", "english (english)", "previous", "next",
]);
const FOOTER_START = /^(accessibility|help center|privacy & terms)$/i;

/** Lines that belong to a "People also viewed" item, so a gap followed by one stays in the section. */
const SECTION_ITEM = /^(follow|connect|message|show all)$|page logo$|^[\d,.]+k? followers$|other connections? follows? this page$|•\s*(1st|2nd|3rd\+)$/i;

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
  // Only a recognised LinkedIn paste is touched. Anything else — notes, team pages, CSVs,
  // emails, unknown sources — goes to the model exactly as pasted.
  if (!isLinkedIn(input)) return { text: input, removedChars: 0, packs: [] };
  const lines = input.split(/\r?\n/).map((raw) =>
    raw.trim().replace(/\s*•\s*(1st|2nd|3rd\+)\s*$/i, "").replace(/\s*\((she|he|they)\/(her|him|them|hers|his|theirs)\)/gi, "").trim(),
  );
  const nextFilled = (i: number) => {
    for (let k = i + 1; k < lines.length; k++) if (lines[k]) return lines[k];
    return "";
  };
  // Footer zones: an "About" line with "Accessibility"/"Help Center"/"Privacy & Terms" within the
  // next few lines, up to "LinkedIn Corporation ©" (or 40 lines).
  const footer = new Array<boolean>(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    if (!/^about$/i.test(lines[i])) continue;
    const near = lines.slice(i + 1, i + 8).some((l) => FOOTER_START.test(l));
    if (!near) continue;
    for (let k = i; k < Math.min(lines.length, i + 40); k++) {
      footer[k] = true;
      if (/linkedin corporation ©/i.test(lines[k])) break;
    }
  }

  const out: string[] = [];
  let inSection = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = line.toLowerCase();
    if (!line) {
      // A gap ends a side section unless the next line is clearly still part of it.
      if (inSection && !SECTION_ITEM.test(nextFilled(i))) inSection = false;
      if (out.length && out.at(-1) !== "") out.push("");
      continue;
    }
    const keep = KEEP.test(line);
    if (!keep) {
      if (LINKEDIN_SECTIONS.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection) {
        if (/^show all$/i.test(line)) inSection = false;
        continue;
      }
      if (LINKEDIN_DROP.has(key) || LINKEDIN_DROP_RE.some((r) => r.test(line))) continue;
      if (footer[i] && LINKEDIN_FOOTER.has(key)) continue;
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
  const text = dropRepeatedRuns(out)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, removedChars: Math.max(0, input.length - text.length), packs: ["linkedin"] };
}
