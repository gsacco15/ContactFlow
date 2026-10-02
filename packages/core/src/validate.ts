import { TEMPLATES } from "./schemas.ts";
import type { Pattern, Template } from "./types.ts";

/** Sites that are never a company's own domain. */
export const AGGREGATOR_DOMAINS = [
  "linkedin.com", "crunchbase.com", "wikipedia.org", "bloomberg.com", "zoominfo.com", "facebook.com",
  "twitter.com", "x.com", "instagram.com", "youtube.com", "glassdoor.com", "indeed.com", "pitchbook.com",
  "rocketreach.co", "signalhire.com", "hunter.io", "leadiq.com", "contactout.com", "apollo.io", "lusha.com",
  "craft.co", "owler.com", "dnb.com", "yelp.com", "github.com", "medium.com", "google.com", "angel.co",
  "wellfound.com", "tracxn.com", "cbinsights.com", "golden.com", "builtin.com", "theorg.com",
];

/** Pages that are login-walled or paid data vendors — never fetched as a team page. */
export const BLOCKED_FETCH_DOMAINS = [
  "linkedin.com", "zoominfo.com", "rocketreach.co", "signalhire.com", "apollo.io", "lusha.com",
  "contactout.com", "leadiq.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
];

const isUnder = (host: string, list: string[]) => list.some((d) => host === d || host.endsWith(`.${d}`));

/** "https://www.Acme.com/about" → "acme.com"; returns null for anything that isn't a hostname. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, "").replace(/^mailto:/, "");
  s = s.split(/[/?#\s]/)[0].replace(/:\d+$/, "").replace(/^www\d?\./, "").replace(/\.$/, "");
  if (s.includes("@")) s = s.split("@").pop()!;
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(s)) return null;
  return s;
}

export function isAggregatorDomain(domain: string): boolean {
  return isUnder(domain, AGGREGATOR_DOMAINS);
}

export function isBlockedUrl(url: string): boolean {
  const host = normalizeDomain(url);
  return !host || isUnder(host, BLOCKED_FETCH_DOMAINS);
}

export function isTemplate(t: unknown): t is Template {
  return typeof t === "string" && (TEMPLATES as readonly string[]).includes(t);
}

const clamp01 = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function cleanUrl(u: unknown): string | undefined {
  if (typeof u !== "string") return undefined;
  const s = u.trim();
  return /^https?:\/\/\S+$/i.test(s) ? s : undefined;
}

/**
 * Keep only patterns whose template is in the allowed union, clamp confidence,
 * keep evidence at the domain, dedupe by template, sort, cap at 3.
 */
export function validatePatterns(raw: unknown, domain?: string): Pattern[] {
  if (!Array.isArray(raw)) return [];
  const byTemplate = new Map<string, Pattern>();
  for (const p of raw) {
    if (!p || !isTemplate(p.template)) continue;
    const pattern: Pattern = { template: p.template, confidence: clamp01(p.confidence) };
    const src = cleanUrl(p.source_url);
    if (src) pattern.source_url = src;
    if (typeof p.stated === "boolean") pattern.stated = p.stated;
    if (Array.isArray(p.evidence)) {
      const ev: string[] = p.evidence
        .filter((e: unknown): e is string => typeof e === "string")
        .map((e: string) => e.trim().toLowerCase())
        .filter((e: string) => /^[^@\s]+@[^@\s]+$/.test(e) && (!domain || e.endsWith(`@${domain}`)));
      if (ev.length) pattern.evidence = [...new Set(ev)].slice(0, 5);
    }
    const prev = byTemplate.get(p.template);
    if (!prev || prev.confidence < pattern.confidence) byTemplate.set(p.template, pattern);
  }
  return [...byTemplate.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
}

export { clamp01 };
