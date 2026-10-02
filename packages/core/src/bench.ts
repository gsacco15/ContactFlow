/**
 * Benchmark: run people whose real address is known through ContactFlow and score the answers.
 * Pure — the CLI (scripts/bench.ts) does the I/O. Answer keys hold real addresses, so they live in
 * bench/data/ (git-ignored); only aggregate reports are meant to be shared.
 */
import type { EnrichPersonOut, EnrichRequest, EnrichResponse } from "./api.ts";

// ── Answer key ───────────────────────────────────────────────────────────────

/** What happened when someone emailed the address. delivered/replied/confirmed = right; bounced = wrong. */
export type BenchOutcome = "delivered" | "replied" | "confirmed" | "bounced";

export type BenchRow = {
  ref: string;
  line: number;
  first: string;
  last: string;
  company: string;
  title?: string;
  domain?: string;
  real_email: string;
  outcome: BenchOutcome;
  source?: string;
};

/** Column names we accept (lower-cased, spaces → _), mapped to our field. */
const HEADER_ALIASES: Record<string, keyof BenchRow> = {
  first: "first", first_name: "first", firstname: "first", given_name: "first",
  last: "last", last_name: "last", lastname: "last", surname: "last", family_name: "last",
  company: "company", company_name: "company", organization: "company", organisation: "company", firm: "company", account: "company",
  title: "title", job_title: "title", position: "title",
  domain: "domain", website: "domain", company_domain: "domain",
  real_email: "real_email", email: "real_email", email_address: "real_email", work_email: "real_email", recipient: "real_email",
  outcome: "outcome", result: "outcome", status: "outcome", delivery_status: "outcome", event: "outcome",
  source: "source",
};

const OUTCOMES: Record<string, BenchOutcome | null> = {
  delivered: "delivered", sent: "delivered", opened: "delivered", clicked: "delivered", delivery: "delivered",
  replied: "replied", reply: "replied", responded: "replied",
  confirmed: "confirmed", valid: "confirmed", verified: "confirmed", correct: "confirmed", known: "confirmed",
  bounced: "bounced", bounce: "bounced", hard_bounce: "bounced", hardbounce: "bounced", invalid: "bounced", undeliverable: "bounced",
  // Ambiguous: says nothing about whether the mailbox exists.
  soft_bounce: null, softbounce: null, deferred: null, unsubscribed: null, spam: null, complaint: null,
};

/** RFC-4180-ish: quoted fields, doubled quotes, commas/newlines inside quotes. Tabs work too. */
export function parseCsv(text: string): string[][] {
  const delim = !text.includes(",") && text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) row.push(field), (field = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += ch;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim()));
}

const EMAIL = /^[^@\s]+@([a-z0-9-]+\.)+[a-z]{2,}$/i;

/** Read an answer-key CSV. Bad rows are reported, not fatal; ambiguous outcomes are skipped. */
export function parseAnswerKey(text: string): { rows: BenchRow[]; errors: string[]; skipped: number } {
  const [header, ...body] = parseCsv(text.replace(/^﻿/, ""));
  if (!header) return { rows: [], errors: ["file is empty"], skipped: 0 };
  const cols = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, "_")]);
  const errors: string[] = [];
  for (const need of ["first", "last", "company", "real_email"] as const) if (!cols.includes(need)) errors.push(`missing a column for ${need}`);
  if (errors.length) return { rows: [], errors, skipped: 0 };

  const rows: BenchRow[] = [];
  let skipped = 0;
  body.forEach((cells, i) => {
    const line = i + 2;
    const get = (k: keyof BenchRow) => {
      const at = cols.indexOf(k);
      return at >= 0 ? (cells[at] ?? "").trim() : "";
    };
    const email = get("real_email").toLowerCase();
    const first = get("first");
    const company = get("company");
    if (!first || !company || !EMAIL.test(email)) return void errors.push(`line ${line}: needs first, company and a valid email`);
    const rawOutcome = get("outcome").toLowerCase().replace(/[\s-]+/g, "_") || "confirmed";
    const outcome = OUTCOMES[rawOutcome];
    if (outcome === null) return void skipped++;
    if (outcome === undefined) return void errors.push(`line ${line}: unknown outcome "${get("outcome")}"`);
    const row: BenchRow = { ref: `r${line}`, line, first, last: get("last"), company, real_email: email, outcome };
    const title = get("title");
    const domain = get("domain").replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").toLowerCase();
    const source = get("source");
    if (title) row.title = title;
    if (domain) row.domain = domain;
    if (source) row.source = source;
    rows.push(row);
  });
  return { rows, errors, skipped };
}

/** Answer key → a v1 request. Real emails are never sent; domains only when asked (`giveDomain`). */
export function toBenchRequest(rows: BenchRow[], opts: { giveDomain?: boolean } = {}): EnrichRequest {
  return {
    version: "v1",
    people: rows.map((r) => ({ ref: r.ref, first: r.first, last: r.last, company: r.company, ...(r.title ? { title: r.title } : {}), ...(opts.giveDomain && r.domain ? { domain: r.domain } : {}) })),
    options: { include_guesses: true, max_emails: 3 },
  };
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export const CONFIDENT = 0.8;
const BUCKETS = [
  { label: "90%+", min: 0.9, max: 1.01 },
  { label: "80–89%", min: 0.8, max: 0.9 },
  { label: "50–79%", min: 0.5, max: 0.8 },
  { label: "under 50%", min: 0, max: 0.5 },
];

export type BenchMeta = { cost_usd: number; seconds: number; companies: number; mode: string; settings: Record<string, string> };

export type RowResult = {
  ref: string;
  expected: string;
  outcome: BenchOutcome;
  got: string[]; // sourced emails, best first
  guesses: string[];
  domain: string | null;
  domain_ok: boolean;
  rank: number | null; // 1–3 among sourced emails, null if not there
  confidence: number | null;
  source: string | null;
  status: string;
};

export type Rate = { n: number; hits: number; rate: number | null };
const rate = (hits: number, n: number): Rate => ({ n, hits, rate: n ? hits / n : null });

export type BenchReport = {
  at: string;
  meta: BenchMeta;
  rows: { total: number; right: number; bounced: number };
  domain: Rate;
  top1: Rate; // sourced email #1 is the real one
  top3: Rate; // real one anywhere in sourced 1–3
  top1_with_guesses: Rate; // counting backup guesses too
  no_answer: Rate; // no sourced email at all
  confident_wrong: Rate; // of confident (≥ 80%) answers, how many were wrong
  bounced_first: Rate; // known-bad address ranked #1
  by_source: Record<string, Rate & { avg_confidence: number | null }>;
  by_confidence: Record<string, Rate>;
  cost: { total: number; per_contact: number | null; per_usable: number | null };
  seconds_per_company: number | null;
  results: RowResult[];
};

const sameDomain = (a: string | null, b: string) => !!a && (a === b || b.endsWith(`.${a}`) || a.endsWith(`.${b}`));

export function scoreBench(rows: BenchRow[], res: EnrichResponse, meta: BenchMeta, at = new Date().toISOString()): BenchReport {
  const byRef = new Map<string, EnrichPersonOut>(res.people.filter((p) => p.ref).map((p) => [p.ref!, p]));
  const results: RowResult[] = rows.map((r) => {
    const p = byRef.get(r.ref);
    const got = (p?.emails ?? []).filter((e) => e.basis !== "guess").map((e) => e.address.toLowerCase());
    const guesses = (p?.emails ?? []).filter((e) => e.basis === "guess").map((e) => e.address.toLowerCase());
    const i = got.indexOf(r.real_email);
    return {
      ref: r.ref,
      expected: r.real_email,
      outcome: r.outcome,
      got,
      guesses,
      domain: p?.domain ?? null,
      domain_ok: sameDomain(p?.domain ?? null, r.real_email.split("@")[1]),
      rank: i >= 0 ? i + 1 : null,
      confidence: p?.pattern?.confidence ?? null,
      source: p?.pattern ? (p.pattern.source === "their site" || p.pattern.source === "your input" ? p.pattern.source : p.pattern.confidence_basis === "estimated" ? "estimated" : (p.pattern.source ?? "other")) : null,
      status: p?.status ?? "missing",
    };
  });

  const right = results.filter((x) => x.outcome !== "bounced");
  const bad = results.filter((x) => x.outcome === "bounced");
  const answered = right.filter((x) => x.got.length);
  const confident = right.filter((x) => x.got.length && (x.confidence ?? 0) >= CONFIDENT);

  const by_source: BenchReport["by_source"] = {};
  for (const x of answered) {
    const k = x.source ?? "other";
    const s = (by_source[k] ??= { ...rate(0, 0), avg_confidence: null });
    s.n++;
    if (x.rank === 1) s.hits++;
    s.avg_confidence = ((s.avg_confidence ?? 0) * (s.n - 1) + (x.confidence ?? 0)) / s.n;
  }
  for (const s of Object.values(by_source)) s.rate = s.n ? s.hits / s.n : null;

  const by_confidence: BenchReport["by_confidence"] = {};
  for (const b of BUCKETS) {
    const inB = answered.filter((x) => (x.confidence ?? 0) >= b.min && (x.confidence ?? 0) < b.max);
    by_confidence[b.label] = rate(inB.filter((x) => x.rank === 1).length, inB.length);
  }

  const usable = right.filter((x) => x.rank === 1).length;
  return {
    at,
    meta,
    rows: { total: results.length, right: right.length, bounced: bad.length },
    domain: rate(right.filter((x) => x.domain_ok).length, right.length),
    top1: rate(usable, right.length),
    top3: rate(right.filter((x) => x.rank !== null).length, right.length),
    top1_with_guesses: rate(right.filter((x) => (x.got[0] ?? x.guesses[0]) === x.expected).length, right.length),
    no_answer: rate(right.filter((x) => !x.got.length).length, right.length),
    confident_wrong: rate(confident.filter((x) => x.rank !== 1).length, confident.length),
    bounced_first: rate(bad.filter((x) => x.got[0] === x.expected).length, bad.length),
    by_source,
    by_confidence,
    cost: { total: meta.cost_usd, per_contact: results.length ? meta.cost_usd / results.length : null, per_usable: usable ? meta.cost_usd / usable : null },
    seconds_per_company: meta.companies ? meta.seconds / meta.companies : null,
    results,
  };
}

// ── Report ───────────────────────────────────────────────────────────────────

const pct = (r: Rate | null | undefined) => (r?.rate == null ? "—" : `${Math.round(r.rate * 100)}%`);
const usd = (n: number | null) => (n == null ? "—" : `$${n.toFixed(n < 1 ? 3 : 2)}`);

function delta(now: Rate, before?: Rate, lowerIsBetter = false): string {
  if (before?.rate == null || now.rate == null) return "";
  const d = Math.round((now.rate - before.rate) * 100);
  if (!d) return " (same)";
  const good = lowerIsBetter ? d < 0 : d > 0;
  return ` (${d > 0 ? "+" : ""}${d} pts ${good ? "▲ better" : "▼ worse"})`;
}

/** Markdown report card — aggregates only, safe to share (no names or addresses). */
export function formatReport(r: BenchReport, prev?: BenchReport): string {
  const L: string[] = [];
  L.push(`# ContactFlow benchmark — ${r.at.slice(0, 16).replace("T", " ")} UTC`);
  L.push("");
  L.push(`${r.rows.total} people (${r.rows.right} known-good, ${r.rows.bounced} known ${r.rows.bounced === 1 ? "bounce" : "bounces"}) · ${r.meta.companies} companies · mode: ${r.meta.mode}${Object.keys(r.meta.settings).length ? ` · ${Object.entries(r.meta.settings).map(([k, v]) => `${k}=${v}`).join(", ")}` : ""}`);
  if (prev) L.push(`Compared with the run on ${prev.at.slice(0, 16).replace("T", " ")}.`);
  L.push("");
  L.push("## Headline");
  L.push("");
  L.push("| | Result | What it means |");
  L.push("|---|---|---|");
  L.push(`| **1st email right** | **${pct(r.top1)}**${delta(r.top1, prev?.top1)} | Of people with a known-good address, how often our #1 email was it |`);
  L.push(`| Right one in top 3 | ${pct(r.top3)}${delta(r.top3, prev?.top3)} | …anywhere in our 3 sourced emails |`);
  L.push(`| **Wrong but confident** | **${pct(r.confident_wrong)}**${delta(r.confident_wrong, prev?.confident_wrong, true)} | Of answers we scored ${CONFIDENT * 100}%+, how many were wrong — keep this low |`);
  L.push(`| Domain right | ${pct(r.domain)}${delta(r.domain, prev?.domain)} | We found the company's real email domain |`);
  L.push(`| No sourced email | ${pct(r.no_answer)}${delta(r.no_answer, prev?.no_answer, true)} | Nothing stated the format, so no answer was given |`);
  L.push(`| 1st right, counting backup guesses | ${pct(r.top1_with_guesses)}${delta(r.top1_with_guesses, prev?.top1_with_guesses)} | If guesses were switched on |`);
  if (r.rows.bounced) L.push(`| Known bounce ranked 1st | ${pct(r.bounced_first)}${delta(r.bounced_first, prev?.bounced_first, true)} | We repeated an address that already bounced |`);
  L.push("");
  L.push("## Do the scores mean what they say?");
  L.push("");
  L.push("| Score shown | People | Actually right |");
  L.push("|---|---|---|");
  for (const [k, v] of Object.entries(r.by_confidence)) if (v.n) L.push(`| ${k} | ${v.n} | ${pct(v)} |`);
  L.push("");
  L.push("## By where the format came from");
  L.push("");
  L.push("| Source | People | 1st right | Average score shown |");
  L.push("|---|---|---|---|");
  for (const [k, v] of Object.entries(r.by_source).sort((a, b) => b[1].n - a[1].n)) L.push(`| ${k} | ${v.n} | ${pct(v)} | ${v.avg_confidence == null ? "—" : `${Math.round(v.avg_confidence * 100)}%`} |`);
  L.push("");
  L.push("## Cost and speed");
  L.push("");
  L.push(`- Total: ${usd(r.cost.total)} · per person ${usd(r.cost.per_contact)} · **per usable contact ${usd(r.cost.per_usable)}**${prev?.cost.per_usable != null && r.cost.per_usable != null ? ` (was ${usd(prev.cost.per_usable)})` : ""}`);
  L.push(`- Time: ${r.seconds_per_company == null ? "—" : `${r.seconds_per_company.toFixed(1)}s`} per company`);
  L.push("");
  return L.join("\n");
}
