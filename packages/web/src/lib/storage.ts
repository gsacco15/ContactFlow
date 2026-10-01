import type { Cache } from "@cf/core";

const ok = (() => {
  try {
    localStorage.setItem("cf:probe", "1");
    localStorage.removeItem("cf:probe");
    return true;
  } catch {
    return false;
  }
})();

export function load<T>(key: string): T | undefined {
  if (!ok) return undefined;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function save(key: string, value: unknown) {
  if (!ok) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — the run still works, it just won't survive a refresh */
  }
}

export function remove(key: string) {
  if (ok) localStorage.removeItem(key);
}

export function sessionId(): string {
  let id = load<string>("cf:session");
  if (!id) {
    id = crypto.randomUUID();
    save("cf:session", id);
  }
  return id;
}

/** Browser-side domain → patterns cache, so a cold edge cache still feels fast. */
export const localCache: Cache = {
  async get(k) {
    const e = load<{ v: unknown; exp: number }>(`cf:cache:${k}`);
    if (!e) return undefined;
    if (e.exp < Date.now()) return void remove(`cf:cache:${k}`);
    return e.v;
  },
  async set(k, v, ttlDays) {
    save(`cf:cache:${k}`, { v, exp: Date.now() + ttlDays * 86_400_000 });
  },
};

export function clearLocalCache() {
  if (!ok) return;
  for (const k of Object.keys(localStorage)) if (k.startsWith("cf:cache:")) localStorage.removeItem(k);
}
