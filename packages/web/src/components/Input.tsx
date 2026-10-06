import { PRICE_PER_VERIFY, VERIFY_LIMITS } from "@cf/core";
import { SAMPLES } from "../samples.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Button } from "./ui.tsx";

export function Input({ p }: { p: Pipeline }) {
  const { state, dispatch } = p;
  const busy = state.parsing || state.running;
  const pending = state.order.filter((id) => state.contacts[id]?.status === "pending").length;

  return (
    <section className="space-y-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm" aria-label="Input">
      <div className="relative">
      <textarea
        value={state.input}
        onChange={(e) => dispatch({ type: "input", input: e.target.value })}
        placeholder="Paste names, companies, team pages, LinkedIn results, URLs — anything."
        aria-label="Paste input"
        className="h-44 w-full resize-y rounded-lg border border-stone-200 bg-stone-50/60 p-3 pr-16 font-mono text-[13px] leading-relaxed placeholder:font-sans placeholder:text-stone-400 outline-none transition focus:border-stone-400 focus:bg-white focus:ring-4 focus:ring-stone-100"
      />
      {state.input && !busy && (
        <button
          type="button"
          onClick={() => dispatch({ type: "input", input: "" })}
          title="Empties the paste box. Your list below stays."
          className="absolute top-2 right-2 rounded-md bg-white/80 px-2 py-0.5 text-xs text-stone-500 shadow-sm ring-1 ring-stone-200 hover:text-stone-900"
        >
          Clear
        </button>
      )}
      </div>
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
        {p.verifyMode !== "off" && (
          <div className="w-full">
            <label className="flex items-center gap-1.5 text-sm text-stone-600" title="Checks one address per firm with a mailbox test. A valid result proves the format for everyone at that firm; firms proven before cost nothing.">
              <input type="checkbox" checked={!!state.verify} onChange={(e) => dispatch({ type: "verify", on: e.target.checked })} />
              Verify emails
              <span className="rounded-full bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-700 ring-1 ring-amber-200">extra cost</span>
            </label>
            {state.verify ? (
              <p className="mt-1 ml-5 text-xs leading-relaxed text-amber-700">
                Adds about ${(PRICE_PER_VERIFY).toFixed(4)} per new firm (up to ${(PRICE_PER_VERIFY * (VERIFY_LIMITS.perCompany + VERIFY_LIMITS.secondPerson)).toFixed(4)} if addresses bounce). One check per firm proves its format for everyone there; firms already proven are free. Emails from your paste or a profile page are checked once each (same price), and one that bounces is replaced by a normal lookup.
              </p>
            ) : (
              <p className="mt-1 ml-5 text-xs text-stone-400">Checks each firm's mailbox format · about ${(PRICE_PER_VERIFY).toFixed(4)} per new firm</p>
            )}
          </div>
        )}
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
          className="ml-auto min-w-0 rounded-lg border border-stone-200 bg-white px-2 py-1.5 text-sm text-stone-600 hover:border-stone-300"
          value=""
          aria-label="Load an example"
          onChange={(e) => {
            const s = SAMPLES[Number(e.target.value)];
            if (!s) return;
            dispatch({ type: "input", input: s.text });
            dispatch({ type: "role", roleFilter: s.roles ?? "" });
          }}
        >
          <option value="">Examples…</option>
          {SAMPLES.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
