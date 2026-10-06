export type NormalizedName = { first: string; last: string; middle?: string; firstAlt?: string; lastAlt?: string };

const HONORIFICS = new Set(["dr", "mr", "mrs", "ms", "miss", "mx", "prof", "sir", "dame", "rev", "hon"]);
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
const CREDENTIALS = new Set([
  "phd", "mba", "md", "cpa", "esq", "jd", "cfa", "pmp", "msc", "ma", "ba", "bsc", "pe", "rn",
  "dds", "cfp", "mph", "edd", "dphil", "frcs", "facs", "llm", "ceng", "pmp", "csm", "shrm",
]);
const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "da", "di", "du", "la", "le", "st", "dos", "das", "ter", "ten", "bin", "al", "el"]);

// Letters NFD does not decompose.
const SPECIAL: Record<string, string> = { ø: "o", æ: "ae", œ: "oe", ß: "ss", ł: "l", đ: "d", ð: "d", þ: "th", ı: "i" };

/** Lowercase, strip accents/emoji/punctuation; keeps letters, digits, spaces and hyphens. */
export function asciiFold(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[øæœßłđðþı]/g, (c) => SPECIAL[c] ?? c);
}

/** Remove LinkedIn connection badges, pronouns, emoji and other non-name noise from a display name. */
export function cleanDisplayName(raw: string): string {
  return raw
    .replace(/\(.*?\)|\[.*?\]/g, " ") // (she/her), [Bob]
    .replace(/["“”«»][^"“”«»]*["“”«»]/g, " ") // quoted nicknames
    .replace(/[•·]\s*(1st|2nd|3rd\+?)\b/gi, " ")
    .replace(/\b(1st|2nd|3rd\+?)\b/gi, " ")
    .replace(/\b(she|he|they)\s*\/\s*(her|him|them|hers|his|theirs)\b/gi, " ")
    .replace(/\p{Extended_Pictographic}|\p{Emoji_Modifier}|‍|️/gu, " ")
    .replace(/[+=]\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?\b|\b[A-Z]{1,3}\d+:[A-Z]{1,3}\d+\b/g, " ") // spreadsheet leftovers ("Barker+A7:D23", "A7:D23")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Turn a display name into email-ready first/last tokens.
 * Order: clean → drop credentials after comma → fold accents → drop apostrophes/periods →
 * split on space → strip honorifics/suffixes/credentials → first token = first, last token = last,
 * first middle token's initial = middle.
 * Hyphenated last names give `last` joined and `lastAlt` first part only.
 */
export function normalizeName(raw: string): NormalizedName {
  let s = cleanDisplayName(raw).replace(/,.*$/, ""); // ", MBA" / ", PhD"
  s = asciiFold(s).replace(/['’`.]/g, "").replace(/[^a-z0-9\s-]/g, " ");
  const tokens = s.split(/\s+/).map((t) => t.replace(/^-+|-+$/g, "")).filter(Boolean);

  while (tokens.length > 1 && HONORIFICS.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && (SUFFIXES.has(tokens.at(-1)!) || CREDENTIALS.has(tokens.at(-1)!))) tokens.pop();

  const first = (tokens[0] ?? "").replace(/-/g, "");
  if (tokens.length < 2) return { first, last: "" };

  // Surname particles: "Ludwig van Beethoven" → vanbeethoven (alt: beethoven)
  let i = tokens.length - 1;
  while (i > 1 && PARTICLES.has(tokens[i - 1])) i--;
  const lastTokens = tokens.slice(i);
  const lastRaw = lastTokens.join("");
  const out: NormalizedName = { first, last: lastRaw.replace(/-/g, "") };
  const middle = tokens.slice(1, i).find((t) => /^[a-z]/.test(t));
  if (middle) out.middle = middle[0]; // initial only, for {m} templates

  if (lastTokens.length > 1) out.lastAlt = lastTokens.at(-1)!.replace(/-/g, "");
  else if (lastRaw.includes("-")) out.lastAlt = lastRaw.split("-")[0];
  if (out.lastAlt === out.last) delete out.lastAlt;
  return out;
}

/** Stable id from free text: "Acme, Inc." → "acme". */
export function slug(s: string): string {
  return asciiFold(s)
    .replace(/[,.]?\s+(inc|incorporated|llc|ltd|limited|gmbh|corp|corporation|co|plc|sa|ag|bv|pty)\.?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Common nickname ↔ formal pairs. Used only when nickname expansion is enabled.
export const NICKNAMES: Record<string, string> = {
  bob: "robert", rob: "robert", bobby: "robert", bill: "william", will: "william", billy: "william", liz: "elizabeth",
  beth: "elizabeth", betty: "elizabeth", jim: "james", jimmy: "james", mike: "michael", mick: "michael",
  dave: "david", dan: "daniel", danny: "daniel", tom: "thomas", tommy: "thomas", chris: "christopher",
  matt: "matthew", nick: "nicholas", tony: "anthony", joe: "joseph", joey: "joseph", steve: "steven",
  ben: "benjamin", sam: "samuel", alex: "alexander", andy: "andrew", drew: "andrew", greg: "gregory",
  jeff: "jeffrey", jon: "jonathan", kate: "katherine", katie: "katherine", kathy: "katherine",
  jen: "jennifer", jenny: "jennifer", sue: "susan", pat: "patrick", rick: "richard", rich: "richard",
  dick: "richard", ed: "edward", ted: "edward", ken: "kenneth", larry: "lawrence", ron: "ronald",
  tim: "timothy", pete: "peter", fred: "frederick", charlie: "charles", chuck: "charles", meg: "margaret",
  maggie: "margaret", peggy: "margaret", abby: "abigail", becky: "rebecca", vicky: "victoria", nate: "nathan",
  zach: "zachary", josh: "joshua", jake: "jacob", ally: "allison", manny: "manuel", pam: "pamela",
};
const FORMAL_TO_NICK: Record<string, string> = {};
for (const [nick, formal] of Object.entries(NICKNAMES)) FORMAL_TO_NICK[formal] ??= nick;

/** The other half of a nickname pair, if known: bob → robert, robert → bob. */
export function nicknameVariant(first: string): string | undefined {
  return NICKNAMES[first] ?? FORMAL_TO_NICK[first];
}
