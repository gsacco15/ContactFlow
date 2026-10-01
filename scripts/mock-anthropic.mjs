// A tiny stand-in for the Anthropic Messages API, for local end-to-end runs with no key and
// no spend. Point the edge function at it with ANTHROPIC_BASE_URL=http://localhost:4010.
// Responses are canned but shaped like the real API (server tool blocks, usage, pause_turn).
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const KNOWN = {
  stripe: "stripe.com", notion: "notion.so", figma: "figma.com", datadog: "datadoghq.com", hubspot: "hubspot.com",
  gusto: "gusto.com", airtable: "airtable.com", canva: "canva.com", linear: "linear.app", ramp: "ramp.com",
};
let id = 0;
const tid = () => `toolu_mock_${++id}`;
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

function extract(text) {
  const companies = new Map();
  const people = [];
  const urls = [];
  const addCo = (name, extra = {}) => {
    const k = slug(name);
    companies.set(k, { ...(companies.get(k) ?? { name }), ...extra });
    return name;
  };
  const mixed = /^(.+?) \(([^)]+)\) — (.+?), (.+?); (.+?) — need (.+)$/.exec(text.trim());
  if (mixed) {
    addCo(mixed[1], { website: mixed[2] });
    addCo(mixed[5], { role_hint: mixed[6] });
    const [first, ...rest] = mixed[3].split(" ");
    people.push({ first, last: rest.join(" "), title: mixed[4], company: mixed[1] });
    return { mode: "mixed", companies: [...companies.values()], people, urls, notes: "" };
  }
  let heading;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/^https?:\/\//.test(line)) {
      urls.push(line);
      continue;
    }
    const m = /^(.+?) \(([a-z0-9.-]+\.[a-z]+)\)$/.exec(line);
    if (m) {
      heading = addCo(m[1], { website: m[2] });
      continue;
    }
    const p = /^(.+?) — (.+)$/.exec(line);
    if (p) {
      const name = p[1].replace(/^Dr\.?\s+/, "").replace(/\s+(PhD|Jr\.)$/, "");
      const parts = name.split(/\s+/);
      people.push({ first: parts[0], last: parts.slice(1).join(" "), title: p[2], company: heading, raw: line.slice(0, 80) });
      continue;
    }
    heading = addCo(line);
  }
  const mode = urls.length && !people.length ? "urls" : people.length ? "people" : "companies";
  return { mode, companies: [...companies.values()], people, urls, notes: "" };
}

const search = (query, urls) => [
  { type: "server_tool_use", id: `srvtoolu_${++id}`, name: "web_search", input: { query } },
  {
    type: "web_search_tool_result",
    tool_use_id: `srvtoolu_${id}`,
    content: urls.map((url) => ({ type: "web_search_result", url, title: url, encrypted_content: "mock", page_age: null })),
  },
];

function respond(body) {
  const tools = (body.tools ?? []).map((t) => t.name);
  const msgs = body.messages ?? [];
  const user = msgs[0]?.content;
  const input = typeof user === "string" ? (() => { try { return JSON.parse(user); } catch { return user; } })() : user;
  const tool = (name, inp, pre = [], searches = 0) => ({
    content: [...pre, { type: "tool_use", id: tid(), name, input: inp }],
    stop_reason: "tool_use",
    usage: { input_tokens: 1500 + searches * 3000, output_tokens: 180, server_tool_use: { web_search_requests: searches } },
  });

  if (tools.includes("finish")) return tool("finish", { gave_up: true, reason: "mock: nothing more to find" });
  if (tools.includes("report_decision")) return tool("report_decision", { probabilities: (input.options ?? []).map((o) => ({ option: o, p: 1 / input.options.length })) });
  if (tools.includes("report_domain")) {
    const name = input.company ?? "";
    const domain = KNOWN[slug(name)] ?? (/ghost/i.test(name) ? null : `${slug(name)}.com`);
    return tool("report_domain", { domain, confidence: domain ? 0.92 : 0, source_url: domain ? `https://${domain}/` : null, alternatives: [] }, search(`${name} official site`, domain ? [`https://${domain}/`] : []), 1);
  }
  if (tools.includes("report_patterns")) {
    const domain = input.domain;
    const src = `https://rocketreach.co/${domain.split(".")[0]}-email-format`;
    // First call pauses mid-turn like a long server-tool loop; the function must resume it.
    if (msgs.length === 1) return { content: search(`"@${domain}" email format`, [src]), stop_reason: "pause_turn", usage: { input_tokens: 2500, output_tokens: 60, server_tool_use: { web_search_requests: 1 } } };
    return tool("report_patterns", { patterns: [{ template: "{first}.{last}", confidence: 0.72, source_url: src, evidence: [`jane.doe@${domain}`] }, { template: "{f}{last}", confidence: 0.14, source_url: src }] }, search(`${domain} email`, [src]), 1);
  }
  if (tools.includes("extract_contacts") && tools.includes("web_fetch")) {
    return tool("extract_contacts", { mode: "people", companies: [], people: [{ first: "Avery", last: "Quinn", title: input.role_filter?.split(",")[0] ?? "Head of Sales" }], urls: [], notes: "" }, search(`${input.company} leadership team`, [`https://${input.domain}/about`]), 1);
  }
  if (tools.includes("extract_contacts")) return tool("extract_contacts", extract(typeof input === "string" ? input : JSON.stringify(input)));
  return { content: [{ type: "text", text: "mock: no handler" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } };
}

createServer((req, res) => {
  let data = "";
  req.on("data", (c) => (data += c));
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(data);
    const out = { id: `msg_mock_${++id}`, type: "message", role: "assistant", model: body.model, stop_sequence: null, ...respond(body) };
    if (process.env.MOCK_LOG) console.log(body.model, (body.tools ?? []).map((t) => t.type ?? t.name).join(","), "→", out.stop_reason);
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log(`mock Anthropic API on http://localhost:${PORT}`));
