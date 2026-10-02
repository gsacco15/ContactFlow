# Benchmark

Scores ContactFlow against people whose real work email you already know.

## 1. Make an answer key

A CSV (or a sheet saved as CSV) with one row per person. Put real files in `bench/data/` — that folder is never committed.

| Column | Required | Also accepted as |
|---|---|---|
| `first` | yes | First Name, given_name |
| `last` | yes (can be blank) | Last Name, surname |
| `company` | yes | Company Name, organization, firm |
| `email` | yes | real_email, Email Address, recipient |
| `outcome` | no — blank means "I know it's right" | status, result, event |
| `title`, `domain`, `source` | no | |

Outcome words: `delivered` / `opened` / `sent` → delivered · `replied` · `confirmed` / `valid` / `verified` · `bounced` / `hard bounce` / `invalid`. Soft bounces, unsubscribes and spam complaints are skipped (they don't say whether the address exists).

Good sources: past sends from your email tool, contacts you've emailed back and forth with, addresses you've confirmed. 100–200 people across many firms is a good first run.

## 2. Run it

```bash
pnpm bench --mock                          # free practice run on bench/sample.csv (fake answers)
pnpm bench bench/data/my-list.csv          # real run (needs CF_EDGE_URL; costs about what the app would)
```

| Option | |
|---|---|
| `--limit 50` | Only the first 50 people |
| `--budget 5` | Stop once about $5 is spent (default 5) |
| `--site on` | Use website formats for real (compare with a default run to decide whether to switch it on) |
| `--give-domain` | Pass the domain column in, to test formats only |
| `--use-cache` | Use the shared 30-day memory (default: fresh, so the run measures finding) |

Real emails are never sent to ContactFlow — only names and companies.

## 3. Read the report

Each run saves `bench/results/<time>.md` (numbers only, safe to share) and `.json` (every row, contains addresses). The report compares itself with the previous run of the same kind.

| Number | Good direction |
|---|---|
| 1st email right | up |
| Wrong but confident (scored 80%+ but wrong) | down — the most important one |
| Domain right | up |
| No sourced email | down |
| Known bounce ranked 1st | down |
| Cost per usable contact | down |

"Do the scores mean what they say?" shows, for each score band, how often answers in it were actually right. If 90%+ answers are right only 70% of the time, the scores need lowering.
