import type { Ctx } from "../types.ts";
import type { DecisionProvider, ScoredItem } from "./index.ts";
import { callLlm, findCall } from "../stages/util.ts";

type Llm = Pick<Ctx, "llm" | "onUsage" | "signal">;

/** v1 decision provider: one `report_decision` tool call per method. Not calibrated. */
export class ClaudeDecisions implements DecisionProvider {
  name = "claude";
  calibrated = false;
  constructor(private ctx: Llm) {}

  private async probs(options: string[], context: string, question: string): Promise<number[]> {
    const { res } = await callLlm(this.ctx as Ctx, { stage: "decide", input: { question, options, context } });
    const raw = res && findCall(res, "report_decision")?.input?.probabilities;
    const out = options.map((o) => {
      const hit = Array.isArray(raw) ? raw.find((r: any) => r?.option === o) : undefined;
      return typeof hit?.p === "number" && hit.p >= 0 ? hit.p : 0;
    });
    const sum = out.reduce((a, b) => a + b, 0);
    return sum > 0 ? out.map((p) => p / sum) : options.map(() => 1 / options.length);
  }

  async classify(labels: string[], context: string) {
    const p = await this.probs(labels, context, "Which label fits best?");
    return Object.fromEntries(labels.map((l, i) => [l, p[i]]));
  }

  async choose(options: string[], context: string) {
    const probs = await this.probs(options, context, "Which option is correct?");
    return { index: probs.indexOf(Math.max(...probs)), probs };
  }

  async score(context: string, question: string) {
    const [yes] = await this.probs(["yes", "no"], context, question);
    return yes;
  }

  /** One `judge` call for the whole list (Haiku-class model, with a short reason per item). */
  async scoreMany(items: string[], question: string): Promise<ScoredItem[]> {
    if (!items.length) return [];
    const { res } = await callLlm(this.ctx as Ctx, {
      stage: "judge",
      input: { question, items: items.map((text, id) => ({ id, text })) },
      vars: { question },
    });
    const raw = res && findCall(res, "report_judgements")?.input?.items;
    return items.map((_, id) => {
      const hit = Array.isArray(raw) ? raw.find((r: any) => r?.id === id) : undefined;
      const p = typeof hit?.p === "number" ? Math.min(1, Math.max(0, hit.p)) : 0.5;
      return typeof hit?.reason === "string" && hit.reason ? { p, reason: hit.reason.slice(0, 140) } : { p };
    });
  }
}
