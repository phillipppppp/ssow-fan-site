// ============================================================
// A local stand-in for the Cigar Lounge backend.
//
//     npx deno@2 run -A tools/dev-poker.ts
//
// Runs the real poker handler against a real Postgres (PGlite,
// in-process, every migration applied) on http://localhost:8788.
// Open poker.html?backend=local to play against it: there's no
// Realtime locally, so the page polls instead. Nothing touches the
// live project; data is gone when this stops.
// ============================================================

import { makeLocalDb } from './dev-backend.ts';
import { createHandler } from '../supabase/functions/poker/handler.ts';

const { client } = await makeLocalDb();
const port = Number(Deno.env.get('PORT') ?? 8788);
Deno.serve({ port, onListen: () => console.log(`Cigar Lounge dev backend on http://localhost:${port}`) }, createHandler(client));
