/**
 * The pipeline's choose / classify / score steps go through this interface so a
 * fast calibrated model (e.g. Jev) can replace Claude for decisions without touching
 * the rest. Everything generative stays on Claude regardless.
 */
export interface DecisionProvider {
  name: string;
  /** true only for providers that return calibrated probabilities. Gates the rescue score check. */
  calibrated: boolean;
  classify(labels: string[], context: string): Promise<Record<string, number>>; // label → probability
  choose(options: string[], context: string): Promise<{ index: number; probs: number[] }>;
  score(context: string, question: string): Promise<number>; // 0–1
  /** The same yes/no question asked about many items at once (one network round trip). */
  scoreMany(items: string[], question: string): Promise<ScoredItem[]>;
}

export type ScoredItem = { p: number; reason?: string };

export { ClaudeDecisions } from "./claude.ts";
export { JevDecisions, type JevTransport, type JevRequest, type JevResponse } from "./jev.ts";
