// ============================================================
// poker handler — the dealer for Cigar Lounge tables.
//
// One endpoint, POST { action, ... }:
//   wallet  a wallet's OG whales, from OpenSea (the key stays here)
//   create  host a table: settings + your name and avatar -> code, seat key
//   join    take a seat at a table that hasn't started
//   leave   give your seat back (before the start only)
//   start   host only, two or more seated
//   act     fold / check / call / raise, on your turn
//   me      your own two cards (nobody else's, ever)
//   back    stop sitting out
//   tick    let the clock run: time-outs, sitting-out players, next hand
//   state   the public table, for a first load or a missed update
//
// The deck and every hole card live only in pk_tables, which no
// browser can read. Everything a browser may see is projected into
// pk_public (and pushed over Realtime) by publicView() below, from
// PokerEngine.view(table, -1): hole cards there are face-down until
// the showdown.
//
// There is no server process between requests, so the clock only
// moves when somebody calls: every browser at the table calls tick
// when it sees a deadline pass. Ticks are idempotent and decided by
// the server's own clock, so a browser can't cheat the timer.
//
// ../_shared/poker-engine.js is a copy of the site's file, refreshed
// by tools/sync-backend.js before deploy.
// ============================================================

import '../_shared/poker-engine.js';

// deno-lint-ignore no-explicit-any
const E = (globalThis as any).PokerEngine;

// deno-lint-ignore no-explicit-any
type Any = any;

export const TURN_MS = 25000;       // time to act
export const RESULT_MS = 4500;      // pause after a hand nobody showed down
export const SHOWDOWN_MS = 7000;    // pause to look at shown cards
const SPEED_MIN: Record<string, number> = { turbo: 5, regular: 8, slow: 12 };
// which of the six seats a table of N uses, spread round the rail
const SLOTS: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [1, 2, 4, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOG_TAIL = 120;               // a hand's whole history, even a long raising war

/* Avatars. A player picks either one of their OG whales (by token id)
   or one of our own whale pfps. The browser only ever sends which one;
   the server finds the picture itself, so nobody can slip in a link. */
const OG = { contract: '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5', slug: 'secretsocietyofwhales' };
const ALT_PFPS = 6;                 // images/pfp/whale-0.svg .. whale-5.svg
const WALLET_TTL_MS = 5 * 60 * 1000;
const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WALLET_PAGES = 5;             // 200 a page: plenty for any holder
/* OpenSea's own image servers — the only hosts a whale picture may come from */
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

    /* ---------- small helpers ---------- */

    function randomU32(): number {
        const a = new Uint32Array(1);
        crypto.getRandomValues(a);
        return a[0];
    }

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
        if (c.length !== 6) throw new Fail(400, 'table codes are 6 letters and numbers');
        return c;
    }

    function cleanName(raw: unknown): string {
        const n = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim();
        if (n.length < 2 || n.length > 16) throw new Fail(400, 'pick a name of 2 to 16 characters');
        if (!/^[\p{L}\p{N} _.\-]+$/u.test(n)) throw new Fail(400, 'names can use letters, numbers, spaces and _ . -');
        return n;
    }

    /* { kind: 'og', id } or { kind: 'alt', v } — nothing else, and never a URL.
       (An older page sent just { whale: id }; that still means an OG whale.) */
    function cleanAvatar(b: Any) {
        const a = b && b.avatar ? b.avatar : (b && b.whale !== undefined ? { kind: 'og', id: b.whale } : { kind: 'alt', v: 0 });
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

    /* ---------- OpenSea, through a small cache ---------- */

    async function cacheGet(k: string, ttl: number) {
        const { data } = await db.from('pk_cache').select('data, fetched_at').eq('key', k).maybeSingle();
        if (!data) return null;
        const age = now() - new Date(data.fetched_at).getTime();
        if (!(age >= 0 && age < ttl)) return null;
        return typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
    }

    async function cachePut(k: string, value: unknown) {
        await db.rpc('pk_cache_put', { p_key: k, p_data: value });
    }

    function safeImage(url: unknown): string | null {
        return typeof url === 'string' && IMAGE_HOSTS.test(url) ? url : null;
    }

    /* the picture for an avatar: ours for a pfp, OpenSea's for a whale */
    async function avatarImage(a: Any): Promise<string | null> {
        if (a.kind === 'alt') return 'images/pfp/whale-' + a.v + '.svg';
        const k = 'img:og:' + a.id;
        const hit = await cacheGet(k, IMAGE_TTL_MS);
        if (hit && hit.image) return hit.image;
        try {
            const j = await opensea('/api/v2/chain/ethereum/contract/' + OG.contract + '/nfts/' + a.id);
            const image = safeImage(j && j.nft && (j.nft.display_image_url || j.nft.image_url));
            if (image) await cachePut(k, { image });
            return image;
        } catch {
            return null;                 // the table shows a pfp until next time
        }
    }

    async function wallet(b: Any) {
        const address = String(b.address ?? '').trim().toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Fail(400, 'that doesn’t look like a wallet address');
        const k = 'wallet:' + await hash(address);
        const hit = await cacheGet(k, WALLET_TTL_MS);
        if (hit) return hit;
        const whales: Any[] = [];
        let next = '';
        try {
            for (let page = 0; page < WALLET_PAGES; page++) {
                const j = await opensea('/api/v2/chain/ethereum/account/' + address + '/nfts?collection=' + OG.slug +
                    '&limit=200' + (next ? '&next=' + encodeURIComponent(next) : ''));
                for (const n of (j && j.nfts) || []) {
                    const id = Number(n.identifier);
                    if (n.collection !== OG.slug || !Number.isInteger(id)) continue;
                    whales.push({ id, image: safeImage(n.display_image_url || n.image_url) });
                }
                next = j && j.next;
                if (!next) break;
            }
        } catch (e) {
            if (e instanceof Fail) throw e;
            throw new Fail(502, 'OpenSea isn’t answering right now');
        }
        whales.sort((x, y) => x.id - y.id);
        const out = { count: whales.length, whales };
        await cachePut(k, out);
        // each whale's picture is worth keeping too: joining a table then costs
        // nothing. Saved 25 at a time, so a 100-whale wallet doesn't wait in line.
        const pics = whales.filter((w) => w.image);
        for (let i = 0; i < pics.length; i += 25) {
            await Promise.all(pics.slice(i, i + 25).map((w) => cachePut('img:og:' + w.id, { image: w.image })));
        }
        return out;
    }

    function cleanSettings(b: Any) {
        let chips = Math.round(Number(b.chips) / 10) * 10;
        if (!Number.isFinite(chips)) chips = 1500;
        chips = Math.min(100000, Math.max(200, chips));
        const speed = SPEED_MIN[b.speed] ? String(b.speed) : 'regular';
        let seats = Math.floor(Number(b.seats));
        if (!(seats >= 2 && seats <= 6)) seats = 6;
        return { chips, speed, seats };
    }

    /* ---------- the public projection ---------- */

    function publicView(st: Any) {
        let table = null;
        if (st.engine) {
            table = E.view(st.engine, -1);           // every hole card face-down until shown
            if (table.hand) table.hand.log = table.hand.log.slice(-LOG_TAIL);
        }
        return {
            code: st.code,
            version: st.version,
            now: now(),
            status: st.status,
            settings: st.settings,
            host: st.host,
            players: st.players.map((p: Any) => p && {
                name: p.name,
                avatar: p.avatar,
                image: p.image || null,
                whale: p.avatar && p.avatar.kind === 'og' ? p.avatar.id : 0,   // for pages from before avatars
                sittingOut: !!p.sittingOut
            }),
            startedAt: st.startedAt || 0,
            deadline: st.deadline || 0,
            resultAt: st.resultAt || 0,
            levelMs: SPEED_MIN[st.settings.speed] * 60000,
            turnMs: TURN_MS,
            table
        };
    }

    /* ---------- storage ---------- */

    async function load(code: string) {
        const { data, error } = await db.from('pk_tables').select('code, version, state').eq('code', code).maybeSingle();
        if (error) throw new Fail(500, 'could not read the table');
        if (!data) throw new Fail(404, 'no table with that code (tables close after a day without play)');
        return data;
    }

    /* Read, change, save — and if someone saved in between, start over
       from their version. fn returns false for "nothing to save". */
    async function mutate(code: string, fn: (st: Any) => Any) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const row = await load(code);
            const st = row.state;
            const out = await fn(st);
            if (out === false) return { st, version: row.version, saved: false };
            st.version = row.version + 1;
            const { data, error } = await db.rpc('pk_save', {
                p_code: code, p_version: row.version, p_state: st, p_public: publicView(st)
            });
            if (error) throw new Fail(500, 'could not save the table');
            if (scalar(data) === true) return { st, version: st.version, saved: true, out };
        }
        throw new Fail(409, 'the table is busy — try again');
    }

    async function seatOf(st: Any, key: unknown): Promise<number> {
        if (typeof key !== 'string' || key.length < 16) throw new Fail(401, 'not seated at this table');
        const h = await hash(key);
        const s = st.players.findIndex((p: Any) => p && p.keyHash === h);
        if (s < 0) throw new Fail(401, 'not seated at this table');
        return s;
    }

    /* ---------- the clock ---------- */

    function afterMove(st: Any) {
        const h = st.engine.hand;
        if (h.result) {
            if (st.resultHand !== h.no) { st.resultAt = now(); st.resultHand = h.no; }
            st.deadline = 0;
        } else {
            st.deadline = now() + TURN_MS;
        }
    }

    /* Run everything that's due: auto-moves for sitting-out players and
       anyone whose time ran out, then the next hand once the last one
       has been on screen long enough. Returns true if anything changed. */
    function settle(st: Any): boolean {
        if (st.status !== 'playing') return false;
        const t = st.engine;
        let changed = false;
        for (let guard = 0; guard < 300; guard++) {
            const h = t.hand;
            if (!h || h.result) {
                if (h && h.result) {
                    const wait = h.result.showdown ? SHOWDOWN_MS : RESULT_MS;
                    if (now() < st.resultAt + wait) break;
                }
                if (t.finished) { st.status = 'finished'; st.finishedAt = now(); changed = true; break; }
                t.levelIndex = Math.floor((now() - st.startedAt) / (SPEED_MIN[st.settings.speed] * 60000));
                E.startHand(t, E.rng32(randomU32()));
                changed = true;
                if (t.finished) { st.status = 'finished'; st.finishedAt = now(); break; }
                afterMove(st);
                continue;
            }
            const s = h.toAct;
            const p = st.players[s];
            const late = now() >= st.deadline;
            if (!p.sittingOut && !late) break;
            const L = E.legal(t, s);
            const at = h.log.length;
            E.act(t, s, L.canCheck ? { type: 'check' } : { type: 'fold' });
            if (h.log[at]) h.log[at].auto = true;
            if (late && !p.sittingOut) {
                p.timeouts = (p.timeouts || 0) + 1;
                if (p.timeouts >= 2) p.sittingOut = true;
            }
            afterMove(st);
            changed = true;
        }
        return changed;
    }

    /* ---------- actions ---------- */

    async function create(b: Any) {
        const settings = cleanSettings(b);
        const name = cleanName(b.name);
        const avatar = cleanAvatar(b);
        const image = await avatarImage(avatar);
        const key = newKey();
        const slot = SLOTS[settings.seats][0];
        const players = [null, null, null, null, null, null] as Any[];
        players[slot] = { name, avatar, image, keyHash: await hash(key), timeouts: 0, sittingOut: false };

        // the odd old table goes when a new one opens
        await db.rpc('pk_cleanup', {});

        for (let attempt = 0; attempt < 6; attempt++) {
            const code = newCode();
            const st = {
                code, version: 1, status: 'waiting', settings, host: slot, players,
                engine: null, createdAt: now(), startedAt: 0, deadline: 0, resultAt: 0, resultHand: 0
            };
            const { data, error } = await db.rpc('pk_create', { p_code: code, p_state: st, p_public: publicView(st) });
            if (error) throw new Fail(500, 'could not open a table');
            if (scalar(data) === true) return { code, seat: slot, key, table: publicView(st) };
        }
        throw new Fail(500, 'could not find a free table code — try again');
    }

    async function join(b: Any) {
        const code = cleanCode(b.code);
        const name = cleanName(b.name);
        const avatar = cleanAvatar(b);
        const image = await avatarImage(avatar);
        const key = newKey();
        const keyHash = await hash(key);
        const r = await mutate(code, (st: Any) => {
            if (st.status !== 'waiting') throw new Fail(409, 'this game has already started');
            const lower = name.toLowerCase();
            if (st.players.some((p: Any) => p && p.name.toLowerCase() === lower)) throw new Fail(409, 'someone at this table already uses that name');
            const slot = SLOTS[st.settings.seats].find((s: number) => !st.players[s]);
            if (slot === undefined) throw new Fail(409, 'this table is full');
            st.players[slot] = { name, avatar, image, keyHash, timeouts: 0, sittingOut: false };
            return slot;
        });
        return { code, seat: r.out, key, table: publicView(r.st) };
    }

    async function leave(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, async (st: Any) => {
            if (st.status !== 'waiting') throw new Fail(409, 'the game has started — you can sit out instead');
            const s = await seatOf(st, b.key);
            st.players[s] = null;
            if (st.host === s) {
                const next = st.players.findIndex((p: Any) => p);
                if (next < 0) st.status = 'closed';
                else st.host = next;
            }
            return true;
        });
        return { table: publicView(r.st) };
    }

    async function start(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, async (st: Any) => {
            const s = await seatOf(st, b.key);
            if (st.host !== s) throw new Fail(403, 'only the host can start the game');
            if (st.status !== 'waiting') throw new Fail(409, 'this game has already started');
            const seated = st.players.filter(Boolean).length;
            if (seated < 2) throw new Fail(409, 'wait for at least one more player');
            st.engine = E.createTable(st.players.map((p: Any, i: number) =>
                p ? { id: 'p' + i, name: p.name, stack: st.settings.chips } : null));
            st.status = 'playing';
            st.startedAt = now();
            settle(st);
            return true;
        });
        return { table: publicView(r.st) };
    }

    async function act(b: Any) {
        const code = cleanCode(b.code);
        const type = String(b.type || '');
        if (!['fold', 'check', 'call', 'raise'].includes(type)) throw new Fail(400, 'unknown move');
        const r = await mutate(code, async (st: Any) => {
            if (st.status !== 'playing') throw new Fail(409, 'the game is not running');
            const s = await seatOf(st, b.key);
            /* a move after the clock ran out is too late — but the auto-move
               that replaced it still has to be saved, so report it, don't throw */
            const moved = settle(st);
            const h = st.engine.hand;
            if (!h || h.result || h.toAct !== s) {
                if (moved) return { late: true };
                throw new Fail(409, 'it is not your turn');
            }
            if (b.hand !== undefined && Number(b.hand) !== h.no) throw new Fail(409, 'that hand is over');
            try {
                E.act(st.engine, s, type === 'raise' ? { type, to: Number(b.to) } : { type });
            } catch (e) {
                throw new Fail(400, (e as Error).message);
            }
            st.players[s].timeouts = 0;
            afterMove(st);
            settle(st);
            return true;
        });
        if (r.out && r.out.late) throw new Fail(409, 'your time ran out, so the dealer checked or folded for you');
        return { table: publicView(r.st) };
    }

    async function back(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, async (st: Any) => {
            const s = await seatOf(st, b.key);
            if (!st.players[s].sittingOut && !st.players[s].timeouts) return false;
            st.players[s].sittingOut = false;
            st.players[s].timeouts = 0;
            return true;
        });
        return { table: publicView(r.st) };
    }

    async function tick(b: Any) {
        const code = cleanCode(b.code);
        const r = await mutate(code, (st: Any) => settle(st) ? true : false);
        return { changed: r.saved, table: publicView(r.st) };
    }

    async function me(b: Any) {
        const code = cleanCode(b.code);
        const row = await load(code);
        const st = row.state;
        const s = await seatOf(st, b.key);
        const h = st.engine && st.engine.hand;
        return {
            seat: s,
            host: st.host === s,
            hand: h ? h.no : 0,
            cards: h && h.dealt[s] ? h.holes[s] : null
        };
    }

    async function state(b: Any) {
        const row = await load(cleanCode(b.code));
        row.state.version = row.version;
        return { table: publicView(row.state) };
    }

    const ACTIONS: Record<string, (b: Any) => Promise<unknown>> = { wallet, create, join, leave, start, act, back, tick, me, state };

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

/* OpenSea's API, with the key from the function's secrets. The key never
   leaves the server: browsers only ever talk to this function. */
async function openseaGet(path: string): Promise<Any> {
    const key = Deno.env.get('OPENSEA_API_KEY');
    if (!key) throw new Error('no OpenSea key configured');
    const res = await fetch('https://api.opensea.io' + path, {
        headers: { 'x-api-key': key, accept: 'application/json' },
        signal: AbortSignal.timeout(10000)
    });
    if (res.status === 404) return { nfts: [], nft: null };
    if (!res.ok) throw new Error('OpenSea ' + res.status);
    return await res.json();
}
