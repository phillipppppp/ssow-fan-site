// ============================================================
// whale-2048 handler — the server half of Whale 2048.
//
// One endpoint, POST { action, ... }:
//   start  a new game: a ticket with a fresh seed
//   save   the game's moves so far; replayed here to get the score
//   claim  pick your name and avatar for the leaderboard
//   board  the top 20, plus where you stand
//
// The browser never reports a score. It plays from the seed this
// function picked and sends the moves; this function replays them
// with the same whale-2048-sim.js the page plays and records only
// what the replay says. Games that look played by a program are
// kept but left off the board.
//
// Players are identified by a random key their browser keeps; only
// its SHA-256 reaches the database. No wallet address ever comes
// here: the page asks the poker function which whales a wallet
// holds, and sends only the whale's number.
//
// ../_shared/whale-2048-sim.js is a copy of the site's file,
// refreshed by tools/sync-backend.js before deploy.
// ============================================================

import '../_shared/whale-2048-sim.js';

// deno-lint-ignore no-explicit-any
type Any = any;
// deno-lint-ignore no-explicit-any
const Sim = (globalThis as any).Whale2048;

const HOURLY_GAME_CAP = 60;
const BOARD_SIZE = 20;
const MAX_GAP_MS = 600000;            // gaps are clipped to ten minutes by the page

/* Avatars, exactly as at the Cigar Lounge: an OG whale (by number) or
   one of our pfps. The browser says which; the picture is looked up
   here, from OpenSea, so nobody can slip a link onto the board. */
const OG = { contract: '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5' };
const ALT_PFPS = 6;
const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(seadn\.io|opensea\.io|openseauserdata\.com)\//;

export function createHandler(db: Any, deps: { now?: () => number; opensea?: (path: string) => Promise<Any> } = {}) {
    const now = deps.now ?? (() => Date.now());
    const opensea = deps.opensea ?? openseaGet;

    const CORS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    class Fail extends Error {
        status: number;
        constructor(status: number, message: string) {
            super(message);
            this.status = status;
        }
    }

    function reply(status: number, body: unknown) {
        return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
    }

    async function sha256(text: string) {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
    }

    async function keyHash(raw: unknown) {
        if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) throw new Fail(400, 'bad player key');
        return await sha256(raw);
    }

    function first(data: Any) {
        return Array.isArray(data) ? (data[0] ?? null) : data;
    }

    function num(v: unknown) {
        return v === null || v === undefined ? null : Number(v);
    }

    async function me(kh: string) {
        const { data, error } = await db.rpc('w2_me', { p_key_hash: kh });
        if (error) throw new Fail(500, 'could not look you up');
        return first(data);
    }

    /* ---------- avatars ---------- */

    function cleanAvatar(a: Any) {
        if (a && a.kind === 'og') {
            const id = Number(a.id);
            if (!Number.isInteger(id) || id < 1 || id > 10000) throw new Fail(400, 'that isn’t an OG whale number');
            return { kind: 'og', id };
        }
        if (!a || a.kind === 'alt') {
            const v = a ? Number(a.v) : 0;
            if (!Number.isInteger(v) || v < 0 || v >= ALT_PFPS) throw new Fail(400, 'unknown pfp');
            return { kind: 'alt', v };
        }
        throw new Fail(400, 'unknown avatar');
    }

    function safeImage(url: unknown): string | null {
        return typeof url === 'string' && IMAGE_HOSTS.test(url) ? url : null;
    }

    /* the picture for an OG whale; shares the Cigar Lounge's cache */
    async function avatarImage(a: Any): Promise<string | null> {
        if (a.kind === 'alt') return 'images/pfp/whale-' + a.v + '.svg';
        const k = 'img:og:' + a.id;
        const { data } = await db.from('pk_cache').select('data, fetched_at').eq('key', k).maybeSingle();
        if (data) {
            const age = now() - new Date(data.fetched_at).getTime();
            const hit = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
            if (age >= 0 && age < IMAGE_TTL_MS && hit && safeImage(hit.image)) return hit.image;
        }
        try {
            const j = await opensea('/api/v2/chain/ethereum/contract/' + OG.contract + '/nfts/' + a.id);
            const image = safeImage(j && j.nft && (j.nft.display_image_url || j.nft.image_url));
            if (image) await db.rpc('pk_cache_put', { p_key: k, p_data: { image } });
            return image;
        } catch {
            return null;                 // the board shows a pfp until next time
        }
    }

    /* ---------- actions ---------- */

    async function start(b: Any) {
        const kh = await keyHash(b.key);
        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const { data, error } = await db.rpc('w2_start', {
            p_key_hash: kh, p_seed: seed, p_version: Sim.VERSION, p_hourly_cap: HOURLY_GAME_CAP
        });
        if (error) {
            if (/too many/.test(error.message)) throw new Fail(429, 'that’s a lot of games this hour — take a breather');
            throw new Fail(500, 'could not start a game');
        }
        const row = first(data);
        return { runId: row.run_id, seed, version: Sim.VERSION };
    }

    async function save(b: Any) {
        const kh = await keyHash(b.key);
        const moves = b.moves;
        if (typeof moves !== 'string' || !/^[UDLR]*$/.test(moves) || moves.length > Sim.MAX_MOVES) throw new Fail(400, 'bad move log');
        let gaps: number[] = [];
        if (Array.isArray(b.gaps) && b.gaps.length === moves.length) {
            gaps = b.gaps.map((g: unknown) => Math.max(0, Math.min(MAX_GAP_MS, Math.round(Number(g)) || 0)));
        }
        const final = b.final === true;

        const player = await me(kh);
        if (!player) throw new Fail(404, 'that game ticket isn’t valid');
        const { data: run } = await db.from('w2_runs')
            .select('id, player_id, seed, version, started_at, finished_at, moves, score, top')
            .eq('id', String(b.runId ?? ''))
            .maybeSingle();
        if (!run || run.player_id !== player.player_id) throw new Fail(404, 'that game ticket isn’t valid');
        if (run.finished_at) throw new Fail(409, 'that game is already over');
        if (Number(run.version) !== Sim.VERSION) throw new Fail(409, 'the game was updated — reload the page');

        // an older save arriving late: keep what we have
        if (moves.length < run.moves.length) {
            const s = await me(kh);
            return { score: run.score, top: run.top, best: num(s.best), rank: num(s.rank), named: !!s.name, flagged: false, stale: true };
        }
        if (!moves.startsWith(run.moves)) throw new Fail(409, 'that isn’t the same game');

        let result: Any;
        try {
            result = Sim.replay(Number(run.seed), moves);
        } catch {
            throw new Fail(400, 'bad move log');
        }
        if (result.noops) throw new Fail(400, 'bad move log');

        const elapsed = now() - new Date(run.started_at).getTime();
        const reasons: string[] = Sim.judge(result.count, gaps, elapsed);
        const suspect = reasons.length > 0;

        const { data, error } = await db.rpc('w2_save', {
            p_run: run.id, p_player: player.player_id, p_moves: moves, p_score: result.score, p_top: result.top,
            p_final: final || result.over, p_suspect: suspect,
            p_tells: { reasons, elapsedMs: elapsed, moves: result.count, claimed: typeof b.clientScore === 'number' ? b.clientScore : null }
        });
        if (error) throw new Fail(409, 'that game was already saved as over');
        const row = first(data);

        // reasons stay here: no point teaching a bot what gave it away
        return {
            score: result.score,
            top: result.top,
            over: result.over,
            best: num(row && row.best),
            rank: num(row && row.rank),
            named: !!(row && row.named),
            flagged: suspect
        };
    }

    async function claim(b: Any) {
        const kh = await keyHash(b.key);
        const checked = Sim.checkName(b.name);
        if (checked.error) throw new Fail(400, checked.error);
        const avatar = cleanAvatar(b.avatar);
        const image = await avatarImage(avatar);
        const { data, error } = await db.rpc('w2_claim', { p_key_hash: kh, p_name: checked.name, p_avatar: avatar, p_image: image });
        if (error) {
            if (error.code === '23505') throw new Fail(409, 'That name is taken — try another.');
            throw new Fail(500, 'could not save your name');
        }
        const row = first(data);
        return { name: checked.name, avatar, image, best: num(row && row.best), top: num(row && row.top), rank: num(row && row.rank) };
    }

    async function board(b: Any) {
        const { data, error } = await db.from('w2_board')
            .select('player_id, name, avatar, image, score, top, updated_at')
            .order('score', { ascending: false })
            .order('updated_at', { ascending: true })
            .limit(BOARD_SIZE);
        if (error) throw new Fail(500, 'could not load the leaderboard');
        let you: Any = null;
        if (b.key) {
            const p = await me(await keyHash(b.key));
            if (p) you = { id: p.player_id, name: p.name, avatar: p.avatar, image: p.image, best: num(p.best), top: num(p.top), rank: num(p.rank) };
        }
        const rows = (data ?? []).map((r: Any) => ({
            name: r.name,
            avatar: typeof r.avatar === 'string' ? JSON.parse(r.avatar) : r.avatar,
            image: r.image,
            score: r.score,
            top: r.top,
            you: !!(you && r.player_id === you.id)
        }));
        if (you) delete you.id;
        return { rows, you };
    }

    const ACTIONS: Record<string, (b: Any) => Promise<unknown>> = { start, save, claim, board };

    return async function handle(req: Request): Promise<Response> {
        if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        let body: Any;
        try {
            body = await req.json();
        } catch {
            return reply(400, { error: 'bad request' });
        }
        const fn = ACTIONS[body && body.action];
        if (!fn) return reply(400, { error: 'unknown action' });
        try {
            return reply(200, await fn(body));
        } catch (e) {
            if (e instanceof Fail) return reply(e.status, { error: e.message });
            console.error(e);
            return reply(500, { error: 'something went wrong' });
        }
    };
}

/* OpenSea's API, with the key from the project's secrets (the same one
   the poker function uses). The key never leaves the server. */
async function openseaGet(path: string): Promise<Any> {
    const key = Deno.env.get('OPENSEA_API_KEY');
    if (!key) throw new Error('no OpenSea key configured');
    const res = await fetch('https://api.opensea.io' + path, {
        headers: { 'x-api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
    });
    if (res.status === 404) return { nft: null };
    if (!res.ok) throw new Error('OpenSea ' + res.status);
    return await res.json();
}
