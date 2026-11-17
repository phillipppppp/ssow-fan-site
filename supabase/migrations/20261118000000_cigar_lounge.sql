-- ============================================================
-- Cigar Lounge — multiplayer poker tables.
--
-- Two tables per game:
--   pk_tables  the whole game, deck and every hole card included,
--              plus each seat's key hash. Nobody but the server
--              (service role) can read or write it.
--   pk_public  what anyone at the table may see: seats, names,
--              chips, bets, the board, whose turn, and cards only
--              once they're shown down. Browsers may READ it and
--              get its changes over Realtime; they can't write it,
--              so nobody can fake an update.
--
-- The poker edge function is the dealer. It runs the site's
-- poker-engine.js and saves both rows together in pk_save, which
-- refuses a write if someone else changed the table first.
-- ============================================================

create table if not exists public.pk_tables (
    code        text primary key,
    version     integer not null default 0,
    state       jsonb not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.pk_public (
    code        text primary key references public.pk_tables(code) on delete cascade,
    version     integer not null default 0,
    data        jsonb not null,
    updated_at  timestamptz not null default now()
);

create index if not exists pk_tables_updated_at on public.pk_tables (updated_at);

alter table public.pk_tables enable row level security;
alter table public.pk_public enable row level security;

revoke all on public.pk_tables, public.pk_public from anon, authenticated;
grant select on public.pk_public to anon, authenticated;

drop policy if exists pk_public_read on public.pk_public;
create policy pk_public_read on public.pk_public for select to anon, authenticated using (true);

-- live updates for pk_public only (the guard lets a plain Postgres,
-- like the local test database, run this file too)
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and tablename = 'pk_public') then
        alter publication supabase_realtime add table public.pk_public;
    end if;
end $$;

-- a new table: both rows at once; false if the code is taken
create or replace function public.pk_create(p_code text, p_state jsonb, p_public jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    insert into pk_tables (code, version, state) values (p_code, 1, p_state);
    insert into pk_public (code, version, data) values (p_code, 1, p_public);
    return true;
exception when unique_violation then
    return false;
end $$;

-- save a move: only if nobody saved since we read it (version check);
-- the public row moves in the same transaction
create or replace function public.pk_save(p_code text, p_version integer, p_state jsonb, p_public jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    update pk_tables
       set state = p_state, version = p_version + 1, updated_at = now()
     where code = p_code and version = p_version;
    if not found then
        return false;
    end if;
    update pk_public
       set data = p_public, version = p_version + 1, updated_at = now()
     where code = p_code;
    return true;
end $$;

-- tables nobody has touched for a day are gone
create or replace function public.pk_cleanup()
returns integer
language sql security definer set search_path = public as $$
    with gone as (
        delete from pk_tables where updated_at < now() - interval '24 hours' returning 1
    )
    select count(*)::integer from gone;
$$;

revoke execute on function public.pk_create(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pk_save(text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pk_cleanup() from public, anon, authenticated;
grant execute on function public.pk_create(text, jsonb, jsonb) to service_role;
grant execute on function public.pk_save(text, integer, jsonb, jsonb) to service_role;
grant execute on function public.pk_cleanup() to service_role;
