-- Evidence engine: facts about a domain's email format (why we believe it), not just the answer.
-- Domain-level only — never names or addresses. Only "global" evidence is stored server-side;
-- evidence from a user's own paste stays in their browser.
create table if not exists public.cf_domain_evidence (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '365 days'),
  domain text not null,
  kind text not null,            -- one of EVIDENCE_KINDS (packages/core/src/schemas.ts)
  template text,                 -- e.g. {f}{last}; null for domain-wide facts (mx, catch-all)
  outcome text not null check (outcome in ('supports', 'contradicts', 'neutral')),
  strength real,                 -- 0–1 multiplier (a source's stated percentage)
  count integer,                 -- observations this row stands for (matched addresses on a page)
  source_url text,               -- no query strings
  source_name text               -- "RocketReach", "their site"…
);
alter table public.cf_domain_evidence enable row level security; -- service role only (edge function)
create index if not exists cf_domain_evidence_domain on public.cf_domain_evidence (domain, observed_at desc);
create index if not exists cf_domain_evidence_expires on public.cf_domain_evidence (expires_at);
