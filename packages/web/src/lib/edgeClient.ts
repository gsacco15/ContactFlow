// HTTP client for the `pipeline` edge function. No React; also used by scripts/smoke.ts.
import type { Cache, LlmRequest, LlmResponse } from "@cf/core";

export type EdgeOptions = {
  url: string;
  session: string;
  token?: string;
  /** Called when a 429 arrives; the client waits `seconds` and retries once. */
  onRateLimited?: (seconds: number) => void;
  retryDelayMs?: number;
  fetch?: typeof fetch;
};

export class EdgeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function edgeClient(o: EdgeOptions) {
  const base = o.url.replace(/\/+$/, "");
  const doFetch = o.fetch ?? fetch.bind(globalThis);
  const delay = o.retryDelayMs ?? 10_000;

  async function post<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(`${base}/${route}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-session": o.session, ...(o.token ? { "x-cf-token": o.token } : {}) },
        body: JSON.stringify(body),
        signal,
      });
      if (res.status === 429 && attempt === 0) {
        o.onRateLimited?.(delay / 1000);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new EdgeError(res.status, data?.error ?? `HTTP ${res.status}`);
      return data as T;
    }
  }

  return {
    llm: (req: LlmRequest, signal?: AbortSignal) => post<LlmResponse>("llm", req, signal),
    mx: async (domain: string) => (await post<{ ok: boolean }>("mx", { domain })).ok,
    cache: {
      get: async (key: string) => (await post<{ value: unknown }>("cache", { op: "get", key })).value ?? undefined,
      set: async (key: string, value: unknown, ttlDays: number) => void (await post("cache", { op: "set", key, value, ttlDays })),
    } satisfies Cache,
    health: async () => (await doFetch(`${base}/health`)).json(),
  };
}

export type EdgeClient = ReturnType<typeof edgeClient>;

/** Read local first, then remote; writes go to both. Remote failures never fail the run. */
export function layeredCache(local: Cache, remote?: Cache): Cache {
  return {
    async get(k) {
      const hit = await local.get(k);
      if (hit !== undefined) return hit;
      if (!remote) return undefined;
      const v = await remote.get(k).catch(() => undefined);
      if (v !== undefined && v !== null) await local.set(k, v, 1);
      return v ?? undefined;
    },
    async set(k, v, ttl) {
      await local.set(k, v, ttl);
      await remote?.set(k, v, ttl).catch(() => {});
    },
  };
}
