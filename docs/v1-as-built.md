# ContactFlow v1 — as built

What v1 actually is, as shipped (the spec and build guide in `docs/` were the plan; v1 grew past
them). Use this as the template for what exists before starting v2 (`docs/v2-build-sheet.md`).

Live: https://contact-flow-web.vercel.app · Supabase project `ContactFlow` · branch
`claude/awesome-bohr-wnt8bv`.

## What it does, in one line

Paste anything → it finds the people, each company's domain and how that company writes its
emails, and gives up to 3 ranked emails per person, each with its source.

## Features

**Input**
- Paste anything: team pages, LinkedIn results, firm lists, notes, URLs. Examples… menu for demos.
- **Find emails** (one click does everything) · **Preview** (optional: see and fix people first).
- **Looking for**: plain-language description of who you want, any industry. Empty = everyone.
- Options: skip not-relevant before searching (on), nickname variants (off), use emails & formats
  found in the paste (on).
- Re-previewing unchanged text is free (reuses the earlier read).

**Finding**
- Reads people, titles, companies, emails and stated formats from the paste (Claude).
- Relevance: each person scored against Looking for (Jev; Claude fallback). ✓ ≥ 60%, ✗ < 30%,
  ? in between. ✗ people are skipped before any search. Click a badge to keep/drop.
- Domain: pasted website → cache → web search. < 50% sure → no emails for that company.
- Email format: paste → cache → web search for a source that states it. Stated vs estimated
  confidence shown (72% vs ≈72%).
- Companies with no names + Looking for → reads the company's public team page (never LinkedIn).
- Up to 3 emails per person; MX check that the domain accepts mail.
- Rescue agent for failed rows: once per company, ≤ 4 steps.
- Safeguards: generic inboxes dropped, "LinkedIn Member" dropped, incomplete names (Maria O.) get no
  guesses, ⚠ flag when someone may not work where listed, paste-derived formats never shared.
- Evidence per email: seen in paste / sourced / backup guess. Guesses hidden unless switched on.

**Your list**
- Every Find emails run is a search card (colour, name, Looking for, people, emails, cost, time).
  Tick to show/hide, click to show only it, ✎ rename, × remove. Show all / Hide all.
- Same person found twice = one row; people already with an email aren't looked up again.
- Same paste + same Looking for refreshes its card instead of duplicating.
- Table grouped by search (foldable sections), company or nothing; colour edge per search.
- Filters: only rows with an email, hide not relevant, include backup guesses.
- Inline edit of names/titles regenerates emails; Retry / Include per row.
- Saved in the browser (survives refresh); Clear list wipes it.

**Export**
- Copy as table, Download CSV (with a `search` column), Push to… → Google Sheets (adds only new
  people, keeps the sheet's own columns). HubSpot listed as coming later.
- Export always matches what the table shows.

**Cost & limits**
- Live counter: this paste and session (phones: this paste).
- Caps: 100 people per run, 5 companies at once, ≤ 4 searches per company for domain + format,
  team page ≤ 2 searches + 3 reads, rescue ≤ 4 steps, 30 calls/min per session, 2,000 calls/day app-wide.
- Cache: domains + formats 30 days (server), names never stored server-side.

**Look & pages**
- Logo B1 (pipeline mark + "contactflow"), favicon, tagline "Paste anything → emails you can trust."
- How it works: description, 6 colour-tagged steps, full flowchart, explainer cards.
- Privacy, Terms, footer (support@jobpaperapp.com, © 2026 ContactFlow). Works on phones.

## Architecture

| Part | Where | Notes |
|---|---|---|
| Web app | `packages/web` (Vite + React 19 + Tailwind v4) → Vercel | Owns all user data (localStorage) |
| Core pipeline | `packages/core` (pure TS) | Stages, runner, candidates, fit, export. No React/Deno/Node imports |
| Edge function | `packages/edge/supabase/functions/pipeline` → Supabase | Routes `/llm`, `/mx`, `/cache`, `/jev`, `/health`. Only place keys live |
| Prompts | `/prompts/*.md` | classify_extract, resolve_domain, discover_pattern, find_people, rescue_agent, judge, decide |
| Database | Supabase `cf_cache`, `cf_usage` (+ `cf_usage_daily`) | RLS on, service role only |

Models: Sonnet 5.5 for reading/searching/rescue (effort low), Haiku 4.5 for domains and Claude
judging, Jev for relevance. Web search via `WEB_TOOLS` in `lib.ts` (basic version).

## Settings and secrets

| Where | Name | What |
|---|---|---|
| Supabase secrets | `ANTHROPIC_API_KEY` | Claude |
| Supabase secrets | `TYPESAFE_API_KEY` | Jev |
| Supabase secrets | `CF_MODEL_DOMAIN`, `CF_EFFORT`, `CF_WEB_TOOL_VERSION`, `CF_DAILY_LIMIT`, … | See README → Environment variables |
| Vercel env | `VITE_EDGE_URL` | Edge function URL |
| `packages/web/.env.production` | `VITE_GOOGLE_CLIENT_ID` | Public Google OAuth client ID (no secret) |
| `packages/core/src/config.ts` | budgets, thresholds, prices | `DEFAULT_BUDGET`, `FIT_THRESHOLDS`, `MIN_SOURCED_CONFIDENCE`, `LOW_DOMAIN_CONFIDENCE`, `PRICES` |

## Checks

`pnpm test` (core, edge, web), `pnpm typecheck`, `pnpm build`. End-to-end without a key:
README → Run it locally (mock API + local edge function + Vite).

## Open items carried into v2

Not verified emails yet; HubSpot; Terms/Privacy legal review; ContactFlow support address; Google
OAuth app to Production; merge the branch to `main`. Full v2 list: `docs/v2-build-sheet.md`.
