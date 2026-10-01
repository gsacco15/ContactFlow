import { describe, expect, it } from "vitest";
import { DEFAULT_PATTERNS, generateCandidates, normalizeName, patternLabel, type Pattern } from "../src/index.ts";

const emails = (c: { email: string }[]) => c.map((x) => x.email);

describe("generateCandidates", () => {
  it("uses statistical defaults when no pattern was found", () => {
    const c = generateCandidates(normalizeName("Jane Doe"), "acme.com", []);
    expect(emails(c)).toEqual(["jane.doe@acme.com", "jane@acme.com", "jdoe@acme.com"]);
    expect(c.map((x) => x.rank)).toEqual([1, 2, 3]);
    expect(c.every((x) => x.verify_status === "unverified")).toBe(true);
    expect(c.map((x) => x.pattern)).toEqual(DEFAULT_PATTERNS.map((p) => p.template));
  });

  it("ranks found patterns by confidence, then fills with defaults", () => {
    const patterns: Pattern[] = [
      { template: "{f}{last}", confidence: 0.3, source_url: "https://a" },
      { template: "{first}_{last}", confidence: 0.8, source_url: "https://b" },
    ];
    expect(emails(generateCandidates(normalizeName("Jane Doe"), "acme.com", patterns))).toEqual([
      "jane_doe@acme.com",
      "jdoe@acme.com",
      "jane.doe@acme.com",
    ]);
  });

  it("tries hyphenated surnames joined and first-part", () => {
    const c = generateCandidates(normalizeName("José Álvarez-Ruiz"), "notion.so", [{ template: "{first}.{last}", confidence: 0.9 }]);
    expect(emails(c)).toEqual(["jose.alvarezruiz@notion.so", "jose.alvarez@notion.so", "jose@notion.so"]);
  });

  it("caps at 3 and dedupes", () => {
    const patterns: Pattern[] = ["{first}.{last}", "{first}{last}", "{f}{last}", "{first}"].map((t, i) => ({ template: t as any, confidence: 1 - i / 10 }));
    const c = generateCandidates(normalizeName("Li Wei"), "x.com", patterns);
    expect(c).toHaveLength(3);
    expect(new Set(emails(c)).size).toBe(3);
  });

  it("skips templates that need a missing last name", () => {
    expect(emails(generateCandidates(normalizeName("Madonna"), "x.com", []))).toEqual(["madonna@x.com"]);
  });

  it("nickname variant only when enabled, ahead of statistical fill", () => {
    const p: Pattern[] = [{ template: "{first}.{last}", confidence: 0.9 }];
    expect(emails(generateCandidates(normalizeName("Bob Smith Jr."), "figma.com", p))).toEqual([
      "bob.smith@figma.com",
      "bob@figma.com",
      "bsmith@figma.com",
    ]);
    expect(emails(generateCandidates(normalizeName("Bob Smith Jr."), "figma.com", p, { nicknames: true }))).toEqual([
      "bob.smith@figma.com",
      "robert.smith@figma.com",
      "bob@figma.com",
    ]);
  });

  it("patternLabel", () => {
    expect(patternLabel("{first}.{last}")).toBe("first.last");
  });
});
