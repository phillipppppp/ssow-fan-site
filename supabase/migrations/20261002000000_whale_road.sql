-- ============================================================
-- Whale Road backend: players, coins, run tickets, leaderboard.
--
-- Nothing here is writable from the browser. Every change goes
-- through the whale-road edge function, which runs with the
-- service role, replays each run before trusting it, and calls the
-- wr_* functions below. Those are revoked from anon/authenticated
-- so they can't be called directly through the REST API.
--
-- The one public surface is wr_leaderboard: readable by anyone,
-- streamed live over Realtime.
-- ============================================================

create extension if not exists citext;

create table public.wr_players (
    id              uuid primary key default gen_random_uuid(),
    username        citext not null unique
                    check (char_length(username::text) between 3 and 16
                           and username::text ~ '^[A-Za-z0-9_]+$'),
    wallet          text unique check (wallet ~ '^0x[0-9a-f]{40}$'),
    guest_key_hash  text unique,
    coins           integer not null default 25 check (coins >= 0),
    shield          integer not null default 0 check (shield >= 0),
    dash            integer not null default 0 check (dash >= 0),
    magnet          integer not null default 0 check (magnet >= 0),
    created_at      timestamptz not null default now(),
    -- a player is either a wallet or a guest, never both or neither
    check ((wallet is null) <> (guest_key_hash is null))
);

create table public.wr_sessions (
    token_hash  text primary key,
    player_id   uuid not null references public.wr_players (id) on delete cascade,
    expires_at  timestamptz not null
);

create table public.wr_runs (
    id           uuid primary key default gen_random_uuid(),
    player_id    uuid not null references public.wr_players (id) on delete cascade,
    seed         bigint not null,
    sim_version  integer not null,
    shield       boolean not null default false,
    dash         boolean not null default false,
    magnet       boolean not null default false,
    whale_id     integer,
    started_at   timestamptz not null default now(),
    finished_at  timestamptz,
    score        integer,
    coins        integer,
    ticks        integer,
    suspect      boolean,
    tells        jsonb
);

create index wr_runs_player_started on public.wr_runs (player_id, started_at desc);
create index wr_runs_suspect on public.wr_runs (suspect) where suspect;

-- One row per player: their best clean run.
create table public.wr_leaderboard (
    player_id   uuid primary key references public.wr_players (id) on delete cascade,
    username    text not null,
    wallet      text,
    whale_id    integer,
    score       integer not null,
    run_id      uuid not null,
    updated_at  timestamptz not null default now()
);

create index wr_leaderboard_score on public.wr_leaderboard (score desc, updated_at asc);

-- ------------------------------------------------------------
-- Lock everything down, then open exactly one door.
-- ------------------------------------------------------------

alter table public.wr_players     enable row level security;
alter table public.wr_sessions    enable row level security;
alter table public.wr_runs        enable row level security;
alter table public.wr_leaderboard enable row level security;

revoke all on public.wr_players, public.wr_sessions, public.wr_runs, public.wr_leaderboard
    from anon, authenticated;

grant select on public.wr_leaderboard to anon, authenticated;
create policy "anyone can read the leaderboard"
    on public.wr_leaderboard for select to anon, authenticated using (true);

-- live updates to every open game page
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.wr_leaderboard;
    end if;
end $$;

-- ------------------------------------------------------------
-- The operations. Each is one atomic statement or transaction,
-- so two requests racing can't spend the same coins twice.
-- ------------------------------------------------------------

-- Buy one power-up. Returns the new balance, or nothing if you can't afford it.
create function public.wr_buy(p_player uuid, p_item text, p_price integer)
returns table (coins integer, shield integer, dash integer, magnet integer)
language plpgsql security definer set search_path = public as $$
begin
    if p_item not in ('shield', 'dash', 'magnet') or p_price <= 0 then
        raise exception 'unknown item';
    end if;
    return query
    update wr_players p set
        coins  = p.coins - p_price,
        shield = p.shield + (p_item = 'shield')::int,
        dash   = p.dash   + (p_item = 'dash')::int,
        magnet = p.magnet + (p_item = 'magnet')::int
    where p.id = p_player and p.coins >= p_price
    returning p.coins, p.shield, p.dash, p.magnet;
end $$;

-- Issue a run ticket. Spends the power-ups you're bringing and
-- enforces a runs-per-hour cap. Returns the ticket, or raises.
create function public.wr_start(
    p_player uuid, p_seed bigint, p_version integer,
    p_shield boolean, p_dash boolean, p_magnet boolean,
    p_whale integer, p_hourly_cap integer
)
returns table (run_id uuid, started_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
    recent integer;
begin
    select count(*) into recent from wr_runs
        where player_id = p_player and wr_runs.started_at > now() - interval '1 hour';
    if recent >= p_hourly_cap then
        raise exception 'too many runs this hour';
    end if;

    update wr_players p set
        shield = p.shield - p_shield::int,
        dash   = p.dash   - p_dash::int,
        magnet = p.magnet - p_magnet::int
    where p.id = p_player
      and p.shield >= p_shield::int and p.dash >= p_dash::int and p.magnet >= p_magnet::int;
    if not found then
        raise exception 'you don''t have those power-ups';
    end if;

    return query
    insert into wr_runs (player_id, seed, sim_version, shield, dash, magnet, whale_id)
    values (p_player, p_seed, p_version, p_shield, p_dash, p_magnet, p_whale)
    returning wr_runs.id, wr_runs.started_at;
end $$;

-- Record a replayed run. Only the first finish of a ticket counts.
-- Credits coins; a clean run that beats your best goes on the board.
create function public.wr_finish(
    p_run uuid, p_player uuid, p_score integer, p_coins integer,
    p_ticks integer, p_suspect boolean, p_tells jsonb
)
returns table (best integer, rank bigint, coins integer)
language plpgsql security definer set search_path = public as $$
declare
    r wr_runs%rowtype;
    pl wr_players%rowtype;
begin
    update wr_runs set
        finished_at = now(), score = p_score, coins = p_coins,
        ticks = p_ticks, suspect = p_suspect, tells = p_tells
    where id = p_run and player_id = p_player and finished_at is null
    returning * into r;
    if not found then
        raise exception 'run already finished or not yours';
    end if;

    update wr_players set coins = wr_players.coins + greatest(p_coins, 0)
        where id = p_player returning * into pl;

    if not p_suspect then
        insert into wr_leaderboard as lb (player_id, username, wallet, whale_id, score, run_id, updated_at)
        values (pl.id, pl.username::text, pl.wallet, r.whale_id, p_score, r.id, now())
        on conflict (player_id) do update set
            username = excluded.username, wallet = excluded.wallet, whale_id = excluded.whale_id,
            score = excluded.score, run_id = excluded.run_id, updated_at = excluded.updated_at
        where lb.score < excluded.score;
    end if;

    return query
    select lb.score,
           (select count(*) + 1 from wr_leaderboard o where o.score > lb.score),
           pl.coins
    from wr_leaderboard lb where lb.player_id = p_player
    union all
    select null::integer, null::bigint, pl.coins
    where not exists (select 1 from wr_leaderboard where player_id = p_player)
    limit 1;
end $$;

revoke execute on function public.wr_buy(uuid, text, integer) from public, anon, authenticated;
revoke execute on function public.wr_start(uuid, bigint, integer, boolean, boolean, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function public.wr_finish(uuid, uuid, integer, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.wr_buy(uuid, text, integer) to service_role;
grant execute on function public.wr_start(uuid, bigint, integer, boolean, boolean, boolean, integer, integer) to service_role;
grant execute on function public.wr_finish(uuid, uuid, integer, integer, integer, boolean, jsonb) to service_role;
