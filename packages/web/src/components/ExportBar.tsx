import { useEffect, useState } from "react";
import { toCsv, toTable, toTsv } from "@cf/core";
import type { Pipeline } from "../usePipeline.ts";
import { firmsToVerify, searchNames, tableRows } from "../state.ts";
import { PRICE_PER_VERIFY, VERIFY_LIMITS } from "@cf/core";
import { PushMenu } from "./PushMenu.tsx";
import { ACCENT } from "./Logo.tsx";
import { Button } from "./ui.tsx";

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

export function ExportBar({ p }: { p: Pipeline }) {
  const { state } = p;
  const [copied, setCopied] = useState(false);
  const [showSession, setShowSession] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [peek, setPeek] = useState(false);
  // Phones: show the session total for ~2.5 s (a colour change, no flashing) once just after a
  // search adds cost, then once a minute — until the user taps it.
  const cost = state.usage.cost;
  useEffect(() => {
    if (tapped || !cost || state.running) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const flip = () => {
      setPeek(true);
      timers.push(setTimeout(() => setPeek(false), 2500));
    };
    timers.push(setTimeout(flip, 3000));
    const every = setInterval(flip, 60_000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(every);
      setPeek(false);
    };
  }, [tapped, cost, state.running]);
  const session = showSession || peek;
  // Fade only for the automatic flip; a tap switches instantly.
  const fade = tapped ? "" : "transition-colors duration-700";
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
        {p.verifyMode !== "off" && <VerifyAll p={p} />}
        <button
          type="button"
          onClick={() => {
            setTapped(true);
            setPeek(false);
            setShowSession(!session);
          }}
          className="ml-auto rounded-md px-1.5 py-1 text-right font-mono text-xs leading-tight text-stone-600 active:bg-stone-100 sm:hidden"
          title="Tap to switch between this paste and the whole session"
          data-testid="cost-mobile"
        >
          <span className={`block text-[10px] ${fade}`} style={{ color: session ? ACCENT : "#a8a29e" }}>
            {session ? "session" : "this paste"}
          </span>
          <span className={fade} style={{ color: session ? ACCENT : undefined }}>
            ≈ ${(session ? state.usage.cost : state.pasteUsage?.cost ?? 0).toFixed(2)}
          </span>
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

/** "✓ Verify N firms · ≈ $X": one mailbox check per firm in the ticked searches (up to 3 if the first fails). */
function VerifyAll({ p }: { p: Pipeline }) {
  const firms = firmsToVerify(p.state).length;
  const low = firms * PRICE_PER_VERIFY;
  const high = firms * VERIFY_LIMITS.perCompany * PRICE_PER_VERIFY;
  const money = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;
  return (
    <Button
      onClick={() => p.verify()}
      disabled={!firms || p.state.running || !p.configured}
      className="whitespace-nowrap"
      title={firms ? `One check per firm in your ticked searches (up to ${VERIFY_LIMITS.perCompany} if the first address bounces): about ${money(low)}–${money(high)}. A valid result proves the format for everyone at that firm.` : "Nothing left to verify in your ticked searches"}
    >
      {firms ? (
        <>
          ✓<span className="hidden sm:inline"> Verify {firms} {firms === 1 ? "firm" : "firms"} · ≈ {money(low)}</span>
          <span className="sm:hidden"> {firms}</span>
        </>
      ) : (
        <>
          ✓<span className="hidden sm:inline"> All verified</span>
        </>
      )}
    </Button>
  );
}
