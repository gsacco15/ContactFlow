import type { Company, Contact } from "../types.ts";
import { toRow, type CsvRow } from "../export/csv.ts";

/**
 * CRM-agnostic push adapter (v2). HubSpot is the first planned target, but the
 * interface only speaks in flat CRM records so Salesforce, Attio, Pipedrive or a
 * generic webhook can implement it the same way.
 */
export interface CrmAdapter {
  name: string;
  push(records: CrmRecord[]): Promise<{ created: number; updated: number; failed: { record: CrmRecord; error: string }[] }>;
}

/** The export row plus the candidate list, so an adapter can choose which email to write. */
export type CrmRecord = CsvRow & { emails: string[] };

export function toCrmRecords(contacts: Contact[], companies: Record<string, Company>): CrmRecord[] {
  return contacts
    .filter((c) => c.candidates.length)
    .map((c) => ({ ...toRow(c, companies[c.company_id]), emails: c.candidates.map((x) => x.email) }));
}
