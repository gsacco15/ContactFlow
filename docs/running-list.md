# ContactFlow — running list

What we're building, in order. Updated as each item lands. `[x]` done · `[~]` in progress · `[ ]` next.

## Now

1. **Three quick fixes**
   - [x] **100% cap** — third-party sites (RocketReach, ContactOut…) show at most 95%, with the site's name in the pill. Only the firm's own site (and later verification) can go higher.
   - [x] **Phone-width results table** — email under the name, pattern + score on one line, long notes collapse to one tappable line.
   - [x] **Bio pages** — the website reader follows links from the team page into individual bio pages (where law firms list addresses).
2. **JSON format (the contract)** — see `docs/api-v1.md`
   - [x] Input: people `{first, last, company, title?, domain?}` or companies + roles, or raw text. Your `ref` comes back.
   - [x] Output: people with up to 3 emails, pattern, source, confidence, verify status, notes.
   - [x] One schema in `packages/core/src/api.ts`, used by the benchmark, the API, MCP and the ChatGPT app. JSON input skips the AI reading step.

## Next

3. [x] **Benchmark (set up, no data yet)** — see `bench/README.md`
   - [x] Answer-key CSV (accepts sending-tool column names and outcome words)
   - [x] `pnpm bench` (`--mock` free practice · `--limit` · `--budget` · `--site on` · `--give-domain`)
   - [x] Report card: 1st right, top 3, wrong-but-confident, domain, no answer, bounces, score honesty by band and by source, cost per usable contact; compares with last run
   - [ ] **You:** a list of 100–200 people with known real emails → `bench/data/`
   - [ ] First real run, then fix the worst number
4. [x] **Evidence engine (set up, switched off)** — see v2 build sheet §0
   - [x] `cf_domain_evidence` table (live on Supabase) · `/evidence` route (edge v16)
   - [x] Evidence kinds, weights, half-life, scorer, "strong enough to skip the search" rule
   - [x] Pipeline hooks: `off` (now) · `shadow` (record, change nothing) · `on` (strong evidence skips the search) · `?evidence=shadow` to try in one browser
   - [x] Ready for verification, sending logs, benchmark outcomes and user corrections (builders exist)
   - [x] Each source counts once (no echo from re-searching the same page)
   - [x] **Switched to `shadow`** — collecting from normal use, results unchanged
   - [ ] Switch to `on` only after the benchmark shows strong verdicts are right (`pnpm bench --evidence on`)
5. [x] **Verification (built, switched off)** — see v2 build sheet §1
   - [x] One check per firm, cheapest first: valid → format proven for everyone; invalid → next format (max 3); catch-all → stop
   - [x] Already proven by an earlier check (any user) → no check at all
   - [x] Cracks firms with no published format (backup guesses get checked too)
   - [x] Modes: `off` (hides the checkbox) · `button` (now: shows the "Verify emails" checkbox) · `auto` (always verify)
   - [x] Badges: ✓ valid · ~ risky · ◎ accept-all · "✓ verified here" on the format; CSV/JSON say "verified by mailbox check"
   - [x] Edge `/verify` (v17): ZeroBounce + MillionVerifier adapters, `mock` stand-in (never recorded); key only on the server; checks logged and priced
   - [x] Simplified: one **"Verify emails"** checkbox with the search settings — ticked = the search verifies (one check per firm); results marked on each row
   - [x] Demo answers until a provider key exists: grey "demo ✓ / ✗", nothing crossed out, "Demo checks — fake results" note, never saved
   - [x] **Live with MillionVerifier** (Oct 2): real answers, accept-all detected (Cloudflare), bounces detected (Austin Energy); provider errors retried and shown as "verifier unavailable"
   - [x] Second-opinion check on a colleague before blaming a format
   - [ ] First live "✓ verified here" on a firm (not seen yet)
   - [x] CSV `verified` column next to email 1: yes · format proven · no (bounced) · accept-all server · risky · not checked · demo
   - [ ] Then: "Only verified" filter · pro-account gate
6. [~] **API → MCP → ChatGPT app** — see `docs/mcp.md`
   - [x] MCP server (Vercel Function `/api/mcp`, open for testing; `CF_MCP_KEY` / login later), two goal tools: `find_emails`, `get_email_format` (evidence engine & co. hidden underneath)
   - [x] Server live on Vercel (`/api/mcp` answers)
   - [x] ChatGPT plugin package: `extras/chatgpt-plugin/` (listing, skill, logo/icon, brand kit, ZIP builder)
   - [ ] **You:** connect in ChatGPT developer mode (`https://contact-flow-web.vercel.app/api/mcp`)
   - [x] First real test in ChatGPT (personal plugin with the MCP server; LinkedIn paste → Kirkland emails)
   - [x] Results view inside ChatGPT (`show_results`, MCP Apps) · checks on by default
   - [ ] Fix: verified call reported "connection failed" although the lookup finished (check Vercel logs)
   - [ ] Later: login (OAuth) or `CF_MCP_KEY` lock · own domain + listing · `/v1/enrich` REST API with keys

## Launch (free to try, capped)

- [x] Dollar cap on free use: $20/day for the whole site, shared by everyone; no per-visitor cap (`pricing.ts` FREE_TIER; `CF_DAILY_BUDGET_USD` / `CF_FREE_PER_VISITOR_USD` secrets override). Real cost per row in `cf_usage.cost_usd` (edge v27)
- [x] Admin page `#admin`: today's spend vs the cap, 30 days of spend/visitors/searches/checks, cap hits, own-key use, ChatGPT lookups, recent sessions (per browser, 7 days). Password = the `CF_ADMIN_KEY` Supabase secret (page is off until it's set). `cf_admin_stats()` + `cf_limit_hits` (migration 20261006000000), edge v32
- [x] "Use your own Claude key": header button + prompt when free use runs out; key kept in the browser, used per request, never stored
- [x] Jev stays on for everyone; verification on, counted in the cap
- [x] Site-styled dialogs instead of browser pop-ups; logo → homepage; flow diagram removed from How it works
- [x] Dark mode for the app pages (follows the device; ◐ Auto / ☾ Dark / ☀ Light button); landing keeps its own look
- [x] Google OAuth app published (In production, External, drive.file only): anyone can Push to Google Sheets; optional later: logo + brand verification to drop the "unverified app" notice
- [ ] Saved examples that cost $0 (replay real results)

## Later / ideas

- [ ] More email formats: `lastf`, `fmlast`, `first.l`, `lastfirst`, `f.m.last`.
- [ ] Turn website reading from test mode to on (check `cf_site_shadow` results first).
- [ ] Sending-log feedback (delivered / bounced) once logs exist → `evidenceFromOutcome`.
- [ ] `pnpm bench --record-evidence`: benchmark outcomes feed the evidence engine.
- [ ] Real logos / testimonials on the landing page once we have them.

## Done recently

- [x] 100% cap (third-party sources max 95%, named in the table)
- [x] Phone-width results (one stacked card per person)
- [x] Website reader opens bio pages (edge v15)
- [x] JSON contract v1
- [x] Benchmark (ready; waiting on a real list)
- [x] Evidence engine (shadow; edge v16)
- [x] Verification (built, off; edge v17)
- [x] Landing page (flat brand mark, paste box with examples, themed panels) — `/#home`
- [x] Share preview + iPhone home-screen icon
- [x] Paste cleanup on (LinkedIn only)
- [x] Website reading in test mode, now also compares remembered companies; `?site=on` switch
