import type { Ctx, LlmRequest, LlmResponse, StageResult, ToolCall } from "../types.ts";

export type Called = { res?: LlmResponse; error?: string };

/** Every LLM call goes through here so usage is reported exactly once per call. */
export async function callLlm(ctx: Ctx, req: LlmRequest): Promise<Called> {
  if (ctx.signal?.aborted) return { error: "aborted" };
  try {
    const res = await ctx.llm(req);
    ctx.onUsage?.({ stage: req.stage, model: res.model, ...res.usage });
    return { res };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function findCall(res: LlmResponse, name: string): ToolCall | undefined {
  return res.toolCalls.find((c) => c.name === name);
}

export function tokens(res?: LlmResponse): number {
  return res ? res.usage.input_tokens + res.usage.output_tokens : 0;
}

export function searches(res?: LlmResponse): number {
  return res ? res.usage.web_search_requests : 0;
}

export function fail<T>(error: string, res?: LlmResponse): StageResult<T> {
  return { ok: false, sources: res?.sources ?? [], tokens_used: tokens(res), searches_used: searches(res), error };
}

export function done<T>(data: T, res: LlmResponse, extra: { confidence?: number; sources?: string[] } = {}): StageResult<T> {
  return {
    ok: true,
    data,
    confidence: extra.confidence,
    sources: extra.sources ?? res.sources,
    tokens_used: tokens(res),
    searches_used: searches(res),
  };
}
