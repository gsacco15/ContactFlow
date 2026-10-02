import { TEMPLATES, INPUT_MODES, EVIDENCE_KINDS, type StageName } from "./schemas.ts";
import type { DecisionProvider } from "./decisions/index.ts";
import type { Verifier } from "./verify/index.ts";

export type Template = (typeof TEMPLATES)[number];
export type InputMode = (typeof INPUT_MODES)[number];
export type { StageName };

export type Pattern = {
  template: Template;
  confidence: number; // 0–1
  source_url?: string; // page the format was read from; absent = statistical default
  evidence?: string[]; // literal emails seen in snippets or the paste
  from_paste?: boolean; // read from the user's own paste, not a search
  quote?: string; // the pasted sentence or example it came from
  stated?: boolean; // the source itself states the format/percentage (vs. the model estimating it)
  from_site?: boolean; // proven from real addresses on the company's own website
  from_evidence?: boolean; // proven by earlier lookups (evidence engine), no search this time
  verified?: boolean; // a mailbox check at this company confirmed an address in this format
};

export type StatedFormat = { quote: string; template?: Template; example_email?: string; example_name?: string };

export const DEFAULT_PATTERNS: Pattern[] = [
  { template: "{first}.{last}", confidence: 0.45 },
  { template: "{first}", confidence: 0.15 },
  { template: "{f}{last}", confidence: 0.15 },
];

export type Company = {
  id: string; // slug of normalized name
  name: string;
  website?: string; // as given in the input
  role_hint?: string; // e.g. "CFO" from "Beta Corp — need CFO"
  stated_formats?: StatedFormat[]; // "the firm uses first initial + last name" lines in the paste
  domain_from_paste?: boolean; // domain taken from a pasted work email
  domain?: string;
  domain_confidence?: number;
  domain_source_url?: string;
  patterns: Pattern[]; // ranked, max 3
  mx_ok?: boolean;
  fetched_at?: string; // ISO date, for cache expiry
  error?: string;
  rescue_note?: string; // gave-up reason or what the rescue agent repaired
  rescued?: boolean; // the rescue agent repaired this company
  pattern_conflict?: string; // paste and search disagree on the top pattern
  skipped?: string; // why the company was not looked up (no people, only flagged people)
  format_verified?: Template; // a mailbox check proved this format at this company
  catch_all?: boolean; // the mail server accepts any address: checks can't prove a format here
  verified_by?: string; // who checked: a provider name, "demo"/"mock" (fake answers) or "earlier check"
  verify_unclear?: boolean; // checks ran but the server gave no clear answer (it hides which addresses exist)
  verify_failed?: boolean; // the verification provider itself failed, so nothing was checked (not charged)
};

export type VerifyStatus = "valid" | "risky" | "invalid" | "catch_all" | "unverified";
export type ContactStatus = "pending" | "ok" | "no_domain" | "no_pattern" | "error" | "skipped";

/**
 * How much stands behind an email:
 *  seen    — the exact address appeared in the paste or a fetched page
 *  sourced — built from a format a source states or the paste proves
 *  guess   — a common format with nothing behind it (hidden unless the user asks)
 */
export type EmailBasis = "seen" | "sourced" | "guess";

export type Candidate = {
  email: string;
  pattern: string;
  rank: 1 | 2 | 3;
  basis: EmailBasis;
  verify_status?: VerifyStatus;
};

export type Contact = {
  id: string;
  first: string;
  middle?: string;
  last: string;
  title?: string;
  company_id: string;
  email?: string; // literal address next to this person in the paste
  flag?: string; // e.g. headline names a different employer — check before running
  keep?: boolean; // user clicked Include: look up despite a flag or the role filter
  drop?: boolean; // user marked them not relevant, whatever the judge said
  fit?: Fit; // relevance to "Looking for", from the decision model
  linkedin_url?: string;
  raw_source: string; // the pasted chunk this came from, for debugging
  candidates: Candidate[]; // max 3
  primary_email?: string; // set when a candidate verifies, else candidates[0]
  status: ContactStatus;
  error?: string;
  note?: string; // non-fatal, e.g. "pattern needs a middle initial"
  rescued?: boolean;
};

export type Fit = { p: number; tier: "yes" | "maybe" | "no"; reason?: string; by: string; for: string };

export type ExtractResult = {
  mode: InputMode;
  companies: Company[];
  people: Contact[];
  urls: string[];
  notes: string;
};

/** Envelope every stage returns. */
export type StageResult<T> = {
  ok: boolean;
  data?: T;
  confidence?: number; // 0–1, as reported by the stage
  sources: string[]; // URLs the result was read from
  tokens_used: number;
  searches_used: number;
  error?: string;
};

// ── LLM transport (implemented by the edge function client, mocked in tests) ──

export type ToolCall = { id: string; name: string; input: any };

export type LlmRequest = {
  stage: StageName;
  /** One-shot stages: the user message (string or JSON-serialisable object). */
  input?: unknown;
  /** Values substituted for {{name}} placeholders in the stage prompt. */
  vars?: Record<string, string>;
  /** Agentic stages: the full message list so far (Anthropic Messages shape). */
  messages?: unknown[];
  maxSearches?: number;
  maxFetches?: number;
};

export type LlmUsage = {
  input_tokens: number; // uncached input (full price)
  output_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
  cache_read_input_tokens?: number; // served from the prompt cache (~0.1× price)
  cache_creation_input_tokens?: number; // written to the prompt cache (~1.25× price)
  verifications?: number; // mailbox checks (priced per check)
};

export type LlmResponse = {
  /** Raw assistant content blocks — append unchanged for the next agentic turn. */
  content: unknown[];
  toolCalls: ToolCall[];
  /** URLs seen in search results / citations during this call. */
  sources: string[];
  usage: LlmUsage;
  model?: string;
  stop_reason?: string;
};

export type UsageEvent = LlmUsage & { stage: StageName | "verify"; model?: string };

export type Cache = {
  get(key: string): Promise<any>;
  set(key: string, value: any, ttlDays: number): Promise<void>;
};

export type Budget = {
  maxSearchesPerCompany: number; // default 4
  maxRescueCalls: number; // default 8
  rescueThreshold: number; // default 0.6 (calibrated decision providers only)
  cacheTtlDays: number; // default 30
  concurrency: number; // companies in parallel, default 5
  maxContacts: number; // default 100
};

export type RunOptions = {
  /** Company-first: titles to look for, e.g. "VP Sales, Head of Growth". */
  roleFilter?: string;
  /** Add a nickname/formal-name variant when a candidate slot is free. */
  nicknames?: boolean;
  /** Run the rescue agent on failed rows. Default true. */
  rescue?: boolean;
  /** Use emails and stated formats found in the paste as pattern evidence. Default true. */
  usePasteEvidence?: boolean;
  /** Skip people the relevance judge marks "no" before any search. Default true. */
  skipIrrelevant?: boolean;
  /** Ignore cached company lookups (used by Retry). */
  bypassCache?: boolean;
  /** Override SITE_READ_MODE (config) for this run. */
  siteMode?: "off" | "shadow" | "on";
  /** Override EVIDENCE_MODE (config) for this run. */
  evidenceMode?: "off" | "shadow" | "on";
  /** Override VERIFY_MODE (config) for this run. */
  verifyMode?: "off" | "button" | "auto";
};

export type Ctx = {
  llm: (req: LlmRequest) => Promise<LlmResponse>;
  cache: Cache;
  decisions: DecisionProvider;
  verifier?: Verifier;
  budget: Budget;
  options?: RunOptions;
  onUsage?: (u: UsageEvent) => void;
  signal?: AbortSignal;
  /** Read the company's own public pages for addresses (edge /site). Free; no AI. */
  site?: (domain: string) => Promise<import("./site.ts").SiteRead>;
  /** Record a site-vs-search comparison during the shadow trial (domain-level, no names). */
  shadow?: (row: SiteShadowRow) => Promise<void>;
  /** Evidence engine store (edge /evidence). Used only when EVIDENCE_MODE / options.evidenceMode isn't "off". */
  evidence?: EvidenceStore;
  /** Mailbox checks (edge /verify, paid provider). Used only when VERIFY_MODE / options.verifyMode isn't "off". */
  mailbox?: MailboxChecker;
};

export interface MailboxChecker {
  /** Provider name, e.g. "zerobounce"; "mock" for tests. */
  name: string;
  /** False for the stand-in: its answers are never recorded as evidence. */
  real: boolean;
  check(emails: string[]): Promise<Record<string, VerifyStatus>>;
}

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** One fact about a domain's email format. Never holds names or addresses. */
export type Evidence = {
  domain: string;
  kind: EvidenceKind;
  /** The format it's about; null for domain-wide facts (mx, catch-all). */
  template: Template | null;
  outcome: "supports" | "contradicts" | "neutral";
  /** 0–1 multiplier, e.g. the percentage a source stated. Default 1. */
  strength?: number;
  /** How many observations this row stands for, e.g. matched addresses on a page. Default 1. */
  count?: number;
  source_url?: string;
  source_name?: string;
  observed_at: string; // ISO
  /** global = reusable for everyone (domain facts); private = this user's paste only, never shared. */
  scope: "global" | "private";
};

export interface EvidenceStore {
  record(rows: Evidence[]): Promise<void>;
  /** Global evidence for a domain, newest first. */
  forDomain(domain: string): Promise<Evidence[]>;
}

export type SiteShadowRow = {
  domain: string;
  site_template: string | null;
  site_matches: number;
  site_pages: number;
  search_template: string | null;
  search_confidence: number | null;
  agree: boolean | null;
};

export type RunResult = {
  extract: ExtractResult;
  companies: Company[];
  contacts: Contact[];
};
