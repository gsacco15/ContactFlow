import { describe, expect, it } from "vitest";
import { buildExtract } from "@cf/core";
import { initialState, listedRows, migrate, persistable, reducer, searchNames, tableRows, type Search } from "../src/state.ts";

const search = (id: string, want = ""): Search => ({ id, label: id, want, at: "2026-10-02T02:00:00Z", cost: 0 });

const ex = buildExtract({
  mode: "people",
  companies: [{ name: "Acme", website: "acme.com" }],
  people: [
    { first: "Jane", last: "Doe", company: "Acme" },
    { first: "John", last: "Roe", company: "Acme" },
  ],
});

describe("reducer", () => {
  it("parse → preview → run fills pending rows; rows update live", () => {
    let s = reducer(initialState("s1"), { type: "input", input: "x" });
    s = reducer(s, { type: "parsed", extracted: ex });
    expect(s.showPreview).toBe(true);
    s = reducer(s, { type: "run_start", extracted: ex, limit: 1, search: search("a") });
    expect(s.showPreview).toBe(false);
    expect(s.order).toEqual(["jane-doe-acme"]);
    expect(s.contacts["jane-doe-acme"].status).toBe("pending");
    s = reducer(s, { type: "row", contact: { ...s.contacts["jane-doe-acme"], status: "ok" } });
    s = reducer(s, { type: "row", contact: { ...ex.people[1], status: "ok" } });
    expect(s.order).toEqual(["jane-doe-acme", "john-roe-acme"]);
    s = reducer(s, { type: "usage", tokens: 1000, searches: 2, cost: 0.03 });
    s = reducer(s, { type: "usage", tokens: 500, searches: 1, cost: 0.01 });
    expect(s.usage).toEqual({ tokens: 1500, searches: 3, cost: 0.04, calls: 2 });
    s = reducer(s, { type: "run_end" });
    expect(s.running).toBe(false);
  });

  it("each run adds a search; earlier rows stay, a person found twice is one row", () => {
    const beta = buildExtract({ mode: "people", companies: [{ name: "Beta", website: "beta.com" }, { name: "Acme", website: "acme.com" }], people: [{ first: "Ann", last: "Lee", company: "Beta" }, { first: "Jane", last: "Doe", company: "Acme" }] });
    let s = reducer(initialState("s1"), { type: "run_start", extracted: ex, search: search("a") });
    s = reducer(s, { type: "row", contact: { ...s.contacts["jane-doe-acme"], status: "ok" } });
    s = reducer(s, { type: "usage", tokens: 1, searches: 1, cost: 0.1 });
    s = reducer(s, { type: "run_end" });
    s = reducer(s, { type: "run_start", extracted: beta, search: search("b"), skip: ["jane-doe-acme"] });
    expect(s.order).toEqual(["jane-doe-acme", "john-roe-acme", "ann-lee-beta"]);
    expect(s.contacts["jane-doe-acme"].status).toBe("ok"); // already had an email: not reset
    expect(s.rowSearches["jane-doe-acme"]).toEqual(["a", "b"]);
    expect(s.searches.map((x) => x.cost)).toEqual([0.1, 0]);
    // newest search first
    expect(listedRows(s).map((c) => c.id)).toEqual(["jane-doe-acme", "ann-lee-beta", "john-roe-acme"]);
    expect(searchNames(s, s.contacts["jane-doe-acme"])).toMatch(/^a · .* \| b · /);

    s = reducer(s, { type: "search_toggle", id: "b", hidden: true });
    expect(listedRows(s).map((c) => c.id)).toEqual(["jane-doe-acme", "john-roe-acme"]);
    s = reducer(s, { type: "search_only", id: "b" });
    expect(listedRows(s).map((c) => c.id)).toEqual(["jane-doe-acme", "ann-lee-beta"]);
    s = reducer(s, { type: "search_remove", id: "a" });
    expect(s.order).toEqual(["jane-doe-acme", "ann-lee-beta"]); // Jane stays: search b found her too
    expect(Object.keys(s.companies).sort()).toEqual(["acme", "beta"]);
  });

  it("a later search does not wipe what an earlier one learned about a company", () => {
    let s = reducer(initialState("s1"), { type: "run_start", extracted: ex, search: search("a") });
    s = reducer(s, { type: "company", company: { ...ex.companies[0], domain: "acme.com", patterns: [{ template: "{f}{last}", confidence: 0.9, source_url: "https://x" }] } });
    s = reducer(s, { type: "run_end" });
    s = reducer(s, { type: "run_start", extracted: ex, search: search("b", "partners"), skip: ["jane-doe-acme", "john-roe-acme"] });
    expect(s.companies.acme.domain).toBe("acme.com");
    expect(s.companies.acme.patterns).toHaveLength(1);
  });

  it("running the same paste again refreshes its search instead of adding a copy", () => {
    let s = reducer(initialState("s1"), { type: "run_start", extracted: ex, search: search("a", "partners") });
    s = reducer(s, { type: "run_end" });
    s = reducer(s, { type: "search_all", hidden: true });
    s = reducer(s, { type: "run_start", extracted: ex, search: { ...search("b", "partners"), at: "2026-10-03T00:00:00Z" } });
    expect(s.searches.map((x) => [x.id, x.at, x.hidden])).toEqual([["a", "2026-10-03T00:00:00Z", undefined]]);
    s = reducer(s, { type: "run_end" });
    s = reducer(s, { type: "run_start", extracted: ex, search: search("c", "something else") });
    expect(s.searches.map((x) => x.id)).toEqual(["a", "c"]); // different Looking for → its own search
  });

  it("people found mid-run or on Retry join a search", () => {
    let s = reducer(initialState("s1"), { type: "run_start", extracted: { ...ex, people: [] }, search: search("a", "partners") });
    s = reducer(s, { type: "row", contact: { ...ex.people[0], status: "ok" } });
    s = reducer(s, { type: "run_end" });
    s = reducer(s, { type: "run_start" }); // Retry: no new search
    s = reducer(s, { type: "row", contact: { ...ex.people[1], status: "ok" } });
    expect(s.rowSearches).toEqual({ "jane-doe-acme": ["a"], "john-roe-acme": ["a"] });
    expect(s.searches).toHaveLength(1);
  });

  it("relevance uses the Looking for of the search that found the row", () => {
    let s = reducer(initialState("s1"), { type: "run_start", extracted: ex, search: search("a", "partners") });
    const fit = { p: 0.1, tier: "no" as const, by: "jev", for: "partners" };
    s = reducer(s, { type: "row", contact: { ...s.contacts["jane-doe-acme"], status: "skipped", fit } });
    s = reducer(s, { type: "role", roleFilter: "something else" });
    expect(tableRows(s).map((c) => c.id)).toEqual(["john-roe-acme"]);
  });

  it("old saved state becomes one 'Earlier results' search", () => {
    const old = { ...initialState("s1"), searches: undefined, rowSearches: undefined, companySearches: undefined, order: ["x"], contacts: { x: { ...ex.people[0], id: "x" } }, companies: { acme: ex.companies[0] } } as any;
    const s = migrate(old);
    expect(s.searches[0].label).toBe("Earlier results");
    expect(listedRows(s).map((c) => c.id)).toEqual(["x"]);
  });

  it("editing the input invalidates the parse", () => {
    let s = reducer(initialState("s1"), { type: "parsed", extracted: ex });
    s = reducer(s, { type: "input", input: "new" });
    expect(s.extracted).toBeUndefined();
  });

  it("persistable drops in-flight flags; clear resets", () => {
    const s = { ...initialState("s1"), running: true, parsing: true, rateLimitedUntil: 5 };
    expect(persistable(s)).toMatchObject({ running: false, parsing: false, rateLimitedUntil: undefined });
    expect(reducer({ ...s, input: "x" }, { type: "clear", session: "s2" })).toEqual(initialState("s2"));
  });
});
