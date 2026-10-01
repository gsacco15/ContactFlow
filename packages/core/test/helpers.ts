import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_BUDGET, memoryCache, type Ctx, type LlmRequest, type LlmResponse, type StageName, type ToolCall } from "../src/index.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
export const fixture = (name: string) => readFileSync(`${root}fixtures/${name}.txt`, "utf8");
export const expected = (name: string) => JSON.parse(readFileSync(`${root}fixtures/expected/${name}.json`, "utf8"));
export const recorded = (name: string) => JSON.parse(readFileSync(`${root}fixtures/recorded/${name}.json`, "utf8"));

let n = 0;
/** Build an LlmResponse whose only tool call is `name(input)`. */
export function toolResponse(name: string, input: unknown, usage: Partial<LlmResponse["usage"]> = {}): LlmResponse {
  const call: ToolCall = { id: `toolu_${++n}`, name, input };
  return {
    content: [{ type: "tool_use", ...call }],
    toolCalls: [call],
    sources: [],
    usage: { input_tokens: 100, output_tokens: 20, web_search_requests: 0, web_fetch_requests: 0, ...usage },
    model: "claude-sonnet-5-5",
    stop_reason: "tool_use",
  };
}

export const finish = (input: unknown) => toolResponse("finish", input);

type Handler = LlmResponse | ((req: LlmRequest, i: number) => LlmResponse | Promise<LlmResponse>);

/** Ctx with a scripted llm. Unscripted stages throw so tests notice unexpected calls. */
export function mockCtx(script: Partial<Record<StageName | "rescue", Handler | Handler[]>>, over: Partial<Ctx> = {}) {
  const calls: LlmRequest[] = [];
  const counts: Record<string, number> = {};
  const llm = async (req: LlmRequest): Promise<LlmResponse> => {
    calls.push(req);
    const key = req.stage === "rescue_agent" ? (script.rescue_agent ? "rescue_agent" : "rescue") : req.stage;
    const i = (counts[key] = (counts[key] ?? -1) + 1);
    let h = script[key as StageName];
    if (Array.isArray(h)) h = h[Math.min(i, h.length - 1)];
    if (!h) throw new Error(`unexpected llm call: ${req.stage}`);
    return typeof h === "function" ? h(req, i) : h;
  };
  const ctx: Ctx = {
    llm,
    cache: memoryCache(),
    decisions: { name: "none", calibrated: false, classify: async () => ({}), choose: async () => ({ index: 0, probs: [] }), score: async () => 1 },
    budget: { ...DEFAULT_BUDGET },
    ...over,
  };
  return { ctx, calls };
}

/** The tool input stage 1 would return for the mixed_notes fixture. */
export const mixedNotesExtract = {
  mode: "mixed",
  companies: [{ name: "Acme", website: "acme.com" }, { name: "Beta Corp", role_hint: "CFO" }],
  people: [{ first: "Jane", last: "Doe", title: "VP Sales", company: "Acme", raw: "Jane Doe, VP Sales" }],
  urls: [],
  notes: "",
};
