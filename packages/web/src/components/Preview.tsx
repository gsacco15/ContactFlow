import { slug, type Company, type Contact, type ExtractResult } from "@cf/core";
import { BUDGET, LARGE_PASTE_CONTACTS } from "../config.ts";
import type { Pipeline } from "../usePipeline.ts";
import { Banner, Button } from "./ui.tsx";

const cell = "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-sm hover:border-stone-200 focus:border-stone-400 focus:bg-white focus:outline-none";

export function Preview({ p }: { p: Pipeline }) {
  const ex = p.state.extracted;
  if (!ex || !p.state.showPreview) return null;
  const set = (next: ExtractResult) => p.dispatch({ type: "edit_extract", extracted: next });
  const peopleAt = (id: string) => ex.people.filter((x) => x.company_id === id).length;
  const companiesWithout = ex.companies.filter((c) => !peopleAt(c.id) && !c.role_hint);
  const roles = p.state.roleFilter.trim();
  const flagged = ex.people.filter((x) => x.flag).length;
  const pastedEmails = ex.people.filter((x) => x.email).length;
  const statements = ex.companies.reduce((n, c) => n + (c.stated_formats?.length ?? 0), 0);

  const editPerson = (i: number, patch: Partial<Contact>) => set({ ...ex, people: ex.people.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const removePerson = (i: number) => set({ ...ex, people: ex.people.filter((_, j) => j !== i) });
  const editCompany = (c: Company, patch: Partial<Company>) => {
    const next = { ...c, ...patch };
    if (patch.name !== undefined) next.id = slug(patch.name) || c.id;
    set({
      ...ex,
      companies: ex.companies.map((x) => (x.id === c.id ? next : x)),
      people: ex.people.map((x) => (x.company_id === c.id ? { ...x, company_id: next.id } : x)),
    });
  };
  const removeCompany = (c: Company) =>
    set({ ...ex, companies: ex.companies.filter((x) => x.id !== c.id), people: ex.people.filter((x) => x.company_id !== c.id) });

  return (
    <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4 shadow-sm" aria-label="Parse preview">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          Found {ex.people.length} {ex.people.length === 1 ? "person" : "people"} at {ex.companies.length} {ex.companies.length === 1 ? "company" : "companies"}
          {ex.urls.length > 0 && `, ${ex.urls.length} URL${ex.urls.length > 1 ? "s" : ""}`}
          <span className="ml-2 text-sm font-normal text-stone-500">mode: {ex.mode}</span>
        </h2>
        <span className="text-xs text-stone-500">Fix anything wrong before running — searches cost money.</span>
      </div>

      {ex.notes && <p className="text-sm text-stone-600">Note: {ex.notes}</p>}
      {flagged > 0 && (
        <Banner tone="warn">
          {flagged} {flagged === 1 ? "person may" : "people may"} not work at the company they’re listed under (marked ⚠ below). Remove them before running if so.
        </Banner>
      )}
      {(pastedEmails > 0 || statements > 0) && (
        <p className="text-sm text-stone-600">
          Found in your paste: {pastedEmails > 0 && `${pastedEmails} email${pastedEmails > 1 ? "s" : ""} next to people`}
          {pastedEmails > 0 && statements > 0 && " · "}
          {statements > 0 && `${statements} stated email format${statements > 1 ? "s" : ""}`}
          {p.state.usePasteEvidence === false ? " (ignored — the setting is off)" : " — used instead of a web search where they fit."}
        </p>
      )}
      {ex.people.length === 0 && (
        <Banner tone="warn">
          No people found. The classifier found {ex.companies.length} companies and {ex.urls.length} URLs.{" "}
          {roles ? `Run will look for “${roles}” on their team pages.` : "Add target roles above to look people up on their team pages (company-first)."}
        </Banner>
      )}
      {ex.people.length > 0 && companiesWithout.length > 0 && !roles && (
        <Banner tone="info">
          {companiesWithout.length} {companiesWithout.length === 1 ? "company has" : "companies have"} no people. Add target roles above to look them up, or they’ll be skipped.
        </Banner>
      )}
      {ex.people.length > BUDGET.maxContacts && (
        <Banner tone="warn">
          {ex.people.length > LARGE_PASTE_CONTACTS ? "That’s a very large paste. " : ""}
          Runs are capped at {BUDGET.maxContacts} contacts; Run will process the first {BUDGET.maxContacts}.
        </Banner>
      )}

      {ex.people.length > 0 && (
        <div className="max-h-72 overflow-auto rounded border border-stone-200">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-1.5">First</th>
                <th className="px-2 py-1.5">Last</th>
                <th className="px-2 py-1.5">Title</th>
                <th className="px-2 py-1.5">Company</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ex.people.map((x, i) => (
                <tr key={`${x.id}-${i}`} className={`border-t border-stone-100 ${x.flag ? "bg-amber-50" : ""}`}>
                  <td className="px-1">
                    <div className="flex items-center gap-1">
                      {x.flag && <span title={x.flag} className="cursor-help text-amber-600">⚠</span>}
                      <input className={cell} value={x.first} aria-label="First name" onChange={(e) => editPerson(i, { first: e.target.value })} />
                    </div>
                    {(x.flag || x.email) && <div className="px-1.5 pb-1 text-xs text-stone-500">{x.flag ?? x.email}</div>}
                  </td>
                  <td className="px-1">
                    <input className={cell} value={x.last} aria-label="Last name" onChange={(e) => editPerson(i, { last: e.target.value })} />
                  </td>
                  <td className="px-1">
                    <input className={cell} value={x.title ?? ""} aria-label="Title" onChange={(e) => editPerson(i, { title: e.target.value })} />
                  </td>
                  <td className="px-1">
                    <select className={cell} value={x.company_id} aria-label="Company" onChange={(e) => editPerson(i, { company_id: e.target.value })}>
                      {!x.company_id && <option value="">(none)</option>}
                      {ex.companies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-center">
                    <button className="text-stone-400 hover:text-red-600" onClick={() => removePerson(i)} aria-label={`Remove ${x.first} ${x.last}`}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ex.companies.length > 0 && (
        <details open={ex.people.length === 0}>
          <summary className="cursor-pointer text-sm font-medium text-stone-700">Companies ({ex.companies.length})</summary>
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-2 py-1">Name</th>
                <th className="px-2 py-1">Website (optional)</th>
                <th className="px-2 py-1">Roles to find</th>
                <th className="px-2 py-1">People</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {ex.companies.map((c) => (
                <tr key={c.id} className="border-t border-stone-100">
                  <td className="px-1">
                    <input className={cell} value={c.name} aria-label="Company name" onChange={(e) => editCompany(c, { name: e.target.value })} />
                  </td>
                  <td className="px-1">
                    <input className={cell} value={c.website ?? ""} placeholder="found by search" aria-label="Website" onChange={(e) => editCompany(c, { website: e.target.value || undefined })} />
                  </td>
                  <td className="px-1">
                    <input className={cell} value={c.role_hint ?? ""} placeholder={roles || "—"} aria-label="Roles to find" onChange={(e) => editCompany(c, { role_hint: e.target.value || undefined })} />
                  </td>
                  <td className="px-2 text-stone-500">{peopleAt(c.id)}</td>
                  <td className="text-center">
                    <button className="text-stone-400 hover:text-red-600" onClick={() => removeCompany(c)} aria-label={`Remove ${c.name}`}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {ex.urls.length > 0 && (
        <p className="text-sm text-stone-600">
          URLs: {ex.urls.join(", ")} {roles ? "" : "— add target roles to extract people from these pages."}
        </p>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => p.dispatch({ type: "edit_extract", extracted: undefined })}>
          Discard parse
        </Button>
      </div>
    </section>
  );
}
