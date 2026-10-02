import { useEffect, useState, type ReactNode } from "react";
import { ACCENT, AppIcon, Logo, Mark } from "./Logo.tsx";
import { SUPPORT_EMAIL } from "./Legal.tsx";
import { SAMPLES } from "../samples.ts";

/* Brand card colours. */
const INK = "#15171A";
const PAPER = "#F6F5F2";
const STONE = "#5E5E59";
const MINT = "#E3F4EE";
const DEEP = "#0B5F47";
const SAND = "#ECE6DA";

type Start = (text?: string, roles?: string) => void;

/** Public landing page. Every name on it is made up. */
export function Landing({ onStart, onHow, onPrivacy, onTerms }: { onStart: Start; onHow: () => void; onPrivacy: () => void; onTerms: () => void }) {
  return (
    <div className="min-h-screen overflow-x-hidden" style={{ background: PAPER, color: INK }}>
      <Nav onStart={() => onStart()} onHow={onHow} />
      <main className="mx-auto max-w-6xl space-y-5 px-3 pb-6 sm:space-y-6 sm:px-5">
        <Hero onStart={() => onStart()} onHow={onHow} />
        <TryIt onStart={onStart} />
        <PastePanel />
        <ResearchPanel />
        <ProofPanel />
        <Closing onStart={() => onStart()} />
      </main>
      <Footer onPrivacy={onPrivacy} onTerms={onTerms} />
    </div>
  );
}

/* ——— Floating nav card ——— */

function Nav({ onStart, onHow }: { onStart: () => void; onHow: () => void }) {
  return (
    <div className="sticky top-0 z-30 px-3 pt-3 sm:px-5">
      <header className="mx-auto flex max-w-6xl items-center gap-4 rounded-[22px] border border-black/5 bg-white/90 py-2.5 pr-2.5 pl-5 shadow-[0_8px_30px_-12px_rgba(21,23,26,.18)] backdrop-blur">
        <Logo size={28} />
        <nav className="ml-auto flex items-center gap-1.5 text-sm">
          <button onClick={onHow} className="hidden rounded-xl px-3 py-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900 sm:inline">How it works</button>
          <a href="#proof" className="hidden rounded-xl px-3 py-2 text-stone-600 hover:bg-stone-100 hover:text-stone-900 sm:inline">Why trust it</a>
          <button onClick={onStart} className="rounded-xl px-4 py-2.5 font-medium text-white transition hover:opacity-90" style={{ background: INK }}>
            Open app
          </button>
        </nav>
      </header>
    </div>
  );
}

/* ——— Hero: ink panel with the logo mark as a clay sculpture ——— */

function Hero({ onStart, onHow }: { onStart: () => void; onHow: () => void }) {
  return (
    <section className="relative mt-4 overflow-hidden rounded-[32px] text-white sm:mt-5 sm:rounded-[40px]" style={{ background: `radial-gradient(120% 80% at 70% 0%, #23302B 0%, ${INK} 60%)` }}>
      <div className="relative grid items-center gap-2 px-6 pt-8 pb-10 sm:px-12 sm:pt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:py-16">
        <div className="order-2 lg:order-1">
          <Eyebrow label="Contact research" tone="dark" />
          <h1 className="mt-5 font-logo text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[72px]">
            Paste anything.
            <br />
            <span style={{ color: ACCENT }}>Emails you can trust.</span>
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-pretty text-white/70">
            A LinkedIn search, a team page, a list of firms. ContactFlow finds the people, the real domain and a sourced email format — and
            shows where every answer came from.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <button onClick={onStart} className="group inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-[15px] font-semibold transition hover:-translate-y-0.5" style={{ color: INK }}>
              Try it free <span className="transition group-hover:translate-x-0.5">→</span>
            </button>
            <button onClick={onHow} className="inline-flex items-center gap-2 rounded-2xl px-6 py-3.5 text-[15px] font-semibold text-white transition hover:-translate-y-0.5" style={{ background: ACCENT }}>
              How it works
            </button>
          </div>
          <p className="mt-6 text-sm text-white/45">No sign-up · results in about a minute</p>
        </div>
        <div className="order-1 lg:order-2">
          <Sculpture />
        </div>
      </div>
    </section>
  );
}

/** Our pipeline mark, drawn flat and large: a signal dot travels the path from paste to email. */
function Sculpture() {
  const path = "M330 84 Q110 84 110 200 Q110 316 330 316";
  return (
    <div className="relative mx-auto mb-4 aspect-[1.1] w-full max-w-[290px] sm:max-w-[420px] lg:mb-0 lg:max-w-[460px]">
      <svg viewBox="0 0 440 400" className="absolute inset-0 size-full" aria-hidden>
        <path d={path} fill="none" stroke="rgba(246,245,242,.12)" strokeWidth="34" strokeLinecap="round" />
        <path d={path} fill="none" stroke={PAPER} strokeWidth="14" strokeLinecap="round" />
        <path d={path} fill="none" stroke={ACCENT} strokeWidth="14" strokeLinecap="round" strokeDasharray="60 560" className="lp-dash" />
        <circle cx="330" cy="84" r="26" fill={INK} stroke={PAPER} strokeWidth="12" />
        <circle cx="110" cy="200" r="30" fill={PAPER} />
        <circle cx="330" cy="316" r="38" fill={ACCENT} />
        <circle cx="330" cy="316" r="38" fill="none" stroke={ACCENT} strokeWidth="3" className="lp-ping" />
      </svg>
      <Chip className="lp-float top-[6%] -left-[6%] -rotate-3 sm:left-0">
        <span className="text-stone-400">paste</span>
        <span className="font-data">Priya Natarajan, Partner</span>
      </Chip>
      <Chip className="lp-float-slow top-[44%] right-[2%] rotate-2">
        <span className="font-data">flast@</span>
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: MINT, color: DEEP }}>sourced</span>
      </Chip>
      <Chip className="lp-float bottom-[0%] left-[2%] hidden -rotate-2 sm:flex">
        <span className="size-2 rounded-full" style={{ background: ACCENT }} />
        <span className="font-data">pnatarajan@harborpine.com</span>
      </Chip>
    </div>
  );
}

function Chip({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`absolute flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[12px] font-medium shadow-[0_12px_30px_-10px_rgba(0,0,0,.5)] sm:text-[13px] ${className}`} style={{ color: INK }}>
      {children}
    </div>
  );
}

/* ——— Try it: a paste box with quick starts ——— */

function TryIt({ onStart }: { onStart: Start }) {
  const [text, setText] = useState("");
  const starts = [
    { label: "From a LinkedIn search", i: 0 },
    { label: "A firm’s team page", i: 1 },
    { label: "Just company names", i: 3 },
  ];
  return (
    <section className="rounded-[32px] bg-white px-5 py-10 sm:rounded-[40px] sm:px-12 sm:py-14">
      <h2 className="text-center font-logo text-3xl leading-tight font-semibold tracking-[-0.04em] sm:text-5xl">Who are you looking for?</h2>
      <form
        className="relative mx-auto mt-8 max-w-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          onStart(text.trim() || undefined);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          aria-label="Paste to start"
          placeholder="Paste names, a team page, a LinkedIn search, or a list of firms…"
          className="block w-full resize-none rounded-[24px] border border-stone-200 bg-white p-5 pr-20 text-[16px] shadow-[0_18px_40px_-24px_rgba(21,23,26,.35)] outline-none placeholder:text-stone-400 focus:border-stone-400"
        />
        <button type="submit" aria-label="Find emails" className="absolute right-3 bottom-3 grid size-12 place-items-center rounded-2xl text-lg text-white transition hover:opacity-90" style={{ background: INK }}>
          →
        </button>
      </form>
      <div className="mx-auto mt-4 flex max-w-2xl flex-wrap justify-center gap-2 rounded-[24px] p-3" style={{ background: PAPER }}>
        <span className="w-full pb-1 text-center text-xs text-stone-400">or start from an example</span>
        {starts.map((s) => (
          <button key={s.label} onClick={() => onStart(SAMPLES[s.i].text, SAMPLES[s.i].roles)} className="rounded-xl border border-black/5 bg-white px-4 py-2.5 text-sm text-stone-600 transition hover:text-stone-900 hover:shadow-sm">
            {s.label}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ——— Themed panels ——— */

function Eyebrow({ label, tone, color = ACCENT }: { label: string; tone: "dark" | "light"; color?: string }) {
  // A solid pill with two echoes trailing behind it.
  const echo = tone === "dark" ? "rgba(255,255,255,.14)" : `${color}2E`;
  return (
    <span className="relative inline-flex items-center">
      <span className="absolute left-[calc(100%-26px)] h-full w-11 rounded-full" style={{ background: echo }} />
      <span className="absolute left-[calc(100%-12px)] h-full w-11 rounded-full" style={{ background: echo, opacity: 0.6 }} />
      <span className="relative rounded-full px-4 py-1.5 text-[12px] font-semibold tracking-[0.18em] text-white uppercase" style={{ background: color }}>
        {label}
      </span>
    </span>
  );
}

function Panel({ bg, children, id }: { bg: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-[32px] px-6 py-12 sm:rounded-[40px] sm:px-12 sm:py-16" style={{ background: bg }}>
      <div className="grid items-center gap-10 *:min-w-0 lg:grid-cols-2 lg:gap-14">{children}</div>
    </section>
  );
}

function Copy({ eyebrow, color, title, accent, body, onDark }: { eyebrow: string; color: string; title: string; accent: string; body: string; onDark?: boolean }) {
  return (
    <div>
      <Eyebrow label={eyebrow} tone={onDark ? "dark" : "light"} color={color} />
      <h2 className="mt-6 font-logo text-4xl leading-[1.03] font-semibold tracking-[-0.04em] text-balance sm:text-[52px]">
        {title}
        <br />
        <span style={{ color: onDark ? ACCENT : color === INK ? STONE : color }}>{accent}</span>
      </h2>
      <p className={`mt-5 max-w-md text-[17px] leading-relaxed text-pretty ${onDark ? "text-white/70" : "text-stone-600"}`}>{body}</p>
    </div>
  );
}

function PastePanel() {
  const kinds = ["LinkedIn searches", "Team pages", "Lists of firms", "Meeting notes", "Company URLs", "Spreadsheets"];
  return (
    <Panel bg={SAND}>
      <Copy
        eyebrow="Paste"
        color={INK}
        title="Drop in anything."
        accent="We find the people."
        body="No templates, no columns to map. Paste what you already have and say who you’re after — “partners”, “HR directors”. Everyone else is skipped before anything is spent."
      />
      <div className="flex flex-wrap gap-2.5 lg:justify-end">
        {kinds.map((k, i) => (
          <span key={k} className="rounded-2xl bg-white px-4 py-3 text-[15px] font-medium shadow-[0_10px_24px_-16px_rgba(21,23,26,.4)]" style={{ transform: `rotate(${[-2, 1.5, -1, 2, -1.5, 1][i]}deg)` }}>
            {k}
          </span>
        ))}
      </div>
    </Panel>
  );
}

function ResearchPanel() {
  return (
    <Panel bg={MINT}>
      <Copy
        eyebrow="Research"
        color={DEEP}
        title="Real domains."
        accent="Sourced formats."
        body="For every company: its actual website, then how it writes emails — read from a page you can open and check. Up to three addresses per person, best first."
      />
      <Demo />
    </Panel>
  );
}

function ProofPanel() {
  return (
    <Panel bg={INK} id="proof">
      <div className="text-white">
        <Copy
          onDark
          eyebrow="Proof"
          color={ACCENT}
          title="Not a guess machine."
          accent="Receipts included."
          body="Every email links to its source. Shared inboxes like info@ never count. And when nothing states a format, you get a clear “no sourced email” — never a made-up address."
        />
      </div>
      <Receipt />
    </Panel>
  );
}

/* ——— Animated results card ——— */

const ROWS = [
  { name: "Priya Natarajan", title: "Managing Partner", email: "pnatarajan@harborpine.com" },
  { name: "Oren Castellano", title: "Senior Attorney", email: "ocastellano@harborpine.com" },
  { name: "Dana Whitlock", title: "Paralegal", email: "dwhitlock@harborpine.com" },
];
const STAGES = ["Read", "Domain", "Format", "Emails"];
const T_ROWS = STAGES.length * 2;
const T_END = T_ROWS + ROWS.length * 2 + 10;

function useTick() {
  const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [t, setT] = useState(reduce ? T_END - 1 : 0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setT((x) => (x + 1) % T_END), 450);
    return () => clearInterval(id);
  }, [reduce]);
  return t;
}

function Demo() {
  const t = useTick();
  const stage = Math.min(STAGES.length, Math.floor(t / 2));
  const rows = t < T_ROWS ? 0 : Math.min(ROWS.length, Math.floor((t - T_ROWS) / 2) + 1);
  return (
    <div className="rounded-[28px] bg-white p-4 shadow-[0_30px_60px_-30px_rgba(11,95,71,.45)] sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {STAGES.map((s, i) => (
          <span
            key={s}
            className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all duration-300 ${i <= stage ? "text-white" : "bg-stone-100 text-stone-400"}`}
            style={i < stage ? { background: INK } : i === stage ? { background: ACCENT, boxShadow: `0 0 0 4px ${ACCENT}26` } : undefined}
          >
            {s}
          </span>
        ))}
      </div>
      <div className={`mt-3 flex items-center gap-1.5 text-xs transition-opacity duration-300 ${stage >= 2 ? "opacity-100" : "opacity-0"}`}>
        <span className="font-data text-stone-700">harborpine.com</span>
        <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: MINT, color: DEEP }}>flast · sourced</span>
      </div>
      <div className="mt-3 space-y-2">
        {ROWS.map((r, i) => (
          <div
            key={r.name}
            className={`flex items-center gap-3 rounded-2xl border border-stone-100 px-3 py-2.5 transition-all duration-500 ${i < rows ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
            style={{ background: "#FBFAF8" }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold" style={{ background: SAND, color: STONE }}>
              {r.name.split(" ").map((w) => w[0]).join("")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-semibold">{r.name}</span>
                <span className="hidden truncate text-xs text-stone-400 sm:inline">{r.title}</span>
              </div>
              <div className="truncate font-data text-[12.5px] text-stone-700">{r.email}</div>
            </div>
            <span className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ background: MINT, color: DEEP }}>source ↗</span>
          </div>
        ))}
      </div>
      <div className={`mt-4 flex gap-2 transition-opacity duration-500 ${rows === ROWS.length ? "opacity-100" : "opacity-0"}`}>
        {["Copy", "CSV", "Google Sheets"].map((b, i) => (
          <span key={b} className={`rounded-xl px-3 py-1.5 text-xs font-medium ${i === 1 ? "text-white" : "border border-stone-200 bg-white text-stone-700"}`} style={i === 1 ? { background: INK } : undefined}>
            {b}
          </span>
        ))}
      </div>
    </div>
  );
}

function Receipt() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="rotate-[-1.5deg] rounded-[28px] bg-white p-6 shadow-[0_40px_80px_-30px_rgba(0,0,0,.7)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-[0.14em] text-stone-400 uppercase">Why this email</span>
          <AppIcon size={26} />
        </div>
        <div className="mt-4 font-data text-[15px] break-words sm:text-lg">ocastellano@harborpine.com</div>
        <dl className="mt-5 space-y-3 text-sm">
          {[
            ["Company", "Harbor & Pine Legal"],
            ["Domain", "harborpine.com · receives mail"],
            ["Format", "flast — first initial + last name"],
            ["Proof", "2 addresses on their team page"],
          ].map(([k, v]) => (
            <div key={k} className="flex gap-4 border-t border-dashed border-stone-200 pt-3">
              <dt className="w-20 shrink-0 text-stone-400">{k}</dt>
              <dd className="text-stone-800">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 flex items-center gap-2">
          <span className="rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: MINT, color: DEEP }}>from their site</span>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">95%</span>
        </div>
      </div>
    </div>
  );
}

/* ——— Closing ——— */

function Closing({ onStart }: { onStart: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-[32px] px-6 py-16 text-center text-white sm:rounded-[40px] sm:py-20" style={{ background: ACCENT }}>
      <div aria-hidden className="absolute -top-16 -left-16 opacity-[0.12]">
        <Mark size={300} ink="#FFFFFF" ground={ACCENT} />
      </div>
      <div aria-hidden className="lp-float absolute -right-10 -bottom-16 size-56 rounded-full" style={{ background: "radial-gradient(circle at 35% 30%, #5FE0B6, #086B4E)" }} />
      <h2 className="relative mx-auto max-w-2xl font-logo text-4xl leading-[1.05] font-semibold tracking-[-0.04em] text-balance sm:text-6xl">Your next list is one paste away.</h2>
      <p className="relative mx-auto mt-5 max-w-md text-white/85">No sign-up. Paste something and see what comes back.</p>
      <button onClick={onStart} className="relative mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 text-[15px] font-semibold transition hover:-translate-y-0.5" style={{ color: INK }}>
        Open ContactFlow →
      </button>
    </section>
  );
}

function Footer({ onPrivacy, onTerms }: { onPrivacy: () => void; onTerms: () => void }) {
  return (
    <footer>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-3 px-5 py-8 text-sm text-stone-500">
        <Logo size={22} />
        <span className="ml-auto flex flex-wrap gap-x-5 gap-y-2">
          <button className="hover:text-stone-900" onClick={onPrivacy}>Privacy</button>
          <button className="hover:text-stone-900" onClick={onTerms}>Terms</button>
          <a className="hover:text-stone-900" href={`mailto:${SUPPORT_EMAIL}`}>Support</a>
          <span>© 2026 ContactFlow</span>
        </span>
      </div>
    </footer>
  );
}
