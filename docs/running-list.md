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
   - [ ] **Decide:** switch to `shadow` so it starts collecting (no visible change, a few extra database rows per new firm)
5. [ ] **Verification button (switched off)** — Verify per row / all; checks 1–2 people per firm and re-ranks the rest; writes into the evidence engine. Stand-in provider until we pick one (MillionVerifier or ZeroBounce). Pro accounts later.
6. [ ] **API → MCP → ChatGPT app** — `/v1/enrich` with API keys, MCP tools (`enrich_contacts`, `find_domain`, `get_format`, later `verify`), results widget inside ChatGPT.

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
- [x] Evidence engine (built, off; edge v16)
- [x] Landing page (flat brand mark, paste box with examples, themed panels) — `/#home`
- [x] Share preview + iPhone home-screen icon
- [x] Paste cleanup on (LinkedIn only)
- [x] Website reading in test mode, now also compares remembered companies; `?site=on` switch
