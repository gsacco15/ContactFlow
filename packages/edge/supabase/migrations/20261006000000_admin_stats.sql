-- Admin page (#admin): visitors turned away by the free cap, and one call that returns the daily numbers.

create table if not exists public.cf_limit_hits (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash    text,
  code       text not null -- daily_budget | free_limit
);
create index if not exists cf_limit_hits_created_at_idx on public.cf_limit_hits (created_at);
alter table public.cf_limit_hits enable row level security;

-- Per UTC day for the last `days` days, newest first. Spend is our cost (own-key calls apart);
-- visitors are distinct hashed IPs on the website (ChatGPT calls all share the server's IP, so
-- they are counted as lookups instead). Spend is null on days logged before cost_usd existed.
create or replace function public.cf_admin_stats(days int default 30)
returns jsonb
language sql
stable
set search_path = public
as $$
  with bounds as (
    select (now() at time zone 'utc')::date as today,
           (now() at time zone 'utc')::date - (greatest(1, least(days, 365)) - 1) as first_day
  ),
  u as (
    select (created_at at time zone 'utc')::date as day, ip_hash, session, cost_usd, coalesce(byok, false) as byok, searches, verifications
    from cf_usage, bounds
    where created_at >= (bounds.first_day::timestamp at time zone 'utc')
  ),
  per_day as (
    select day,
      sum(cost_usd) filter (where not byok)                         as spend,
      coalesce(sum(cost_usd) filter (where byok), 0)                as own_key_spend,
      count(distinct ip_hash) filter (where session not like 'mcp-%') as visitors,
      count(distinct ip_hash) filter (where byok)                   as own_key_visitors,
      count(distinct session) filter (where session like 'mcp-%')    as chatgpt_lookups,
      coalesce(sum(searches), 0)                                    as searches,
      coalesce(sum(verifications), 0)                               as checks
    from u group by day
  ),
  hits as (
    select (created_at at time zone 'utc')::date as day, count(distinct ip_hash) as capped_visitors, count(*) as capped_requests
    from cf_limit_hits, bounds
    where created_at >= (bounds.first_day::timestamp at time zone 'utc')
    group by 1
  ),
  series as (
    select generate_series(bounds.first_day, bounds.today, interval '1 day')::date as day from bounds
  )
  select jsonb_build_object(
    'today', (select today from bounds),
    -- One row per browser on the website in the last 7 days (the app's random per-browser session id;
    -- only its first 8 characters are shown). ChatGPT calls are left out: each is its own session.
    'sessions', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.last_seen desc), '[]'::jsonb)
      from (
        select left(c.session, 8) as id,
          min(c.created_at) as first_seen,
          max(c.created_at) as last_seen,
          count(distinct (c.created_at at time zone 'utc')::date) as active_days,
          count(*) as requests,
          round((sum(c.cost_usd) filter (where not coalesce(c.byok, false)))::numeric, 4) as spend,
          coalesce(sum(c.searches), 0) as searches,
          coalesce(sum(c.verifications), 0) as checks,
          bool_or(coalesce(c.byok, false)) as own_key,
          exists (select 1 from cf_limit_hits l where l.ip_hash = any (array_agg(c.ip_hash)) and l.created_at >= now() - interval '7 days') as hit_cap
        from cf_usage c
        where c.created_at >= now() - interval '7 days' and c.session not like 'mcp-%'
        group by c.session
        order by max(c.created_at) desc
        limit 50
      ) x
    ),
    'days', coalesce(jsonb_agg(jsonb_build_object(
      'day', s.day,
      'spend', round(p.spend::numeric, 4),
      'own_key_spend', round(coalesce(p.own_key_spend, 0)::numeric, 4),
      'visitors', coalesce(p.visitors, 0),
      'own_key_visitors', coalesce(p.own_key_visitors, 0),
      'chatgpt_lookups', coalesce(p.chatgpt_lookups, 0),
      'searches', coalesce(p.searches, 0),
      'checks', coalesce(p.checks, 0),
      'capped_visitors', coalesce(h.capped_visitors, 0),
      'capped_requests', coalesce(h.capped_requests, 0)
    ) order by s.day desc), '[]'::jsonb)
  )
  from series s
  left join per_day p on p.day = s.day
  left join hits h on h.day = s.day
$$;

-- Only the edge function (service role) may call it; it checks the admin password first.
revoke execute on function public.cf_admin_stats(int) from public, anon, authenticated;
