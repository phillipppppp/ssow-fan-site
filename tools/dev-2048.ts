// ============================================================
// A local stand-in for the Whale 2048 backend.
//
//     npx deno@2 run -A tools/dev-2048.ts
//
// Runs the real whale-2048 handler against a real Postgres (PGlite,
// in-process, every migration applied) on http://localhost:8789.
// Open whale-2048.html?backend=local to play against it. Nothing
// touches the live project; data is gone when this stops. OpenSea
// isn't called here: OG whales get a placeholder picture.
// ============================================================

import { makeLocalDb } from './dev-backend.ts';
import { createHandler } from '../supabase/functions/whale-2048/handler.ts';

const { client } = await makeLocalDb();
const port = Number(Deno.env.get('PORT') ?? 8789);
const opensea = (path: string) => {
    const id = Number(path.split('/').pop());
    return Promise.resolve({ nft: { display_image_url: 'https://i2c.seadn.io/local-test/' + id + '.png' } });
};
Deno.serve({ port, onListen: () => console.log(`Whale 2048 dev backend on http://localhost:${port}`) }, createHandler(client, { opensea }));
