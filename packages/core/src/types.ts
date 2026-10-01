import { TEMPLATES, INPUT_MODES, type StageName } from "./schemas.ts";
import type { DecisionProvider } from "./decisions/index.ts";
import type { Verifier } from "./verify/index.ts";

export type Template = (typeof TEMPLATES)[number];
export type InputMode = (typeof INPUT_MODES)[number];
export type { StageName };

export type Pattern = {
  template: Template;
  confidence: number; // 0–1
  source_url?: string; // page the format was read from; absent = statistical default
  evidence?: string[]; // literal emails seen in snippets
};

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
  domain?: string;
  domain_confidence?: number;
  domain_source_url?: string;
  patterns: Pattern[]; // ranked, max 3
  mx_ok?: boolean;
  fetched_at?: string; // ISO date, for cache expiry
  error?: string;
  rescue_note?: string; // gave-up reason or what the rescue agent repaired
};

export type VerifyStatus = "valid" | "risky" | "invalid" | "catch_all" | "unverified";
export type ContactStatus = "pending" | "ok" | "no_domain" | "no_pattern" | "error";

export type Candidate = {
  email: string;
  pattern: string;
  rank: 1 | 2 | 3;
  verify_status?: VerifyStatus;
};

export type Contact = {
  id: string;
  first: string;
  last: string;
  title?: string;
  company_id: string;
  linkedin_url?: string;
  raw_source: string; // the pasted chunk this came from, for debugging
  candidates: Candidate[]; // max 3
  primary_email?: string; // set when a candidate verifies, else candidates[0]
  status: ContactStatus;
  error?: string;
  rescued?: boolean;
};

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
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
  web_fetch_requests: number;
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

export type UsageEvent = LlmUsage & { stage: StageName; model?: string };

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
  /** Ignore cached company lookups (used by Retry). */
  bypassCache?: boolean;
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
};

export type RunResult = {
  extract: ExtractResult;
  companies: Company[];
  contacts: Contact[];
};
