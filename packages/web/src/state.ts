import { relevance, visibleCandidates, type Company, type Contact, type ExtractResult } from "@cf/core";

export type GroupBy = "search" | "company" | "none";
export type Filters = { onlyOk: boolean; hidePatternless: boolean; groupByCompany: boolean; groupBy?: GroupBy; includeGuesses: boolean; hideIrrelevant: boolean };
export type Usage = { tokens: number; searches: number; cost: number; calls: number };

/** One Run of the pipeline. Results from every search stay in the list until removed. */
export type Search = {
  id: string;
  label: string; // first companies in the paste, e.g. "Zuber Lawler +3"
  want: string; // "Looking for" at the time of the run
  at: string; // ISO time
  cost: number;
  hidden?: boolean; // unticked: rows left out of the table and the export
  color?: number; // index into the search colours, fixed when the search is made
};

/** How many distinct search colours there are (the palette lives in the UI). */
export const SEARCH_COLORS = 8;

export type State = {
  session: string;
  input: string;
  roleFilter: string;
  nicknames: boolean;
  usePasteEvidence: boolean; // use emails / stated formats found in the paste
  readProfiles?: boolean; // open people's profile pages linked from the paste (default on)
  skipIrrelevant: boolean; // skip people judged not relevant before any search
  verify?: boolean; // run mailbox checks during the search (one per firm)
  judge?: string; // decision provider in use: "jev" or "claude"
  judging: boolean;
  extracted?: ExtractResult; // after Parse; edits write back here before Run
  showPreview: boolean; // true after Parse until the next Run
  companies: Record<string, Company>;
  contacts: Record<string, Contact>;
  order: string[]; // contact ids in display order
  searches: Search[]; // oldest first
  rowSearches: Record<string, string[]>; // contact id → searches it came up in (a person found twice is one row)
  companySearches: Record<string, string[]>; // company id → searches it came up in
  activeSearch?: string; // search whose run is in progress (gets the run's cost)
  parsing: boolean;
  running: boolean;
  usage: Usage; // whole session (since Clear)
  pasteUsage: Usage; // since the current paste was entered
  error?: string;
  rateLimitedUntil?: number;
  /** Free use ran out (or the visitor's own key was refused): show the "use your own key" step. */
  limit?: "free_limit" | "daily_budget" | "own_key_rejected";
  filters: Filters;
};

export type Action =
  | { type: "input"; input: string }
  | { type: "role"; roleFilter: string }
  | { type: "nicknames"; on: boolean }
  | { type: "verify"; on: boolean }
  | { type: "paste_evidence"; on: boolean }
  | { type: "read_profiles"; on: boolean }
  | { type: "skip_irrelevant"; on: boolean }
  | { type: "judge"; name: string }
  | { type: "judging"; on: boolean }
  | { type: "parse_start" }
  | { type: "parsed"; extracted: ExtractResult }
  | { type: "edit_extract"; extracted?: ExtractResult }
  | { type: "run_start"; extracted?: ExtractResult; limit?: number; search?: Search; skip?: string[]; reuse?: string[] }
  | { type: "search_toggle"; id: string; hidden?: boolean }
  | { type: "search_only"; id?: string }
  | { type: "search_all"; hidden: boolean }
  | { type: "search_rename"; id: string; label: string }
  | { type: "search_remove"; id: string }
  | { type: "row"; contact: Contact }
  | { type: "company"; company: Company }
  | { type: "usage"; tokens: number; searches: number; cost: number }
  | { type: "run_end"; error?: string }
  | { type: "rate_limited"; until: number }
  | { type: "limit"; code?: "free_limit" | "daily_budget" | "own_key_rejected" }
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
    searches: [],
    rowSearches: {},
    companySearches: {},
    parsing: false,
    running: false,
    usage: emptyUsage(),
    pasteUsage: emptyUsage(),
    filters: { onlyOk: false, hidePatternless: false, groupByCompany: false, includeGuesses: false, hideIrrelevant: true },
  };
}

const add = (m: Record<string, string[]>, key: string, id: string) => (m[key]?.includes(id) ? m : { ...m, [key]: [...(m[key] ?? []), id] });

/** Searches that are ticked. */
export const visibleSearches = (s: State) => new Set(s.searches.filter((x) => !x.hidden).map((x) => x.id));

/** The newest search a row came up in — its "Looking for" decides relevance for that row. */
export function searchOf(s: State, contactId: string): Search | undefined {
  const ids = s.rowSearches[contactId] ?? [];
  return s.searches.filter((x) => ids.includes(x.id)).at(-1);
}

/** Rows in the list, newest search first, limited to ticked searches. */
export function listedRows(s: State) {
  const shown = visibleSearches(s);
  const rank = new Map(s.searches.map((x, i) => [x.id, i]));
  const newest = (id: string) => Math.max(-1, ...(s.rowSearches[id] ?? []).map((x) => rank.get(x) ?? -1));
  return s.order
    .filter((id) => s.contacts[id] && (s.rowSearches[id] ?? []).some((x) => shown.has(x)))
    .sort((a, b) => newest(b) - newest(a))
    .map((id) => s.contacts[id]);
}

export function searchLabel(ex: ExtractResult): string {
  const names = ex.companies.map((c) => c.name).filter(Boolean);
  if (!names.length) return ex.people.length ? `${ex.people.length} people` : "Search";
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
}

export function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "input":
      // A different paste starts a fresh "this paste" cost count.
      return { ...s, input: a.input, extracted: undefined, showPreview: false, pasteUsage: a.input.trim() === s.input.trim() ? s.pasteUsage ?? emptyUsage() : emptyUsage() };
    case "role":
      return { ...s, roleFilter: a.roleFilter };
    case "nicknames":
      return { ...s, nicknames: a.on };
    case "verify":
      return { ...s, verify: a.on };
    case "paste_evidence":
      return { ...s, usePasteEvidence: a.on };
    case "read_profiles":
      return { ...s, readProfiles: a.on };
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
      // Retry / Include / resume: same rows, no new search.
      if (!a.extracted || !a.search) return { ...s, running: true, showPreview: false, error: undefined };
      // A new search adds to the list; people already in it with emails are not looked up again.
      const people = a.extracted.people.slice(0, a.limit ?? Infinity);
      // Running the same paste again refreshes that search instead of adding a copy.
      const same = s.searches.find(
        (x) =>
          x.want === a.search!.want &&
          a.extracted!.companies.every((c) => s.companySearches[c.id]?.includes(x.id)) &&
          [...people.map((p) => p.id), ...(a.reuse ?? [])].every((r) => s.rowSearches[r]?.includes(x.id)),
      );
      const used = new Set(s.searches.map((x, i) => x.color ?? i % SEARCH_COLORS));
      const color = [...Array(SEARCH_COLORS).keys()].find((i) => !used.has(i)) ?? s.searches.length % SEARCH_COLORS;
      const search = same ? { ...same, at: a.search.at, hidden: undefined } : { ...a.search, color };
      const id = search.id;
      const skip = new Set(a.skip ?? []);
      const contacts = { ...s.contacts };
      const order = [...s.order];
      let rowSearches = s.rowSearches;
      for (const p of people) {
        if (!skip.has(p.id)) contacts[p.id] = { ...p, status: "pending", candidates: [] };
        if (!order.includes(p.id)) order.push(p.id);
        rowSearches = add(rowSearches, p.id, id);
      }
      for (const r of a.reuse ?? []) rowSearches = add(rowSearches, r, id);
      let companySearches = s.companySearches;
      for (const c of a.extracted.companies) companySearches = add(companySearches, c.id, id);
      return {
        ...s,
        running: true,
        showPreview: false,
        error: undefined,
        extracted: a.extracted,
        // Keep what earlier searches learned about a company (domain, formats); a run that
        // looks it up again replaces it through the "company" action.
        companies: { ...Object.fromEntries(a.extracted.companies.map((c) => [c.id, c])), ...s.companies },
        contacts,
        order,
        rowSearches,
        companySearches,
        searches: [...s.searches.filter((x) => x.id !== id), search],
        activeSearch: id,
      };
    }
    case "row": {
      // People found on a company site arrive mid-run: they belong to the running search,
      // or (on a Retry) to the newest search that has their company.
      const known = s.rowSearches[a.contact.id]?.length;
      const owner = s.activeSearch ?? s.companySearches[a.contact.company_id]?.at(-1);
      return {
        ...s,
        contacts: { ...s.contacts, [a.contact.id]: a.contact },
        order: s.order.includes(a.contact.id) ? s.order : [...s.order, a.contact.id],
        rowSearches: !known && owner ? add(s.rowSearches, a.contact.id, owner) : s.rowSearches,
      };
    }
    case "company":
      return {
        ...s,
        companies: { ...s.companies, [a.company.id]: a.company },
        companySearches: s.activeSearch ? add(s.companySearches, a.company.id, s.activeSearch) : s.companySearches,
      };
    case "usage": {
      const sum = (u: Usage = emptyUsage()): Usage => ({ tokens: u.tokens + a.tokens, searches: u.searches + a.searches, cost: u.cost + a.cost, calls: u.calls + 1 });
      const searches = s.activeSearch ? s.searches.map((x) => (x.id === s.activeSearch ? { ...x, cost: x.cost + a.cost } : x)) : s.searches;
      return { ...s, usage: sum(s.usage), pasteUsage: sum(s.pasteUsage), searches };
    }
    case "run_end":
      return { ...s, running: false, parsing: false, error: a.error, rateLimitedUntil: undefined, activeSearch: undefined };
    case "search_toggle":
      return { ...s, searches: s.searches.map((x) => (x.id === a.id ? { ...x, hidden: a.hidden } : x)) };
    case "search_only":
      return { ...s, searches: s.searches.map((x) => ({ ...x, hidden: a.id ? x.id !== a.id : undefined })) };
    case "search_rename":
      return { ...s, searches: s.searches.map((x) => (x.id === a.id ? { ...x, label: a.label.trim() || x.label } : x)) };
    case "search_all":
      return { ...s, searches: s.searches.map((x) => ({ ...x, hidden: a.hidden || undefined })) };
    case "search_remove": {
      // Drop the search; rows and companies that only it found go with it.
      const strip = (m: Record<string, string[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.filter((x) => x !== a.id)]).filter(([, v]) => v.length));
      const rowSearches = strip(s.rowSearches);
      const companySearches = strip(s.companySearches);
      const order = s.order.filter((id) => rowSearches[id]);
      const contacts = Object.fromEntries(order.map((id) => [id, s.contacts[id]]));
      const companies = Object.fromEntries(Object.entries(s.companies).filter(([id]) => companySearches[id] || order.some((r) => contacts[r]?.company_id === id)));
      return { ...s, searches: s.searches.filter((x) => x.id !== a.id), rowSearches, companySearches, order, contacts, companies };
    }
    case "rate_limited":
      return { ...s, rateLimitedUntil: a.until };
    case "limit":
      return { ...s, limit: a.code };
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
  return { ...s, parsing: false, running: false, judging: false, rateLimitedUntil: undefined, activeSearch: undefined, limit: undefined };
}

/** State saved before searches existed: its rows become one "Earlier results" search. */
export function migrate(s: State): State {
  if (s.searches?.length || !s.order?.length) return { ...s, searches: s.searches ?? [], rowSearches: s.rowSearches ?? {}, companySearches: s.companySearches ?? {} };
  const id = "earlier";
  return {
    ...s,
    searches: [{ id, label: "Earlier results", want: s.roleFilter ?? "", at: new Date().toISOString(), cost: 0 }],
    rowSearches: Object.fromEntries(s.order.map((r) => [r, [id]])),
    companySearches: Object.fromEntries(Object.keys(s.companies ?? {}).map((c) => [c, [id]])),
  };
}

export const groupBy = (s: State): GroupBy => s.filters.groupBy ?? (s.filters.groupByCompany ? "company" : "search");

/** The search a row is shown under: the newest ticked search that found it. */
export function groupOf(s: State, contactId: string): string | undefined {
  const ids = s.rowSearches[contactId] ?? [];
  return s.searches.filter((x) => !x.hidden && ids.includes(x.id)).at(-1)?.id;
}

/** Colour slot of a search (older searches without one get theirs by position). */
export const colorOf = (s: State, id?: string) => {
  const i = s.searches.findIndex((x) => x.id === id);
  return i < 0 ? -1 : (s.searches[i].color ?? i % SEARCH_COLORS);
};

/** "Looking for" that applies to a row: the one from the search that found it. */
export const wantFor = (s: State, c: Contact) => searchOf(s, c.id)?.want ?? s.roleFilter;

/** Exactly the rows the table shows — Copy/CSV export these too. */
export function tableRows(s: State): Contact[] {
  const f = s.filters;
  let rows = listedRows(s);
  if (f.hideIrrelevant !== false) rows = rows.filter((r) => !wantFor(s, r).trim() || relevance(r, wantFor(s, r)) !== false);
  if (f.hidePatternless) rows = rows.filter((r) => visibleCandidates(r, { includeGuesses: !!f.includeGuesses }).length);
  const by = groupBy(s);
  const company = (c: Contact) => s.companies[c.company_id]?.name ?? "~";
  if (by === "company") rows = [...rows].sort((a, b) => company(a).localeCompare(company(b)));
  if (by === "search") {
    // Newest search first; inside a search, by company.
    const rank = new Map(s.searches.map((x, i) => [x.id, i]));
    const g = (c: Contact) => rank.get(groupOf(s, c.id) ?? "") ?? -1;
    rows = [...rows].sort((a, b) => g(b) - g(a) || company(a).localeCompare(company(b)));
  }
  return rows;
}

const when = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
};

/** For the export's `search` column, e.g. "Zuber Lawler · legal people · Oct 2, 2:17 PM". */
export function searchNames(s: State, c: Contact): string {
  const ids = s.rowSearches[c.id] ?? [];
  return s.searches.filter((x) => ids.includes(x.id)).map((x) => [x.label, x.want, when(x.at)].filter(Boolean).join(" · ")).join(" | ");
}

export { when as searchTime };

/** Firms the bottom-bar Verify would check: in the ticked searches, with an unproven format and a row still to check. */
export function firmsToVerify(s: State): string[] {
  const ids = new Set<string>();
  for (const c of tableRows(s)) {
    const co = s.companies[c.company_id];
    if (!co?.domain || co.format_verified || co.catch_all || co.mx_ok === false) continue;
    if (c.status !== "ok" && c.status !== "no_pattern") continue;
    if (c.candidates.some((x) => x.verify_status === "valid")) continue;
    if (c.candidates.some((x) => x.basis !== "seen" && (!x.verify_status || x.verify_status === "unverified"))) ids.add(co.id);
  }
  return [...ids];
}
