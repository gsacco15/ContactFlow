import { useEffect, useState } from "react";
import { usePipeline } from "./usePipeline.ts";
import { Input } from "./components/Input.tsx";
import { Preview } from "./components/Preview.tsx";
import { ResultsTable } from "./components/ResultsTable.tsx";
import { ExportBar } from "./components/ExportBar.tsx";
import { Banner } from "./components/ui.tsx";
import { HowItWorks } from "./components/HowItWorks.tsx";
import { Logo } from "./components/Logo.tsx";
import { Privacy, SUPPORT_EMAIL, Support, Terms } from "./components/Legal.tsx";
import { Landing } from "./components/Landing.tsx";
import { load, save } from "./lib/storage.ts";
import { getOwnKey } from "./lib/ownKey.ts";
import { NEXT, getTheme, setTheme, type Theme } from "./lib/theme.ts";
import { LimitBanner, OwnKeyDialog } from "./components/OwnKey.tsx";

type Page = "home" | "app" | "how" | "privacy" | "terms" | "support";
const PAGES: Page[] = ["home", "app", "how", "privacy", "terms", "support"];
const VISITED = "cf:visited";

/** First visit → landing page; anyone who has opened the app before goes straight to it. */
function initialPage(): Page {
  const fromHash = PAGES.find((x) => location.hash === `#${x}`);
  if (fromHash) return fromHash;
  return load<boolean>(VISITED) ? "app" : "home";
}

export default function App() {
  const p = usePipeline();
  const { state } = p;
  const [page, setPage] = useState<Page>(initialPage);
  const [keyOpen, setKeyOpen] = useState(false);
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const cycleTheme = () => {
    const t = NEXT[theme];
    setTheme(t);
    setThemeState(t);
  };
  const [ownKey, setOwnKeyState] = useState(!!getOwnKey());
  const closeKey = () => {
    setKeyOpen(false);
    setOwnKeyState(!!getOwnKey());
    if (getOwnKey() && state.limit !== "daily_budget") p.dispatch({ type: "limit", code: undefined });
  };
  const go = (to: Page) => {
    if (to === "app") save(VISITED, true);
    setPage(to);
    history.replaceState(null, "", to === "app" ? location.pathname + location.search : `${location.search}#${to}`); // keep ?verify= / ?site= test switches
    scrollTo(0, 0);
  };
  useEffect(() => {
    if (page === "app") save(VISITED, true);
  }, [page]);

  const start = (text?: string, roles?: string) => {
    if (text) {
      p.dispatch({ type: "input", input: text });
      p.dispatch({ type: "role", roleFilter: roles ?? "" });
    }
    go("app");
  };
  if (page === "home") return <Landing onStart={start} onHow={() => go("how")} onPrivacy={() => go("privacy")} onTerms={() => go("terms")} />;

  return (
    <div className="cf-app flex min-h-screen flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-2 whitespace-nowrap px-4 py-3 sm:gap-3">
          <h1 className="shrink-0 leading-none">
            <button onClick={() => go("home")} className="rounded-md" title="ContactFlow home">
              <Logo />
            </button>
          </h1>
          <p className="hidden text-sm text-stone-500 sm:block">Paste anything → emails you can trust.</p>
          <button onClick={() => go(page === "app" ? "how" : "app")} className="ml-auto text-xs text-stone-400 hover:text-stone-700">
            {page === "app" ? <><span className="min-[380px]:hidden">Help</span><span className="hidden min-[380px]:inline">How it works</span></> : "Back"}
          </button>
          <button
            onClick={cycleTheme}
            className="rounded-md px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            title={`Theme: ${theme} (click for ${NEXT[theme]})`}
            aria-label={`Theme: ${theme}. Switch to ${NEXT[theme]}`}
          >
            {theme === "dark" ? "☾" : theme === "light" ? <SunIcon /> : "◐"}
            <span className="hidden sm:inline"> {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "Auto"}</span>
          </button>
          <button
            onClick={() => setKeyOpen(true)}
            className="rounded-md px-1.5 py-0.5 text-xs text-stone-500 hover:bg-stone-100 hover:text-stone-800"
            title={ownKey ? "Searches use your own Claude key" : "Free searches each day; add your own Claude key for unlimited"}
          >
            {ownKey ? "Your key ✓" : <><span className="hidden sm:inline">Free · </span>Own key</>}
          </button>
          <span className="flex items-center gap-1.5 text-xs text-stone-500" title={p.configured ? `Connected · relevance by ${state.judge === "jev" ? "Jev" : "Claude"}` : "Not connected"}>
            <span className={`size-1.5 rounded-full ${p.configured ? "bg-emerald-500" : "bg-stone-300"}`} />
            <span className="hidden sm:inline">{p.configured ? "Connected" : "Offline"}</span>
          </span>
        </div>
      </header>
      {page !== "app" ? (
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
          {page === "how" ? <HowItWorks onBack={() => go("app")} /> : page === "privacy" ? <Privacy /> : page === "support" ? <Support /> : <Terms />}
        </main>
      ) : (
      <main className="mx-auto w-full max-w-7xl flex-1 space-y-5 px-4 py-5">
        {!p.configured && (
          <Banner tone="warn">
            Not connected: set <code>VITE_EDGE_URL</code> in <code>packages/web/.env</code> to your deployed <code>pipeline</code> function, then restart <code>pnpm dev</code>.
          </Banner>
        )}
        <RateLimited until={state.rateLimitedUntil} />
        {state.limit && <LimitBanner code={state.limit} onKey={() => setKeyOpen(true)} onClose={() => p.dispatch({ type: "limit", code: undefined })} />}
        {state.error && !(state.limit && state.error === "stopped") && (
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
      {keyOpen && <OwnKeyDialog onClose={closeKey} />}
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center gap-x-4 px-4 py-4 text-xs whitespace-nowrap text-stone-400 sm:gap-x-5">
          <button className="hover:text-stone-700" onClick={() => go("home")}>Home</button>
          <button className="hover:text-stone-700" onClick={() => go("privacy")}>Privacy</button>
          <button className="hover:text-stone-700" onClick={() => go("terms")}>Terms</button>
          <button className="hover:text-stone-700" onClick={() => go("support")}>Support</button>
          <a className="hidden hover:text-stone-700 sm:inline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <span className="ml-auto">© 2026 ContactFlow</span>
        </div>
      </footer>
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

/** Thin outline sun, drawn to match the ☾ and ◐ text glyphs (the ☀ glyph is heavy and turns into an emoji on phones). */
function SunIcon() {
  return (
    <svg viewBox="0 0 16 16" className="inline-block size-[1em] -translate-y-px align-middle" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </svg>
  );
}
