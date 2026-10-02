import { describe, expect, it } from "vitest";
import {
  FETCH_BLOCKED_DOMAINS, HttpError, RateLimiter, addUsage, buildParams, corsHeaders, fillPrompt, mxFromDoh,
  parseBody, readContent, webToolVersion, zeroUsage,
} from "../supabase/functions/pipeline/lib.ts";

const env = (vars: Record<string, string> = {}) => (k: string) => vars[k];

describe("buildParams", () => {
  it("one-shot stage: system prompt, stage tool, capped web search, auto tool choice", () => {
    const { params, betas } = buildParams(
      { stage: "discover_pattern", input: { domain: "acme.com" }, vars: { domain: "acme.com" }, maxSearches: 9 },
      "Format at {{domain}}. Templates like {first}.{last}.",
      env({ CF_EFFORT: "low" }),
    );
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.system).toBe("Format at acme.com. Templates like {first}.{last}.");
    expect(params.messages).toEqual([{ role: "user", content: '{"domain":"acme.com"}' }]);
    const tools = params.tools as any[];
    expect(tools.map((t) => t.name)).toEqual(["report_patterns", "web_search"]);
    expect(tools[1]).toEqual({ type: "web_search_20260209", name: "web_search", max_uses: 2 });
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.output_config).toEqual({ effort: "low" });
    expect(params.fallbacks).toBe("default");
    expect(betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("stage 1 has no web tools; decide runs on the classifier model without effort/fallbacks", () => {
    const a = buildParams({ stage: "classify_extract", input: "text" }, "p", env());
    expect((a.params.tools as any[]).map((t) => t.name)).toEqual(["extract_contacts"]);
    expect((a.params.messages as any[])[0].content).toBe("text");
    const b = buildParams({ stage: "decide", input: {} }, "p", env({ CF_EFFORT: "low" }));
    expect(b.params.model).toBe("claude-haiku-4-5");
    expect(b.params.output_config).toBeUndefined();
    expect(b.betas).toEqual([]);
  });

  it("find_people gets web_fetch with LinkedIn and data vendors blocked", () => {
    const { params } = buildParams({ stage: "find_people", input: {}, maxSearches: 1, maxFetches: 2 }, "p", env());
    const fetch = (params.tools as any[]).find((t) => t.name === "web_fetch");
    expect(fetch).toMatchObject({ type: "web_fetch_20260209", max_uses: 2 });
    expect(fetch.blocked_domains).toContain("linkedin.com");
    expect(FETCH_BLOCKED_DOMAINS).toContain("zoominfo.com");
  });

  it("agentic stage passes the message list through", () => {
    const messages = [{ role: "user", content: "{}" }];
    const { params } = buildParams({ stage: "rescue_agent", messages }, "p", env());
    expect(params.messages).toBe(messages);
    expect((params.tools as any[]).map((t) => t.name)).toEqual(["find_domain", "find_email_pattern", "find_people", "finish", "web_search", "web_fetch"]);
  });

  it("model ids come from env; Haiku domain model gets basic web tools", () => {
    const { params } = buildParams({ stage: "resolve_domain", input: {} }, "p", env({ CF_MODEL_DOMAIN: "claude-haiku-4-5", CF_FALLBACKS: "", CF_EFFORT: "low" }));
    expect(params.model).toBe("claude-haiku-4-5");
    expect((params.tools as any[])[1].type).toBe("web_search_20250305");
    expect(params.output_config).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
  });
});

describe("helpers", () => {
  it("webToolVersion", () => {
    expect(webToolVersion("claude-sonnet-5-5", env())).toBe("dynamic");
    expect(webToolVersion("claude-opus-5-5", env())).toBe("dynamic");
    expect(webToolVersion("claude-sonnet-4-6", env())).toBe("dynamic");
    expect(webToolVersion("claude-haiku-4-5", env())).toBe("basic");
    expect(webToolVersion("claude-sonnet-4-5", env())).toBe("basic");
    expect(webToolVersion("claude-sonnet-5-5", env({ CF_WEB_TOOL_VERSION: "basic" }))).toBe("basic");
  });

  it("fillPrompt only touches double-brace vars and strips newlines", () => {
    expect(fillPrompt("{{a}} {first} {{missing}}", { a: "x\ny" })).toBe("x y {first} {{missing}}");
  });

  it("parseBody validates", () => {
    expect(() => parseBody({ stage: "nope" })).toThrow(HttpError);
    expect(() => parseBody({ stage: "classify_extract" })).toThrow(/input/);
    expect(() => parseBody({ stage: "rescue_agent", input: "x" })).toThrow(/messages/);
    expect(() => parseBody({ stage: "classify_extract", input: "x".repeat(200_001) })).toThrow(/too large/);
    expect(parseBody({ stage: "classify_extract", input: "ok" }).stage).toBe("classify_extract");
  });

  it("readContent separates client tool calls from server tools and collects sources", () => {
    const { toolCalls, sources } = readContent([
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "q" } },
      { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://rocketreach.co/a" }] },
      { type: "web_fetch_tool_result", content: { type: "web_fetch_result", url: "https://acme.com/team" } },
      { type: "text", text: "x", citations: [{ url: "https://signalhire.com/b" }] },
      { type: "tool_use", id: "t1", name: "report_patterns", input: { patterns: [] } },
    ]);
    expect(toolCalls).toEqual([{ id: "t1", name: "report_patterns", input: { patterns: [] } }]);
    expect(sources).toEqual(["https://rocketreach.co/a", "https://acme.com/team", "https://signalhire.com/b"]);
  });

  it("readContent tolerates a search error object", () => {
    expect(readContent([{ type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }]).sources).toEqual([]);
  });

  it("addUsage keeps cache reads/writes apart from plain input, plus server tool counts", () => {
    const u = addUsage(zeroUsage(), { input_tokens: 10, cache_read_input_tokens: 5, cache_creation_input_tokens: 7, output_tokens: 3, server_tool_use: { web_search_requests: 2 } });
    expect(u).toEqual({ input_tokens: 10, output_tokens: 3, web_search_requests: 2, web_fetch_requests: 0, cache_read_input_tokens: 5, cache_creation_input_tokens: 7 });
  });

  it("prompt caching: on for classify_extract (system block) and rescue (also history), off for search stages; env can turn it off", () => {
    const env = (m: Record<string, string>) => (k: string) => m[k];
    const ex = buildParams({ stage: "classify_extract", input: "x" } as any, "PROMPT", env({})).params;
    expect(ex.system).toEqual([{ type: "text", text: "PROMPT", cache_control: { type: "ephemeral" } }]);
    expect(ex.cache_control).toBeUndefined();
    const rescue = buildParams({ stage: "rescue_agent", messages: [{ role: "user", content: "x" }] } as any, "P", env({})).params;
    expect(rescue.cache_control).toEqual({ type: "ephemeral" });
    const fmt = buildParams({ stage: "discover_pattern", input: { domain: "a.com" } } as any, "P", env({})).params;
    expect(fmt.system).toBe("P");
    const off = buildParams({ stage: "classify_extract", input: "x" } as any, "P", env({ CF_CACHE_STAGES: "" })).params;
    expect(off.system).toBe("P");
  });

  it("RateLimiter returns false after N calls per minute", () => {
    const rl = new RateLimiter(3);
    const t = 1_000_000;
    expect([1, 2, 3, 4].map((i) => rl.allow("s", t + i))).toEqual([true, true, true, false]);
    expect(rl.allow("other", t)).toBe(true);
    expect(rl.allow("s", t + 61_000)).toBe(true);
  });

  it("CORS echoes allowed origins only", () => {
    expect(corsHeaders("https://a.com", env())["Access-Control-Allow-Origin"]).toBe("*");
    const e = env({ CF_ALLOWED_ORIGINS: "https://a.com,https://b.com" });
    expect(corsHeaders("https://b.com", e)["Access-Control-Allow-Origin"]).toBe("https://b.com");
    expect(corsHeaders("https://evil.com", e)["Access-Control-Allow-Origin"]).toBe("https://a.com");
  });

  it("mxFromDoh", () => {
    expect(mxFromDoh({ Status: 0, Answer: [{ type: 15, data: "10 aspmx.l.google.com." }] })).toBe(true);
    expect(mxFromDoh({ Status: 0, Answer: [{ type: 15, data: "0 ." }] })).toBe(false);
    expect(mxFromDoh({ Status: 3 })).toBe(false);
    expect(mxFromDoh({ Status: 0 })).toBe(false);
  });
});

import { parseJevBatch } from "../supabase/functions/pipeline/lib.ts";

describe("parseJevBatch", () => {
  const ok = { state: "Name: A\nTitle: Partner", questions: { q: { type: "noul", instructions: "relevant?" } } };
  it("accepts typed questions", () => expect(parseJevBatch({ requests: [ok] })).toHaveLength(1));
  it("rejects bad shapes and oversize batches", () => {
    expect(() => parseJevBatch({})).toThrow(/requests/);
    expect(() => parseJevBatch({ requests: [{ ...ok, state: "" }] })).toThrow(/state/);
    expect(() => parseJevBatch({ requests: [{ ...ok, questions: { q: { type: "essay", instructions: "x" } } }] })).toThrow(/noul/);
    expect(() => parseJevBatch({ requests: Array(101).fill(ok) })).toThrow(/100/);
  });
});
