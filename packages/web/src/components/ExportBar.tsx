import { useState } from "react";
import { toCsv, toTsv } from "@cf/core";
import type { Pipeline } from "../usePipeline.ts";
import { Button } from "./ui.tsx";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function ExportBar({ p }: { p: Pipeline }) {
  const { state } = p;
  const [copied, setCopied] = useState(false);
  const contacts = state.order.map((id) => state.contacts[id]).filter((c) => c && c.status !== "pending");

  const download = () => {
    const blob = new Blob([toCsv(contacts, state.companies)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copy = async () => {
    await navigator.clipboard.writeText(toTsv(contacts, state.companies));
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
        <span title="Coming soon" className="inline-flex">
          <Button disabled aria-disabled>
            Push to CRM
          </Button>
        </span>
        <span className="ml-auto font-mono text-xs text-stone-600" title="Estimate from list prices; see cf_usage for actuals" data-testid="cost">
          searches: {state.usage.searches} · tokens: {fmtTokens(state.usage.tokens)} · ≈ ${state.usage.cost.toFixed(2)}
        </span>
      </div>
    </footer>
  );
}
