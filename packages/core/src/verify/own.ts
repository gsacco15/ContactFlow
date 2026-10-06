/**
 * People's own addresses — pasted next to them, or read from their profile page — checked once
 * each when "Verify emails" is on. Valid or accept-all: kept, with that result. A bounce: dropped,
 * so the person goes through the normal lookup (the firm's format) and the row says why. A checker
 * that is down or a stand-in (demo) answer changes nothing: a good address is never lost to an outage.
 */
import { VERIFY_LIMITS } from "../config.ts";
import { cleanEmail } from "../paste.ts";
import type { Contact, Ctx, VerifyStatus } from "../types.ts";
import { autoVerify } from "./company.ts";

export async function checkOwnEmails(people: Contact[], ctx: Ctx): Promise<Set<Contact>> {
  const bounced = new Set<Contact>();
  if (!autoVerify(ctx) || !ctx.mailbox || ctx.options?.usePasteEvidence === false) return bounced;
  const own = people.filter((p) => cleanEmail(p.email) && !p.email_status).slice(0, VERIFY_LIMITS.ownPerRun);
  const emails = [...new Set(own.map((p) => cleanEmail(p.email)!))];
  const status: Record<string, VerifyStatus> = {};
  let checks = 0;
  for (let i = 0; i < emails.length; i += VERIFY_LIMITS.ownBatch) {
    if (ctx.signal?.aborted) break;
    const batch = emails.slice(i, i + VERIFY_LIMITS.ownBatch);
    try {
      Object.assign(status, await ctx.mailbox.check(batch));
      checks += batch.length;
    } catch {
      break; // checker down: keep every address as it is
    }
  }
  if (checks) ctx.onUsage?.({ stage: "verify", model: `verifier:${ctx.mailbox.name}`, input_tokens: 0, output_tokens: 0, web_search_requests: 0, web_fetch_requests: 0, verifications: checks });
  // The client learns whether the checker is real from its first answer; demo answers change nothing.
  if (!ctx.mailbox.real) return bounced;
  for (const p of own) {
    const s = status[cleanEmail(p.email)!];
    if (!s || s === "unverified") continue;
    if (s !== "invalid") {
      p.email_status = s;
      continue;
    }
    p.bounced_email = cleanEmail(p.email);
    delete p.email;
    delete p.email_source;
    delete p.email_source_url;
    delete p.email_status;
    bounced.add(p);
  }
  return bounced;
}
