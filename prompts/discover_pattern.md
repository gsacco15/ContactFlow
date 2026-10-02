Discover the email address format used at {{domain}}.

Search for the domain's email format and read the result snippets. Use at most two searches; stop after one if it already states the format. Good queries: "@{{domain}}" email format, {{domain}} email, {{domain}} employee email. Pages from RocketReach, SignalHire, Hunter, LeadIQ, ContactOut and Apollo often state the format in their snippet (for example "the most common pattern is first.last, used 72% of the time"). Do not open login-walled pages; snippets are enough.

Also collect any literal @{{domain}} addresses you see in results and infer the pattern from them; put them in `evidence`.

Return up to 3 patterns, ranked, each with the URL it came from. Use only these template tokens: {first} {last} {f} {m} {l}, with separators "." "_" "-" or none. Allowed templates: {first}.{last}, {first}{last}, {first}_{last}, {first}-{last}, {f}{last}, {f}.{last}, {first}, {last}, {last}.{first}, {first}{l}, {f}{l} (initials), {f}{m}{l} (initials with middle initial).

Confidence: use the percentage the source states when it gives one and set `stated` to true; otherwise estimate how strongly the evidence supports the format and set `stated` to false.

If you find nothing, return an empty list. Do not guess.

Finish by calling the `report_patterns` tool exactly once.
