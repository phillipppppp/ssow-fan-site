/* ============================================================
   Whale Road — a Crossy Road–style hopper starring Pixel Whales.

   Grid world, 13 columns wide, scrolling forward forever. Lanes:
     sand  — safe; palms, crates and umbrellas block your way
     road  — cars, vans and ice cream trucks; touch one and you're flat
     water — ride the driftwood; whales in suits can't swim
     rail  — a light blinks, then a tram comes through very fast
   Dawdle and the camera creeps past you: a seagull takes you.

   The player is any of the 10,000 Secret Society Pixel Whales
   (Polygon 0xc74e…ec2e). Their art is a 100×100 pixel grid drawn at
   10× on a flat background, so it is sampled back down to native
   size, the background flood-filled away, and drawn 1:1 — one art
   pixel per world pixel. A whale is about 1.5 cells tall, like a
   Crossy Road character. There are no walk frames: the movement is
   the hop, sold with squash, stretch, a lean and a shadow.

   Keyboard only. Phones get a notice instead (see game.html).
   ============================================================ */

(function () {
    'use strict';

    const arcade = document.getElementById('arcade');
    if (!arcade) return;

    /* Phones and tablets have no keys to play with. A touchscreen
       laptop still reports a fine primary pointer, so it plays. */
    const touchOnly = window.matchMedia &&
        window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touchOnly) {
        arcade.hidden = true;
        document.getElementById('desktopOnly').hidden = false;
        return;
    }

    /* ---------------------------------------------------------
       Constants
       --------------------------------------------------------- */

    const CELL = 48;
    const COLS = 13;
    const ROWS = 10;                 /* visible lanes */
    const W = CELL * COLS;           /* 624 world px */
    const H = CELL * ROWS;           /* 480 world px */
    const HOP_MS = 115;
    const START_COL = 6;

    /* tokenURI() on the Pixel Whales contract is ipfs://<this>/<id> */
    const PIXEL_CID = 'QmYsgzpjiefYzYBY27mvb7y7RS8hpAKbGgN6HSYPvcZR1Q';
    const SUPPLY = 10000;            /* ids 0 - 9999 */
    const GATEWAYS = [
        'https://gateway.pinata.cloud/ipfs/',
        'https://ipfs.filebase.io/ipfs/',
        'https://ipfs.io/ipfs/',
        'https://dweb.link/ipfs/'
    ];

    const $ = function (id) { return document.getElementById(id); };
    const canvas = $('gameCanvas');
    const ctx = canvas.getContext('2d');
    const preview = $('previewCanvas');
    const els = {
        overlay: $('overlay'),
        kicker: $('overlayKicker'),
        title: $('overlayTitle'),
        text: $('overlayText'),
        button: $('overlayButton'),
        score: $('hudScore'),
        coins: $('hudCoins'),
        best: $('bestScore'),
        banked: $('bankedCoins'),
        number: $('whaleNumber'),
        load: $('loadWhale'),
        random: $('randomWhale'),
        name: $('whaleName'),
        traits: $('whaleTraits'),
        status: $('whaleStatus'),
        frame: $('boardFrame')
    };

    /* ---------------------------------------------------------
       Small helpers
       --------------------------------------------------------- */

    function rand(a, b) { return a + Math.random() * (b - a); }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function colX(c) { return c * CELL + CELL / 2; }
    function colOf(x) { return clamp(Math.round((x - CELL / 2) / CELL), 0, COLS - 1); }
    function difficulty(row) { return clamp(row / 160, 0, 1); }

    function readStore(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (err) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* fine */ }
    }

    function fill(color, x, y, w, h) {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    /* #rrggbb lightened or darkened by amt (-255..255) */
    function shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        const r = clamp((n >> 16) + amt, 0, 255);
        const g = clamp(((n >> 8) & 255) + amt, 0, 255);
        const b = clamp((n & 255) + amt, 0, 255);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    /* ---------------------------------------------------------
       The whale: metadata, art, cutout
       --------------------------------------------------------- */

    /* Content-addressed, so it can be cached forever. */
    async function fetchMeta(id) {
        const key = 'ssow-pixel:' + PIXEL_CID + ':' + id;
        const stored = readStore(key, null);
        if (stored && stored.image) return stored;

        const attempts = GATEWAYS.map(function (base) {
            return fetch(base + PIXEL_CID + '/' + id, { mode: 'cors' }).then(function (res) {
                if (!res.ok) throw new Error('gateway ' + res.status);
                return res.json();
            });
        });
        const meta = await Promise.any(attempts).catch(function () {
            throw new Error('every IPFS gateway failed');
        });

        const whale = { id: id, image: meta.image, traits: meta.attributes || [] };
        writeStore(key, whale);
        return whale;
    }

    function loadImg(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.crossOrigin = 'anonymous';         /* getImageData needs a CORS-clean image */
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image failed')); };
            img.src = src;
        });
    }

    /* The metadata names one gateway. If that one is down, the same
       CID is just as good from any other. */
    async function loadArt(whale) {
        const m = /\/ipfs\/([^/?#]+)/.exec(whale.image || '');
        const urls = [whale.image].concat(m ? GATEWAYS.map(function (g) { return g + m[1]; }) : []);
        const seen = {};
        for (const url of urls) {
            if (!url || seen[url]) continue;
            seen[url] = true;
            try {
                /* eslint-disable-next-line no-await-in-loop */
                return await loadImg(url);
            } catch (err) { /* next gateway */ }
        }
        throw new Error('art unavailable');
    }

    /* 1000px PNG of a 100px grid on a flat background -> a cropped,
       transparent, native-size sprite. The flood fill starts from the
       border, so background-coloured pixels *inside* the whale stay. */
    function makeSprite(img) {
        const N = Math.max(1, Math.round(img.naturalWidth / 10));
        const c = document.createElement('canvas');
        c.width = N;
        c.height = N;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(img, 0, 0, N, N);

        let data;
        try { data = g.getImageData(0, 0, N, N); } catch (err) { return null; }
        const d = data.data;
        const bg = [d[0], d[1], d[2]];
        const isBg = function (p) {
            const i = p * 4;
            return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 24;
        };

        const seen = new Uint8Array(N * N);
        const stack = [];
        for (let i = 0; i < N; i++) stack.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
        while (stack.length) {
            const p = stack.pop();
            if (seen[p]) continue;
            seen[p] = 1;
            if (!isBg(p)) continue;
            d[p * 4 + 3] = 0;
            const x = p % N;
            const y = (p / N) | 0;
            if (x > 0) stack.push(p - 1);
            if (x < N - 1) stack.push(p + 1);
            if (y > 0) stack.push(p - N);
            if (y < N - 1) stack.push(p + N);
        }
        g.putImageData(data, 0, 0);

        /* crop to what's left */
        let x0 = N, y0 = N, x1 = -1, y1 = -1;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                if (d[(y * N + x) * 4 + 3]) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }
        if (x1 < 0) return null;

        const out = document.createElement('canvas');
        out.width = x1 - x0 + 1;
        out.height = y1 - y0 + 1;
        out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    /* Plays while IPFS is still answering, or if it never does. */
    function fallbackSprite() {
        const map = [
            '.....kkkkk.....',
            '...kkbbbbbkk...',
            '..kbbbbbbbbbk..',
            '.kbbbwkbbbbbbk.',
            '.kbbbkkbbbbbbk.',
            '.kbbbbbbbbbbbk.',
            '.kbbbbbbbbbbbk.',
            '..kbbbbbbbbbk..',
            '..kbbsssssbbk..',
            '..kbbsssssbbk..',
            '..kbbbbbbbbbk..',
            '...kbbk.kbbk...',
            '...kkkk.kkkk...'
        ];
        const colors = { k: '#13263d', b: '#3f86c9', w: '#ffffff', s: '#a9d3f2' };
        const px = 3;
        const c = document.createElement('canvas');
        c.width = map[0].length * px;
        c.height = map.length * px;
        const g = c.getContext('2d');
        map.forEach(function (line, y) {
            for (let x = 0; x < line.length; x++) {
                const col = colors[line[x]];
                if (col) { g.fillStyle = col; g.fillRect(x * px, y * px, px, px); }
            }
        });
        return c;
    }

    let sprite = fallbackSprite();
    let loadToken = 0;

    function setStatus(msg, isError) {
        els.status.textContent = msg || '';
        els.status.classList.toggle('is-error', !!isError);
    }

    function drawPreview() {
        preview.width = 100;
        preview.height = 100;
        const g = preview.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, 100, 100);
        const s = sprite;
        const scale = Math.max(1, Math.floor(Math.min(96 / s.width, 96 / s.height)));
        const w = s.width * scale;
        const h = s.height * scale;
        g.drawImage(s, Math.round((100 - w) / 2), 100 - h - 2, w, h);
    }

    function describe(traits) {
        const want = ['Hat', 'Eyes', 'Mouth', 'Outfit'];
        return want.map(function (t) {
            const hit = traits.find(function (x) { return x.trait_type === t; });
            return hit && hit.value && hit.value !== 'None' ? hit.value : null;
        }).filter(Boolean).join(' · ');
    }

    async function chooseWhale(raw) {
        const id = Number(raw);
        if (!Number.isInteger(id) || id < 0 || id >= SUPPLY) {
            setStatus('pick a number from 0 to ' + (SUPPLY - 1), true);
            return;
        }
        const token = ++loadToken;
        els.number.value = id;
        setStatus('loading #' + id + '…');
        try {
            const whale = await fetchMeta(id);
            if (token !== loadToken) return;
            const img = await loadArt(whale);
            if (token !== loadToken) return;
            const s = makeSprite(img);
            if (!s) throw new Error('could not cut out the art');
            sprite = s;
            writeStore('ssow-road-whale', id);
            els.name.textContent = 'Pixel Whale #' + id;
            els.traits.textContent = describe(whale.traits) || ' ';
            drawPreview();
            setStatus('');
        } catch (err) {
            if (token !== loadToken) return;
            setStatus('couldn’t load #' + id + ' — ' + err.message, true);
        }
    }

    /* ---------------------------------------------------------
       The world
       --------------------------------------------------------- */

    const DECOR = ['palm', 'palm', 'palm', 'crate', 'crate', 'umbrella'];
    const CAR_COLORS = ['#e0563f', '#f2c14e', '#4c9be8', '#6fcf7a', '#f28fb1', '#e9e9e9', '#9b7ff0'];

    let lanes;
    let genRow;
    let chunk;
    let lastWaterDir;

    function pickDecor() { return DECOR[(Math.random() * DECOR.length) | 0]; }

    /* Lanes come in runs ("chunks") — a few roads together, a river
       two or three wide — like the real thing. The first four rows are
       always sand so nobody dies before they've pressed a key. */
    function nextType(row) {
        if (row < 4) return 'sand';
        if (chunk.left <= 0) {
            const d = difficulty(row);
            const options = [
                ['road', 0.36],
                ['water', 0.24 + 0.06 * d],
                ['rail', row > 12 ? 0.14 : 0],
                ['sand', 0.26 - 0.08 * d]
            ].filter(function (o) { return o[0] !== chunk.type && o[1] > 0; });
            let total = 0;
            options.forEach(function (o) { total += o[1]; });
            let roll = Math.random() * total;
            let type = options[0][0];
            for (const o of options) {
                roll -= o[1];
                if (roll <= 0) { type = o[0]; break; }
            }
            const lengths = {
                road: 1 + ((Math.random() * (2 + 2 * d)) | 0),
                water: 1 + ((Math.random() * 3) | 0),
                rail: Math.random() < 0.3 ? 2 : 1,
                sand: Math.random() < 0.35 ? 2 : 1
            };
            chunk = { type: type, left: lengths[type] };
        }
        chunk.left--;
        return chunk.type;
    }

    function makeVehicle() {
        const roll = Math.random();
        const kind = roll < 0.62 ? 'car' : roll < 0.84 ? 'van' : 'icecream';
        const w = kind === 'car' ? 64 : kind === 'van' ? 80 : 112;
        return { kind: kind, w: w, color: CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0] };
    }

    function maybeCoin(lane, chance) {
        if (Math.random() >= chance) return;
        for (let tries = 0; tries < 6; tries++) {
            const c = (Math.random() * COLS) | 0;
            if (!lane.blocked.has(c)) { lane.coins.add(c); return; }
        }
    }

    /* Spread movers across the whole lane so it starts mid-traffic. */
    function prefill(lane) {
        let x = -rand(0, lane.gapMax);
        while (x < W + CELL) {
            const it = lane.make();
            it.x = x;
            lane.items.push(it);
            x += it.w + rand(lane.gapMin, lane.gapMax);
        }
        lane.nextGap = rand(lane.gapMin, lane.gapMax);
    }

    function makeLane(row) {
        const type = nextType(row);
        const d = difficulty(Math.max(0, row));
        const lane = {
            row: row,
            type: type,
            items: [],
            blocked: new Map(),
            coins: new Set(),
            seed: ((row * 7919) % 1000 + 1000) % 1000
        };

        if (type === 'sand') {
            if (row < 0) {
                /* behind the start: a grove you can't wander into */
                for (let c = 0; c < COLS; c++) {
                    if (c % 2 === 0 || Math.random() < 0.5) lane.blocked.set(c, 'palm');
                }
            } else if (row < 4) {
                [0, 1, 11, 12].forEach(function (c) {
                    if (Math.random() < 0.55) lane.blocked.set(c, pickDecor());
                });
            } else {
                const n = (Math.random() * (3 + d * 2)) | 0;
                for (let i = 0; i < n; i++) lane.blocked.set((Math.random() * COLS) | 0, pickDecor());
                maybeCoin(lane, 0.16);
            }
        } else if (type === 'road') {
            lane.dir = Math.random() < 0.5 ? 1 : -1;
            lane.speed = rand(70, 135) * (1 + 0.7 * d);
            lane.gapMin = CELL * (2.4 - 0.7 * d);
            lane.gapMax = CELL * (5.5 - 1.6 * d);
            lane.make = makeVehicle;
            prefill(lane);
            maybeCoin(lane, 0.1);
        } else if (type === 'water') {
            /* neighbouring rivers flow opposite ways */
            lane.dir = -lastWaterDir;
            lastWaterDir = lane.dir;
            lane.speed = rand(42, 80) * (1 + 0.5 * d);
            lane.gapMin = CELL * 0.9;
            lane.gapMax = CELL * (2.1 + 0.5 * d);
            lane.make = function () {
                const cells = 2 + ((Math.random() * (d > 0.6 ? 2 : 3)) | 0);
                return { kind: 'log', w: cells * CELL };
            };
            prefill(lane);
        } else {
            lane.dir = Math.random() < 0.5 ? 1 : -1;
            lane.rail = { phase: 'idle', timer: rand(1.2, 4.5), train: null };
        }
        return lane;
    }

    function laneAt(row) {
        let lane = lanes.get(row);
        if (!lane) {
            lane = makeLane(row);
            lanes.set(row, lane);
        }
        return lane;
    }

    function ensureLanes() {
        while (genRow <= camY + ROWS + 3) {
            lanes.set(genRow, makeLane(genRow));
            genRow++;
        }
        const floor = Math.floor(camY) - 3;
        lanes.forEach(function (_, row) { if (row < floor) lanes.delete(row); });
    }

    function updateMovers(lane, dt) {
        const step = lane.dir * lane.speed * dt;
        lane.items.forEach(function (it) { it.x += step; });
        lane.items = lane.items.filter(function (it) {
            return it.x < W + CELL * 3 && it.x + it.w > -CELL * 3;
        });

        /* feed new ones in from upstream, off screen */
        if (lane.dir > 0) {
            let lead = Infinity;
            lane.items.forEach(function (it) { lead = Math.min(lead, it.x); });
            if (lead === Infinity) lead = -CELL;
            while (lead - lane.nextGap > -CELL * 2) {
                const it = lane.make();
                it.x = lead - lane.nextGap - it.w;
                lane.items.push(it);
                lead = it.x;
                lane.nextGap = rand(lane.gapMin, lane.gapMax);
            }
        } else {
            let tail = -Infinity;
            lane.items.forEach(function (it) { tail = Math.max(tail, it.x + it.w); });
            if (tail === -Infinity) tail = W + CELL;
            while (tail + lane.nextGap < W + CELL * 2) {
                const it = lane.make();
                it.x = tail + lane.nextGap;
                lane.items.push(it);
                tail = it.x + it.w;
                lane.nextGap = rand(lane.gapMin, lane.gapMax);
            }
        }
    }

    function updateRail(lane, dt) {
        const r = lane.rail;
        r.timer -= dt;
        if (r.phase === 'idle' && r.timer <= 0) {
            r.phase = 'warn';
            r.timer = 1.1;
        } else if (r.phase === 'warn' && r.timer <= 0) {
            r.phase = 'pass';
            const w = CELL * 12;
            r.train = { x: lane.dir > 0 ? -w - CELL : W + CELL, w: w };
        }
        if (r.phase === 'pass') {
            r.train.x += lane.dir * 1150 * dt;
            const gone = lane.dir > 0 ? r.train.x > W + CELL : r.train.x + r.train.w < -CELL;
            if (gone) {
                r.phase = 'idle';
                r.timer = rand(2.5, 6);
                r.train = null;
            }
        }
    }

    function updateLanes(dt) {
        const lo = Math.floor(camY) - 2;
        const hi = Math.ceil(camY + ROWS) + 2;
        for (let row = lo; row <= hi; row++) {
            const lane = laneAt(row);
            if (lane.type === 'road' || lane.type === 'water') updateMovers(lane, dt);
            else if (lane.type === 'rail') updateRail(lane, dt);
        }
    }

    /* ---------------------------------------------------------
       The player
       --------------------------------------------------------- */

    let player;
    let queued = null;
    let camY;
    let started = false;
    let runCoins = 0;
    let particles = [];
    let gull = null;
    let time = 0;
    let state = 'ready';
    let best = readStore('ssow-road-best', 0);
    let banked = readStore('ssow-road-cigar', 0);

    function reset() {
        lanes = new Map();
        genRow = -4;
        chunk = { type: 'sand', left: 0 };
        lastWaterDir = 1;
        camY = -3;
        player = {
            row: 0, x: colX(START_COL), facing: 1, hop: null, log: null, logOffset: 0,
            alive: true, maxRow: 0, tilt: 1, land: 0, bump: 0, bumpDx: 0, death: null
        };
        queued = null;
        started = false;
        runCoins = 0;
        particles = [];
        gull = null;
        ensureLanes();
        updateHud();
    }

    /* Where the whale is *now*, mid-hop included. Collisions use the
       row it is leaving until it is halfway across. */
    function playerPos() {
        const p = player;
        if (!p.hop) return { x: p.x, row: p.row };
        return {
            x: lerp(p.hop.fromX, p.hop.toX, p.hop.t),
            row: p.hop.t < 0.5 ? p.hop.fromRow : p.hop.toRow
        };
    }

    function bump(dx) {
        player.bump = 1;
        player.bumpDx = dx || 0;
    }

    function tryMove(dx, dy) {
        const p = player;
        if (!p.alive) return;
        if (p.hop) { queued = [dx, dy]; return; }   /* one buffered hop, like the original */

        const toRow = p.row + dy;
        const target = laneAt(toRow);
        let toX = p.x + dx * CELL;
        /* off the water you're back on the grid */
        if (target.type !== 'water') toX = colX(colOf(toX));

        if (toX < CELL / 2 - 1 || toX > W - CELL / 2 + 1) { bump(dx); return; }
        if (target.type === 'sand' && target.blocked.has(colOf(toX))) { bump(dx); return; }

        if (dx) p.facing = dx;
        p.tilt = -p.tilt;                            /* lean the other way each hop: a waddle */
        p.log = null;
        p.hop = { fromX: p.x, fromRow: p.row, toX: toX, toRow: toRow, t: 0 };
        started = true;
    }

    function land() {
        const p = player;
        const h = p.hop;
        p.row = h.toRow;
        p.x = h.toX;
        p.hop = null;
        p.land = 1;

        const lane = laneAt(p.row);
        if (lane.type === 'water') {
            const log = lane.items.find(function (it) { return p.x > it.x + 6 && p.x < it.x + it.w - 6; });
            if (!log) { die('drown'); return; }
            /* settle onto the nearest plank of the log */
            const slots = Math.round(log.w / CELL);
            const slot = clamp(Math.floor((p.x - log.x) / CELL), 0, slots - 1);
            p.log = log;
            p.logOffset = slot * CELL + CELL / 2;
            p.x = log.x + p.logOffset;
        } else {
            const c = colOf(p.x);
            if (lane.coins.has(c)) {
                lane.coins.delete(c);
                runCoins++;
                burst(p.x, p.row * CELL + 26, ['#ffcf4a', '#fff1b0', '#b8860b'], 10);
            }
        }

        if (p.row > p.maxRow) p.maxRow = p.row;
        updateHud();

        if (queued) {
            const q = queued;
            queued = null;
            tryMove(q[0], q[1]);
        }
    }

    function checkHits() {
        const pos = playerPos();
        const lane = laneAt(pos.row);
        const half = 13;
        if (lane.type === 'road') {
            for (const it of lane.items) {
                if (pos.x + half > it.x + 4 && pos.x - half < it.x + it.w - 4) { die('car', it); return; }
            }
        } else if (lane.type === 'rail' && lane.rail.train) {
            const t = lane.rail.train;
            if (pos.x + half > t.x && pos.x - half < t.x + t.w) die('train');
        }
    }

    function updatePlayer(dt) {
        const p = player;
        if (p.land > 0) p.land = Math.max(0, p.land - dt * 8);
        if (p.bump > 0) p.bump = Math.max(0, p.bump - dt * 6);
        if (!p.alive) return;

        if (p.hop) {
            p.hop.t += (dt * 1000) / HOP_MS;
            if (p.hop.t >= 1) land();
        } else if (p.log) {
            p.x = p.log.x + p.logOffset;
            if (p.x < CELL * 0.3 || p.x > W - CELL * 0.3) die('drift');
        }
        if (p.alive) checkHits();
    }

    /* The camera follows, and also creeps forward on its own once you
       start - the longer the run, the faster. Fall off the bottom and
       the seagull has you. */
    function updateCamera(dt) {
        const p = player;
        const target = (p.hop ? p.hop.toRow : p.row) - 3;
        if (target > camY) camY += (target - camY) * Math.min(1, dt * 5);
        if (started && p.alive) camY += (0.28 + Math.min(0.4, p.maxRow * 0.0025)) * dt;
        ensureLanes();
        if (p.alive && !p.hop && p.row < camY - 0.5) die('seagull');
    }

    const DEATHS = {
        car: function (it) {
            const what = it && it.kind === 'icecream' ? 'an ice cream truck'
                : it && it.kind === 'van' ? 'a van' : 'a car';
            return 'Flattened by ' + what + '.';
        },
        train: function () { return 'The tram waits for no whale.'; },
        drown: function () { return 'Turns out whales in suits can’t swim.'; },
        drift: function () { return 'Drifted out to sea.'; },
        seagull: function () { return 'Snatched by a seagull. Keep moving!'; }
    };

    function die(kind, item) {
        const p = player;
        if (!p.alive) return;
        const pos = playerPos();
        p.x = pos.x;
        p.row = pos.row;
        p.hop = null;
        p.log = null;
        p.alive = false;
        p.death = { kind: kind, t: 0, message: DEATHS[kind](item), prevBest: best };
        queued = null;
        state = 'dying';

        if (kind === 'drown' || kind === 'drift') {
            burst(p.x, p.row * CELL + 18, ['#ffffff', '#bfe3ff', '#5aa7dc'], 16);
        }
        if (kind === 'seagull') gull = { t: 0 };

        if (p.maxRow > best) best = p.maxRow;
        banked += runCoins;
        writeStore('ssow-road-best', best);
        writeStore('ssow-road-cigar', banked);
        updateRecords();
    }

    /* ---------------------------------------------------------
       Particles (splashes, coin sparkles) — world px, y pointing up
       --------------------------------------------------------- */

    function burst(x, wy, colors, n) {
        for (let i = 0; i < n; i++) {
            particles.push({
                x: x, wy: wy,
                vx: rand(-90, 90), vy: rand(80, 230),
                life: rand(0.35, 0.7),
                color: colors[i % colors.length],
                size: Math.random() < 0.5 ? 3 : 4
            });
        }
    }

    function updateParticles(dt) {
        particles.forEach(function (q) {
            q.x += q.vx * dt;
            q.wy += q.vy * dt;
            q.vy -= 600 * dt;
            q.life -= dt;
        });
        particles = particles.filter(function (q) { return q.life > 0; });
    }

    /* ---------------------------------------------------------
       Drawing
       --------------------------------------------------------- */

    function laneY(row) { return Math.round(H - (row - camY + 1) * CELL); }
    function screenY(wy) { return H - (wy - camY * CELL); }

    function drawGround(lane, y) {
        const alt = (lane.row & 1) === 0;
        if (lane.type === 'sand') {
            fill(alt ? '#ead59e' : '#e3cc90', 0, y, W, CELL);
            for (let i = 0; i < 7; i++) {
                const sx = (lane.seed * 13 + i * 89) % W;
                const sy = (lane.seed * 7 + i * 17) % (CELL - 8);
                fill('#d4bb81', sx, y + 3 + sy, 3, 3);
            }
            fill('#cdb47a', 0, y + CELL - 3, W, 3);
        } else if (lane.type === 'road') {
            fill('#3b404c', 0, y, W, CELL);
            const above = lanes.get(lane.row + 1);
            const below = lanes.get(lane.row - 1);
            if (above && above.type === 'road') {
                for (let x = 8; x < W; x += 44) fill('#d9dde3', x, y - 1, 22, 2);
            } else {
                fill('#8e95a1', 0, y, W, 3);
            }
            if (!below || below.type !== 'road') fill('#8e95a1', 0, y + CELL - 4, W, 4);
        } else if (lane.type === 'water') {
            fill(alt ? '#2c79b4' : '#2a73ad', 0, y, W, CELL);
            fill('#1d5a8a', 0, y, W, 4);
            const drift = time * lane.dir * lane.speed * 0.25;
            for (let i = 0; i < 7; i++) {
                const rx = ((((lane.seed * 37 + i * 109 + drift) % (W + 40)) + (W + 40)) % (W + 40)) - 20;
                fill('#5aa7dc', rx, y + 10 + ((i * 11) % 28), 10, 2);
            }
        } else {
            fill(alt ? '#80776d' : '#796f66', 0, y, W, CELL);
            for (let x = lane.seed % 24; x < W; x += 24) fill('#5b4636', x, y + 10, 8, 30);
            fill('#c3c8d0', 0, y + 16, W, 3);
            fill('#c3c8d0', 0, y + 31, W, 3);
            fill('#eef1f5', 0, y + 16, W, 1);
            fill('#eef1f5', 0, y + 31, W, 1);
            /* the signal: dark until a tram is due, then blinking red */
            const r = lane.rail;
            const lit = r.phase === 'pass' || (r.phase === 'warn' && Math.floor(time * 8) % 2 === 0);
            fill('#2b2f36', W - 14, y - 10, 4, 34);
            fill('#1c1f24', W - 19, y - 18, 14, 10);
            fill(lit ? '#ff4d4d' : '#5a1e1e', W - 17, y - 16, 10, 6);
        }
    }

    function drawShadow(cx, y, w) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(Math.round(cx - w / 2), Math.round(y), Math.round(w), 5);
    }

    function drawDecor(kind, cx, y) {
        const base = y + CELL - 10;
        if (kind === 'palm') {
            drawShadow(cx, base + 2, 30);
            for (let i = 0; i < 5; i++) fill(i % 2 ? '#8a5a33' : '#9b6a3d', cx - 4, base - 6 - i * 8, 8, 8);
            const ty = base - 48;
            fill('#2f8f45', cx - 22, ty, 44, 8);
            fill('#3fa856', cx - 15, ty - 7, 30, 8);
            fill('#2f8f45', cx - 27, ty + 8, 12, 6);
            fill('#2f8f45', cx + 15, ty + 8, 12, 6);
            fill('#6b4423', cx - 5, ty + 8, 4, 4);
            fill('#6b4423', cx + 1, ty + 8, 4, 4);
        } else if (kind === 'crate') {
            drawShadow(cx, base + 2, 36);
            fill('#c08a52', cx - 17, y + 6, 34, 9);
            fill('#a8743f', cx - 17, y + 15, 34, 24);
            fill('#7a4e25', cx - 17, y + 26, 34, 2);
            fill('#7a4e25', cx - 2, y + 15, 3, 24);
            fill('#5d3a1a', cx - 17, y + 37, 34, 2);
        } else {
            drawShadow(cx, base + 2, 26);
            fill('#e6e6e6', cx - 1, y + 4, 3, CELL - 12);
            fill('#e8524a', cx - 24, y + 2, 48, 6);
            fill('#ffffff', cx - 16, y - 3, 32, 5);
            fill('#e8524a', cx - 8, y - 6, 16, 3);
        }
    }

    function drawCoin(cx, y) {
        const cy = y + 24 + Math.round(Math.sin(time * 4 + cx) * 2);
        drawShadow(cx, y + CELL - 12, 12);
        fill('#b8860b', cx - 6, cy - 8, 12, 16);
        fill('#b8860b', cx - 8, cy - 6, 16, 12);
        fill('#ffcf4a', cx - 5, cy - 7, 10, 14);
        fill('#ffcf4a', cx - 7, cy - 5, 14, 10);
        fill('#7a4a22', cx - 5, cy - 1, 8, 3);
        fill('#ff5a36', cx + 3, cy - 1, 2, 3);
    }

    function drawVehicle(it, y, dir) {
        const x = Math.round(it.x);
        const w = it.w;
        const body = it.kind === 'icecream' ? '#fbfbfb' : it.color;
        drawShadow(x + w / 2, y + CELL - 9, w - 6);
        fill(shade(body, 25), x + 2, y + 10, w - 4, 6);          /* top */
        fill(body, x, y + 14, w, 18);
        fill(shade(body, -45), x, y + 30, w, 8);                   /* front face */
        if (it.kind === 'icecream') {
            fill('#f28fb1', x, y + 22, w, 4);
            fill('#e7b169', x + w / 2 - 4, y + 2, 8, 8);
            fill('#f28fb1', x + w / 2 - 6, y - 4, 12, 7);
            fill('#2a3a4f', (dir > 0 ? x + w - 22 : x + 6), y + 16, 16, 7);
        } else {
            const cab = it.kind === 'van' ? w - 14 : w - 26;
            const cx = dir > 0 ? x + w - cab - 8 : x + 8;
            fill(shade(body, 40), cx, y + 6, cab, 10);
            fill('#2a3a4f', cx + 3, y + 8, cab - 6, 6);
        }
        fill('#141414', x + 7, y + 36, 11, 6);
        fill('#141414', x + w - 18, y + 36, 11, 6);
        fill('#ffe28a', dir > 0 ? x + w - 3 : x, y + 20, 3, 6);
        fill('#c0392b', dir > 0 ? x : x + w - 3, y + 20, 3, 6);
    }

    function drawLog(it, y) {
        const x = Math.round(it.x);
        fill('#6d4420', x, y + 36, it.w, 4);
        fill('#8b5a2b', x, y + 18, it.w, 18);
        fill('#a8743d', x, y + 14, it.w, 6);
        for (let bx = x + 14; bx < x + it.w - 10; bx += 22) fill('#74481f', bx, y + 24, 10, 2);
        fill('#c9a173', x, y + 16, 6, 20);
        fill('#c9a173', x + it.w - 6, y + 16, 6, 20);
        fill('#9c7650', x + 2, y + 22, 2, 8);
        fill('#9c7650', x + it.w - 4, y + 22, 2, 8);
    }

    function drawTrain(t, y, dir) {
        const seg = CELL * 3;
        for (let s = 0; s < 4; s++) {
            const sx = Math.round(t.x + s * seg);
            drawShadow(sx + seg / 2, y + CELL - 8, seg - 6);
            fill('#e46a5e', sx + 2, y + 2, seg - 6, 6);
            fill('#c8473d', sx + 2, y + 8, seg - 6, 26);
            fill('#f2f2f2', sx + 2, y + 22, seg - 6, 4);
            fill('#8e2b23', sx + 2, y + 34, seg - 6, 6);
            for (let wx = sx + 10; wx < sx + seg - 16; wx += 22) fill('#2a3a4f', wx, y + 11, 14, 8);
            fill('#3a3a3a', sx - 2, y + 18, 4, 8);
        }
        const nose = dir > 0 ? Math.round(t.x + t.w - 6) : Math.round(t.x + 2);
        fill('#ffe28a', nose, y + 14, 4, 8);
    }

    function drawThings(lane, y) {
        if (lane.type === 'sand') {
            lane.blocked.forEach(function (kind, c) { drawDecor(kind, colX(c), y); });
        }
        lane.coins.forEach(function (c) { drawCoin(colX(c), y); });
        if (lane.type === 'road') lane.items.forEach(function (it) { drawVehicle(it, y, lane.dir); });
        else if (lane.type === 'water') lane.items.forEach(function (it) { drawLog(it, y); });
        else if (lane.type === 'rail' && lane.rail.train) drawTrain(lane.rail.train, y, lane.dir);
    }

    function footY(row) {
        const lane = laneAt(row);
        return laneY(row) + (lane.type === 'water' ? CELL - 12 : CELL - 7);
    }

    /* Everything about the whale's pose comes from here: the hop arc,
       squash on landing, stretch in the air, a lean that alternates
       hop to hop, a slow idle breath, and the way it dies. */
    function playerPose() {
        const p = player;
        let x = p.x;
        let fy = footY(p.row);
        let lift = 0;
        let sx = 1;
        let sy = 1;
        let rot = 0;
        let alpha = 1;

        if (p.hop) {
            const t = p.hop.t;
            const a = Math.sin(Math.PI * t);
            x = lerp(p.hop.fromX, p.hop.toX, t);
            fy = lerp(footY(p.hop.fromRow), footY(p.hop.toRow), t);
            lift = a * 14;
            sy = 1 + 0.1 * a;
            sx = 1 - 0.07 * a;
            rot = p.tilt * 0.12 * a;
        } else if (p.alive) {
            const breath = Math.sin(time * 3.2) * 0.02;
            sy = 1 + breath - 0.16 * p.land;
            sx = 1 + 0.12 * p.land;
        }

        if (p.bump) x += p.bumpDx * 3 * Math.sin(p.bump * Math.PI * 3);

        if (p.death) {
            const k = p.death.kind;
            if (k === 'car' || k === 'train') {
                sy = 0.22;
                sx = 1.4;
                rot = 0;
            } else if (k === 'drown' || k === 'drift') {
                lift = -Math.min(1, p.death.t * 1.6) * 26;
                alpha = Math.max(0, 1 - p.death.t * 1.4);
            }
        }
        return { x: x, fy: fy, lift: lift, sx: sx, sy: sy, rot: rot, alpha: alpha };
    }

    function drawWhale(x, feet, sx, sy, rot, alpha, facing) {
        const s = sprite;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(Math.round(x), Math.round(feet));
        ctx.rotate(rot);
        ctx.scale(sx * facing, sy);
        ctx.drawImage(s, -Math.round(s.width / 2), -s.height);
        ctx.restore();
    }

    function drawPlayer(pose) {
        const p = player;
        if (p.death && p.death.kind === 'seagull' && gull && gull.t > 0.45) return;  /* it's airborne */
        const sinking = p.death && (p.death.kind === 'drown' || p.death.kind === 'drift');
        if (sinking) {
            /* disappear *into* the water: cut the sprite off at the surface */
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, W, footY(p.row) - 2);
            ctx.clip();
            drawWhale(pose.x, pose.fy - pose.lift, pose.sx, pose.sy, pose.rot, pose.alpha, p.facing);
            ctx.restore();
            return;
        }
        drawShadow(pose.x, pose.fy - 3, 24 * (1 - 0.35 * (pose.lift / 14)));
        drawWhale(pose.x, pose.fy - pose.lift, pose.sx, pose.sy, pose.rot, pose.alpha, p.facing);
    }

    function drawGull() {
        if (!gull) return;
        const p = player;
        const wx = p.x;
        const wy = footY(p.row) - sprite.height * 0.85;
        let gx;
        let gy;
        if (gull.t < 0.45) {
            const u = gull.t / 0.45;
            const e = 1 - (1 - u) * (1 - u);
            gx = lerp(W + 40, wx, e);
            gy = lerp(-30, wy - 6, e);
        } else {
            const u = Math.min(1, (gull.t - 0.45) / 0.8);
            gx = lerp(wx, -80, u * u);
            gy = lerp(wy - 6, -120, u);
            drawWhale(gx, gy + 6 + sprite.height, 1, 1, -0.25, 1, p.facing);
        }
        /* drawn at 2x around (gx, gy): at 1x it was lost next to the whale */
        const flap = Math.floor(time * 14) % 2 === 0;
        ctx.save();
        ctx.translate(Math.round(gx), Math.round(gy));
        ctx.scale(2, 2);
        fill('#c9ced4', -16, -2, 7, 5);
        fill('#f4f4f4', -10, -4, 20, 9);
        fill('#f4f4f4', 8, -9, 8, 8);
        fill('#f2a33a', 16, -6, 6, 3);
        fill('#111111', 12, -7, 2, 2);
        if (flap) fill('#9aa3ad', -8, -15, 14, 11);
        else fill('#9aa3ad', -8, 3, 14, 8);
        ctx.restore();
    }

    function draw() {
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.imageSmoothingEnabled = false;
        fill('#0c1a2a', 0, 0, W, H);

        const pose = playerPose();
        /* the whale is drawn with whichever lane its feet are in, so
           nearer lanes (and their palms and trucks) overlap it. A sinking
           whale stays with its own lane - it's going down, not forward. */
        const p = player;
        const sinking = p.death && (p.death.kind === 'drown' || p.death.kind === 'drift');
        const playerRow = sinking ? p.row
            : Math.ceil(camY - 1 + (H - (pose.fy - pose.lift)) / CELL);

        const top = Math.ceil(camY + ROWS);
        const bottom = Math.floor(camY) - 1;
        for (let row = top; row >= bottom; row--) {
            const lane = laneAt(row);
            const y = laneY(row);
            drawGround(lane, y);
            drawThings(lane, y);
            if (row === playerRow) drawPlayer(pose);
        }
        if (playerRow > top || playerRow < bottom) drawPlayer(pose);

        particles.forEach(function (q) {
            fill(q.color, q.x - q.size / 2, screenY(q.wy) - q.size / 2, q.size, q.size);
        });
        drawGull();
    }

    /* ---------------------------------------------------------
       Loop, HUD, overlay, input
       --------------------------------------------------------- */

    function updateHud() {
        els.score.textContent = player ? player.maxRow : 0;
        els.coins.textContent = runCoins;
    }

    function updateRecords() {
        els.best.textContent = best;
        els.banked.textContent = banked;
    }

    function showOverlay(kicker, title, html, button) {
        els.kicker.textContent = kicker;
        els.title.textContent = title;
        els.text.innerHTML = html;
        els.button.textContent = button;
        els.overlay.hidden = false;
    }

    function hideOverlay() { els.overlay.hidden = true; }

    function begin() {
        state = 'playing';
        hideOverlay();
        canvas.focus({ preventScroll: true });
    }

    function restart() {
        reset();
        begin();
    }

    function gameOver() {
        state = 'over';
        const p = player;
        const fresh = p.maxRow > p.death.prevBest;
        showOverlay(
            p.death.message,
            String(p.maxRow),
            (fresh ? 'New best! ' : 'Best ' + best + ' · ') +
                (runCoins ? '+' + runCoins + ' $CIGAR · ' : '') +
                'press <kbd>Space</kbd> to go again',
            'Play again'
        );
    }

    function pause() {
        if (state !== 'playing') return;
        state = 'paused';
        showOverlay('Paused', 'Breather', 'Press <kbd>P</kbd> or <kbd>Space</kbd> to keep going.', 'Resume');
    }

    function primary() {
        if (state === 'ready') begin();
        else if (state === 'over') restart();
        else if (state === 'paused') begin();
    }

    let k = 1;   /* device pixels per world pixel */

    /* An integer number of device pixels per art pixel keeps the pixel
       art crisp; CSS then makes up the small remaining difference. */
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const next = clamp(Math.round((rect.width * dpr) / W), 1, 4);
        if (next !== k || canvas.width !== W * next) {
            k = next;
            canvas.width = W * k;
            canvas.height = H * k;
        }
    }

    let last = performance.now();

    function frame(now) {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        time += dt;

        if (state === 'playing' || state === 'dying') {
            updateLanes(dt);
            updatePlayer(dt);
            updateCamera(dt);
            updateParticles(dt);
            if (gull) gull.t += dt;
            if (state === 'dying') {
                player.death.t += dt;
                if (player.death.t > (player.death.kind === 'seagull' ? 1.35 : 0.9)) gameOver();
            }
        } else if (state === 'ready' || state === 'over') {
            /* traffic keeps moving behind the menu */
            updateLanes(dt);
            updateParticles(dt);
            if (gull) gull.t += dt;
        }

        draw();
        window.requestAnimationFrame(frame);
    }

    const KEYS = {
        ArrowUp: [0, 1], KeyW: [0, 1],
        ArrowDown: [0, -1], KeyS: [0, -1],
        ArrowLeft: [-1, 0], KeyA: [-1, 0],
        ArrowRight: [1, 0], KeyD: [1, 0]
    };

    /* Only grab keys while the board is on screen, so arrow keys still
       scroll the page when you're down reading the footer. */
    let boardVisible = true;
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            boardVisible = entries[0].isIntersecting;
        }, { threshold: 0.35 }).observe(els.frame);
    }

    window.addEventListener('keydown', function (e) {
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        const move = KEYS[e.code];
        const inGame = state === 'playing' || state === 'paused' || state === 'dying';
        if (!inGame && !boardVisible) return;
        if (!move && e.code !== 'Space' && e.code !== 'KeyP' && e.code !== 'Escape') return;

        e.preventDefault();
        if (e.repeat) return;                      /* tap to hop, no holding */

        if (e.code === 'Space') { primary(); return; }
        if (e.code === 'KeyP' || e.code === 'Escape') {
            if (state === 'playing') pause();
            else if (state === 'paused') begin();
            return;
        }
        if (state === 'ready') begin();
        else if (state === 'over') restart();
        if (state === 'playing') tryMove(move[0], move[1]);
    });

    els.button.addEventListener('click', primary);

    /* Tabbing away mid-run shouldn't kill you. */
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) pause();
        last = performance.now();
    });

    els.load.addEventListener('click', function () { chooseWhale(els.number.value); });
    els.number.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); chooseWhale(els.number.value); }
    });
    els.random.addEventListener('click', function () {
        chooseWhale((Math.random() * SUPPLY) | 0);
    });

    /* ---------------------------------------------------------
       Boot
       --------------------------------------------------------- */

    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    reset();
    updateRecords();
    drawPreview();
    showOverlay('Whale Road', 'Ready?', 'Hop with <kbd>W</kbd> or <kbd>↑</kbd>. Press <kbd>Space</kbd> to start.', 'Play');

    const saved = readStore('ssow-road-whale', null);
    chooseWhale(Number.isInteger(saved) ? saved : (Math.random() * SUPPLY) | 0);

    window.requestAnimationFrame(frame);
})();
