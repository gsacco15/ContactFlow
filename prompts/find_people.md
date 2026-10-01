Find the team, leadership or about page for {{company}} ({{domain}}) and extract the people whose titles match: {{role_filter}}.

If the user message includes a URL, fetch it first. Otherwise search for the company's own team or leadership page on {{domain}} and fetch it. Read the fetched page; do not rely on search snippets alone. Never fetch linkedin.com or any login-walled or paid data-vendor page (ZoomInfo, RocketReach, Apollo, SignalHire, Lusha, ContactOut).

Include a person only if their title on the page matches the role filter (treat close equivalents as matches: "Chief Revenue Officer" matches "VP Sales"; "Head of Growth" matches "Growth"). Return only people actually listed; never invent anyone. Leave `company` empty for each person.

Set mode to "people". Finish by calling the `extract_contacts` tool exactly once.
