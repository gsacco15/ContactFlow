-- Prompt-cache token counts (priced differently from plain input) and the site-reading
-- shadow log (domain-level only: formats and counts, never names or addresses).
alter table public.cf_usage
  add column if not exists cache_read_tokens integer not null default 0,
  add column if not exists cache_write_tokens integer not null default 0;

create table if not exists public.cf_site_shadow (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  domain text not null,
  site_template text,          -- format proven from the company's own site (null = none found)
  site_matches integer not null default 0, -- name-matched addresses supporting it
  site_pages integer not null default 0,   -- pages read
  search_template text,        -- top format from the paid search
  search_confidence real,
  agree boolean                -- null when either side had no answer
);
alter table public.cf_site_shadow enable row level security;
create index if not exists cf_site_shadow_created on public.cf_site_shadow (created_at desc);
