# ContactFlow JSON contract — v1

One shape for the HTTP API, the MCP server, the ChatGPT app and the benchmark.
Code: `packages/core/src/api.ts` (`parseEnrichRequest`, `toExtract`, `toEnrichResponse`, `ENRICH_REQUEST_SCHEMA`).

## Request

Send **structured people and/or companies** (no AI reading step — cheaper and exact), **or** a raw `text` paste. Not both.

```json
{
  "version": "v1",
  "people": [
    { "ref": "crm-17", "first": "Jane", "last": "Doe", "title": "Partner", "company": "Acme Legal", "domain": "acmelegal.com" }
  ],
  "companies": [
    { "ref": "c1", "name": "Beta Corp", "roles": "Managing Partner, HR Director" }
  ],
  "options": { "looking_for": "partners", "include_guesses": false, "max_emails": 3 }
}
```

| Field | Notes |
|---|---|
| `people[]` | `first`, `last` (`""` if unknown), `company` required. Optional: `ref`, `middle`, `title`, `domain`, `email`, `linkedin_url` (stored, never fetched). Max 200. |
| `companies[]` | `name` required. Optional: `ref`, `domain`, `roles` (who to find there). Max 50. |
| `text` | Anything pasted (LinkedIn search, team page, notes). Max 50,000 characters. |
| `options.looking_for` | Who you're after; others are skipped before anything is spent. |
| `options.include_guesses` | Include common-format guesses with no source. Default `false`. |
| `options.max_emails` | 1, 2 or 3. Default 3. |

Bad input returns every problem at once, with paths: `people[0].company: required`.

## Response

```json
{
  "version": "v1",
  "people": [
    {
      "ref": "crm-17",
      "first": "Jane", "last": "Doe", "title": "Partner",
      "company": "Acme Legal", "domain": "acmelegal.com", "domain_source_url": "https://acmelegal.com",
      "emails": [{ "address": "jdoe@acmelegal.com", "rank": 1, "basis": "sourced", "verify_status": "unverified" }],
      "pattern": { "format": "flast", "template": "{f}{last}", "confidence": 0.95, "confidence_basis": "stated by source", "source": "RocketReach", "source_url": "https://rocketreach.co/…" },
      "status": "ok"
    }
  ],
  "companies": [{ "ref": "c1", "name": "Beta Corp", "domain": "betacorp.com", "patterns": [] }]
}
```

- `emails[].basis`: `seen` (in your input) · `sourced` (built from a sourced format) · `guess` (common format, no source — only with `include_guesses`).
- `emails[].verify_status`: `unverified` until verification ships, then `valid` / `invalid` / `catch_all` / `risky`.
- `pattern.confidence_basis`: `your input` · `company website` · `stated by source` · `estimated`. Third-party sources top out at 0.95.
- `status`: `ok` · `no_domain` · `no_pattern` · `skipped` · `error`.
- `note`: why there's no email, or what a retry found. `flag`: e.g. their headline names a different employer.
- `ref` is echoed back so you can match rows to your own records.
