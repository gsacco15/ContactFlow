// Tool schemas and per-stage specs shared by the browser and the edge function.
// This file must stay import-free: `pnpm edge:sync` copies it verbatim into the
// Deno function so both sides agree on shapes.

export const TEMPLATES = [
  "{first}.{last}",
  "{first}{last}",
  "{first}_{last}",
  "{first}-{last}",
  "{f}{last}",
  "{f}.{last}",
  "{first}",
  "{last}",
  "{last}.{first}",
  "{first}{l}",
  "{f}{l}",
  "{f}{m}{l}",
] as const;

export const INPUT_MODES = ["people", "companies", "urls", "mixed"] as const;

export type StageName =
  | "classify_extract"
  | "resolve_domain"
  | "discover_pattern"
  | "find_people"
  | "rescue_agent"
  | "decide";

/** Which configured model a stage runs on (resolved to an env var by the edge function). */
export type ModelRole = "extract" | "domain" | "classify";

export type StageSpec = {
  /** Prompt file name in /prompts, without .md */
  prompt: string;
  model: ModelRole;
  /** Client-side tools offered to the model (names in TOOLS). */
  tools: string[];
  /** The tool whose call is the stage's answer. Absent for agentic stages. */
  finalTool?: string;
  /** Upper bounds; the caller may ask for fewer. 0 = tool not offered. */
  maxSearches: number;
  maxFetches: number;
  /** Agentic stages receive a full message list and may call any offered tool. */
  agentic?: boolean;
};

export const STAGES: Record<StageName, StageSpec> = {
  classify_extract: { prompt: "classify_extract", model: "extract", tools: ["extract_contacts"], finalTool: "extract_contacts", maxSearches: 0, maxFetches: 0 },
  resolve_domain: { prompt: "resolve_domain", model: "domain", tools: ["report_domain"], finalTool: "report_domain", maxSearches: 2, maxFetches: 0 },
  discover_pattern: { prompt: "discover_pattern", model: "extract", tools: ["report_patterns"], finalTool: "report_patterns", maxSearches: 2, maxFetches: 0 },
  find_people: { prompt: "find_people", model: "extract", tools: ["extract_contacts"], finalTool: "extract_contacts", maxSearches: 3, maxFetches: 3 },
  rescue_agent: { prompt: "rescue_agent", model: "extract", tools: ["find_domain", "find_email_pattern", "find_people", "finish"], maxSearches: 2, maxFetches: 2, agentic: true },
  decide: { prompt: "decide", model: "classify", tools: ["report_decision"], finalTool: "report_decision", maxSearches: 0, maxFetches: 0 },
};

type JsonSchema = Record<string, unknown>;
export type ToolDef = { name: string; description: string; input_schema: JsonSchema };

const str = (description?: string): JsonSchema => (description ? { type: "string", description } : { type: "string" });
const nullableStr = (description: string): JsonSchema => ({ type: ["string", "null"], description });
const num01 = (description: string): JsonSchema => ({ type: "number", description: `${description} (0 to 1)` });

const patternSchema: JsonSchema = {
  type: "object",
  properties: {
    template: { type: "string", enum: [...TEMPLATES], description: "Email local-part template" },
    confidence: num01("How sure you are this is the format in use"),
    source_url: str("URL of the page/snippet the format was read from"),
    evidence: { type: "array", items: { type: "string" }, description: "Literal email addresses at this domain seen in results" },
  },
  required: ["template", "confidence"],
  additionalProperties: false,
};

export const TOOLS: Record<string, ToolDef> = {
  extract_contacts: {
    name: "extract_contacts",
    description: "Report the people, companies and URLs found in the text. Call exactly once with everything you found.",
    input_schema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: [...INPUT_MODES], description: "What the input mostly is" },
        companies: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: str("Company name as written"),
              website: str("Website or domain if present in the text"),
              role_hint: str("Roles the text says to look for at this company, e.g. 'CFO'"),
              stated_formats: {
                type: "array",
                description: "Specific email formats the text states for this company. Skip vague statements.",
                items: {
                  type: "object",
                  properties: {
                    quote: str("The sentence from the text, max 160 characters"),
                    template: { type: "string", enum: [...TEMPLATES], description: "The stated format as a template, if it is stated in words" },
                    example_email: str("A literal example address given with the statement"),
                    example_name: str("Whose address the example is, if the text says"),
                  },
                  required: ["quote"],
                  additionalProperties: false,
                },
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
        },
        people: {
          type: "array",
          items: {
            type: "object",
            properties: {
              first: str("Given name"),
              middle: str("Middle name or initial if shown"),
              last: str("Family name (may be empty if unknown)"),
              email: str("This person's email address, only if it appears literally next to them in the text"),
              flag: str("Short warning if this person may not work at the company, e.g. the headline names a different or only partly matching employer"),
              title: str("Job title exactly as written"),
              company: str("Company name; must match a name in companies[]"),
              linkedin_url: str("LinkedIn profile URL if present"),
              raw: str("The source line this person came from, max 80 characters"),
            },
            required: ["first", "last"],
            additionalProperties: false,
          },
        },
        urls: { type: "array", items: { type: "string" }, description: "Non-LinkedIn URLs that point at company or team pages" },
        notes: str("One short sentence on anything ambiguous; empty if none"),
      },
      required: ["mode", "companies", "people", "urls", "notes"],
      additionalProperties: false,
    },
  },
  report_domain: {
    name: "report_domain",
    description: "Report the company's official website domain.",
    input_schema: {
      type: "object",
      properties: {
        domain: nullableStr("Bare domain without protocol or www, e.g. acme.com; null if not found"),
        confidence: num01("Confidence the domain is the company's own email domain"),
        source_url: nullableStr("URL of the search result that established the domain"),
        alternatives: { type: "array", items: { type: "string" }, description: "Other plausible domains" },
      },
      required: ["domain", "confidence", "source_url", "alternatives"],
      additionalProperties: false,
    },
  },
  report_patterns: {
    name: "report_patterns",
    description: "Report up to 3 email formats in use at the domain, best first. Empty list if nothing was found.",
    input_schema: {
      type: "object",
      properties: { patterns: { type: "array", items: patternSchema, maxItems: 3 } },
      required: ["patterns"],
      additionalProperties: false,
    },
  },
  report_decision: {
    name: "report_decision",
    description: "Report a probability for every option. Probabilities should sum to 1.",
    input_schema: {
      type: "object",
      properties: {
        probabilities: {
          type: "array",
          items: {
            type: "object",
            properties: { option: str(), p: num01("Probability") },
            required: ["option", "p"],
            additionalProperties: false,
          },
        },
      },
      required: ["probabilities"],
      additionalProperties: false,
    },
  },
  find_domain: {
    name: "find_domain",
    description: "Run the domain-resolution stage for a company name (optionally a hint such as a parent company, country or industry). Returns domain, confidence, source_url.",
    input_schema: {
      type: "object",
      properties: { company_name: str(), hint: str("Extra context: parent company, rebrand, country, industry") },
      required: ["company_name"],
      additionalProperties: false,
    },
  },
  find_email_pattern: {
    name: "find_email_pattern",
    description: "Run the email-format discovery stage for a domain. Returns ranked patterns with source URLs.",
    input_schema: {
      type: "object",
      properties: { domain: str("Bare domain, e.g. acme.co.uk") },
      required: ["domain"],
      additionalProperties: false,
    },
  },
  find_people: {
    name: "find_people",
    description: "Fetch the company's team/leadership page and extract people matching a role filter. Literal emails on the page are useful pattern evidence.",
    input_schema: {
      type: "object",
      properties: { domain: str(), company_name: str(), role_filter: str("e.g. 'VP Sales, Head of Marketing'") },
      required: ["domain", "role_filter"],
      additionalProperties: false,
    },
  },
  finish: {
    name: "finish",
    description: "End the repair. Either return repaired fields with their source URLs, or gave_up=true with a one-line reason.",
    input_schema: {
      type: "object",
      properties: {
        domain: str("Repaired domain, from a tool result"),
        domain_source_url: str("Where the domain came from"),
        patterns: { type: "array", items: patternSchema, maxItems: 3 },
        gave_up: { type: "boolean" },
        reason: str("One line"),
      },
      additionalProperties: false,
    },
  },
};

export function toolsForStage(stage: StageName): ToolDef[] {
  return STAGES[stage].tools.map((n) => TOOLS[n]);
}
