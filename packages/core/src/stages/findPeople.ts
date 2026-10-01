import type { Company, Contact, Ctx, StageResult } from "../types.ts";
import { isBlockedUrl } from "../validate.ts";
import { buildExtract } from "./classifyExtract.ts";
import { callLlm, done, fail, findCall } from "./util.ts";

/** Company-first add-on — fetch the team/leadership page and extract people matching the role filter. */
export async function findPeople(
  company: Company,
  roleFilter: string,
  ctx: Ctx,
  opts: { maxSearches?: number; maxFetches?: number } = {},
): Promise<StageResult<{ people: Contact[] }>> {
  if (!company.domain) return fail("no domain");
  const url = company.website && !isBlockedUrl(company.website) ? company.website : "";
  const { res, error } = await callLlm(ctx, {
    stage: "find_people",
    input: { company: company.name, domain: company.domain, url, role_filter: roleFilter },
    vars: { domain: company.domain, role_filter: roleFilter, company: company.name },
    maxSearches: opts.maxSearches ?? 2,
    maxFetches: opts.maxFetches ?? 3,
  });
  if (!res) return fail(error ?? "llm error");
  const call = findCall(res, "extract_contacts");
  if (!call) return fail("model did not return extract_contacts", res);
  // Everyone found belongs to this company regardless of what the model wrote.
  const people = (call.input?.people ?? []).map((p: any) => ({ ...p, company: undefined }));
  const ex = buildExtract({ people }, company);
  return done({ people: ex.people }, res);
}
