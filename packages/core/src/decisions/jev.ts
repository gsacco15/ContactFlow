import type { UsageEvent } from "../types.ts";
import type { DecisionProvider, ScoredItem } from "./index.ts";

// TypeSafe Jev (System One): state + typed questions → calibrated answers.
// https://docs.typesafe.ai — POST /v1/systemone. The key lives in the edge function; the
// browser sends a batch of requests to its /jev route, which fans them out.

export type JevQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevRequest = { state: string; questions: Record<string, JevQuestion> };
export type JevAnswer = { type: string; noul?: number; choice?: string; score?: number; confidence?: number; probabilities?: Record<string, number> };
export type JevResponse = { answers: Record<string, JevAnswer>; usage?: { input_tokens: number; output_tokens: number }; model?: string };

/** Sends a batch of System One requests (through the edge function) and returns answers in order. */
export type JevTransport = (requests: JevRequest[]) => Promise<JevResponse[]>;

const clamp = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
// Jev option keys: keep them simple identifiers, map back to the caller's labels.
const keys = (labels: string[]) => labels.map((_, i) => `o${i}`);

export class JevDecisions implements DecisionProvider {
  name = "jev";
  calibrated = true;
  constructor(private send: JevTransport, private onUsage?: (u: UsageEvent) => void) {}

  private async run(requests: JevRequest[]): Promise<JevResponse[]> {
    const out = await this.send(requests);
    const usage = out.reduce((a, r) => ({ i: a.i + (r.usage?.input_tokens ?? 0), o: a.o + (r.usage?.output_tokens ?? 0) }), { i: 0, o: 0 });
    this.onUsage?.({ stage: "decide", model: out[0]?.model ?? "jev", input_tokens: usage.i, output_tokens: usage.o, web_search_requests: 0, web_fetch_requests: 0 });
    return out;
  }

  async score(context: string, question: string): Promise<number> {
    const [r] = await this.run([{ state: context, questions: { q: { type: "noul", instructions: question } } }]);
    return clamp(r?.answers?.q?.noul);
  }

  async scoreMany(items: string[], question: string): Promise<ScoredItem[]> {
    if (!items.length) return [];
    const out = await this.run(items.map((state) => ({ state, questions: { q: { type: "noul", instructions: question } } })));
    return items.map((_, i) => ({ p: clamp(out[i]?.answers?.q?.noul) }));
  }

  async classify(labels: string[], context: string) {
    const k = keys(labels);
    const [r] = await this.run([
      { state: context, questions: { q: { type: "choice", instructions: "Which label fits best?", criteria: Object.fromEntries(k.map((key, i) => [key, labels[i]])) } } },
    ]);
    const probs = r?.answers?.q?.probabilities ?? {};
    return Object.fromEntries(labels.map((l, i) => [l, clamp(probs[k[i]] ?? 0)]));
  }

  async choose(options: string[], context: string) {
    const p = await this.classify(options, context);
    const probs = options.map((o) => p[o]);
    return { index: probs.indexOf(Math.max(...probs)), probs };
  }
}
