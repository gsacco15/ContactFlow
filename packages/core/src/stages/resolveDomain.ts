import type { Ctx, StageResult } from "../types.ts";
import { clamp01, cleanUrl, isAggregatorDomain, normalizeDomain } from "../validate.ts";
import { callLlm, done, fail, findCall } from "./util.ts";

export type DomainResult = { domain: string | null; confidence: number; source_url?: string; alternatives: string[] };

/** Stage 2 — one web search for "<company> official site"; rejects aggregators. */
export async function resolveDomain(
  company: { name: string; hint?: string },
  ctx: Ctx,
  opts: { maxSearches?: number } = {},
): Promise<StageResult<DomainResult>> {
  const { res, error } = await callLlm(ctx, {
    stage: "resolve_domain",
    input: { company: company.name, hint: company.hint ?? "" },
    maxSearches: opts.maxSearches ?? 2,
  });
  if (!res) return fail(error ?? "llm error");
  const call = findCall(res, "report_domain");
  if (!call) return fail("model did not return report_domain", res);

  const alternatives = (Array.isArray(call.input?.alternatives) ? call.input.alternatives : [])
    .map(normalizeDomain)
    .filter((d: string | null): d is string => !!d && !isAggregatorDomain(d));
  let domain = normalizeDomain(call.input?.domain);
  let confidence = clamp01(call.input?.confidence);
  if (domain && isAggregatorDomain(domain)) {
    domain = alternatives.shift() ?? null;
    confidence = Math.min(confidence, 0.4);
  }
  const source_url = cleanUrl(call.input?.source_url);
  const data: DomainResult = { domain, confidence: domain ? confidence : 0, alternatives };
  if (source_url) data.source_url = source_url;
  return done(data, res, { confidence: data.confidence, sources: source_url ? [source_url] : res.sources });
}
