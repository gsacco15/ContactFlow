import type { Company, Contact, ExtractResult } from "@cf/core";

export type Filters = { onlyOk: boolean; hidePatternless: boolean; groupByCompany: boolean; includeGuesses: boolean; hideIrrelevant: boolean };
export type Usage = { tokens: number; searches: number; cost: number; calls: number };

export type State = {
  session: string;
  input: string;
  roleFilter: string;
  nicknames: boolean;
  usePasteEvidence: boolean; // use emails / stated formats found in the paste
  skipIrrelevant: boolean; // skip people judged not relevant before any search
  judge?: string; // decision provider in use: "jev" or "claude"
  judging: boolean;
  extracted?: ExtractResult; // after Parse; edits write back here before Run
  showPreview: boolean; // true after Parse until the next Run
  companies: Record<string, Company>;
  contacts: Record<string, Contact>;
  order: string[]; // contact ids in display order
  parsing: boolean;
  running: boolean;
  usage: Usage;
  error?: string;
  rateLimitedUntil?: number;
  filters: Filters;
};

export type Action =
  | { type: "input"; input: string }
  | { type: "role"; roleFilter: string }
  | { type: "nicknames"; on: boolean }
  | { type: "paste_evidence"; on: boolean }
  | { type: "skip_irrelevant"; on: boolean }
  | { type: "judge"; name: string }
  | { type: "judging"; on: boolean }
  | { type: "parse_start" }
  | { type: "parsed"; extracted: ExtractResult }
  | { type: "edit_extract"; extracted?: ExtractResult }
  | { type: "run_start"; extracted?: ExtractResult; limit?: number }
  | { type: "row"; contact: Contact }
  | { type: "company"; company: Company }
  | { type: "usage"; tokens: number; searches: number; cost: number }
  | { type: "run_end"; error?: string }
  | { type: "rate_limited"; until: number }
  | { type: "filters"; filters: Partial<Filters> }
  | { type: "error"; error?: string }
  | { type: "clear"; session: string };

export const emptyUsage = (): Usage => ({ tokens: 0, searches: 0, cost: 0, calls: 0 });

export function initialState(session: string): State {
  return {
    session,
    input: "",
    showPreview: false,
    roleFilter: "",
    nicknames: false,
    usePasteEvidence: true,
    skipIrrelevant: true,
    judging: false,
    companies: {},
    contacts: {},
    order: [],
    parsing: false,
    running: false,
    usage: emptyUsage(),
    filters: { onlyOk: false, hidePatternless: false, groupByCompany: false, includeGuesses: false, hideIrrelevant: true },
  };
}

const byId = <T extends { id: string }>(xs: T[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "input":
      return { ...s, input: a.input, extracted: undefined, showPreview: false };
    case "role":
      return { ...s, roleFilter: a.roleFilter };
    case "nicknames":
      return { ...s, nicknames: a.on };
    case "paste_evidence":
      return { ...s, usePasteEvidence: a.on };
    case "skip_irrelevant":
      return { ...s, skipIrrelevant: a.on };
    case "judge":
      return { ...s, judge: a.name };
    case "judging":
      return { ...s, judging: a.on };
    case "parse_start":
      return { ...s, parsing: true, error: undefined };
    case "parsed":
      return { ...s, parsing: false, extracted: a.extracted, showPreview: true };
    case "edit_extract":
      return { ...s, extracted: a.extracted, showPreview: !!a.extracted };
    case "run_start": {
      if (!a.extracted) return { ...s, running: true, showPreview: false, error: undefined };
      const people = a.extracted.people.slice(0, a.limit ?? Infinity).map((p) => ({ ...p, status: "pending" as const, candidates: [] }));
      return {
        ...s,
        running: true,
        showPreview: false,
        error: undefined,
        extracted: a.extracted,
        companies: byId(a.extracted.companies),
        contacts: byId(people),
        order: people.map((p) => p.id),
      };
    }
    case "row":
      return {
        ...s,
        contacts: { ...s.contacts, [a.contact.id]: a.contact },
        order: s.order.includes(a.contact.id) ? s.order : [...s.order, a.contact.id],
      };
    case "company":
      return { ...s, companies: { ...s.companies, [a.company.id]: a.company } };
    case "usage":
      return {
        ...s,
        usage: {
          tokens: s.usage.tokens + a.tokens,
          searches: s.usage.searches + a.searches,
          cost: s.usage.cost + a.cost,
          calls: s.usage.calls + 1,
        },
      };
    case "run_end":
      return { ...s, running: false, parsing: false, error: a.error, rateLimitedUntil: undefined };
    case "rate_limited":
      return { ...s, rateLimitedUntil: a.until };
    case "filters":
      return { ...s, filters: { ...s.filters, ...a.filters } };
    case "error":
      return { ...s, error: a.error, parsing: false };
    case "clear":
      return initialState(a.session);
  }
}

/** What survives a refresh: everything except in-flight flags. */
export function persistable(s: State): State {
  return { ...s, parsing: false, running: false, judging: false, rateLimitedUntil: undefined };
}
