import type { Cache } from "./types.ts";

/** In-memory Cache with TTL. The web app layers browser storage + the edge cache on top of the same shape. */
export function memoryCache(now: () => number = Date.now): Cache & { store: Map<string, { v: any; exp: number }> } {
  const store = new Map<string, { v: any; exp: number }>();
  return {
    store,
    async get(k) {
      const e = store.get(k);
      if (!e) return undefined;
      if (e.exp < now()) {
        store.delete(k);
        return undefined;
      }
      return e.v;
    },
    async set(k, v, ttlDays) {
      store.set(k, { v, exp: now() + ttlDays * 86_400_000 });
    },
  };
}
