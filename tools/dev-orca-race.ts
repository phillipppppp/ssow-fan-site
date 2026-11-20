// ============================================================
// A local stand-in for the Orca Race and Whale Race picture lookup.
//
//     npx deno@2 run -A tools/dev-orca-race.ts
//
// Runs the real orca-race handler against a real Postgres (PGlite,
// in-process, every migration applied) on http://localhost:8790.
// Open orca-race.html?backend=local or whale-race.html?backend=local.
// OpenSea isn't called: the collection says 3000 orcas, and every
// picture points at a test address that won't load, so the page's
// default-picture fallback gets exercised too.
// ============================================================

import { makeLocalDb } from './dev-backend.ts';
import { createHandler } from '../supabase/functions/orca-race/handler.ts';

const { client } = await makeLocalDb();
const port = Number(Deno.env.get('PORT') ?? 8790);
const opensea = (path: string) => {
    // the collection's listing: like the real one, numbers with gaps (here every
    // third number up to 9000), two pages
    if (path.startsWith('/api/v2/collection/')) {
        const second = path.includes('next=');
        const ids = Array.from({ length: 1500 }, (_, i) => (second ? 1500 + i : i) * 3);
        return Promise.resolve({
            nfts: ids.map((id) => ({ identifier: String(id), display_image_url: 'https://i2c.seadn.io/local-test/orca-' + id + '.png' })),
            next: second ? null : 'page-2'
        });
    }
    if (path.startsWith('/api/v2/collections/')) {
        return Promise.resolve({ total_supply: 3000, contracts: [{ address: '0x' + '0'.repeat(39) + '1', chain: 'ethereum' }] });
    }
    const id = Number(path.split('/').pop());
    const kind = path.includes('/contract/0x88091012eedf8dba59d08e27ed7b22008f5d6fe5/') ? 'whale' : 'orca';
    return Promise.resolve({ nft: { display_image_url: 'https://i2c.seadn.io/local-test/' + kind + '-' + id + '.png' } });
};
Deno.serve({ port, onListen: () => console.log(`Orca Race dev backend on http://localhost:${port}`) }, createHandler(client, { opensea }));
