# ContactFlow — running list

What we're building, in order. Updated as each item lands. `[x]` done · `[~]` in progress · `[ ]` next.

## Now

1. **Three quick fixes**
   - [x] **100% cap** — third-party sites (RocketReach, ContactOut…) show at most 95%, with the site's name in the pill. Only the firm's own site (and later verification) can go higher.
   - [x] **Phone-width results table** — email under the name, pattern + score on one line, long notes collapse to one tappable line.
   - [~] **Bio pages** — the website reader follows links from the team page into individual bio pages (where law firms list addresses).
2. **JSON format (the contract)**
   - [ ] Input: people `{first, last, company, title?, domain?}` or companies + roles.
   - [ ] Output: people with up to 3 emails, pattern, source, confidence, verify status, notes.
   - [ ] One schema in `packages/core`, used by the benchmark, the API, MCP and the ChatGPT app.

## Next

3. [ ] **Benchmark (set up, no data yet)** — CSV of known answers (name, company, real email, delivered/bounced/replied) → `pnpm bench` scores domain accuracy, top-1 / top-3, wrong-but-confident, cost per usable contact, time.
4. [ ] **Evidence engine (set up, switched off)** — `cf_domain_evidence` table, `recordEvidence()`, scorer, `EVIDENCE_MODE = "off"`.
5. [ ] **Verification button (switched off)** — Verify per row / all; checks 1–2 people per firm and re-ranks the rest; writes into the evidence engine. Stand-in provider until we pick one (MillionVerifier or ZeroBounce). Pro accounts later.
6. [ ] **API → MCP → ChatGPT app** — `/v1/enrich` with API keys, MCP tools (`enrich_contacts`, `find_domain`, `get_format`, later `verify`), results widget inside ChatGPT.

## Later / ideas

- [ ] More email formats: `lastf`, `fmlast`, `first.l`, `lastfirst`, `f.m.last`.
- [ ] Turn website reading from test mode to on (check `cf_site_shadow` results first).
- [ ] Sending-log feedback (delivered / bounced) once logs exist.
- [ ] Real logos / testimonials on the landing page once we have them.

## Done recently

- [x] Landing page (flat brand mark, paste box with examples, themed panels) — `/#home`
- [x] Share preview + iPhone home-screen icon
- [x] Paste cleanup on (LinkedIn only)
- [x] Website reading in test mode, now also compares remembered companies; `?site=on` switch
