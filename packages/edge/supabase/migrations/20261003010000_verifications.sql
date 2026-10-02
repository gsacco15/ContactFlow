-- Mailbox checks (email verification) are logged in cf_usage as stage 'verify', priced per check.
alter table public.cf_usage add column if not exists verifications integer not null default 0;
