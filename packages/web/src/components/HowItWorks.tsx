import { FIT_THRESHOLDS, LOW_DOMAIN_CONFIDENCE, MIN_SOURCED_CONFIDENCE } from "@cf/core";
import { BUDGET } from "../config.ts";
import { FlowDiagram } from "./FlowDiagram.tsx";

type Step = { title: string; body: string; tag?: string };

const pct = (n: number) => `${Math.round(n * 100)}%`;

const FLOW: Step[] = [
  { title: "Paste", body: "Team page, LinkedIn results, a list of firms, notes, URLs — anything.", tag: "you" },
  { title: "Read", body: "Pulls out people, titles and companies. Emails or formats in your paste are used directly.", tag: "Claude" },
  { title: "Judge", body: "Scores each person against “Looking for”. Not relevant → skipped, nothing spent.", tag: "Jev" },
  { title: "Domain", body: "Finds each company’s real website (skipped when you pasted it).", tag: "web search" },
  { title: "Email format", body: "Looks for a source that states how the company writes emails, e.g. flast@.", tag: "web search" },
  { title: "Emails", body: "Builds up to 3 emails per person from the format, then checks the domain accepts mail.", tag: "no cost" },
];

function Box({ s, n }: { s: Step; n: number }) {
  return (
    <li className="relative flex-1 basis-40 rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span className="grid size-5 place-items-center rounded-full bg-stone-900 text-[11px] font-semibold text-white">{n}</span>
        <span className="font-semibold">{s.title}</span>
        {s.tag && <span className="ml-auto rounded-full bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">{s.tag}</span>}
      </div>
      <p className="text-xs leading-relaxed text-stone-600">{s.body}</p>
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
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-500">The flow</h3>
        <ol className="flex flex-wrap gap-2 lg:flex-nowrap">
          {FLOW.flatMap((s, i) => [i > 0 && <Arrow key={`a${i}`} />, <Box key={s.title} s={s} n={i + 1} />])}
        </ol>
        <div className="flex flex-wrap gap-2 lg:flex-nowrap">
          <div className="flex-1 rounded-xl border border-dashed border-amber-300 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-900">
            <span className="font-semibold">If a row fails</span> (no domain, no sourced format): a rescue agent tries once per company — a different domain, the firm’s own site,
            another source — in at most {BUDGET.maxRescueCalls} steps, then gives up with a reason.
          </div>
          <div className="flex-1 rounded-xl border border-dashed border-stone-300 bg-white p-3 text-xs leading-relaxed text-stone-600">
            <span className="font-semibold text-stone-800">No names in your paste?</span> With “Looking for” filled in, it reads the company’s public team page to find people.
            Costs more (≈ $0.10–0.50 per company). It never opens LinkedIn.
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-stone-500">Step by step, with every branch</h3>
        <FlowDiagram />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Sourced vs. backup", `An email is “sourced” when a page states the company’s format with at least ${pct(MIN_SOURCED_CONFIDENCE)} confidence, or it came from your paste. Anything else is a backup guess — hidden and left out of exports unless you include them.`],
          ["≈ 72% vs. 72%", "A plain percentage was stated by the source. ≈ means we estimated it from what the search found. Hover any pill for its source."],
          ["Domains", `If we’re less than ${pct(LOW_DOMAIN_CONFIDENCE)} sure a domain is the company’s, no emails are made for it — a wrong domain is worse than none.`],
          ["Looking for", `Plain words work for any industry (“partners, firm admins; not paralegals”). ✓ ${pct(FIT_THRESHOLDS.yes)}+ relevant, ✗ under ${pct(FIT_THRESHOLDS.no)}, ? in between. Click a badge to keep or drop someone.`],
          ["Your list", "Every run becomes a search card. Tick cards to show or hide them, rename them, and export whatever is ticked. People found twice appear once and aren’t looked up again."],
          ["Cost & privacy", "Shown live at the bottom. Email formats are cached for 30 days so repeat companies are nearly free. Names stay in your browser; only formats are stored on the server."],
        ].map(([t, b]) => (
          <div key={t} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <h4 className="mb-1 font-semibold">{t}</h4>
            <p className="text-sm leading-relaxed text-stone-600">{b}</p>
          </div>
        ))}
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
