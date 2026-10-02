# ContactFlow in ChatGPT (MCP server)

ChatGPT reads the user's paste itself and calls ContactFlow's tools with structured names. The
server is a Vercel Function (`packages/web/api/mcp.js`, built from `packages/mcp`) that sends every
lookup to the Supabase `pipeline` function, so it holds no Anthropic or verifier key.

Endpoint: `https://contact-flow-web.vercel.app/api/mcp?key=<CF_MCP_KEY>` — private: no key, no access.

## Tools

| Tool | What it does | Cost |
|---|---|---|
| `find_emails` | Up to 3 companies / 25 people per call → domain, email format with its source, up to 3 ranked emails each, `verified` label. `companies` + `roles` finds people on the company's own team page. `verify: true` checks one mailbox per company. | Same as the website (cached formats are free) |
| `find_domain` | Company → official domain, source, confidence | One search, then cached |
| `get_email_format` | Domain → up to 3 formats with sources, accepts mail? | One search, then cached |
| `build_emails` | Known format + names → emails | Free, instant |

Not exposed: the paste-reading step (ChatGPT does it), relevance scoring (ChatGPT filters, or pass
`looking_for`), the rescue agent (runs inside `find_emails`), single-address verification.

## Set up (once)

1. **Vercel → Project → Settings → Environment Variables:** add `CF_MCP_KEY` = a long random string
   (32+ characters from a password generator). It's the password to the server; keep it out of chat.
   The function also uses the existing `VITE_EDGE_URL` and `VITE_ACCESS_TOKEN`.
2. **Vercel → Settings → Build and Deployment → Root Directory** must be `packages/web` (the function
   lives in `packages/web/api/`). Redeploy after adding the variable.
3. **ChatGPT → Settings → Security and login → Developer mode:** on (paid plans).
4. **ChatGPT → Settings → Apps → Create app:** name `ContactFlow`, MCP server URL
   `https://contact-flow-web.vercel.app/api/mcp?key=<your key>`, authentication **No authentication**
   (the key in the URL is the lock). ChatGPT lists the four tools.
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
