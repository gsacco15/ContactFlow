// Fixture pastes double as "try a sample" content in the UI.
import linkedin from "../../../fixtures/linkedin_results.txt?raw";
import team from "../../../fixtures/team_page.txt?raw";
import mixed from "../../../fixtures/mixed_notes.txt?raw";
import companies from "../../../fixtures/companies_only.txt?raw";
import urls from "../../../fixtures/urls.txt?raw";
import thirty from "../../../fixtures/thirty_contacts.txt?raw";

export const SAMPLES: { label: string; text: string; roles?: string }[] = [
  { label: "LinkedIn search results", text: linkedin },
  { label: "Team page", text: team },
  { label: "Mixed notes", text: mixed },
  { label: "Companies only", text: companies, roles: "VP Sales, Head of Growth" },
  { label: "Team page URLs", text: urls, roles: "Head of Sales, CEO" },
  { label: "30 contacts", text: thirty },
];
