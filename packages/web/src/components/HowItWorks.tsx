import { FIT_THRESHOLDS, LOW_DOMAIN_CONFIDENCE, MIN_SOURCED_CONFIDENCE } from "@cf/core";
import { FlowDiagram, KIND, type Kind } from "./FlowDiagram.tsx";

type Step = { title: string; body: string; tag?: string; kind: Kind };

const pct = (n: number) => `${Math.round(n * 100)}%`;

const FLOW: Step[] = [
  { title: "Paste", body: "Team page, LinkedIn results, a list of firms, notes, URLs — anything.", tag: "you", kind: "you" },
  { title: "Read", body: "Pulls out people, titles and companies. Emails or formats in your paste are used directly.", tag: "Claude", kind: "claude" },
  { title: "Judge", body: "Scores each person against “Looking for”. Not relevant → skipped, nothing spent.", tag: "Jev", kind: "jev" },
  { title: "Domain", body: "Finds each company’s real website (skipped when you pasted it).", tag: "web search", kind: "search" },
  { title: "Email format", body: "Looks for a source that states how the company writes emails, e.g. flast@.", tag: "web search", kind: "search" },
  { title: "Emails", body: "Builds up to 3 emails per person from the format, then checks the domain accepts mail.", tag: "no cost", kind: "free" },
];

function Box({ s, n }: { s: Step; n: number }) {
  return (
    <li className="flex min-w-0 flex-1 basis-40 flex-col gap-2 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-stone-900 text-[11px] font-semibold text-white">{n}</span>
        <span className="truncate font-semibold">{s.title}</span>
      </div>
      <p className="text-xs leading-relaxed text-stone-600">{s.body}</p>
      {s.tag && (
        <span
          className="mt-auto inline-flex items-center gap-1.5 self-start whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold"
          style={{ color: KIND[s.kind].color, background: `${KIND[s.kind].color}14`, boxShadow: `inset 0 0 0 1px ${KIND[s.kind].color}33` }}
        >
          <span className="size-1.5 rounded-full" style={{ background: KIND[s.kind].color }} />
          {s.tag}
        </span>
      )}
    </li>
  );
}

const Arrow = () => (
  <li aria-hidden className="hidden items-center text-stone-300 lg:flex">
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor"><path d="M6 3l5 5-5 5V3z" /></svg>
  </li>
);

export function HowItWorks({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
        <p className="text-stone-600">
          Paste whatever you have. ContactFlow finds the people, their company’s domain and how that company writes its email addresses, then gives you up to three
          emails per person — each with the source it came from. Results stack up in your list so you can export everything at once.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-500">At a glance</h3>
        <ol className="flex flex-wrap gap-2 lg:flex-nowrap">
          {FLOW.flatMap((s, i) => [i > 0 && <Arrow key={`a${i}`} />, <Box key={s.title} s={s} n={i + 1} />])}
        </ol>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-500">Every branch</h3>
        <FlowDiagram />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-500">Good to know</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Sourced vs. backup", `An email is “sourced” when a page states the company’s format with at least ${pct(MIN_SOURCED_CONFIDENCE)} confidence, or it came from your paste. Anything else is a backup guess — hidden and left out of exports unless you include them.`],
          ["≈ 72% vs. 72%", "A plain percentage was stated by the source. ≈ means we estimated it from what the search found. Hover any pill for its source."],
          ["Domains", `If we’re less than ${pct(LOW_DOMAIN_CONFIDENCE)} sure a domain is the company’s, no emails are made for it — a wrong domain is worse than none.`],
          ["Looking for", `Plain words work for any industry (“partners, firm admins; not paralegals”). ✓ ${pct(FIT_THRESHOLDS.yes)}+ relevant, ✗ under ${pct(FIT_THRESHOLDS.no)}, ? in between. Click a badge to keep or drop someone.`],
          ["Your list", "Every run becomes a search card. Tick cards to show or hide them, rename them, and export whatever is ticked. People found twice appear once and aren’t looked up again."],
          ["Cost & privacy", "Shown live at the bottom. A company with names pasted costs a few cents; finding people on its site costs more (≈ $0.10–0.50). Email formats are cached for 30 days so repeat companies are nearly free. Names stay in your browser; only formats are stored on the server."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <h4 className="mb-1 font-semibold">{t}</h4>
            <p className="text-sm leading-relaxed text-stone-600">{b}</p>
          </div>
        ))}
        </div>
      </section>

      <p className="text-xs text-stone-500">
        Emails are pattern-based guesses, not verified mailboxes. You are responsible for CAN-SPAM / GDPR compliance when you send.{" "}
        <button className="font-medium text-stone-700 underline underline-offset-2" onClick={onBack}>
          Back to the app
        </button>
      </p>
    </div>
  );
}
