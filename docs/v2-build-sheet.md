# ContactFlow v2 — build sheet

v1 shipped: paste → people → domain → sourced email format → up to 3 emails, "Looking for"
(Jev), find people on company sites, rescue agent, stacked searches, CSV / Copy / Google Sheets,
How it works, logo. This sheet is the v2 plan: what to build, in what order, where it goes in the
code, and how to know it's done.

Rules from `CLAUDE.md` still hold for every item: `packages/core` stays free of React / Deno /
Supabase / Node imports; `schemas.ts` stays import-free; prompts live in `/prompts`; model ids,
budgets and thresholds come from env or `config.ts`; paid keys live only in the edge function;
never fetch linkedin.com or login-walled pages.

## At a glance

| # | Feature | Why | Size | Running cost |
|---|---|---|---|---|
| 1 | Email verification | "Emails you can trust", literally: valid / risky / catch-all / invalid per email | M | ≈ $0.003–0.01 per email checked |
| 1b | ChatGPT app (lightweight MCP) | ContactFlow inside ChatGPT: it reads the paste, our tools find domain, format and emails | S–M | ≈ cents per company, cached; per-user limits |
| 2 | HubSpot push | Results straight into the CRM, deduped | M | free (user's HubSpot) |
| 3 | Lead score + best-first sort | Long lists come out prioritised | S | ≈ $0 (reuses Jev scores) |
| 4 | "Try harder" button | Rescue the firms you care about without raising every run's cost | S | ≈ $0.05–0.20 per click |
| 5 | Google Sheets: update existing rows (opt-in) | Master sheet improves over time | S | free |
| 6 | Names for email-only rows | `emery.harlan@x.com` → Emery Harlan instead of Unknown | S | free |
| 7 | Bring your own model (Sign in with ChatGPT / own key) | Users pay their own model cost; model choice; OpenAI fast model as a Jev alternative | L | moves to the user |
| 8 | Platform: API + MCP + plugins | Text in → contacts out from anywhere: Postman / code, AI agents, Zapier, ChatGPT / Claude apps | L | per call (operator or caller's key) |
| — | Accounts / list on every device | Deferred: means storing names server-side (privacy decision first) | L | — |
| — | Parallel researcher agents (Agent SDK) | Deferred: not needed at ≤ 100 contacts per run | — | — |

Suggested order: 1 → 1b → 3 → 2 → 4 → 5 → 6, with 7 pulled forward if cost is what's blocking a
public launch. 1b's prototype can start before 1 finishes (verify_email is added to it when 1 lands). 8 after 1 (an API that returns verified emails is the stronger product) and alongside 7
(API callers need keys and billing).

---

## 1. Email verification

**What changes for the user.** Each person's top email gets a badge: ✓ valid, ~ risky, ◎ catch-all,
✗ invalid. A valid candidate becomes Email 1; invalid ones drop to the bottom (and out of exports
unless backups are on). "Only rows with an email" gains "Only verified".

**Build.**
- Edge function: new route `POST /verify` `{ emails: string[] }` → `{ [email]: VerifyStatus }`.
  Provider key (`CF_VERIFIER`, `CF_VERIFIER_KEY`) lives only here. Per-email cache in `cf_cache`
  (`verify:<email>`, 30 days) so re-runs are free. Log counts to `cf_usage` (stage `verify`).
- Core: `RemoteVerifier implements Verifier` (`packages/core/src/verify/`) calling an injected
  `verify(emails)` — no network code in core. Keep `domainLive` from `MxVerifier` (compose them).
- Runner already calls `ctx.verifier.verify(...)` and promotes `valid` to `primary_email`
  (`runner.ts`, end of `applyCompany`). Add a budget: verify **only the top candidate** by default,
  the next one only if the first is invalid (`DEFAULT_BUDGET.maxVerifyPerContact`, default 2).
- Skip verification for `basis: "seen"` (address was in the paste) and for catch-all domains once
  known (one catch-all answer marks the domain; store on `Company`).
- UI: badge in `Email` cell; filter; cost counter adds verify cost (`PRICES.verify` in `config.ts`).
- CSV already has `verify_status`; it starts carrying real values.

**Decide first.** Provider: ZeroBounce, NeverBounce or Hunter (price per check, catch-all handling,
rate limits). One adapter only.

**Done when.** Mock provider in `scripts/mock-anthropic.mjs` (or a sibling mock) drives an
end-to-end run: valid promoted to Email 1, invalid demoted, cached second run makes zero verify
calls; unit tests for the budget and catch-all short-circuit; counter matches `cf_usage`.

## 1b. ChatGPT app (lightweight MCP)

**What changes for the user.** In ChatGPT: paste a LinkedIn page or say "find emails for the
partners at these 5 firms". ChatGPT reads the names itself and calls ContactFlow's tools; the answer
is a table with emails and sources. Same cache as the website.

**Why it's light.** The host model orchestrates, so each tool is a short call (seconds) — no job
queue, no server-side runs (unlike item 8's REST API).

**Tools (MCP, remote over HTTP).**

| Tool | Does | Backed by |
|---|---|---|
| `find_domain(company, hint?)` | Official domain + source URL + confidence | `resolveDomain` + `company:` cache |
| `find_email_format(domain)` | Up to 3 formats, confidence (stated or estimated), source URLs | `discoverPattern` + `domain:` cache |
| `build_emails(first, last, middle?, domain, formats)` | Up to 3 ranked emails with basis | `candidates.ts` (pure, free) |
| `check_domain(domain)` | Accepts mail? (MX) | `/mx` logic |
| `verify_email(email)` *(after item 1)* | valid / risky / catch-all / invalid | item 1's `/verify` |

Tool descriptions tell the model: sourced beats guess; never present a guess as confirmed; never
fetch LinkedIn (the server refuses anyway).

**Build.**
- New Supabase function `mcp` (Deno) using the MCP TypeScript SDK; imports core stages directly
  (core is host-agnostic) and shares `lib.ts` (keys, `WEB_TOOLS`, `FETCH_BLOCKED_DOMAINS`).
- Per-user limits: anonymous IP / OAuth subject quota (e.g. 20 companies/day free), logged to
  `cf_usage` with stage `mcp:<tool>`.
- Privacy page: a ChatGPT section (names pass through tool calls, never stored).
- Later: a results-table widget (Apps SDK UI component) and app-directory submission.

**Check first.** Current OpenAI Apps SDK / app directory requirements (auth, review rules, widget
format, rate limits) — newer than what this plan was written from.

**Done when.** Connected in ChatGPT developer mode; a firm list returns a table with sourced
emails; repeat firms hit the cache (zero searches); quota returns a clear message; LinkedIn URLs
are refused.

## 2. HubSpot push

**What changes.** Push to… → HubSpot → Connect → Send. Creates or updates contacts (matched by
email) and associates them with a company (matched by domain). Reports "Created 12 · Updated 3".

**Build.**
- OAuth app in HubSpot (scopes: `crm.objects.contacts.write`, `crm.objects.companies.write`, read
  equivalents). The token exchange needs a client secret → an edge route `POST /crm/hubspot/*`
  (secret in Supabase secrets, never in the browser). Store nothing server-side but the
  short-lived exchange; the access token returns to the browser (session only), like Sheets.
- Core: `HubSpotAdapter implements CrmAdapter` using `toCrmRecords` (exists in
  `packages/core/src/crm/`). Batch upsert (100 per call), companies first, then contacts +
  associations.
- Field map: first, last, title, email (primary), company, domain, `contactflow_source` (pattern
  source URL), `contactflow_confidence`. Never overwrite a non-empty HubSpot email.
- UI: replace "HubSpot & other CRMs — coming later" in `PushMenu.tsx`.

**Done when.** Mocked HubSpot API tests: create, update-by-email, company association, partial
failure reported per record; one real push to a HubSpot test portal.

## 3. Lead score + best-first sort

**What changes.** A score column (0–100) and "Sort: best first". Partners and decision-makers rise
to the top; exported with the CSV / Sheet.

**Build.**
- Score = Jev's fit `p` (already stored as `contact.fit`) × a seniority weight from the title
  (`packages/core/src/fit.ts`: small table — owner/partner/C-level/VP/director/manager/staff) ×
  email quality (sourced 1.0, guess 0.5, verified-valid bonus once #1 ships).
- Weights in `config.ts`. Pure function, no new calls.
- UI: sort select next to Group by; score badge on hover in `FitBadge`.
- CSV: `score` column (append; don't reorder existing columns).

**Done when.** Unit tests for the scoring table; sorting stable inside groups.

## 4. "Try harder" button

**What changes.** On a company that still failed after the automatic rescue: a Try harder button.
One bigger rescue (8 steps), only when clicked; shows its cost after.

**Build.** `rerunCompany` with `ctx.budget.maxRescueCalls = TRY_HARDER_STEPS` (config) and the
"rescue once per company" guard reset for that call. Button in `ResultsTable.tsx` beside Retry on
failed rows / the no-contacts list.

**Done when.** Test: budget honoured, second click allowed, normal runs unchanged.

## 5. Google Sheets: update existing rows (opt-in)

**What changes.** Checkbox in the Sheets panel: "Also update emails for people already in the
sheet". Touches only ContactFlow's columns, only when the new result is better (sourced beats
guess; verified-valid beats sourced). Result line: "Updated 3 · Added 12".

**Build.** `appendNew` in `packages/web/src/lib/googleSheets.ts` grows an `update` option:
`values.batchUpdate` for matched rows, limited to our header names; never cells under columns we
didn't write.

**Done when.** Fake-Google tests (existing pattern in `test/export.test.ts`): user columns untouched,
worse results don't overwrite better ones.

## 6. Names for email-only rows

**What changes.** A pasted `emery.harlan@acme.com` with no name shows "Emery Harlan" (marked
"from email") instead of Unknown.

**Build.** `packages/core/src/paste.ts`: split the local part on `.`, `_`, `-` when it matches
`first.last`-style and both parts are ≥ 2 letters; skip initials-only (`jdoe`) and generic inboxes
(`GENERIC_LOCAL_PARTS`). Flag `name_from_email: true` so it's visibly inferred.

**Done when.** Unit tests: `emery.harlan` ✓, `e.harlan` → first unknown, `jdoe` → unchanged,
`info@` → dropped.

## 7. Bring your own model (Sign in with ChatGPT / own API key)

**What changes.** A model setting: Claude (default) or ChatGPT. Signed-in users' runs use their own
account, so the operator's cost per user drops to near zero. A fast OpenAI model can replace Jev
for "Looking for".

**Check first (blocking).** Read the current "Sign in with ChatGPT" docs: can a third-party web app
make API calls on the user's plan; is the web search tool included; rate limits; terms for
automated multi-step use. If not allowed → fall back to "paste your own API key"
(OpenAI or Anthropic), kept in the browser session and sent per request.

**Build.**
- Edge function: a provider switch in `runLlm` — Anthropic (today) and OpenAI (Responses API).
  Request carries `provider` + user token; with no token, the operator's Anthropic key as now.
  Add OpenAI web-search tool type next to the Anthropic ones in `WEB_TOOLS` (`lib.ts` — the only
  place tool type strings live). Prompts in `/prompts` are shared; tool schemas in `schemas.ts`
  are plain JSON Schema and work for both.
- Core: `OpenAIDecisions implements DecisionProvider` (`packages/core/src/decisions/`), batch
  scoring like `JevDecisions.scoreMany`. Chat-model scores are less calibrated than Jev's — make
  `FIT_THRESHOLDS` per provider in `config.ts`.
- UI: model picker + Sign in button (header or settings); the cost counter shows "billed to your
  account" when a user token is in use.
- Privacy page: user tokens pass through the edge function and are never stored.

**Done when.** `pnpm record` for each provider on the same 10 firms; compare domain hits (≥ 8/10)
and sourced formats (≥ 6/10) — ship OpenAI as an option only if it meets the v1 bar.

## 8. Platform: API + MCP + plugins (one engine, three ways in)

**Idea.** The input is "any text", so ContactFlow works as a black box: anything that produces text
(a person, a script, an AI agent, a CRM note) sends it in and gets clean contacts back. One server-side
engine, exposed three ways.

**Shared foundation (build first).**
- **Server-side runs.** Today the browser orchestrates a run. Move `runPipeline` behind a job queue
  on the server (Supabase: a `cf_jobs` table + a worker function; or a small Node/Deno worker),
  because runs outlast one request's time limit. Core needs no changes — it is host-agnostic.
- **Jobs.** `cf_jobs(id, key_id, status, input_hash, result, cost, created_at)`. Results kept 7 days,
  then deleted (names are stored only for the job's lifetime — say so on the Privacy page).
- **API keys.** `cf_api_keys(id, owner, hash, limits)`; per-key rate limits and daily caps (reuse the
  `CF_DAILY_LIMIT` idea per key). Usage logged to `cf_usage` with `key_id`.
- **Versioned output.** `/v1/…`; the row shape is the CSV columns as JSON, plus `emails[]` with
  `email`, `basis`, `confidence`, `source_url`, `verify_status`. Additive changes only within v1.
- **Billing.** Operator-paid with per-key quotas, or caller's own model key (item 7).
- **Guardrails.** Terms of use for API keys; per-key limits; optional "verified-only" output for new
  keys; the same never-LinkedIn / never-login-walled rules apply.

**8a. REST API (works in Postman, curl, any language).**
- `POST /v1/find` `{ "text": "...", "looking_for": "partners, not clerks", "options": {…},
  "webhook_url": "…" }` → `202 { "job_id": "…" }`
- `GET /v1/find/{job_id}` → `{ "status": "running" | "done" | "failed", "progress": {done, total},
  "rows": [...], "cost": 0.42 }`
- Optional webhook POST on completion (signed with the key's secret).
- Ship an **OpenAPI spec** (`docs/api/openapi.yaml`) and a **Postman collection**
  (`docs/api/ContactFlow.postman_collection.json`) with the two calls, an example body and a key
  variable, so testing is: import → set key → Send.
- Auth: `Authorization: Bearer cf_live_…`.

**8b. MCP server (AI agents: Claude, ChatGPT, others).**
- Tools: `find_contacts(text, looking_for?)` (submits and waits/polls), `get_job(job_id)`; plus
  finer tools for agents that want control: `resolve_domain`, `discover_pattern`,
  `build_candidates`.
- Remote MCP over HTTP with the same API keys; results returned as rows (and a short summary).

**8c. Plugins (no-code and app stores).**
- **Zapier / Make**: action "Find contacts in text" (input text + looking for → rows), trigger
  "Job finished". Built on the REST API.
- **ChatGPT app / Claude integration**: the MCP server plus the store manifest; results table as a
  widget later.
- Not a LinkedIn browser extension (LinkedIn's terms forbid automated extraction).

**Done when.** Postman collection runs end to end against staging (submit → poll → rows);
webhook fires and verifies; per-key limits return 429; MCP `find_contacts` works from Claude
Desktop on a firm list; a Zap writes emails back to a Google Sheet.

---

## Housekeeping before v2 starts
- Merge the v1 branch into `main`; start v2 work on fresh branches.
- Support address: a ContactFlow one (currently support@jobpaperapp.com, set in `Legal.tsx`).
- Terms and Privacy reviewed before a public launch.
- Google OAuth app: move from Testing to Production (verification) before opening to the public.
