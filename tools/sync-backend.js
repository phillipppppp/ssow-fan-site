/* ============================================================
   Copy the shared game files into the edge function's folder.

       node tools/sync-backend.js

   The server replays runs with the exact game-sim.js the page
   plays, so the two copies must never drift. Run this before
   every `supabase functions deploy`; it also refuses to let a
   stale copy sit there unnoticed (`--check`).
   ============================================================ */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SHARED = path.join(ROOT, 'supabase', 'functions', '_shared');
const FILES = ['game-sim.js', 'game-rules.js'];
const checkOnly = process.argv.includes('--check');

fs.mkdirSync(SHARED, { recursive: true });
let stale = 0;
for (const name of FILES) {
    const src = fs.readFileSync(path.join(ROOT, name));
    const dest = path.join(SHARED, name);
    const same = fs.existsSync(dest) && fs.readFileSync(dest).equals(src);
    if (same) continue;
    stale++;
    if (checkOnly) console.error(name + ' differs from supabase/functions/_shared/' + name);
    else { fs.writeFileSync(dest, src); console.log('copied ' + name); }
}
if (checkOnly && stale) process.exit(1);
if (!stale) console.log('backend copies are up to date');
