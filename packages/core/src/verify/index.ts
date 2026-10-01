import type { VerifyStatus } from "../types.ts";

export interface Verifier {
  name: string;
  verify(emails: string[]): Promise<Record<string, VerifyStatus>>;
  /** Domain-level liveness check (MX). Optional; undefined result = unknown. */
  domainLive?(domain: string): Promise<boolean | undefined>;
}

/**
 * v1 verifier: DNS MX lookup per domain (via the edge function's /mx route).
 * It can only tell that a domain accepts mail at all, so live domains leave every
 * candidate "unverified" and dead domains mark them "invalid". Never "valid".
 */
export class MxVerifier implements Verifier {
  name = "mx";
  private memo = new Map<string, Promise<boolean | undefined>>();
  constructor(private lookup: (domain: string) => Promise<boolean>) {}

  domainLive(domain: string): Promise<boolean | undefined> {
    let p = this.memo.get(domain);
    if (!p) {
      p = this.lookup(domain).catch(() => undefined);
      this.memo.set(domain, p);
    }
    return p;
  }

  async verify(emails: string[]) {
    const out: Record<string, VerifyStatus> = {};
    for (const e of emails) {
      const live = await this.domainLive(e.split("@")[1] ?? "");
      out[e] = live === false ? "invalid" : "unverified";
    }
    return out;
  }
}

// NeverBounceVerifier / ZeroBounceVerifier / HunterVerifier are drop-ins behind the same
// interface (v2). They need a paid key, so they belong in the edge function, not here.
