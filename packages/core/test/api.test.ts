import { describe, expect, it } from "vitest";
import { ENRICH_REQUEST_SCHEMA, parseEnrichRequest, runPipeline, toEnrichResponse, toExtract } from "../src/index.ts";
import { mockCtx, toolResponse } from "./helpers.ts";

const rocketreach = toolResponse("report_patterns", { patterns: [{ template: "{f}{last}", confidence: 1, source_url: "https://rocketreach.co/acme-email-format", stated: true }] });

describe("parseEnrichRequest", () => {
  it("accepts structured people and cleans them", () => {
    const r = parseEnrichRequest({ people: [{ ref: "row-1", first: " Jane ", last: "Doe", company: "Acme", domain: "acme.com", extra: 1 }], options: { max_emails: 1 } });
    expect(r).toEqual({ ok: true, value: { version: "v1", people: [{ ref: "row-1", first: "Jane", last: "Doe", company: "Acme", domain: "acme.com" }], options: { max_emails: 1 } } });
  });

  it("lists every problem with its path", () => {
    const r = parseEnrichRequest({ version: "v2", people: [{ last: "Doe" }, { first: "Sam", last: "Lee", company: "Beta", title: 7 }], options: { max_emails: 5 } });
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual([
        'version: only "v1" is supported',
        "people[0].first: required",
        "people[0].company: required",
        "people[1].title: must be a string",
        "options.max_emails: must be 1, 2 or 3",
      ]);
  });

  it("needs something to do, and not text plus people", () => {
    expect(parseEnrichRequest({})).toEqual({ ok: false, errors: ["nothing to do: send people, companies or text"] });
    expect(parseEnrichRequest({ text: "Jane Doe, Acme", people: [{ first: "A", last: "B", company: "C" }] })).toEqual({ ok: false, errors: ["send either text or people/companies, not both"] });
    expect(parseEnrichRequest("hi")).toEqual({ ok: false, errors: ["body must be a JSON object"] });
    expect(parseEnrichRequest({ people: new Array(201).fill({ first: "A", last: "B", company: "C" }) }).ok).toBe(false);
  });
});

describe("structured input end to end", () => {
  it("skips the AI reading step, echoes refs, and returns the v1 shape", async () => {
    const parsed = parseEnrichRequest({
      people: [
        { ref: "crm-17", first: "Jane", last: "Doe", title: "Partner", company: "Acme", domain: "acme.com" },
        { first: "Sam", last: "O'Neil", company: "Acme" },
      ],
      options: { max_emails: 1 },
    });
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const { extract, refs } = toExtract(parsed.value);
    const { ctx, calls } = mockCtx({ discover_pattern: rocketreach });
    const res = toEnrichResponse(await runPipeline(extract, ctx), parsed.value.options, refs);

    expect(calls.map((c) => c.stage)).toEqual(["discover_pattern"]); // no classify_extract, no domain search
    expect(res.version).toBe("v1");
    expect(res.people[0]).toEqual({
      ref: "crm-17",
      first: "Jane",
      last: "Doe",
      title: "Partner",
      company: "Acme",
      domain: "acme.com",
      domain_source_url: "https://acme.com", // the domain you gave
      emails: [{ address: "jdoe@acme.com", rank: 1, basis: "sourced", verify_status: "unverified" }],
      pattern: { format: "flast", template: "{f}{last}", confidence: 0.95, confidence_basis: "stated by source", source: "RocketReach", source_url: "https://rocketreach.co/acme-email-format" },
      status: "ok",
    });
    expect(res.people[1].ref).toBeUndefined();
    expect(res.people[1].emails[0].address).toBe("soneil@acme.com");
    expect(res.companies).toEqual([{ name: "Acme", domain: "acme.com", patterns: [res.people[0].pattern] }]);
  });

  it("companies + roles become role hints", () => {
    const { extract, refs } = toExtract({ companies: [{ ref: "c1", name: "Beta Corp", domain: "beta.com", roles: "CFO" }] });
    expect(extract.mode).toBe("companies");
    expect(extract.companies[0]).toMatchObject({ id: "beta", name: "Beta Corp", website: "beta.com", role_hint: "CFO" });
    expect(refs.get("company:beta")).toBe("c1");
  });
});

describe("ENRICH_REQUEST_SCHEMA", () => {
  it("documents the same fields the parser accepts", () => {
    expect(Object.keys(ENRICH_REQUEST_SCHEMA.properties)).toEqual(["version", "people", "companies", "text", "options"]);
    expect(ENRICH_REQUEST_SCHEMA.properties.people.items.required).toEqual(["first", "last", "company"]);
  });
});
