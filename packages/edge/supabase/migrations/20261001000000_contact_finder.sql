-- Contact Finder v1: two small tables, written only by the `pipeline` edge function
-- (service role). RLS is on with no policies, so the browser's anon key can't read them.

-- domain → patterns cache (and company → domain). Never stores people's names.
create table if not exists public.cf_cache (
  key        text primary key,
  value      jsonb not null,
  expires_at timestamptz not null
);

-- One row per LLM call, for bill tracking and the daily cap.
create table if not exists public.cf_usage (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  session       text not null,
  ip_hash       text,
  stage         text not null,
  model         text,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  searches      integer not null default 0,
  fetches       integer not null default 0
);
create index if not exists cf_usage_created_at_idx on public.cf_usage (created_at);

alter table public.cf_cache enable row level security;
alter table public.cf_usage enable row level security;

-- Handy view for "what did today cost": select * from cf_usage_daily;
create or replace view public.cf_usage_daily with (security_invoker = true) as
select date_trunc('day', created_at) as day, stage, model,
       count(*) as calls, sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens,
       sum(searches) as searches, sum(fetches) as fetches
from public.cf_usage group by 1, 2, 3 order by 1 desc, 2;
