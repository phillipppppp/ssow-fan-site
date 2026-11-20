// ============================================================
// orca-race handler — racer pictures for Orca Race and Whale Race.
//
// One endpoint, POST { action, ... }:
//   info   how many orcas there are, and every real orca number
//          (the numbering has gaps: about 3,000 orcas between 0 and 9999)
//   orcas  { ids: [up to 30 numbers] } -> each orca's picture, or null
//   whales { ids: [up to 30 numbers] } -> each OG whale's picture, or null
//          (OG whales are simply #0 to #9999, no gaps; there is no #10000)
//
// Works like the Cigar Lounge's whale lookups: the browser only sends
// orca numbers, this function asks OpenSea with the key only the
// server has (OPENSEA_API_KEY, the same project secret the poker and
// whale-2048 functions use), keeps only pictures served from
// OpenSea's own image hosts, and caches in pk_cache. The whole
// collection's listing (numbers + pictures) is one cached row,
// refreshed daily, so a race costs OpenSea nothing.
//
// The race itself never comes here: it is decided in the browser
// from the race code and the racer list (orca-race-sim.js), so
// anyone can replay it. Pictures are cosmetic; when one is missing
// the page draws a default orca.
// ============================================================

// deno-lint-ignore no-explicit-any
type Any = any;

export const ORCAS = { slug: 'secret-society-security-orcas' };
/* the OG collection; its picture cache rows are shared with the Cigar Lounge and Whale 2048 */
export const OG = { chain: 'ethereum', contract: '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5', supply: 10000, first: 0, last: 9999 };
const MAX_IDS = 30;
const COLLECTION_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;   // every orca's number and picture, refreshed daily
const CATALOG_PAGES = 40;                      // 200 a page; there are about 3,000 orcas
const IMAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;      // "no such orca" is remembered for a day
const BATCH = 10;                              // OpenSea calls at once
/* OpenSea's own image servers — the only hosts an orca picture may come from */
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

    /* ---------- the shared OpenSea cache (pk_cache, server-only) ---------- */

    async function cacheGet(k: string): Promise<{ value: Any; age: number } | null> {
        try {
            const { data } = await db.from('pk_cache').select('data, fetched_at').eq('key', k).maybeSingle();
            if (!data) return null;
            const age = now() - new Date(data.fetched_at).getTime();
            if (!(age >= 0)) return null;
            return { value: typeof data.data === 'string' ? JSON.parse(data.data) : data.data, age };
        } catch {
            return null;
        }
    }

    async function cachePut(k: string, value: unknown) {
        try { await db.rpc('pk_cache_put', { p_key: k, p_data: value }); } catch { /* a cache miss next time */ }
    }

    function safeImage(url: unknown): string | null {
        return typeof url === 'string' && IMAGE_HOSTS.test(url) ? url : null;
    }

    /* the orcas' contract and supply, found from the collection slug */
    async function collection(): Promise<{ chain: string; address: string; supply: number | null } | null> {
        const hit = await cacheGet('orca:collection');
        if (hit && hit.age < COLLECTION_TTL_MS && hit.value && hit.value.address) return hit.value;
        try {
            const j = await opensea('/api/v2/collections/' + ORCAS.slug);
            const c = j && Array.isArray(j.contracts) ? j.contracts[0] : null;
            const address = c && typeof c.address === 'string' && /^0x[0-9a-fA-F]{40}$/.test(c.address) ? c.address.toLowerCase() : null;
            if (!address) return hit && hit.value && hit.value.address ? hit.value : null;
            const chain = typeof c.chain === 'string' && /^[a-z_]+$/.test(c.chain) ? c.chain : 'ethereum';
            const supply = Number.isInteger(Number(j.total_supply)) && Number(j.total_supply) > 0 ? Number(j.total_supply) : null;
            const out = { chain, address, supply };
            await cachePut('orca:collection', out);
            return out;
        } catch {
            return hit && hit.value && hit.value.address ? hit.value : null;   // stale beats nothing
        }
    }

    /* Every orca that exists, with its picture, from the collection's listing.
       Orca numbers have gaps (about 3,000 orcas numbered 0 to 9999), so this
       is the only way to know which numbers are real. One cached row, a day. */
    async function catalog(): Promise<{ ids: number[]; images: Record<string, string> } | null> {
        const hit = await cacheGet('orca:catalog');
        const usable = (v: Any) => v && Array.isArray(v.ids) && v.ids.length && v.images;
        if (hit && hit.age < CATALOG_TTL_MS && usable(hit.value)) return hit.value;
        try {
            const ids: number[] = [];
            const images: Record<string, string> = {};
            let next = '';
            for (let page = 0; page < CATALOG_PAGES; page++) {
                const j = await opensea('/api/v2/collection/' + ORCAS.slug + '/nfts?limit=200' + (next ? '&next=' + encodeURIComponent(next) : ''));
                for (const n of (j && Array.isArray(j.nfts) ? j.nfts : [])) {
                    const id = Number(n.identifier);
                    if (!Number.isInteger(id) || id < 0 || id > 999999 || images[id] !== undefined) continue;
                    const img = safeImage(n.display_image_url || n.image_url);
                    ids.push(id);
                    if (img) images[id] = img;
                }
                next = j && typeof j.next === 'string' ? j.next : '';
                if (!next) break;
            }
            if (!ids.length) throw new Error('no orcas listed');
            ids.sort((a, b) => a - b);
            const out = { ids, images };
            await cachePut('orca:catalog', out);
            return out;
        } catch {
            return hit && usable(hit.value) ? hit.value : null;          // stale beats nothing
        }
    }

    async function image(col: { chain: string; address: string }, id: number): Promise<string | null> {
        const k = 'img:orca:' + id;
        const hit = await cacheGet(k);
        if (hit && hit.value) {
            const img = safeImage(hit.value.image);
            if (img && hit.age < IMAGE_TTL_MS) return img;
            if (!img && hit.value.missing && hit.age < MISS_TTL_MS) return null;
        }
        try {
            const j = await opensea('/api/v2/chain/' + col.chain + '/contract/' + col.address + '/nfts/' + id);
            const img = safeImage(j && j.nft && (j.nft.display_image_url || j.nft.image_url));
            await cachePut(k, img ? { image: img } : { missing: true });
            return img;
        } catch {
            return hit && hit.value ? safeImage(hit.value.image) : null;
        }
    }

    /* an OG whale's picture, under the same cache key the poker function uses */
    async function whaleImage(id: number): Promise<string | null> {
        const k = 'img:og:' + id;
        const hit = await cacheGet(k);
        const old = hit && hit.value ? safeImage(hit.value.image) : null;
        if (old && hit && hit.age < IMAGE_TTL_MS) return old;
        try {
            const j = await opensea('/api/v2/chain/' + OG.chain + '/contract/' + OG.contract + '/nfts/' + id);
            const img = safeImage(j && j.nft && (j.nft.display_image_url || j.nft.image_url));
            if (img) await cachePut(k, { image: img });
            return img ?? old;
        } catch {
            return old;                                                  // stale beats nothing
        }
    }

    function cleanIds(raw: unknown): number[] {
        if (!Array.isArray(raw)) throw new Fail(400, 'send ids as a list of numbers');
        if (raw.length > MAX_IDS) throw new Fail(400, 'at most ' + MAX_IDS + ' at a time');
        const ids: number[] = [];
        for (const v of raw) {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 0 && n <= 999999 && !ids.includes(n)) ids.push(n);
        }
        return ids;
    }

    const ACTIONS: Record<string, (b: Any) => Promise<unknown>> = {
        async info() {
            const cat = await catalog();
            if (cat) return { supply: cat.ids.length, ids: cat.ids };
            const col = await collection();
            return { supply: col ? col.supply : null };
        },
        async orcas(b: Any) {
            const ids = cleanIds(b.ids);
            const images: Record<string, string | null> = {};
            /* the usual way: straight from the catalog, no OpenSea call at all */
            const cat = await catalog();
            if (cat) {
                for (const id of ids) images[id] = cat.images[id] ?? null;      // not listed: no such orca
                return { supply: cat.ids.length, images };
            }
            /* no catalog right now: ask about each orca. (Numbers above the
               supply are real too: the numbering has gaps.) */
            const col = await collection();
            if (!col) {
                for (const id of ids) images[id] = null;
                return { supply: null, images };
            }
            const wanted = ids;
            for (let i = 0; i < wanted.length; i += BATCH) {
                const part = wanted.slice(i, i + BATCH);
                const got = await Promise.all(part.map((id) => image(col, id)));
                part.forEach((id, j) => { images[id] = got[j]; });
            }
            return { supply: col.supply, images };
        },
        async whales(b: Any) {
            const ids = cleanIds(b.ids);
            const images: Record<string, string | null> = {};
            for (const id of ids) images[id] = null;                         // not an OG number: no picture
            const real = ids.filter((id) => id >= OG.first && id <= OG.last);
            for (let i = 0; i < real.length; i += BATCH) {
                const part = real.slice(i, i + BATCH);
                const got = await Promise.all(part.map(whaleImage));
                part.forEach((id, j) => { images[id] = got[j]; });
            }
            return { supply: OG.supply, images };
        }
    };

    return async function handle(req: Request): Promise<Response> {
        if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
        if (req.method !== 'POST') return reply(405, { error: 'POST only' });
        let body: Any;
        try { body = await req.json(); } catch { return reply(400, { error: 'bad request' }); }
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
   the poker function uses). The key never leaves the server: browsers
   only ever talk to this function. */
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
