# ContactFlow

Paste anything (LinkedIn results, a team page, a company list, URLs, messy notes) and get back an
outreach-ready contact table: up to 3 ranked email guesses per person, each with the pattern it came
from and a source link. One screen: **paste → preview → run → table → CSV**.

It automates the manual loop: extract people and companies → find each company's domain → read the
email format from public search snippets → generate candidates → check the domain takes mail → export.

- Spec: [`docs/spec.pdf`](docs/spec.pdf) (what and why) · Build guide: [`docs/build-guide.pdf`](docs/build-guide.pdf) (how)
- Stack: TypeScript everywhere, pnpm workspace, Vitest, Vite + React + Tailwind, one Supabase Edge Function (Deno).

```
packages/core   pure TS pipeline: types, stages, runner, normalizer, candidates, CSV, verifier/decision/CRM interfaces
packages/edge   supabase/functions/pipeline — the only server code; holds the Anthropic key
packages/web    the single-screen app (Input, Preview, ResultsTable, ExportBar)
prompts/        one Markdown system prompt per stage, read by the edge function at runtime
fixtures/       sample pastes + expected counts; recorded/ holds API responses for contract tests
scripts/        sync-edge, smoke, record, mock-anthropic
```

`packages/core` imports nothing from React, Deno, Supabase or Node (a test enforces it), so the web
app, the edge function, the smoke script and a future MCP server all run the same stage code.

## How a run works

| # | Stage | Where | Web calls | Notes |
|---|---|---|---|---|
| 1 | `classify_extract` | Claude, no tools | 0 | People, companies, URLs, role hints. Badges, pronouns, credentials, emoji stripped. Dedupe on first+last+company. |
| 2 | `resolve_domain` | Claude + web search | ≤ 2 | Once per company. Skipped when the paste carried a website. Aggregators (LinkedIn, Crunchbase, Wikipedia…) rejected. |
| 3 | `discover_pattern` | Claude + web search | ≤ 3 | Once per domain. Reads RocketReach/SignalHire/Hunter-style snippets; templates validated against a fixed union. |
| 4 | `generate_candidates` | code | 0 | Normalize name (José Álvarez-Ruiz → jose / alvarezruiz / alvarez), apply patterns, max 3. Statistical defaults fill free slots. |
| 5 | verify | edge `/mx` | 0 | DNS MX per domain. No MX → every row at that domain is `no_domain`. Candidates stay `unverified`. |
| 6 | export | code | 0 | CSV / TSV with provenance columns and an empty `opt_out` column. |
| + | `find_people` | Claude + search + fetch | ≤ 3 | Company-first: fetch the team page, keep titles matching the role filter. |
| + | `rescue_agent` | Claude tool loop | ≤ 2/turn | Only for failed rows, once per company, max 8 calls. Tools are stages 2/3/find_people + web search/fetch; ends with `finish` (sourced fix or `gave_up`). |

The search budget per new company is 4 (`CF_MAX_SEARCHES_PER_COMPANY`): 40 people at one company cost one
domain lookup and one pattern search. Results are cached `domain → patterns` for 30 days in the
browser and in `cf_cache`, so repeat companies cost nothing.

## Run it locally (no API key, no spend)

A mock of the Anthropic Messages API lets you exercise the real edge function, the real pipeline and
the UI end to end. Needs Node 20+, pnpm 9+, and Deno 2 (or the Supabase CLI).

```bash
pnpm install
pnpm test                                    # 90+ unit, contract and edge-helper tests, no network

node scripts/mock-anthropic.mjs &            # fake API on :4010
pnpm edge:sync                               # copy prompts + schemas into the function
cd packages/edge/supabase/functions/pipeline
ANTHROPIC_BASE_URL=http://localhost:4010 ANTHROPIC_API_KEY=test \
  deno run --allow-net --allow-env --allow-read --allow-sys index.ts &   # function on :8000
cd -

echo "VITE_EDGE_URL=http://localhost:8000/pipeline" > packages/web/.env
pnpm dev                                     # http://localhost:5173 — "Try a sample…" loads a fixture
CF_EDGE_URL=http://localhost:8000/pipeline pnpm smoke thirty_contacts   # headless run + PASS/FAIL
```

With the Supabase CLI instead of bare Deno: `supabase functions serve pipeline --no-verify-jwt --env-file ../../.env`
from `packages/edge` (URL `http://localhost:54321/functions/v1/pipeline`).

## Deploy (v1)

Accounts: an Anthropic API key with web search enabled for the org, and a Supabase project (free tier is fine).

```bash
cd packages/edge
supabase link --project-ref <ref>
supabase db push                                   # creates cf_cache, cf_usage (+ cf_usage_daily view)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... CF_ALLOWED_ORIGINS=https://your-app.example
supabase secrets set CF_MODEL_EXTRACT=claude-sonnet-5-5 CF_MODEL_CLASSIFY=claude-haiku-4-5   # optional, these are the defaults
cd ../.. && pnpm edge:deploy                       # syncs prompts + schemas, then deploys `pipeline`
curl https://<ref>.supabase.co/functions/v1/pipeline/health   # {"ok":true,"key":true,"db":true,"prompts":[…]}
```

Web app: set `VITE_EDGE_URL=https://<ref>.supabase.co/functions/v1/pipeline` in `packages/web/.env` (or in
the host's env settings) and deploy `packages/web` as a static site. Vercel/Netlify/Cloudflare Pages
settings: build command `pnpm --filter @cf/web build`, output directory `packages/web/dist`.

Then check against the real API:

```bash
CF_EDGE_URL=https://<ref>.supabase.co/functions/v1/pipeline pnpm smoke             # linkedin_results; PASS = ≥80% ok, ≤4 searches/company
CF_EDGE_URL=https://<ref>.supabase.co/functions/v1/pipeline pnpm record            # re-record fixtures/recorded/* as "live"
pnpm test                                                                          # contract tests now also check the ±1 counts
```

Editing a prompt: change `prompts/<stage>.md` and run `pnpm edge:deploy`. No web rebuild, no code change.
Swapping a model: `supabase secrets set CF_MODEL_EXTRACT=...`. No PR.

## Environment variables

Function secrets (`supabase secrets set …`). The browser never sees any of them.

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Required. Only the edge function reads it. |
| `CF_MODEL_EXTRACT` | `claude-sonnet-5-5` | Extraction, pattern discovery, find_people, rescue agent |
| `CF_MODEL_DOMAIN` | = extract model | Domain resolution. A Haiku-class id is cheaper (gets the basic web-search tool). |
| `CF_MODEL_CLASSIFY` | `claude-haiku-4-5` | Decision layer (classify / choose / score) |
| `CF_EFFORT` | unset | `low` / `medium` / `high` for extract-model stages. `low` is a sensible cost setting. |
| `CF_FALLBACKS` | `default` | Server-side refusal fallback (Claude API only). Empty string disables it. |
| `CF_WEB_TOOL_VERSION` | auto | Force `basic` or `dynamic` web tool versions |
| `CF_RATE_LIMIT_PER_MIN` | `30` | Calls per minute per session (IP gets 2×). 429 after that. |
| `CF_DAILY_LIMIT` | `2000` | LLM calls per 24 h across everyone (counted in `cf_usage`). `0` = off. |
| `CF_CACHE_TTL_DAYS` | `30` | Server cache TTL cap for `domain → patterns` |
| `CF_ALLOWED_ORIGINS` | `*` | Comma-separated CORS origins. Set it to your app's URL in production. |
| `CF_ACCESS_TOKEN` | unset | If set, requests need header `x-cf-token`. A light guard for a personal deployment. |
| `TYPESAFE_API_KEY` | unset | Jev (TypeSafe) for the "Looking for" relevance judge and other decisions. Without it, Claude (Haiku) judges. |
| `CF_JEV_MODEL` | `jev-latest` | Jev model alias |

Web (`packages/web/.env`): `VITE_EDGE_URL`, `VITE_ACCESS_TOKEN` (must match `CF_ACCESS_TOKEN`),
`VITE_GOOGLE_CLIENT_ID` (optional, for Push to → Google Sheets; see below).
Scripts: `CF_EDGE_URL`, `CF_ACCESS_TOKEN_CLIENT`. Client-side budgets (max contacts 100, concurrency 5,
rescue calls 8, rescue threshold 0.6) live in `packages/core/src/config.ts`; prices for the ≈ $ counter
are there too and are estimates. `cf_usage` / `cf_usage_daily` hold the real token and search counts.

## Google Sheets (Push to → Google Sheets)

Runs in the browser with the user's own Google sign-in, scope `drive.file`: the app sees only the
spreadsheets it creates, never the rest of the Drive. Nothing is stored on the server. Sending to an
existing sheet adds only people not already in it (same first + last + company) and follows that
sheet's own column order. The client ID is public; there is no client secret.

One-time setup (Google Cloud console, ~10 min):

1. [console.cloud.google.com](https://console.cloud.google.com) → create a project (e.g. *ContactFlow*).
2. **APIs & Services → Library** → enable **Google Sheets API** and **Google Drive API**.
3. **Google Auth Platform** (OAuth consent screen) → *Get started*: app name *ContactFlow*, your email,
   audience **External** → create.
4. **Audience → Test users** → add every Google account that will use it (while the app is in *Testing*).
5. **Clients → Create client** → *Web application* → **Authorized JavaScript origins**:
   `https://contact-flow-web.vercel.app` (and `http://localhost:5173` for local dev) → create → copy the **Client ID**.
6. Put the ID in `packages/web/.env.production` as `VITE_GOOGLE_CLIENT_ID` (it's public; this repo already has one),
   or set the same name in Vercel → Settings → Environment Variables, which overrides it. Redeploy.
   Never add the client secret anywhere — the browser flow doesn't use it.

Users see "Google hasn't verified this app" until the app is verified; fine for you and test users.

## Compliance and guardrails

The app parses text **you** paste and reads public search results. It never logs into or crawls
LinkedIn or anything behind a login. That keeps it in the same category as Hunter, RocketReach and Apollo, not a scraper.

- **No LinkedIn automation.** No extension, no fetcher. URL inputs on linkedin.com are dropped, and the
  edge function's `web_fetch` tool has LinkedIn and the paid data vendors in `blocked_domains`.
- **Provenance on every guess.** Domain and pattern carry their source URL into the table and the CSV.
  Rescue-agent patterns without a source URL are discarded.
- **Evidence level on every email:** *seen* (in your paste), *sourced* (a format a source states or your
  paste proves, ≥ 40 %), or *guess* (a common format, nothing behind it). Guesses are hidden and left out of
  Copy/CSV unless you switch on **Include backup guesses**; the CSV has `email_N_basis` and
  `pattern_confidence_basis` (stated by source / estimated / paste) columns.
- **Junk gates:** no emails for ⚠-flagged people (until you click Include), "LinkedIn Member" rows,
  incomplete names ("Maria O."), shared inboxes (info@…), dead or uncertain (< 50 %) domains. Companies with
  no usable people are never searched.
- **Guesses are labelled as guesses.** MX only proves the domain takes mail, so every candidate exports
  as `verify_status=unverified` (or `invalid` for a dead domain). The UI never shows a guess as confirmed.
- **Opt-out column** in every export. **You** are responsible for CAN-SPAM (US) and GDPR / PECR (EU, UK)
  compliance in your outreach: unsubscribe link, honest sender, suppression list. The UI says so under the table.
- **Rate limits** per session, per IP and per day, so a leaked URL can't run up the bill. Set `CF_ALLOWED_ORIGINS`.
- **No results stored server-side.** Contacts live in your browser (localStorage, per session; **Clear** wipes
  them). `cf_cache` stores only `company → domain` and `domain → patterns`, never names. `cf_usage` stores counts and a hashed IP.
- CSV cells starting with `= + - @` are prefixed with `'` so the file can't run spreadsheet formulas.

## Open decisions (answered for v1)

| Decision | v1 answer |
|---|---|
| Edge platform | Supabase Edge Function `pipeline`; cache and usage tables in the same project |
| Search budget per company | 4 (1–2 domain + 2–3 pattern), env-tunable |
| Verifier | MX only (`MxVerifier`). NeverBounce / ZeroBounce / Hunter plug in behind `Verifier`. |
| CRM | CRM-agnostic `CrmAdapter` taking flat `CrmRecord`s. Google Sheets shipped in v1 (Push to… menu); HubSpot next — see docs/v2-build-sheet.md. |
| Max contacts per run | 100 (preview warns and runs the first 100) |
| Cache TTL | 30 days |
| Nickname expansion | Off by default; a per-run checkbox. Takes a free slot ahead of statistical fill, never a found pattern. |
| Accounts | None in v1. Sessions are a random UUID in localStorage. |
| Forced tool use | Not used. Current Sonnet/Opus reject forced `tool_choice`, and it would block web search. Each prompt names its tool and the function nudges once if it's skipped. |

## Milestones

| | Status | Verified here | Needs a live key |
|---|---|---|---|
| M1 core + fixtures | ✅ | normalizer (5 tricky names), candidates, CSV, validation, runner with mocked ctx | — |
| M2 edge + stage 1 | ✅ code | function type-checks under Deno; routes, CORS, 429 after N/min; contract tests on recorded shapes | deploy; fixtures ±1 (`pnpm record` then `pnpm test`) |
| M3 stages 2–3 | ✅ code | pause_turn resume, search budget ≤ 4/company, read-through cache | 10-company accuracy (≥ 8 domains, ≥ 6 sourced patterns) |
| M4 web UI | ✅ | Parse → editable preview → Run → live table → CSV/TSV; refresh keeps the run; Clear wipes it (Playwright, against the mock) | 30 contacts in < 2 min |
| M5 MX, rescue, polish | ✅ | dead-domain fixture → `no_domain`; 8-call rescue budget; Retry; filters; cost counter uses the same usage the function logs | counter vs `cf_usage` |
| M6 company-first | ✅ code | role filter / role hints → find_people; URL inputs | ≥ 1 match per company with a public team page |

**v2:** the plan, build order and acceptance checks are in [docs/v2-build-sheet.md](docs/v2-build-sheet.md).
