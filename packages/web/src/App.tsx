import { useEffect, useState } from "react";
import { usePipeline } from "./usePipeline.ts";
import { Input } from "./components/Input.tsx";
import { Preview } from "./components/Preview.tsx";
import { ResultsTable } from "./components/ResultsTable.tsx";
import { ExportBar } from "./components/ExportBar.tsx";
import { Banner } from "./components/ui.tsx";
import { HowItWorks } from "./components/HowItWorks.tsx";
import { Logo } from "./components/Logo.tsx";

export default function App() {
  const p = usePipeline();
  const { state } = p;
  const [page, setPage] = useState<"app" | "how">(() => (location.hash === "#how" ? "how" : "app"));
  const go = (to: "app" | "how") => {
    setPage(to);
    history.replaceState(null, "", to === "how" ? "#how" : location.pathname);
    scrollTo(0, 0);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
          <h1 className="leading-none">
            <button onClick={() => go("app")} className="rounded-md" title="ContactFlow">
              <Logo />
            </button>
          </h1>
          <p className="hidden text-sm text-stone-500 sm:block">Paste anything → ranked email guesses with sources.</p>
          <button onClick={() => go(page === "how" ? "app" : "how")} className="ml-auto text-xs text-stone-400 hover:text-stone-700">
            {page === "how" ? "Back to app" : "How it works"}
          </button>
          <span className="flex items-center gap-1.5 text-xs text-stone-500" title={p.configured ? `Connected · relevance by ${state.judge === "jev" ? "Jev" : "Claude"}` : "Not connected"}>
            <span className={`size-1.5 rounded-full ${p.configured ? "bg-emerald-500" : "bg-stone-300"}`} />
            {p.configured ? "Connected" : "Offline"}
          </span>
        </div>
      </header>
      {page === "how" ? (
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
          <HowItWorks onBack={() => go("app")} />
        </main>
      ) : (
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-5">
        {!p.configured && (
          <Banner tone="warn">
            Not connected: set <code>VITE_EDGE_URL</code> in <code>packages/web/.env</code> to your deployed <code>pipeline</code> function, then restart <code>pnpm dev</code>.
          </Banner>
        )}
        <RateLimited until={state.rateLimitedUntil} />
        {state.error && (
          <Banner tone="error" onClose={() => p.dispatch({ type: "error", error: undefined })}>
            {state.error}
          </Banner>
        )}
        <Input p={p} />
        <Preview p={p} />
        <ResultsTable p={p} />
      </main>
      )}
      {page === "app" && <ExportBar p={p} />}
    </div>
  );
}

function RateLimited({ until }: { until?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [until]);
  if (!until || until < now) return null;
  return <Banner tone="info">Rate limited, resuming in {Math.ceil((until - now) / 1000)} s…</Banner>;
}
