import type { Ctx, Pattern, StageResult } from "../types.ts";
import { validatePatterns } from "../validate.ts";
import { callLlm, done, fail, findCall } from "./util.ts";

/** Stage 3 — 2–3 searches for the domain's email format; reads RocketReach/SignalHire-style snippets. */
export async function discoverPattern(
  domain: string,
  ctx: Ctx,
  opts: { maxSearches?: number } = {},
): Promise<StageResult<{ patterns: Pattern[] }>> {
  const { res, error } = await callLlm(ctx, {
    stage: "discover_pattern",
    input: { domain },
    vars: { domain },
    maxSearches: opts.maxSearches ?? 3,
  });
  if (!res) return fail(error ?? "llm error");
  const call = findCall(res, "report_patterns");
  if (!call) return fail("model did not return report_patterns", res);
  const patterns = validatePatterns(call.input?.patterns, domain);
  const sources = patterns.map((p) => p.source_url).filter((u): u is string => !!u);
  return done({ patterns }, res, { confidence: patterns[0]?.confidence ?? 0, sources: sources.length ? [...new Set(sources)] : res.sources });
}
