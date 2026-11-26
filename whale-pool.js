/* ============================================================
   Whale Pool — the page: drawing, controls, turns, bots.

   The rules and physics are all in whale-pool-sim.js
   (WhalePoolSim); this file never decides anything about a shot.
   A shot is animated by stepping the very simulation that
   judges it, a little faster than real time.

   The table is drawn on one canvas: a pre-rendered layer for the
   wood, felt, crest and pockets, then every frame the balls (each
   a tiny 3D sphere with its own orientation, so numbers and
   stripes really roll), the aim guide and the cue. On a tall
   phone screen the table turns sideways (long side vertical) so
   the balls stay big enough to see.
   ============================================================ */

(function () {
    'use strict';

    const S = window.WhalePoolSim;
    const Bots = window.WhalePoolBots;
    const Cues = window.WhalePoolCues;
    if (!S || !Bots || !Cues) return;

    const $ = function (id) { return document.getElementById(id); };

    /* ---------- look ---------- */

    /* the drawn rail beyond the cushion noses (table units): slimmer
       when the table stands up on a phone */
    const RAIL_WIDE = 54, RAIL_TALL = 50;
    let RAIL = RAIL_WIDE;
    let TW = S.W + 2 * RAIL;
    let TH = S.H + 2 * RAIL;
    const CUSH = 22;                       // the rubber cushion strip
    const COLORS = { 1: '#f5c400', 2: '#2563c9', 3: '#e0352b', 4: '#7046a8', 5: '#f07a1a', 6: '#1f8a4c', 7: '#8c2333', 8: '#1d1b20' };
    const CUE_COLOR = '#fbf6ea';
    const INK = '#1d1b20';
    const FELT = '#6dbca5';
    const FELT_EDGE = '#5aa891';
    const CUSHION = '#4f9a84';
    const LIGHT = (function () { const l = [-0.5, -0.6, 0.63]; const n = Math.hypot(l[0], l[1], l[2]); return [l[0] / n, l[1] / n, l[2] / n]; })();
    /* whale-pool.html?fast runs everything 8x quicker (for tests) */
    const FAST = /[?&]fast(&|$)/.test(window.location.search) ? 8 : 1;
    const PLAY_SPEED = 1.3 * FAST;         // shots run a bit faster than real time
    const POCKET_NAMES_LAND = ['top-left', 'top side', 'top-right', 'bottom-left', 'bottom side', 'bottom-right'];

    /* ---------- who you can play ---------- */

    const OPPS = [
        { id: 'easy',   whale: 6465, name: 'Whale #6465', level: 'Easy',   note: 'Sleepy eyes. Takes it easy and misses plenty.' },
        { id: 'normal', whale: 777,  name: 'Whale #777',  level: 'Normal', note: 'Skeptical. Plays the percentages.' },
        { id: 'hard',   whale: 1784, name: 'Whale #1784', level: 'Hard',   note: 'Laser eyes. Rarely misses, plays safe.' },
        { id: 'friend', name: '2 players', level: '', note: 'Pass the cue on this screen.', pic: 'images/pfp/whale-3.svg' }
    ];
    const ME_PIC = 'images/pfp/whale-0.svg';
    const FRIEND_PIC = 'images/pfp/whale-3.svg';

    const STORE = 'ssow-pool';
    const SAVE = 'ssow-pool-game';

    /* ---------- sounds (made with Web Audio, see arcade-sound.js) ---------- */

    const Sound = window.ArcadeSound ? window.ArcadeSound.create({
        store: 'ssow-pool-muted',
        sounds: function (kit) {
            return {
                cue: function (t, v) {
                    const g = 0.12 + 0.45 * v;
                    kit.noise(t, 0.05, { type: 'bandpass', f0: 1700, q: 1.1, gain: g });
                    kit.tone(t, 190, 0.09, { type: 'triangle', gain: g * 0.6, to: 120 });
                },
                clack: function (t, v) {
                    const g = 0.05 + 0.55 * v;
                    kit.tone(t, 2500 + Math.random() * 600, 0.04, { type: 'sine', gain: g });
                    kit.noise(t, 0.03, { type: 'highpass', f0: 2800, gain: g * 0.45 });
                },
                rail: function (t, v) { kit.noise(t, 0.1, { type: 'lowpass', f0: 360, q: 0.8, gain: 0.08 + 0.45 * v }); },
                pot: function (t) {
                    kit.tone(t, 150, 0.2, { type: 'triangle', gain: 0.32, to: 70 });
                    kit.noise(t + 0.05, 0.28, { type: 'bandpass', f0: 620, f1: 240, q: 2, gain: 0.16 });
                },
                foul: function (t) {
                    kit.tone(t, 220, 0.16, { type: 'square', gain: 0.06 });
                    kit.tone(t + 0.19, 165, 0.24, { type: 'square', gain: 0.06 });
                },
                win: function (t) {
                    [523, 659, 784, 1047].forEach(function (f, i) { kit.tone(t + i * 0.11, f, 0.24, { type: 'triangle', gain: 0.2 }); });
                },
                turn: function (t) { kit.tone(t, 880, 0.08, { type: 'sine', gain: 0.07 }); }
            };
        }
    }) : { play: function () {}, isMuted: function () { return true; }, toggle: function () { return true; } };

    /* ---------- elements ---------- */

    const els = {
        setup: $('setup'), opps: $('opps'), name1: $('name1'), name2: $('name2'), name2Wrap: $('name2Wrap'),
        name1Label: $('name1Label'), start: $('start'), resume: $('resume'),
        game: $('game'), stage: $('stage'), canvas: $('table'), say: $('say'),
        seat0: $('seat0'), seat1: $('seat1'), pic0: $('pic0'), pic1: $('pic1'), who0: $('who0'), who1: $('who1'),
        balls0: $('balls0'), balls1: $('balls1'), modeName: $('modeName'), rack: $('rack'),
        over: $('over'), overTitle: $('overTitle'), overText: $('overText'), again: $('again'), change: $('change'),
        controls: $('controls'), power: $('power'), powerFill: $('powerFill'), powerText: $('powerText'),
        fine: $('fine'), fineGrip: $('fineGrip'), spinBtn: $('spinBtn'), spinDot: $('spinDot'),
        spinPop: $('spinPop'), spinBig: $('spinBig'), spinBigDot: $('spinBigDot'), spinReset: $('spinReset'), spinDone: $('spinDone'),
        mute: $('mute'), full: $('full'), quit: $('quit'), keys: $('keys'),
        cueZoom: $('cueZoom'), cueZoomCard: $('cueZoomCard'), cueZoomArt: $('cueZoomArt'), cueZoomClose: $('cueZoomClose'),
        cueZoomName: $('cueZoomName'), cueZoomRarity: $('cueZoomRarity'), cueZoomBlurb: $('cueZoomBlurb'), cueZoomStats: $('cueZoomStats'),
        spinReach: $('spinReach'), overPearls: $('overPearls'),
        shop: $('shop'), pearls: $('pearls'), cues: $('cues'),
        legendWallet: $('legendWallet'), legendGo: $('legendGo'), legendStatus: $('legendStatus')
    };
    const ctx = els.canvas.getContext('2d');

    /* ---------- settings ---------- */

    let settings = { mode: '8', opp: 'normal', name1: '', name2: '', guides: 'cue' };
    try { Object.assign(settings, JSON.parse(localStorage.getItem(STORE) || '{}')); } catch (e) { /* defaults */ }
    function saveSettings() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* fine */ } }

    /* ---------- the game on screen ---------- */

    let G = null;          // { mode, opp, players, state, breaker, phase, ... }
    const view = { k: 1, portrait: false, dpr: 1, cw: 0, ch: 0, layer: null };
    const orient = new Map();               // ball number -> 3x3 rotation (columns: local X, Y, Z in table space)
    const sprites = new Map();               // ball number -> { canvas, ctx, img, size }
    const orientVer = new Map();             // ball number -> how often it has turned (its picture repaints only then)
    let crest = null;
    let dirty = true;

    /* ======================================================
       Coordinates: table units <-> canvas pixels
       ====================================================== */

    function toScreen(x, y) {
        const k = view.k;
        return view.portrait ? [(y + RAIL) * k, (S.W + RAIL - x) * k] : [(x + RAIL) * k, (y + RAIL) * k];
    }
    function toTable(sx, sy) {
        const k = view.k;
        return view.portrait ? [S.W + RAIL - sy / k, sx / k - RAIL] : [sx / k - RAIL, sy / k - RAIL];
    }
    function vecToScreen(dx, dy) { return view.portrait ? [dy, -dx] : [dx, dy]; }
    function setTableTransform(c) {
        const k = view.k * view.dpr;
        if (view.portrait) c.setTransform(0, -k, k, 0, RAIL * k, (S.W + RAIL) * k);
        else c.setTransform(k, 0, 0, k, RAIL * k, RAIL * k);
    }

    function pocketName(i) {
        if (!view.portrait) return POCKET_NAMES_LAND[i];
        const p = S.POCKETS[i];
        const s = toScreen(p.x, p.y);
        const v = s[1] < view.ch * 0.33 ? 'top' : (s[1] > view.ch * 0.67 ? 'bottom' : 'middle');
        const h = s[0] < view.cw / 2 ? 'left' : 'right';
        return v === 'middle' ? h + ' side' : v + '-' + h;
    }

    /* ======================================================
       Layout
       ====================================================== */

    function layout() {
        if (els.game.hidden) return;
        const full = els.game.classList.contains('is-full');
        const aw = els.stage.clientWidth;
        let used = 0;
        [document.querySelector('.Hud'), document.querySelector('.Bar'), els.controls, els.keys].forEach(function (e) { if (e && e.offsetHeight) used += e.offsetHeight + 10; });
        const ah = Math.max(240, window.innerHeight - used - (full ? 20 : 24));
        const kl = Math.min(aw / (S.W + 2 * RAIL_WIDE), ah / (S.H + 2 * RAIL_WIDE));
        const kp = Math.min(aw / (S.H + 2 * RAIL_TALL), ah / (S.W + 2 * RAIL_TALL));
        view.portrait = kp > kl * 1.08;
        RAIL = view.portrait ? RAIL_TALL : RAIL_WIDE;
        TW = S.W + 2 * RAIL;
        TH = S.H + 2 * RAIL;
        view.k = view.portrait ? kp : kl;
        view.dpr = Math.min(2.5, window.devicePixelRatio || 1);
        view.cw = Math.floor((view.portrait ? TH : TW) * view.k);
        view.ch = Math.floor((view.portrait ? TW : TH) * view.k);
        view.k = (view.portrait ? view.cw / TH : view.cw / TW);
        els.canvas.style.width = view.cw + 'px';
        els.canvas.style.height = view.ch + 'px';
        els.canvas.width = Math.round(view.cw * view.dpr);
        els.canvas.height = Math.round(view.ch * view.dpr);
        sprites.clear();
        buildLayer();
        dirty = true;
    }

    /* ======================================================
       The static table: wood, felt, crest, pockets, cushions
       ====================================================== */

    function roundRect(c, x, y, w, h, r) {
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    }

    function cushionPolys() {
        const C = S.CORNER, Sd = S.SIDE, J = CUSH, W = S.W, H = S.H;
        const cj = 25 * J / 22, sj = 6 * J / 22;
        return [
            [[C - cj, -J], [C, 0], [W / 2 - Sd, 0], [W / 2 - Sd + sj, -J]],
            [[W / 2 + Sd - sj, -J], [W / 2 + Sd, 0], [W - C, 0], [W - C + cj, -J]],
            [[C - cj, H + J], [C, H], [W / 2 - Sd, H], [W / 2 - Sd + sj, H + J]],
            [[W / 2 + Sd - sj, H + J], [W / 2 + Sd, H], [W - C, H], [W - C + cj, H + J]],
            [[-J, C - cj], [0, C], [0, H - C], [-J, H - C + cj]],
            [[W + J, C - cj], [W, C], [W, H - C], [W + J, H - C + cj]]
        ];
    }

    function buildLayer() {
        const c = document.createElement('canvas');
        c.width = els.canvas.width;
        c.height = els.canvas.height;
        const g = c.getContext('2d');
        setTableTransform(g);
        const px = 1 / view.k;                       // one CSS pixel in table units
        const W = S.W, H = S.H;

        /* wood frame */
        const rr = RAIL * 0.85;
        roundRect(g, -RAIL, -RAIL, TW, TH, rr);
        const wood = g.createLinearGradient(0, -RAIL, 0, H + RAIL);
        wood.addColorStop(0, '#c9a06d');
        wood.addColorStop(0.5, '#b88f5e');
        wood.addColorStop(1, '#a87f50');
        g.fillStyle = wood;
        g.fill();
        /* grain */
        g.save();
        roundRect(g, -RAIL, -RAIL, TW, TH, rr);
        g.clip();
        g.strokeStyle = 'rgba(110, 74, 38, 0.28)';
        g.lineWidth = 2.2 * px;
        for (let i = 0; i < 9; i++) {
            const y0 = -RAIL + 6 + i * 6;
            [y0, H + RAIL - 6 - i * 6].forEach(function (yy) {
                g.beginPath();
                g.moveTo(-RAIL, yy);
                for (let x = -RAIL; x <= W + RAIL; x += 40) g.lineTo(x, yy + Math.sin(x * 0.013 + i) * 1.6);
                g.stroke();
            });
        }
        g.restore();
        g.lineWidth = 3 * px;
        g.strokeStyle = INK;
        roundRect(g, -RAIL, -RAIL, TW, TH, rr);
        g.stroke();
        /* a darker inner lip where the wood meets the cushions */
        g.strokeStyle = 'rgba(29, 27, 32, 0.35)';
        g.lineWidth = 2 * px;
        roundRect(g, -CUSH - 6, -CUSH - 6, W + 2 * CUSH + 12, H + 2 * CUSH + 12, 16);
        g.stroke();

        /* the felt (playing area plus the cushion bed) */
        g.fillStyle = CUSHION;
        g.fillRect(-CUSH, -CUSH, W + 2 * CUSH, H + 2 * CUSH);
        const felt = g.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.62);
        felt.addColorStop(0, '#7cc6b0');
        felt.addColorStop(0.7, FELT);
        felt.addColorStop(1, FELT_EDGE);
        g.fillStyle = felt;
        g.fillRect(0, 0, W, H);

        /* the crest, printed into the felt */
        if (crest && crest.complete && crest.naturalWidth) {
            const ch = H * 0.62, cw = ch * crest.naturalWidth / crest.naturalHeight;
            const t = document.createElement('canvas');
            t.width = Math.max(1, Math.round(cw * view.k * view.dpr));
            t.height = Math.max(1, Math.round(ch * view.k * view.dpr));
            const tg = t.getContext('2d');
            tg.drawImage(crest, 0, 0, t.width, t.height);
            tg.globalCompositeOperation = 'source-in';
            tg.fillStyle = 'rgba(23, 105, 90, 0.3)';
            tg.fillRect(0, 0, t.width, t.height);
            g.save();
            /* keep the crest upright on screen */
            g.translate(W / 2, H / 2);
            if (view.portrait) g.rotate(Math.PI / 2);
            g.drawImage(t, -cw / 2, -ch / 2, cw, ch);
            g.restore();
        }

        /* head string and spots */
        g.save();
        g.setLineDash([10, 9]);
        g.strokeStyle = 'rgba(255, 250, 241, 0.42)';
        g.lineWidth = 2 * px;
        g.beginPath();
        g.moveTo(S.HEAD_X, 0);
        g.lineTo(S.HEAD_X, H);
        g.stroke();
        g.restore();
        g.fillStyle = 'rgba(255, 250, 241, 0.6)';
        [[S.HEAD_X, S.MID_Y], [S.FOOT_X, S.MID_Y]].forEach(function (p) { g.beginPath(); g.arc(p[0], p[1], 3.2, 0, Math.PI * 2); g.fill(); });

        /* pockets */
        S.POCKETS.forEach(function (p) {
            g.fillStyle = '#3b2b1d';
            g.beginPath();
            g.arc(p.x, p.y, p.r + 5, 0, Math.PI * 2);
            g.fill();
            g.lineWidth = 2.5 * px;
            g.strokeStyle = INK;
            g.stroke();
            const hole = g.createRadialGradient(p.x, p.y, 2, p.x, p.y, p.r);
            hole.addColorStop(0, '#060507');
            hole.addColorStop(1, '#1d1b20');
            g.fillStyle = hole;
            g.beginPath();
            g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            g.fill();
        });

        /* cushions, with an inked nose */
        cushionPolys().forEach(function (poly) {
            g.beginPath();
            g.moveTo(poly[0][0], poly[0][1]);
            for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
            g.closePath();
            g.fillStyle = CUSHION;
            g.fill();
            g.lineWidth = 2.2 * px;
            g.strokeStyle = INK;
            g.beginPath();
            g.moveTo(poly[0][0], poly[0][1]);
            for (let i = 1; i < poly.length; i++) g.lineTo(poly[i][0], poly[i][1]);
            g.stroke();
            /* a soft highlight along the nose */
            g.lineWidth = 3 * px;
            g.strokeStyle = 'rgba(255, 255, 255, 0.18)';
            g.beginPath();
            g.moveTo(poly[1][0], poly[1][1]);
            g.lineTo(poly[2][0], poly[2][1]);
            g.stroke();
        });

        /* diamonds on the rails */
        const mid = -(CUSH + (RAIL - CUSH) / 2) + 2;
        g.fillStyle = '#fff3d6';
        g.strokeStyle = INK;
        g.lineWidth = 1.4 * px;
        const diamond = function (x, y) {
            g.beginPath();
            g.moveTo(x, y - 6); g.lineTo(x + 4, y); g.lineTo(x, y + 6); g.lineTo(x - 4, y);
            g.closePath(); g.fill(); g.stroke();
        };
        for (let i = 1; i < 8; i++) {
            if (i === 4) continue;
            diamond(W * i / 8, mid);
            diamond(W * i / 8, H - mid);
        }
        for (let i = 1; i < 4; i++) {
            diamond(mid, H * i / 4);
            diamond(W - mid, H * i / 4);
        }
        view.layer = c;
    }

    /* ======================================================
       Balls: little 3D spheres with an orientation
       ====================================================== */

    function colorOf(n) { return n === 0 ? CUE_COLOR : COLORS[n > 8 ? n - 8 : n]; }
    function rgb(hex) { return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]; }
    const RGB = {};
    for (let n = 0; n <= 15; n++) RGB[n] = rgb(colorOf(n));
    const WHITE = rgb('#fbf6ea');

    function newOrient(seed) {
        /* number facing up (toward you), turned a random way, tilted a touch */
        let a = (seed * 2.399) % (Math.PI * 2);
        const c = Math.cos(a), s = Math.sin(a);
        let M = [c, s, 0, s, -c, 0, 0, 0, -1];              // columns X, Y, Z (Z = toward the viewer)
        M = rotate(M, [Math.cos(seed * 1.7), Math.sin(seed * 1.7), 0], 0.25 + (seed % 5) * 0.06);
        return M;
    }

    function rotate(M, axis, ang) {
        const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
        const x = axis[0], y = axis[1], z = axis[2];
        const out = new Array(9);
        for (let col = 0; col < 3; col++) {
            const vx = M[col * 3], vy = M[col * 3 + 1], vz = M[col * 3 + 2];
            const d = x * vx + y * vy + z * vz;
            out[col * 3] = vx * c + (y * vz - z * vy) * s + x * d * t;
            out[col * 3 + 1] = vy * c + (z * vx - x * vz) * s + y * d * t;
            out[col * 3 + 2] = vz * c + (x * vy - y * vx) * s + z * d * t;
        }
        return out;
    }

    function tidy(M) {
        /* re-orthonormalise (Gram-Schmidt) so rounding never skews a ball */
        let X = [M[0], M[1], M[2]], Y = [M[3], M[4], M[5]];
        let l = Math.hypot(X[0], X[1], X[2]); X = X.map(function (v) { return v / l; });
        const d = X[0] * Y[0] + X[1] * Y[1] + X[2] * Y[2];
        Y = [Y[0] - d * X[0], Y[1] - d * X[1], Y[2] - d * X[2]];
        l = Math.hypot(Y[0], Y[1], Y[2]); Y = Y.map(function (v) { return v / l; });
        const Z = [X[1] * Y[2] - X[2] * Y[1], X[2] * Y[0] - X[0] * Y[2], X[0] * Y[1] - X[1] * Y[0]];
        return X.concat(Y, Z);
    }

    function orientOf(n) {
        if (!orient.has(n)) orient.set(n, newOrient(n + 1));
        return orient.get(n);
    }

    /* spin every moving ball by how far it rolled this frame */
    function rollBalls(run, dt) {
        run.balls.forEach(function (b) {
            if (!b.on) return;
            const wx = b.ry / S.R, wy = -b.rx / S.R, wz = b.sz / S.R;
            const w = Math.hypot(wx, wy, wz);
            if (w < 1e-6) return;
            let M = rotate(orientOf(b.n), [wx / w, wy / w, wz / w], w * dt);
            if (Math.random() < 0.05) M = tidy(M);
            orient.set(b.n, M);
            orientVer.set(b.n, (orientVer.get(b.n) || 0) + 1);
        });
    }

    function sprite(n, size) {
        let s = sprites.get(n);
        if (!s || s.size !== size) {
            const c = document.createElement('canvas');
            c.width = c.height = size;
            const g = c.getContext('2d');
            s = { canvas: c, ctx: g, img: g.createImageData(size, size), size: size };
            sprites.set(n, s);
        }
        return s;
    }

    /* paint ball n into its sprite, as seen from above right now */
    function paintBall(n) {
        const rpx = S.R * view.k * view.dpr;
        const size = Math.ceil(rpx * 2) + 2;
        const sp = sprite(n, size);
        const ver = orientVer.get(n) || 0;
        if (sp.painted && sp.ver === ver && sp.portrait === view.portrait) return sp;
        const M = orientOf(n);
        const d = sp.img.data;
        const cc = size / 2;
        const base = RGB[n];
        const stripe = n >= 9;
        const portrait = view.portrait;
        for (let py = 0; py < size; py++) {
            for (let px = 0; px < size; px++) {
                const i = (py * size + px) * 4;
                const u = (px + 0.5 - cc) / rpx, v = (py + 0.5 - cc) / rpx;
                const r2 = u * u + v * v;
                const edge = (1 - Math.sqrt(r2)) * rpx + 0.5;
                if (edge <= 0) { d[i + 3] = 0; continue; }
                const w = Math.sqrt(Math.max(0, 1 - r2));
                /* screen normal -> table frame (z into the table) -> ball's own frame */
                const tx = portrait ? -v : u, ty = portrait ? u : v, tz = -w;
                const lx = M[0] * tx + M[1] * ty + M[2] * tz;
                const lz = M[6] * tx + M[7] * ty + M[8] * tz;
                let col;
                if (n === 0) col = WHITE;
                else if (lz > 0.84 || lz < -0.84) col = WHITE;                 // the number discs
                else if (stripe) col = (lx > -0.52 && lx < 0.52) ? base : WHITE;
                else col = base;
                /* cel shading: three bands and a hard highlight */
                const lam = u * LIGHT[0] + v * LIGHT[1] + w * LIGHT[2];
                let f = lam < 0.05 ? 0.68 : (lam < 0.5 ? 0.86 : 1);
                let r = col[0] * f, gg = col[1] * f, b = col[2] * f;
                if (lam > 0.93) { r = r * 0.25 + 255 * 0.75; gg = gg * 0.25 + 255 * 0.75; b = b * 0.25 + 255 * 0.75; }
                d[i] = r; d[i + 1] = gg; d[i + 2] = b;
                d[i + 3] = Math.min(1, edge) * 255;
            }
        }
        sp.ctx.putImageData(sp.img, 0, 0);
        sp.painted = true;
        sp.ver = ver;
        sp.portrait = view.portrait;
        return sp;
    }

    /* draw a ball at table (x, y); scale < 1 while it drops into a pocket */
    function drawBall(c, n, x, y, scale, alpha) {
        const s = toScreen(x, y);
        const dpr = view.dpr;
        const sx = s[0] * dpr, sy = s[1] * dpr;
        const rpx = S.R * view.k * dpr;
        const sp = paintBall(n);
        c.save();
        c.globalAlpha = alpha === undefined ? 1 : alpha;
        if (scale !== 1) {
            c.translate(sx, sy);
            c.scale(scale, scale);
            c.translate(-sx, -sy);
        }
        c.drawImage(sp.canvas, sx - sp.size / 2, sy - sp.size / 2);
        c.lineWidth = Math.max(1.2, 0.11 * rpx);
        c.strokeStyle = INK;
        c.beginPath();
        c.arc(sx, sy, rpx - c.lineWidth / 2 + 0.3, 0, Math.PI * 2);
        c.stroke();
        /* the number (or the cue ball's little top hat), kept upright */
        const M = orientOf(n);
        let px = M[6], py = M[7], pz = M[8];
        if (pz > 0) { px = -px; py = -py; pz = -pz; }                  // the pole facing us
        const face = -pz;
        if (face > 0.3) {
            const v = vecToScreen(px, py);
            const nx = sx + v[0] * rpx, ny = sy + v[1] * rpx;
            const a = Math.min(1, (face - 0.3) / 0.25);
            c.globalAlpha *= a;
            if (n === 0) {
                const h = rpx * 0.38 * (0.6 + 0.4 * face);
                c.fillStyle = INK;
                c.fillRect(nx - h * 0.55, ny - h * 0.55, h * 1.1, h * 0.9);
                c.fillRect(nx - h * 0.95, ny + h * 0.3, h * 1.9, h * 0.28);
            } else if (rpx > 5) {
                const fs = rpx * (n > 9 ? 0.74 : 0.86) * (0.62 + 0.38 * face);
                c.font = '900 ' + fs.toFixed(1) + 'px Nunito, "Segoe UI", sans-serif';
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillStyle = INK;
                c.fillText(String(n), nx, ny + fs * 0.06);
            }
        }
        c.restore();
    }

    /* ======================================================
       Every frame
       ====================================================== */

    function cuePos() {
        if (!G) return null;
        if (G.run) return null;
        if (G.state.inHand && G.place) return G.place;
        return G.state.cue;
    }

    function aimDir() { return [Math.cos(G.angle), Math.sin(G.angle)]; }

    function draw() {
        dirty = false;
        const c = ctx;
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, els.canvas.width, els.canvas.height);
        if (!view.layer) return;
        c.drawImage(view.layer, 0, 0);
        if (!G) return;
        const dpr = view.dpr, k = view.k;
        const st = G.state;

        /* kitchen while the cue ball is in hand behind the line */
        if (!G.run && st.inHand === 'kitchen' && G.phase !== 'over') {
            setTableTransform(c);
            c.fillStyle = 'rgba(255, 250, 241, 0.13)';
            c.fillRect(0, 0, S.HEAD_X, S.H);
            c.setTransform(1, 0, 0, 1, 0, 0);
        }

        /* which balls where */
        const balls = [];
        if (G.run) {
            G.run.balls.forEach(function (b) { if (b.on) balls.push([b.n, b.x, b.y]); });
        } else {
            st.balls.forEach(function (b) { balls.push(b); });
            const cp = cuePos();
            if (cp) balls.push([0, cp[0], cp[1]]);
        }

        /* shadows */
        c.fillStyle = 'rgba(20, 40, 35, 0.28)';
        balls.forEach(function (b) {
            const s = toScreen(b[1], b[2]);
            c.beginPath();
            c.ellipse((s[0] + S.R * k * 0.22) * dpr, (s[1] + S.R * k * 0.3) * dpr, S.R * k * dpr * 1.02, S.R * k * dpr * 0.9, 0, 0, Math.PI * 2);
            c.fill();
        });

        /* the call: a gold ring on the called pocket and ball */
        const showCall = G.call && !G.run && G.phase !== 'over' && S.needsCall(st);
        if (showCall && G.call.pocket !== null && G.call.pocket !== undefined) {
            const p = S.POCKETS[G.call.pocket];
            const s = toScreen(p.x, p.y);
            c.lineWidth = 4 * dpr;
            c.strokeStyle = '#f4b740';
            c.beginPath();
            c.arc(s[0] * dpr, s[1] * dpr, (p.r + 11) * k * dpr, 0, Math.PI * 2);
            c.stroke();
            c.lineWidth = 1.5 * dpr;
            c.strokeStyle = INK;
            c.stroke();
        }

        /* balls dropping into pockets */
        const now = performance.now();
        G.sinking = (G.sinking || []).filter(function (s) {
            const t = (now - s.t0) / 260;
            if (t >= 1) return false;
            const p = S.POCKETS[s.pocket];
            const x = s.x + (p.x - s.x) * t, y = s.y + (p.y - s.y) * t;
            drawBall(c, s.n, x, y, 1 - 0.55 * t, 1 - t * 0.8);
            dirty = true;
            return true;
        });

        balls.forEach(function (b) { drawBall(c, b[0], b[1], b[2], 1); });

        if (showCall && G.call.ball !== null && G.call.ball !== undefined && st.mode === '10') {
            const b = st.balls.find(function (x) { return x[0] === G.call.ball; });
            if (b) {
                const s = toScreen(b[1], b[2]);
                c.lineWidth = 3 * dpr;
                c.strokeStyle = '#f4b740';
                c.beginPath();
                c.arc(s[0] * dpr, s[1] * dpr, (S.R + 6) * k * dpr, 0, Math.PI * 2);
                c.stroke();
            }
        }

        /* ball in hand: a ring round the cue ball (red where it can't go) */
        const cp = cuePos();
        if (cp && st.inHand && !G.run && G.phase !== 'over') {
            const s = toScreen(cp[0], cp[1]);
            const okSpot = S.canPlace(st, cp[0], cp[1]);
            c.lineWidth = 2.5 * dpr;
            c.setLineDash([5 * dpr, 4 * dpr]);
            c.strokeStyle = okSpot ? 'rgba(255, 250, 241, 0.95)' : '#d9503a';
            c.beginPath();
            c.arc(s[0] * dpr, s[1] * dpr, (S.R + 9) * k * dpr, 0, Math.PI * 2);
            c.stroke();
            c.setLineDash([]);
        }

        /* aim guide and cue */
        if (cp && !G.run && (G.phase === 'aim' || G.phase === 'bot')) {
            drawGuide(c, cp, G.phase === 'bot');
            drawCue(c, cp, G.pull || 0);
        }
    }

    function line(c, a, b, width, color) {
        c.lineWidth = width;
        c.strokeStyle = color;
        c.beginPath();
        c.moveTo(a[0], a[1]);
        c.lineTo(b[0], b[1]);
        c.stroke();
    }

    function drawGuide(c, cp, faint) {
        c.save();
        setTableTransform(c);
        c.beginPath();
        c.rect(-4, -4, S.W + 8, S.H + 8);
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clip();
        guide(c, cp, faint);
        c.restore();
    }

    /* how much of the aim guide each level shows (table units):
       cap = longest aim line, obj = object-ball line, cue = where the
       cue ball glances off, rail = the bounce off a cushion */
    const GUIDE = {
        1: { cap: 260, obj: 30, cue: 0, rail: 0 },
        2: { cap: 420, obj: 60, cue: 0, rail: 40 },
        3: { cap: 620, obj: 100, cue: 40, rail: 70 },
        4: { cap: Infinity, obj: 160, cue: 80, rail: 100 },
        5: { cap: Infinity, obj: 230, cue: 130, rail: 130 }
    };

    /* the cue in the hand of whoever is shooting */
    function cueOf(p) { return p && p.bot ? Cues.get(Cues.BOT_CUE[p.bot]) : Cues.equipped(); }
    function cueNow() { return cueOf(current()); }

    function guideLevel(faint) {
        if (G.guides === 'off') return 0;
        if (faint || G.guides === 'short') return 1;
        return Cues.aimOf(cueNow());
    }

    function guide(c, cp, faint) {
        const st = G.state, dpr = view.dpr, k = view.k;
        const d = aimDir();
        const p = S.predict(st, cp[0], cp[1], d);
        G.pred = p;
        const lv = GUIDE[guideLevel(faint)];
        if (!lv) return;
        const sc = function (x, y) { const s = toScreen(x, y); return [s[0] * dpr, s[1] * dpr]; };
        const from = sc(cp[0], cp[1]);
        const alpha = faint ? 0.45 : 0.95;
        const white = 'rgba(255, 250, 241,' + alpha + ')';
        const ink = 'rgba(29, 27, 32,' + (alpha * 0.55) + ')';
        if (p.t > lv.cap) {
            /* too far for this cue: the line just fades out */
            const e = sc(cp[0] + d[0] * lv.cap, cp[1] + d[1] * lv.cap);
            line(c, from, e, 3.6 * dpr, ink);
            line(c, from, e, 1.8 * dpr, white);
            return;
        }
        const to = sc(p.x, p.y);
        line(c, from, to, 3.6 * dpr, ink);
        line(c, from, to, 1.8 * dpr, white);
        if (p.kind === 'ball') {
            const legal = S.targets(st).indexOf(p.n) >= 0;
            c.lineWidth = 2 * dpr;
            c.strokeStyle = legal ? white : 'rgba(217, 80, 58, 0.95)';
            c.beginPath();
            c.arc(to[0], to[1], S.R * k * dpr, 0, Math.PI * 2);
            c.stroke();
            if (!legal) {
                const r = S.R * k * dpr * 0.5;
                line(c, [to[0] - r, to[1] - r], [to[0] + r, to[1] + r], 2.5 * dpr, 'rgba(217, 80, 58, 0.95)');
                line(c, [to[0] + r, to[1] - r], [to[0] - r, to[1] + r], 2.5 * dpr, 'rgba(217, 80, 58, 0.95)');
            } else {
                /* where the object ball goes, and where the cue ball glances off */
                const ob = sc(p.ball[0], p.ball[1]);
                const L = lv.obj * (0.3 + 0.7 * p.full * p.full);
                const oe = sc(p.ball[0] + p.objDir[0] * L, p.ball[1] + p.objDir[1] * L);
                line(c, ob, oe, 3.4 * dpr, ink);
                line(c, ob, oe, 1.8 * dpr, white);
                if (p.full < 0.995 && lv.cue) {
                    const Lc = lv.cue * (0.4 + 0.6 * (1 - p.full));
                    const ce = sc(p.x + p.cueDir[0] * Lc, p.y + p.cueDir[1] * Lc);
                    line(c, to, ce, 1.6 * dpr, 'rgba(255, 250, 241,' + alpha * 0.7 + ')');
                }
            }
        } else if (p.kind === 'rail' && p.cueDir) {
            if (lv.rail) {
                const e = sc(p.x + p.cueDir[0] * lv.rail, p.y + p.cueDir[1] * lv.rail);
                line(c, to, e, 1.6 * dpr, 'rgba(255, 250, 241,' + alpha * 0.7 + ')');
            }
            c.lineWidth = 2 * dpr;
            c.strokeStyle = white;
            c.beginPath();
            c.arc(to[0], to[1], S.R * k * dpr, 0, Math.PI * 2);
            c.stroke();
        }
    }

    /* The whole cue, never sliced off by the edge of the table picture.
       When the full cue would run off the canvas it gets shorter instead
       (its design scales with it, so the butt cap still shows). Only when
       even a short cue can't fit (the cue ball against a rail, aiming
       away from it) does its far end fade out softly. */
    let cueLayer = null;

    function roomAlong(x, y, ux, uy, m) {
        const W = els.canvas.width, H = els.canvas.height;
        let room = Infinity;
        if (ux > 1e-6) room = Math.min(room, (W - m - x) / ux);
        if (ux < -1e-6) room = Math.min(room, (m - x) / ux);
        if (uy > 1e-6) room = Math.min(room, (H - m - y) / uy);
        if (uy < -1e-6) room = Math.min(room, (m - y) / uy);
        return room;
    }

    function drawCue(c, cp, pull) {
        const dpr = view.dpr, k = view.k;
        const d = aimDir();
        const sv = vecToScreen(d[0], d[1]);
        const s = toScreen(cp[0], cp[1]);
        const u = k * dpr;                                 // one table unit in canvas pixels
        const ux = -sv[0], uy = -sv[1];                    // from the tip toward the butt
        const bx = s[0] * dpr, by = s[1] * dpr;
        const m = 10.5 * u + 3 * dpr;                      // the butt's half width, its shadow, a hair more
        const full = 560 * u, least = 190 * u;
        /* pulling back never pushes the tip itself off the picture */
        const fromBall = roomAlong(bx, by, ux, uy, m);
        const gap = Math.min((S.R + 5 + pull * 120) * u, Math.max((S.R + 5) * u, fromBall - 60 * u));
        const tx = bx + ux * gap, ty = by + uy * gap;
        const room = fromBall - gap;
        const len = Math.max(least, Math.min(full, room));
        const id = cueNow().id, ang = Math.atan2(uy, ux);
        const opts = { px: dpr, shadow: [5 * u, 7 * u], time: performance.now() };
        if (len <= room) {
            Cues.drawCue(c, id, tx, ty, ang, len, 4.6 * u, 9.5 * u, opts);
            return;
        }
        /* not even a short cue fits: draw it on its own layer, fade its end into the edge */
        const W = els.canvas.width, H = els.canvas.height;
        if (!cueLayer || cueLayer.width !== W || cueLayer.height !== H) {
            cueLayer = document.createElement('canvas');
            cueLayer.width = W;
            cueLayer.height = H;
        }
        const g = cueLayer.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'source-over';
        g.clearRect(0, 0, W, H);
        Cues.drawCue(g, id, tx, ty, ang, len, 4.6 * u, 9.5 * u, opts);
        const to = Math.max(0, room) + m, from = Math.max(0, Math.max(0, room) - 70 * u);
        const fade = g.createLinearGradient(tx + ux * from, ty + uy * from, tx + ux * to, ty + uy * to);
        fade.addColorStop(0, 'rgba(0, 0, 0, 1)');
        fade.addColorStop(1, 'rgba(0, 0, 0, 0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = fade;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = 'source-over';
        c.drawImage(cueLayer, 0, 0);
    }

    /* ======================================================
       The loop
       ====================================================== */

    let last = 0;
    let carry = 0;
    function frame(now) {
        const dt = Math.min(0.05, (now - (last || now)) / 1000);
        last = now;
        if (G && G.run) advance(dt);
        if (G && G.anim) G.anim(now);
        /* a cue with live touches (the laser's pulse, a Legendary shimmer) keeps moving while it's aimed */
        if (G && !G.run && (G.phase === 'aim' || G.phase === 'bot') && Cues.animated(cueNow().id)) dirty = true;
        if (dirty || (G && (G.run || G.anim))) draw();
        window.requestAnimationFrame(frame);
    }

    function advance(dt) {
        const run = G.run;
        let fast = true;
        for (let i = 0; i < run.balls.length; i++) {
            const b = run.balls[i];
            if (b.on && (b.vx * b.vx + b.vy * b.vy) > 140 * 140) { fast = false; break; }
        }
        /* the slow tail of a shot plays at double speed */
        const speed = fast ? PLAY_SPEED * 2 : PLAY_SPEED;
        const want = dt * speed / S.DT + carry;
        let n = Math.floor(want);
        carry = want - n;
        n = Math.min(n, 120 * FAST);
        const t0 = run.time;
        const logAt = run.log.length;
        for (let i = 0; i < n && !run.done; i++) S.step(run);
        rollBalls(run, run.time - t0);
        effects(run.log.slice(logAt));
        dirty = true;
        if (run.done) finishShot();
    }

    function effects(events) {
        let clacks = 0, rails = 0;
        events.forEach(function (e) {
            if (e.kind === 'ball' && clacks < 3) { clacks++; Sound.play('clack', 0, Math.min(1, e.speed / 1800)); }
            else if (e.kind === 'rail' && rails < 2 && e.speed > 40) { rails++; Sound.play('rail', 0, Math.min(1, e.speed / 1600)); }
            else if (e.kind === 'pot') {
                Sound.play('pot');
                const b = G.run.balls.find(function (x) { return x.n === e.a; });
                const p = S.POCKETS[e.pocket];
                G.sinking.push({ n: e.a, x: b ? Math.max(-S.R, Math.min(S.W + S.R, b.x)) : p.ax, y: b ? Math.max(-S.R, Math.min(S.H + S.R, b.y)) : p.ay, pocket: e.pocket, t0: performance.now() });
            }
        });
    }

    /* ======================================================
       Turns
       ====================================================== */

    function current() { return G.players[G.state.turn]; }
    function isBotTurn() { return !!current().bot; }

    function say(text, tone) {
        els.say.textContent = text;
        els.say.className = 'Say' + (tone ? ' is-' + tone : '');
    }

    /* little grammar helpers, so "You" reads right */
    function you(p) { return p.name === 'You'; }
    function has(p) { return you(p) ? 'You have' : p.name + ' has'; }
    function is(p) { return you(p) ? 'You’re' : p.name + ' is'; }
    function verb(p, v, vs) { return (you(p) ? 'You ' + v : p.name + ' ' + vs); }

    function list(ns) {
        const s = ns.map(function (n) { return 'the ' + n; });
        return s.length < 2 ? s.join('') : s.slice(0, -1).join(', ') + ' and ' + s[s.length - 1];
    }

    function freeSpot(st, x, y) {
        if (S.canPlace(st, x, y)) return [x, y];
        for (let r = 10; r < 600; r += 10) {
            for (let a = 0; a < 16; a++) {
                const px = x + Math.cos(a * Math.PI / 8) * r, py = y + Math.sin(a * Math.PI / 8) * r;
                if (S.canPlace(st, px, py)) return [px, py];
            }
        }
        return [S.HEAD_X / 2, S.MID_Y];
    }

    /* point the cue at something sensible at the start of a turn */
    function aimAtTarget() {
        const st = G.state;
        const cp = cuePos();
        if (!cp) return;
        const tg = S.targets(st);
        let best = null, bd = Infinity;
        st.balls.forEach(function (b) {
            if (tg.indexOf(b[0]) < 0) return;
            const d = Math.hypot(b[1] - cp[0], b[2] - cp[1]);
            if (d < bd) { bd = d; best = b; }
        });
        if (!st.broke) best = st.balls.reduce(function (a, b) { return b[1] < a[1] ? b : a; });
        if (best) G.angle = Math.atan2(best[2] - cp[1], best[1] - cp[0]);
    }

    function startTurn() {
        const st = G.state;
        G.pull = 0;
        G.call = null;
        G.manual = { ball: false, pocket: false };
        if (st.inHand) {
            const want = st.inHand === 'kitchen' ? [S.HEAD_X - 60, S.MID_Y] : (st.cue || [S.HEAD_X, S.MID_Y]);
            G.place = freeSpot(st, want[0], want[1]);
        } else {
            G.place = null;
        }
        updateHud();
        if (st.over) return;
        aimAtTarget();
        if (isBotTurn()) { botTurn(); return; }
        G.phase = 'aim';
        autoCall(true);
        setControls(true);
        clearTimeout(G.sayTimer);
        if (G.report) {
            say(G.report.text, G.report.tone);
            G.report = null;
            G.sayTimer = setTimeout(function () { if (G && G.phase === 'aim') say(turnText()); }, 2600);
        } else {
            say(turnText());
        }
        Sound.play('turn');
        dirty = true;
    }

    function turnText() {
        const st = G.state, p = current();
        const two = !G.players[1].bot;
        const lead = two ? p.name + ': ' : '';
        return cap(lead + turnBody(st, p));
    }

    function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

    function turnBody(st, p) {
        const lead = '';
        if (!st.broke) return lead + 'your break. Drag the cue ball anywhere behind the line, aim at the rack and power through.';
        if (st.inHand) return lead + 'ball in hand. Drag the cue ball where you want it.';
        const need = S.needsCall(st);
        if (need === 'pocket') return lead + 'you’re on the 8. Tap the pocket you’re calling' + (G.call && G.call.pocket !== null ? ' (now: ' + pocketName(G.call.pocket) + ').' : '.');
        if (need === 'ball') return lead + callText();
        if (st.mode === '8') {
            const g = st.groups[st.turn];
            return lead + (g ? 'your shot, on ' + g + '.' : 'your shot. The table’s open.');
        }
        return lead + 'your shot. Hit the ' + S.lowest(st) + ' first.';
    }

    function callText() {
        const c = G.call;
        if (!c || c.ball === null || c.pocket === null || c.pocket === undefined) return 'call your shot: aim at a pocket, or tap a ball and a pocket.';
        return 'calling the ' + c.ball + ' in the ' + pocketName(c.pocket) + '. Tap a ball or pocket to change it.';
    }

    /* the call follows the aim unless you've tapped your own */
    function autoCall(quiet) {
        const st = G.state;
        const need = S.needsCall(st);
        if (!need || G.phase !== 'aim') return;
        if (!quiet) clearTimeout(G.sayTimer);
        if (!G.call) G.call = { ball: null, pocket: null };
        const cp = cuePos();
        if (cp) {
            const p = S.predict(st, cp[0], cp[1], aimDir());
            if (p.kind === 'ball') {
                if (need === 'ball' && !G.manual.ball) G.call.ball = p.n;
                const callBall = need === 'pocket' ? 8 : G.call.ball;
                if (!G.manual.pocket) {
                    if (callBall === p.n) G.call.pocket = S.pocketAlong(st, p.ball[0], p.ball[1], p.objDir, p.n);
                    else G.call.pocket = null;
                }
            } else if (!G.manual.ball && need === 'ball') {
                G.call.ball = null;
                if (!G.manual.pocket) G.call.pocket = null;
            }
        }
        if (need === 'pocket') G.call.ball = 8;
        if (!quiet) say(turnText());
    }

    function shoot(power) {
        if (!G || G.phase !== 'aim') return;
        const st = G.state;
        const cue = cueNow();
        const reach = Cues.spinReach(cue);
        let sp = G.spin.slice();
        const m = Math.hypot(sp[0], sp[1]);
        if (m > reach) sp = [sp[0] * reach / m, sp[1] * reach / m];
        const input = { dir: aimDir(), power: power * Cues.powerCap(cue), spin: sp };
        if (st.inHand) {
            if (!G.place || !S.canPlace(st, G.place[0], G.place[1])) { say('The cue ball can’t go there. Drag it to a free spot' + (st.inHand === 'kitchen' ? ' behind the line.' : '.'), 'foul'); return; }
            input.cue = G.place;
        }
        const need = S.needsCall(st);
        if (need && G.call && G.call.pocket !== null && G.call.pocket !== undefined && (need === 'pocket' || G.call.ball !== null)) {
            input.call = { ball: need === 'pocket' ? 8 : G.call.ball, pocket: G.call.pocket };
        } else if (need === 'pocket') {
            say('Call a pocket for the 8 first: tap one.', 'foul');
            return;
        }
        launch(input);
    }

    function launch(input) {
        let run;
        try { run = S.begin(G.state, input); } catch (e) { say(e.message, 'foul'); return; }
        G.input = input;
        G.shotsBy[G.state.turn]++;
        G.run = run;
        G.sinking = [];
        G.phase = 'rolling';
        G.pull = 0;
        carry = 0;
        setControls(false);
        Sound.play('cue', 0, Math.min(1, input.power * 1.2));
        dirty = true;
    }

    function finishShot() {
        const prev = G.state;
        const res = S.finish(prev, G.run);
        const shooter = G.players[prev.turn];
        G.run = null;
        G.state = res.state;
        const o = res.outcome;
        const next = G.players[res.state.turn];
        save();
        if (res.state.over) { gameOver(res); return; }
        const parts = [];
        const balls = o.potted.map(function (p) { return p.n; }).filter(function (n) { return n > 0; });
        if (balls.length) parts.push(verb(shooter, 'potted ', 'potted ') + list(balls) + '.');
        if (o.assigned) parts.push(is(shooter) + ' on ' + o.assigned + '.');
        if (o.respotted) parts.push('The ' + o.respotted + ' comes back up.');
        let tone = null;
        if (o.foul) {
            tone = 'foul';
            const lo = prev.mode === '8' ? null : S.lowest(prev);
            parts.unshift({
                scratch: 'Foul: the cue ball dropped.',
                'no-hit': 'Foul: nothing was hit.',
                'wrong-ball': 'Foul: the ' + o.firstHit + ' was hit first' + (lo ? ' (the ' + lo + ' was on).' : '.'),
                'no-rail': 'Foul: nothing reached a cushion.'
            }[o.foul]);
            parts.push(has(next) + ' ball in hand.');
            Sound.play('foul');
        } else if (o.cont) {
            tone = 'good';
            parts.push(verb(shooter, 'shoot again.', 'shoots again.'));
        } else {
            if (prev.mode === '10' && prev.broke && balls.length && !o.calledIn) parts.push('Not the shot that was called.');
            parts.push(you(next) ? 'Your turn.' : next.name + '’s turn.');
        }
        say(parts.join(' '), tone);
        G.report = isBot(next) ? null : { text: parts.join(' '), tone: tone };
        G.phase = 'wait';
        const pause = isBot(next) ? (o.foul ? 1900 : 1100) : 450;
        G.timer = setTimeout(function () {
            if (!G || G.phase !== 'wait') return;
            startTurn();
        }, pause / FAST);
        updateHud();
    }
    function isBot(p) { return !!p.bot; }

    function gameOver(res) {
        G.phase = 'over';
        setControls(false);
        const w = G.players[res.state.winner];
        const l = G.players[1 - res.state.winner];
        const shooterLost = res.outcome.lose;
        const who = shooterLost ? l : w;
        const why = res.state.reason;
        const humanWon = !w.bot;
        els.overTitle.textContent = you(w) ? 'You win!' : w.name + ' wins!';
        els.overText.textContent = (you(who) ? 'You ' : who.name + ' ') + why + '.' + (G.players[1].bot && !humanWon ? ' Rack ’em again?' : '');
        els.overPearls.hidden = true;
        if (G.players[1].bot && !G.awarded) {
            G.awarded = true;
            const r = Cues.award({
                win: res.state.winner === 0, level: G.players[1].bot, pro: G.guides === 'off',
                breakRun: res.state.winner === 0 && G.breaker === 0 && G.shotsBy[1] === 0
            });
            els.overPearls.textContent = '+' + r.total + ' Pearls · ' + r.lines.map(function (x) { return x[0] + ' ' + x[1]; }).join(' · ') + ' · you have ' + r.pearls.toLocaleString();
            els.overPearls.hidden = false;
            renderShop();
        }
        els.over.hidden = false;
        say(els.overTitle.textContent + ' ' + els.overText.textContent, humanWon ? 'good' : 'foul');
        Sound.play(humanWon || !G.players[1].bot ? 'win' : 'foul');
        clearSave();
        updateHud();
        dirty = true;
    }

    /* ---------- the bot's turn ---------- */

    function botTurn() {
        const p = current();
        G.phase = 'bot';
        setControls(false);
        say(p.name + ' is lining up a shot…');
        dirty = true;
        G.timer = setTimeout(function () {
            if (!G || G.phase !== 'bot') return;
            const st = G.state;
            const pick = Bots.choose(st, p.bot, Math.random);
            const input = pick.input;
            G.call = input.call ? { ball: input.call.ball, pocket: input.call.pocket } : null;
            const startPlace = G.place ? G.place.slice() : null;
            const endPlace = input.cue || null;
            const a0 = G.angle;
            let a1 = Math.atan2(input.dir[1], input.dir[0]);
            while (a1 - a0 > Math.PI) a1 -= Math.PI * 2;
            while (a1 - a0 < -Math.PI) a1 += Math.PI * 2;
            const t0 = performance.now();
            const tPlace = (endPlace ? 550 : 0) / FAST, tAim = (650 + Math.abs(a1 - a0) * 120) / FAST, tPull = 520 / FAST;
            if (pick.plan && pick.plan.n !== undefined && !pick.plan.safety && S.needsCall(st)) say(p.name + ' calls the ' + (S.needsCall(st) === 'pocket' ? 8 : pick.plan.n) + ' in the ' + pocketName(pick.plan.pocket) + '.');
            G.anim = function (now) {
                const t = now - t0;
                if (endPlace) {
                    const f = Math.min(1, t / tPlace);
                    const e = f * f * (3 - 2 * f);
                    const from = startPlace || endPlace;
                    G.place = [from[0] + (endPlace[0] - from[0]) * e, from[1] + (endPlace[1] - from[1]) * e];
                }
                const fa = Math.min(1, Math.max(0, (t - tPlace) / tAim));
                const ea = fa * fa * (3 - 2 * fa);
                G.angle = a0 + (a1 - a0) * ea;
                const fp = Math.max(0, (t - tPlace - tAim) / tPull);
                G.pull = Math.min(1, fp) * Math.min(1, input.power * 1.3);
                if (fp >= 1) {
                    G.anim = null;
                    G.angle = a1;
                    if (endPlace) G.place = endPlace;
                    launch(input);
                }
            };
        }, 650 / FAST);
    }

    /* ======================================================
       Scoreboard
       ====================================================== */

    function mini(n, cls) {
        const s = document.createElement('span');
        s.className = 'Mini' + (n >= 9 ? ' Mini--stripe' : '') + (n === 8 ? ' Mini--8' : '') + (cls ? ' ' + cls : '');
        s.style.setProperty('--c', colorOf(n));
        s.textContent = n;
        s.setAttribute('aria-label', 'ball ' + n);
        return s;
    }

    function updateHud() {
        if (!G) return;
        const st = G.state;
        const on = function (n) { return st.balls.some(function (b) { return b[0] === n; }); };
        [0, 1].forEach(function (i) {
            const seat = i ? els.seat1 : els.seat0;
            seat.classList.toggle('is-turn', st.turn === i && !st.over);
            const box = i ? els.balls1 : els.balls0;
            box.textContent = '';
            if (st.mode === '8') {
                const g = st.groups[i];
                if (!g) { box.textContent = st.broke ? 'open table' : ''; return; }
                const ns = g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
                const left = ns.filter(on).length;
                ns.forEach(function (n) { box.appendChild(mini(n, on(n) ? '' : 'is-down')); });
                if (!left) box.appendChild(mini(8, 'is-on'));
            }
        });
        els.rack.textContent = '';
        if (st.mode !== '8') {
            const lo = S.lowest(st);
            const max = st.mode === '9' ? 9 : 10;
            for (let n = 1; n <= max; n++) els.rack.appendChild(mini(n, on(n) ? (n === lo ? 'is-on' : '') : 'is-down'));
        }
    }

    /* ======================================================
       Controls
       ====================================================== */

    function setControls(onOff) {
        els.power.classList.toggle('is-off', !onOff);
        els.power.setAttribute('aria-disabled', onOff ? 'false' : 'true');
        els.canvas.classList.toggle('is-wait', !onOff);
        showPower(0);
    }

    function showPower(p, preset) {
        els.powerFill.style.width = Math.round(p * 100) + '%';
        els.powerFill.classList.toggle('is-preset', !!preset);
        els.power.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        els.powerText.textContent = p > 0.01 ? Math.round(p * 100) + '%' + (preset ? ' · Space to shoot' : ' · let go to shoot') : 'Pull to shoot →';
    }

    /* --- the table: aim, place, tap to call --- */

    let drag = null;

    function eventPoint(e) {
        const r = els.canvas.getBoundingClientRect();
        const sx = e.clientX - r.left, sy = e.clientY - r.top;
        return { sx: sx, sy: sy, t: toTable(sx, sy) };
    }

    els.canvas.addEventListener('pointerdown', function (e) {
        if (!G || G.phase !== 'aim') return;
        const p = eventPoint(e);
        const cp = cuePos();
        els.canvas.setPointerCapture(e.pointerId);
        const grab = (S.R + 12) / 1 + 18 / view.k;
        if (G.state.inHand && cp && Math.hypot(p.t[0] - cp[0], p.t[1] - cp[1]) < grab) {
            drag = { kind: 'place', id: e.pointerId, off: [cp[0] - p.t[0], cp[1] - p.t[1]], last: cp.slice() };
            els.canvas.classList.add('is-hand');
        } else {
            drag = { kind: 'aim', id: e.pointerId, start: p, a0: G.angle, moved: false, ref: cp ? Math.atan2(p.t[1] - cp[1], p.t[0] - cp[0]) : 0 };
        }
        e.preventDefault();
    });

    els.canvas.addEventListener('pointermove', function (e) {
        if (!drag || drag.id !== e.pointerId || !G) return;
        const p = eventPoint(e);
        if (drag.kind === 'place') {
            const st = G.state;
            let x = p.t[0] + drag.off[0], y = p.t[1] + drag.off[1];
            x = Math.max(S.R, Math.min((st.inHand === 'kitchen' ? S.HEAD_X : S.W - S.R), x));
            y = Math.max(S.R, Math.min(S.H - S.R, y));
            G.place = [x, y];
            if (S.canPlace(st, x, y)) drag.last = [x, y];
            autoCall();
            dirty = true;
            return;
        }
        const cp = cuePos();
        if (!cp) return;
        if (!drag.moved && Math.hypot(p.sx - drag.start.sx, p.sy - drag.start.sy) < 6) return;
        drag.moved = true;
        const ang = Math.atan2(p.t[1] - cp[1], p.t[0] - cp[0]);
        let da = ang - drag.ref;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        /* close to the cue ball, slow the turn down */
        const dist = Math.hypot(p.t[0] - cp[0], p.t[1] - cp[1]);
        const damp = Math.min(1, dist / 260);
        G.angle = drag.a0 + da * (0.35 + 0.65 * damp);
        if (Math.abs(da) > 0.6) { drag.a0 = G.angle; drag.ref = ang; }
        autoCall();
        dirty = true;
    });

    function endDrag(e) {
        if (!drag || drag.id !== e.pointerId || !G) { drag = null; return; }
        const d = drag;
        drag = null;
        els.canvas.classList.remove('is-hand');
        if (d.kind === 'place') {
            if (!S.canPlace(G.state, G.place[0], G.place[1])) G.place = d.last;
            autoCall();
            dirty = true;
            return;
        }
        if (d.moved || e.type === 'pointercancel') return;
        /* a tap: call a pocket / ball, or aim straight at the spot */
        const t = d.start.t;
        const st = G.state;
        const need = S.needsCall(st);
        if (need) {
            for (let i = 0; i < S.POCKETS.length; i++) {
                const P = S.POCKETS[i];
                if (Math.hypot(t[0] - P.x, t[1] - P.y) < P.r + 22) {
                    if (!G.call) G.call = { ball: need === 'pocket' ? 8 : null, pocket: null };
                    G.call.pocket = i;
                    G.manual.pocket = true;
                    say(turnText());
                    dirty = true;
                    return;
                }
            }
            if (need === 'ball') {
                const hit = st.balls.find(function (b) { return Math.hypot(t[0] - b[1], t[1] - b[2]) < S.R + 8; });
                if (hit && hit[0] !== S.lowest(st)) {
                    if (!G.call) G.call = { ball: null, pocket: null };
                    G.call.ball = hit[0];
                    G.manual.ball = true;
                    if (!G.manual.pocket) G.call.pocket = null;
                    say(turnText());
                    dirty = true;
                    return;
                }
            }
        }
        const cp = cuePos();
        if (cp && Math.hypot(t[0] - cp[0], t[1] - cp[1]) > S.R) {
            G.angle = Math.atan2(t[1] - cp[1], t[0] - cp[0]);
            autoCall();
            dirty = true;
        }
    }
    els.canvas.addEventListener('pointerup', endDrag);
    els.canvas.addEventListener('pointercancel', endDrag);

    els.canvas.addEventListener('wheel', function (e) {
        if (!G || G.phase !== 'aim') return;
        e.preventDefault();
        G.angle += (e.deltaY > 0 ? 1 : -1) * (e.shiftKey ? 0.02 : 0.0025);
        autoCall();
        dirty = true;
    }, { passive: false });

    /* --- the power bar: drag, let go to shoot --- */

    let preset = 0;
    let pdrag = null;
    els.power.addEventListener('pointerdown', function (e) {
        if (!G || G.phase !== 'aim') return;
        els.power.setPointerCapture(e.pointerId);
        pdrag = { id: e.pointerId, x0: e.clientX, p: 0 };
        e.preventDefault();
    });
    els.power.addEventListener('pointermove', function (e) {
        if (!pdrag || pdrag.id !== e.pointerId) return;
        const r = els.power.getBoundingClientRect();
        /* pull from wherever you pressed: the bar fills as you drag right */
        pdrag.p = Math.max(0, Math.min(1, (e.clientX - pdrag.x0) / (r.width * 0.9)));
        G.pull = pdrag.p;
        showPower(pdrag.p);
        dirty = true;
    });
    function endPower(e) {
        if (!pdrag || pdrag.id !== e.pointerId) return;
        const p = pdrag.p;
        pdrag = null;
        if (e.type === 'pointerup' && p > 0.02 && G && G.phase === 'aim') {
            preset = p;
            shoot(p);
        } else {
            if (G) G.pull = 0;
            showPower(preset, true);
            dirty = true;
        }
    }
    els.power.addEventListener('pointerup', endPower);
    els.power.addEventListener('pointercancel', endPower);

    /* --- fine aim: a thumb wheel --- */

    let fdrag = null;
    let fineOff = 0;
    els.fine.addEventListener('pointerdown', function (e) {
        if (!G || G.phase !== 'aim') return;
        els.fine.setPointerCapture(e.pointerId);
        fdrag = { id: e.pointerId, x: e.clientX };
        e.preventDefault();
    });
    els.fine.addEventListener('pointermove', function (e) {
        if (!fdrag || fdrag.id !== e.pointerId || !G || G.phase !== 'aim') return;
        const dx = e.clientX - fdrag.x;
        fdrag.x = e.clientX;
        G.angle += dx * 0.0007;
        fineOff += dx;
        els.fineGrip.style.backgroundPosition = fineOff + 'px 0';
        autoCall();
        dirty = true;
    });
    const endFine = function (e) { if (fdrag && fdrag.id === e.pointerId) fdrag = null; };
    els.fine.addEventListener('pointerup', endFine);
    els.fine.addEventListener('pointercancel', endFine);

    /* --- spin --- */

    function showSpin() {
        const s = G ? G.spin : [0, 0];
        const reach = Cues.spinReach(G ? cueNow() : Cues.equipped());
        if (els.spinReach) { els.spinReach.style.width = (reach * 76) + '%'; els.spinReach.style.height = (reach * 76) + '%'; }
        const put = function (dot) { dot.style.left = (50 + s[0] * 38) + '%'; dot.style.top = (50 - s[1] * 38) + '%'; };
        put(els.spinDot);
        put(els.spinBigDot);
    }
    function openSpin(open) {
        els.spinPop.hidden = !open;
        els.spinBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) showSpin();
    }
    els.spinBtn.addEventListener('click', function () { openSpin(els.spinPop.hidden); });
    els.spinDone.addEventListener('click', function () { openSpin(false); });
    els.spinReset.addEventListener('click', function () { if (G) G.spin = [0, 0]; showSpin(); });
    let sdrag = null;
    function setSpinFrom(e) {
        const r = els.spinBig.getBoundingClientRect();
        let a = ((e.clientX - r.left) / r.width - 0.5) / 0.38;
        let b = -((e.clientY - r.top) / r.height - 0.5) / 0.38;
        const m = Math.hypot(a, b);
        const reach = Cues.spinReach(G ? cueNow() : Cues.equipped());
        if (m > reach) { a *= reach / m; b *= reach / m; }
        if (G) G.spin = [Math.round(a * 100) / 100, Math.round(b * 100) / 100];
        showSpin();
    }
    els.spinBig.addEventListener('pointerdown', function (e) { els.spinBig.setPointerCapture(e.pointerId); sdrag = e.pointerId; setSpinFrom(e); });
    els.spinBig.addEventListener('pointermove', function (e) { if (sdrag === e.pointerId) setSpinFrom(e); });
    els.spinBig.addEventListener('pointerup', function () { sdrag = null; });
    els.spinBig.addEventListener('pointercancel', function () { sdrag = null; });
    document.addEventListener('pointerdown', function (e) {
        if (!els.spinPop.hidden && !els.spinPop.contains(e.target) && !els.spinBtn.contains(e.target)) openSpin(false);
    });

    /* --- keys --- */

    document.addEventListener('keydown', function (e) {
        if (!G || els.game.hidden) return;
        const tag = (e.target && e.target.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (e.key === 'Escape' && !els.spinPop.hidden) { openSpin(false); return; }
        if (G.phase !== 'aim') return;
        const turn = e.shiftKey ? 0.026 : 0.0018;
        if (e.key === 'ArrowLeft') { G.angle -= turn; }
        else if (e.key === 'ArrowRight') { G.angle += turn; }
        else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { preset = Math.min(1, Math.round((preset + 0.05) * 100) / 100); showPower(preset, true); }
        else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { preset = Math.max(0, Math.round((preset - 0.05) * 100) / 100); showPower(preset, true); }
        else if (e.key === ' ' || e.key === 'Enter') { if (e.target === els.power || tag !== 'BUTTON') { if (preset > 0.02) shoot(preset); else say('Set the power first: W / S or ↑ / ↓, or drag the power bar.'); } else return; }
        else return;
        e.preventDefault();
        autoCall();
        dirty = true;
    });

    /* --- tools --- */

    function showMute() {
        const m = Sound.isMuted();
        els.mute.textContent = m ? '\u{1F507}' : '\u{1F50A}';
        els.mute.setAttribute('aria-pressed', m ? 'true' : 'false');
        els.mute.setAttribute('aria-label', m ? 'Sound off — unmute' : 'Sound on — mute');
    }
    els.mute.addEventListener('click', function () { Sound.toggle(); showMute(); });

    function setFull(on) {
        els.game.classList.toggle('is-full', on);
        document.documentElement.classList.toggle('pool-full', on);
        els.full.setAttribute('aria-pressed', on ? 'true' : 'false');
        try {
            if (on && els.game.requestFullscreen && !document.fullscreenElement) els.game.requestFullscreen().catch(function () {});
            if (!on && document.fullscreenElement) document.exitFullscreen().catch(function () {});
        } catch (e) { /* the fixed overlay is enough */ }
        setTimeout(layout, 60);
    }
    els.full.addEventListener('click', function () { setFull(!els.game.classList.contains('is-full')); });
    document.addEventListener('fullscreenchange', function () {
        if (!document.fullscreenElement && els.game.classList.contains('is-full')) setFull(false);
    });

    els.quit.addEventListener('click', function () {
        if (G && G.phase !== 'over' && G.state.shots > 0 && !window.confirm('Leave this game? It stays saved: Resume picks it up again.')) return;
        backToSetup();
    });

    /* ======================================================
       Setup, start, rematch, resume
       ====================================================== */

    function buildOpps() {
        els.opps.textContent = '';
        OPPS.forEach(function (o) {
            const label = document.createElement('label');
            label.className = 'Opp';
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'opp';
            input.value = o.id;
            input.checked = settings.opp === o.id;
            const card = document.createElement('span');
            card.className = 'Opp-card';
            const img = document.createElement('img');
            img.className = 'Opp-pic';
            img.alt = '';
            img.width = 48; img.height = 48;
            img.src = o.pic || ('images/whales/' + o.whale + '.webp');
            const name = document.createElement('span');
            name.className = 'Opp-name';
            name.textContent = o.name;
            if (o.level) {
                const lv = document.createElement('span');
                lv.className = 'Opp-level';
                lv.textContent = o.level;
                name.appendChild(lv);
            }
            const note = document.createElement('span');
            note.className = 'Opp-note';
            note.textContent = o.note;
            card.append(img, name, note);
            label.append(input, card);
            els.opps.appendChild(label);
        });
    }

    function readSetup() {
        const mode = (document.querySelector('input[name="mode"]:checked') || {}).value || '8';
        const opp = (document.querySelector('input[name="opp"]:checked') || {}).value || 'normal';
        settings.mode = mode;
        settings.opp = opp;
        settings.guides = (document.querySelector('input[name="guides"]:checked') || {}).value || 'cue';
        settings.name1 = cleanName(els.name1.value);
        settings.name2 = cleanName(els.name2.value);
        saveSettings();
        return settings;
    }

    function cleanName(s) { return String(s || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 16); }

    function syncSetup() {
        const opp = (document.querySelector('input[name="opp"]:checked') || {}).value;
        const friend = opp === 'friend';
        els.name2Wrap.hidden = !friend;
        els.name1Label.textContent = friend ? 'Player 1' : 'Your name';
        els.name1.placeholder = friend ? 'Player 1' : 'You';
    }

    function playersFor(s) {
        const o = OPPS.find(function (x) { return x.id === s.opp; }) || OPPS[1];
        if (o.id === 'friend') {
            return [
                { name: s.name1 || 'Player 1', pic: ME_PIC, bot: null },
                { name: s.name2 || 'Player 2', pic: FRIEND_PIC, bot: null }
            ];
        }
        return [
            { name: s.name1 || 'You', pic: ME_PIC, bot: null },
            { name: o.name, pic: 'images/whales/' + o.whale + '.webp', bot: o.id }
        ];
    }

    function begin(mode, opp, players, breaker, state) {
        if (G) { clearTimeout(G.timer); clearTimeout(G.sayTimer); }
        orient.clear();
        orientVer.clear();
        sprites.clear();
        G = {
            mode: mode, opp: opp, players: players, breaker: breaker,
            state: state || Object.assign(S.newGame(mode, (Math.random() * 4294967296) >>> 0), {}),
            phase: 'wait', angle: 0, spin: [0, 0], call: null, manual: { ball: false, pocket: false },
            place: null, run: null, sinking: [], pull: 0, anim: null, timer: null, sayTimer: null, report: null,
            guides: settings.guides || 'cue', shotsBy: [0, 0], awarded: false
        };
        if (!state) G.state.turn = breaker;
        els.setup.hidden = true;
        els.shop.hidden = true;
        els.game.hidden = false;
        els.over.hidden = true;
        els.modeName.textContent = S.MODES[mode].name;
        [0, 1].forEach(function (i) {
            (i ? els.who1 : els.who0).textContent = players[i].name;
            (i ? els.pic1 : els.pic0).src = players[i].pic;
        });
        showSpin();
        showPower(preset, true);
        layout();
        save();
        try { els.game.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* fine */ }
        startTurn();
    }

    function backToSetup() {
        if (G) { clearTimeout(G.timer); clearTimeout(G.sayTimer); G.anim = null; }
        if (els.game.classList.contains('is-full')) setFull(false);
        if (G && G.phase === 'over') clearSave();
        G = null;
        els.game.hidden = true;
        els.setup.hidden = false;
        els.shop.hidden = false;
        renderShop();
        offerResume();
    }

    function save() {
        if (!G || G.phase === 'over' || G.state.over) return;
        try {
            localStorage.setItem(SAVE, JSON.stringify({ v: S.VERSION, mode: G.mode, opp: G.opp, players: G.players, breaker: G.breaker, state: G.state, guides: G.guides, shotsBy: G.shotsBy }));
        } catch (e) { /* fine */ }
    }
    function clearSave() { try { localStorage.removeItem(SAVE); } catch (e) { /* fine */ } }
    function loadSave() {
        try {
            const s = JSON.parse(localStorage.getItem(SAVE) || 'null');
            if (s && s.v === S.VERSION && s.state && !s.state.over && S.MODES[s.mode]) return s;
        } catch (e) { /* none */ }
        return null;
    }
    function offerResume() {
        const s = loadSave();
        els.resume.hidden = !s;
        if (s) els.resume.textContent = 'Resume ' + S.MODES[s.mode].name + ' vs ' + s.players[1].name;
    }

    els.start.addEventListener('click', function () {
        const s = readSetup();
        begin(s.mode, s.opp, playersFor(s), 0, null);
    });
    els.resume.addEventListener('click', function () {
        const s = loadSave();
        if (!s) { offerResume(); return; }
        settings.guides = s.guides || 'cue';
        begin(s.mode, s.opp, s.players, s.breaker, s.state);
        if (s.shotsBy) G.shotsBy = s.shotsBy;
    });
    els.again.addEventListener('click', function () {
        if (!G) return;
        begin(G.mode, G.opp, G.players, 1 - G.breaker, null);
    });
    els.change.addEventListener('click', backToSetup);
    els.opps.addEventListener('change', syncSetup);

    /* ======================================================
       The Cue Shop
       ====================================================== */

    function statBar(label, n) {
        const row = document.createElement('span');
        row.className = 'Stat';
        const l = document.createElement('span');
        l.className = 'Stat-name';
        l.textContent = label;
        const pips = document.createElement('span');
        pips.className = 'Stat-pips';
        pips.setAttribute('aria-label', label + ' ' + n + ' of 5');
        for (let i = 1; i <= 5; i++) {
            const p = document.createElement('span');
            if (i <= n) p.className = 'is-on';
            pips.appendChild(p);
        }
        row.append(l, pips);
        return row;
    }

    /* the soft glow behind a cue, in its rarity's colour */
    const GLOW = { common: 'rgba(190, 196, 195, 0.45)', rare: 'rgba(130, 176, 214, 0.6)', epic: 'rgba(160, 130, 205, 0.6)', legendary: 'rgba(244, 183, 64, 0.62)' };

    /* a cue across a shop picture, tilted a little: tip up on the right, butt down on the left */
    function paintPreview(canvas, id, time) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const w = canvas.clientWidth || 260, h = canvas.clientHeight || 96;
        const W = Math.round(w * dpr), H = Math.round(h * dpr);
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        const c = canvas.getContext('2d');
        c.setTransform(1, 0, 0, 1, 0, 0);
        c.clearRect(0, 0, W, H);
        const big = canvas === els.cueZoomArt;
        const tilt = big ? 0.15 : 0.12;
        const w1 = (big ? Math.min(13, w / 70) : 6.4) * dpr;
        const len = Math.min(W * 0.9 / Math.cos(tilt), (H - w1 * 8) / Math.sin(tilt));
        const ang = Math.PI - tilt;
        const tx = W / 2 - Math.cos(ang) * len / 2, ty = H / 2 - Math.sin(ang) * len / 2;
        Cues.drawCue(c, id, tx, ty, ang, len, w1 * 0.46, w1, { px: dpr, shadow: [3 * dpr, 5 * dpr], time: time });
    }

    /* the shop's live cues (pulses and shimmers) and the close-up keep moving while they're on screen */
    let shopLive = [];
    let shopRaf = 0;
    let zoomCue = null;
    let zoomFrom = null;
    function shopTick(now) {
        shopRaf = 0;
        const zoomOn = !els.cueZoom.hidden && zoomCue && Cues.animated(zoomCue.id);
        const shopOn = !els.shop.hidden && shopLive.length > 0;
        if (!zoomOn && !shopOn) return;
        if (shopOn) shopLive.forEach(function (x) { if (x.canvas.isConnected) paintPreview(x.canvas, x.id, now); });
        if (zoomOn) paintPreview(els.cueZoomArt, zoomCue.id, now);
        shopRaf = window.requestAnimationFrame(shopTick);
    }
    function wakeShop() { if (!shopRaf) shopRaf = window.requestAnimationFrame(shopTick); }

    /* when the cards change size (fonts arriving, a phone turning), repaint their pictures at the new size so they stay sharp */
    if (window.ResizeObserver && els.cues) {
        let sizeTimer = 0;
        new ResizeObserver(function () {
            clearTimeout(sizeTimer);
            sizeTimer = setTimeout(function () {
                els.cues.querySelectorAll('canvas.Cue-art').forEach(function (cv) { paintPreview(cv, cv.dataset.cue, performance.now()); });
            }, 60);
        }).observe(els.cues);
    }

    function openZoom(cue, from) {
        zoomCue = cue;
        zoomFrom = from || null;
        const r = Cues.RARITY[cue.rarity];
        els.cueZoomCard.style.setProperty('--rarity', r.color);
        els.cueZoomCard.style.setProperty('--pip', r.pip);
        els.cueZoomCard.style.setProperty('--glow', GLOW[cue.rarity]);
        els.cueZoomName.textContent = cue.name;
        els.cueZoomRarity.textContent = r.name;
        els.cueZoomBlurb.textContent = cue.blurb;
        els.cueZoomStats.textContent = '';
        els.cueZoomStats.append(statBar('Aim', cue.stats[0]), statBar('Power', cue.stats[1]), statBar('Spin', cue.stats[2]));
        els.cueZoom.hidden = false;
        paintPreview(els.cueZoomArt, cue.id, performance.now());
        els.cueZoomClose.focus();
        wakeShop();
    }
    function closeZoom() {
        if (els.cueZoom.hidden) return;
        els.cueZoom.hidden = true;
        zoomCue = null;
        if (zoomFrom && zoomFrom.isConnected) zoomFrom.focus();
    }
    els.cueZoomClose.addEventListener('click', closeZoom);
    els.cueZoom.addEventListener('click', function (e) { if (e.target === els.cueZoom) closeZoom(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeZoom(); });
    window.addEventListener('resize', function () { if (!els.cueZoom.hidden && zoomCue) paintPreview(els.cueZoomArt, zoomCue.id, performance.now()); });

    function renderShop() {
        if (!els.cues) return;
        const L = Cues.load();
        els.pearls.textContent = L.pearls.toLocaleString();
        els.cues.textContent = '';
        shopLive = [];
        Cues.CUES.forEach(function (cue) {
            const owned = Cues.owns(cue.id);
            const on = L.equipped === cue.id;
            const card = document.createElement('div');
            card.className = 'Cue-card' + (on ? ' is-on' : '') + (owned ? ' is-owned' : '');
            card.style.setProperty('--rarity', Cues.RARITY[cue.rarity].color);
            card.style.setProperty('--pip', Cues.RARITY[cue.rarity].pip);
            const head = document.createElement('div');
            head.className = 'Cue-head';
            const name = document.createElement('span');
            name.className = 'Cue-name';
            name.textContent = cue.name;
            const tag = document.createElement('span');
            tag.className = 'Cue-rarity';
            tag.textContent = Cues.RARITY[cue.rarity].name;
            head.append(name, tag);
            const artBtn = document.createElement('button');
            artBtn.type = 'button';
            artBtn.className = 'Cue-art-btn';
            artBtn.setAttribute('aria-label', 'Look closer at the ' + cue.name);
            artBtn.style.setProperty('--glow', GLOW[cue.rarity]);
            const art = document.createElement('canvas');
            art.className = 'Cue-art';
            art.setAttribute('aria-hidden', 'true');
            art.dataset.cue = cue.id;
            artBtn.appendChild(art);
            artBtn.addEventListener('click', function () { openZoom(cue, artBtn); });
            const blurb = document.createElement('p');
            blurb.className = 'Cue-blurb';
            blurb.textContent = cue.blurb;
            const stats = document.createElement('div');
            stats.className = 'Cue-stats';
            stats.append(statBar('Aim', cue.stats[0]), statBar('Power', cue.stats[1]), statBar('Spin', cue.stats[2]));
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'Btn Cue-btn' + (!owned && !cue.holder && L.pearls >= cue.price ? ' Btn--primary' : '');
            if (on) { btn.textContent = 'In your hand'; btn.disabled = true; }
            else if (owned) { btn.textContent = 'Use this cue'; btn.addEventListener('click', function () { Cues.equip(cue.id); renderShop(); }); }
            else if (cue.holder) { btn.textContent = 'Holders only'; btn.disabled = true; }
            else {
                btn.textContent = 'Buy · ' + cue.price.toLocaleString() + ' Pearls';
                btn.disabled = L.pearls < cue.price;
                btn.addEventListener('click', function () {
                    try { Cues.buy(cue.id); Sound.play('win'); } catch (e) { /* the button was disabled anyway */ }
                    renderShop();
                });
            }
            card.append(head, artBtn, blurb, stats, btn);
            els.cues.appendChild(card);
            paintPreview(art, cue.id, performance.now());
            if (Cues.animated(cue.id)) shopLive.push({ canvas: art, id: cue.id });
        });
        wakeShop();
        if (els.legendWallet && !els.legendWallet.value && L.wallet) els.legendWallet.value = L.wallet;
    }

    async function checkLegend() {
        els.legendGo.disabled = true;
        els.legendStatus.textContent = 'Looking up the OG whales in that wallet…';
        try {
            const r = await Cues.checkWallet(els.legendWallet.value);
            const got = [];
            if (r.staff.length) got.push('the Staff (whale #' + r.staff.join(', #') + ')');
            if (r.trident.length) got.push('the Trident (whale #' + r.trident.join(', #') + ')');
            els.legendStatus.textContent = got.length
                ? 'Yours: ' + got.join(' and ') + '. Pick it below.'
                : (r.unread ? 'Couldn’t read ' + r.unread + ' of the ' + r.count + ' whales’ traits just now — try again in a minute.'
                            : r.count + ' OG whale' + (r.count === 1 ? '' : 's') + ' in that wallet, but none holds a Staff or a Trident.');
        } catch (e) {
            els.legendStatus.textContent = e.message;
        }
        els.legendGo.disabled = false;
        renderShop();
    }
    if (els.legendGo) els.legendGo.addEventListener('click', checkLegend);

    /* ======================================================
       Start up
       ====================================================== */

    buildOpps();
    const mi = document.querySelector('input[name="mode"][value="' + settings.mode + '"]');
    if (mi) mi.checked = true;
    const gi = document.querySelector('input[name="guides"][value="' + (settings.guides || 'cue') + '"]');
    if (gi) gi.checked = true;
    els.name1.value = settings.name1 || '';
    els.name2.value = settings.name2 || '';
    syncSetup();
    offerResume();
    showMute();
    renderShop();
    /* a wallet pasted in the Lounge or Whale 2048: check it for the Legendary cues */
    Cues.autoCheck(function () { renderShop(); });

    crest = new Image();
    crest.onload = function () { if (view.layer) { buildLayer(); dirty = true; } };
    crest.src = 'images/cards/ssow-badge.webp';

    let resizeTimer = 0;
    window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () { layout(); if (!els.shop.hidden) renderShop(); }, 120);
    });
    window.requestAnimationFrame(frame);

    /* for tests: ?sandbox exposes the game */
    if (/[?&]sandbox(&|$)/.test(window.location.search)) {
        window.WhalePoolTest = {
            game: function () { return G; },
            view: view,
            shoot: shoot,
            begin: begin,
            players: playersFor,
            toScreen: toScreen,
            redraw: function () { dirty = true; }
        };
    }
})();
