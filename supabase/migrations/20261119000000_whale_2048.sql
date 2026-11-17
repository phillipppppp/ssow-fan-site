-- ============================================================
-- Whale 2048 backend: players, game tickets, leaderboard.
--
-- Same idea as Whale Road: the browser never sends a score. The
-- whale-2048 edge function hands out a ticket with a fresh seed,
-- the page plays from that seed, and sends back its moves; the
-- function replays them with the same whale-2048-sim.js the page
-- plays and records only what the replay says.
--
-- Nothing here is readable or writable from a browser: RLS is on,
-- every grant is revoked, and the w2_* functions below can only be
-- called by the service role (the edge function). The function
-- hands out the leaderboard itself.
--
-- Players are a secret key kept in their browser (only its
-- SHA-256 is stored here), a name they pick, and an avatar: an OG
-- whale number or one of our pfps. No wallet address is ever
-- stored in these tables.
-- ============================================================

create extension if not exists citext;

create table if not exists public.w2_players (
    id          uuid primary key default gen_random_uuid(),
    key_hash    text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
    -- null until they pick one; the function enforces the full rule
    name        citext unique check (
                    name is null or (
                        char_length(name::text) between 2 and 16
                        and position('<' in name::text) = 0
                        and position('>' in name::text) = 0
                        and position('&' in name::text) = 0
                        and position('"' in name::text) = 0)),
    avatar      jsonb not null default '{"kind": "alt", "v": 0}',
    image       text,
    created_at  timestamptz not null default now()
);

create table if not exists public.w2_runs (
    id          uuid primary key default gen_random_uuid(),
    player_id   uuid not null references public.w2_players (id) on delete cascade,
    seed        bigint not null,
    version     integer not null,
    started_at  timestamptz not null default now(),
    saved_at    timestamptz,
    finished_at timestamptz,
    moves       text not null default '',
    score       integer not null default 0,
    top         integer not null default 0,
    suspect     boolean not null default false,
    tells       jsonb
);

create index if not exists w2_runs_player_started on public.w2_runs (player_id, started_at desc);
create index if not exists w2_runs_unplayed on public.w2_runs (started_at) where moves = '';

-- one row per named player: their best clean game
create table if not exists public.w2_board (
    player_id   uuid primary key references public.w2_players (id) on delete cascade,
    name        text not null,
    avatar      jsonb,
    image       text,
    score       integer not null,
    top         integer not null,
    run_id      uuid not null,
    updated_at  timestamptz not null default now()
);

create index if not exists w2_board_score on public.w2_board (score desc, updated_at asc);

alter table public.w2_players enable row level security;
alter table public.w2_runs    enable row level security;
alter table public.w2_board   enable row level security;

revoke all on public.w2_players, public.w2_runs, public.w2_board from anon, authenticated;

-- ------------------------------------------------------------
-- Rank on the board: everyone with more points, or the same
-- points sooner, is ahead of you.
-- ------------------------------------------------------------

create or replace function public.w2_standing(p_player uuid)
returns table (best integer, top integer, rank bigint)
language sql stable security definer set search_path = public as $$
    select b.score, b.top,
           (select count(*) + 1 from w2_board o
             where o.score > b.score or (o.score = b.score and o.updated_at < b.updated_at))
    from w2_board b where b.player_id = p_player;
$$;

-- ------------------------------------------------------------
-- A new game: a ticket with the seed the function picked.
-- Makes the player on first sight. Caps games per hour, and tidies
-- tickets nobody played and nameless players nobody saw for a month.
-- ------------------------------------------------------------

create or replace function public.w2_start(p_key_hash text, p_seed bigint, p_version integer, p_hourly_cap integer)
returns table (run_id uuid)
language plpgsql security definer set search_path = public as $$
declare
    pid uuid;
    recent integer;
begin
    insert into w2_players (key_hash) values (p_key_hash) on conflict (key_hash) do nothing;
    select id into pid from w2_players where key_hash = p_key_hash;

    select count(*) into recent from w2_runs r
        where r.player_id = pid and r.started_at > now() - interval '1 hour';
    if recent >= p_hourly_cap then
        raise exception 'too many games this hour';
    end if;

    delete from w2_runs r where r.moves = '' and r.started_at < now() - interval '30 days';
    delete from w2_players p where p.name is null and p.created_at < now() - interval '30 days'
        and not exists (select 1 from w2_runs r where r.player_id = p.id);

    return query insert into w2_runs (player_id, seed, version)
        values (pid, p_seed, p_version) returning w2_runs.id;
end $$;

-- ------------------------------------------------------------
-- Save a replayed game. A game can be saved again as it goes on
-- (never with fewer moves than before); p_final closes it. A clean
-- game that beats your best goes on the board, if you have a name.
-- ------------------------------------------------------------

create or replace function public.w2_save(
    p_run uuid, p_player uuid, p_moves text, p_score integer, p_top integer,
    p_final boolean, p_suspect boolean, p_tells jsonb
)
returns table (best integer, top integer, rank bigint, named boolean)
language plpgsql security definer set search_path = public as $$
declare
    r w2_runs%rowtype;
    pl w2_players%rowtype;
begin
    update w2_runs set
        moves = p_moves, score = p_score, top = p_top,
        suspect = p_suspect, tells = p_tells, saved_at = now(),
        finished_at = case when p_final then now() else null end
    where id = p_run and player_id = p_player and finished_at is null
      and char_length(moves) <= char_length(p_moves)
    returning * into r;
    if not found then
        raise exception 'game already over or not yours';
    end if;

    select * into pl from w2_players where id = p_player;
    if pl.name is not null and not p_suspect and p_score > 0 then
        insert into w2_board as b (player_id, name, avatar, image, score, top, run_id, updated_at)
        values (pl.id, pl.name::text, pl.avatar, pl.image, p_score, p_top, r.id, now())
        on conflict (player_id) do update set
            name = excluded.name, avatar = excluded.avatar, image = excluded.image,
            score = excluded.score, top = excluded.top, run_id = excluded.run_id, updated_at = excluded.updated_at
        where b.score < excluded.score;
    end if;

    return query
    select s.best, s.top, s.rank, pl.name is not null from w2_standing(p_player) s
    union all
    select null::integer, null::integer, null::bigint, pl.name is not null
    where not exists (select 1 from w2_board where player_id = p_player)
    limit 1;
end $$;

-- ------------------------------------------------------------
-- Pick (or change) your name and avatar. Your board row follows;
-- if you had no row yet, your best clean game so far goes on.
-- A name someone else has raises unique_violation (23505).
-- ------------------------------------------------------------

create or replace function public.w2_claim(p_key_hash text, p_name text, p_avatar jsonb, p_image text)
returns table (best integer, top integer, rank bigint)
language plpgsql security definer set search_path = public as $$
declare
    pl w2_players%rowtype;
    r w2_runs%rowtype;
begin
    insert into w2_players (key_hash) values (p_key_hash) on conflict (key_hash) do nothing;
    update w2_players set name = p_name, avatar = p_avatar, image = p_image
        where key_hash = p_key_hash returning * into pl;

    update w2_board set name = pl.name::text, avatar = pl.avatar, image = pl.image where player_id = pl.id;
    if not found then
        select * into r from w2_runs x
            where x.player_id = pl.id and not x.suspect and x.score > 0
            order by x.score desc, x.saved_at asc limit 1;
        if found then
            insert into w2_board (player_id, name, avatar, image, score, top, run_id, updated_at)
            values (pl.id, pl.name::text, pl.avatar, pl.image, r.score, r.top, r.id, coalesce(r.saved_at, now()));
        end if;
    end if;

    return query select s.best, s.top, s.rank from w2_standing(pl.id) s;
end $$;

-- ------------------------------------------------------------
-- Who am I: name, avatar and standing, from the browser's key.
-- ------------------------------------------------------------

create or replace function public.w2_me(p_key_hash text)
returns table (player_id uuid, name text, avatar jsonb, image text, best integer, top integer, rank bigint)
language sql stable security definer set search_path = public as $$
    select p.id, p.name::text, p.avatar, p.image, s.best, s.top, s.rank
    from w2_players p left join lateral w2_standing(p.id) s on true
    where p.key_hash = p_key_hash;
$$;

revoke execute on function public.w2_standing(uuid) from public, anon, authenticated;
revoke execute on function public.w2_start(text, bigint, integer, integer) from public, anon, authenticated;
revoke execute on function public.w2_save(uuid, uuid, text, integer, integer, boolean, boolean, jsonb) from public, anon, authenticated;
revoke execute on function public.w2_claim(text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.w2_me(text) from public, anon, authenticated;
grant execute on function public.w2_standing(uuid) to service_role;
grant execute on function public.w2_start(text, bigint, integer, integer) to service_role;
grant execute on function public.w2_save(uuid, uuid, text, integer, integer, boolean, boolean, jsonb) to service_role;
grant execute on function public.w2_claim(text, text, jsonb, text) to service_role;
grant execute on function public.w2_me(text) to service_role;
