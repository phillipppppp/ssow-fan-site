// ============================================================
// A local stand-in for Whale Pool's online backend.
//
//     npx deno@2 run -A tools/dev-pool.ts
//
// Runs the real pool handler against a real Postgres (PGlite,
// in-process, every migration applied) on http://localhost:8789.
// Open whale-pool.html?backend=local to play against it: there's
// no Realtime locally, so the page polls instead. Nothing touches
// the live project; data is gone when this stops.
// ============================================================

import { makeLocalDb } from './dev-backend.ts';
import { createHandler } from '../supabase/functions/pool/handler.ts';

const { client } = await makeLocalDb();
const port = Number(Deno.env.get('PORT') ?? 8789);
/* no OpenSea locally: an OG whale just shows a pfp */
const opensea = () => Promise.reject(new Error('no OpenSea locally'));
Deno.serve({ port, onListen: () => console.log(`Whale Pool dev backend on http://localhost:${port}`) }, createHandler(client, { opensea }));
