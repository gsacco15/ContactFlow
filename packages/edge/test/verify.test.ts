import { describe, expect, it } from "vitest";
import { VERIFY_PROVIDERS, mockVerify, parseVerifyBody } from "../supabase/functions/pipeline/lib.ts";

describe("verification providers", () => {
  it("ZeroBounce answers map to our statuses", () => {
    const read = VERIFY_PROVIDERS.zerobounce.read;
    expect(["valid", "invalid", "catch-all", "unknown", "spamtrap", "do_not_mail", undefined].map((status) => read({ status }))).toEqual(["valid", "invalid", "catch_all", "unverified", "risky", "risky", "unverified"]);
  });

  it("MillionVerifier answers map to our statuses", () => {
    const read = VERIFY_PROVIDERS.millionverifier.read;
    expect(["ok", "invalid", "catch_all", "disposable", "unknown", "error"].map((result) => read({ result }))).toEqual(["valid", "invalid", "catch_all", "risky", "unverified", "unverified"]);
  });

  it("the key and address are URL-encoded", () => {
    expect(VERIFY_PROVIDERS.zerobounce.url("a+b@acme.com", "k&y")).toContain("api_key=k%26y&email=a%2Bb%40acme.com");
    expect(VERIFY_PROVIDERS.millionverifier.url("a@acme.com", "k")).toContain("timeout=10");
    expect(VERIFY_PROVIDERS.millionverifier.url("a@acme.com", "k", 1)).toContain("timeout=30");
    expect(VERIFY_PROVIDERS.millionverifier.detail({ result: "unknown", subresult: "timeout", error: "" })).toBe("unknown/timeout");
    expect(VERIFY_PROVIDERS.millionverifier.detail({ result: "", error: "Insufficient credits" })).toBe("error: Insufficient credits");
  });

  it("the stand-in is predictable", () => {
    expect([mockVerify("jane.doe@acme.com"), mockVerify("jdoe@acme.com"), mockVerify("x@catchall-acme.com")]).toEqual(["valid", "invalid", "catch_all"]);
  });

  it("requests: 1–10 real-looking addresses, deduped", () => {
    expect(parseVerifyBody({ emails: ["A@Acme.com", "a@acme.com"] })).toEqual(["a@acme.com"]);
    expect(() => parseVerifyBody({ emails: [] })).toThrow("emails[] required");
    expect(() => parseVerifyBody({ emails: new Array(11).fill("a@acme.com") })).toThrow("at most 10");
    expect(() => parseVerifyBody({ emails: ["not an email"] })).toThrow("invalid email");
  });
});
