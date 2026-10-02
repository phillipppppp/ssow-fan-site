// ============================================================
// whale-road handler — the server half of Whale Road.
//
// One endpoint, POST { action, ... }:
//   claim   pick a username: a guest key, or a wallet with OG whales
//   me      who am I, coins, power-ups
//   buy     spend coins on a power-up
//   start   issue a run ticket: a fresh seed, power-ups spent
//   finish  replay the run from its key presses, judge it, score it
//
// The browser never reports a score. It sends the key presses; this
// function replays them with the same game-sim.js the page plays,
// and records only what the replay says. Runs that look like bots
// are kept but hidden from the board.
//
// ../_shared/*.js are copies of the site's game-sim.js and
// game-rules.js, refreshed by tools/sync-backend.js before deploy.
// ============================================================

import '../_shared/game-sim.js';
import '../_shared/game-rules.js';

// deno-lint-ignore no-explicit-any
const Sim = (globalThis as any).WhaleSim;
// deno-lint-ignore no-explicit-any
const Rules = (globalThis as any).WhaleRules;

const OG_CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';
const ETH_RPCS = [
    'https://ethereum-rpc.publicnode.com',
    'https://rpc.mevblocker.io',
    'https://eth.drpc.org'
];

// deno-lint-ignore no-explicit-any
export function createHandler(
    db: any,
    deps: { ownerOf?: (id: number) => Promise<string>; balanceOf?: (wallet: string) => Promise<number> } = {}
) {
    // Tests may swap the Ethereum lookups; production never passes any.
    const lookupOwner = deps.ownerOf ?? ownerOf;
    const lookupBalance = deps.balanceOf ?? balanceOf;

    const SESSION_DAYS = 30;
    const HOURLY_RUN_CAP = 120;
    const TICKET_MAX_AGE_MS = 3 * 60 * 60 * 1000;
    const MAX_INPUTS = 25000;

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
        return new Response(JSON.stringify(body), {
            status,
            headers: { ...CORS, 'content-type': 'application/json' }
        });
    }

    async function sha256(text: string) {
        const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    function randomHex(bytes: number) {
        const a = crypto.getRandomValues(new Uint8Array(bytes));
        return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    const PUBLIC_FIELDS = 'id, username, wallet, coins, shield, dash, magnet';

    // deno-lint-ignore no-explicit-any
    function publicPlayer(p: any) {
        return {
            username: p.username,
            kind: p.wallet ? 'wallet' : 'guest',
            wallet: p.wallet,
            coins: p.coins,
            items: { shield: p.shield, dash: p.dash, magnet: p.magnet }
        };
    }

    async function newSession(playerId: string) {
        const token = randomHex(32);
        const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
        const { error } = await db.from('wr_sessions').insert({
            token_hash: await sha256(token),
            player_id: playerId,
            expires_at: expires
        });
        if (error) throw new Fail(500, 'could not start a session');
        return token;
    }

    async function playerFromToken(token: unknown) {
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Fail(401, 'sign in first');
        const { data } = await db
            .from('wr_sessions')
            .select('expires_at, wr_players(' + PUBLIC_FIELDS + ')')
            .eq('token_hash', await sha256(token))
            .maybeSingle();
        // deno-lint-ignore no-explicit-any
        const row = data as any;
        if (!row || new Date(row.expires_at).getTime() < Date.now() || !row.wr_players) {
            throw new Fail(401, 'your session expired — claim your name again');
        }
        return row.wr_players;
    }

    // ---------- the OG contract: whose whale is it, does this wallet hold any ----------

    async function ethCall(data: string) {
        for (const url of ETH_RPCS) {
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: OG_CONTRACT, data }, 'latest'] }),
                    signal: AbortSignal.timeout(6000)
                });
                const json = await res.json();
                if (typeof json.result === 'string' && json.result.length >= 66) return json.result as string;
            } catch {
                // next endpoint
            }
        }
        throw new Fail(503, 'couldn\u2019t reach Ethereum to check your wallet \u2014 try again');
    }

    async function ownerOf(tokenId: number) {
        const hex = await ethCall('0x6352211e' + tokenId.toString(16).padStart(64, '0'));
        return ('0x' + hex.slice(-40)).toLowerCase();
    }

    async function balanceOf(wallet: string) {
        const hex = await ethCall('0x70a08231' + wallet.slice(2).padStart(64, '0'));
        return parseInt(hex, 16) || 0;
    }

    // ---------- actions ----------

    // Names. No signatures, by design (the owner's call): a wallet is
    // identified by its address alone. So a wallet's name is set once and
    // then locked — pasting someone else's address can sign you in as
    // them, but can never rename them. Registering a wallet needs at least
    // one OG whale in it. Guests own their name with a secret key kept in
    // their browser, which nobody else has, so guests may rename.
    // deno-lint-ignore no-explicit-any
    async function claim(body: any) {
        if (body.kind === 'wallet') {
            const wallet = String(body.wallet ?? '').toLowerCase();
            if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Fail(400, 'bad wallet address');

            const { data: existing } = await db.from('wr_players').select(PUBLIC_FIELDS).eq('wallet', wallet).maybeSingle();
            if (existing) return { token: await newSession(existing.id), player: publicPlayer(existing) };

            const username = String(body.username ?? '');
            if (!username) throw new Fail(404, 'pick a name for this wallet');
            const why = Rules.checkName(username);
            if (why) throw new Fail(400, why);
            if ((await lookupBalance(wallet)) < 1) throw new Fail(403, 'this wallet holds no OG whales \u2014 play as a guest');

            const { data, error } = await db.from('wr_players').insert({ username, wallet }).select(PUBLIC_FIELDS).single();
            if (error) {
                if (error.code === '23505' && /wallet/.test(error.message)) throw new Fail(409, 'this wallet was just registered \u2014 try again');
                throw new Fail(409, error.code === '23505' ? 'that name is taken' : 'could not create your player');
            }
            return { token: await newSession(data.id), player: publicPlayer(data) };
        }

        const username = String(body.username ?? '');
        const why = Rules.checkName(username);
        if (why) throw new Fail(400, why);
        const key = String(body.guestKey ?? '');
        if (!/^[0-9a-f]{64}$/.test(key)) throw new Fail(400, 'bad guest key');
        const hash = await sha256(key);
        const { data: existing } = await db.from('wr_players').select(PUBLIC_FIELDS).eq('guest_key_hash', hash).maybeSingle();

        let player = existing;
        if (existing && existing.username.toLowerCase() !== username.toLowerCase()) {
            const { data, error } = await db.from('wr_players').update({ username }).eq('id', existing.id).select(PUBLIC_FIELDS).single();
            if (error) throw new Fail(409, error.code === '23505' ? 'that name is taken' : 'could not rename');
            player = data;
            await db.from('wr_leaderboard').update({ username }).eq('player_id', existing.id);
        } else if (!existing) {
            const { data, error } = await db.from('wr_players').insert({ username, guest_key_hash: hash }).select(PUBLIC_FIELDS).single();
            if (error) throw new Fail(409, error.code === '23505' ? 'that name is taken' : 'could not create your player');
            player = data;
        }

        return { token: await newSession(player.id), player: publicPlayer(player) };
    }

    // deno-lint-ignore no-explicit-any
    async function buy(body: any) {
        const player = await playerFromToken(body.token);
        const item = String(body.item ?? '');
        const price = Sim.PRICES[item];
        if (!price) throw new Fail(400, 'no such power-up');
        const { data, error } = await db.rpc('wr_buy', { p_player: player.id, p_item: item, p_price: price });
        if (error) throw new Fail(500, 'the shop is shut — try again');
        // deno-lint-ignore no-explicit-any
        const row = (data as any[])?.[0];
        if (!row) throw new Fail(402, 'not enough $CIGAR');
        return { coins: row.coins, items: { shield: row.shield, dash: row.dash, magnet: row.magnet } };
    }

    // deno-lint-ignore no-explicit-any
    async function start(body: any) {
        const player = await playerFromToken(body.token);
        const lo = body.loadout ?? {};
        const loadout = { shield: lo.shield === true, dash: lo.dash === true, magnet: lo.magnet === true };

        // A Pixel Whale on the board must belong to the signed-in wallet.
        let whale: number | null = null;
        if (body.whaleId !== null && body.whaleId !== undefined) {
            const id = Number(body.whaleId);
            if (!player.wallet) throw new Fail(403, 'guests play the guest whale');
            if (!Number.isInteger(id) || id < 1 || id > 9999) throw new Fail(400, 'bad whale');
            if ((await lookupOwner(id)) !== player.wallet) throw new Fail(403, 'that whale isn’t in your wallet');
            whale = id;
        }

        const seed = crypto.getRandomValues(new Uint32Array(1))[0];
        const { data, error } = await db.rpc('wr_start', {
            p_player: player.id, p_seed: seed, p_version: Sim.VERSION,
            p_shield: loadout.shield, p_dash: loadout.dash, p_magnet: loadout.magnet,
            p_whale: whale, p_hourly_cap: HOURLY_RUN_CAP
        });
        if (error) throw new Fail(429, /too many/.test(error.message) ? 'too many runs this hour — take a breather' : /power-ups/.test(error.message) ? 'you don’t have those power-ups' : 'could not start a run');
        // deno-lint-ignore no-explicit-any
        const row = (data as any[])[0];
        return { runId: row.run_id, seed, version: Sim.VERSION, loadout, whaleId: whale };
    }

    // deno-lint-ignore no-explicit-any
    async function finish(body: any) {
        const player = await playerFromToken(body.token);
        const inputs = body.inputs;
        if (!Array.isArray(inputs) || inputs.length > MAX_INPUTS) throw new Fail(400, 'bad input log');

        const { data: run } = await db
            .from('wr_runs')
            .select('id, seed, sim_version, shield, dash, magnet, started_at, finished_at')
            .eq('id', String(body.runId ?? ''))
            .eq('player_id', player.id)
            .maybeSingle();
        if (!run || run.finished_at) throw new Fail(404, 'that run ticket isn’t valid');
        if (run.sim_version !== Sim.VERSION) throw new Fail(409, 'the game was updated mid-run — reload the page');

        const elapsed = Date.now() - new Date(run.started_at).getTime();
        if (elapsed > TICKET_MAX_AGE_MS) throw new Fail(410, 'that run ticket expired');

        // deno-lint-ignore no-explicit-any
        let result: any;
        try {
            result = Sim.replay({
                seed: Number(run.seed),
                loadout: { shield: run.shield, dash: run.dash, magnet: run.magnet },
                inputs
            });
        } catch {
            throw new Fail(400, 'bad input log');
        }

        const reasons: string[] = Rules.judge(result.tells, result.ticks, elapsed, Sim.TICK_HZ);
        const suspect = reasons.length > 0;
        // a run computed faster than real time earns nothing at all
        const coins = reasons.indexOf('fast-forward') >= 0 ? 0 : result.coins;

        const { data, error } = await db.rpc('wr_finish', {
            p_run: run.id, p_player: player.id, p_score: result.score, p_coins: coins,
            p_ticks: result.ticks, p_suspect: suspect,
            p_tells: { ...result.tells, reasons, elapsedMs: elapsed, death: result.death, claimed: body.clientScore ?? null }
        });
        if (error) throw new Fail(409, 'that run was already counted');
        // deno-lint-ignore no-explicit-any
        const row = (data as any[])[0];

        // reasons stay server-side: no point teaching a bot what gave it away
        return {
            score: result.score,
            coins,
            balance: row.coins,
            best: row.best,
            rank: row.rank === null ? null : Number(row.rank),
            flagged: suspect
        };
    }

    // Top 20, best first; ties go to whoever got there first.
    async function board() {
        const { data, error } = await db
            .from('wr_leaderboard')
            .select('username, wallet, whale_id, score, updated_at')
            .order('score', { ascending: false })
            .order('updated_at', { ascending: true })
            .limit(20);
        if (error) throw new Fail(500, 'could not load the leaderboard');
        return { rows: data ?? [] };
    }

    return async function handle(req: Request): Promise<Response> {
        if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });

        try {
            const body = await req.json();
            switch (body?.action) {
                case 'claim': return reply(200, await claim(body));
                case 'me': return reply(200, { player: publicPlayer(await playerFromToken(body.token)) });
                case 'buy': return reply(200, await buy(body));
                case 'start': return reply(200, await start(body));
                case 'finish': return reply(200, await finish(body));
                case 'board': return reply(200, await board());
                default: return reply(400, { error: 'unknown action' });
            }
        } catch (err) {
            if (err instanceof Fail) return reply(err.status, { error: err.message });
            console.error(err);
            return reply(500, { error: 'something went wrong' });
        }
    };
}
