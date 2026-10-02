/**
 * Verification per company, cheapest first (v2 build sheet §1):
 *   1. Evidence already proves the format (an earlier mailbox check) → nothing to check.
 *   2. Evidence says the server accepts any address (catch-all) → checks can't prove anything.
 *   3. Otherwise check ONE person's emails in order (≤ VERIFY_LIMITS.perCompany):
 *      valid → the format is proven for the whole firm · invalid → try their next email ·
 *      catch-all → stop.
 * Every real result is recorded as evidence, so the next run (any user) needs no check.
 */
import { EVIDENCE_MODE, VERIFIED_CONFIDENCE, VERIFY_LIMITS, VERIFY_MODE } from "../config.ts";
import type { Company, Contact, Ctx, Pattern, Template, VerifyStatus } from "../types.ts";
import { evidenceFromVerification, scoreEvidence } from "../evidence.ts";

export type VerifyOutcome = { checks: number; verified?: Template; catch_all?: boolean; statuses: Record<string, VerifyStatus> };

/** Automatic checks need "auto"; a click (Verify / Verify all) works in "button" or "auto". */
const verifyOn = (ctx: Ctx, clicked: boolean) => {
  const mode = ctx.options?.verifyMode ?? VERIFY_MODE;
  return !!ctx.mailbox && (mode === "auto" || (clicked && mode === "button"));
};

/**
 * Who to check: the person asked for, else the one with the longest name (fewest collisions like
 * jsmith2@). Rows with only backup guesses count too — cracking firms with no published format is
 * where checks help most.
 */
function sample(contacts: Contact[]): Contact | undefined {
  return contacts
    .filter((c) => (c.status === "ok" || c.status === "no_pattern") && c.first && c.last && c.candidates.some((x) => x.basis !== "seen"))
    .sort((a, b) => `${b.first}${b.last}`.length - `${a.first}${a.last}`.length)[0];
}

/**
 * Check this company's format with as few mailbox checks as possible, then rebuild everyone's
 * emails around the result. `rebuild` re-runs candidate generation for one contact (applyCompany).
 * Pass `person` to check that row specifically (the Verify button).
 */
export async function verifyCompany(
  co: Company,
  contacts: Contact[],
  ctx: Ctx,
  rebuild: (c: Contact) => Promise<void>,
  opts: { person?: Contact; clicked?: boolean } = {},
): Promise<VerifyOutcome> {
  const out: VerifyOutcome = { checks: 0, statuses: {} };
  if (!verifyOn(ctx, !!opts.clicked) || !co.domain || co.mx_ok === false) return out;
  const domain = co.domain;
  const evMode = ctx.evidence ? (ctx.options?.evidenceMode ?? EVIDENCE_MODE) : "off";

  // 1–2: what earlier checks already proved (any user, any run).
  if (ctx.evidence && !opts.person) {
    const v = scoreEvidence(domain, await ctx.evidence.forDomain(domain).catch(() => []));
    if (v.catch_all) return markCatchAll(co, contacts, out);
    if (v.strong && v.best?.kinds.includes("verifier_valid")) {
      out.verified = v.best.template;
      co.verified_by = "earlier check";
      await prove(co, contacts, v.best.template, rebuild, out);
      return out;
    }
  }

  // 3: check one person's emails, best first.
  const who = opts.person ?? sample(contacts);
  if (!who) return out;
  const tryList = who.candidates.filter((x) => x.basis !== "seen").slice(0, VERIFY_LIMITS.perCompany);
  const invalid: Template[] = [];
  for (const cand of tryList) {
    if (ctx.signal?.aborted) break;
    let status: VerifyStatus;
    try {
      status = (await ctx.mailbox!.check([cand.email]))[cand.email] ?? "unverified";
    } catch {
      break; // provider down: keep what we have, never block the run
    }
    out.checks++;
    out.statuses[cand.email] = status;
    const template = co.patterns.find((p) => p.template === cand.pattern)?.template ?? (cand.pattern as Template);
    if (ctx.mailbox!.real && evMode !== "off" && cand.pattern !== "pasted") {
      await ctx.evidence!.record(evidenceFromVerification(domain, template, status)).catch(() => {});
    }
    if (status === "valid") {
      out.verified = template;
      break;
    }
    if (status === "catch_all") {
      out.catch_all = true;
      break;
    }
    if (status === "invalid") invalid.push(template);
  }
  if (out.checks) co.verified_by = ctx.mailbox!.name;
  ctx.onUsage?.({ stage: "verify", model: `verifier:${ctx.mailbox!.name}`, input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0, verifications: out.checks });

  if (out.catch_all) return markCatchAll(co, contacts, out);
  if (out.verified) await prove(co, contacts, out.verified, rebuild, out);
  else if (invalid.length) {
    // Formats that failed for this person drop to the bottom for everyone.
    co.patterns = [...co.patterns.filter((p) => !invalid.includes(p.template)), ...co.patterns.filter((p) => invalid.includes(p.template)).map((p) => ({ ...p, confidence: p.confidence * 0.3 }))];
    for (const c of contacts) await rebuild(c);
  }
  applyStatuses(contacts, out.statuses);
  return out;
}

/** The format is proven at this company: put it first, mark it, rebuild everyone's emails. */
async function prove(co: Company, contacts: Contact[], template: Template, rebuild: (c: Contact) => Promise<void>, out: VerifyOutcome) {
  const had = co.patterns.find((p) => p.template === template);
  const proven: Pattern = { ...(had ?? { template }), template, confidence: VERIFIED_CONFIDENCE, verified: true, stated: false };
  co.patterns = [proven, ...co.patterns.filter((p) => p.template !== template)].slice(0, 3);
  co.format_verified = template;
  delete co.catch_all;
  for (const c of contacts) await rebuild(c);
  applyStatuses(contacts, out.statuses);
}

function markCatchAll(co: Company, contacts: Contact[], out: VerifyOutcome): VerifyOutcome {
  co.catch_all = true;
  out.catch_all = true;
  for (const c of contacts) for (const x of c.candidates) if (x.basis !== "seen") x.verify_status = "catch_all";
  return out;
}

/** Put check results back on the rebuilt candidates; a valid address becomes the person's primary. */
function applyStatuses(contacts: Contact[], statuses: Record<string, VerifyStatus>) {
  for (const c of contacts) {
    let touched = false;
    for (const x of c.candidates) {
      const s = statuses[x.email];
      if (s) (x.verify_status = s), (touched = true);
    }
    if (!touched) continue;
    const valid = c.candidates.find((x) => x.verify_status === "valid");
    const usable = c.candidates.find((x) => x.verify_status !== "invalid" && x.basis !== "guess") ?? c.candidates.find((x) => x.verify_status !== "invalid");
    c.primary_email = (valid ?? usable ?? c.candidates[0])?.email;
  }
}
