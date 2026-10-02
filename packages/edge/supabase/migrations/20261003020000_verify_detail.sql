-- What the verification provider actually answered (result/subresult or error), never the address.
alter table public.cf_usage add column if not exists verify_detail text;
