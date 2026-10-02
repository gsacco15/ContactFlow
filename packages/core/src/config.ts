import type { Budget } from "./types.ts";

export const DEFAULT_BUDGET: Budget = {
  maxSearchesPerCompany: 4,
  maxRescueCalls: 4,
  rescueThreshold: 0.6,
  cacheTtlDays: 30,
  concurrency: 5,
  maxContacts: 100,
};

/** Paste size that triggers the "run the first N" warning. */
export const LARGE_PASTE_CONTACTS = 500;

/** Confidence given to patterns read from the paste: one example, 2+ agreeing examples, a format stated in words. */
export const PASTE_CONFIDENCE = { single: 0.85, multiple: 0.95, stated: 0.8 };

/** Personal mail providers — never treated as a company's domain. */
export const FREEMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
  "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "yandex.com",
];

/** Relevance judge: p ≥ yes → ✓, p < no → ✗ (skipped), in between → ? (kept). */
export const FIT_THRESHOLDS = { yes: 0.6, no: 0.3 };

/** Below this, a found pattern counts as a guess, not a sourced format. */
export const MIN_SOURCED_CONFIDENCE = 0.4;

/** Shared inboxes — never treated as a person. */
export const GENERIC_LOCAL_PARTS = [
  "info", "contact", "hello", "admin", "office", "hr", "careers", "jobs", "support", "sales", "team", "mail",
  "inquiries", "inquiry", "intake", "reception", "billing", "marketing", "press", "media", "legal", "help",
  "noreply", "no-reply", "enquiries", "general", "service", "accounts", "law", "firm",
  "webmaster", "postmaster", "abuse", "privacy", "security", "feedback", "enquiry", "customerservice",
  "customercare", "customer", "partners", "partnerships", "investors", "ir", "newsletter", "events",
  "recruiting", "talent", "bookings", "booking", "orders", "returns", "donotreply", "do-not-reply",
  "notifications", "alerts", "news", "frontdesk", "appointments", "accounting", "finance", "payroll",
  "operations", "ops", "it", "tech", "dev", "hire", "hiring", "work", "studio", "agency", "hq", "main",
  // departments, services and functions
  "admissions", "alumni", "clientservices", "clients", "client", "concierge", "compliance", "contracts",
  "dispatch", "donations", "donate", "editor", "editorial", "estimating", "export", "fax", "giving", "grants",
  "helpdesk", "housing", "inbox", "infos", "inquire", "enquire", "insurance", "intern", "interns", "internships",
  "invoice", "invoices", "lab", "library", "licensing", "listings", "mailbox", "maintenance", "management",
  "members", "membership", "merch", "mkt", "noc", "nospam", "notify", "online", "outreach", "owner", "parts",
  "patients", "permissions", "pr", "procurement", "purchasing", "quote", "quotes", "records", "recruitment",
  "referrals", "registrar", "rentals", "reply", "reservations", "resumes", "cv", "root", "safety", "scheduling",
  "school", "secretary", "shop", "social", "sponsorship", "sponsors", "staff", "store", "students",
  "submissions", "subscribe", "subscriptions", "suppliers", "sysadmin", "tickets", "ticket", "training",
  "transport", "travel", "unsubscribe", "updates", "vendor", "vendors", "volunteer", "volunteers", "warehouse",
  "web", "welcome", "wholesale", "workshop", "administrator", "attorneys", "lawyers", "solicitors", "newbusiness",
  "leads", "demo", "trial", "bizdev", "success", "customersuccess", "onboarding", "community", "hey", "hi",
  "ask", "questions", "query", "queries", "requests", "request", "shipping", "delivery", "claims",
  "benefits", "compensation", "learning", "academy", "certification", "partnersupport", "techsupport",
  "itsupport", "servicedesk", "facilities", "front.desk", "front-desk", "office.manager", "officemanager",
  "receptionist", "clerk", "docket", "docketing", "conflicts", "records.dept", "newclient", "newclients",
  "consult", "consultation", "consultations", "appointment", "pressoffice", "communications", "comms",
];

/**
 * Reading the company's own website for real addresses (free, no AI).
 * "off": never. "shadow": read and record agreement with the search, but results come from the
 * search as before. "on": a proven site format is used and the paid search is skipped.
 */
export const SITE_READ_MODE: "off" | "shadow" | "on" = "shadow";
/** Pages read per company, and the confidence a site-proven format gets (1 name-matched address / 2+ agreeing). */
export const SITE_MAX_PAGES = 6;
export const SITE_CONFIDENCE = { single: 0.85, multiple: 0.95 };

/** Days a "searched, no format found" result is remembered (so repeats don't pay again). */
export const NO_FORMAT_CACHE_DAYS = 7;

/** Strip known page clutter (universal rules + recognised-source packs) before the AI reads a paste. */
export const CLEAN_PASTE = false;

/** Domain confidence below this is flagged red in the UI. */
export const LOW_DOMAIN_CONFIDENCE = 0.5;

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
}): number {
  const p = PRICES.find((x) => u.model?.startsWith(x.prefix)) ?? DEFAULT_PRICE;
  const cached = (u.cache_read_input_tokens ?? 0) * CACHE_PRICE.read + (u.cache_creation_input_tokens ?? 0) * CACHE_PRICE.write;
  return ((u.input_tokens + cached) * p.input + u.output_tokens * p.output) / 1e6 + u.web_search_requests * PRICE_PER_SEARCH;
}
