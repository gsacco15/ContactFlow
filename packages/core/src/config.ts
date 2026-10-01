import type { Budget } from "./types.ts";

export const DEFAULT_BUDGET: Budget = {
  maxSearchesPerCompany: 4,
  maxRescueCalls: 8,
  rescueThreshold: 0.6,
  cacheTtlDays: 30,
  concurrency: 5,
  maxContacts: 100,
};

/** Paste size that triggers the "run the first N" warning. */
export const LARGE_PASTE_CONTACTS = 500;

/** Domain confidence below this is flagged red in the UI. */
export const LOW_DOMAIN_CONFIDENCE = 0.5;

/**
 * Estimate-only pricing (USD). Per million tokens, plus per web search.
 * Keyed by model-id prefix; the first match wins. Update when prices change.
 */
export const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: "claude-haiku", input: 1, output: 5 },
  { prefix: "claude-sonnet", input: 2, output: 10 },
  { prefix: "claude-opus", input: 4, output: 20 },
];
export const DEFAULT_PRICE = { input: 2, output: 10 };
export const PRICE_PER_SEARCH = 0.01; // $10 per 1,000 searches

export function estimateCost(u: { model?: string; input_tokens: number; output_tokens: number; web_search_requests: number }): number {
  const p = PRICES.find((x) => u.model?.startsWith(x.prefix)) ?? DEFAULT_PRICE;
  return (u.input_tokens * p.input + u.output_tokens * p.output) / 1e6 + u.web_search_requests * PRICE_PER_SEARCH;
}
