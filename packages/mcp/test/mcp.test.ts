import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Ctx, MailboxChecker } from "@cf/core";
import { mockCtx, toolResponse } from "../../core/test/helpers.ts";
import { handleHttp } from "../src/http.ts";
import { TOOLS, cleanResults, type Deps } from "../src/tools.ts";
import { WIDGET_MIME, WIDGET_URI } from "../src/widget.ts";
// @ts-expect-error plain .mjs build script
import { OUT, bundle } from "../../../scripts/build-mcp.mjs";

const flast = toolResponse("report_patterns", { patterns: [{ template: "{f}{last}", confidence: 0.8, source_url: "https://rocketreach.co/acme", stated: true }] });
const acmeDomain = toolResponse("report_domain", { domain: "acme.com", confidence: 0.9, source_url: "https://acme.com", alternatives: [] });

function setup(script: Parameters<typeof mockCtx>[0], mailbox?: MailboxChecker) {
  const seen: { verify?: boolean; roleFilter?: string }[] = [];
  const { ctx, calls } = mockCtx({ rescue_agent: toolResponse("finish", { gave_up: true }), ...script });
  const deps: Deps = {
    ctx: (o = {}) => {
      seen.push(o);
      return { ...ctx, mailbox: o.verify ? mailbox : undefined, options: { rescue: false, roleFilter: o.roleFilter, verifyMode: o.verify ? "auto" : "off" } } as Ctx;
    },
  };
  return { deps, calls, seen };
}

const env = (vars: Record<string, string>) => (k: string) => vars[k];
const rpc = (body: unknown, key = "secret") =>
  new Request(`https://contactflow.test/api/mcp?key=${key}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const call = async (deps: Deps, name: string, args: unknown) => {
  const res = await handleHttp(rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }), env({ CF_MCP_KEY: "secret" }), deps);
  return (await res.json()).result as { content: { text: string }[]; structuredContent?: any; isError: boolean };
};

describe("MCP protocol", () => {
  const { deps } = setup({});
  const E = env({ CF_MCP_KEY: "secret" });

  it("handshake: answers in the client's protocol version and lists the goal tools and the results view", async () => {
    const init = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }), E, deps)).json();
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", serverInfo: { name: "contactflow" }, capabilities: { tools: {} } });
    expect(init.result.instructions).toMatch(/never invent/);
    const list = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), E, deps)).json();
    expect(list.result.tools.map((t: any) => t.name)).toEqual(["find_emails", "get_email_format", "show_results"]);
    for (const t of list.result.tools) expect(t).toMatchObject({ inputSchema: { type: "object" }, annotations: { readOnlyHint: true } });
  });

  it("results view: show_results links the UI resource, which resources/read serves as an MCP App", async () => {
    const init = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }), E, deps)).json();
    expect(init.result.capabilities.resources).toBeDefined();
    const list = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), E, deps)).json();
    const show = list.result.tools.find((t: any) => t.name === "show_results");
    expect(show._meta).toMatchObject({ ui: { resourceUri: WIDGET_URI }, "openai/outputTemplate": WIDGET_URI });
    // Data tools don't carry the template (the view renders once, from show_results).
    expect(list.result.tools.find((t: any) => t.name === "find_emails")._meta.ui).toBeUndefined();
    const res = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 3, method: "resources/list" }), E, deps)).json();
    expect(res.result.resources).toEqual([expect.objectContaining({ uri: WIDGET_URI, mimeType: WIDGET_MIME })]);
    const read = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: WIDGET_URI } }), E, deps)).json();
    const html = read.result.contents[0];
    expect(html).toMatchObject({ uri: WIDGET_URI, mimeType: "text/html;profile=mcp-app" });
    expect(html.text).toContain("ui/notifications/tool-result");
    expect(html.text).not.toMatch(/innerHTML/); // results are untrusted: text only
    expect(html._meta.ui.csp.connectDomains).toEqual([]);
  });

  it("notifications get 202 with no body; batches; unknown methods are JSON-RPC errors", async () => {
    expect((await handleHttp(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), E, deps)).status).toBe(202);
    const batch = await (await handleHttp(rpc([{ jsonrpc: "2.0", id: 1, method: "ping" }, { jsonrpc: "2.0", method: "notifications/x" }]), E, deps)).json();
    expect(batch).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    const bad = await (await handleHttp(rpc({ jsonrpc: "2.0", id: 3, method: "prompts/list" }), E, deps)).json();
    expect(bad.error.code).toBe(-32601);
  });

  it("open while CF_MCP_KEY is unset; once set, a missing or wrong key is refused", async () => {
    expect((await handleHttp(new Request("https://contactflow.test/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) }), env({}), deps)).status).toBe(200);
    expect((await handleHttp(rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, "nope"), E, deps)).status).toBe(401);
    const bearer = new Request("https://contactflow.test/api/mcp", { method: "POST", headers: { authorization: "Bearer secret" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    expect((await handleHttp(bearer, E, deps)).status).toBe(200);
    const visit = await handleHttp(new Request("https://contactflow.test/api/mcp?key=secret"), E, deps);
    expect(visit.status).toBe(405); // no SSE stream
    expect(await visit.text()).toMatch(/MCP server is running/);
  });
});

describe("tools", () => {
  it("find_emails: structured names in, no reading step, emails with source and verified label out", async () => {
    const { deps, calls } = setup({ discover_pattern: flast });
    const r = await call(deps, "find_emails", { people: [{ first: "Jane", last: "Doe", title: "Partner", company: "Acme", domain: "acme.com", ref: "r1" }] });
    expect(r.isError).toBe(false);
    expect(calls.map((c) => c.stage)).not.toContain("classify_extract");
    expect(r.structuredContent.people[0]).toMatchObject({ ref: "r1", emails: [{ address: "jdoe@acme.com" }], verified: "not checked", pattern: { format: "flast", source: "RocketReach" } });
    expect(r.content[0].text).toContain("jdoe@acme.com [verified: not checked]");
    expect(r.content[0].text).toContain("Acme — acme.com · format flast 80%");
  });

  it("find_emails verify: a valid mailbox proves the format", async () => {
    const box: MailboxChecker = { name: "test", real: true, check: async (emails) => Object.fromEntries(emails.map((e) => [e, "valid" as const])) };
    const { deps, seen } = setup({ discover_pattern: flast }, box);
    const r = await call(deps, "find_emails", { people: [{ first: "Jane", last: "Doe", company: "Acme", domain: "acme.com" }], verify: true });
    expect(seen[0].verify).toBe(true);
    expect(r.structuredContent.companies[0].verification).toBe("format proven");
    expect(r.structuredContent.people[0].verified).toBe("yes");
  });

  it("find_emails checks mailboxes by default; verify:false turns it off", async () => {
    const { deps, seen } = setup({ discover_pattern: flast });
    await call(deps, "find_emails", { people: [{ first: "Jane", last: "Doe", company: "Acme", domain: "acme.com" }] });
    await call(deps, "find_emails", { people: [{ first: "Jane", last: "Doe", company: "Acme", domain: "acme.com" }], verify: false });
    expect(seen.map((o) => o.verify)).toEqual([true, false]);
  });

  it("show_results keeps only displayable fields: no lookups, bad links and non-addresses dropped", async () => {
    const { deps, calls } = setup({});
    const r = await call(deps, "show_results", {
      people: [{ first: "Jane", last: "Doe", company: "Acme", emails: [{ address: "jdoe@acme.com" }, { address: "<img src=x>" }], verified: "yes", extra: "x" }],
      companies: [{ name: "Acme", domain: "acme.com", patterns: [{ format: "flast", confidence: 0.8, source: "RocketReach", source_url: "javascript:alert(1)" }], verification: "format proven" }],
    });
    expect(calls).toHaveLength(0);
    expect(r.structuredContent.people[0]).toMatchObject({ first: "Jane", emails: [{ address: "jdoe@acme.com" }], verified: "yes" });
    expect(r.structuredContent.people[0].extra).toBeUndefined();
    expect(r.structuredContent.companies[0].patterns[0].source_url).toBeUndefined();
    expect(r.content[0].text).toMatch(/Showing 1 people \(1 with an email\)/);
    expect(cleanResults({}).people).toEqual([]);
  });

  it("find_emails: more than 3 companies is refused before anything is spent", async () => {
    const { deps, calls } = setup({});
    const people = ["A", "B", "C", "D"].map((c) => ({ first: "Jo", last: "Li", company: `${c} Corp` }));
    const r = await call(deps, "find_emails", { people });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/At most 3 companies/);
    expect(calls).toHaveLength(0);
  });

  it("find_emails: bad input comes back as a readable error", async () => {
    const { deps } = setup({});
    const r = await call(deps, "find_emails", { people: [{ first: "Jo", last: "Li" }] });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/people\[0\]\.company: required/);
  });

  it("get_email_format: formats with sources; refuses linkedin.com", async () => {
    const { deps } = setup({ discover_pattern: flast });
    const r = await call(deps, "get_email_format", { domain: "https://www.acme.com/team" });
    expect(r.structuredContent).toMatchObject({ domain: "acme.com", formats: [{ format: "flast", confidence: 0.8, source: "RocketReach" }] });
    expect((await call(deps, "get_email_format", { domain: "linkedin.com" })).isError).toBe(true);
  });

  it("get_email_format by company name: finds the domain itself, then the format; cached after", async () => {
    const { deps, calls } = setup({ resolve_domain: acmeDomain, discover_pattern: flast });
    const r = await call(deps, "get_email_format", { company: "Acme" });
    expect(r.structuredContent).toMatchObject({ company: "Acme", domain: "acme.com", formats: [{ format: "flast" }] });
    expect(r.content[0].text).toContain("flast@acme.com 80%");
    await call(deps, "get_email_format", { company: "Acme" });
    expect(calls.filter((c) => c.stage === "resolve_domain")).toHaveLength(1);
    expect((await call(deps, "get_email_format", {})).isError).toBe(true);
  });

  it("tool descriptions stay within what the server enforces", () => {
    const find = TOOLS.find((t) => t.name === "find_emails")!;
    expect(find.description).toMatch(/up to 3 companies/);
  });
});

describe("Vercel bundle", () => {
  it("packages/web/api/mcp.js is up to date (run `pnpm mcp:build`)", async () => {
    expect(readFileSync(OUT, "utf8") === (await bundle())).toBe(true);
  });
});
