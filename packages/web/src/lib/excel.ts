import writeXlsxFile from "write-excel-file/browser";

export type TableGroup = { name: string; table: string[][] };

const WIDE = new Set(["company", "email_1", "email_2", "email_3", "pattern_source_url", "domain_source_url", "linkedin_url", "search"]);

/** Excel sheet names: ≤31 chars, no []:*?/\ and unique. */
export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((n) => {
    const base = (n.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim() || "Sheet").slice(0, 28);
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
    used.add(name.toLowerCase());
    return name;
  });
}

const link = (v: string) => /^https?:\/\/\S+$/.test(v) && v.length < 250;

/** One .xlsx with a tab per group: bold frozen header, sized columns, clickable source links. */
export async function downloadXlsx(groups: TableGroup[], fileName: string) {
  const names = sheetNames(groups.map((g) => g.name));
  const sheets = groups.map((g, gi) => {
    const header = g.table[0] ?? [];
    return {
      sheet: names[gi],
      stickyRowsCount: 1,
      columns: header.map((h) => ({ width: WIDE.has(h) ? 32 : h.endsWith("_basis") || h === "status" ? 14 : 16 })),
      data: g.table.map((row, i) =>
        row.map((v) =>
          i === 0
            ? { value: v, fontWeight: "bold" as const, backgroundColor: "#F5F5F4" }
            : link(v)
              ? { type: "Formula" as const, value: `HYPERLINK("${v.replace(/"/g, '""')}")`, textColor: "#0369A1" }
              : v
                ? { value: v, type: String }
                : null,
        ),
      ),
    };
  });
  await writeXlsxFile(sheets).toFile(fileName);
}
