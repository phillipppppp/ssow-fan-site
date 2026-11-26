// ============================================================
// pool handler — the referee for Whale Pool's online games.
//
// One endpoint, POST { action, ... }:
//   create   host a game: { kind: 'match' | 'tournament', mode, guides,
//            name, avatar, cue } -> code, your key, the public view
//   join     take the free seat of a 1v1 link (that starts the game),
//            or sign up for a tournament that hasn't started
//   leave    give your place back before the start
//   start    tournament host only, two or more signed up
//   shot     your shot: { no, input } (no = the position you aimed at)
//   rematch  after a 1v1 rack: when both press it, the next rack starts
//   tick     let the clock run: shot-clock fouls, the next rack
//   me       which seat or entrant your key is
//   state    the public view (and one match of a tournament)
//
// A 1v1 link: the first friend to open it plays the host; anyone
// after that can only watch. Racks go on as long as both want a
// rematch, the break alternating, and the score is kept.
//
// A tournament: up to T_MAX players on one link, a knockout. The
// host presses Start, everyone is drawn into a bracket (byes when the
// numbers aren't a power of two) and every match plays at once on
// its own table; a match in the next round starts as soon as both its
// players are known. One rack a match, but the final is best of 3.
//
// Every shot is replayed here with the site's own whale-pool-sim.js
// (exact, see the note in that file), so a browser can only say where
// it aimed, never where the balls went. The shooter's browser plays
// the same shot at once and gets the same result; everyone else
// replays it from the public `last` record.
//
// The shot clock: SHOT_MS a shot (counted from when the last shot
// stops rolling on screen). Running out is a foul: ball in hand to the
// other player. Running out TIMEOUT_LIMIT times in a row loses the
// rack, so a tournament keeps moving when somebody never shows up.
// There's no server process between requests, so browsers call tick
// when they see a deadline pass; every write also settles anything due.
//
// Public views are saved in parts (see the migration): `main` for the
// game, plus one part per tournament match, and only parts that
// changed are written, so Realtime only pushes what moved.
//
// ../_shared/whale-pool-sim.js is a copy of the site's file, refreshed
// by tools/sync-backend.js before deploy.
// ============================================================

import '../_shared/whale-pool-sim.js';

// deno-lint-ignore no-explicit-any
const S = (globalThis as any).WhalePoolSim;

// deno-lint-ignore no-explicit-any
type Any = any;

export const SHOT_MS = 45000;          // time for a shot
export const GRACE_MS = 20000;         // extra time for the first shot of a tournament match: time to turn up
export const FUN_GRACE_MS = 5000;      // ...and of a 1v1 rack
export const BETWEEN_MS = 8000;        // between the racks of a best-of-3
export const TIMEOUT_LIMIT = 3;        // shot-clock fouls in a row that lose the rack
export const T_MAX = 32;               // players in one tournament (raise when the pod outgrows it)
const ANIM_SPEED = 1.3;                // the page plays shots a bit faster than real time
const ANIM_PAD_MS = 2500;              // the pause after a shot, before the next turn
const ANIM_MAX_MS = 30000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MODES = ['8', '9', '10'];
const GUIDES = ['full', 'short', 'off'];
/* the cue in each player's hand: looks only online (every cue plays the same) */
const CUE_IDS = ['house', 'pixel', 'cigar', 'rainbow', 'neon', 'laser', 'orca', 'narwhal', 'kraken', 'golden', 'wealthy', 'staff', 'trident'];

/* Avatars, exactly as at the Cigar Lounge: either one of your OG whales
   (by token id) or one of our own pfps. The browser only says which; the
   server finds the picture, so nobody can slip in a link. */
const OG_CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';
const ALT_PFPS = 6;
const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IMAGE_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(seadn\.io|opensea\.io|openseauserdata\.com)\//;

export function createHandler(db: Any, deps: { now?: () => number; random32?: () => number; opensea?: (path: string) => Promise<Any> } = {}) {
    const now = deps.now ?? (() => Date.now());
    const opensea = deps.opensea ?? openseaGet;
    const random32 = deps.random32 ?? randomU32;

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

    /* ---------- small helpers ---------- */

    function newKey(): string {
        const b = new Uint8Array(24);
        crypto.getRandomValues(b);
        return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function newCode(): string {
        const b = new Uint8Array(6);
        crypto.getRandomValues(b);
        return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
    }

    async function hash(key: string): Promise<string> {
        const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
        return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
    }

    /* supabase-js returns a function's scalar as data; the local test
       stand-in returns rows. Accept both. */
    function scalar(data: Any): Any {
        if (Array.isArray(data)) return data.length ? Object.values(data[0])[0] : null;
        return data;
    }

    function cleanCode(raw: unknown): string {
        const c = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (c.length !== 6) throw new Fail(400, 'game codes are 6 letters and numbers');
        return c;
    }

    function cleanName(raw: unknown): string {
        const n = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
        if (n.length < 2 || n.length > 16) throw new Fail(400, 'pick a name of 2 to 16 characters');
        if (!/^[\p{L}\p{N} _.\-]+$/u.test(n)) throw new Fail(400, 'names can use letters, numbers, spaces and _ . -');
        return n;
    }

    function cleanAvatar(b: Any) {
        const a = b && b.avatar ? b.avatar : { kind: 'alt', v: 0 };
        if (a.kind === 'og') {
            const id = Number(a.id);
            if (!Number.isInteger(id) || id < 1 || id > 10000) throw new Fail(400, 'that isn’t an OG whale number');
            return { kind: 'og', id };
        }
        if (a.kind === 'alt') {
            const v = Number(a.v);
            if (!Number.isInteger(v) || v < 0 || v >= ALT_PFPS) throw new Fail(400, 'unknown pfp');
            return { kind: 'alt', v };
        }
        throw new Fail(400, 'unknown avatar');
    }

    function cleanCue(raw: unknown): string {
        const c = String(raw ?? '');
        return CUE_IDS.includes(c) ? c : 'house';
    }

    function cleanSettings(b: Any) {
        return {
            mode: MODES.includes(String(b.mode)) ? String(b.mode) : '8',
            guides: GUIDES.includes(String(b.guides)) ? String(b.guides) : 'full'
        };
    }

    /* a shot as the browser sent it, kept as plain numbers: the replay must
       be handed exactly the same input (the sim does its own rounding) */
    function cleanShot(raw: Any) {
        const num = (v: unknown) => {
            const n = Number(v);
            if (!Number.isFinite(n) || Math.abs(n) > 1e6) throw new Fail(400, 'that shot doesn’t make sense');
            return n;
        };
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.dir) || raw.dir.length !== 2) throw new Fail(400, 'no aim');
        const out: Any = { dir: [num(raw.dir[0]), num(raw.dir[1])], power: num(raw.power), spin: [0, 0] };
        if (Array.isArray(raw.spin) && raw.spin.length === 2) out.spin = [num(raw.spin[0]), num(raw.spin[1])];
        if (Array.isArray(raw.cue) && raw.cue.length === 2) out.cue = [num(raw.cue[0]), num(raw.cue[1])];
        if (raw.call && typeof raw.call === 'object') out.call = { ball: num(raw.call.ball), pocket: num(raw.call.pocket) };
        return out;
    }

    /* ---------- pictures for OG whales, through the Lounge's cache ---------- */

    async function cacheGet(k: string, ttl: number) {
        const { data } = await db.from('pk_cache').select('data, fetched_at').eq('key', k).maybeSingle();
        if (!data) return null;
        const age = now() - new Date(data.fetched_at).getTime();
        if (!(age >= 0 && age < ttl)) return null;
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
    }

    function safeImage(url: unknown): string | null {
        return typeof url === 'string' && IMAGE_HOSTS.test(url) ? url : null;
    }

    async function avatarImage(a: Any): Promise<string | null> {
        if (a.kind === 'alt') return 'images/pfp/whale-' + a.v + '.svg';
        const k = 'img:og:' + a.id;
        try {
            const hit = await cacheGet(k, IMAGE_TTL_MS);
            if (hit && hit.image) return hit.image;
            const j = await opensea('/api/v2/chain/ethereum/contract/' + OG_CONTRACT + '/nfts/' + a.id);
            const image = safeImage(j && j.nft && (j.nft.display_image_url || j.nft.image_url));
            if (image) await db.rpc('pk_cache_put', { p_key: k, p_data: { image } });
            return image;
        } catch {
            return null;                 // the table shows a pfp until next time
        }
    }

    async function person(b: Any, keyHash: string) {
        const name = cleanName(b.name);
        const avatar = cleanAvatar(b);
        const image = await avatarImage(avatar);
        return { name, avatar, image, cue: cleanCue(b.cue), keyHash };
    }

    /* ======================================================
       A match: two players, one rack at a time
       ====================================================== */

    function newMatch(id: string, seats: number[], bestOf: number, fun: boolean) {
        return {
            id, seats, bestOf, fun, wins: [0, 0], games: [] as Any[], status: 'pending', winner: -1,
            breaker: random32() % 2, gameNo: 0, game: null as Any, shotNo: 0, last: null as Any,
            deadline: 0, nextAt: 0, timeouts: [0, 0], rematch: [false, false], startedAt: 0
        };
    }

    /* a fresh rack: the breaker is in hand behind the line */
    function rack(m: Any, mode: string, grace: number) {
        m.gameNo++;
        m.game = S.newGame(mode, random32() || 1);
        m.game.turn = m.breaker;
        m.shotNo++;
        m.last = { no: m.shotNo, kind: 'rack', seat: m.breaker, at: now() };
        m.status = 'playing';
        m.timeouts = [0, 0];
        m.rematch = [false, false];
        m.deadline = now() + grace + SHOT_MS;
        m.nextAt = 0;
        if (!m.startedAt) m.startedAt = now();
    }

    /* how long the shot takes to play out on screen */
    function animMs(run: Any) {
        return Math.min(ANIM_MAX_MS, Math.round(run.time * 1000 / ANIM_SPEED)) + ANIM_PAD_MS;
    }

    /* a rack is decided: `by` is whoever's shot (or clock) settled it,
       `why` what happened, from their side ("potted the 8") */
    function endRack(m: Any, w: number, by: number, why: string, settleIn: number) {
        m.wins[w]++;
        m.games.push({ w, by, why });
        m.deadline = 0;
        if (m.fun) { m.status = 'over'; return; }
        if (m.wins[w] >= Math.floor(m.bestOf / 2) + 1) {
            m.status = 'done';
            m.winner = w;
        } else {
            m.status = 'between';
            m.breaker = 1 - m.breaker;
            m.nextAt = now() + settleIn + BETWEEN_MS;
        }
    }

    function shotIn(m: Any, seat: number, raw: Any, no: unknown) {
        if (m.status !== 'playing' || !m.game || m.game.over) throw new Fail(409, 'the rack isn’t in play');
        if (m.game.turn !== seat) throw new Fail(409, 'it’s not your shot');
        if (Number(no) !== m.shotNo) throw new Fail(409, 'the table has moved on since you aimed');
        const input = cleanShot(raw);
        const before = m.game;
        let run: Any;
        try { run = S.begin(before, input); } catch (e) { throw new Fail(400, (e as Error).message); }
        S.runToEnd(run);
        const res = S.finish(before, run);
        const o = res.outcome;
        const anim = animMs(run);
        m.game = res.state;
        m.shotNo++;
        m.timeouts[seat] = 0;
        m.last = {
            no: m.shotNo, kind: 'shot', seat, before, input, at: now(), anim,
            foul: o.foul, potted: o.potted, cont: o.cont, assigned: o.assigned, respotted: o.respotted,
            calledIn: o.calledIn, firstHit: o.firstHit
        };
        if (res.state.over) endRack(m, res.state.winner, seat, res.state.reason, anim);
        else m.deadline = now() + anim + SHOT_MS;
    }

    /* the shot clock ran out: a foul, ball in hand to the other player
       (on the break, the other player breaks instead) */
    function timeOut(m: Any) {
        const s = m.game.turn;
        m.timeouts[s]++;
        m.shotNo++;
        const g = JSON.parse(JSON.stringify(m.game));
        if (m.timeouts[s] >= TIMEOUT_LIMIT) {
            const why = 'ran out of time ' + TIMEOUT_LIMIT + ' times in a row';
            g.over = true;
            g.winner = 1 - s;
            g.reason = why;
            m.game = g;
            m.last = { no: m.shotNo, kind: 'forfeit', seat: s, at: now() };
            endRack(m, 1 - s, s, why, 0);
            return;
        }
        g.turn = 1 - s;
        if (g.broke) g.inHand = 'any';
        m.game = g;
        m.last = { no: m.shotNo, kind: 'timeout', seat: s, at: now() };
        m.deadline = now() + SHOT_MS;
    }

    /* everything due for one match; true if it changed */
    function settleMatch(m: Any, mode: string): boolean {
        let changed = false;
        for (let guard = 0; guard < 4; guard++) {
            if (m.status === 'playing' && m.deadline && now() >= m.deadline) { timeOut(m); changed = true; continue; }
            if (m.status === 'between' && m.nextAt && now() >= m.nextAt) { rack(m, mode, 0); changed = true; continue; }
            break;
        }
        return changed;
    }

    /* ======================================================
       Public views, in parts
       ====================================================== */

    function pubPerson(p: Any) {
        return p && { name: p.name, avatar: p.avatar, image: p.image || null, cue: p.cue };
    }

    function pubMatch(m: Any) {
        return {
            id: m.id, seats: m.seats, bestOf: m.bestOf, fun: !!m.fun, wins: m.wins, games: m.games,
            status: m.status, winner: m.winner, breaker: m.breaker, gameNo: m.gameNo, game: m.game,
            shotNo: m.shotNo, last: m.last, deadline: m.deadline, nextAt: m.nextAt, timeouts: m.timeouts,
            rematch: m.rematch, startedAt: m.startedAt, shotMs: SHOT_MS, limit: TIMEOUT_LIMIT
        };
    }

    function isT(st: Any) { return st.kind === 'tournament'; }

    function parts(st: Any): Record<string, Any> {
        if (!isT(st)) {
            return {
                main: {
                    kind: 'match', code: st.code, status: st.status, settings: st.settings, host: st.host,
                    players: st.players.map(pubPerson), match: st.match ? pubMatch(st.match) : null
                }
            };
        }
        const out: Record<string, Any> = {
            main: {
                kind: 'tournament', code: st.code, status: st.status, settings: st.settings, host: st.host,
                entrants: st.entrants.map((e: Any) => e && Object.assign(pubPerson(e), { place: e.place || 0, at: e.at || '' })),
                rounds: st.rounds.map((r: Any[]) => r.map((m: Any) => ({
                    id: m.id, seats: m.seats, bestOf: m.bestOf, wins: m.wins, winner: m.winner, status: m.status
                }))),
                winner: st.winner, startedAt: st.startedAt || 0, finishedAt: st.finishedAt || 0
            }
        };
        for (const r of st.rounds) for (const m of r) if (m.game) out[m.id] = pubMatch(m);
        return out;
    }

    function stamp(part: Any, version: number) {
        return Object.assign({}, part, { version, now: now() });
    }

    /* ---------- storage ---------- */

    async function load(code: string) {
        const { data, error } = await db.from('pl_tables').select('code, version, state').eq('code', code).maybeSingle();
        if (error) throw new Fail(500, 'could not read the game');
        if (!data) throw new Fail(404, 'no game with that code (games close after a day without play)');
        return data;
    }

    /* Read, change, save — and if someone saved in between, start over
       from their version. fn returns false for "nothing to save". Only
       the public parts that changed are written. */
    async function mutate(code: string, fn: (st: Any) => Any) {
        for (let attempt = 0; attempt < 14; attempt++) {
            /* sixteen matches can shoot in the same second: losers of a race wait a moment, longer each time */
            if (attempt > 0) await new Promise((r) => setTimeout(r, 15 + Math.floor(Math.random() * 40 * Math.min(attempt, 6))));
            const row = await load(code);
            const st = row.state;
            const before: Record<string, string> = {};
            const was = parts(st);
            for (const k of Object.keys(was)) before[k] = JSON.stringify(was[k]);
            const out = await fn(st);
            if (out === false) return { st, version: row.version, saved: false, out };
            st.version = row.version + 1;
            const after = parts(st);
            const changed: Record<string, Any> = {};
            for (const k of Object.keys(after)) if (JSON.stringify(after[k]) !== before[k]) changed[k] = stamp(after[k], st.version);
            const { data, error } = await db.rpc('pl_save', { p_code: code, p_version: row.version, p_state: st, p_parts: changed });
            if (error) throw new Fail(500, 'could not save the game');
            if (scalar(data) === true) return { st, version: st.version, saved: true, out };
        }
        throw new Fail(409, 'the table is busy — try again');
    }

    function view(st: Any, version: number, part?: string) {
        const p = parts(st);
        const out: Any = { main: stamp(p.main, version) };
        if (part && p[part]) out.match = stamp(p[part], version);
        return out;
    }

    async function seatOf(st: Any, key: unknown): Promise<number> {
        if (typeof key !== 'string' || key.length < 16) throw new Fail(401, 'not playing in this game');
        const h = await hash(key);
        const list = isT(st) ? st.entrants : st.players;
        const i = list.findIndex((p: Any) => p && p.keyHash === h);
        if (i < 0) throw new Fail(401, 'not playing in this game');
        return i;
    }

    /* ======================================================
       Tournaments: the bracket
       ====================================================== */

    function matchById(st: Any, id: string) {
        const m = /^m(\d{1,2})_(\d{1,2})$/.exec(String(id || ''));
        if (!m) return null;
        const r = st.rounds[Number(m[1])];
        return r ? r[Number(m[2])] || null : null;
    }

    function roundOf(id: string) { return Number(/^m(\d+)_/.exec(id)![1]); }
    function slotOf(id: string) { return Number(/_(\d+)$/.exec(id)![1]); }

    /* a match is decided: the loser's finishing place, the winner on to the next round */
    function advance(st: Any, m: Any) {
        const R = st.rounds.length;
        const r = roundOf(m.id), i = slotOf(m.id);
        const w = m.seats[m.winner];
        const l = m.seats[1 - m.winner];
        if (l >= 0) { st.entrants[l].place = Math.pow(2, R - 1 - r) + 1; st.entrants[l].at = ''; }
        if (r === R - 1) {
            st.entrants[w].place = 1;
            st.entrants[w].at = '';
            st.winner = w;
            st.status = 'finished';
            st.finishedAt = now();
            return;
        }
        const next = st.rounds[r + 1][i >> 1];
        next.seats[i & 1] = w;
        st.entrants[w].at = next.id;
        if (next.seats[0] >= 0 && next.seats[1] >= 0) rack(next, st.settings.mode, GRACE_MS);
    }

    function tSettle(st: Any): boolean {
        if (st.status !== 'playing') return false;
        let changed = false;
        for (let pass = 0; pass < 4 && st.status === 'playing'; pass++) {
            let any = false;
            for (const r of st.rounds) {
                for (const m of r) {
                    if (m.status !== 'playing' && m.status !== 'between') continue;
                    if (settleMatch(m, st.settings.mode)) {
                        any = true;
                        if (m.status === 'done') advance(st, m);
                    }
                    if (st.status !== 'playing') break;
                }
            }
            if (!any) break;
            changed = true;
        }
        return changed;
    }

    function settleAll(st: Any): boolean {
        if (isT(st)) return tSettle(st);
        if (st.status !== 'playing' || !st.match) return false;
        return settleMatch(st.match, st.settings.mode);
    }

    function tStart(st: Any) {
        const who = st.entrants.map((e: Any, k: number) => e ? k : -1).filter((k: number) => k >= 0);
        if (who.length < 2) throw new Fail(409, 'wait for at least one more player');
        for (let k = who.length - 1; k > 0; k--) {
            const j = random32() % (k + 1);
            const t = who[k]; who[k] = who[j]; who[j] = t;
        }
        const N = who.length;
        let R = 1;
        while (Math.pow(2, R) < N) R++;
        const P = Math.pow(2, R);
        /* byes go to every other first-round match first, so two byes rarely meet in round two */
        const order: number[] = [];
        for (let i = 0; i < P / 2; i += 2) order.push(i);
        for (let i = 1; i < P / 2; i += 2) order.push(i);
        const bye = new Set(order.slice(0, P - N));
        st.rounds = [];
        for (let r = 0; r < R; r++) {
            const n = Math.pow(2, R - 1 - r);
            const list = [];
            for (let i = 0; i < n; i++) list.push(newMatch('m' + r + '_' + i, [-2, -2], r === R - 1 ? 3 : 1, false));
            st.rounds.push(list);
        }
        let take = 0;
        st.rounds[0].forEach((m: Any, i: number) => {
            m.seats = bye.has(i) ? [who[take++], -1] : [who[take++], who[take++]];
        });
        st.status = 'playing';
        st.startedAt = now();
        for (const m of st.rounds[0]) {
            for (const e of m.seats) if (e >= 0) st.entrants[e].at = m.id;
            if (m.seats[1] < 0) {
                /* a bye: through to the next round without playing */
                m.status = 'done';
                m.winner = 0;
                advance(st, m);
            } else {
                rack(m, st.settings.mode, GRACE_MS);
            }
        }
        return true;
    }

    /* ======================================================
       Actions
       ====================================================== */

    async function create(b: Any) {
        const tournament = b.kind === 'tournament';
        const settings = Object.assign(cleanSettings(b), tournament ? { max: T_MAX } : {});
        const key = newKey();
        const me = await person(b, await hash(key));
        await db.rpc('pl_cleanup', {});
        for (let attempt = 0; attempt < 6; attempt++) {
            const code = newCode();
            const st: Any = tournament
                ? { code, version: 1, kind: 'tournament', status: 'waiting', settings, host: 0, entrants: [Object.assign(me, { place: 0, at: '' })], rounds: [], winner: -1, createdAt: now(), startedAt: 0, finishedAt: 0 }
                : { code, version: 1, kind: 'match', status: 'waiting', settings, host: 0, players: [me, null], match: null, createdAt: now() };
            const p = parts(st);
            const first: Record<string, Any> = {};
            for (const k of Object.keys(p)) first[k] = stamp(p[k], 1);
            const { data, error } = await db.rpc('pl_create', { p_code: code, p_state: st, p_parts: first });
            if (error) throw new Fail(500, 'could not open a game');
            if (scalar(data) === true) return Object.assign({ code, key, seat: tournament ? -1 : 0, entrant: tournament ? 0 : -1 }, view(st, 1));
        }
        throw new Fail(500, 'could not find a free code — try again');
    }

    async function join(b: Any) {
        const code = cleanCode(b.code);
        const key = newKey();
        const who = await person(b, await hash(key));
        const lower = who.name.toLowerCase();
        const r = await mutate(code, (st: Any) => {
            if (isT(st)) {
                if (st.status !== 'waiting') throw new Fail(409, 'this tournament has already started — you can watch it');
                if (st.entrants.some((e: Any) => e && e.name.toLowerCase() === lower)) throw new Fail(409, 'someone in this tournament already uses that name');
                if (st.entrants.filter(Boolean).length >= st.settings.max) throw new Fail(409, 'this tournament is full (' + st.settings.max + ' players)');
                const e = Object.assign(who, { place: 0, at: '' });
                /* reuse a place someone left, so everyone else keeps their number */
                let i = st.entrants.findIndex((x: Any) => !x);
                if (i < 0) { i = st.entrants.length; st.entrants.push(e); } else st.entrants[i] = e;
                return { entrant: i };
            }
            if (st.status === 'closed') throw new Fail(409, 'this game was closed');
            if (st.players[1]) throw new Fail(409, 'this game already has two players — you can watch it');
            if (st.players[0].name.toLowerCase() === lower) throw new Fail(409, 'the host already uses that name');
            st.players[1] = who;
            st.match = newMatch('m', [0, 1], 1, true);
            rack(st.match, st.settings.mode, FUN_GRACE_MS);
            st.status = 'playing';
            return { seat: 1 };
        });
        return Object.assign({ code, key, seat: r.out.seat ?? -1, entrant: r.out.entrant ?? -1 }, view(r.st, r.version));
    }

    async function leave(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, async (st: Any) => {
            const i = await seatOf(st, b.key);
            if (!isT(st)) {
                if (st.status !== 'waiting') return false;     // a started game just goes on without you
                st.status = 'closed';
                return true;
            }
            if (st.status !== 'waiting') return false;
            st.entrants[i] = null;
            if (st.host === i) {
                const next = st.entrants.findIndex((e: Any) => e);
                if (next < 0) st.status = 'closed';
                else st.host = next;
            }
            return true;
        });
        return view(r.st, r.version);
    }

    async function start(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, async (st: Any) => {
            if (!isT(st)) throw new Fail(400, 'a 1v1 game starts when your friend joins');
            const i = await seatOf(st, b.key);
            if (st.host !== i) throw new Fail(403, 'only the host can start the tournament');
            if (st.status !== 'waiting') throw new Fail(409, 'this tournament has already started');
            return tStart(st);
        });
        return view(r.st, r.version);
    }

    async function shot(b: Any) {
        const code = cleanCode(b.code);
        let part = '';
        const r = await mutate(code, async (st: Any) => {
            const i = await seatOf(st, b.key);
            /* the clock first: a shot after it ran out is too late — but the
               foul that replaced it still has to be saved, so report it */
            const moved = settleAll(st);
            let m: Any, seat: number;
            if (isT(st)) {
                if (st.status !== 'playing') throw new Fail(409, 'the tournament isn’t running');
                m = matchById(st, st.entrants[i].at);
                seat = m ? m.seats.indexOf(i) : -1;
                if (!m || seat < 0) throw new Fail(409, st.entrants[i].place ? 'you’re out of this tournament' : 'you’re not at a table right now');
                part = m.id;
            } else {
                if (st.status !== 'playing' || !st.match) throw new Fail(409, 'the game isn’t running');
                m = st.match;
                seat = i;
            }
            if (moved && (m.status !== 'playing' || m.game.turn !== seat || Number(b.no) !== m.shotNo)) return { late: true };
            shotIn(m, seat, b.input, b.no);
            if (isT(st) && m.status === 'done') advance(st, m);
            return true;
        });
        if (r.out && r.out.late) throw new Fail(409, 'your time ran out: ball in hand to the other player');
        return view(r.st, r.version, part);
    }

    async function rematch(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, async (st: Any) => {
            if (isT(st)) throw new Fail(400, 'tournament matches can’t be replayed');
            const i = await seatOf(st, b.key);
            const m = st.match;
            if (!m || m.status !== 'over') return false;
            if (m.rematch[i]) return false;
            m.rematch[i] = true;
            if (m.rematch[0] && m.rematch[1]) {
                m.breaker = 1 - m.breaker;                  // the break goes back and forth
                rack(m, st.settings.mode, FUN_GRACE_MS);
            }
            return true;
        });
        return view(r.st, r.version);
    }

    async function tick(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, (st: Any) => settleAll(st) ? true : false);
        return Object.assign({ changed: r.saved }, view(r.st, r.version, typeof b.part === 'string' ? b.part : ''));
    }

    async function me(b: Any) {
        const code = cleanCode(b.code);
        const row = await load(code);
        const st = row.state;
        const i = await seatOf(st, b.key);
        if (isT(st)) return { entrant: i, seat: -1, host: st.host === i, at: st.entrants[i].at || '', place: st.entrants[i].place || 0 };
        return { seat: i, entrant: -1, host: st.host === i };
    }

    async function state(b: Any) {
        const row = await load(cleanCode(b.code));
        return view(row.state, row.version, typeof b.part === 'string' ? b.part : '');
    }

    const ACTIONS: Record<string, (b: Any) => Promise<unknown>> = { create, join, leave, start, shot, rematch, tick, me, state };

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

function randomU32(): number {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
}

/* OpenSea's API, with the key from the function's secrets (the same one the
   Lounge uses). The key never leaves the server. */
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
