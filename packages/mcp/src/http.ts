// Web-standard Request → Response handler for the MCP endpoint. Every lookup goes through the
// `pipeline` edge function (which holds the Anthropic and verifier keys); this server holds none.
import { ClaudeDecisions, DEFAULT_BUDGET, MxVerifier, VERIFY_MODE, memoryCache, type Ctx } from "@cf/core";
import { edgeClient, layeredCache } from "../../web/src/lib/edgeClient.ts";
import { RPC, handleBody } from "./protocol.ts";
import { INSTRUCTIONS, RESOURCES, TOOLS, type Deps } from "./tools.ts";

export type Env = (key: string) => string | undefined;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version, mcp-session-id, accept",
  "Access-Control-Max-Age": "86400",
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "content-type": "application/json" } });

/** Length-independent comparison so the key can't be guessed one character at a time. */
function same(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Per tool call: a fresh edge client (own session, so parallel calls don't share a rate limit). */
export function edgeDeps(env: Env): Deps | undefined {
  const url = env("CF_EDGE_URL") || env("VITE_EDGE_URL");
  if (!url) return undefined;
  const token = env("CF_ACCESS_TOKEN_CLIENT") || env("VITE_ACCESS_TOKEN") || undefined;
  return {
    ctx(o = {}): Ctx {
      const client = edgeClient({ url, token, session: `mcp-${crypto.randomUUID().slice(0, 8)}`, retryDelayMs: 5000 });
      const llm: Ctx["llm"] = (r) => client.llm(r);
      const verify = !!o.verify && VERIFY_MODE !== "off";
      return {
        llm,
        cache: layeredCache(memoryCache(), client.cache),
        decisions: new ClaudeDecisions({ llm }),
        verifier: new MxVerifier(client.mx),
        site: client.site,
        shadow: client.shadow,
        evidence: client.evidence,
        mailbox: verify ? client.mailbox : undefined,
        budget: { ...DEFAULT_BUDGET },
        options: { roleFilter: o.roleFilter, verifyMode: verify ? "auto" : "off" },
      };
    },
  };
}

/**
 * The MCP endpoint. With CF_MCP_KEY set, the caller must present it as `?key=` in the URL (ChatGPT
 * developer mode, no auth) or `Authorization: Bearer`. OAuth comes with the login / app listing.
 */
export async function handleHttp(req: Request, env: Env, deps: Deps | undefined = edgeDeps(env)): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  // Open while CF_MCP_KEY is unset (same exposure as the website, capped by CF_DAILY_LIMIT);
  // set it to lock the server. OAuth replaces this with the login.
  const want = env("CF_MCP_KEY");
  if (want) {
    const url = new URL(req.url);
    const given = url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (!same(given, want)) return json({ error: "unauthorized" }, 401);
  }
  // Stateless server: no SSE stream to open and no session to end.
  // A browser visit gets a plain note; MCP clients only read the 405.
  if (req.method !== "POST") return new Response("ContactFlow MCP server is running. Add this URL as an app in ChatGPT (Developer mode).\n", { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS", "content-type": "text/plain; charset=utf-8" } });
  if (!deps) return json({ error: "edge function URL not configured (VITE_EDGE_URL)" }, 503);

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 500_000) return json({ jsonrpc: "2.0", id: null, error: { code: RPC.invalid, message: "body too large" } }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "invalid JSON" } }, 400);
  }
  const t0 = Date.now();
  const out = await handleBody(body, TOOLS, deps, INSTRUCTIONS, RESOURCES);
  await logCalls(env, body, out, Date.now() - t0, req.headers.get("user-agent"));
  return out === undefined ? new Response(null, { status: 202, headers: CORS }) : json(out);
}

/**
 * Diagnostics while we bring ContactFlow up in ChatGPT: which methods and tools the host calls, how
 * long they take, and whether they failed — never arguments, names or results. Stored for a day via
 * the edge cache (key company:mcplog-…). Off with CF_MCP_LOG=off.
 */
async function logCalls(env: Env, body: unknown, out: unknown, ms: number, ua: string | null) {
  const url = env("CF_EDGE_URL") || env("VITE_EDGE_URL");
  if (!url || env("CF_MCP_LOG") === "off") return;
  const msgs = (Array.isArray(body) ? body : [body]) as any[];
  const replies = (Array.isArray(out) ? out : [out]) as any[];
  const entry = {
    at: new Date().toISOString(),
    ms,
    ua: (ua ?? "").slice(0, 80),
    calls: msgs.map((m) => {
      const r = replies.find((x) => x && x.id === m?.id && m?.id !== undefined);
      return {
        method: String(m?.method ?? "?").slice(0, 40),
        tool: m?.method === "tools/call" ? String(m?.params?.name ?? "").slice(0, 40) : undefined,
        uri: m?.method === "resources/read" ? String(m?.params?.uri ?? "").slice(0, 80) : undefined,
        client: m?.method === "initialize" ? String(m?.params?.clientInfo?.name ?? "").slice(0, 40) : undefined,
        error: r?.error?.message?.slice(0, 120) ?? (r?.result?.isError ? String(r.result.content?.[0]?.text ?? "").slice(0, 120) : undefined),
        bytes: r ? JSON.stringify(r).length : 0,
      };
    }),
  };
  const key = `company:mcplog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const client = edgeClient({ url, token: env("CF_ACCESS_TOKEN_CLIENT") || env("VITE_ACCESS_TOKEN") || undefined, session: "mcp-log", retryDelayMs: 0 });
  await Promise.race([client.cache.set(key, entry, 1).catch(() => {}), new Promise((ok) => setTimeout(ok, 1500))]);
}