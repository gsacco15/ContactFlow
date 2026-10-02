// HTTP client for the `pipeline` edge function. No React; also used by scripts/smoke.ts.
import { SITE_BIO_PAGES, SITE_MAX_PAGES } from "@cf/core";
import type { Cache, Evidence, EvidenceStore, MailboxChecker, VerifyStatus, JevRequest, JevResponse, LlmRequest, LlmResponse, SiteRead, SiteShadowRow } from "@cf/core";

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
    /** The company's own public pages, read by the edge function (no AI, no cost). */
    site: (domain: string) => post<SiteRead>("site", { domain, maxPages: SITE_MAX_PAGES, bioPages: SITE_BIO_PAGES }),
    /** Site-reading trial log (domain-level only). */
    shadow: async (row: SiteShadowRow) => void (await post("shadow", row)),
    /** Mailbox checks through the provider set in the edge function (CF_VERIFIER). `real` is
     * false for the stand-in, whose answers are never recorded as evidence. */
    mailbox: ((): MailboxChecker => {
      const box: MailboxChecker = {
        name: "verifier",
        real: false,
        async check(emails: string[]) {
          const r = await post<{ provider: string; real: boolean; results: Record<string, VerifyStatus> }>("verify", { emails });
          box.name = r.provider;
          box.real = r.real;
          return r.results;
        },
      };
      return box;
    })(),
    /** Evidence engine store: domain-level format facts only; paste evidence is never sent. */
    evidence: {
      record: async (rows: Evidence[]) => {
        const global = rows.filter((r) => r.scope === "global");
        if (global.length) await post("evidence", { op: "record", rows: global });
      },
      forDomain: async (domain: string) => {
        const { rows } = await post<{ rows: Record<string, unknown>[] }>("evidence", { op: "get", domain });
        // The server stores nulls; core wants missing fields.
        return rows.map((r) => ({ ...Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null)), template: r.template ?? null, scope: "global" }) as Evidence);
      },
    } satisfies EvidenceStore,
    /** TypeSafe Jev batch, proxied by the edge function (which holds the key). */
    jev: async (requests: JevRequest[]): Promise<JevResponse[]> => (await post<{ responses: JevResponse[] }>("jev", { requests })).responses,
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
