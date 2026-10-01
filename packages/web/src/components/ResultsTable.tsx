import { useState } from "react";
import { patternLabel, type Candidate, type Company, type Contact } from "@cf/core";
import { LOW_DOMAIN_CONFIDENCE } from "../config.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Button, LinkIcon, Pill } from "./ui.tsx";

const STATUS_TONE = { pending: "stone", ok: "green", no_domain: "red", no_pattern: "amber", error: "red" } as const;
const STATUS_LABEL = { pending: "pending", ok: "ok", no_domain: "no domain", no_pattern: "no pattern", error: "error" } as const;

export function ResultsTable({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const { filters } = state;
  if (!state.order.length) return null;

  let rows = state.order.map((id) => state.contacts[id]).filter(Boolean);
  const total = rows.length;
  const done = rows.filter((r) => r.status !== "pending").length;
  const ok = rows.filter((r) => r.status === "ok").length;
  if (filters.onlyOk) rows = rows.filter((r) => r.status === "ok");
  if (filters.hidePatternless) rows = rows.filter((r) => state.companies[r.company_id]?.patterns.length);
  if (filters.groupByCompany) rows = [...rows].sort((a, b) => (state.companies[a.company_id]?.name ?? "~").localeCompare(state.companies[b.company_id]?.name ?? "~"));

  const toggle = (k: keyof typeof filters) => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={filters[k]} onChange={(e) => dispatch({ type: "filters", filters: { [k]: e.target.checked } })} />
      {{ onlyOk: "Only ok", hidePatternless: "Hide rows without a found pattern", groupByCompany: "Group by company" }[k]}
    </label>
  );

  let lastCompany: string | undefined;
  return (
    <section className="space-y-2" aria-label="Results">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-stone-600">
        <span className="font-medium text-stone-900">
          {done}/{total} done · {ok} ok
        </span>
        {state.running && <div className="h-1.5 w-32 overflow-hidden rounded bg-stone-200"><div className="h-full bg-stone-800 transition-all" style={{ width: `${(done / total) * 100}%` }} /></div>}
        {toggle("onlyOk")}
        {toggle("hidePatternless")}
        {toggle("groupByCompany")}
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th className="px-3 py-2">Name / Title</th>
              <th className="px-3 py-2">Company → domain</th>
              <th className="px-3 py-2">Pattern</th>
              <th className="px-3 py-2">Email 1</th>
              <th className="px-3 py-2">Email 2</th>
              <th className="px-3 py-2">Email 3</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const co = state.companies[c.company_id];
              const header = filters.groupByCompany && co?.name !== lastCompany;
              lastCompany = co?.name;
              return [
                header && (
                  <tr key={`h-${c.company_id}`} className="bg-stone-50/70">
                    <td colSpan={7} className="px-3 py-1.5 text-xs font-semibold text-stone-600">
                      {co?.name ?? "No company"}
                    </td>
                  </tr>
                ),
                <Row key={c.id} c={c} co={co} p={p} />,
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stone-500">
        Emails are pattern-based guesses, not verified mailboxes. MX checks only confirm the domain accepts mail. You are responsible for CAN-SPAM (US) and GDPR/PECR (EU, UK) compliance:
        include an unsubscribe link, use an honest sender, and keep a suppression list.
      </p>
    </section>
  );
}

function Row({ c, co, p }: { c: Contact; co?: Company; p: Pipeline }) {
  const pattern = c.candidates[0] ? co?.patterns.find((x) => x.template === c.candidates[0].pattern) : undefined;
  const failed = c.status !== "ok" && c.status !== "pending";
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="px-3 py-2">
        <Editable value={`${c.first} ${c.last}`.trim()} className="font-medium" label="Name" onSave={(v) => {
          const [first, ...rest] = v.trim().split(/\s+/);
          p.editContact(c.id, { first: first ?? "", last: rest.join(" ") });
        }} />
        <Editable value={c.title ?? ""} placeholder="—" className="text-stone-500" label="Title" onSave={(v) => p.editContact(c.id, { title: v })} />
      </td>
      <td className="px-3 py-2">
        <div>{co?.name ?? <span className="text-stone-400">—</span>}</div>
        {co?.domain && (
          <div className={`flex items-center gap-1 ${co.domain_confidence !== undefined && co.domain_confidence < LOW_DOMAIN_CONFIDENCE ? "text-red-600" : "text-stone-500"}`} title={co.domain_confidence !== undefined ? `domain confidence ${co.domain_confidence.toFixed(2)}` : undefined}>
            {co.domain} <LinkIcon href={co.domain_source_url} title="Where the domain came from" />
          </div>
        )}
        {co?.mx_ok === false && <div className="text-xs text-red-600">no MX records</div>}
      </td>
      <td className="px-3 py-2">
        {c.candidates[0] && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs">{patternLabel(c.candidates[0].pattern)}</span>
            {pattern ? (
              <>
                <Pill tone={pattern.confidence >= 0.6 ? "green" : pattern.confidence >= 0.3 ? "amber" : "red"} title="Pattern confidence">
                  {Math.round(pattern.confidence * 100)}%
                </Pill>
                <LinkIcon href={pattern.source_url} title="Where the format was read from" />
              </>
            ) : (
              <Pill title="Statistical fallback — no source found for this domain">default</Pill>
            )}
          </div>
        )}
        {co?.rescue_note && <div className="mt-1 max-w-56 text-xs text-stone-500" title={co.rescue_note}>{c.rescued ? "rescued: " : ""}{co.rescue_note}</div>}
      </td>
      {[0, 1, 2].map((i) => (
        <td key={i} className="px-3 py-2">
          <Email cand={c.candidates[i]} />
        </td>
      ))}
      <td className="px-3 py-2">
        <div className="flex flex-col items-start gap-1">
          <Pill tone={STATUS_TONE[c.status]} title={c.error}>
            {c.status === "pending" && p.state.running ? "running…" : STATUS_LABEL[c.status]}
          </Pill>
          {c.error && <span className="max-w-48 text-xs text-stone-500">{c.error}</span>}
          {failed && co && (
            <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={p.state.running || !p.configured} onClick={() => p.retry(co.id)}>
              Retry
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

function Email({ cand }: { cand?: Candidate }) {
  const [copied, setCopied] = useState(false);
  if (!cand) return <span className="text-stone-300">—</span>;
  const valid = cand.verify_status === "valid";
  return (
    <button
      className="group flex items-center gap-1 rounded px-1 -mx-1 text-left font-mono text-xs hover:bg-stone-100"
      title={`${cand.verify_status ?? "unverified"} · click to copy`}
      onClick={async () => {
        await navigator.clipboard?.writeText(cand.email).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <span className={cand.verify_status === "invalid" ? "text-red-600 line-through" : ""}>{cand.email}</span>
      {valid && <span className="text-emerald-600" aria-label="verified">✓</span>}
      {copied && <span className="text-[10px] text-stone-500">copied</span>}
    </button>
  );
}

function Editable({ value, onSave, className = "", placeholder, label }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft === null)
    return (
      <div className={`cursor-text rounded hover:bg-stone-100 ${className}`} onClick={() => setDraft(value)} title="Click to edit">
        {value || <span className="text-stone-300">{placeholder}</span>}
      </div>
    );
  const commit = () => {
    if (draft !== value) onSave(draft);
    setDraft(null);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      className={`w-full rounded border border-stone-300 px-1 text-sm ${className}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}
