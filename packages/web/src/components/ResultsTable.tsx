import { useState } from "react";
import { patternLabel, visibleCandidates, type Candidate, type Company, type Contact } from "@cf/core";
import { FitBadge } from "./FitBadge.tsx";
import { LOW_DOMAIN_CONFIDENCE } from "../config.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Button, LinkIcon, Pill } from "./ui.tsx";
import { listedRows, searchTime, tableRows, visibleSearches, wantFor } from "../state.ts";

/** One chip per search: tick to show/hide its rows (and leave them out of the export), × to remove it. */
function Searches({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const hidden = state.searches.some((x) => x.hidden);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {[...state.searches].reverse().map((x) => {
        const ids = Object.entries(state.rowSearches).filter(([, v]) => v.includes(x.id)).map(([k]) => k);
        const people = ids.filter((id) => state.contacts[id]);
        const ok = people.filter((id) => state.contacts[id].status === "ok").length;
        const running = state.activeSearch === x.id;
        return (
          <div
            key={x.id}
            className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm shadow-sm ${x.hidden ? "border-stone-200 bg-stone-50 text-stone-400" : "border-stone-300 bg-white"}`}
          >
            <input type="checkbox" aria-label={`Show ${x.label}`} checked={!x.hidden} onChange={(e) => dispatch({ type: "search_toggle", id: x.id, hidden: !e.target.checked || undefined })} />
            <button type="button" className="text-left" title="Show only this search" onClick={() => dispatch({ type: "search_only", id: x.id })}>
              <span className="font-medium">{x.label}</span>
              {x.want && <span className="text-stone-500"> · {x.want}</span>}
              <span className="block text-xs text-stone-400">
                {running ? "running…" : `${people.length} people · ${ok} with email`} · ${x.cost.toFixed(2)} · {searchTime(x.at)}
              </span>
            </button>
            <button
              type="button"
              aria-label={`Remove ${x.label}`}
              title="Remove this search (people another search also found stay)"
              disabled={running}
              className="ml-1 text-stone-400 hover:text-red-600 disabled:opacity-30"
              onClick={() => confirm(`Remove “${x.label}” from your list?`) && dispatch({ type: "search_remove", id: x.id })}
            >
              ×
            </button>
          </div>
        );
      })}
      {state.searches.length > 1 && (
        <span className="flex gap-1 text-xs">
          <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={!hidden} onClick={() => dispatch({ type: "search_all", hidden: false })}>
            Show all
          </Button>
          <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={state.searches.every((x) => x.hidden)} onClick={() => dispatch({ type: "search_all", hidden: true })}>
            Hide all
          </Button>
        </span>
      )}
    </div>
  );
}

const STATUS_TONE = { pending: "stone", ok: "green", no_domain: "red", no_pattern: "amber", error: "red", skipped: "stone" } as const;
const STATUS_LABEL = { pending: "pending", ok: "ok", no_domain: "no domain", no_pattern: "no sourced email", error: "error", skipped: "skipped" } as const;

export function ResultsTable({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const { filters } = state;
  const shown = visibleSearches(state);
  const listed = listedRows(state);
  const withRows = new Set(listed.map((c) => c.company_id));
  const empty = Object.values(state.companies).filter(
    (c) => (state.companySearches[c.id] ?? []).some((x) => shown.has(x)) && !withRows.has(c.id) && (c.fetched_at || c.error || c.domain || c.mx_ok === false || c.skipped),
  );
  if (!state.searches.length && !state.running) return null;

  const rows = tableRows(state);
  const total = listed.length;
  const done = listed.filter((r) => r.status !== "pending").length;
  const ok = listed.filter((r) => r.status === "ok").length;
  const anyWant = state.searches.some((x) => x.want);

  const toggle = (k: keyof typeof filters) => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={filters[k]} onChange={(e) => dispatch({ type: "filters", filters: { [k]: e.target.checked } })} />
      {{ onlyOk: "Only ok", hidePatternless: "Only rows with an email", groupByCompany: "Group by company", includeGuesses: "Include backup guesses", hideIrrelevant: "Hide not relevant" }[k]}
    </label>
  );

  let lastCompany: string | undefined;
  return (
    <section className="space-y-3" aria-label="Results">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-stone-200 pt-4">
        <h2 className="text-base font-semibold">Your list</h2>
        <span className="text-sm text-stone-500">
          {total} {total === 1 ? "person" : "people"} · {ok} with email{state.searches.length > 1 ? ` · ${shown.size} of ${state.searches.length} searches shown` : ""}
        </span>
        <Button
          variant="ghost"
          className="ml-auto !px-1.5 !py-0.5 text-xs"
          disabled={state.running}
          onClick={() => confirm("Remove every search and person from your list? Export first if you need them.") && p.clear()}
        >
          Clear list
        </Button>
      </div>
      <Searches p={p} />
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-stone-600">
        <span className="font-medium text-stone-900">
          {state.running ? `${done}/${total} done` : `${rows.length} shown`}
        </span>
        {state.running && (
          <span className="flex items-center gap-2" role="status">
            <span className="h-1.5 w-32 overflow-hidden rounded bg-stone-200">
              <span className="block h-full bg-stone-800 transition-all" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
            </span>
            <span className="animate-pulse">running…</span>
          </span>
        )}
        {toggle("hidePatternless")}
        {toggle("groupByCompany")}
        {anyWant && toggle("hideIrrelevant")}
        <span className="border-l border-stone-300 pl-4" title="Common formats with no source behind them. Off = they are hidden here and left out of Copy/CSV.">
          {toggle("includeGuesses")}
        </span>
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
      {empty.length > 0 && (
        <details open={empty.length <= 5} className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm">
          <summary className="mb-1 cursor-pointer text-xs font-semibold uppercase tracking-wide text-stone-500">Companies with no contacts ({empty.length})</summary>
          <ul className="space-y-0.5">
            {empty.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-2 text-stone-700">
                <span className="font-medium">{c.name}</span>
                {c.domain && <span className="text-stone-500">{c.domain}</span>}
                <span className="text-stone-500">
                  {c.skipped ?? c.error ?? (!c.domain ? "domain not found" : c.mx_ok === false ? "no MX records" : "no matching people found")}
                </span>
                {c.rescue_note && <span className="text-xs text-stone-400">({c.rescue_note})</span>}
                <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={state.running || !p.configured} onClick={() => p.retry(c.id)}>
                  Retry
                </Button>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="text-xs text-stone-500">
        Emails are pattern-based guesses, not verified mailboxes. MX checks only confirm the domain accepts mail. You are responsible for CAN-SPAM (US) and GDPR/PECR (EU, UK) compliance:
        include an unsubscribe link, use an honest sender, and keep a suppression list.
      </p>
    </section>
  );
}

function Row({ c, co, p }: { c: Contact; co?: Company; p: Pipeline }) {
  const top = c.candidates.find((x) => x.pattern !== "pasted");
  const pattern = top ? co?.patterns.find((x) => x.template === top.pattern) : undefined;
  const failed = c.status !== "ok" && c.status !== "pending" && c.status !== "skipped";
  const shown = visibleCandidates(c, { includeGuesses: !!p.state.filters.includeGuesses });
  return (
    <tr className="border-t border-stone-100 align-top">
      <td className="px-3 py-2">
        <div className="flex items-start gap-1">
          {c.flag && <span title={c.flag} className="cursor-help text-amber-600">⚠</span>}
          <FitBadge c={c} want={wantFor(p.state, c)} />
          <Editable value={[c.first, c.middle, c.last].filter(Boolean).join(" ")} placeholder="Unknown" className="font-medium" label="Name" onSave={(v) => {
            const parts = v.trim().split(/\s+/);
            const [first, ...rest] = parts;
            p.editContact(c.id, rest.length > 1 ? { first: first ?? "", middle: rest.slice(0, -1).join(" "), last: rest.at(-1)! } : { first: first ?? "", middle: undefined, last: rest.join(" ") });
          }} />
        </div>
        <Editable value={c.title ?? ""} placeholder="—" className="text-stone-500" label="Title" onSave={(v) => p.editContact(c.id, { title: v })} />
      </td>
      <td className="px-3 py-2">
        <div>{co?.name ?? <span className="text-stone-400">—</span>}</div>
        {co?.domain && (
          <div className={`flex items-center gap-1 ${co.domain_confidence !== undefined && co.domain_confidence < LOW_DOMAIN_CONFIDENCE ? "text-red-600" : "text-stone-500"}`} title={co.domain_confidence !== undefined ? `domain confidence ${co.domain_confidence.toFixed(2)}` : undefined}>
            {co.domain} {co.domain_from_paste ? <Pill tone="blue" title="Taken from a work email in your paste">from paste</Pill> : <LinkIcon href={co.domain_source_url} title="Where the domain came from" />}
          </div>
        )}
        {co?.mx_ok === false && <div className="text-xs text-red-600">no MX records</div>}
      </td>
      <td className="px-3 py-2">
        {c.candidates[0]?.pattern === "pasted" && (
          <div className="mb-1">
            <Pill tone="blue" title="This person’s own address, as it appeared in your paste">their address from paste</Pill>
          </div>
        )}
        {top && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-xs">{patternLabel(top.pattern)}</span>
            {pattern ? (
              <>
                <Pill
                  tone={pattern.confidence >= 0.6 ? "green" : pattern.confidence >= 0.3 ? "amber" : "red"}
                  title={pattern.from_paste ? "Confidence from your paste" : pattern.stated ? "Percentage stated by the source" : "Estimated from search snippets — no percentage was stated"}
                >
                  {pattern.stated === false || (!pattern.stated && !pattern.from_paste) ? "≈" : ""}
                  {Math.round(pattern.confidence * 100)}%
                </Pill>
                {pattern.from_paste ? (
                  <Pill tone="blue" title={pattern.quote ? `From your paste: “${pattern.quote}”` : "From your paste"}>from paste</Pill>
                ) : (
                  <LinkIcon href={pattern.source_url} title="Where the format was read from" />
                )}
              </>
            ) : (
              <Pill tone="amber" title="No source states this company’s format. These are the most common formats overall — treat them as low-confidence guesses.">no source · guess</Pill>
            )}
          </div>
        )}
        {co?.pattern_conflict && <div className="mt-1 text-xs text-amber-700">⚠ sources disagree: {co.pattern_conflict}</div>}
        {c.note && <div className="mt-1 max-w-56 text-xs text-stone-500">{c.note}</div>}
        {co?.rescue_note && <div className="mt-1 max-w-56 text-xs text-stone-500" title={co.rescue_note}>{c.rescued ? "rescued: " : ""}{co.rescue_note}</div>}
      </td>
      {[0, 1, 2].map((i) => (
        <td key={i} className="px-3 py-2">
          <Email cand={shown[i]} />
        </td>
      ))}
      <td className="px-3 py-2">
        <div className="flex flex-col items-start gap-1">
          <Pill tone={STATUS_TONE[c.status]} title={c.error}>
            {c.status === "pending" && p.state.running ? "running…" : STATUS_LABEL[c.status]}
          </Pill>
          {c.error && <span className="max-w-48 text-xs text-stone-500">{c.error}</span>}
          {c.status === "skipped" && (
            <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={p.state.running || !p.configured} onClick={() => p.include(c.id)} title={c.flag ?? c.error}>
              Include
            </Button>
          )}
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
  const guess = cand.basis === "guess";
  return (
    <button
      className="group flex items-center gap-1 rounded px-1 -mx-1 text-left font-mono text-xs hover:bg-stone-100"
      title={`${guess ? "backup guess — common format, no source" : cand.basis === "seen" ? "seen in your paste" : "built from a sourced format"} · ${cand.verify_status ?? "unverified"} · click to copy`}
      onClick={async () => {
        await navigator.clipboard?.writeText(cand.email).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <span className={cand.verify_status === "invalid" ? "text-red-600 line-through" : guess ? "italic text-stone-400" : ""}>{cand.email}</span>
      {guess && <span className="text-[10px] text-stone-400">backup</span>}
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
