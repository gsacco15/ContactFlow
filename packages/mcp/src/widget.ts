// The ContactFlow results view shown inside ChatGPT (MCP Apps UI: text/html;profile=mcp-app).
// It renders whatever the show_results tool returns, received over the MCP Apps bridge
// (ui/notifications/tool-result via postMessage). Data is treated as untrusted: text only, no HTML.
// Treat the URI as a cache key — bump the version on breaking changes.

export const WIDGET_URI = "ui://contactflow/results-v1.html";
export const WIDGET_MIME = "text/html;profile=mcp-app";

const ICON = `<svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true"><defs><linearGradient id="t" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#30353C"/><stop offset=".55" stop-color="#17191D"/><stop offset="1" stop-color="#0C0D10"/></linearGradient><radialGradient id="g" cx=".33" cy=".28" r=".85"><stop offset="0" stop-color="#5BE6BA"/><stop offset=".55" stop-color="#14A97D"/><stop offset="1" stop-color="#087453"/></radialGradient></defs><rect width="64" height="64" rx="15" fill="url(#t)"/><path d="M44 18 Q20 18 20 32 Q20 46 44 46" fill="none" stroke="#F6F5F2" stroke-width="7" stroke-linecap="round"/><circle cx="20" cy="32" r="6.5" fill="#F6F5F2"/><circle cx="44" cy="46" r="8.5" fill="url(#g)"/></svg>`;

const CSS = `
:root{--ink:#15171A;--muted:#6b6f76;--line:#e7e5e0;--bg:#fff;--soft:#f6f5f2;--green:#12A87C;--mint:#e3f6ef;--deep:#0b6b4f;--amber:#9a6200;--amberbg:#fdf3e1;--red:#b42318;--redbg:#fdecea}
@media (prefers-color-scheme:dark){:root{--ink:#ececea;--muted:#a0a3a8;--line:#30333a;--bg:#1b1d21;--soft:#23262b;--mint:#12382d;--deep:#5be6ba;--amberbg:#3a2c12;--amber:#f2c26b;--redbg:#3b1d1b;--red:#f59e93}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 "Geist","Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{padding:14px 14px 12px}
.top{display:flex;align-items:center;gap:8px;margin-bottom:10px}.brand{font-weight:500;letter-spacing:-.03em}.brand b{color:var(--green)}
.sum{margin-left:auto;color:var(--muted);font-size:12px}
.co{border:1px solid var(--line);border-radius:14px;margin-top:10px;overflow:hidden}
.cohead{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;padding:10px 12px;background:var(--soft)}
.coname{font-weight:600}.dom{color:var(--muted);font-family:"Geist Mono",ui-monospace,monospace;font-size:12px}
.pill{display:inline-block;border-radius:999px;padding:2px 8px;font-size:11.5px;font-weight:600;white-space:nowrap}
.ok{background:var(--mint);color:var(--deep)}.warn{background:var(--amberbg);color:var(--amber)}.bad{background:var(--redbg);color:var(--red)}.neutral{background:var(--soft);color:var(--muted);border:1px solid var(--line)}
.fmt{font-family:"Geist Mono",ui-monospace,monospace;font-size:12px}
a{color:inherit}.src{color:var(--muted);font-size:12px}
.row{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:9px 12px;border-top:1px solid var(--line)}
.row>.pill{align-self:start;justify-self:end}
.who{font-weight:500}.title{color:var(--muted);font-size:12.5px}
.email{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.addr{font-family:"Geist Mono",ui-monospace,monospace;font-size:13px;word-break:break-all}
.backup{color:var(--muted);font-family:"Geist Mono",ui-monospace,monospace;font-size:11.5px}
.note{grid-column:1/-1;color:var(--muted);font-size:12px}
button{font:inherit;cursor:pointer;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:9px;padding:4px 9px;font-size:12px}
button:hover{background:var(--soft)}.copy{padding:1px 7px;font-size:11px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.actions .primary{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.foot{margin-top:10px;color:var(--muted);font-size:11.5px}
.empty{color:var(--muted);padding:18px 4px}
`;

// Plain-JS view. Builds DOM with textContent only (results are untrusted).
const JS = `
const $ = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const VERIFIED = {
  "yes": ["ok", "✓ verified"], "format proven": ["ok", "✓ format proven"], "accept-all server": ["warn", "◎ accept-all"],
  "no (bounced)": ["bad", "✗ bounced"], "risky": ["warn", "~ risky"], "from your paste": ["neutral", "from paste"], "demo": ["neutral", "demo"], "not checked": ["neutral", "not checked"],
};
const COVER = { "format proven": ["ok", "✓ format proven"], "accept-all server": ["warn", "◎ accepts any address"], "all checked addresses bounced": ["bad", "✗ checks bounced"], "check unclear": ["neutral", "? check unclear"], "verifier unavailable": ["neutral", "verifier unavailable"] };
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v) => (typeof v === "string" ? v : "");
let data = null;

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch {} t.remove(); }
  if (btn) { const was = btn.textContent; btn.textContent = "Copied"; setTimeout(() => (btn.textContent = was), 1200); }
}
const firstEmail = (p) => str(arr(p.emails)[0]?.address);
const name = (p) => [str(p.first), str(p.middle), str(p.last)].filter(Boolean).join(" ") || "(no name)";

function render(d) {
  data = d || {};
  const root = document.getElementById("root"); root.textContent = "";
  const wrap = $("div", "wrap"); root.appendChild(wrap);
  const people = arr(data.people), companies = arr(data.companies);
  const top = $("div", "top"); top.insertAdjacentHTML("beforeend", ${JSON.stringify(ICON)});
  const brand = $("span", "brand", "contact"); brand.appendChild($("b", null, "flow")); top.appendChild(brand);
  const withEmail = people.filter(firstEmail).length;
  const proven = people.filter((p) => p.verified === "yes" || p.verified === "format proven").length;
  top.appendChild($("span", "sum", people.length + " people · " + withEmail + " with email" + (proven ? " · " + proven + " verified" : "")));
  wrap.appendChild(top);
  if (!people.length && !companies.length) { wrap.appendChild($("div", "empty", "No results yet.")); return; }

  const names = companies.length ? companies.map((c) => str(c.name)) : [...new Set(people.map((p) => str(p.company)))];
  for (const coName of names) {
    const co = companies.find((c) => str(c.name) === coName) || { name: coName };
    const box = $("div", "co"); const head = $("div", "cohead");
    head.appendChild($("span", "coname", coName || "Company"));
    if (str(co.domain)) head.appendChild($("span", "dom", co.domain));
    const f = arr(co.patterns)[0];
    if (f) {
      head.appendChild($("span", "pill neutral fmt", str(f.format) + "@ · " + Math.round((Number(f.confidence) || 0) * 100) + "%"));
      const src = $("span", "src");
      const label = str(f.source) || str(f.confidence_basis);
      if (str(f.source_url).startsWith("http")) { const a = $("a", null, label || "source"); a.href = f.source_url; a.target = "_blank"; a.rel = "noopener"; src.appendChild(a); }
      else src.textContent = label;
      head.appendChild(src);
    }
    const cv = COVER[str(co.verification)]; if (cv) head.appendChild($("span", "pill " + cv[0], cv[1]));
    box.appendChild(head);
    for (const p of people.filter((x) => str(x.company) === coName)) {
      const row = $("div", "row");
      const left = $("div"); left.appendChild($("div", "who", name(p))); if (str(p.title)) left.appendChild($("div", "title", p.title));
      row.appendChild(left);
      const v = VERIFIED[str(p.verified)] || VERIFIED["not checked"]; row.appendChild($("span", "pill " + v[0], v[1]));
      const em = $("div", "email"); const e = firstEmail(p);
      if (e) {
        em.appendChild($("span", "addr", e));
        const b = $("button", "copy", "Copy"); b.onclick = () => copy(e, b); em.appendChild(b);
        const rest = arr(p.emails).slice(1).map((x) => str(x.address)).filter(Boolean);
        if (rest.length) em.appendChild($("span", "backup", "or " + rest.join(", ")));
      } else em.appendChild($("span", "title", "No email" + (str(p.note) ? " — " + p.note : "")));
      row.appendChild(em);
      if (str(p.flag)) row.appendChild($("div", "note", "⚠ " + p.flag));
      box.appendChild(row);
    }
    if (str(co.note) && !people.some((x) => str(x.company) === coName)) box.appendChild($("div", "row note", co.note));
    wrap.appendChild(box);
  }

  const actions = $("div", "actions");
  const all = $("button", "primary", "Copy all emails");
  all.onclick = () => copy(people.map(firstEmail).filter(Boolean).join("\\n"), all);
  const table = $("button", null, "Copy as table");
  table.onclick = () => copy(["Name\\tTitle\\tCompany\\tEmail\\tVerified", ...people.map((p) => [name(p), str(p.title), str(p.company), firstEmail(p), str(p.verified)].join("\\t"))].join("\\n"), table);
  actions.appendChild(all); actions.appendChild(table); wrap.appendChild(actions);
  wrap.appendChild($("div", "foot", "Only ✓ verified or ✓ format proven were confirmed by a mailbox check. Others follow the company's sourced format."));
}

// MCP Apps bridge: say hello (ui/initialize), then the host sends the tool result.
let shown = false;
const show = (d) => { if (d && typeof d === "object" && (Array.isArray(d.people) || Array.isArray(d.companies))) { shown = true; render(d); } };
const pending = new Map(); let nextId = 1;
function request(method, params) {
  const id = nextId++;
  window.parent.postMessage({ jsonrpc: "2.0", id, method, params }, "*");
  return new Promise((ok) => { pending.set(id, ok); setTimeout(() => { if (pending.delete(id)) ok(null); }, 4000); });
}
window.addEventListener("message", (event) => {
  if (event.source !== window.parent) return;
  const m = event.data; if (!m || m.jsonrpc !== "2.0") return;
  if (m.id !== undefined && pending.has(m.id)) { const ok = pending.get(m.id); pending.delete(m.id); ok(m.result || null); return; }
  if (m.method === "ui/notifications/tool-result") show(m.params && (m.params.structuredContent || (m.params.result && m.params.result.structuredContent)));
}, { passive: true });
request("ui/initialize", { protocolVersion: "2025-06-18", appInfo: { name: "contactflow-results", version: "1" }, appCapabilities: {} })
  .then(() => window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/initialized", params: {} }, "*"));
// ChatGPT compatibility: results on window.openai.toolOutput, updated via the openai:set_globals event.
const fromGlobals = () => window.openai && show(window.openai.toolOutput);
window.addEventListener("openai:set_globals", fromGlobals);
fromGlobals();
let tries = 0; const poll = setInterval(() => { if (shown || ++tries > 40) return clearInterval(poll); fromGlobals(); }, 250);
`;

export const WIDGET_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body><div id="root"><div class="wrap"><div class="empty">Loading results…</div></div></div><script>${JS}</script></body></html>`;

export const WIDGET_META = {
  ui: {
    prefersBorder: true,
    csp: { connectDomains: [], resourceDomains: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"] },
  },
};
