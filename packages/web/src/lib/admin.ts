// Owner's stats (#admin): one POST to the edge function's /admin route with the CF_ADMIN_KEY password.
import { ACCESS_TOKEN, EDGE_URL } from "../config.ts";

export type AdminDay = {
  day: string; // YYYY-MM-DD, UTC
  spend: number | null; // our cost; null before cost tracking existed
  own_key_spend: number;
  visitors: number;
  own_key_visitors: number;
  chatgpt_lookups: number;
  searches: number;
  checks: number;
  capped_visitors: number;
  capped_requests: number;
};

/** One browser on the website (its random session id, first 8 characters), last 7 days. */
export type AdminSession = {
  id: string;
  first_seen: string;
  last_seen: string;
  active_days: number;
  requests: number;
  spend: number | null;
  searches: number;
  checks: number;
  own_key: boolean;
  hit_cap: boolean;
};

/** Everything ever logged; spend is what the site paid (own-key calls apart). */
export type AdminAllTime = {
  since: string | null;
  spend: number;
  own_key_spend: number;
  requests: number;
  searches: number;
  checks: number;
  visitors: number;
  sessions: number;
  chatgpt_lookups: number;
  capped_visitors: number;
};

export type AdminStats = { today: string; all_time?: AdminAllTime; days: AdminDay[]; sessions: AdminSession[]; cap: number; per_visitor_cap: number };

export async function fetchAdmin(key: string, days = 30): Promise<AdminStats> {
  if (!EDGE_URL) throw new Error("Not connected (VITE_EDGE_URL is not set)");
  const res = await fetch(`${EDGE_URL.replace(/\/+$/, "")}/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-session": "admin", ...(ACCESS_TOKEN ? { "x-cf-token": ACCESS_TOKEN } : {}) },
    body: JSON.stringify({ key, days }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  const money = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return {
    ...data,
    days: (data.days ?? []).map((d: AdminDay) => ({ ...d, spend: money(d.spend), own_key_spend: Number(d.own_key_spend) })),
    sessions: (data.sessions ?? []).map((x: AdminSession) => ({ ...x, spend: money(x.spend) })),
    all_time: data.all_time ? { ...data.all_time, spend: Number(data.all_time.spend), own_key_spend: Number(data.all_time.own_key_spend) } : undefined,
  };
}
