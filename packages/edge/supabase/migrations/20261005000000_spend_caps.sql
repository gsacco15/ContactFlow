-- Real spend per usage row, so the free tier can be capped in dollars (whole site per UTC day, and
-- per visitor). Rows paid with the visitor's own Claude key (byok) don't count.
alter table public.cf_usage add column if not exists cost_usd numeric;
alter table public.cf_usage add column if not exists byok boolean not null default false;
create index if not exists cf_usage_created_at_idx on public.cf_usage (created_at);

create or replace function public.cf_spend(since timestamptz, ip text default null)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from public.cf_usage
  where created_at >= since and not byok and (ip is null or ip_hash = ip)
$$;

-- Only the edge function (service role) may read spend.
revoke execute on function public.cf_spend(timestamptz, text) from public, anon, authenticated;
