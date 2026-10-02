// Minimal MCP server over Streamable HTTP, stateless, JSON responses only (no SSE stream).
// Enough for ChatGPT developer mode and Claude: initialize, tools/list, tools/call, ping, and
// resources/list + resources/read for the MCP Apps results view.
// https://modelcontextprotocol.io/specification — no SDK, so it runs anywhere fetch does.

export const SERVER_INFO = { name: "contactflow", title: "ContactFlow", version: "0.1.0" };
/** Newest first; we answer with the client's version when we support it. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];

export type ToolResult = { text: string; data?: Record<string, unknown>; isError?: boolean };

export type Tool<D> = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  /** e.g. { ui: { resourceUri } } to render the results view; ChatGPT invocation labels. */
  _meta?: Record<string, unknown>;
  run: (args: Record<string, unknown>, deps: D) => Promise<ToolResult>;
};

/** A UI resource (MCP Apps): an HTML page the host shows in an iframe. */
export type Resource = { uri: string; name: string; mimeType: string; text: string; _meta?: Record<string, unknown> };

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: unknown; params?: any };
type RpcReply = { jsonrpc: "2.0"; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

export const RPC = { parse: -32700, invalid: -32600, method: -32601, params: -32602, internal: -32603 } as const;

const reply = (id: Rpc["id"], result: unknown): RpcReply => ({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string): RpcReply => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** One JSON-RPC message → its reply, or undefined for notifications (no id). */
export async function handleMessage<D>(msg: Rpc, tools: Tool<D>[], deps: D, instructions: string, resources: Resource[] = []): Promise<RpcReply | undefined> {
  if (!msg || typeof msg !== "object" || typeof msg.method !== "string") return fail(msg?.id, RPC.invalid, "invalid request");
  const isNotification = msg.id === undefined;
  if (isNotification) return undefined; // notifications/initialized, cancelled… nothing to say
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return reply(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false }, ...(resources.length ? { resources: { listChanged: false } } : {}) },
        serverInfo: SERVER_INFO,
        instructions,
      });
    }
    case "ping":
      return reply(msg.id, {});
    case "tools/list":
      return reply(msg.id, {
        tools: tools.map(({ name, title, description, inputSchema, annotations, _meta }) => ({ name, title, description, inputSchema, ...(annotations ? { annotations } : {}), ...(_meta ? { _meta } : {}) })),
      });
    case "resources/list":
      return reply(msg.id, { resources: resources.map(({ uri, name, mimeType, _meta }) => ({ uri, name, mimeType, ...(_meta ? { _meta } : {}) })) });
    case "resources/templates/list":
      return reply(msg.id, { resourceTemplates: [] });
    case "resources/read": {
      const r = resources.find((x) => x.uri === msg.params?.uri);
      if (!r) return fail(msg.id, RPC.params, `unknown resource: ${String(msg.params?.uri)}`);
      return reply(msg.id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text, ...(r._meta ? { _meta: r._meta } : {}) }] });
    }
    case "tools/call": {
      const tool = tools.find((t) => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, RPC.params, `unknown tool: ${String(msg.params?.name)}`);
      const args = msg.params?.arguments ?? {};
      if (typeof args !== "object" || Array.isArray(args)) return fail(msg.id, RPC.params, "arguments must be an object");
      try {
        const r = await tool.run(args, deps);
        return reply(msg.id, { content: [{ type: "text", text: r.text }], ...(r.data ? { structuredContent: r.data } : {}), isError: !!r.isError });
      } catch (e) {
        // Tool failures go back to the model as a result it can read, not as a protocol error.
        return reply(msg.id, { content: [{ type: "text", text: `Error: ${(e as Error)?.message ?? String(e)}` }], isError: true });
      }
    }
    default:
      return fail(msg.id, RPC.method, `method not found: ${msg.method}`);
  }
}

/** A POST body (one message or a batch) → the HTTP reply body, or undefined (202, nothing to send). */
export async function handleBody<D>(body: unknown, tools: Tool<D>[], deps: D, instructions: string, resources: Resource[] = []): Promise<unknown> {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, tools, deps, instructions, resources)))).filter(Boolean);
    return out.length ? out : undefined;
  }
  return handleMessage(body as Rpc, tools, deps, instructions, resources);
}
