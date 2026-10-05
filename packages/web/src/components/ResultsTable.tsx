import { useState } from "react";
import { patternLabel, sourceName, visibleCandidates, type Candidate, type Company, type Contact, type Pattern } from "@cf/core";
import { FitBadge } from "./FitBadge.tsx";
import { LOW_DOMAIN_CONFIDENCE } from "../config.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Button, LinkIcon, Pill, useConfirm } from "./ui.tsx";
import { colorOf, groupBy, groupOf, listedRows, searchTime, tableRows, visibleSearches, wantFor, type GroupBy, type State } from "../state.ts";

/** One colour per search, so its card, section and rows match. */
const PALETTE = ["#2563eb", "#059669", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#65a30d", "#dc2626"];
const colorFor = (s: State, id?: string) => PALETTE[colorOf(s, id)] ?? "#a8a29e";

function searchStats(s: State, id: string) {
  const people = Object.entries(s.rowSearches).filter(([k, v]) => v.includes(id) && s.contacts[k]).map(([k]) => s.contacts[k]);
  return { people: people.length, ok: people.filter((c) => c.status === "ok").length };
}

/** One chip per search: tick to show/hide its rows (and leave them out of the export), × to remove it. */
function Searches({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const [ask, confirmDialog] = useConfirm();
  const hidden = state.searches.some((x) => x.hidden);
  return (
    <div className="space-y-2">
      {confirmDialog}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {[...state.searches].reverse().map((x) => {
        const { people, ok } = searchStats(state, x.id);
        const running = state.activeSearch === x.id;
        const color = colorFor(state, x.id);
        return (
          <div
            key={x.id}
            className={`flex min-w-0 items-center gap-2 rounded-lg border border-l-4 px-2.5 py-1.5 text-sm shadow-sm transition hover:shadow ${x.hidden ? "border-stone-200 bg-stone-50 text-stone-400" : "border-stone-300 bg-white"}`}
            style={{ borderLeftColor: x.hidden ? undefined : color }}
          >
            <input type="checkbox" aria-label={`Show ${x.label}`} checked={!x.hidden} onChange={(e) => dispatch({ type: "search_toggle", id: x.id, hidden: !e.target.checked || undefined })} />
            <button type="button" aria-pressed={!x.hidden} className="min-w-0 flex-1 text-left" title={`${x.label}${x.want ? ` · ${x.want}` : ""} — tap to ${x.hidden ? "show" : "hide"}`} onClick={() => dispatch({ type: "search_toggle", id: x.id, hidden: !x.hidden || undefined })}>
              <span className="block truncate">
                <span className="font-medium">{x.label}</span>
                {x.want && <span className="text-stone-500"> · {x.want}</span>}
              </span>
              <span className="block truncate text-xs text-stone-400">
                {running ? "running…" : `${people} ${people === 1 ? "person" : "people"} · ${ok} with email`} · ${x.cost.toFixed(2)} · <span title={searchTime(x.at)}>{shortTime(x.at)}</span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Rename ${x.label}`}
              title="Rename this search"
              className="text-stone-300 hover:text-stone-700"
              onClick={() => {
                const label = prompt("Name this search", x.label);
                if (label) dispatch({ type: "search_rename", id: x.id, label });
              }}
            >
              ✎
            </button>
            <button
              type="button"
              aria-label={`Remove ${x.label}`}
              title="Remove this search (people another search also found stay)"
              disabled={running}
              className="text-stone-400 hover:text-red-600 disabled:opacity-30"
              onClick={() => ask({ title: `Remove “${x.label}”?`, body: "Its people leave your list, unless another search also found them.", confirm: "Remove", danger: true, onYes: () => dispatch({ type: "search_remove", id: x.id }) })}
            >
              ×
            </button>
          </div>
        );
      })}
      </div>
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
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [ask, confirmDialog] = useConfirm();
  if (!state.searches.length && !state.running) return null;

  const rows = tableRows(state);
  const total = listed.length;
  const done = listed.filter((r) => r.status !== "pending").length;
  const ok = listed.filter((r) => r.status === "ok").length;
  const anyWant = state.searches.some((x) => x.want);

  const toggle = (k: "hidePatternless" | "includeGuesses" | "hideIrrelevant") => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={filters[k]} onChange={(e) => dispatch({ type: "filters", filters: { [k]: e.target.checked } })} />
      {{ hidePatternless: "Only rows with an email", includeGuesses: "Include backup guesses", hideIrrelevant: "Hide not relevant" }[k]}
    </label>
  );

  let lastGroup: string | undefined;
  const search = (id?: string) => state.searches.find((x) => x.id === id);
  return (
    <section className="space-y-3" aria-label="Results">
      {confirmDialog}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-stone-200 pt-4">
        <h2 className="text-lg font-semibold tracking-tight">Your list</h2>
        <span className="tabular text-sm text-stone-500">
          {total} {total === 1 ? "person" : "people"} · {ok} with email{state.searches.length > 1 ? ` · ${shown.size} of ${state.searches.length} searches shown` : ""}
        </span>
        <Button
          variant="ghost"
          className="ml-auto !px-1.5 !py-0.5 text-xs"
          disabled={state.running}
          onClick={() => ask({ title: "Clear your whole list?", body: "Every search and person goes. Export first if you need them.", confirm: "Clear list", danger: true, onYes: () => p.clear() })}
        >
          Clear list
        </Button>
      </div>
      <Searches p={p} />
      <div className="-mx-4 flex items-center gap-x-5 gap-y-2 overflow-x-auto px-4 pb-1 text-sm whitespace-nowrap text-stone-600 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
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
        <label className="flex items-center gap-1.5">
          Group by
          <select
            className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-sm"
            value={groupBy(state)}
            onChange={(e) => dispatch({ type: "filters", filters: { groupBy: e.target.value as GroupBy, groupByCompany: false } })}
          >
            <option value="search">Search</option>
            <option value="company">Company</option>
            <option value="none">Nothing</option>
          </select>
        </label>
        {anyWant && toggle("hideIrrelevant")}
        <span className="sm:border-l sm:border-stone-300 sm:pl-4" title="Common formats with no source behind them. Off = they are hidden here and left out of Copy/CSV.">
          {toggle("includeGuesses")}
        </span>
        {Object.values(state.companies).some((c) => isDemo(c)) && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200" title="No verification provider is set up yet, so checks return made-up answers. They are never saved.">
            Demo checks — fake results
          </span>
        )}
      </div>
      <div className="relative overflow-x-auto rounded-xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            <tr>
              <th className="px-3 py-2"><span className="sm:hidden">Contact</span><span className="hidden sm:inline">Name / Title</span></th>
              <th className="hidden px-3 py-2 sm:table-cell">Company → domain</th>
              <th className="hidden px-3 py-2 sm:table-cell">Pattern</th>
              <th className="hidden px-3 py-2 sm:table-cell">Email 1</th>
              <th className="hidden px-3 py-2 sm:table-cell">Email 2</th>
              <th className="hidden px-3 py-2 sm:table-cell">Email 3</th>
              <th className="hidden px-3 py-2 sm:table-cell">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const co = state.companies[c.company_id];
              const g = groupOf(state, c.id);
              const by = groupBy(state);
              const key = by === "search" ? g : by === "company" ? co?.name : undefined;
              const header = by !== "none" && key !== lastGroup;
              lastGroup = key;
              const color = colorFor(state, g);
              const folded = !!key && collapsed.has(key);
              return [
                header && (
                  <GroupHeader
                    key={`h-${key}`}
                    folded={folded}
                    onToggle={() => setCollapsed((x) => (x.has(key!) ? new Set([...x].filter((y) => y !== key)) : new Set([...x, key!])))}
                    color={by === "search" ? color : undefined}
                    title={by === "search" ? search(g)?.label ?? "Search" : co?.name ?? "No company"}
                    sub={by === "search" ? [search(g)?.want, `${rows.filter((r) => groupOf(state, r.id) === g).length} shown`].filter(Boolean).join(" · ") : `${rows.filter((r) => state.companies[r.company_id]?.name === co?.name).length} shown`}
                  />
                ),
                !folded && <Row key={c.id} c={c} co={co} p={p} color={color} />,
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
        Unless marked verified (or format proven) by a mailbox check, emails follow the company’s sourced format and aren’t guaranteed. You are responsible for CAN-SPAM (US) and GDPR/PECR (EU, UK) compliance:
        include an unsubscribe link, use an honest sender, and keep a suppression list.
      </p>
    </section>
  );
}

/** Section row: colour dot, name, details; click to fold (folding only affects this view, not the export). */
function GroupHeader({ title, sub, color, folded, onToggle }: { title: string; sub: string; color?: string; folded: boolean; onToggle: () => void }) {
  return (
    <tr className="cursor-pointer border-t border-stone-200 bg-stone-50 hover:bg-stone-100" onClick={onToggle} title={folded ? "Show these rows" : "Fold these rows (they still export)"}>
      <td colSpan={7} className="px-3 py-1.5 text-xs" style={color ? { boxShadow: `inset 4px 0 0 ${color}` } : undefined}>
        <span className="mr-1.5 inline-block w-3 text-stone-400">{folded ? "▸" : "▾"}</span>
        {color && <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: color }} />}
        <span className="font-semibold text-stone-800">{title}</span>
        <span className="ml-2 text-stone-500">{sub}</span>
      </td>
    </tr>
  );
}

function Row({ c, co, p, color }: { c: Contact; co?: Company; p: Pipeline; color?: string }) {
  const top = c.candidates.find((x) => x.pattern !== "pasted");
  const pattern = top ? co?.patterns.find((x) => x.template === top.pattern) : undefined;
  const failed = c.status !== "ok" && c.status !== "pending" && c.status !== "skipped";
  const shown = visibleCandidates(c, { includeGuesses: !!p.state.filters.includeGuesses });
  return (
    <tr className="border-t border-stone-100 align-top transition-colors hover:bg-stone-50/70">
      <td className="px-3 py-2" style={color ? { boxShadow: `inset 3px 0 0 ${color}` } : undefined}>
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
        {/* Phone: everything else stacked under the name. */}
        <div className="mt-1.5 space-y-1.5 sm:hidden">
          <div className="text-xs text-stone-500">
            {co?.name ?? "—"}
            {co?.domain && <span className="text-stone-400"> · {co.domain}</span>}
          </div>
          {shown.length > 0 ? (
            <div className="space-y-0.5">
              {shown.map((cand) => (
                <Email key={cand.email} cand={cand} demo={isDemo(co)} />
              ))}
            </div>
          ) : (
            <Pill tone={STATUS_TONE[c.status]} title={c.error}>
              {c.status === "pending" && p.state.running ? "running…" : STATUS_LABEL[c.status]}
            </Pill>
          )}
          <PatternInfo top={top} pattern={pattern} co={co} />
          {co?.verify_unclear && <Unclear />}
          {co?.verify_failed && <VerifierDown />}
          <Why text={[co?.verify_note, co?.pattern_conflict && `sources disagree: ${co.pattern_conflict}`, c.note, co?.rescue_note, c.error].filter(Boolean).join(" · ")} />
          {(c.status === "skipped" || (failed && co)) && (
            <div className="flex gap-1">
              {c.status === "skipped" && (
                <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={p.state.running || !p.configured} onClick={() => p.include(c.id)}>
                  Include
                </Button>
              )}
              {failed && co && (
                <Button variant="ghost" className="!px-1.5 !py-0.5 text-xs" disabled={p.state.running || !p.configured} onClick={() => p.retry(co.id)}>
                  Retry
                </Button>
              )}
            </div>
          )}
        </div>
      </td>
      <td className="hidden px-3 py-2 sm:table-cell">
        <div>{co?.name ?? <span className="text-stone-400">—</span>}</div>
        {co?.domain && (
          <div className={`flex items-center gap-1 ${co.domain_confidence !== undefined && co.domain_confidence < LOW_DOMAIN_CONFIDENCE ? "text-red-600" : "text-stone-500"}`} title={co.domain_confidence !== undefined ? `domain confidence ${co.domain_confidence.toFixed(2)}` : undefined}>
            {co.domain} {co.domain_from_paste ? <Pill tone="blue" title="Taken from a work email in your paste">from paste</Pill> : <LinkIcon href={co.domain_source_url} title="Where the domain came from" />}
          </div>
        )}
        {co?.mx_ok === false && <div className="text-xs text-red-600">no MX records</div>}
      </td>
      <td className="hidden px-3 py-2 sm:table-cell">
        {c.candidates[0]?.pattern === "pasted" && (
          <div className="mb-1">
            <Pill tone="blue" title="This person’s own address, as it appeared in your paste">their address from paste</Pill>
          </div>
        )}
        <PatternInfo top={top} pattern={pattern} co={co} />
        {co?.pattern_conflict && <div className="mt-1 text-xs text-amber-700">⚠ sources disagree: {co.pattern_conflict}</div>}
        {co?.verify_unclear && <div className="mt-1"><Unclear /></div>}
        {co?.verify_failed && <div className="mt-1"><VerifierDown /></div>}
        {co?.verify_note && <div className="mt-1 max-w-56 text-xs text-red-700">✗ {co.verify_note}</div>}
        {c.note && <div className="mt-1 max-w-56 text-xs text-stone-500">{c.note}</div>}
        {co?.rescue_note && <div className="mt-1 max-w-56 text-xs text-stone-500" title={co.rescue_note}>{c.rescued ? "rescued: " : ""}{co.rescue_note}</div>}
      </td>
      {[0, 1, 2].map((i) => (
        <td key={i} className="hidden px-3 py-2 sm:table-cell">
          <Email cand={shown[i]} demo={isDemo(co)} />
        </td>
      ))}
      <td className="hidden px-3 py-2 sm:table-cell">
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
          {co?.catch_all && <Pill tone="amber" title="This company's mail server accepts any address, so a mailbox check can't prove which one is right.">accept-all server</Pill>}
        </div>
      </td>
    </tr>
  );
}

function PatternInfo({ top, pattern, co }: { top?: Candidate; pattern?: Pattern; co?: Company }) {
  return (
    <>
        {top && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs">{patternLabel(top.pattern)}</span>
          {pattern ? (
            <>
              <Pill
                tone={pattern.verified && isDemo(co) ? "stone" : pattern.confidence >= 0.6 ? "green" : pattern.confidence >= 0.3 ? "amber" : "red"}
                title={pattern.verified ? "Proven by a mailbox check at this company" : pattern.from_evidence ? "Proven by earlier lookups" : pattern.from_paste ? "Confidence from your paste" : pattern.from_site ? "Proven by real addresses on the company's website" : pattern.stated ? "Percentage stated by the source" : "Estimated from search snippets — no percentage was stated"}
              >
                {pattern.verified || pattern.from_evidence || pattern.from_site || pattern.from_paste ? "" : pattern.stated ? "" : "≈"}
                {Math.round(pattern.confidence * 100)}%
              </Pill>
              {pattern.verified && isDemo(co) ? (
                <Pill tone="stone" title="Demo answer — no verification provider is set up yet. Not a real check.">demo ✓</Pill>
              ) : pattern.verified ? (
                <Pill tone="green" title="A mailbox check at this company confirmed an address in this format">✓ verified here</Pill>
              ) : pattern.from_evidence ? (
                <Pill tone="green" title="Proven by earlier lookups (website addresses, checks) — no search needed this time">proven before</Pill>
              ) : pattern.from_paste ? (
                <Pill tone="blue" title={pattern.quote ? `From your paste: “${pattern.quote}”` : "From your paste"}>from paste</Pill>
              ) : pattern.from_site ? (
                <a href={pattern.source_url} target="_blank" rel="noreferrer noopener" title={`Real addresses on the company's own website: ${(pattern.evidence ?? []).join(", ")}`}>
                  <Pill tone="green">from their site</Pill>
                </a>
              ) : sourceName(pattern.source_url, co?.domain) ? (
                <a href={pattern.source_url} target="_blank" rel="noreferrer noopener" title="Where the format was read from" className="text-xs text-stone-500 underline decoration-stone-300 underline-offset-2 hover:text-stone-900">
                  {sourceName(pattern.source_url, co?.domain)} ↗
                </a>
              ) : (
                <LinkIcon href={pattern.source_url} title="Where the format was read from" />
              )}
            </>
          ) : (
            <Pill tone="amber" title="No source states this company’s format. These are the most common formats overall — treat them as low-confidence guesses.">no source · guess</Pill>
          )}
        </div>
      )}
    </>
  );
}

/** One line of explanation on phones; tap to read the rest. */
function Why({ text }: { text: string }) {
  if (!text) return null;
  return (
    <details className="group text-xs text-stone-500">
      <summary className="cursor-pointer list-none truncate group-open:whitespace-normal [&::-webkit-details-marker]:hidden">
        <span className="text-stone-400 group-open:hidden">why: </span>
        {text}
      </summary>
    </details>
  );
}

/** Card time: just the time for today's searches, just the date for older ones. */
function shortTime(iso: string) {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Verification ran but the firm's mail server wouldn't say which addresses exist. */
function Unclear() {
  return (
    <Pill tone="stone" title="A mailbox check ran, but this company's mail server doesn't reveal which addresses exist (common at large companies). The email is still built from the sourced format.">
      ? check unclear
    </Pill>
  );
}

/** The verification service itself failed: nothing was checked or charged. */
function VerifierDown() {
  return (
    <Pill tone="stone" title="The email-checking service didn't respond properly, so this firm wasn't checked (and you weren't charged). The email is still built from the sourced format. Try again later.">
      verifier unavailable
    </Pill>
  );
}

/** Checks made by the stand-in (no provider key yet): fake answers, shown greyed out. */
const isDemo = (co?: Company) => co?.verified_by === "demo" || co?.verified_by === "mock";

function Email({ cand, demo }: { cand?: Candidate; demo?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!cand) return <span className="text-stone-300">—</span>;
  const valid = cand.verify_status === "valid" && !demo;
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
      <span className={cand.verify_status === "invalid" && !demo ? "text-red-600 line-through" : guess ? "italic text-stone-400" : ""}>{cand.email}</span>
      {demo && cand.verify_status && cand.verify_status !== "unverified" && (
        <span className="text-[10px] text-stone-400" title="Demo answer — not a real check">demo {cand.verify_status === "valid" ? "✓" : cand.verify_status === "invalid" ? "✗" : "◎"}</span>
      )}
      {guess && <span className="text-[10px] text-stone-400">backup</span>}
      {valid && <span className="text-emerald-600" aria-label="verified" title="Mailbox exists">✓</span>}
      {!demo && cand.verify_status === "risky" && <span className="text-[10px] text-amber-600" title="The provider flagged this address as risky">~ risky</span>}
      {!demo && cand.verify_status === "catch_all" && <span className="text-[10px] text-stone-400" title="The server accepts any address — can't be proven">◎</span>}
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
