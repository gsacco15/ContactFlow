import { DEFAULT_BUDGET, LARGE_PASTE_CONTACTS, LOW_DOMAIN_CONFIDENCE } from "@cf/core";

export const EDGE_URL: string = import.meta.env.VITE_EDGE_URL ?? "";
export const ACCESS_TOKEN: string = import.meta.env.VITE_ACCESS_TOKEN ?? "";
export const BUDGET = { ...DEFAULT_BUDGET };
export { LARGE_PASTE_CONTACTS, LOW_DOMAIN_CONFIDENCE };
export const RATE_LIMIT_RETRY_MS = 10_000;
