-- ============================================================
-- Whale Pool — online games: a 1v1 link, or a knockout tournament.
--
-- Two tables, like the Cigar Lounge's:
--   pl_tables  the whole game (every match, every rack) plus each
--              player's key hash. Nobody but the server (service
--              role) can read or write it.
--   pl_public  what anyone may see, in PARTS: one row per game
--              (`<code>_main`) and, in a tournament, one more row
--              per match (`<code>_m<round>_<n>`). Browsers may READ
--              it and get its changes over Realtime, but can't write
--              it, so nobody can fake a shot. Each browser listens
--              only to the parts it shows, so a shot in one match
--              doesn't send the whole bracket to all 32 players.
--
-- The pool edge function is the referee: it replays every shot with
-- the site's own whale-pool-sim.js and saves the game and its
-- changed public parts together in pl_save, which refuses a write if
-- someone else changed the game first.
-- ============================================================

create table if not exists public.pl_tables (
    code        text primary key,
    version     integer not null default 0,
    state       jsonb not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists public.pl_public (
    id          text primary key,
    code        text not null references public.pl_tables(code) on delete cascade,
    version     integer not null default 0,
    data        jsonb not null,
    updated_at  timestamptz not null default now()
);

create index if not exists pl_tables_updated_at on public.pl_tables (updated_at);
create index if not exists pl_public_code on public.pl_public (code);

alter table public.pl_tables enable row level security;
alter table public.pl_public enable row level security;

revoke all on public.pl_tables, public.pl_public from anon, authenticated;
grant select on public.pl_public to anon, authenticated;

drop policy if exists pl_public_read on public.pl_public;
create policy pl_public_read on public.pl_public for select to anon, authenticated using (true);

-- live updates for pl_public only (the guard lets a plain Postgres,
-- like the local test database, run this file too)
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and tablename = 'pl_public') then
        alter publication supabase_realtime add table public.pl_public;
    end if;
end $$;

-- write the public parts of a game: { part: data, ... }
create or replace function public.pl_parts(p_code text, p_version integer, p_parts jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
    r record;
begin
    for r in select key, value from jsonb_each(coalesce(p_parts, '{}'::jsonb)) loop
        insert into pl_public (id, code, version, data)
        values (p_code || '_' || r.key, p_code, p_version, r.value)
        on conflict (id) do update
           set data = excluded.data, version = excluded.version, updated_at = now();
    end loop;
end $$;

-- a new game: its state and first public parts at once; false if the code is taken
create or replace function public.pl_create(p_code text, p_state jsonb, p_parts jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    insert into pl_tables (code, version, state) values (p_code, 1, p_state);
    perform pl_parts(p_code, 1, p_parts);
    return true;
exception when unique_violation then
    return false;
end $$;

-- save a move: only if nobody saved since we read it (version check);
-- the changed public parts move in the same transaction
create or replace function public.pl_save(p_code text, p_version integer, p_state jsonb, p_parts jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
    update pl_tables
       set state = p_state, version = p_version + 1, updated_at = now()
     where code = p_code and version = p_version;
    if not found then
        return false;
    end if;
    perform pl_parts(p_code, p_version + 1, p_parts);
    return true;
end $$;

-- games nobody has touched for a day are gone
create or replace function public.pl_cleanup()
returns integer
language sql security definer set search_path = public as $$
    with gone as (
        delete from pl_tables where updated_at < now() - interval '24 hours' returning 1
    )
    select count(*)::integer from gone;
$$;

revoke execute on function public.pl_parts(text, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.pl_create(text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pl_save(text, integer, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.pl_cleanup() from public, anon, authenticated;
grant execute on function public.pl_parts(text, integer, jsonb) to service_role;
grant execute on function public.pl_create(text, jsonb, jsonb) to service_role;
grant execute on function public.pl_save(text, integer, jsonb, jsonb) to service_role;
grant execute on function public.pl_cleanup() to service_role;
