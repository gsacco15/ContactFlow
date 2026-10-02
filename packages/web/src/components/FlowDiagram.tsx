import { BUDGET } from "../config.ts";

// A real flowchart of what one run does, drawn to match the pipeline's actual branches.
// Spine on the left (the happy path), side branches on the right.

export type Kind = "you" | "claude" | "jev" | "search" | "free" | "end";
export const KIND: Record<Kind, { color: string; label: string }> = {
  you: { color: "#57534e", label: "You" },
  claude: { color: "#7c3aed", label: "Claude" },
  jev: { color: "#0284c7", label: "Jev" },
  search: { color: "#d97706", label: "Web search" },
  free: { color: "#059669", label: "No cost" },
  end: { color: "#a8a29e", label: "" },
};

const W = 250; // box width
const H = 54; // box height
const DW = 200; // diamond width
const DH = 76; // diamond height
const L = 250; // spine x (centre)
const R = 600; // branch x (centre)

type Box = { x: number; y: number; title: string; sub?: string; kind: Kind; dashed?: boolean };
type Diamond = { x: number; y: number; lines: string[] };

const Y = { paste: 40, read: 130, judge: 220, rel: 318, domain: 418, format: 508, names: 606, build: 704, ok: 802, list: 900, export: 984 };

const boxes: Box[] = [
  { x: L, y: Y.paste, title: "Paste anything", sub: "team page, LinkedIn results, firm list", kind: "you" },
  { x: L, y: Y.read, title: "Read the paste", sub: "people, titles, companies, emails", kind: "claude" },
  { x: L, y: Y.judge, title: "Judge vs. “Looking for”", sub: "only when that box is filled in", kind: "jev" },
  { x: R, y: Y.rel, title: "Skipped", sub: "nothing spent · click Include to undo", kind: "end", dashed: true },
  { x: L, y: Y.domain, title: "Find the domain", sub: "pasted website → cache → search", kind: "search" },
  { x: L, y: Y.format, title: "Find the email format", sub: "your paste → cache → search", kind: "search" },
  { x: R, y: Y.names, title: "Find people on its site", sub: "public team page, never LinkedIn", kind: "search" },
  { x: L, y: Y.build, title: "Build up to 3 emails", sub: "from the format · checks mail server", kind: "free" },
  { x: R, y: Y.ok, title: `Rescue agent`, sub: `once per company · ≤ ${BUDGET.maxRescueCalls} steps`, kind: "claude" },
  { x: R, y: Y.list, title: "Gives up", sub: "row shows the reason", kind: "end", dashed: true },
  { x: L, y: Y.list, title: "Added to your list", sub: "one search card per run", kind: "free" },
  { x: L, y: Y.export, title: "Export CSV", sub: "every ticked search at once", kind: "you" },
];

const diamonds: Diamond[] = [
  { x: L, y: Y.rel, lines: ["Relevant?"] },
  { x: L, y: Y.names, lines: ["Names for this", "company?"] },
  { x: L, y: Y.ok, lines: ["Sourced email", "found?"] },
];

// Edges as polylines; label sits at the given point.
type Edge = { pts: [number, number][]; label?: { text: string; x: number; y: number }; dashed?: boolean };
const top = (y: number, h = H) => y - h / 2;
const bot = (y: number, h = H) => y + h / 2;
const edges: Edge[] = [
  { pts: [[L, bot(Y.paste)], [L, top(Y.read)]] },
  { pts: [[L, bot(Y.read)], [L, top(Y.judge)]] },
  { pts: [[L, bot(Y.judge)], [L, top(Y.rel, DH)]] },
  { pts: [[L + DW / 2, Y.rel], [R - W / 2, Y.rel]], label: { text: "no", x: L + DW / 2 + 14, y: Y.rel - 7 } },
  { pts: [[L, bot(Y.rel, DH)], [L, top(Y.domain)]], label: { text: "yes", x: L - 30, y: bot(Y.rel, DH) + 15 } },
  { pts: [[L, bot(Y.domain)], [L, top(Y.format)]] },
  { pts: [[L, bot(Y.format)], [L, top(Y.names, DH)]] },
  { pts: [[L + DW / 2, Y.names], [R - W / 2, Y.names]], label: { text: "no", x: L + DW / 2 + 14, y: Y.names - 7 } },
  { pts: [[R, bot(Y.names)], [R, Y.build], [L + W / 2, Y.build]] },
  { pts: [[L, bot(Y.names, DH)], [L, top(Y.build)]], label: { text: "yes", x: L - 30, y: bot(Y.names, DH) + 15 } },
  { pts: [[L, bot(Y.build)], [L, top(Y.ok, DH)]] },
  { pts: [[L + DW / 2, Y.ok], [R - W / 2, Y.ok]], label: { text: "no", x: L + DW / 2 + 14, y: Y.ok - 7 } },
  { pts: [[L, bot(Y.ok, DH)], [L, top(Y.list)]], label: { text: "yes", x: L - 30, y: bot(Y.ok, DH) + 15 } },
  { pts: [[R, bot(Y.ok)], [R, top(Y.list)]], label: { text: "nothing found", x: R + 8, y: bot(Y.ok) + 20 } },
  {
    pts: [[R + W / 2, Y.ok], [R + W / 2 + 40, Y.ok], [R + W / 2 + 40, Y.domain], [L + W / 2, Y.domain]],
    label: { text: "fix found → try again", x: R - 30, y: Y.domain - 8 },
    dashed: true,
  },
  { pts: [[L, bot(Y.list)], [L, top(Y.export)]] },
];

function Node({ b }: { b: Box }) {
  const k = KIND[b.kind];
  const x = b.x - W / 2;
  const y = b.y - H / 2;
  return (
    <g>
      <rect x={x} y={y} width={W} height={H} rx={10} fill={b.kind === "end" ? "#fafaf9" : "#fff"} stroke="#d6d3d1" strokeDasharray={b.dashed ? "4 3" : undefined} />
      {b.kind !== "end" && <rect x={x} y={y + 8} width={3.5} height={H - 16} rx={1.75} fill={k.color} />}
      <text x={x + 16} y={y + 22} fontSize={13.5} fontWeight={600} fill={b.kind === "end" ? "#78716c" : "#1c1917"}>
        {b.title}
      </text>
      {b.sub && (
        <text x={x + 16} y={y + 40} fontSize={11} fill="#78716c">
          {b.sub}
        </text>
      )}
    </g>
  );
}

function Decision({ d }: { d: Diamond }) {
  const pts = [[d.x, d.y - DH / 2], [d.x + DW / 2, d.y], [d.x, d.y + DH / 2], [d.x - DW / 2, d.y]].map((p) => p.join(",")).join(" ");
  return (
    <g>
      <polygon points={pts} fill="#f5f5f4" stroke="#a8a29e" />
      {d.lines.map((t, i) => (
        <text key={t} x={d.x} y={d.y + 4 + (i - (d.lines.length - 1) / 2) * 14} fontSize={12} fontWeight={600} fill="#44403c" textAnchor="middle">
          {t}
        </text>
      ))}
    </g>
  );
}

export function FlowDiagram() {
  return (
    <figure className="space-y-3">
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <svg viewBox="0 0 900 1020" className="mx-auto block w-full max-w-3xl min-w-[560px]" role="img" aria-label="Flowchart of one ContactFlow run" fontFamily="inherit">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="#a8a29e" />
            </marker>
          </defs>
          {/* "per company" bracket around the company steps */}
          <rect x={L - W / 2 - 22} y={Y.domain - H / 2 - 22} width={R + W / 2 + 70 - (L - W / 2 - 22)} height={Y.ok + DH / 2 + 14 - (Y.domain - H / 2 - 22)} rx={14} fill="none" stroke="#e7e5e4" strokeDasharray="6 4" />
          <text x={R + W / 2 + 58} y={Y.domain - H / 2 - 8} fontSize={10.5} fill="#a8a29e" letterSpacing="0.06em" textAnchor="end">
            FOR EACH COMPANY · RESULTS CACHED 30 DAYS
          </text>
          {edges.map((e, i) => (
            <g key={i}>
              <polyline points={e.pts.map((p) => p.join(",")).join(" ")} fill="none" stroke="#a8a29e" strokeWidth={1.4} strokeDasharray={e.dashed ? "5 4" : undefined} markerEnd="url(#arrow)" />
              {e.label && (
                <text x={e.label.x} y={e.label.y} fontSize={11} fill="#78716c" fontStyle="italic">
                  {e.label.text}
                </text>
              )}
            </g>
          ))}
          {diamonds.map((d) => (
            <Decision key={d.lines.join()} d={d} />
          ))}
          {boxes.map((b) => (
            <Node key={b.title} b={b} />
          ))}
        </svg>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
        {(["you", "claude", "jev", "search", "free"] as Kind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded-full" style={{ background: KIND[k].color }} />
            {KIND[k].label}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-4 rounded border border-dashed border-stone-400" />
          ends here
        </span>
      </figcaption>
    </figure>
  );
}
