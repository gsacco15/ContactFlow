import { useState } from "react";
import { toCsv, toTable, toTsv } from "@cf/core";
import type { Pipeline } from "../usePipeline.ts";
import { searchNames, tableRows } from "../state.ts";
import { PushMenu } from "./PushMenu.tsx";
import { ACCENT } from "./Logo.tsx";
import { Button } from "./ui.tsx";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function ExportBar({ p }: { p: Pipeline }) {
  const { state } = p;
  const [copied, setCopied] = useState(false);
  const [showSession, setShowSession] = useState(false);
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
      <div className="mx-auto flex max-w-7xl flex-nowrap items-center gap-2 px-4 py-2.5 sm:flex-wrap">
        <Button onClick={copy} disabled={!contacts.length} className="whitespace-nowrap">
          {copied ? "Copied ✓" : <>Copy<span className="hidden sm:inline"> as table</span></>}
        </Button>
        <Button variant="primary" onClick={download} disabled={!contacts.length} className="whitespace-nowrap">
          <span className="hidden sm:inline">Download </span>CSV
        </Button>
        <span className="hidden text-xs text-stone-500 sm:inline">{contacts.length} rows{state.searches.length > 1 ? ` from ${state.searches.filter((x) => !x.hidden).length} of ${state.searches.length} searches` : ""} · {filters.includeGuesses ? "incl. backup guesses" : "sourced emails only"}</span>
        <PushMenu table={() => toTable(contacts, state.companies, opts)} disabled={!contacts.length} />
        <button
          type="button"
          onClick={() => setShowSession(!showSession)}
          className="ml-auto rounded-md px-1.5 py-1 text-right font-mono text-xs leading-tight text-stone-600 active:bg-stone-100 sm:hidden"
          title="Tap to switch between this paste and the whole session"
          data-testid="cost-mobile"
        >
          <span className="block text-[10px]" style={showSession ? { color: ACCENT } : { color: "#a8a29e" }}>
            {showSession ? "session" : "this paste"}
          </span>
          <span style={showSession ? { color: ACCENT, fontWeight: 600 } : undefined}>≈ ${(showSession ? state.usage.cost : state.pasteUsage?.cost ?? 0).toFixed(2)}</span>
        </button>
        <span className="ml-auto hidden font-mono text-xs text-stone-600 sm:inline" title="Estimated from list prices. “This paste” resets when you paste something new; “session” resets on Clear." data-testid="cost">
          <span title={`This paste: ${state.pasteUsage?.searches ?? 0} searches, ${fmtTokens(state.pasteUsage?.tokens ?? 0)} tokens`}>
            this paste ≈ <b className="text-stone-900">${(state.pasteUsage?.cost ?? 0).toFixed(2)}</b>
          </span>
          <span className="text-stone-400"> · session ≈ ${state.usage.cost.toFixed(2)} ({state.usage.searches} searches)</span>
        </span>
      </div>
    </footer>
  );
}
