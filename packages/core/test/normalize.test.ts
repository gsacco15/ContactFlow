import { describe, expect, it } from "vitest";
import { cleanDisplayName, nicknameVariant, normalizeName, slug } from "../src/index.ts";

describe("normalizeName", () => {
  it.each([
    ["José Álvarez-Ruiz", { first: "jose", last: "alvarezruiz", lastAlt: "alvarez" }],
    ["Mary Anne O'Brien", { first: "mary", middle: "a", last: "obrien" }],
    ["Dr. Li Wei PhD", { first: "li", last: "wei" }],
    ["Bob Smith Jr.", { first: "bob", last: "smith" }],
    ["Jean-Luc Picard", { first: "jeanluc", last: "picard" }],
  ])("%s", (raw, want) => {
    expect(normalizeName(raw)).toEqual(want);
  });

  it("strips credentials after a comma, pronouns, emoji and badges", () => {
    expect(normalizeName("José Álvarez-Ruiz, MBA")).toEqual({ first: "jose", last: "alvarezruiz", lastAlt: "alvarez" });
    expect(normalizeName("Priya Raman (She/Her)")).toEqual({ first: "priya", last: "raman" });
    expect(normalizeName("Hannah Liebermann 🚀")).toEqual({ first: "hannah", last: "liebermann" });
    expect(normalizeName("Aisha Bello • 2nd")).toEqual({ first: "aisha", last: "bello" });
    expect(normalizeName("Robert \"Bob\" Jones she/her")).toEqual({ first: "robert", last: "jones" });
  });

  it("handles letters NFD cannot decompose and surname particles", () => {
    expect(normalizeName("Søren Kierkegaard")).toEqual({ first: "soren", last: "kierkegaard" });
    expect(normalizeName("Łukasz Weiß")).toEqual({ first: "lukasz", last: "weiss" });
    expect(normalizeName("Ludwig van Beethoven")).toEqual({ first: "ludwig", last: "vanbeethoven", lastAlt: "beethoven" });
  });

  it("single names have an empty last", () => {
    expect(normalizeName("Madonna")).toEqual({ first: "madonna", last: "" });
  });
});

describe("helpers", () => {
  it("cleanDisplayName", () => {
    expect(cleanDisplayName("Hannah Liebermann 🚀 • 2nd")).toBe("Hannah Liebermann");
  });
  it("slug drops legal suffixes", () => {
    expect(slug("Acme, Inc.")).toBe("acme");
    expect(slug("Beta Corp")).toBe("beta");
    expect(slug("Société Générale")).toBe("societe-generale");
  });
  it("nicknames map both ways", () => {
    expect(nicknameVariant("bob")).toBe("robert");
    expect(nicknameVariant("robert")).toBe("bob");
    expect(nicknameVariant("zelda")).toBeUndefined();
  });
});
