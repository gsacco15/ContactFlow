import { SAMPLES } from "../samples.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Button } from "./ui.tsx";

export function Input({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const busy = state.parsing || state.running;
  const pending = state.order.filter((id) => state.contacts[id]?.status === "pending").length;

  return (
    <section className="space-y-3">
      <textarea
        value={state.input}
        onChange={(e) => dispatch({ type: "input", input: e.target.value })}
        placeholder="Paste names, companies, team pages, LinkedIn results, URLs — anything."
        aria-label="Paste input"
        className="h-48 w-full resize-y rounded-lg border border-stone-300 bg-white p-3 font-mono text-sm shadow-sm outline-none focus:border-stone-500 focus:ring-2 focus:ring-stone-200"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex min-w-72 flex-1 items-center gap-2 text-sm">
          <span className="whitespace-nowrap text-stone-600">Who do you want?</span>
          <input
            value={state.roleFilter}
            onChange={(e) => dispatch({ type: "role", roleFilter: e.target.value })}
            placeholder="Plain words, e.g. “decision makers who’d buy legal software — partners, firm administrators; not marketing or paralegals”"
            className="w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm outline-none focus:border-stone-500"
          />
        </label>
        <label
          className={`flex items-center gap-1.5 text-sm ${state.roleFilter.trim() ? "text-stone-600" : "text-stone-400"}`}
          title="When “Who do you want?” is filled in: people judged not relevant are not looked up, so nothing is spent on them. They stay in the table and can be included later. With the box empty, nobody is judged or skipped."
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
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={p.parse} disabled={!p.configured || busy || !state.input.trim()} title="Stage 1 only — fast, no web searches">
          {state.parsing ? "Parsing…" : "Parse"}
        </Button>
        {state.running ? (
          <Button variant="primary" onClick={p.stop}>
            Stop
          </Button>
        ) : (
          <Button variant="primary" onClick={() => p.run()} disabled={!p.configured || busy || (!state.input.trim() && !state.extracted)}>
            Run pipeline
          </Button>
        )}
        {pending > 0 && !state.running && (
          <Button onClick={p.resume} disabled={!p.configured}>
            Resume ({pending} pending)
          </Button>
        )}
        <select
          className="ml-auto rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-600"
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
        <Button variant="ghost" onClick={p.clear} disabled={busy && !state.running}>
          Clear
        </Button>
      </div>
    </section>
  );
}
