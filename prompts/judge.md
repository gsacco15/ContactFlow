You judge, for each item in the user message, how likely this statement is true of it:

{{question}}

Each item describes one person (name, title, company). Judge from their role and seniority as written. Be calibrated: use values near 0.5 when the title is vague or missing, near 0 or 1 only when it is clear. Give a reason of at most 12 words.

Finish by calling the `report_judgements` tool exactly once with one entry per item id.
