import { useState } from "react";
import { toCsv, toTsv } from "@cf/core";
import type { Pipeline } from "../usePipeline.ts";
import { searchNames, tableRows } from "../state.ts";
import { Button } from "./ui.tsx";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function ExportBar({ p }: { p: Pipeline }) {
  const { state } = p;
  const [copied, setCopied] = useState(false);
  const { filters } = state;
  // Export exactly what the table shows: ticked searches, same filters, guesses only when switched on.
  const contacts = tableRows(state).filter((c) => c.status !== "pending");
  const opts = { includeGuesses: !!filters.includeGuesses, searchOf: (c: (typeof contacts)[number]) => searchNames(state, c) };

  const download = () => {
    const blob = new Blob([toCsv(contacts, state.companies, opts)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(toTsv(contacts, state.companies, opts));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <footer className="sticky bottom-0 z-10 border-t border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5">
        <Button onClick={copy} disabled={!contacts.length}>
          {copied ? "Copied ✓" : "Copy as table"}
        </Button>
        <Button variant="primary" onClick={download} disabled={!contacts.length}>
          Download CSV
        </Button>
        <span className="text-xs text-stone-500">{contacts.length} rows{state.searches.length > 1 ? ` from ${state.searches.filter((x) => !x.hidden).length} of ${state.searches.length} searches` : ""} · {filters.includeGuesses ? "incl. backup guesses" : "sourced emails only"}</span>
        <span title="Coming soon" className="inline-flex">
          <Button disabled aria-disabled>
            Push to CRM
          </Button>
        </span>
        <span className="ml-auto font-mono text-xs text-stone-600" title="Estimated from list prices. “This paste” resets when you paste something new; “session” resets on Clear." data-testid="cost">
          <span title={`This paste: ${state.pasteUsage?.searches ?? 0} searches, ${fmtTokens(state.pasteUsage?.tokens ?? 0)} tokens`}>
            this paste ≈ <b className="text-stone-900">${(state.pasteUsage?.cost ?? 0).toFixed(2)}</b>
          </span>
          <span className="text-stone-400"> · session ≈ ${state.usage.cost.toFixed(2)} ({state.usage.searches} searches)</span>
        </span>
      </div>
    </footer>
  );
}
