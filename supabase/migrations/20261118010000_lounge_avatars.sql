-- ============================================================
-- Cigar Lounge avatars — a small private cache.
--
-- The poker function looks up a wallet's OG whales (and each
-- whale's picture) on OpenSea with a key only the server has.
-- Answers are cached here so a busy table doesn't hit OpenSea's
-- rate limits: wallet lists for 5 minutes, pictures for a week
-- (the function checks the age). Wallets are stored only as a
-- SHA-256 hash of the address.
--
-- No browser can read or write this table.
-- ============================================================

create table if not exists public.pk_cache (
    key         text primary key,
    data        jsonb not null,
    fetched_at  timestamptz not null default now()
);

alter table public.pk_cache enable row level security;
revoke all on public.pk_cache from anon, authenticated;

create or replace function public.pk_cache_put(p_key text, p_data jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    insert into pk_cache (key, data, fetched_at) values (p_key, p_data, now())
    on conflict (key) do update set data = excluded.data, fetched_at = now();
    delete from pk_cache where fetched_at < now() - interval '8 days';
    return true;
end $$;

revoke execute on function public.pk_cache_put(text, jsonb) from public, anon, authenticated;
grant execute on function public.pk_cache_put(text, jsonb) to service_role;
