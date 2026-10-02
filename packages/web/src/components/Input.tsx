import { SAMPLES } from "../samples.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Button } from "./ui.tsx";

export function Input({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const busy = state.parsing || state.running;
  const pending = state.order.filter((id) => state.contacts[id]?.status === "pending").length;

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Input">
      <textarea
        value={state.input}
        onChange={(e) => dispatch({ type: "input", input: e.target.value })}
        placeholder="Paste names, companies, team pages, LinkedIn results, URLs — anything."
        aria-label="Paste input"
        className="h-44 w-full resize-y rounded-lg border border-stone-200 bg-stone-50/60 p-3 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-stone-400 outline-none transition focus:border-stone-400 focus:bg-white focus:ring-4 focus:ring-stone-100"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-72 flex-1 items-center gap-2 text-sm">
          <span className="whitespace-nowrap font-medium text-stone-700">Looking for</span>
          <input
            value={state.roleFilter}
            onChange={(e) => dispatch({ type: "role", roleFilter: e.target.value })}
            placeholder="e.g. partners, not clerks"
            className="w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm outline-none transition placeholder:text-stone-400 focus:border-stone-400 focus:ring-4 focus:ring-stone-100"
          />
        </label>
        <label
          className={`flex items-center gap-1.5 text-sm ${state.roleFilter.trim() ? "text-stone-600" : "text-stone-400"}`}
          title="When “Looking for” is filled in: people judged not relevant are not looked up, so nothing is spent on them. They stay in the table and can be included later. With the box empty, nobody is judged or skipped."
        >
          <input type="checkbox" checked={state.skipIrrelevant !== false} onChange={(e) => dispatch({ type: "skip_irrelevant", on: e.target.checked })} />
          Skip not-relevant before searching
        </label>
        <label className="flex items-center gap-1.5 text-sm text-stone-600" title="Adds Bob↔Robert style variants when a candidate slot is free">
          <input type="checkbox" checked={state.nicknames} onChange={(e) => dispatch({ type: "nicknames", on: e.target.checked })} />
          Nickname variants
        </label>
        <label className="flex items-center gap-1.5 text-sm text-stone-600" title="Emails next to a person and stated formats (e.g. “the firm uses jdoe@…”) become the pattern, skipping web search. Only work addresses that fit the person’s name count.">
          <input type="checkbox" checked={state.usePasteEvidence !== false} onChange={(e) => dispatch({ type: "paste_evidence", on: e.target.checked })} />
          Use emails &amp; formats found in my paste
        </label>
      </div>
      <div className="flex items-center gap-2 border-t border-stone-100 pt-3">
        {state.running ? (
          <Button variant="primary" onClick={p.stop} className="whitespace-nowrap">
            Stop
          </Button>
        ) : (
          <Button
            variant="primary"
            onClick={() => p.run()}
            disabled={!p.configured || busy || (!state.input.trim() && !state.extracted)}
            className="whitespace-nowrap"
            title="Finds the people, their domains and email formats, and adds the results to your list"
          >
            Find emails
          </Button>
        )}
        <Button onClick={p.parse} disabled={!p.configured || busy || !state.input.trim()} className="whitespace-nowrap" title="Optional: see who was found and fix or drop people before anything is searched">
          {state.parsing ? "Reading…" : "Preview"}
        </Button>
        {pending > 0 && !state.running && (
          <Button onClick={p.resume} disabled={!p.configured}>
            Resume ({pending} pending)
          </Button>
        )}
        <select
          className="ml-auto hidden rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-600 hover:border-stone-300 sm:block"
          value=""
          aria-label="Load a sample"
          onChange={(e) => {
            const s = SAMPLES[Number(e.target.value)];
            if (!s) return;
            dispatch({ type: "input", input: s.text });
            dispatch({ type: "role", roleFilter: s.roles ?? "" });
          }}
        >
          <option value="">Try a sample…</option>
          {SAMPLES.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
        <Button variant="ghost" className="ml-auto sm:ml-0" onClick={() => dispatch({ type: "input", input: "" })} disabled={busy || !state.input} title="Empties the paste box. Your list below stays.">
          Clear
        </Button>
      </div>
    </section>
  );
}
