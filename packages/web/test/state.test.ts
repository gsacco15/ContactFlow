import { describe, expect, it } from "vitest";
import { buildExtract } from "@cf/core";
import { initialState, persistable, reducer } from "../src/state.ts";

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
    s = reducer(s, { type: "run_start", extracted: ex, limit: 1 });
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
