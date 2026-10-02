import type { Contact } from "./types.ts";
import type { DecisionProvider } from "./decisions/index.ts";
import { FIT_THRESHOLDS } from "./config.ts";
import { matchesRoles } from "./roles.ts";

const tier = (p: number) => (p >= FIT_THRESHOLDS.yes ? "yes" : p < FIT_THRESHOLDS.no ? "no" : "maybe");

/** What the judge sees about a person: who they are and where — never an email. */
export function personState(c: Contact, companyName?: string): string {
  const name = [c.first, c.middle, c.last].filter(Boolean).join(" ") || "Unknown name";
  return [`Name: ${name}`, `Title: ${c.title || "(none given)"}`, companyName ? `Company: ${companyName}` : "", c.flag ? `Note: ${c.flag}` : ""]
    .filter(Boolean)
    .join("\n");
}

export const fitQuestion = (description: string) =>
  `This person is a relevant contact for this goal: ${description.trim()}. Judge by their role and seniority; someone with no title is unclear.`;

/**
 * Judge every person against "Looking for" in one batch and store the result on them.
 * Skips people already judged for the same description.
 */
export async function judgeFit(people: Contact[], description: string, decisions: DecisionProvider, companyName: (c: Contact) => string | undefined): Promise<void> {
  const d = description.trim();
  if (!d) return;
  const todo = people.filter((c) => c.fit?.for !== d);
  if (!todo.length) return;
  const scored = await decisions.scoreMany(todo.map((c) => personState(c, companyName(c))), fitQuestion(d));
  todo.forEach((c, i) => {
    const s = scored[i];
    c.fit = { p: s.p, tier: tier(s.p), by: decisions.name, for: d, ...(s.reason ? { reason: s.reason } : {}) };
  });
}

/**
 * Should this person be looked up? Manual keep/drop win; then the judge's verdict (if it ran for
 * the current description); otherwise the plain keyword match.
 */
export function relevance(c: Contact, description: string | undefined): boolean | undefined {
  if (c.keep) return true;
  if (c.drop) return false;
  const d = description?.trim();
  if (!d) return undefined;
  if (c.fit && c.fit.for === d) return c.fit.tier === "no" ? false : true;
  // Without a judge result, only a keyword list ("Partner, Attorney, -Paralegal") filters;
  // a sentence like "decision makers at law firms" must never be keyword-matched.
  return looksLikeKeywords(d) ? matchesRoles(c.title, d) : undefined;
}

export function looksLikeKeywords(s: string): boolean {
  const terms = s.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
  return terms.length > 0 && terms.every((t) => t.replace(/^-/, "").split(/\s+/).length <= 3 && !/[.:!?]/.test(t));
}
