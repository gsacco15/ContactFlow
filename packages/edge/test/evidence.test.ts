import { describe, expect, it } from "vitest";
import { evidenceRow } from "../supabase/functions/pipeline/lib.ts";

const ok = { domain: "Acme.com", kind: "site_email", template: "{f}{last}", outcome: "supports", count: 2, source_url: "https://acme.com/team?ref=x#a", source_name: "their site", observed_at: "2026-10-01T00:00:00Z", scope: "global" };

describe("evidenceRow (what the server will store)", () => {
  it("keeps a clean domain-level row", () => {
    expect(evidenceRow(ok)).toEqual({ domain: "acme.com", kind: "site_email", template: "{f}{last}", outcome: "supports", strength: null, count: 2, source_url: "https://acme.com/team", source_name: "their site", observed_at: "2026-10-01T00:00:00.000Z" });
  });

  it("drops private, malformed or unknown rows", () => {
    expect(evidenceRow({ ...ok, scope: "private" })).toBeUndefined();
    expect(evidenceRow({ ...ok, kind: "gossip" })).toBeUndefined();
    expect(evidenceRow({ ...ok, template: "{nickname}" })).toBeUndefined();
    expect(evidenceRow({ ...ok, outcome: "maybe" })).toBeUndefined();
    expect(evidenceRow({ ...ok, domain: "jane@acme.com" })).toBeUndefined();
    expect(evidenceRow(null)).toBeUndefined();
  });

  it("never keeps anything with an address in it; clamps numbers; no future dates", () => {
    const r = evidenceRow({ ...ok, source_url: "mailto:jane@acme.com", source_name: "jane@acme.com", strength: 9, count: 1e6, observed_at: "2999-01-01" })!;
    expect(r.source_url).toBeNull();
    expect(r.source_name).toBeNull();
    expect(r.strength).toBe(1);
    expect(r.count).toBe(100);
    expect(new Date(r.observed_at).getFullYear()).toBeLessThan(2999);
  });
});
