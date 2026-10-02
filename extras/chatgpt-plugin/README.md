# ContactFlow for ChatGPT

Everything needed to use ContactFlow inside ChatGPT, from a private test today to a public listing
later.

## What it is

ContactFlow inside ChatGPT. You paste a LinkedIn search, a team page or a list of firms and ask
for emails. ChatGPT reads the names and asks ContactFlow, which returns each person's work email,
the company's email format and its source, and whether a mailbox check confirmed it.

- **The app** is our MCP server: `https://contact-flow-web.vercel.app/api/mcp` (`docs/mcp.md`).
  Two tools, one per user goal: `find_emails` and `get_email_format`. Everything else (domains,
  the evidence engine, caching, website reading, verification) runs underneath, invisible to ChatGPT.
- **The plugin** (this folder) packages the app with a skill (how to read pastes and present
  results honestly), the logo, descriptions and starter prompts.

| File | For |
|---|---|
| `package/plugin.json` | Listing: name, descriptions, category, URLs, 3 starter prompts, brand colours, logo |
| `package/.codex-plugin/plugin.json` | The same listing in the native format, pointing at the skills and the MCP server |
| `package/mcp.json`, `package/.mcp.json` | The connection to our server (`/api/mcp`), in both formats ChatGPT reads |
| `package/skills/contactflow/SKILL.md` | The skill: when to use ContactFlow, how to call it, how to present results |
| `package/assets/logo.png`, `icon.png` | 512×512 transparent logo and composer icon |
| `BRAND.md` | Colours, fonts, where the vector logo lives |
| `build_package.py` | Builds `contactflow-plugin.zip` (the upload); `--app-id` links the app |
| `contactflow-plugin.zip` | The built package |

## 1. Test it now (personal ChatGPT plan)

1. ChatGPT → Settings → Security and login → **Developer mode** on.
2. Settings → Apps → **Create app**: name `ContactFlow`, MCP URL
   `https://contact-flow-web.vercel.app/api/mcp`, authentication **No authentication**.
   Upload `package/assets/icon.png` if it asks for an icon.
3. New chat → choose ContactFlow (+ menu or @ContactFlow) → paste, ask for emails.

That's all a personal plan needs. Uploading the plugin ZIP or importing from GitHub needs a
Business/Enterprise workspace admin.

## 2. As a plugin (workspace, or before submitting)

This package matches what ChatGPT's Plugin Creator produced and accepted (v0.1.3): listing,
skill, logo, and the MCP server in `mcp.json` / `.mcp.json`. `python3 extras/chatgpt-plugin/build_package.py`
zips it. To point at a workspace app instead, add `--app-id asdk_app_…` (writes `.app.json`).
3. Upload: ChatGPT → Admin → Plugins → Add → Upload plugin (workspace admins), or use Plugin
   Creator (`@plugin-creator`) with the skill text and the app.

## 3. Public listing (later)

Needs, besides this package: a verified OpenAI platform identity; **our own domain** for the app
with the token at `/.well-known/openai-apps-challenge`; OAuth sign-in instead of an open server;
a privacy-page section on ChatGPT; screenshots; 5 positive and 3 negative test cases. Portal:
platform.openai.com/plugins. Limits the portal enforces (checked by `pnpm test`): display name and
short description ≤ 30 characters, exactly 3 starter prompts ≤ 128 characters.
