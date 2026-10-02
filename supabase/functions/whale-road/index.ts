// Entry point on Supabase: the real database, the shared handler.
// Everything interesting is in handler.ts, so it can also run
// against a local Postgres in tests (tools/dev-backend.ts).

import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { createHandler } from './handler.ts';

const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } }
);

Deno.serve(createHandler(db));
