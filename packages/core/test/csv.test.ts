import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, toCsv, toTsv, type Company, type Contact } from "../src/index.ts";

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
    { email: "jane.doe@acme.com", pattern: "{first}.{last}", rank: 1, verify_status: "unverified" },
    { email: "jane@acme.com", pattern: "{first}", rank: 2, verify_status: "unverified" },
  ],
  primary_email: "jane.doe@acme.com",
  status: "ok",
};

describe("csv", () => {
  it("has the documented header", () => {
    expect(toCsv([], [company]).split("\r\n")[0]).toBe(CSV_COLUMNS.join(","));
    expect(CSV_COLUMNS).toContain("opt_out");
  });

  it("flattens contact + company, quotes and defuses formulas", () => {
    const [, row] = toCsv([contact], [company]).split("\r\n");
    expect(row).toBe(
      `Jane,Doe,"'=HYPERLINK(""x""), VP ""Sales""","Acme, Inc.",acme.com,jane.doe@acme.com,jane@acme.com,,first.last,0.80,https://rocketreach.co/acme,https://acme.com,,unverified,ok,`,
    );
  });

  it("marks statistical defaults", () => {
    const co = { ...company, patterns: [] };
    const [, row] = toCsv([contact], { acme: co }).split("\r\n");
    expect(row.split(",").slice(-8, -5)).toEqual(["first.last", "default", ""]);
  });

  it("tsv has no tabs or newlines inside cells", () => {
    const tsv = toTsv([{ ...contact, title: "VP\tSales\nEMEA" }], [company]);
    const lines = tsv.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);
    expect(lines[1].split("\t")).toHaveLength(CSV_COLUMNS.length);
  });
});
