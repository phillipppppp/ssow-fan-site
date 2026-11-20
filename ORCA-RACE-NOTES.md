# Orca Race — handoff notes

A summary of the session that built **Orca Race** for the SSoW fan site's arcade,
so work can continue from here (e.g. in Claude Code in VS Code). Branch:
`claude/orca-race-arcade-game-7hd89y`.

> Tip for Claude Code: read this file first, then `orca-race-sim.js` and `orca-race.js`.

---

## What was asked

An arcade game "Orca Race", inspired by the duck race at online-stopwatch.com/duck-race,
using the **Secret Society Security Orcas** collection (OpenSea slug
`secret-society-security-orcas`) as racers. It will be used for **giveaways**, so the
race must be provably fair.

Requirements (all done):

- **Setup:** 2–30 racers, each with a name and optional Orca ID (shows that orca's NFT
  image). Buttons: Add racer, Add 5 random orcas, Shuffle lanes, Clear. Race length
  10s / 20s / 30s. Invalid ID or failed image → default orca picture, never crash.
- **Race:** 3-2-1-GO countdown, race clock `mm:ss.mmm`, ocean lanes with moving waves,
  racers bob as they swim left → right to a finish line, random speed bursts, lead
  changes, short slow-motion on a close finish. Canvas + requestAnimationFrame, smooth
  on phones, lanes shrink to fit many racers.
- **Fairness:** a "Race code" shown before the start; the race and winner are decided
  only by race code + racer list via a seeded RNG (no `Math.random` during the race).
  "Replay with code" field: same code + same racers = same race and winner.
- **Results:** podium for top 3 with images and times, confetti, full finishing order,
  "Copy results" (Discord-ready text), "Race again" (same racers, new code), "New race".
- **Extras:** Web Audio sounds (beeps, horn, splashes, cheer) + mute, fullscreen button,
  site look-and-feel, card on the arcade page.
- **Hard rule:** the OpenSea API key must never appear in browser code or be committed.

Later change requested: **"make it like the 2D image of the orca collection"** →
decision: the racers are now the **NFT art itself** on comic sticker cards (thick ink
outline, hard offset shadow, gold frame for the leader), rocking/bobbing with water at
the base, a foam wake, and speed lines on bursts. (Earlier version drew a black-and-white
cartoon orca body with the NFT in a small circle.)

---

## How the site is built (context)

- Static site: top-level `*.html`, `*.js`, `*.css`; every script is a self-contained IIFE
  sharing state only via `window.X`.
- Shared styles: `base.css` (tokens, nav, `.Btn`, `.Intro`, `.Crumbs`, `.Label`),
  `arcade.css` (form fields, `.Wallet-row`, `.Wallet-status`).
- Shared sound kit: `arcade-sound.js` (`ArcadeSound.create({ store, sounds })`).
- Arcade page: `minigames.html` / `minigames.css`, one `.Game-card` per game, square
  cover in `images/games/`.
- Build: `node tools/build.js` copies/minifies into `_site/` (Vercel runs it via
  `vercel.json`; GitHub Pages workflow also uses it, from `main` only).
- Backends: Supabase edge functions in `supabase/functions/*`, config in
  `game-config.js` (`window.WHALE_ROAD_CONFIG.supabaseUrl`).

### How NFT images + the API key work (reused for orcas)

The browser never talks to OpenSea. The **poker** function (and whale-2048) call
OpenSea server-side with `Deno.env.get('OPENSEA_API_KEY')` (a Supabase project secret),
accept only image URLs from OpenSea's own hosts (`seadn.io`, `opensea.io`,
`openseauserdata.com`), and cache in the private `pk_cache` table
(`pk_cache_put` RPC, service role only). Orca Race follows exactly this pattern.

---

## Files added / changed

| File | What it does |
|---|---|
| `orca-race.html` | Page: setup panel, race stage (HUD + canvas), results overlay, "Why it's fair". |
| `orca-race.css` | Page styles in the site's comic look. |
| `orca-race-sim.js` | **The fair race engine.** Pure, deterministic, works in browser and Node. |
| `orca-race.js` | UI: setup list, picture loading, canvas drawing/playback, results, copy, mute, fullscreen. |
| `orca-race-sound.js` | Synthesized sounds on the shared arcade kit: beep, horn, splash, whoosh, finish, cheer. |
| `supabase/functions/orca-race/handler.ts` + `index.ts` | Edge function for orca pictures (key stays server-side). |
| `supabase/config.toml` | Added `[functions.orca-race] verify_jwt = false`. |
| `tools/test-orca-race.js` | Fairness test suite (Node). |
| `tools/dev-orca-race.ts` | Local stand-in backend on :8790 (`orca-race.html?backend=local`). |
| `images/games/orca-race.webp` | Arcade cover (640×640, rendered from the game). |
| `minigames.html` | Added the Orca Race card. |

Whale Road, Cigar Lounge (poker), Whale 2048 and shared files were **not touched**.

---

## Fairness design (`orca-race-sim.js`)

- Seed = cyrb128 hash of `'ssow-orca-race|v1|' + CODE + '|' + sorted racer keys`;
  RNG = sfc32. Only `+ - * /` and comparisons in the sim (no `sin`/`exp`/`pow`), so
  results are bit-identical across browsers and Node.
- Racer key = trimmed lower-cased name + `#` + orca ID. Racers are **sorted** before
  seeding/simulating → **lane order is cosmetic**; "Shuffle lanes" can't change the winner.
- The sim runs in fixed steps (~600 for the winner); race length only rescales time
  (`timeScale = seconds / winnerSteps`), so the winner always crosses at exactly
  10.000 / 20.000 / 30.000 s and the order is the same at any length.
- Mechanics: per-racer base speed, wandering pace segments, speed bursts (more likely
  when behind → lead changes), a late "kick" near the end. Exact fractional finish times.
- Codes: 6 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `crypto.getRandomValues`.
  Replay input is case/space-insensitive.
- "racers #xxxxxx" fingerprint (hash of the sorted racer set) is shown next to the code
  and in results, so viewers can confirm the same list.
- Page playback (`orca-race.js`) only reads the precomputed result. Slow-mo plays when
  1st and 2nd finish within 0.6 % of the race length; after the top 3 the rest
  fast-forward 3×. Cosmetic randomness (spray, confetti) uses a generator seeded from
  the code — `orca-race.js` never calls `Math.random`.

Verified: `node tools/test-orca-race.js` — same code + same list twice gives identical
digest over every position at every step; shuffled lanes identical; 10s/30s scaling
exact; different code / extra racer / changed ID → different race; 4 000 races show
each racer winning ~equally; sim never calls `Math.random`. In Chromium, the page's
results matched Node exactly (code `K7QX2M`, 8 racers → winner "Shamu").

---

## The `orca-race` edge function

`POST { action: 'info' }` → `{ supply }`
`POST { action: 'orcas', ids: [≤30 numbers] }` → `{ supply, images: { id: url | null } }`

- Finds the orca contract + total supply from OpenSea by slug
  (`/api/v2/collections/secret-society-security-orcas`), cached a day as
  `orca:collection` (the contract address wasn't known/hardcoded).
- Per-orca image from `/api/v2/chain/{chain}/contract/{address}/nfts/{id}`, cached
  7 days as `img:orca:<id>`; "missing" cached 1 day. IDs above supply → `null`.
- Only OpenSea image hosts are accepted; any failure → `null` → page shows
  `images/orca.avif`. If OpenSea is down entirely, the call still returns 200 with nulls.
- Tested with a fake OpenSea in Deno (missing, foreign host, errors, cache, >30 IDs).

---

## Status / to-do

- [x] Built, tested, committed and pushed on `claude/orca-race-arcade-game-7hd89y`.
- [ ] **Deploy the function:** `supabase functions deploy orca-race`
      (`OPENSEA_API_KEY` secret and `pk_cache` table already exist). Until then every
      racer shows the default orca picture — the race itself works fine.
- [ ] Check the Vercel preview for the branch (GitHub commit → ✓ → Vercel → Details),
      including on a phone and in fullscreen.
- [ ] Merge the branch into `main` to go live (GitHub Pages deploys from `main`).
- [ ] Until the function reports the real supply, "Add 5 random orcas" picks IDs 1–1000
      (`FALLBACK_SUPPLY` in `orca-race.js`). If orca IDs start at 0, #0 can only be typed.

Ideas not built (optional): a "copy replay link" that encodes racers in the URL
(the page already reads `#code=…&len=…&r=name~id|name~id` on load), a sound volume slider,
team colors per lane.

---

## How to test

```bash
node tools/test-orca-race.js            # fairness checks
node tools/test-orca-race.js K7QX2M     # one race: order + digest (compare across machines)

npm install --no-save --no-package-lock esbuild@0.25.12
node tools/build.js                     # builds _site/
cd _site && python3 -m http.server 8123 # open http://localhost:8123/orca-race.html

npx deno@2 run -A tools/dev-orca-race.ts   # optional local picture backend
# then open orca-race.html?backend=local
```

Manual check: add racers (or "Add 5 random orcas" ×2), type a code like `TEST01` into
"Replay with code", run it; run again and after "Shuffle lanes" — winner, order and
times must match. Try fullscreen, mute, Copy results, Race again, New race.
