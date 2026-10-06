import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, toCsv, toRow, toTable, toTsv, type Company, type Contact } from "../src/index.ts";

const company: Company = {
  id: "acme",
  name: "Acme, Inc.",
  domain: "acme.com",
  domain_source_url: "https://acme.com",
  patterns: [{ template: "{first}.{last}", confidence: 0.8, source_url: "https://rocketreach.co/acme" }],
};
const contact: Contact = {
  id: "jane-doe-acme",
  first: "Jane",
  last: "Doe",
  title: '=HYPERLINK("x"), VP "Sales"',
  company_id: "acme",
  raw_source: "",
  candidates: [
    { email: "jane.doe@acme.com", pattern: "{first}.{last}", rank: 1, basis: "sourced", verify_status: "unverified" },
    { email: "jane@acme.com", pattern: "{first}", rank: 2, basis: "guess", verify_status: "unverified" },
  ],
  primary_email: "jane.doe@acme.com",
  status: "ok",
};

describe("csv", () => {
  it("toTable gives raw values with the same columns", () => {
    const t = toTable([contact], [company], { searchOf: () => "s" });
    expect(t[0]).toEqual([...CSV_COLUMNS, "search"]);
    expect(t[1][CSV_COLUMNS.indexOf("title")]).toBe('=HYPERLINK("x"), VP "Sales"'); // raw: written as text, not a formula
    expect(t[1].at(-1)).toBe("s");
  });

  it("adds a search column only when asked", () => {
    const lines = toCsv([contact], [company], { searchOf: () => "Acme · sales" }).split("\r\n");
    expect(lines[0]).toBe([...CSV_COLUMNS, "search"].join(","));
    expect(lines[1].endsWith(",Acme · sales")).toBe(true);
  });

  it("has the documented header", () => {
    expect(toCsv([], [company]).split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
    expect(CSV_COLUMNS).toContain("opt_out");
  });

  it("flattens contact + company, quotes and defuses formulas; drops backup guesses by default", () => {
    const [, row] = toCsv([contact], [company]).split("\r\n");
    expect(row).toBe(
      `Jane,Doe,"'=HYPERLINK(""x""), VP ""Sales""","Acme, Inc.",acme.com,jane.doe@acme.com,not checked,,,sourced,,,first.last,0.80,estimated,https://rocketreach.co/acme,https://acme.com,,unverified,ok,`,
    );
  });

  it("includes backup guesses only when asked", () => {
    const [, row] = toCsv([contact], [company], { includeGuesses: true }).split("\r\n");
    expect(row).toContain("jane.doe@acme.com,not checked,jane@acme.com,,sourced,guess,");
  });

  it("labels stated vs estimated confidence", () => {
    const co = { ...company, patterns: [{ ...company.patterns[0], stated: true }] };
    expect(toCsv([contact], [co])).toContain(",0.80,stated by source,");
  });

  it("email-only contacts export as Unknown", () => {
    const c = { ...contact, first: "", last: "", title: undefined, candidates: [{ email: "afishman@cm.law", pattern: "pasted", rank: 1 as const, basis: "seen" as const }] };
    const [, row] = toCsv([c], [company]).split("\r\n");
    expect(row.startsWith("Unknown,Unknown,,")).toBe(true);
    expect(row).toContain("afishman@cm.law,from your paste (not checked),,,seen,");
  });

  it("tsv has no tabs or newlines inside cells", () => {
    const tsv = toTsv([{ ...contact, title: "VP\tSales\nEMEA" }], [company]);
    const lines = tsv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1].split("\t")).toHaveLength(CSV_COLUMNS.length);
  });

  it("verified column says in plain words what the mailbox check found for email 1", () => {
    const withStatus = (verify_status: "valid" | "invalid" | "catch_all" | "unverified"): Contact => ({ ...contact, candidates: [{ ...contact.candidates[0], verify_status }] });
    expect(CSV_COLUMNS.indexOf("verified")).toBe(CSV_COLUMNS.indexOf("email_1") + 1);
    expect(toRow(withStatus("unverified"), company).verified).toBe("not checked");
    expect(toRow(withStatus("valid"), company).verified).toBe("yes");
    expect(toRow(withStatus("invalid"), company).verified).toBe("no (bounced)");
    expect(toRow(withStatus("catch_all"), company).verified).toBe("accept-all server");
    expect(toRow(withStatus("unverified"), { ...company, format_verified: "{first}.{last}" }).verified).toBe("format proven");
    expect(toRow(withStatus("valid"), { ...company, verified_by: "demo" }).verified).toBe("demo");
    expect(toRow({ ...contact, candidates: [], primary_email: undefined }, company).verified).toBe("");
  });
});
