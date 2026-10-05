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
/** Bio pages (/attorneys/jane-doe) read on top of SITE_MAX_PAGES — where firms usually print addresses. */
export const SITE_BIO_PAGES = 4;
export const SITE_CONFIDENCE = { single: 0.85, multiple: 0.95 };
/** Highest confidence a third-party page (RocketReach, ContactOut…) can give a format. Their "100%"
 * often rests on 2–3 addresses; only the firm's own site, the paste or verification go higher. */
export const THIRD_PARTY_MAX_CONFIDENCE = 0.95;

/** Days a "searched, no format found" result is remembered (so repeats don't pay again). */
export const NO_FORMAT_CACHE_DAYS = 7;

/** Strip known page clutter (universal rules + recognised-source packs) before the AI reads a paste. */
export const CLEAN_PASTE = true;

/** Domain confidence below this is flagged red in the UI. */
export const LOW_DOMAIN_CONFIDENCE = 0.5;

/** Size limits for one JSON enrich request (API, MCP, ChatGPT app). */
export const API_LIMITS = { people: 200, companies: 50, textChars: 50_000, field: 200 };

/**
 * MCP server (ChatGPT / Claude apps): one tool call must finish inside the host's timeout, so
 * find_emails takes a few companies at a time — the host model calls it again for more.
 */
export const MCP_LIMITS = { companiesPerCall: 3, peoplePerCall: 25 };

/**
 * Evidence engine. "off": nothing recorded or read. "shadow": record evidence from every lookup,
 * change nothing. "on": strong evidence for a domain skips the paid format search.
 */
export const EVIDENCE_MODE: "off" | "shadow" | "on" = "shadow";
/** How much one piece of evidence counts. Explicit weights, not calibrated probabilities — the
 * benchmark is what tunes them. Contradicting kinds subtract. */
export const EVIDENCE_WEIGHTS = {
  site_email: 0.7, // per matched address, up to 3
  site_stated: 0.8,
  search_stated: 0.4, // × the source's percentage
  search_estimated: 0.15, // × the estimate
  paste_email: 0.7,
  paste_stated: 0.8,
  verifier_valid: 1.0,
  verifier_invalid: 1.0,
  delivered: 0.5, // weaker: a catch-all server accepts anything
  replied: 1.0,
  bounced: 0.9,
  user_correction: 0.9,
  verifier_catchall: 0,
  mx_ok: 0,
  mx_none: 0,
} as const;
/** Evidence counts half as much after this many days (firms change formats). */
export const EVIDENCE_HALF_LIFE_DAYS = 180;
/** Rows are deleted after this long. */
export const EVIDENCE_TTL_DAYS = 365;
/** "Strong enough to skip the search": best score at least `score`, and `margin`× the runner-up. */
export const EVIDENCE_STRONG = { score: 1.5, margin: 2 };

/**
 * Email verification (mailbox checks through a paid provider in the edge function).
 * "off": no checks. "button": only when someone clicks Verify / Verify all. "auto": during every
 * search (sample one person per firm). Off until a provider is chosen; later per plan (pro
 * accounts). ?verify=button or ?verify=auto tries it in one browser.
 */
export const VERIFY_MODE: "off" | "button" | "auto" = "button";
/** At most this many checks per company per run: sample one person, try their emails in order. */
export const VERIFY_LIMITS = { perCompany: 3, secondPerson: 1 };
/** Confidence shown for a format a mailbox check proved at this company. */
export const VERIFIED_CONFIDENCE = 0.97;

// Pricing, the free tier and estimateCost live in pricing.ts (import-free: the edge function uses it too).
export * from "./pricing.ts";
