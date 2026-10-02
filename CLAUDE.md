# ContactFlow — notes for coding agents

Read README.md first; docs/spec.pdf is scope, docs/build-guide.pdf is implementation detail (guide wins on detail, spec on scope).

Constraints that override anything else:
- `packages/core` imports nothing from React, Deno, Supabase or Node (test/purity.test.ts enforces it).
- `packages/core/src/schemas.ts` stays import-free — `pnpm edge:sync` copies it into the Deno function.
- The Anthropic API key exists only in the edge function.
- Never add code that fetches linkedin.com or any login-walled page.
- Prompts are Markdown in /prompts, read at runtime; never inline them in code.
- Model ids, budgets and thresholds come from env or `packages/core/src/config.ts`, never literals in logic.
- Server tool type strings live only in `WEB_TOOLS` in `packages/edge/supabase/functions/pipeline/lib.ts`.

Checks: `pnpm test` (all packages), `pnpm typecheck`. End-to-end without a key: see "Run it locally" in README.
