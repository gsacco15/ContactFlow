// Target-role matching for pasted people: "Partner, Attorney, -Paralegal, -Retired".
// Plain keyword matching, no model call, so it runs before anything is spent.

const norm = (s: string) =>
  ` ${s
    .toLowerCase()
    .replace(/vice[\s-]+president/g, "vp")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;

export function parseRoles(filter: string): { include: string[][]; exclude: string[][] } {
  const terms = filter
    .split(/[,;\n]|\s+or\s+/i)
    .map((t) => t.trim())
    .filter(Boolean);
  const words = (t: string) => norm(t).trim().split(" ").filter(Boolean);
  return {
    include: terms.filter((t) => !t.startsWith("-")).map(words).filter((w) => w.length),
    exclude: terms.filter((t) => t.startsWith("-")).map((t) => words(t.slice(1))).filter((w) => w.length),
  };
}

/**
 * true = keep, false = drop, undefined = can't judge (no filter, or the person has no title).
 * A term matches when all its words appear in the title: "VP Sales" matches "VP of Sales".
 */
export function matchesRoles(title: string | undefined, filter: string | undefined): boolean | undefined {
  if (!filter?.trim()) return undefined;
  const { include, exclude } = parseRoles(filter);
  if (!include.length && !exclude.length) return undefined;
  if (!title?.trim()) return undefined;
  const t = norm(title);
  const hit = (words: string[]) => words.every((w) => t.includes(` ${w} `) || t.includes(` ${w}s `));
  if (exclude.some(hit)) return false;
  return include.length ? include.some(hit) : true;
}
