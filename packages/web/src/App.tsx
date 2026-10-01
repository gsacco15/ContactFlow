import { useEffect, useState } from "react";
import { usePipeline } from "./usePipeline.ts";
import { Input } from "./components/Input.tsx";
import { Preview } from "./components/Preview.tsx";
import { ResultsTable } from "./components/ResultsTable.tsx";
import { ExportBar } from "./components/ExportBar.tsx";
import { Banner } from "./components/ui.tsx";

export default function App() {
  const p = usePipeline();
  const { state } = p;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-baseline gap-3 px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Contact Finder</h1>
          <p className="text-sm text-stone-500">Paste anything → ranked email guesses with sources.</p>
        </div>
      </header>
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
      <ExportBar p={p} />
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
