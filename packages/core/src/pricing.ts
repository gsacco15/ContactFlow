// Prices and the free tier, shared by the browser and the edge function.
// This file must stay import-free: `pnpm edge:sync` copies it into the Deno function, which uses
// it to count real spend against the daily caps.

/**
 * Estimate-only pricing (USD). Per million tokens, plus per web search.
 * Keyed by model-id prefix; the first match wins. Update when prices change.
 */
export const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-haiku", input: 1, output: 5 },
  { prefix: "jev", input: 0.042, output: 0 },
  { prefix: "claude-sonnet", input: 2, output: 10 },
  { prefix: "claude-opus", input: 4, output: 20 },
];
export const DEFAULT_PRICE = { input: 2, output: 10 };
export const PRICE_PER_SEARCH = 0.01; // $10 per 1,000 searches

/** Prompt-cache pricing relative to the input price: reads and 5-minute writes. */
export const CACHE_PRICE = { read: 0.1, write: 1.25 };

export function estimateCost(u: {
  model?: string;
  input_tokens: number;
  output_tokens: number;
  web_search_requests: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  verifications?: number;
}): number {
  const p = PRICES.find((x) => u.model?.startsWith(x.prefix)) ?? DEFAULT_PRICE;
  const cached = (u.cache_read_input_tokens ?? 0) * CACHE_PRICE.read + (u.cache_creation_input_tokens ?? 0) * CACHE_PRICE.write;
  return ((u.input_tokens + cached) * p.input + u.output_tokens * p.output) / 1e6 + u.web_search_requests * PRICE_PER_SEARCH + (u.verifications ?? 0) * PRICE_PER_VERIFY;
}

/** Cost of one check. MillionVerifier: 2,000 credits for $4.90 = $0.00245 (Oct 2026). */
export const PRICE_PER_VERIFY = 0.00245;

/**
 * Free use, paid by the site: a dollar ceiling for the whole site per UTC day, and a smaller one per
 * visitor (hashed IP) — about 3 searches. People who add their own Claude key aren't counted.
 * The edge function's CF_DAILY_BUDGET_USD / CF_FREE_PER_VISITOR_USD override these.
 */
export const FREE_TIER = { dailyUsd: 20, perVisitorUsd: 0.25 };
