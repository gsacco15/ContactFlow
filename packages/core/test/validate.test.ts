import { describe, expect, it } from "vitest";
import { isAggregatorDomain, isBlockedUrl, normalizeDomain, validatePatterns } from "../src/index.ts";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Acme.com/about?x=1", "acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    ["mailto:jane@acme.io", "acme.io"],
    ["www2.foo-bar.dev:8080/", "foo-bar.dev"],
    ["not a domain", null],
    ["", null],
    [null, null],
  ])("%s → %s", (input, want) => expect(normalizeDomain(input as any)).toBe(want));
});

describe("aggregators and blocked pages", () => {
  it("rejects aggregators including subdomains", () => {
    expect(isAggregatorDomain("linkedin.com")).toBe(true);
    expect(isAggregatorDomain("uk.linkedin.com")).toBe(true);
    expect(isAggregatorDomain("en.wikipedia.org")).toBe(true);
    expect(isAggregatorDomain("stripe.com")).toBe(false);
  });
  it("never fetches LinkedIn or data-vendor pages", () => {
    expect(isBlockedUrl("https://www.linkedin.com/company/stripe/people")).toBe(true);
    expect(isBlockedUrl("https://rocketreach.co/stripe-email-format_b5c")).toBe(true);
    expect(isBlockedUrl("https://stripe.com/about")).toBe(false);
  });
});

describe("validatePatterns", () => {
  it("drops templates outside the union, clamps, sorts, caps at 3", () => {
    const out = validatePatterns(
      [
        { template: "{first}.{last}", confidence: 1.4, source_url: "https://rocketreach.co/x" },
        { template: "{firstname}.{lastname}", confidence: 0.9 },
        { template: "{f}{last}", confidence: 0.2, evidence: ["JDOE@acme.com", "x@other.com", "junk"] },
        { template: "{first}", confidence: 0.3, source_url: "javascript:alert(1)" },
        { template: "{last}", confidence: 0.1 },
        { template: "{first}.{last}", confidence: 0.5 },
      ],
      "acme.com",
    );
    expect(out).toEqual([
      { template: "{first}.{last}", confidence: 1, source_url: "https://rocketreach.co/x" },
      { template: "{first}", confidence: 0.3 },
      { template: "{f}{last}", confidence: 0.2, evidence: ["jdoe@acme.com"] },
    ]);
  });
  it("non-arrays give []", () => expect(validatePatterns("first.last")).toEqual([]));
});
