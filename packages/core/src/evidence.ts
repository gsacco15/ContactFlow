/**
 * Evidence engine: keep *why* we believe a domain's email format, not just the answer.
 *
 * Every lookup already produces evidence (a search stating a format, real addresses on the firm's
 * site, the domain's mail servers) — this turns it into rows, stores them, and scores them into
 * "best format for this domain, how sure, and why". Verification and sending logs plug in later
 * as more rows of the same shape. Pure: storage is injected (EvidenceStore).
 */
import { EVIDENCE_KINDS, TEMPLATES } from "./schemas.ts";
import { EVIDENCE_HALF_LIFE_DAYS, EVIDENCE_STRONG, EVIDENCE_WEIGHTS } from "./config.ts";
import type { Evidence, EvidenceKind, EvidenceStore, Pattern, Template, VerifyStatus } from "./types.ts";
import type { SiteVerdict } from "./site.ts";
import { sourceName } from "./validate.ts";

const now = () => new Date().toISOString();
const DOMAIN = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;

// ── Builders: pipeline events → evidence rows ────────────────────────────────

/** Formats a web search reported. Stated percentages count more than estimates. */
export function evidenceFromSearch(domain: string, patterns: Pattern[], at = now()): Evidence[] {
  return patterns
    .filter((p) => p.source_url && !p.from_paste && !p.from_site && !p.from_evidence)
    .map((p) => {
      const own = sourceName(p.source_url, domain) === "their site";
      return {
        domain,
        kind: own ? "site_stated" : p.stated ? "search_stated" : "search_estimated",
        template: p.template,
        outcome: "supports",
        strength: own ? 1 : p.confidence,
        source_url: p.source_url,
        source_name: sourceName(p.source_url, domain),
        observed_at: at,
        scope: "global",
      } satisfies Evidence;
    });
}

/** Real addresses on the company's own site that matched a format (count only — never the addresses). */
export function evidenceFromSite(domain: string, v: SiteVerdict | undefined, sourceUrl?: string, at = now()): Evidence[] {
  if (!v?.template || !v.matches) return [];
  return [{ domain, kind: "site_email", template: v.template, outcome: "supports", count: v.matches, source_url: v.pattern?.source_url ?? sourceUrl, source_name: "their site", observed_at: at, scope: "global" }];
}

/** Does the domain receive mail at all? */
export function evidenceFromMx(domain: string, ok: boolean | undefined, at = now()): Evidence[] {
  return ok === undefined ? [] : [{ domain, kind: ok ? "mx_ok" : "mx_none", template: null, outcome: "neutral", observed_at: at, scope: "global" }];
}

/** A mailbox check on an address built with `template` (v2 verification). */
export function evidenceFromVerification(domain: string, template: Template, status: VerifyStatus, at = now()): Evidence[] {
  if (status === "valid") return [{ domain, kind: "verifier_valid", template, outcome: "supports", observed_at: at, scope: "global" }];
  if (status === "invalid") return [{ domain, kind: "verifier_invalid", template, outcome: "contradicts", observed_at: at, scope: "global" }];
  if (status === "catch_all") return [{ domain, kind: "verifier_catchall", template: null, outcome: "neutral", observed_at: at, scope: "global" }];
  return []; // risky / unverified say nothing
}

/** What happened when someone emailed an address built with `template` (sending logs, benchmark). */
export function evidenceFromOutcome(domain: string, template: Template, outcome: "delivered" | "replied" | "bounced", at = now()): Evidence[] {
  return [{ domain, kind: outcome, template, outcome: outcome === "bounced" ? "contradicts" : "supports", observed_at: at, scope: "global" }];
}

/** A user fixed the format by hand. Private until we decide user corrections may be shared. */
export function evidenceFromCorrection(domain: string, template: Template, at = now()): Evidence[] {
  return [{ domain, kind: "user_correction", template, outcome: "supports", observed_at: at, scope: "private" }];
}

// ── Guard: what may be stored ────────────────────────────────────────────────

/** Validate one row for storage. Rejects anything malformed; strips anything that could carry a person. */
export function cleanEvidence(raw: unknown): Evidence | undefined {
  const r = raw as Partial<Evidence> | undefined;
  if (!r || typeof r !== "object") return undefined;
  const domain = String(r.domain ?? "").toLowerCase();
  if (!DOMAIN.test(domain)) return undefined;
  if (!(EVIDENCE_KINDS as readonly string[]).includes(r.kind as string)) return undefined;
  if (r.template !== null && !(TEMPLATES as readonly string[]).includes(r.template as string)) return undefined;
  if (!["supports", "contradicts", "neutral"].includes(r.outcome as string)) return undefined;
  const at = new Date(String(r.observed_at ?? ""));
  const out: Evidence = {
    domain,
    kind: r.kind as EvidenceKind,
    template: (r.template ?? null) as Template | null,
    outcome: r.outcome as Evidence["outcome"],
    observed_at: Number.isNaN(at.getTime()) ? now() : at.toISOString(),
    scope: r.scope === "private" ? "private" : "global",
  };
  if (typeof r.strength === "number" && Number.isFinite(r.strength)) out.strength = Math.min(1, Math.max(0, r.strength));
  if (typeof r.count === "number" && Number.isFinite(r.count)) out.count = Math.min(100, Math.max(1, Math.floor(r.count)));
  // URLs and names: no addresses, no query strings (they can carry search terms or ids).
  if (typeof r.source_url === "string" && /^https?:\/\/[^\s@]+$/i.test(r.source_url)) out.source_url = r.source_url.split(/[?#]/)[0].slice(0, 300);
  if (typeof r.source_name === "string" && !r.source_name.includes("@")) out.source_name = r.source_name.slice(0, 60);
  return out;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export type TemplateScore = {
  template: Template;
  score: number;
  support: number; // weighted, after decay
  against: number;
  kinds: EvidenceKind[];
  last: string; // newest observation
  source_url?: string; // best supporting source
};

export type DomainVerdict = {
  domain: string;
  /** Ranked, best first. */
  templates: TemplateScore[];
  best?: TemplateScore;
  /** Strong enough to skip the paid search (EVIDENCE_STRONG), with no serious rival. */
  strong: boolean;
  /** A rival format has at least half the best score. */
  conflict: boolean;
  /** A recent check found the domain accepts any address: delivery and checks prove nothing. */
  catch_all: boolean;
  /** Latest mail-server fact, if any. */
  mx?: boolean;
  rows: number;
};

const decay = (observed: string, at: number) => {
  const days = Math.max(0, (at - new Date(observed).getTime()) / 86_400_000);
  return 0.5 ** (days / EVIDENCE_HALF_LIFE_DAYS);
};

/** Score every format seen for a domain. Rows for other domains are ignored. */
export function scoreEvidence(domain: string, rows: Evidence[], at = Date.now()): DomainVerdict {
  const mine = rows.filter((r) => r.domain === domain).sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  const catch_all = mine.some((r) => r.kind === "verifier_catchall" && decay(r.observed_at, at) > 0.5);
  const mxRow = mine.find((r) => r.kind === "mx_ok" || r.kind === "mx_none");

  // Each source counts once: the same page seen on every re-search is one fact, not many
  // (rows are newest first, so the newest sighting is kept). Events without a source —
  // a mailbox check, a delivery — are separate observations and all count.
  const seen = new Set<string>();
  const counted = mine.filter((r) => {
    const src = r.source_url ?? r.source_name;
    if (!src) return true;
    const key = `${r.kind}|${r.template}|${src}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const by = new Map<Template, TemplateScore & { bestSource: number }>();
  for (const r of counted) {
    if (!r.template || r.outcome === "neutral") continue;
    // On a catch-all domain a delivery or "valid" check says nothing about the format.
    if (catch_all && (r.kind === "delivered" || r.kind === "verifier_valid")) continue;
    const w = EVIDENCE_WEIGHTS[r.kind] * (r.strength ?? 1) * Math.min(3, r.count ?? 1) * decay(r.observed_at, at);
    if (!w) continue;
    const t = by.get(r.template) ?? { template: r.template, score: 0, support: 0, against: 0, kinds: [], last: r.observed_at, bestSource: 0 };
    if (r.outcome === "supports") {
      t.support += w;
      if (r.source_url && w > t.bestSource) (t.source_url = r.source_url), (t.bestSource = w);
    } else t.against += w;
    if (!t.kinds.includes(r.kind)) t.kinds.push(r.kind);
    if (r.observed_at > t.last) t.last = r.observed_at;
    t.score = t.support - t.against;
    by.set(r.template, t);
  }
  const templates = [...by.values()].map(({ bestSource: _b, ...t }) => t).sort((a, b) => b.score - a.score);
  const [best, second] = templates;
  const conflict = !!best && !!second && second.score > 0 && second.score >= best.score / 2;
  const strong = !!best && best.score >= EVIDENCE_STRONG.score && (!second || second.score <= 0 || best.score >= EVIDENCE_STRONG.margin * second.score);
  const verdict: DomainVerdict = { domain, templates, strong, conflict, catch_all, rows: mine.length };
  if (best && best.score > 0) verdict.best = best;
  if (mxRow) verdict.mx = mxRow.kind === "mx_ok";
  return verdict;
}

/** A strong verdict as a Pattern the pipeline can use instead of searching. Confidence grows with score. */
export function patternFromEvidence(v: DomainVerdict): Pattern | undefined {
  if (!v.strong || !v.best) return undefined;
  const confidence = Math.round(Math.min(0.97, 1 - 0.4 ** v.best.score) * 100) / 100;
  const p: Pattern = { template: v.best.template, confidence, from_evidence: true, stated: false };
  if (v.best.source_url) p.source_url = v.best.source_url;
  return p;
}

// ── In-memory store (tests, scripts) ─────────────────────────────────────────

export function memoryEvidence(): EvidenceStore & { rows: Evidence[] } {
  const rows: Evidence[] = [];
  return {
    rows,
    async record(list) {
      for (const r of list) {
        const c = cleanEvidence(r);
        if (c) rows.push(c);
      }
    },
    async forDomain(domain) {
      return rows.filter((r) => r.domain === domain && r.scope === "global").sort((a, b) => b.observed_at.localeCompare(a.observed_at));
    },
  };
}
