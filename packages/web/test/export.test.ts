import { afterEach, describe, expect, it, vi } from "vitest";
import { sheetNames } from "../src/lib/excel.ts";
import { appendNew } from "../src/lib/googleSheets.ts";

describe("sheetNames", () => {
  it("strips illegal characters, caps length and dedupes", () => {
    expect(sheetNames(["Acme / Beta [x]", "Acme / Beta [x]", "A".repeat(40)])).toEqual(["Acme Beta x", "Acme Beta x 2", "A".repeat(28)]);
  });
});

describe("appendNew (Google Sheets)", () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeGoogle(existing: string[][]) {
    const appended: string[][][] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      const body = url.includes("fields=sheets")
        ? { sheets: [{ properties: { title: "Contacts" } }] }
        : url.includes(":append")
          ? (appended.push(JSON.parse(String(init?.body)).values), {})
          : { values: existing };
      return new Response(JSON.stringify(body), { status: 200 });
    });
    return appended;
  }
  const table = [
    ["first", "last", "company", "email_1"],
    ["Jane", "Doe", "Acme", "jane@acme.com"],
    ["Ann", "Lee", "Beta", "ann@beta.com"],
  ];

  it("writes the header into an empty sheet", async () => {
    const appended = fakeGoogle([]);
    expect(await appendNew("t", "id", table)).toEqual({ added: 2, skipped: 0 });
    expect(appended[0]).toEqual(table);
  });

  it("adds only new people, in the sheet's own column order", async () => {
    const appended = fakeGoogle([
      ["company", "first", "last", "notes"],
      ["ACME", "jane", "doe", "called"],
    ]);
    expect(await appendNew("t", "id", table)).toEqual({ added: 1, skipped: 1 });
    expect(appended[0]).toEqual([["Beta", "Ann", "Lee", ""]]);
  });

  it("sends nothing when everyone is already there", async () => {
    const appended = fakeGoogle([table[0], table[1], table[2]]);
    expect(await appendNew("t", "id", table)).toEqual({ added: 0, skipped: 2 });
    expect(appended).toHaveLength(0);
  });
});
