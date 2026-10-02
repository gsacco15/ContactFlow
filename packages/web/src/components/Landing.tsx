import { useEffect, useState, type ReactNode } from "react";
import { ACCENT, Logo, Mark } from "./Logo.tsx";
import { SUPPORT_EMAIL } from "./Legal.tsx";

/** Public landing page. Everything on it is illustrative — the names are made up. */
export function Landing({ onStart, onHow, onPrivacy, onTerms }: { onStart: () => void; onHow: () => void; onPrivacy: () => void; onTerms: () => void }) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-[#F6F5F2] text-[#15171A]">
      <Nav onStart={onStart} onHow={onHow} />
      <Hero onStart={onStart} onHow={onHow} />
      <Sources />
      <Steps />
      <Trust />
      <Closing onStart={onStart} />
      <Footer onPrivacy={onPrivacy} onTerms={onTerms} />
    </div>
  );
}

function Nav({ onStart, onHow }: { onStart: () => void; onHow: () => void }) {
  return (
    <header className="sticky top-0 z-20 border-b border-black/5 bg-[#F6F5F2]/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-5 py-3.5">
        <Logo size={28} />
        <nav className="ml-auto flex items-center gap-5 text-sm text-stone-600">
          <button onClick={onHow} className="hidden hover:text-stone-900 sm:inline">How it works</button>
          <a href="#trust" className="hidden hover:text-stone-900 sm:inline">Why trust it</a>
          <button onClick={onStart} className="rounded-full bg-[#15171A] px-4 py-2 text-sm font-medium text-white transition hover:bg-black">
            Open app
          </button>
        </nav>
      </div>
    </header>
  );
}

function Hero({ onStart, onHow }: { onStart: () => void; onHow: () => void }) {
  return (
    <section className="relative">
      {/* Soft clay shapes behind the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-0 overflow-hidden">
        <div className="lp-float absolute -top-24 -right-24 size-[420px] rounded-[42%] bg-[#12A87C]/15 blur-2xl" />
        <div className="lp-float-slow absolute top-64 -left-32 size-[360px] rounded-[46%] bg-[#E8DCC8]/70 blur-2xl" />
      </div>
      <div className="relative mx-auto max-w-6xl px-5 pt-16 pb-10 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs font-medium text-stone-600 shadow-sm">
          <span className="size-1.5 rounded-full" style={{ background: ACCENT }} />
          Contact research without the busywork
        </span>
        <h1 className="mx-auto mt-6 max-w-6xl font-logo text-[44px] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-7xl lg:text-[80px]">
          Paste anything.
          <br />
          Get emails you can <span style={{ color: ACCENT }}>trust</span>.
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-pretty text-stone-600">
          Drop in a LinkedIn search, a team page or a messy list of firms. ContactFlow finds the people, the real domain and a
          sourced email format — and shows you where every answer came from.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button onClick={onStart} className="group inline-flex items-center gap-2 rounded-full bg-[#15171A] px-6 py-3.5 text-[15px] font-medium text-white shadow-[0_10px_30px_-10px_rgba(21,23,26,.6)] transition hover:-translate-y-0.5 hover:bg-black">
            Try it free
            <span className="transition group-hover:translate-x-0.5">→</span>
          </button>
          <button onClick={onHow} className="rounded-full border border-black/10 bg-white px-6 py-3.5 text-[15px] font-medium text-stone-800 transition hover:border-black/25">
            See how it works
          </button>
        </div>
      </div>
      <div className="relative mx-auto max-w-6xl px-5 pb-20">
        <Demo />
      </div>
    </section>
  );
}

/* ——— Animated product demo: paste → pipeline → results ——— */

const PASTE = [
  "Priya Natarajan • 2nd",
  "Managing Partner at Harbor & Pine Legal",
  "Message",
  "Oren Castellano • 3rd+",
  "Senior Attorney at Harbor & Pine Legal",
  "Connect",
  "Dana Whitlock • 3rd+",
  "Paralegal · Gladstone, Michigan",
];
const STAGES = ["Read", "Domain", "Format", "Emails"];
const ROWS = [
  { name: "Priya Natarajan", title: "Managing Partner", email: "pnatarajan@harborpine.com" },
  { name: "Oren Castellano", title: "Senior Attorney", email: "ocastellano@harborpine.com" },
  { name: "Dana Whitlock", title: "Paralegal", email: "dwhitlock@harborpine.com" },
];
// Timeline in ticks of 450ms: paste lines, then stages, then rows, then hold.
const T_STAGES = PASTE.length + 1;
const T_ROWS = T_STAGES + STAGES.length * 2;
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
  const stage = t < T_STAGES ? -1 : Math.min(STAGES.length, Math.floor((t - T_STAGES) / 2));
  const rows = t < T_ROWS ? 0 : Math.min(ROWS.length, Math.floor((t - T_ROWS) / 2) + 1);
  return (
    <div className="relative rounded-[28px] border border-black/10 bg-white/60 p-3 shadow-[0_40px_80px_-40px_rgba(21,23,26,.35)] backdrop-blur sm:p-4">
      <div className="grid gap-3 md:grid-cols-[1fr_auto_1.25fr]">
        {/* Paste */}
        <Panel label="Your paste" hint="LinkedIn search">
          <div className="h-[244px] space-y-1.5 overflow-hidden font-mono text-[12.5px] leading-snug">
            {PASTE.map((l, i) => (
              <div key={i} className={`transition-all duration-300 ${i < t ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"} ${/^(Message|Connect)$/.test(l) ? "text-stone-300 line-through decoration-stone-300" : "text-stone-700"}`}>
                {l}
              </div>
            ))}
          </div>
        </Panel>

        {/* Pipeline */}
        <div className="flex items-center justify-center gap-2 md:flex-col md:px-2">
          {STAGES.map((s, i) => {
            const done = i < stage;
            const on = i === stage;
            return (
              <div key={s} className="flex items-center gap-2 md:flex-col">
                <span
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold whitespace-nowrap transition-all duration-300 ${done ? "bg-[#15171A] text-white" : on ? "scale-105 text-white" : "bg-stone-100 text-stone-400"}`}
                  style={on ? { background: ACCENT, boxShadow: `0 0 0 4px ${ACCENT}26` } : undefined}
                >
                  {s}
                </span>
                {i < STAGES.length - 1 && <span className={`h-px w-3 md:h-4 md:w-px ${done ? "bg-stone-900" : "bg-stone-200"}`} />}
              </div>
            );
          })}
        </div>

        {/* Results */}
        <Panel
          label="Results"
          hint={
            stage >= 2 ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="font-mono text-stone-700">harborpine.com</span>· <span className="font-mono">flast</span>
                <span className="rounded-full bg-[#E3F4EE] px-1.5 py-px text-[10px] font-semibold text-[#0B7A5A]">sourced</span>
              </span>
            ) : (
              "waiting…"
            )
          }
        >
          <div className="h-[244px] space-y-2">
            {ROWS.map((r, i) => (
              <div
                key={r.name}
                className={`flex items-center gap-3 rounded-xl border border-stone-100 bg-white px-3 py-2.5 transition-all duration-500 ${i < rows ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-stone-100 text-xs font-semibold text-stone-600">
                  {r.name.split(" ").map((w) => w[0]).join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{r.name}</span>
                    <span className="truncate text-xs text-stone-400">{r.title}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[12.5px] text-stone-700">{r.email}</span>
                    <span className="shrink-0 rounded-full bg-[#E3F4EE] px-2 py-px text-[10px] font-semibold text-[#0B7A5A]">source ↗</span>
                  </div>
                </div>
              </div>
            ))}
            <div className={`flex gap-2 pt-1 transition-opacity duration-500 ${rows === ROWS.length ? "opacity-100" : "opacity-0"}`}>
              {["Copy", "CSV", "Google Sheets"].map((b, i) => (
                <span key={b} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${i === 1 ? "bg-[#15171A] text-white" : "border border-stone-200 bg-white text-stone-700"}`}>
                  {b}
                </span>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Panel({ label, hint, children }: { label: string; hint: ReactNode; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-[#FBFAF8] p-4 text-left">
      <div className="mb-3 flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold tracking-wide text-stone-900 uppercase">{label}</span>
        <span className="truncate text-stone-400">{hint}</span>
      </div>
      {children}
    </div>
  );
}

/* ——— What you can paste ——— */

function Sources() {
  const items = ["LinkedIn searches", "Team pages", "Lists of firms", "Meeting notes", "Company URLs", "Spreadsheets", "Email signatures", "Conference lists"];
  return (
    <section className="border-y border-black/5 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-10">
        <p className="text-center text-sm text-stone-500">Works with whatever you’ve already got</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          {items.map((s) => (
            <span key={s} className="rounded-full border border-stone-200 bg-[#F6F5F2] px-4 py-2 text-sm font-medium text-stone-700">
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ——— Three steps ——— */

function Steps() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
      <SectionHead eyebrow="How it works" title={<>Three steps. <span className="text-stone-400">Zero spreadsheets of guesses.</span></>} />
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        <StepCard n="01" title="Paste" tone="paper" body="Copy anything with names or companies in it. Add who you’re looking for — “partners”, “HR directors” — and the rest is skipped.">
          <div className="space-y-1.5 font-mono text-[12px] text-stone-500">
            <div className="rounded-md bg-white px-2.5 py-1.5">Harbor &amp; Pine Legal — partners</div>
            <div className="rounded-md bg-white px-2.5 py-1.5">Dana Whitlock, Paralegal</div>
            <div className="rounded-md bg-white px-2.5 py-1.5 text-stone-300">acme.com/team …</div>
          </div>
        </StepCard>
        <StepCard n="02" title="We do the research" tone="ink" body="Finds each company’s real website, then how that company writes its emails — from a source you can open and check.">
          <div className="space-y-2 text-[12px]">
            {[
              ["Domain", "harborpine.com"],
              ["Format", "flast@"],
              ["Source", "their team page ↗"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between rounded-md bg-white/10 px-2.5 py-1.5">
                <span className="text-white/50">{k}</span>
                <span className="font-mono text-white">{v}</span>
              </div>
            ))}
          </div>
        </StepCard>
        <StepCard n="03" title="Take it anywhere" tone="green" body="Up to three emails per person, ranked. Copy them, download a CSV, or send the list straight to Google Sheets.">
          <div className="flex flex-wrap gap-2 text-[12px] font-medium">
            {["Copy", "CSV", "Google Sheets"].map((b) => (
              <span key={b} className="rounded-md bg-white/90 px-2.5 py-1.5 text-[#0B5F47]">{b}</span>
            ))}
          </div>
        </StepCard>
      </div>
    </section>
  );
}

function StepCard({ n, title, body, tone, children }: { n: string; title: string; body: string; tone: "paper" | "ink" | "green"; children: ReactNode }) {
  const look = {
    paper: "bg-[#ECE8E0] text-[#15171A]",
    ink: "bg-[#15171A] text-white",
    green: "text-white",
  }[tone];
  return (
    <div className={`flex min-h-[340px] flex-col rounded-[28px] p-7 transition hover:-translate-y-1 ${look}`} style={tone === "green" ? { background: ACCENT } : undefined}>
      <span className={`font-mono text-sm ${tone === "paper" ? "text-stone-500" : "text-white/60"}`}>{n}</span>
      <h3 className="mt-3 font-logo text-3xl font-semibold tracking-[-0.03em]">{title}</h3>
      <p className={`mt-3 text-[15px] leading-relaxed ${tone === "paper" ? "text-stone-600" : "text-white/75"}`}>{body}</p>
      <div className="mt-auto pt-6">{children}</div>
    </div>
  );
}

/* ——— Why trust it ——— */

function Trust() {
  const items = [
    { title: "Every email shows its source", body: "Click through to the page that states the company’s format. No black-box scores." },
    { title: "Shared inboxes filtered out", body: "info@, sales@, careers@ and 200+ others never count as a person’s format." },
    { title: "Reads the company’s own site", body: "Real addresses on a firm’s website beat any third-party guess." },
    { title: "Says so when it doesn’t know", body: "No source? You get a clear “no sourced email”, not a made-up address." },
  ];
  return (
    <section id="trust" className="bg-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:py-28 lg:grid-cols-[1fr_1.1fr] lg:items-center">
        <div>
          <SectionHead align="left" eyebrow="Why trust it" title={<>Not a guess machine.<br /><span style={{ color: ACCENT }}>Receipts included.</span></>} />
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {items.map((x) => (
              <div key={x.title}>
                <div className="mb-3 grid size-9 place-items-center rounded-xl" style={{ background: `${ACCENT}1A` }}>
                  <span className="size-2.5 rounded-full" style={{ background: ACCENT }} />
                </div>
                <h3 className="font-semibold">{x.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{x.body}</p>
              </div>
            ))}
          </div>
        </div>
        <Receipt />
      </div>
    </section>
  );
}

function Receipt() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="absolute -inset-6 -z-0 rounded-[40px] bg-[#ECE8E0]" />
      <div className="relative rotate-[-1.5deg] rounded-3xl border border-black/5 bg-white p-6 shadow-[0_30px_60px_-30px_rgba(21,23,26,.35)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Why this email</span>
          <Mark size={22} />
        </div>
        <div className="mt-4 font-mono text-lg">ocastellano@harborpine.com</div>
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
          <span className="rounded-full bg-[#E3F4EE] px-2.5 py-1 text-xs font-semibold text-[#0B7A5A]">from their site</span>
          <span className="rounded-full bg-stone-100 px-2.5 py-1 text-xs font-medium text-stone-600">95%</span>
        </div>
      </div>
    </div>
  );
}

/* ——— Closing CTA ——— */

function Closing({ onStart }: { onStart: () => void }) {
  return (
    <section className="px-5 py-20 sm:py-24">
      <div className="relative mx-auto max-w-6xl overflow-hidden rounded-[36px] bg-[#15171A] px-6 py-16 text-center text-white sm:py-20">
        <div aria-hidden className="lp-float absolute -right-16 -bottom-20 size-72 rounded-[44%] opacity-60 blur-2xl" style={{ background: ACCENT }} />
        <div aria-hidden className="absolute -top-10 -left-10 opacity-[0.07]">
          <Mark size={260} ink="#FFFFFF" ground="#15171A" />
        </div>
        <h2 className="relative mx-auto max-w-2xl font-logo text-4xl leading-[1.05] font-semibold tracking-[-0.04em] sm:text-6xl">
          Your next list is one paste away.
        </h2>
        <p className="relative mx-auto mt-5 max-w-md text-white/65">No sign-up. Paste something and see what comes back.</p>
        <button onClick={onStart} className="relative mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-[15px] font-semibold text-[#15171A] transition hover:-translate-y-0.5">
          Open ContactFlow →
        </button>
      </div>
    </section>
  );
}

function SectionHead({ eyebrow, title, align = "center" }: { eyebrow: string; title: ReactNode; align?: "center" | "left" }) {
  return (
    <div className={align === "center" ? "text-center" : ""}>
      <span className="font-mono text-xs font-medium tracking-widest text-stone-400 uppercase">{eyebrow}</span>
      <h2 className={`mt-3 font-logo text-4xl leading-[1.05] font-semibold tracking-[-0.04em] sm:text-5xl ${align === "center" ? "mx-auto max-w-3xl" : ""}`}>{title}</h2>
    </div>
  );
}

function Footer({ onPrivacy, onTerms }: { onPrivacy: () => void; onTerms: () => void }) {
  return (
    <footer className="border-t border-black/5">
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
