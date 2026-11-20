// ============================================================
// A local stand-in for the Orca Race picture lookup.
//
//     npx deno@2 run -A tools/dev-orca-race.ts
//
// Runs the real orca-race handler against a real Postgres (PGlite,
// in-process, every migration applied) on http://localhost:8790.
// Open orca-race.html?backend=local to use it. OpenSea isn't called:
// the collection says 3000 orcas, and every picture points at a
// test address that won't load, so the page's default-orca fallback
// gets exercised too.
// ============================================================

import { makeLocalDb } from './dev-backend.ts';
import { createHandler } from '../supabase/functions/orca-race/handler.ts';

const { client } = await makeLocalDb();
const port = Number(Deno.env.get('PORT') ?? 8790);
const opensea = (path: string) => {
    if (path.startsWith('/api/v2/collections/')) {
        return Promise.resolve({ total_supply: 3000, contracts: [{ address: '0x' + '0'.repeat(39) + '1', chain: 'ethereum' }] });
    }
    const id = Number(path.split('/').pop());
    return Promise.resolve({ nft: { display_image_url: 'https://i2c.seadn.io/local-test/orca-' + id + '.png' } });
};
Deno.serve({ port, onListen: () => console.log(`Orca Race dev backend on http://localhost:${port}`) }, createHandler(client, { opensea }));
