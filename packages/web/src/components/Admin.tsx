import { useEffect, useState, type FormEvent } from "react";
import { fetchAdmin, type AdminAllTime, type AdminDay, type AdminSession, type AdminStats } from "../lib/admin.ts";
import { load, remove, save } from "../lib/storage.ts";
import { ACCENT } from "./Logo.tsx";
import { Banner, Button } from "./ui.tsx";

const KEY = "cf:admin-key";
const usd = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? "—" : `$${n.toFixed(digits)}`);
const shortDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/** Private stats page (#admin): today's spend against the cap, the last 30 days, cap hits and own keys. */
export function Admin() {
  const [key, setKey] = useState<string>(() => load<string>(KEY) ?? "");
  const [stats, setStats] = useState<AdminStats>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const refresh = async (k = key) => {
    if (!k) return;
    setLoading(true);
    setError(undefined);
    try {
      setStats(await fetchAdmin(k));
      save(KEY, k);
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      if (/wrong password/.test(msg)) {
        remove(KEY);
        setStats(undefined);
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (key) void refresh(key);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lock = () => {
    remove(KEY);
    setKey("");
    setStats(undefined);
  };

  if (!stats) return <Unlock value={key} onChange={setKey} onSubmit={() => refresh()} loading={loading} error={error} />;

  const today = stats.days[0];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-stone-900">Admin</h2>
        <div className="flex gap-2">
          <Button onClick={() => refresh()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
          <Button variant="ghost" onClick={lock} title="Forget the password on this device">
            Lock
          </Button>
        </div>
      </div>
      {error && <Banner tone="error">{error}</Banner>}
      {today && <Today day={today} cap={stats.cap} />}
      {stats.all_time && <AllTime t={stats.all_time} />}
      <SpendChart days={stats.days} cap={stats.cap} />
      <DayTable days={stats.days} />
      <Sessions sessions={stats.sessions} />
      <p className="text-xs text-stone-500">
        Days are UTC (the cap resets at 00:00 UTC). Spend is estimated from list prices; the exact bill is in the Anthropic Console. Visitors are distinct hashed IPs on the
        website; ChatGPT lookups are counted separately. A session is one browser (a random id the app keeps on that device), so the same person on a phone and a laptop
        shows as two.
      </p>
    </div>
  );
}

function Unlock({ value, onChange, onSubmit, loading, error }: { value: string; onChange: (v: string) => void; onSubmit: () => void; loading: boolean; error?: string }) {
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-3 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-900">Admin</h2>
      <p className="text-sm text-stone-500">Enter the admin password (the CF_ADMIN_KEY secret). It’s remembered on this device until you lock.</p>
      <input
        type="password"
        autoComplete="current-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
        placeholder="Password"
        aria-label="Admin password"
        autoFocus
      />
      {error && <Banner tone="error">{error}</Banner>}
      <Button variant="primary" type="submit" disabled={!value || loading} className="w-full">
        {loading ? "Checking…" : "Open"}
      </Button>
    </form>
  );
}

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="text-xs text-stone-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-stone-900">{value}</div>
      {note && <div className="mt-0.5 text-xs text-stone-500">{note}</div>}
    </div>
  );
}

function Today({ day, cap }: { day: AdminDay; cap: number }) {
  const spent = day.spend ?? 0;
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
  const over = spent >= cap;
  return (
    <section className="space-y-3" aria-label="Today">
      <div className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-xs text-stone-500">Today’s free spend</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums text-stone-900">
              {usd(spent)} <span className="text-base font-normal text-stone-500">of {usd(cap, 0)} cap</span>
            </div>
          </div>
          <div className={`text-sm font-medium ${over ? "text-red-700" : "text-stone-600"}`}>{over ? "Cap reached: free searches paused until 00:00 UTC" : `${usd(Math.max(0, cap - spent))} left today`}</div>
        </div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-stone-100" role="progressbar" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={Number(spent.toFixed(2))} aria-label="Spend against today’s cap">
          <div className={`h-full rounded-full ${over ? "bg-red-600" : ""}`} style={{ width: `${pct}%`, background: over ? undefined : ACCENT }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Visitors" value={day.visitors} />
        <Tile label="Web searches" value={day.searches} />
        <Tile label="Mailbox checks" value={day.checks} />
        <Tile label="Hit the cap" value={day.capped_visitors} note={day.capped_requests ? `${day.capped_requests} requests turned away` : undefined} />
        <Tile label="Used own key" value={day.own_key_visitors} note={day.own_key_spend ? `${usd(day.own_key_spend)} on their keys` : undefined} />
        <Tile label="ChatGPT lookups" value={day.chatgpt_lookups} />
      </div>
    </section>
  );
}

/** Daily spend, oldest → newest, with the cap as a dashed line. Hover (or tap) a bar for that day. */
function SpendChart({ days, cap }: { days: AdminDay[]; cap: number }) {
  const series = [...days].reverse();
  const [hover, setHover] = useState<number>();
  const W = 720, H = 180, top = 12, bottom = 22, left = 36;
  const max = Math.max(cap, ...series.map((d) => d.spend ?? 0)) * 1.08 || 1;
  const y = (v: number) => top + (H - top - bottom) * (1 - v / max);
  const slot = (W - left) / series.length;
  const bw = Math.max(2, slot - 2); // 2px gap between bars
  const shown = hover !== undefined ? series[hover] : series[series.length - 1];
  const ticks = [0, cap / 2, cap];
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Daily spend">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-stone-900">Daily free spend · last {series.length} days</h3>
        {shown && (
          <span className="text-xs tabular-nums text-stone-600" aria-live="polite">
            {shortDay(shown.day)}: <b className="text-stone-900">{usd(shown.spend)}</b> · {shown.visitors} visitors · {shown.searches} searches · {shown.checks} checks
            {shown.capped_visitors ? ` · ${shown.capped_visitors} hit cap` : ""}
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Bar chart of daily spend with the daily cap as a dashed line" onMouseLeave={() => setHover(undefined)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-stone-200" strokeWidth={1} />
            <text x={left - 6} y={y(t) + 3} textAnchor="end" className="fill-stone-500 text-[10px]">
              ${t % 1 ? t.toFixed(1) : t}
            </text>
          </g>
        ))}
        {series.map((d, i) => {
          const v = d.spend ?? 0;
          const x = left + i * slot + 1;
          const h = Math.max(v > 0 ? 2 : 0, y(0) - y(v));
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
              <rect x={left + i * slot} y={top} width={slot} height={H - top - bottom} fill="transparent" />
              {h > 0 && <rect x={x} y={y(0) - h} width={bw} height={h} rx={Math.min(4, bw / 2)} fill={v >= cap ? "#dc2626" : ACCENT} opacity={hover === undefined || hover === i ? 1 : 0.45} />}
            </g>
          );
        })}
        <line x1={left} x2={W} y1={y(cap)} y2={y(cap)} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={W} y={y(cap) - 4} textAnchor="end" className="fill-red-700 text-[10px]">
          cap ${cap}
        </text>
        {series.map((d, i) =>
          i % 7 === series.length % 7 || i === series.length - 1 ? (
            <text key={d.day} x={left + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="fill-stone-500 text-[10px]">
              {shortDay(d.day)}
            </text>
          ) : null,
        )}
      </svg>
    </section>
  );
}

function DayTable({ days }: { days: AdminDay[] }) {
  const active = days.filter((d) => d.spend || d.visitors || d.searches || d.checks || d.capped_requests || d.chatgpt_lookups || d.own_key_spend);
  return (
    <section className="rounded-xl border border-stone-200 bg-white shadow-sm" aria-label="Per day">
      <h3 className="px-4 pt-4 font-semibold text-stone-900">Per day</h3>
      <div className="overflow-x-auto p-2">
        <table className="w-full text-right text-sm tabular-nums">
          <thead className="text-xs text-stone-500">
            <tr>
              {["Day", "Free spend", "Own-key spend", "Visitors", "Searches", "Checks", "Hit cap", "Own key", "ChatGPT"].map((h, i) => (
                <th key={h} className={`whitespace-nowrap px-2 py-2 font-medium ${i === 0 ? "text-left" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-stone-700">
            {active.map((d) => (
              <tr key={d.day} className="border-t border-stone-100">
                <td className="whitespace-nowrap px-2 py-1.5 text-left text-stone-900">{shortDay(d.day)}</td>
                <td className="px-2 py-1.5 font-medium text-stone-900">{usd(d.spend)}</td>
                <td className="px-2 py-1.5">{d.own_key_spend ? usd(d.own_key_spend) : "—"}</td>
                <td className="px-2 py-1.5">{d.visitors}</td>
                <td className="px-2 py-1.5">{d.searches}</td>
                <td className="px-2 py-1.5">{d.checks}</td>
                <td className="px-2 py-1.5">{d.capped_visitors || "—"}</td>
                <td className="px-2 py-1.5">{d.own_key_visitors || "—"}</td>
                <td className="px-2 py-1.5">{d.chatgpt_lookups || "—"}</td>
              </tr>
            ))}
            {!active.length && (
              <tr>
                <td colSpan={9} className="px-2 py-6 text-center text-stone-500">
                  No activity yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** One row per browser in the last 7 days, most recent first. */
function Sessions({ sessions }: { sessions: AdminSession[] }) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white shadow-sm" aria-label="Recent sessions">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-4">
        <h3 className="font-semibold text-stone-900">Recent sessions · last 7 days</h3>
        <span className="text-xs text-stone-500">{sessions.length === 50 ? "latest 50" : `${sessions.length} sessions`}</span>
      </div>
      <div className="overflow-x-auto p-2">
        <table className="w-full text-right text-sm tabular-nums">
          <thead className="text-xs text-stone-500">
            <tr>
              {["Session", "Last active", "First seen", "Days", "Requests", "Free spend", "Searches", "Checks", ""].map((h, i) => (
                <th key={h || i} className={`whitespace-nowrap px-2 py-2 font-medium ${i < 3 ? "text-left" : ""}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-stone-700">
            {sessions.map((x) => (
              <tr key={x.id + x.first_seen} className="border-t border-stone-100">
                <td className="px-2 py-1.5 text-left font-mono text-xs text-stone-900">{x.id}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-left">{when(x.last_seen)}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-left text-stone-500">{when(x.first_seen)}</td>
                <td className="px-2 py-1.5">{x.active_days}</td>
                <td className="px-2 py-1.5">{x.requests}</td>
                <td className="px-2 py-1.5 font-medium text-stone-900">{usd(x.spend)}</td>
                <td className="px-2 py-1.5">{x.searches}</td>
                <td className="px-2 py-1.5">{x.checks}</td>
                <td className="whitespace-nowrap px-2 py-1.5 text-left text-xs">
                  {x.own_key && <span className="mr-1 rounded-full bg-sky-50 px-1.5 py-px text-sky-800 ring-1 ring-sky-200">own key</span>}
                  {x.hit_cap && <span className="rounded-full bg-red-50 px-1.5 py-px text-red-700 ring-1 ring-red-200">hit cap</span>}
                </td>
              </tr>
            ))}
            {!sessions.length && (
              <tr>
                <td colSpan={9} className="px-2 py-6 text-center text-stone-500">
                  No sessions in the last 7 days.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Running totals since the first logged request. */
function AllTime({ t }: { t: AdminAllTime }) {
  const since = t.since ? new Date(t.since).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : undefined;
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm" aria-label="All time">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-xs text-stone-500">All-time free spend{since ? ` · since ${since}` : ""}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-stone-900">{usd(t.spend)}</div>
          {t.own_key_spend > 0 && <div className="mt-0.5 text-xs text-stone-500">+ {usd(t.own_key_spend)} paid by visitors’ own keys</div>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Visitors", t.visitors],
          ["Sessions", t.sessions],
          ["Web searches", t.searches],
          ["Mailbox checks", t.checks],
          ["ChatGPT lookups", t.chatgpt_lookups],
          ["Hit the cap", t.capped_visitors],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-stone-500">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold tabular-nums text-stone-900">{Number(value).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
