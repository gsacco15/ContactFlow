import { relevance, type Contact } from "@cf/core";

/**
 * ✓ / ? / ✗ for "Who do you want?", with the judge's % and reason on hover.
 * With onChange, clicking cycles: judge's call → keep → drop → judge's call.
 */
export function FitBadge({ c, want, onChange }: { c: Contact; want: string; onChange?: (patch: Pick<Contact, "keep" | "drop">) => void }) {
  if (!want.trim()) return null;
  const verdict = relevance(c, want);
  const judged = c.fit && c.fit.for === want.trim() ? c.fit : undefined;
  const override = c.keep ? "kept by you" : c.drop ? "dropped by you" : "";
  const icon = verdict === false ? "✗" : judged?.tier === "maybe" && !c.keep ? "?" : verdict === true ? "✓" : "?";
  const tone = icon === "✓" ? "text-emerald-700 bg-emerald-50" : icon === "✗" ? "text-stone-500 bg-stone-100" : "text-amber-700 bg-amber-50";
  const pct = judged ? `${Math.round(judged.p * 100)}%` : "";
  const title = [
    judged ? `${judged.by === "jev" ? "Jev" : "Claude"}: ${pct} relevant${judged.reason ? ` — ${judged.reason}` : ""}` : verdict === undefined ? "Not judged (no title, or judge unavailable) — kept" : "Keyword match",
    override,
    onChange ? "Click to change: keep → drop → automatic" : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const next = () => onChange?.(c.keep ? { keep: undefined, drop: true } : c.drop ? { keep: undefined, drop: undefined } : { keep: true, drop: undefined });
  return (
    <button type="button" onClick={onChange ? next : undefined} title={title} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${tone} ${onChange ? "cursor-pointer hover:ring-1 hover:ring-stone-300" : "cursor-default"}`}>
      {icon}
      {pct && <span className="font-normal opacity-70">{pct}</span>}
      {override && <span className="font-normal">· {c.keep ? "kept" : "dropped"}</span>}
    </button>
  );
}
