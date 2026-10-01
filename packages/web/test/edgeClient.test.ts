import { describe, expect, it } from "vitest";
import { memoryCache } from "@cf/core";
import { EdgeError, edgeClient, layeredCache } from "../src/lib/edgeClient.ts";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

describe("edgeClient", () => {
  it("sends session and token headers to the stage route", async () => {
    const seen: [string, RequestInit][] = [];
    const c = edgeClient({
      url: "https://x.supabase.co/functions/v1/pipeline/",
      session: "sess",
      token: "tok",
      fetch: async (u, init) => {
        seen.push([String(u), init!]);
        return reply(200, { content: [], toolCalls: [], sources: [], usage: {} });
      },
    });
    await c.llm({ stage: "classify_extract", input: "hi" });
    expect(seen[0][0]).toBe("https://x.supabase.co/functions/v1/pipeline/llm");
    expect(seen[0][1].headers).toMatchObject({ "x-session": "sess", "x-cf-token": "tok" });
    expect(JSON.parse(String(seen[0][1].body))).toEqual({ stage: "classify_extract", input: "hi" });
  });

  it("on 429 waits, tells the UI, and retries once", async () => {
    const statuses = [429, 200];
    const waits: number[] = [];
    const c = edgeClient({
      url: "u",
      session: "s",
      retryDelayMs: 5,
      onRateLimited: (s) => waits.push(s),
      fetch: async () => reply(statuses.shift()!, { ok: true }),
    });
    expect(await c.mx("acme.com")).toBe(true);
    expect(waits).toEqual([0.005]);
  });

  it("surfaces a second 429 and other errors", async () => {
    const c = edgeClient({ url: "u", session: "s", retryDelayMs: 1, fetch: async () => reply(429, { error: "rate_limited" }) });
    await expect(c.mx("a.com")).rejects.toBeInstanceOf(EdgeError);
    const d = edgeClient({ url: "u", session: "s", fetch: async () => reply(502, { error: "anthropic 500" }) });
    await expect(d.llm({ stage: "decide", input: {} })).rejects.toThrow("anthropic 500");
  });
});

describe("layeredCache", () => {
  it("reads local first, falls back to remote, writes both, ignores remote failures", async () => {
    const local = memoryCache();
    const remote = memoryCache();
    await remote.set("domain:acme.com", { patterns: [] }, 30);
    const c = layeredCache(local, remote);
    expect(await c.get("domain:acme.com")).toEqual({ patterns: [] });
    expect(await local.get("domain:acme.com")).toEqual({ patterns: [] });
    await c.set("company:acme", { domain: "acme.com" }, 30);
    expect(await remote.get("company:acme")).toEqual({ domain: "acme.com" });
    const broken = layeredCache(memoryCache(), { get: () => Promise.reject(new Error("x")), set: () => Promise.reject(new Error("x")) });
    expect(await broken.get("k")).toBeUndefined();
    await expect(broken.set("k", 1, 1)).resolves.toBeUndefined();
  });
});
