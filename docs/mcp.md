# ContactFlow in ChatGPT (MCP server)

ChatGPT reads the user's paste itself and calls ContactFlow's tools with structured names. The
server is a Vercel Function (`packages/web/api/mcp.js`, built from `packages/mcp`) that sends every
lookup to the Supabase `pipeline` function, so it holds no Anthropic or verifier key.

Endpoint: `https://contact-flow-web.vercel.app/api/mcp`. Open for now (same exposure as the website,
capped by `CF_DAILY_LIMIT`). To lock it, set `CF_MCP_KEY` in Vercel and add `?key=<it>` to the URL;
OAuth replaces that with the login later.

## Tools — one per user goal

| Tool | The user's goal | Cost |
|---|---|---|
| `find_emails` | "Find emails for these people" (or "…for the partners at these firms"). Up to 3 companies / 25 people per call → up to 3 ranked emails each, the company's format with its source, and a `verified` label. `verify: true` checks one mailbox per company. | Same as the website (remembered formats are free) |
| `get_email_format` | "What's the email format at Acme?" Company name and/or domain → up to 3 formats with sources. | One search, then remembered |

Everything else runs underneath and stays invisible to ChatGPT: finding the domain, the evidence
engine, the cache, website reading, the rescue step and mailbox checks. Not exposed, and not added
until they're built and a user goal needs them: single-address verification, a bulk/background job,
CRM push.

## Set up (once)

1. **Vercel → Settings → Build and Deployment → Root Directory** must be `packages/web` (the function
   lives in `packages/web/api/`). It uses the existing `VITE_EDGE_URL` and `VITE_ACCESS_TOKEN`.
2. *(Later, optional)* `CF_MCP_KEY` in Vercel locks the server until the login exists.
3. **ChatGPT → Settings → Security and login → Developer mode:** on (paid plans).
4. **ChatGPT → Settings → Apps → Create app:** name `ContactFlow`, MCP server URL
   `https://contact-flow-web.vercel.app/api/mcp`, authentication **No authentication**. ChatGPT lists the two tools.
5. In a new chat, choose ContactFlow (Developer mode / + menu), paste a LinkedIn page and ask for emails.

## Limits

- 3 companies per `find_emails` call (Vercel's 60-second limit); ChatGPT calls again for more.
- The pipeline's daily cap (`CF_DAILY_LIMIT`) and per-minute limits apply. Usage shows in
  `cf_usage` with sessions named `mcp-…`.

## Before a public listing (later)

Own domain (domain verification at `/.well-known/openai-apps-challenge`), OAuth instead of the URL
key, per-user limits, privacy page section for ChatGPT, app icon/screenshots/test cases, and a
results widget. See `docs/v2-build-sheet.md` §1b.

## Changing it

Edit `packages/mcp/src` (or core), then `pnpm mcp:build` and commit `packages/web/api/mcp.js`.
`pnpm test` fails while the bundle is out of date.
