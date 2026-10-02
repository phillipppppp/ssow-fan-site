/* ============================================================
   WhaleSim — the rules of Whale Road, with no screen attached.

   Everything that decides a score lives here, and nothing else
   does. The browser runs it to play; the server runs the *same
   file* to replay a finished run from its seed and the player's
   key presses, and trusts only its own result. So the rules must
   be fully deterministic:

     - one seeded RNG (mulberry32) and never Math.random
     - a fixed 60 Hz tick; no wall-clock time anywhere
     - inputs are applied between ticks, tagged with the tick

   Drawing, sound and particles belong to game.js. It reads the
   state and drains the events, and must never touch the RNG.

   Loads as a browser global (window.WhaleSim), a CommonJS module,
   or a side-effect import in Deno (globalThis.WhaleSim).
   ============================================================ */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WhaleSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /* Bump whenever a rule changes: the server refuses runs played
       under a different version, because they would replay wrong. */
    const VERSION = 1;

    const TICK_HZ = 60;
    const DT = 1 / TICK_HZ;
    const CELL = 48;
    const COLS = 13;
    const ROWS = 10;
    const W = CELL * COLS;
    const H = CELL * ROWS;
    const HOP_TICKS = 7;                     /* ~117 ms */
    const START_COL = 6;
    const MAX_TICKS = TICK_HZ * 60 * 20;     /* 20 minutes is plenty */

    const ZONE_SEA = 50;
    const ZONE_ARCTIC = 100;

    const SHIELD_GRACE = 90;                 /* ticks of safety after the bubble pops */
    const DASH_GRACE = 30;
    const DASH_MAX = 30;                     /* Speed Dash: 1 - 30 rows */
    const MAGNET_ROWS = 2;
    const MAGNET_COLS = 3;
    const TRAP_TICKS = 55;                   /* stuck in a net */
    const NET_IMMUNE = 35;                   /* ...then a moment to swim clear */

    const PRICES = { shield: 20, dash: 30, magnet: 15 };

    /* Each zone re-skins the same five kinds of lane:
         safe     walk or swim; blockers in the way
         traffic  movers that flatten you
         river    you must ride the movers or drown
         express  a warning, then something very fast
         net      drifting nets that hold you still */
    const ZONES = {
        harbour: {
            names: { safe: 'sand', traffic: 'road', river: 'water', express: 'rail' },
            decor: ['palm', 'palm', 'palm', 'crate', 'crate', 'umbrella'],
            movers: [['car', 64, 0.62], ['van', 80, 0.84], ['icecream', 112, 1]],
            raft: 'log',
            rider: { kind: 'tram', cells: 12, speed: 1150, warn: 66 },
            nets: false
        },
        sea: {
            names: { safe: 'shallows', traffic: 'boats', river: 'riptide', express: 'sharks', net: 'nets' },
            decor: ['coral', 'coral', 'buoy', 'rock'],
            movers: [['jetski', 56, 0.4], ['boat', 88, 0.8], ['yacht', 128, 1]],
            raft: 'kelp',
            rider: { kind: 'shark', cells: 2.5, speed: 820, warn: 60 },
            nets: true
        },
        arctic: {
            names: { safe: 'snow', traffic: 'icelane', river: 'floes', express: 'orcas' },
            decor: ['iceberg', 'iceberg', 'snowman', 'igloo'],
            movers: [['snowmobile', 56, 0.45], ['icebreaker', 136, 0.75], ['sled', 72, 1]],
            raft: 'floe',
            rider: { kind: 'orca', cells: 3.5, speed: 760, warn: 60 },
            nets: false
        }
    };

    const PAINT = ['#e0563f', '#f2c14e', '#4c9be8', '#6fcf7a', '#f28fb1', '#e9e9e9', '#9b7ff0'];

    function zoneOf(row) {
        return row >= ZONE_ARCTIC ? 'arctic' : row >= ZONE_SEA ? 'sea' : 'harbour';
    }

    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function lerp(a, b, t) { return a + (b - a) * t; }
    function colX(c) { return c * CELL + CELL / 2; }
    function colOf(x) { return clamp(Math.round((x - CELL / 2) / CELL), 0, COLS - 1); }
    function difficulty(row) { return clamp(row / 160, 0, 1); }

    /* mulberry32: tiny, fast, and identical in every JS engine */
    function rng32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    /* ---------------------------------------------------------
       A run
       --------------------------------------------------------- */

    function create(opts) {
        const loadout = (opts && opts.loadout) || {};
        const rand = rng32((opts && opts.seed) || 1);
        const r = function (a, b) { return a + rand() * (b - a); };

        const sim = {
            tick: 0,
            lanes: new Map(),
            camY: -3,
            started: false,
            coins: 0,
            score: 0,
            over: false,
            deathTick: -1,
            events: [],
            player: {
                row: 0, x: colX(START_COL), facing: 1, tilt: 1,
                hop: null, raft: null, raftOffset: 0,
                alive: true, death: null,
                shield: !!loadout.shield,
                dashes: loadout.dash ? 1 : 0,
                magnet: !!loadout.magnet,
                grace: 0, trap: 0, netImmune: 0,
                lastSafe: { row: 0, x: colX(START_COL) }
            },
            input: input,
            step: step,
            laneAt: laneAt,
            drain: function () { const e = sim.events; sim.events = []; return e; }
        };

        let genRow = -4;
        let chunk = { cat: 'safe', left: 0 };
        let lastRiverDir = 1;
        let queued = null;

        function emit(type, data) {
            const e = data || {};
            e.type = type;
            e.tick = sim.tick;
            sim.events.push(e);
        }

        /* ---------- world generation ---------- */

        function pickMover(zone) {
            const roll = rand();
            const list = ZONES[zone].movers;
            for (let i = 0; i < list.length; i++) {
                if (roll <= list[i][2]) {
                    return { kind: list[i][0], w: list[i][1], color: PAINT[(rand() * PAINT.length) | 0] };
                }
            }
            return { kind: list[0][0], w: list[0][1], color: PAINT[0] };
        }

        /* Lanes come in runs ("chunks") of the same kind, like the
           original. The first rows of the game and of each new zone are
           always safe ground, so a new world never opens on a road. */
        function nextCat(row) {
            if (row < 4) return 'safe';
            if (row === ZONE_SEA || row === ZONE_SEA + 1 || row === ZONE_ARCTIC || row === ZONE_ARCTIC + 1) {
                chunk = { cat: 'safe', left: 0 };
                return 'safe';
            }
            if (chunk.left <= 0) {
                const d = difficulty(row);
                const zone = ZONES[zoneOf(row)];
                const options = [
                    ['traffic', 0.36],
                    ['river', 0.24 + 0.06 * d],
                    ['express', row > 12 ? 0.14 : 0],
                    ['safe', 0.26 - 0.08 * d],
                    ['net', zone.nets ? 0.13 : 0]
                ].filter(function (o) { return o[0] !== chunk.cat && o[1] > 0; });
                let total = 0;
                options.forEach(function (o) { total += o[1]; });
                let roll = rand() * total;
                let cat = options[0][0];
                for (let i = 0; i < options.length; i++) {
                    roll -= options[i][1];
                    if (roll <= 0) { cat = options[i][0]; break; }
                }
                const lengths = {
                    traffic: 1 + ((rand() * (2 + 2 * d)) | 0),
                    river: 1 + ((rand() * 3) | 0),
                    express: rand() < 0.3 ? 2 : 1,
                    safe: rand() < 0.35 ? 2 : 1,
                    net: rand() < 0.4 ? 2 : 1
                };
                chunk = { cat: cat, left: lengths[cat] };
            }
            chunk.left--;
            return chunk.cat;
        }

        function maybeCoin(lane, chance) {
            if (rand() >= chance) return;
            for (let tries = 0; tries < 6; tries++) {
                const c = (rand() * COLS) | 0;
                if (!lane.blocked.has(c)) { lane.coins.add(c); return; }
            }
        }

        function prefill(lane) {
            let x = -r(0, lane.gapMax);
            while (x < W + CELL) {
                const it = lane.make();
                it.x = x;
                lane.items.push(it);
                x += it.w + r(lane.gapMin, lane.gapMax);
            }
            lane.nextGap = r(lane.gapMin, lane.gapMax);
        }

        function makeLane(row) {
            const cat = nextCat(row);
            const zone = zoneOf(row);
            const Z = ZONES[zone];
            const d = difficulty(Math.max(0, row));
            const lane = {
                row: row,
                cat: cat,
                zone: zone,
                type: Z.names[cat],
                items: [],
                blocked: new Map(),
                coins: new Set(),
                seed: ((row * 7919) % 1000 + 1000) % 1000,
                dir: 1,
                speed: 0
            };

            if (cat === 'safe') {
                if (row < 0) {
                    for (let c = 0; c < COLS; c++) {
                        if (c % 2 === 0 || rand() < 0.5) lane.blocked.set(c, 'palm');
                    }
                } else if (row < 4 || row === ZONE_SEA || row === ZONE_ARCTIC) {
                    [0, 1, 11, 12].forEach(function (c) {
                        if (rand() < 0.55) lane.blocked.set(c, Z.decor[(rand() * Z.decor.length) | 0]);
                    });
                } else {
                    const n = (rand() * (3 + d * 2)) | 0;
                    for (let i = 0; i < n; i++) {
                        lane.blocked.set((rand() * COLS) | 0, Z.decor[(rand() * Z.decor.length) | 0]);
                    }
                    maybeCoin(lane, 0.16);
                }
            } else if (cat === 'traffic') {
                lane.dir = rand() < 0.5 ? 1 : -1;
                lane.speed = r(70, 135) * (1 + 0.7 * d);
                lane.gapMin = CELL * (2.4 - 0.7 * d);
                lane.gapMax = CELL * (5.5 - 1.6 * d);
                lane.make = function () { return pickMover(zone); };
                prefill(lane);
                maybeCoin(lane, 0.1);
            } else if (cat === 'river') {
                lane.dir = -lastRiverDir;
                lastRiverDir = lane.dir;
                lane.speed = r(42, 80) * (1 + 0.5 * d);
                lane.gapMin = CELL * 0.9;
                lane.gapMax = CELL * (2.1 + 0.5 * d);
                lane.make = function () {
                    const cells = 2 + ((rand() * (d > 0.6 ? 2 : 3)) | 0);
                    return { kind: Z.raft, w: cells * CELL };
                };
                prefill(lane);
            } else if (cat === 'net') {
                lane.dir = rand() < 0.5 ? 1 : -1;
                lane.speed = r(22, 40) * (1 + 0.4 * d);
                lane.gapMin = CELL * 1.6;
                lane.gapMax = CELL * 4;
                lane.make = function () { return { kind: 'net', w: (2 + ((rand() * 2) | 0)) * CELL }; };
                prefill(lane);
                maybeCoin(lane, 0.1);
            } else {
                lane.dir = rand() < 0.5 ? 1 : -1;
                lane.express = { phase: 'idle', timer: Math.round(r(1.2, 4.5) * TICK_HZ), rider: null, spec: Z.rider };
            }
            return lane;
        }

        /* Rows must be generated strictly in order — generation draws
           from the RNG, and the replay has to draw in the same order. */
        function laneAt(row) {
            while (genRow <= row) {
                sim.lanes.set(genRow, makeLane(genRow));
                genRow++;
            }
            const lane = sim.lanes.get(row);
            if (lane) return lane;
            /* below the camera and already forgotten: a quiet stand-in */
            return { row: row, cat: 'safe', zone: zoneOf(row), type: ZONES[zoneOf(row)].names.safe, items: [], blocked: new Map(), coins: new Set(), seed: 0, dir: 1, speed: 0 };
        }

        function ensureLanes() {
            laneAt(Math.ceil(sim.camY + ROWS + 3));
            const floor = Math.floor(sim.camY) - 3;
            sim.lanes.forEach(function (_, row) { if (row < floor) sim.lanes.delete(row); });
        }

        /* ---------- moving things ---------- */

        function updateMovers(lane) {
            const step = lane.dir * lane.speed * DT;
            for (let i = 0; i < lane.items.length; i++) lane.items[i].x += step;
            lane.items = lane.items.filter(function (it) {
                return it.x < W + CELL * 3 && it.x + it.w > -CELL * 3;
            });

            if (lane.dir > 0) {
                let lead = Infinity;
                lane.items.forEach(function (it) { lead = Math.min(lead, it.x); });
                if (lead === Infinity) lead = -CELL;
                while (lead - lane.nextGap > -CELL * 2) {
                    const it = lane.make();
                    it.x = lead - lane.nextGap - it.w;
                    lane.items.push(it);
                    lead = it.x;
                    lane.nextGap = r(lane.gapMin, lane.gapMax);
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
                    lane.nextGap = r(lane.gapMin, lane.gapMax);
                }
            }
        }

        function updateExpress(lane) {
            const e = lane.express;
            e.timer--;
            if (e.phase === 'idle' && e.timer <= 0) {
                e.phase = 'warn';
                e.timer = e.spec.warn;
            } else if (e.phase === 'warn' && e.timer <= 0) {
                e.phase = 'pass';
                const w = Math.round(CELL * e.spec.cells);
                e.rider = { kind: e.spec.kind, x: lane.dir > 0 ? -w - CELL : W + CELL, w: w };
            }
            if (e.phase === 'pass') {
                e.rider.x += lane.dir * e.spec.speed * DT;
                const gone = lane.dir > 0 ? e.rider.x > W + CELL : e.rider.x + e.rider.w < -CELL;
                if (gone) {
                    e.phase = 'idle';
                    e.timer = Math.round(r(2.5, 6) * TICK_HZ);
                    e.rider = null;
                }
            }
        }

        function updateLanes() {
            const lo = Math.floor(sim.camY) - 2;
            const hi = Math.ceil(sim.camY + ROWS) + 2;
            laneAt(hi);
            for (let row = lo; row <= hi; row++) {
                const lane = sim.lanes.get(row);
                if (!lane) continue;
                if (lane.cat === 'traffic' || lane.cat === 'river' || lane.cat === 'net') updateMovers(lane);
                else if (lane.cat === 'express') updateExpress(lane);
            }
        }

        /* ---------- the whale ---------- */

        const P = sim.player;

        function hopT() { return P.hop ? P.hop.ticks / HOP_TICKS : 0; }

        function position() {
            if (!P.hop) return { x: P.x, row: P.row };
            const t = hopT();
            return { x: lerp(P.hop.fromX, P.hop.toX, t), row: t < 0.5 ? P.hop.fromRow : P.hop.toRow };
        }

        /* lanes where you can be off the grid: the watery ones */
        function freeX(lane) { return lane.cat === 'river' || lane.cat === 'net'; }

        function collect(lane, c) {
            if (!lane.coins.has(c)) return;
            lane.coins.delete(c);
            sim.coins++;
            emit('coin', { row: lane.row, col: c });
        }

        function tryMove(dx, dy) {
            if (!P.alive || P.trap > 0) return;
            if (P.hop) { queued = [dx, dy]; return; }

            const toRow = P.row + dy;
            const target = laneAt(toRow);
            let toX = P.x + dx * CELL;
            if (!freeX(target)) toX = colX(colOf(toX));

            if (toX < CELL / 2 - 1 || toX > W - CELL / 2 + 1) { emit('bump', { dx: dx }); return; }
            if (target.cat === 'safe' && target.blocked.has(colOf(toX))) { emit('bump', { dx: dx }); return; }

            if (dx) P.facing = dx;
            P.tilt = -P.tilt;
            P.raft = null;
            P.hop = { fromX: P.x, fromRow: P.row, toX: toX, toRow: toRow, ticks: 0 };
            sim.started = true;
        }

        function speedDash() {
            if (!P.alive || P.hop || P.trap > 0 || P.dashes <= 0) return;
            P.dashes--;
            const reach = 1 + ((rand() * DASH_MAX) | 0);
            const target = P.row + reach;

            /* Always land on safe ground: the furthest safe lane within
               reach, or failing that the first one past it. */
            let landRow = null;
            let landCol = null;
            const tryRow = function (row) {
                const lane = laneAt(row);
                if (lane.cat !== 'safe') return false;
                const want = colOf(P.x);
                for (let off = 0; off < COLS; off++) {
                    const cands = off === 0 ? [want] : [want - off, want + off];
                    for (let i = 0; i < cands.length; i++) {
                        const c = cands[i];
                        if (c >= 0 && c < COLS && !lane.blocked.has(c)) {
                            landRow = row;
                            landCol = c;
                            return true;
                        }
                    }
                }
                return false;
            };
            for (let row = target; row > P.row && landRow === null; row--) tryRow(row);
            for (let row = target + 1; row <= target + 20 && landRow === null; row++) tryRow(row);
            if (landRow === null) { P.dashes++; return; }

            const from = P.row;
            P.row = landRow;
            P.x = colX(landCol);
            P.raft = null;
            P.grace = Math.max(P.grace, DASH_GRACE);
            P.lastSafe = { row: P.row, x: P.x };
            if (P.row > sim.score) sim.score = P.row;
            sim.camY = Math.max(sim.camY, P.row - 5);
            sim.started = true;
            ensureLanes();
            emit('dash', { from: from, to: landRow, reach: reach });
        }

        function land() {
            const h = P.hop;
            P.row = h.toRow;
            P.x = h.toX;
            P.hop = null;
            emit('land');

            const lane = laneAt(P.row);
            if (lane.cat === 'river') {
                const raft = lane.items.find(function (it) { return P.x > it.x + 6 && P.x < it.x + it.w - 6; });
                if (!raft) { kill('drown'); return; }
                const slots = Math.round(raft.w / CELL);
                const slot = clamp(Math.floor((P.x - raft.x) / CELL), 0, slots - 1);
                P.raft = raft;
                P.raftOffset = slot * CELL + CELL / 2;
                P.x = raft.x + P.raftOffset;
            } else if (lane.cat !== 'net') {
                collect(lane, colOf(P.x));
                if (lane.cat === 'safe') P.lastSafe = { row: P.row, x: P.x };
            }

            if (P.row > sim.score) sim.score = P.row;

            if (queued) {
                const q = queued;
                queued = null;
                tryMove(q[0], q[1]);
            }
        }

        function overlaps(x, it, inset) {
            return x + 13 > it.x + inset && x - 13 < it.x + it.w - inset;
        }

        function checkHazards() {
            const pos = position();
            const lane = laneAt(pos.row);

            if (P.grace <= 0) {
                if (lane.cat === 'traffic') {
                    for (let i = 0; i < lane.items.length; i++) {
                        if (overlaps(pos.x, lane.items[i], 4)) { kill('traffic', lane.items[i].kind); return; }
                    }
                } else if (lane.cat === 'express' && lane.express.rider) {
                    if (overlaps(pos.x, lane.express.rider, 0)) { kill('express', lane.express.rider.kind); return; }
                }
            }

            /* nets catch you whether or not you're shielded — they don't hurt */
            if (!P.hop && lane.cat === 'net' && P.trap <= 0 && P.netImmune <= 0) {
                for (let i = 0; i < lane.items.length; i++) {
                    const net = lane.items[i];
                    if (overlaps(P.x, net, 6)) {
                        P.trap = TRAP_TICKS;
                        P.raft = net;
                        P.raftOffset = P.x - net.x;
                        queued = null;
                        emit('trapped');
                        return;
                    }
                }
            }
        }

        function kill(kind, what) {
            if (!P.alive) return;

            /* The Bubble Shield takes one hit of anything but the seagull.
               After a drowning or a drift you're carried back to the last
               dry ground you stood on. */
            if (P.shield && kind !== 'seagull') {
                P.shield = false;
                P.grace = SHIELD_GRACE;
                emit('shield', { kind: kind });
                if (kind === 'drown' || kind === 'drift') {
                    P.hop = null;
                    P.raft = null;
                    P.trap = 0;
                    P.row = P.lastSafe.row;
                    P.x = P.lastSafe.x;
                }
                return;
            }

            const pos = position();
            P.x = pos.x;
            P.row = pos.row;
            P.hop = null;
            P.alive = false;
            P.death = { kind: kind, what: what || null, zone: zoneOf(P.row), tick: sim.tick };
            sim.deathTick = sim.tick;
            queued = null;
            emit('death', { kind: kind, what: what || null });
        }

        function updatePlayer() {
            if (P.grace > 0) P.grace--;
            if (P.netImmune > 0) P.netImmune--;
            if (!P.alive) return;

            if (P.trap > 0) {
                P.trap--;
                P.x = P.raft.x + P.raftOffset;
                if (P.trap === 0) {
                    P.raft = null;
                    P.netImmune = NET_IMMUNE;
                    emit('freed');
                }
            } else if (P.hop) {
                P.hop.ticks++;
                if (P.hop.ticks >= HOP_TICKS) land();
            } else if (P.raft) {
                P.x = P.raft.x + P.raftOffset;
            }

            if (P.alive && (P.raft || P.trap > 0) && (P.x < CELL * 0.3 || P.x > W - CELL * 0.3)) {
                kill('drift', P.trap > 0 ? 'net' : null);
            }

            if (P.alive && P.magnet) {
                const c0 = colOf(position().x);
                for (let row = P.row - MAGNET_ROWS; row <= P.row + MAGNET_ROWS; row++) {
                    const lane = sim.lanes.get(row);
                    if (!lane || !lane.coins.size) continue;
                    const cols = Array.from(lane.coins);
                    for (let i = 0; i < cols.length; i++) {
                        if (Math.abs(cols[i] - c0) <= MAGNET_COLS) collect(lane, cols[i]);
                    }
                }
            }

            if (P.alive) checkHazards();
        }

        /* The camera follows you, and creeps on by itself once you start —
           faster the further you get. Fall off the bottom: seagull. */
        function updateCamera() {
            const target = (P.hop ? P.hop.toRow : P.row) - 3;
            if (target > sim.camY) sim.camY += (target - sim.camY) * Math.min(1, DT * 5);
            if (sim.started && P.alive) sim.camY += (0.28 + Math.min(0.4, sim.score * 0.0025)) * DT;
            ensureLanes();
            if (P.alive && !P.hop && P.row < sim.camY - 0.5) kill('seagull');
        }

        /* ---------- the public face ---------- */

        const MOVES = { u: [0, 1], d: [0, -1], l: [-1, 0], r: [1, 0] };

        function input(code) {
            if (sim.over || !P.alive) return;
            if (code === 'e') speedDash();
            else if (MOVES[code]) tryMove(MOVES[code][0], MOVES[code][1]);
        }

        function step() {
            if (sim.over) return;
            updateLanes();
            updatePlayer();
            updateCamera();
            sim.tick++;
            if (!P.alive && sim.tick - sim.deathTick > TICK_HZ * 1.4) sim.over = true;
            if (sim.tick >= MAX_TICKS && P.alive) kill('seagull');
        }

        ensureLanes();
        return sim;
    }

    /* ---------------------------------------------------------
       Replay: the server's whole job, in one function

       inputs: [[tick, code], ...] sorted by tick, where code is one
       of u d l r e. Stops at death. Throws on a malformed log.
       --------------------------------------------------------- */

    function replay(opts) {
        const inputs = opts.inputs || [];
        const sim = create({ seed: opts.seed, loadout: opts.loadout });
        let i = 0;
        let lastTick = -1;
        for (const pair of inputs) {
            if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) ||
                pair[0] < 0 || pair[0] < lastTick || typeof pair[1] !== 'string' ||
                pair[1].length !== 1 || 'udlre'.indexOf(pair[1]) < 0) {
                throw new Error('malformed input log');
            }
            lastTick = pair[0];
        }

        /* Tells for a bot, gathered while replaying:
             snaps    moves made the instant a hop lands. A script polling
                      the game state does this every time; a person presses
                      during the hop or a beat after, almost never on it.
             presses  every input tick, for rhythm and burst speed. */
        const landed = new Set();
        let moves = 0;
        let snaps = 0;
        const presses = [];

        while (sim.player.alive && sim.tick < MAX_TICKS) {
            while (i < inputs.length && inputs[i][0] === sim.tick) {
                const code = inputs[i][1];
                presses.push(sim.tick);
                if (code !== 'e' && !sim.player.hop) {
                    moves++;
                    if (landed.has(sim.tick - 1)) snaps++;
                }
                sim.input(code);
                i++;
            }
            sim.step();
            for (let k = 0; k < sim.events.length; k++) {
                if (sim.events[k].type === 'land') landed.add(sim.events[k].tick);
            }
            sim.events.length = 0;
        }

        return {
            score: sim.score,
            coins: sim.coins,
            ticks: sim.deathTick >= 0 ? sim.deathTick : sim.tick,
            death: sim.player.death,
            unusedInputs: inputs.length - i,
            tells: tells(presses, moves, snaps)
        };
    }

    function tells(presses, moves, snaps) {
        let burst = 0;
        for (let a = 0, b = 0; b < presses.length; b++) {
            while (presses[b] - presses[a] >= TICK_HZ) a++;
            burst = Math.max(burst, b - a + 1);
        }
        const gaps = [];
        for (let k = 1; k < presses.length; k++) gaps.push(presses[k] - presses[k - 1]);
        let cv = null;
        if (gaps.length >= 2) {
            const mean = gaps.reduce(function (s, g) { return s + g; }, 0) / gaps.length;
            const sd = Math.sqrt(gaps.reduce(function (s, g) { return s + (g - mean) * (g - mean); }, 0) / gaps.length);
            cv = mean > 0 ? sd / mean : 0;
        }
        return {
            presses: presses.length,
            moves: moves,
            snapShare: moves ? snaps / moves : 0,
            burstPerSec: burst,
            rhythmCV: cv
        };
    }

    return {
        VERSION: VERSION,
        TICK_HZ: TICK_HZ,
        CELL: CELL,
        COLS: COLS,
        ROWS: ROWS,
        W: W,
        H: H,
        HOP_TICKS: HOP_TICKS,
        MAX_TICKS: MAX_TICKS,
        ZONE_SEA: ZONE_SEA,
        ZONE_ARCTIC: ZONE_ARCTIC,
        PRICES: PRICES,
        ZONES: ZONES,
        zoneOf: zoneOf,
        colX: colX,
        colOf: colOf,
        create: create,
        replay: replay
    };
});
