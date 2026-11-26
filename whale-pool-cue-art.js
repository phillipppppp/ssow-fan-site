/* ============================================================
   Whale Pool — cue artwork (WhalePoolCueArt)

   Art only: this file draws cues and nothing else. Which cue you
   own, what it costs and what its stats do live in
   whale-pool-cues.js, which hands every drawing job to draw() here,
   so the Cue Shop cards and the cue on the table always match.

   A cue is built from real parts, tip to butt: a coloured tip, an
   ivory ferrule, the shaft, a metal joint ring, a decorated forearm,
   a trim ring, the grip wrap, another trim ring, the butt sleeve and
   a rounded butt cap. Every cue then gets the same round, glossy
   shading (a light top, a mid tone, a darker bottom edge, a thin
   shine line and a glint) and a thin ink outline like the rest of
   the site.

   Speed: each cue is painted once per size into an off-screen canvas
   (with its soft shadow) and cached. A frame just pastes that image,
   then adds the little live effects: the Laser Eyes pulse and the
   Legendary shimmer and sparkles. Those are skipped when the player
   prefers reduced motion. Two copies are cached per size, so the
   shine always sits on the side facing up on screen, whichever way
   the cue points.

   All artwork here is original and drawn in code.
   ============================================================ */

(function () {
    'use strict';

    const INK = '#1d1b20';
    const motionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    function reducedMotion() { return !!(motionQuery && motionQuery.matches); }

    /* where the parts sit, as a share of the length from the tip (0) to the butt (1) */
    const PART = {
        tip: [0, 0.012], ferrule: [0.012, 0.034], shaft: [0.034, 0.5], joint: [0.5, 0.516],
        forearm: [0.516, 0.71], trim1: [0.71, 0.716], wrap: [0.716, 0.86], trim2: [0.86, 0.866],
        sleeve: [0.866, 0.984], cap: [0.984, 1]
    };
    const RINGS = [['joint', 1.1], ['trim1', 1.05], ['trim2', 1.05]];

    const METAL = {
        brass:  ['#5e4310', '#f6dc8c', '#c9993a', '#5a400f'],
        silver: ['#585f66', '#ffffff', '#b9c0c6', '#454b51'],
        chrome: ['#353b45', '#ffffff', '#9fb0c2', '#262b33'],
        gold:   ['#7a5208', '#fff1b8', '#e0a21c', '#6a4606'],
        red:    ['#4a0808', '#ff9a8a', '#c0262b', '#3a0505'],
        black:  ['#0d0c10', '#77737f', '#26232b', '#08070a'],
        purple: ['#2a1048', '#d7b8ff', '#6b3fb0', '#200a38'],
        ember:  ['#5a1204', '#ffd27a', '#ff6a1a', '#6a1606']
    };

    /* ---------- shapes ---------- */

    function radiusAt(L, r0, r1) { return function (x) { return r0 + (r1 - r0) * (x / L); }; }

    /* the outline: a gentle taper, the joint and trim rings standing proud, a rounded butt */
    function profile(g, L, r0, r1, x0) {
        const R = radiusAt(L, r0, r1);
        const top = [[x0, -R(x0)]];
        RINGS.forEach(function (ring) {
            const a = PART[ring[0]][0] * L, b = PART[ring[0]][1] * L, k = ring[1];
            if (b <= x0) return;
            const aa = Math.max(a, x0);
            top.push([aa, -R(aa)], [aa, -R(aa) * k], [b, -R(b) * k], [b, -R(b)]);
        });
        const ce = L - 0.45 * r1;
        top.push([ce, -R(ce)]);
        g.beginPath();
        g.moveTo(top[0][0], top[0][1]);
        for (let i = 1; i < top.length; i++) g.lineTo(top[i][0], top[i][1]);
        g.quadraticCurveTo(L + 0.02 * r1, -R(ce), L + 0.02 * r1, 0);
        g.quadraticCurveTo(L + 0.02 * r1, R(ce), ce, R(ce));
        for (let i = top.length - 1; i >= 0; i--) g.lineTo(top[i][0], -top[i][1]);
        g.closePath();
    }

    /* ---------- painting helpers (cue space: x from the tip, y across) ---------- */

    function fillPart(k, name, style) {
        const p = PART[name];
        k.g.fillStyle = style;
        k.g.fillRect(p[0] * k.L, -k.r1 * 1.4, (p[1] - p[0]) * k.L + 0.5, k.r1 * 2.8);
    }

    function metalPart(k, name, kind) {
        const p = PART[name];
        const m = METAL[kind] || METAL.silver;
        const r = k.R(p[1] * k.L) * 1.12;
        const gr = k.g.createLinearGradient(0, -r, 0, r);
        gr.addColorStop(0, m[0]); gr.addColorStop(0.26, m[1]); gr.addColorStop(0.58, m[2]); gr.addColorStop(1, m[3]);
        k.g.fillStyle = gr;
        k.g.fillRect(p[0] * k.L, -k.r1 * 1.4, (p[1] - p[0]) * k.L + 0.5, k.r1 * 2.8);
    }

    /* a small, fixed pseudo-random sequence, so every draw of a cue is identical */
    function seq(seed) {
        let a = seed >>> 0;
        return function () { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; };
    }

    function range(k, name) { return [PART[name][0] * k.L, PART[name][1] * k.L]; }

    /* long, wavy wood grain */
    function grain(k, a, b, color, lines) {
        const g = k.g;
        g.strokeStyle = color;
        g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.05);
        for (let i = 0; i < lines; i++) {
            const f = -0.85 + (1.7 * (i + 0.5)) / lines;
            g.beginPath();
            for (let x = a; x <= b; x += Math.max(4, (b - a) / 40)) {
                const y = f * k.R(x) + Math.sin(x * 0.045 + i * 1.7) * k.R(x) * 0.06;
                if (x === a) g.moveTo(x, y); else g.lineTo(x, y);
            }
            g.stroke();
        }
    }

    /* inlaid points: long triangles running up the forearm toward the joint */
    function points(k, wood, veneer, count) {
        const g = k.g;
        const [a, b] = range(k, 'forearm');
        const apex = a + (b - a) * 0.2;
        const centres = count === 4 ? [-1, 0, 1] : [0];
        centres.forEach(function (c) {
            const y = c * k.R(b);
            const w = k.R(b) * 0.62;
            g.fillStyle = veneer;
            g.beginPath(); g.moveTo(b + 1, y - w - k.r1 * 0.1); g.lineTo(apex - k.r1 * 0.3, y); g.lineTo(b + 1, y + w + k.r1 * 0.1); g.closePath(); g.fill();
            g.fillStyle = wood;
            g.beginPath(); g.moveTo(b + 1, y - w); g.lineTo(apex, y); g.lineTo(b + 1, y + w); g.closePath(); g.fill();
        });
    }

    /* woven linen or braid on the grip */
    function weave(k, base, line, gap) {
        const g = k.g;
        const [a, b] = range(k, 'wrap');
        g.fillStyle = base;
        g.fillRect(a, -k.r1 * 1.4, b - a, k.r1 * 2.8);
        g.strokeStyle = line;
        g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.07);
        const step = k.r1 * (gap || 0.42);
        for (let x = a - k.r1 * 2; x < b; x += step) {
            g.beginPath(); g.moveTo(x, -k.r1 * 1.3); g.lineTo(x + k.r1 * 1.6, k.r1 * 1.3); g.stroke();
            g.beginPath(); g.moveTo(x + k.r1 * 1.6, -k.r1 * 1.3); g.lineTo(x, k.r1 * 1.3); g.stroke();
        }
    }

    function stripe(k, x0, x1, fill) { k.g.fillStyle = fill; k.g.fillRect(x0, -k.r1 * 1.4, x1 - x0, k.r1 * 2.8); }

    /* the glossy round look, slice by slice so it follows the taper */
    function shade(k, variant, rarity) {
        const g = k.g;
        const flip = variant === 1 ? -1 : 1;
        const cuts = [];
        const n = 48;
        for (let i = 0; i <= n; i++) cuts.push(k.x0 + (k.L - k.x0) * i / n);
        Object.keys(PART).forEach(function (p) { cuts.push(PART[p][0] * k.L, PART[p][1] * k.L); });
        const xs = cuts.filter(function (x) { return x >= k.x0 && x <= k.L; }).sort(function (a, b) { return a - b; });
        const metal = RINGS.map(function (r) { return PART[r[0]]; });
        for (let i = 0; i + 1 < xs.length; i++) {
            const xa = xs[i], xb = xs[i + 1];
            if (xb - xa < 0.01) continue;
            const xm = (xa + xb) / 2, f = xm / k.L;
            if (metal.some(function (p) { return f > p[0] && f < p[1]; })) continue;     /* metal shades itself */
            const r = k.R(xm) * 1.05;
            const gr = g.createLinearGradient(0, -r * flip, 0, r * flip);
            gr.addColorStop(0, 'rgba(255, 255, 255, 0.10)');
            gr.addColorStop(0.11, 'rgba(255, 255, 255, 0.46)');
            gr.addColorStop(0.3, 'rgba(255, 255, 255, 0.10)');
            gr.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
            gr.addColorStop(0.72, 'rgba(0, 0, 0, 0.10)');
            gr.addColorStop(0.9, 'rgba(0, 0, 0, 0.30)');
            gr.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
            g.fillStyle = gr;
            g.fillRect(xa, -r * 1.1, xb - xa + 0.6, r * 2.2);
            if (rarity !== 'common') {
                /* rarer cues: a second, broader gloss band */
                const g2 = g.createLinearGradient(0, -r * flip, 0, r * flip);
                g2.addColorStop(0.12, 'rgba(255, 255, 255, 0)');
                g2.addColorStop(0.24, 'rgba(255, 255, 255, ' + (rarity === 'rare' ? 0.3 : 0.22) + ')');
                g2.addColorStop(0.36, 'rgba(255, 255, 255, 0)');
                g.fillStyle = g2;
                g.fillRect(xa, -r * 1.1, xb - xa + 0.6, r * 2.2);
            }
        }
        /* the shine line and a glint near the joint */
        const a = Math.max(k.x0 + k.r1 * 0.5, 0.05 * k.L), b = 0.97 * k.L;
        const line = g.createLinearGradient(a, 0, b, 0);
        line.addColorStop(0, 'rgba(255, 255, 255, 0)');
        line.addColorStop(0.08, 'rgba(255, 255, 255, 0.75)');
        line.addColorStop(0.92, 'rgba(255, 255, 255, 0.75)');
        line.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.strokeStyle = line;
        g.lineWidth = Math.max(0.8 * k.px, k.r1 * 0.11);
        g.beginPath();
        for (let x = a; x <= b; x += (b - a) / 30) {
            const y = -flip * k.R(x) * 0.6;
            if (x === a) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        const gx = PART.joint[1] * k.L + k.r1 * 1.4;
        if (gx > k.x0) {
            g.fillStyle = 'rgba(255, 255, 255, 0.9)';
            g.beginPath(); g.ellipse(gx, -flip * k.R(gx) * 0.55, k.r1 * 0.7, k.r1 * 0.16, 0, 0, Math.PI * 2); g.fill();
        }
    }

    /* ---------- the Legendary heads (the Staff and the Trident, from the OG traits) ---------- */

    const GOLD = '#f4b740', GOLD_DEEP = '#b9790f', GOLD_SHINE = '#ffe39a';

    function amethyst(c, x, y, r, px) {
        /* a soft violet glow, then the gem */
        c.save();
        c.shadowColor = 'rgba(186, 120, 255, 0.95)';
        c.shadowBlur = r * 1.3;
        c.fillStyle = '#6b3fb0';
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.restore();
        const g = c.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
        g.addColorStop(0, '#f0dcff');
        g.addColorStop(0.45, '#8a4cc9');
        g.addColorStop(1, '#3a1766');
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
        c.strokeStyle = INK; c.lineWidth = Math.max(1 * px, r * 0.16); c.stroke();
        c.fillStyle = 'rgba(255, 255, 255, 0.85)';
        c.beginPath(); c.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.18, -0.6, 0, Math.PI * 2); c.fill();
    }

    /* gold with a glossy top: fill, a light-to-dark wash, then the ink line */
    function goldPath(c, s, px) {
        c.fillStyle = GOLD;
        c.fill();
        c.save();
        c.clip();
        const box = s * 4;
        const gr = c.createLinearGradient(0, -box, 0, box);
        gr.addColorStop(0, 'rgba(255, 250, 220, 0.55)');
        gr.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
        gr.addColorStop(1, 'rgba(90, 50, 0, 0.35)');
        c.fillStyle = gr;
        c.fillRect(-box, -box, s * 14, box * 2);
        c.restore();
        c.lineJoin = 'round';
        c.strokeStyle = INK;
        c.lineWidth = Math.max(1.2 * px, s * 0.16);
        c.stroke();
    }

    /* a gold tentacle: ink under gold, a shine on top, ending in a little curl */
    function tentacle(c, s, px, pts, curl, width) {
        const draw = function () {
            c.beginPath();
            c.moveTo(pts[0][0] * s, pts[0][1] * s);
            for (let i = 1; i + 2 < pts.length + 1; i += 3) {
                if (!pts[i + 2]) break;
                c.bezierCurveTo(pts[i][0] * s, pts[i][1] * s, pts[i + 1][0] * s, pts[i + 1][1] * s, pts[i + 2][0] * s, pts[i + 2][1] * s);
            }
            if (curl) c.arc(curl[0] * s, curl[1] * s, curl[2] * s, curl[3], curl[4], curl[5]);
        };
        c.lineCap = 'round';
        c.lineJoin = 'round';
        draw(); c.strokeStyle = INK; c.lineWidth = width * s + Math.max(2 * px, s * 0.22); c.stroke();
        draw(); c.strokeStyle = GOLD; c.lineWidth = width * s; c.stroke();
        draw(); c.strokeStyle = 'rgba(255, 240, 180, 0.8)'; c.lineWidth = width * s * 0.3; c.stroke();
        c.lineCap = 'butt';
    }

    function tridentHead(c, s, px) {
        /* the squid's tentacles, wrapping down the shaft */
        [-1, 1].forEach(function (k) {
            tentacle(c, s, px, [[6.6, k * 0.5], [7.4, k * 1.6], [8.4, k * 1.3], [8.9, k * 0.4]], [9.2, k * 0.4, 0.32, Math.PI, k > 0 ? Math.PI * 2.6 : -Math.PI * 0.6, k < 0], 0.34);
        });
        /* the two outer prongs: out from the body, forward, barbed tips flaring outward */
        [-1, 1].forEach(function (k) {
            c.beginPath();
            c.moveTo(5.6 * s, k * 0.7 * s);
            c.bezierCurveTo(5.0 * s, k * 2.6 * s, 3.6 * s, k * 2.75 * s, 2.6 * s, k * 2.7 * s);
            c.lineTo(1.0 * s, k * 2.7 * s);
            c.lineTo(0.15 * s, k * 3.35 * s);
            c.lineTo(0.55 * s, k * 2.15 * s);
            c.lineTo(2.5 * s, k * 2.05 * s);
            c.bezierCurveTo(3.4 * s, k * 2.05 * s, 4.3 * s, k * 1.7 * s, 4.6 * s, k * 0.55 * s);
            c.closePath();
            goldPath(c, s, px);
            c.strokeStyle = GOLD_SHINE; c.lineWidth = s * 0.14;
            c.beginPath(); c.moveTo(1.2 * s, k * 2.45 * s); c.lineTo(2.6 * s, k * 2.45 * s); c.stroke();
        });
        /* the middle spear: a long leaf, its point strikes the ball */
        c.beginPath();
        c.moveTo(0, 0);
        c.bezierCurveTo(0.7 * s, -0.9 * s, 1.7 * s, -1.05 * s, 2.4 * s, -0.55 * s);
        c.lineTo(4.4 * s, -0.35 * s);
        c.lineTo(4.4 * s, 0.35 * s);
        c.lineTo(2.4 * s, 0.55 * s);
        c.bezierCurveTo(1.7 * s, 1.05 * s, 0.7 * s, 0.9 * s, 0, 0);
        c.closePath();
        goldPath(c, s, px);
        c.strokeStyle = GOLD_DEEP; c.lineWidth = s * 0.12;
        c.beginPath(); c.moveTo(0.5 * s, 0); c.lineTo(2.3 * s, 0); c.stroke();
        c.strokeStyle = GOLD_SHINE; c.lineWidth = s * 0.14;
        c.beginPath(); c.moveTo(0.7 * s, -0.3 * s); c.lineTo(2.2 * s, -0.42 * s); c.stroke();
        /* the squid's body at the heart, with its amethyst */
        c.beginPath(); c.ellipse(5.5 * s, 0, 1.45 * s, 1.15 * s, 0, 0, Math.PI * 2);
        goldPath(c, s, px);
        c.strokeStyle = GOLD_DEEP; c.lineWidth = s * 0.14;
        c.beginPath(); c.ellipse(5.5 * s, 0, 1.05 * s, 0.85 * s, 0, 0, Math.PI * 2); c.stroke();
        amethyst(c, 5.45 * s, 0, 0.62 * s, px);
        /* the collar where it meets the shaft */
        c.beginPath(); c.rect(7.0 * s, -0.75 * s, 0.55 * s, 1.5 * s);
        goldPath(c, s, px);
    }

    function staffHead(c, s, px) {
        /* tentacles wrapping down the shaft */
        [-1, 1].forEach(function (k) {
            tentacle(c, s, px, [[6.8, k * 0.6], [7.6, k * 1.7], [8.7, k * 1.4], [9.2, k * 0.45]], [9.5, k * 0.45, 0.32, Math.PI, k > 0 ? Math.PI * 2.6 : -Math.PI * 0.6, k < 0], 0.36);
        });
        /* the kraken's gold head behind the gem, with a ridge and a crest */
        c.beginPath();
        c.moveTo(3.6 * s, -1.2 * s);
        c.bezierCurveTo(4.6 * s, -2.3 * s, 6.6 * s, -1.9 * s, 6.9 * s, -0.6 * s);
        c.lineTo(7.2 * s, 0);
        c.lineTo(6.9 * s, 0.6 * s);
        c.bezierCurveTo(6.6 * s, 1.9 * s, 4.6 * s, 2.3 * s, 3.6 * s, 1.2 * s);
        c.closePath();
        goldPath(c, s, px);
        c.strokeStyle = GOLD_DEEP; c.lineWidth = s * 0.16;
        [-0.75, 0, 0.75].forEach(function (y) { c.beginPath(); c.moveTo(4.4 * s, y * s); c.quadraticCurveTo(5.6 * s, y * 1.25 * s, 6.6 * s, y * 0.8 * s); c.stroke(); });
        /* the amethyst it holds out front: the part that strikes the ball */
        amethyst(c, 1.9 * s, 0, 1.8 * s, px);
        /* tentacles cradling the gem, curling at the front */
        [-1, 1].forEach(function (k) {
            tentacle(c, s, px, [[4.0, k * 1.3], [3.2, k * 2.9], [1.2, k * 2.9], [0.45, k * 1.6]], [0.75, k * 1.25, 0.32, k > 0 ? Math.PI * 0.75 : -Math.PI * 0.75, k > 0 ? Math.PI * 2.4 : -Math.PI * 2.4, k < 0], 0.42);
            tentacle(c, s, px, [[4.6, k * 1.8], [4.4, k * 3.0], [5.6, k * 3.4], [6.0, k * 2.6]], [5.75, k * 2.55, 0.25, 0, k > 0 ? -Math.PI * 1.4 : Math.PI * 1.4, k > 0], 0.3);
        });
        /* the collar where it meets the shaft */
        c.beginPath(); c.rect(7.2 * s, -0.75 * s, 0.55 * s, 1.5 * s);
        goldPath(c, s, px);
    }

    /* the Wealthy Whale's tiny top hat, standing on the butt */
    function topHat(c, L, s, px) {
        const x = L + 0.02 * s;
        c.lineJoin = 'round';
        c.strokeStyle = INK;
        c.lineWidth = Math.max(1 * px, s * 0.12);
        /* brim */
        c.beginPath(); c.rect(x, -1.45 * s, 0.32 * s, 2.9 * s); c.fillStyle = '#141216'; c.fill(); c.stroke();
        /* crown */
        c.beginPath(); c.rect(x + 0.32 * s, -0.98 * s, 1.55 * s, 1.96 * s); c.fillStyle = '#1b181f'; c.fill(); c.stroke();
        /* gold band */
        c.fillStyle = '#f4b740';
        c.fillRect(x + 0.42 * s, -0.98 * s, 0.32 * s, 1.96 * s);
        c.strokeRect(x + 0.42 * s, -0.98 * s, 0.32 * s, 1.96 * s);
        /* a shine on the silk */
        c.fillStyle = 'rgba(255, 255, 255, 0.35)';
        c.fillRect(x + 0.9 * s, -0.8 * s, 0.85 * s, 0.22 * s);
    }

    /* ---------- the thirteen cues ---------- */

    const MAPLE = '#ecd6a8';

    const DESIGNS = {
        house: {
            tip: '#2f62c4', shaft: MAPLE, joint: 'brass', trim: 'brass',
            forearm: '#5b3a21', wrap: '#2e4a3a', sleeve: '#5b3a21', cap: '#1b1a1d',
            paint: function (k) {
                grain(k, PART.shaft[0] * k.L, PART.shaft[1] * k.L, 'rgba(150, 105, 50, 0.22)', 5);
                grain(k, PART.forearm[0] * k.L, PART.forearm[1] * k.L, 'rgba(25, 12, 4, 0.35)', 6);
                points(k, '#1a110c', '#e9cf97', 4);
                weave(k, '#2e4a3a', 'rgba(10, 30, 20, 0.6)');
                grain(k, PART.sleeve[0] * k.L, PART.sleeve[1] * k.L, 'rgba(25, 12, 4, 0.35)', 6);
                const [a, b] = range(k, 'sleeve');
                stripe(k, a + (b - a) * 0.45, a + (b - a) * 0.5, '#c9993a');
            }
        },
        pixel: {
            tip: '#2aa198', shaft: MAPLE, joint: 'silver', trim: 'silver',
            forearm: '#1d3f86', wrap: '#0f1b33', sleeve: '#1d3f86', cap: '#101012',
            paint: function (k) {
                const g = k.g;
                const pal = ['#1d3f86', '#2563c9', '#4aa3df', '#83c7b3', '#173470'];
                const rnd = seq(7);
                const [a, b] = range(k, 'forearm');
                const p = k.r1 * 0.42;
                for (let x = a; x < b; x += p) {
                    for (let y = -k.r1 * 1.3; y < k.r1 * 1.3; y += p) {
                        g.fillStyle = pal[Math.floor(rnd() * pal.length)];
                        g.fillRect(x, y, p + 0.5, p + 0.5);
                    }
                }
                /* a pixel checker grip */
                const [wa, wb] = range(k, 'wrap');
                for (let x = wa, i = 0; x < wb; x += p, i++) {
                    for (let y = -k.r1 * 1.3, j = 0; y < k.r1 * 1.3; y += p, j++) {
                        g.fillStyle = (i + j) % 2 ? '#0f1b33' : '#2aa198';
                        g.fillRect(x, y, p + 0.5, p + 0.5);
                    }
                }
                /* a tiny pixel whale on the sleeve */
                const sprite = ['....XXX....', '..XXXXXXX.X', '.XXEXXXXXXX', 'XXXXXXXXXX.', '.WWWWWWWX..'];
                const [sa, sb] = range(k, 'sleeve');
                const q = k.R(sb) * 0.3;
                const ox = (sa + sb) / 2 - q * 5.5, oy = -q * 2.5;
                k.upright((sa + sb) / 2, 0, function () { sprite.forEach(function (row, r) {
                    for (let cI = 0; cI < row.length; cI++) {
                        const ch = row[cI];
                        if (ch === '.') continue;
                        g.fillStyle = ch === 'E' ? '#101012' : (ch === 'W' ? '#e8f6ff' : '#83c7b3');
                        g.fillRect(ox + cI * q, oy + r * q, q + 0.4, q + 0.4);
                    }
                }); });
            }
        },
        cigar: {
            tip: '#2f62c4', shaft: '#efd6a6', joint: 'ember', trim: 'brass',
            forearm: '#6b3f1f', wrap: '#3b2414', sleeve: '#6b3f1f', cap: '#2a1a10',
            paint: function (k) {
                const g = k.g;
                /* the leaf: mottled browns with veins */
                [range(k, 'forearm'), range(k, 'sleeve')].forEach(function (r, n) {
                    const rnd = seq(11 + n);
                    for (let i = 0; i < 22; i++) {
                        g.fillStyle = rnd() < 0.5 ? 'rgba(40, 20, 6, 0.22)' : 'rgba(150, 95, 45, 0.25)';
                        g.beginPath(); g.ellipse(r[0] + rnd() * (r[1] - r[0]), (rnd() - 0.5) * 2 * k.r1, k.r1 * (0.6 + rnd()), k.r1 * 0.3, 0.3, 0, Math.PI * 2); g.fill();
                    }
                    g.strokeStyle = 'rgba(175, 120, 60, 0.55)';
                    g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.07);
                    for (let x = r[0]; x < r[1]; x += k.r1 * 2.2) {
                        g.beginPath(); g.moveTo(x, -k.r1 * 1.2); g.quadraticCurveTo(x + k.r1 * 0.9, 0, x + k.r1 * 2.6, k.r1 * 1.2); g.stroke();
                    }
                });
                /* leather grip with stitches */
                const [wa, wb] = range(k, 'wrap');
                g.strokeStyle = 'rgba(230, 200, 150, 0.6)';
                g.setLineDash([k.r1 * 0.35, k.r1 * 0.25]);
                g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.06);
                [-0.55, 0.55].forEach(function (f) { g.beginPath(); g.moveTo(wa, f * k.R(wa)); g.lineTo(wb, f * k.R(wb)); g.stroke(); });
                g.setLineDash([]);
                /* the paper band that says SSoW */
                const [sa, sb] = range(k, 'sleeve');
                const b0 = sa + (sb - sa) * 0.22, b1 = sa + (sb - sa) * 0.78;
                stripe(k, b0, b1, '#f6efe0');
                stripe(k, b0, b0 + k.r1 * 0.22, '#c9302c');
                stripe(k, b1 - k.r1 * 0.22, b1, '#c9302c');
                const fs = Math.min(k.R(sb) * 1.25, (b1 - b0) / 3.2);
                g.font = '900 ' + fs.toFixed(1) + 'px Nunito, "Segoe UI", sans-serif';
                g.textAlign = 'center';
                g.textBaseline = 'middle';
                g.fillStyle = '#b8862b';
                k.upright((b0 + b1) / 2, 0, function () { g.fillText('SSoW', (b0 + b1) / 2, fs * 0.06); });
            }
        },
        rainbow: {
            tip: '#2f62c4', shaft: '#f6f1e6', joint: 'chrome', trim: 'chrome',
            forearm: '#e0352b', wrap: '#18171b', sleeve: '#e0352b', cap: '#111014',
            paint: function (k) {
                const g = k.g;
                const cols = ['#e0352b', '#f07a1a', '#f5c400', '#1f8a4c', '#2563c9', '#7046a8'];
                [range(k, 'forearm'), range(k, 'sleeve')].forEach(function (r) {
                    const w = (r[1] - r[0]) / cols.length;
                    cols.forEach(function (col, i) {
                        stripe(k, r[0] + i * w, r[0] + (i + 1) * w + 0.5, col);
                        if (i) {
                            const m = METAL.chrome, x = r[0] + i * w;
                            const gr = g.createLinearGradient(0, -k.r1, 0, k.r1);
                            gr.addColorStop(0, m[0]); gr.addColorStop(0.3, m[1]); gr.addColorStop(1, m[3]);
                            g.fillStyle = gr;
                            g.fillRect(x - k.r1 * 0.09, -k.r1 * 1.4, k.r1 * 0.18, k.r1 * 2.8);
                        }
                    });
                });
                weave(k, '#18171b', 'rgba(255, 255, 255, 0.08)', 0.3);
            }
        },
        neon: {
            tip: '#ff4fd8', shaft: '#1e1830', joint: 'chrome', trim: 'chrome',
            forearm: '#120e1e', wrap: '#0c0a14', sleeve: '#120e1e', cap: '#ff4fd8',
            paint: function (k) {
                const g = k.g;
                const tube = function (a, b, f, color, wave) {
                    const path = function () {
                        g.beginPath();
                        for (let x = a; x <= b; x += (b - a) / 40) {
                            const y = (f + (wave ? Math.sin((x - a) / (b - a) * Math.PI * 4) * 0.22 : 0)) * k.R(x);
                            if (x === a) g.moveTo(x, y); else g.lineTo(x, y);
                        }
                    };
                    g.save();
                    g.shadowColor = color;
                    g.shadowBlur = k.r1 * 0.9;
                    path(); g.strokeStyle = color; g.lineWidth = Math.max(1.2 * k.px, k.r1 * 0.26); g.stroke();
                    g.restore();
                    path(); g.strokeStyle = 'rgba(255, 255, 255, 0.85)'; g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.08); g.stroke();
                };
                const [fa, fb] = range(k, 'forearm');
                tube(fa + k.r1, fb - k.r1 * 0.5, -0.45, '#ff4fd8', false);
                tube(fa + k.r1, fb - k.r1 * 0.5, 0.42, '#3ee8ff', true);
                const [sa, sb] = range(k, 'sleeve');
                tube(sa + k.r1 * 0.5, sb - k.r1 * 0.5, 0, '#ff4fd8', true);
                tube(PART.shaft[0] * k.L + k.r1 * 2, PART.shaft[1] * k.L - k.r1, 0.3, '#3ee8ff', false);
                const [wa, wb] = range(k, 'wrap');
                g.fillStyle = 'rgba(255, 79, 216, 0.55)';
                for (let x = wa + k.r1 * 0.4; x < wb; x += k.r1 * 0.9) {
                    [-0.5, 0.5].forEach(function (f, i) { g.beginPath(); g.arc(x + i * k.r1 * 0.45, f * k.R(x), k.r1 * 0.13, 0, Math.PI * 2); g.fill(); });
                }
            }
        },
        laser: {
            tip: '#ff3b30', shaft: '#3a3a42', joint: 'red', trim: 'red',
            forearm: '#16161a', wrap: '#0e0e10', sleeve: '#2c2c33', cap: '#111014',
            paint: function (k) {
                const g = k.g;
                /* the laser's resting line (the pulse is drawn live on top) */
                g.save();
                g.shadowColor = '#ff2a2a';
                g.shadowBlur = k.r1 * 0.6;
                g.strokeStyle = '#d3151c';
                g.lineWidth = Math.max(1 * k.px, k.r0 * 0.4);
                g.beginPath(); g.moveTo(PART.ferrule[1] * k.L, 0); g.lineTo(PART.forearm[1] * k.L, 0); g.stroke();
                g.restore();
                /* circuit traces on the forearm */
                const [fa, fb] = range(k, 'forearm');
                g.strokeStyle = 'rgba(255, 60, 50, 0.55)';
                g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.07);
                for (let i = 0; i < 6; i++) {
                    const x = fa + (fb - fa) * (0.1 + i * 0.15), f = i % 2 ? 0.55 : -0.55;
                    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + k.r1 * 0.8, f * k.R(x)); g.lineTo(x + k.r1 * 2.2, f * k.R(x)); g.stroke();
                    g.fillStyle = '#ff5a4a';
                    g.beginPath(); g.arc(x + k.r1 * 2.2, f * k.R(x), k.r1 * 0.12, 0, Math.PI * 2); g.fill();
                }
                weave(k, '#0e0e10', 'rgba(255, 255, 255, 0.07)', 0.28);
                /* two red eyes on the sleeve */
                const [sa, sb] = range(k, 'sleeve');
                const cx = (sa + sb) / 2;
                g.save();
                g.shadowColor = '#ff2a2a';
                g.shadowBlur = k.r1 * 0.8;
                g.fillStyle = '#ff4a3a';
                [-0.38, 0.38].forEach(function (f) { g.beginPath(); g.ellipse(cx, f * k.R(cx), k.r1 * 0.55, k.r1 * 0.2, 0, 0, Math.PI * 2); g.fill(); });
                g.restore();
            }
        },
        orca: {
            tip: '#2f62c4', shaft: '#f2f2ef', joint: 'silver', trim: 'silver',
            forearm: '#121214', wrap: '#121214', sleeve: '#121214', cap: '#121214',
            paint: function (k) {
                const g = k.g;
                const [fa, fb] = range(k, 'forearm');
                g.fillStyle = '#f6f6f3';
                g.beginPath(); g.ellipse(fa + (fb - fa) * 0.42, -k.R(fb) * 0.32, (fb - fa) * 0.16, k.R(fb) * 0.42, -0.15, 0, Math.PI * 2); g.fill();
                g.beginPath(); g.ellipse(fa + (fb - fa) * 0.82, k.R(fb) * 0.9, (fb - fa) * 0.2, k.R(fb) * 0.45, 0.1, 0, Math.PI * 2); g.fill();
                weave(k, '#121214', 'rgba(255, 255, 255, 0.1)', 0.36);
                /* white belly sweep and the security badge */
                const [sa, sb] = range(k, 'sleeve');
                g.fillStyle = '#f6f6f3';
                g.beginPath(); g.ellipse((sa + sb) / 2, k.R(sb) * 1.05, (sb - sa) * 0.55, k.R(sb) * 0.6, 0, 0, Math.PI * 2); g.fill();
                const cx = sa + (sb - sa) * 0.5, r = k.R(sb) * 0.62, cy = -k.R(sb) * 0.12;
                k.upright(cx, 0, function () {
                g.beginPath();
                g.moveTo(cx - r * 0.8, cy - r * 0.75);
                g.lineTo(cx + r * 0.8, cy - r * 0.75);
                g.lineTo(cx + r * 0.8, cy + r * 0.1);
                g.quadraticCurveTo(cx + r * 0.6, cy + r * 0.8, cx, cy + r);
                g.quadraticCurveTo(cx - r * 0.6, cy + r * 0.8, cx - r * 0.8, cy + r * 0.1);
                g.closePath();
                g.fillStyle = '#f4b740'; g.fill();
                g.strokeStyle = INK; g.lineWidth = Math.max(0.8 * k.px, r * 0.12); g.stroke();
                g.fillStyle = '#121214';
                g.beginPath(); g.arc(cx, cy, r * 0.3, 0, Math.PI * 2); g.fill();
                });
            }
        },
        narwhal: {
            tip: '#2f62c4', shaft: '#efe6d2', joint: 'silver', trim: 'silver',
            forearm: '#e8dcc2', wrap: '#cfd4d6', sleeve: '#e8dcc2', cap: '#c9bfa8',
            paint: function (k) {
                const g = k.g;
                weave(k, '#cfd4d6', 'rgba(80, 90, 100, 0.35)', 0.34);
                /* the tusk's twist, all the way down */
                for (let x = PART.ferrule[1] * k.L + k.r1 * 0.2; x < k.L; x += k.R(x) * 2.3) {
                    const r = k.R(x);
                    g.strokeStyle = 'rgba(140, 115, 70, 0.55)';
                    g.lineWidth = Math.max(0.8 * k.px, r * 0.2);
                    g.beginPath(); g.moveTo(x, -r * 1.1); g.quadraticCurveTo(x + r * 0.5, 0, x + r * 1.7, r * 1.1); g.stroke();
                    g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
                    g.lineWidth = Math.max(0.6 * k.px, r * 0.1);
                    g.beginPath(); g.moveTo(x + r * 0.35, -r * 1.1); g.quadraticCurveTo(x + r * 0.85, 0, x + r * 2.05, r * 1.1); g.stroke();
                }
            }
        },
        kraken: {
            tip: '#7046a8', shaft: MAPLE, joint: 'gold', trim: 'gold',
            forearm: '#4b2a7a', wrap: '#2a1748', sleeve: '#4b2a7a', cap: '#2a1748',
            paint: function (k) {
                const g = k.g;
                /* scales on the forearm and sleeve */
                [range(k, 'forearm'), range(k, 'sleeve')].forEach(function (r) {
                    g.strokeStyle = 'rgba(190, 150, 240, 0.35)';
                    g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.06);
                    for (let x = r[0]; x < r[1]; x += k.r1 * 0.8) {
                        for (let y = -k.r1, j = 0; y < k.r1; y += k.r1 * 0.55, j++) {
                            g.beginPath(); g.arc(x + (j % 2) * k.r1 * 0.4, y, k.r1 * 0.32, 0.2, Math.PI - 0.2); g.stroke();
                        }
                    }
                });
                /* tentacles with suckers wrapping the grip */
                const [wa, wb] = range(k, 'wrap');
                [0, Math.PI].forEach(function (phase, n) {
                    const path = function () {
                        g.beginPath();
                        for (let x = wa - k.r1; x <= wb + k.r1; x += (wb - wa) / 40) {
                            const y = Math.sin((x - wa) / (wb - wa) * Math.PI * 3 + phase) * k.R(x) * 0.62;
                            if (x === wa - k.r1) g.moveTo(x, y); else g.lineTo(x, y);
                        }
                    };
                    path(); g.strokeStyle = INK; g.lineWidth = k.r1 * 0.62; g.stroke();
                    path(); g.strokeStyle = n ? '#8c5ac8' : '#a77ae0'; g.lineWidth = k.r1 * 0.46; g.stroke();
                    g.fillStyle = '#f2c6d6';
                    for (let x = wa; x <= wb; x += k.r1 * 0.55) {
                        const y = Math.sin((x - wa) / (wb - wa) * Math.PI * 3 + phase) * k.R(x) * 0.62;
                        g.beginPath(); g.arc(x, y + k.r1 * 0.1, k.r1 * 0.11, 0, Math.PI * 2); g.fill();
                    }
                });
            }
        },
        golden: {
            tip: '#2f62c4', shaft: '#f0c24e', joint: 'gold', trim: 'black',
            forearm: '#e8b43a', wrap: '#d9a21c', sleeve: '#e8b43a', cap: '#c48a1a',
            paint: function (k) {
                const g = k.g;
                weave(k, '#d9a21c', 'rgba(110, 70, 5, 0.45)', 0.3);
                /* an engraved whale tail on the forearm */
                const [fa, fb] = range(k, 'forearm');
                const cx = fa + (fb - fa) * 0.55, r = k.R(cx);
                g.strokeStyle = 'rgba(110, 66, 4, 0.85)';
                g.lineWidth = Math.max(0.8 * k.px, r * 0.1);
                g.lineJoin = 'round';
                g.beginPath();
                g.moveTo(cx - r * 2.6, 0);
                g.quadraticCurveTo(cx - r * 0.8, 0, cx, -r * 0.05);
                g.quadraticCurveTo(cx + r * 0.9, -r * 0.2, cx + r * 1.5, -r * 0.82);
                g.quadraticCurveTo(cx + r * 1.15, -r * 0.1, cx + r * 0.55, 0);
                g.quadraticCurveTo(cx + r * 1.15, r * 0.1, cx + r * 1.5, r * 0.82);
                g.quadraticCurveTo(cx + r * 0.9, r * 0.2, cx, r * 0.05);
                g.stroke();
                /* scrollwork either side, and on the sleeve */
                [[fa + (fb - fa) * 0.18, 1], [fa + (fb - fa) * 0.9, -1]].concat([[PART.sleeve[0] * k.L + (PART.sleeve[1] - PART.sleeve[0]) * k.L * 0.5, 1]]).forEach(function (p) {
                    const x = p[0], rr = k.R(x) * 0.45;
                    g.beginPath(); g.arc(x, -rr * 0.6, rr * 0.55, Math.PI * 0.5, Math.PI * 2.2); g.stroke();
                    g.beginPath(); g.arc(x + rr * 0.9 * p[1], rr * 0.6, rr * 0.55, -Math.PI * 0.5, Math.PI * 1.2); g.stroke();
                });
            }
        },
        wealthy: {
            tip: '#2f62c4', shaft: '#26222c', joint: 'gold', trim: 'gold',
            forearm: '#121016', wrap: '#0d0b10', sleeve: '#121016', cap: '#121016', hat: true,
            paint: function (k) {
                const g = k.g;
                /* gold pinstripes on the grip */
                const [wa, wb] = range(k, 'wrap');
                g.fillStyle = '#0d0b10';
                g.fillRect(wa, -k.r1 * 1.4, wb - wa, k.r1 * 2.8);
                g.strokeStyle = 'rgba(244, 183, 64, 0.6)';
                g.lineWidth = Math.max(0.6 * k.px, k.r1 * 0.06);
                for (let x = wa + k.r1 * 0.4; x < wb; x += k.r1 * 0.75) { g.beginPath(); g.moveTo(x, -k.r1 * 1.3); g.lineTo(x, k.r1 * 1.3); g.stroke(); }
                /* diamond inlays */
                [range(k, 'forearm'), range(k, 'sleeve')].forEach(function (r) {
                    for (let x = r[0] + k.r1 * 0.9, i = 0; x < r[1] - k.r1 * 0.4; x += k.r1 * 1.35, i++) {
                        const y = (i % 2 ? 0.38 : -0.38) * k.R(x), d = k.r1 * 0.36;
                        const gr = g.createLinearGradient(x - d, y - d, x + d, y + d);
                        gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.5, '#bfe8ff'); gr.addColorStop(1, '#6fa8d8');
                        g.fillStyle = gr;
                        g.beginPath(); g.moveTo(x, y - d); g.lineTo(x + d * 0.75, y); g.lineTo(x, y + d); g.lineTo(x - d * 0.75, y); g.closePath(); g.fill();
                        g.strokeStyle = 'rgba(244, 183, 64, 0.85)'; g.lineWidth = Math.max(0.5 * k.px, d * 0.14); g.stroke();
                    }
                });
            }
        },
        staff: {
            shaft: '#e0a21c', joint: 'purple', trim: 'gold', forearm: '#d39a2a', wrap: '#b9790f', sleeve: '#d39a2a', cap: GOLD,
            headLen: 7.8, head: staffHead,
            paint: function (k) {
                const g = k.g;
                g.strokeStyle = 'rgba(120, 70, 5, 0.5)';
                g.lineWidth = k.r1 * 0.16;
                for (let x = k.x0 + k.r1; x < 0.97 * k.L; x += k.r1 * 3.2) { g.beginPath(); g.moveTo(x, -k.r1 * 1.2); g.lineTo(x + k.r1 * 2.4, k.r1 * 1.2); g.stroke(); }
                weave(k, '#b9790f', 'rgba(90, 50, 0, 0.5)', 0.4);
                [range(k, 'forearm'), range(k, 'sleeve')].forEach(function (r) {
                    for (let x = r[0] + k.r1 * 1.2; x < r[1] - k.r1 * 0.5; x += k.r1 * 2.2) {
                        g.save(); g.shadowColor = 'rgba(186, 120, 255, 0.9)'; g.shadowBlur = k.r1 * 0.6;
                        g.fillStyle = '#8a4cc9'; g.beginPath(); g.arc(x, 0, k.R(x) * 0.36, 0, Math.PI * 2); g.fill();
                        g.restore();
                    }
                });
            }
        },
        trident: {
            shaft: '#e8ad2c', joint: 'purple', trim: 'gold', forearm: '#e0a21c', wrap: '#4aa3df', sleeve: '#c48a1a', cap: GOLD,
            headLen: 7.6, head: tridentHead,
            paint: function (k) {
                const g = k.g;
                /* the blue fin grip of the whale that holds it */
                const [wa, wb] = range(k, 'wrap');
                g.strokeStyle = 'rgba(29, 27, 32, 0.35)';
                g.lineWidth = k.r1 * 0.15;
                for (let x = wa; x < wb; x += k.r1 * 0.55) { g.beginPath(); g.moveTo(x, -k.r1 * 1.2); g.lineTo(x + k.r1 * 0.4, k.r1 * 1.2); g.stroke(); }
                const [fa, fb] = range(k, 'forearm');
                points(k, '#b9790f', '#ffe39a', 2);
                stripe(k, fa + (fb - fa) * 0.9, fa + (fb - fa) * 0.93, '#6b3fb0');
            }
        }
    };

    /* the soft glow an Epic cue sits in */
    const EPIC_GLOW = { laser: 'rgba(255, 50, 40, 0.9)', orca: 'rgba(120, 205, 255, 0.85)', narwhal: 'rgba(190, 232, 255, 0.95)', kraken: 'rgba(176, 122, 255, 0.95)' };

    function rarityOf(id) {
        const C = window.WhalePoolCues;
        const cue = C && C.get ? C.get(id) : null;
        return cue && cue.id === id ? cue.rarity : (id === 'house' ? 'common' : 'rare');
    }

    /* ---------- painting one cue into a cached image ---------- */

    function paintCue(id, L, r0, r1, px, variant) {
        const d = DESIGNS[id] || DESIGNS.house;
        const rarity = rarityOf(id);
        const glow = rarity === 'epic';
        const s = r1;
        const reachY = (d.head ? 3.6 : (d.hat ? 1.6 : 1.25)) * s;
        const pad = Math.ceil((glow ? 1.6 * s : 0.6 * s) + 3 * px);
        const padR = Math.ceil(pad + (d.hat ? 2.2 * s : 0.3 * s));
        const W = Math.ceil(L + pad + padR), H = Math.ceil(2 * (reachY + pad));
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const g = canvas.getContext('2d');
        const ox = pad, oy = H / 2;
        g.translate(ox, oy);
        const x0 = d.headLen ? d.headLen * s : 0;
        const k = { g: g, L: L, r0: r0, r1: r1, R: radiusAt(L, r0, r1), px: px, x0: x0 };
        /* text and emblems stay the right way up on screen, whichever way the cue points */
        k.upright = function (cx, cy, fn) {
            if (variant !== 1) { fn(); return; }
            g.save(); g.translate(cx, cy); g.rotate(Math.PI); g.translate(-cx, -cy); fn(); g.restore();
        };

        /* an Epic cue's glow sits behind it */
        if (glow) {
            g.save();
            g.shadowColor = EPIC_GLOW[id] || 'rgba(171, 154, 191, 0.9)';
            g.shadowBlur = 1.4 * s;
            profile(g, L, r0, r1, x0);
            g.fillStyle = EPIC_GLOW[id] || '#ab9abf';
            g.fill();
            g.restore();
        }

        g.save();
        profile(g, L, r0, r1, x0);
        g.clip();
        if (!d.head) {
            fillPart(k, 'tip', d.tip);
            fillPart(k, 'ferrule', '#f6efdf');
        }
        fillPart(k, 'shaft', d.shaft);
        fillPart(k, 'forearm', d.forearm);
        fillPart(k, 'wrap', d.wrap);
        fillPart(k, 'sleeve', d.sleeve);
        fillPart(k, 'cap', d.cap);
        if (d.paint) d.paint(k);
        metalPart(k, 'joint', d.joint);
        metalPart(k, 'trim1', d.trim);
        metalPart(k, 'trim2', d.trim);
        if (d.joint === 'ember') {
            /* the ember glows out from its ring */
            const p = PART.joint;
            g.save();
            g.globalCompositeOperation = 'lighter';
            const gr = g.createRadialGradient((p[0] + p[1]) / 2 * L, 0, 0, (p[0] + p[1]) / 2 * L, 0, s * 2.2);
            gr.addColorStop(0, 'rgba(255, 140, 40, 0.65)');
            gr.addColorStop(1, 'rgba(255, 80, 0, 0)');
            g.fillStyle = gr;
            g.fillRect((p[0] - 0.05) * L, -s * 1.4, 0.12 * L, s * 2.8);
            g.restore();
        }
        shade(k, variant, rarity);
        g.restore();

        if (d.joint === 'ember') {
            /* a little ember glow spills past the outline */
            const p = PART.joint;
            g.save();
            g.shadowColor = 'rgba(255, 110, 20, 0.95)';
            g.shadowBlur = s * 1.2;
            g.fillStyle = 'rgba(255, 120, 30, 0.35)';
            g.fillRect(p[0] * L, -k.R(p[1] * L) * 1.1, (p[1] - p[0]) * L, k.R(p[1] * L) * 2.2);
            g.restore();
        }

        /* the ink outline */
        profile(g, L, r0, r1, x0);
        g.lineJoin = 'round';
        g.lineWidth = Math.max(1.2 * px, s * 0.13);
        g.strokeStyle = INK;
        g.stroke();
        /* part lines, faintly inked */
        g.strokeStyle = 'rgba(29, 27, 32, 0.45)';
        g.lineWidth = Math.max(0.6 * px, s * 0.06);
        ['ferrule', 'shaft', 'forearm', 'wrap', 'sleeve', 'cap'].forEach(function (p) {
            const x = PART[p][0] * L;
            if (x <= x0 + 1) return;
            const r = k.R(x);
            g.beginPath(); g.moveTo(x, -r); g.lineTo(x, r); g.stroke();
        });

        if (d.head) d.head(g, s, px);
        if (d.hat) topHat(g, L, s, px);

        /* its soft shadow, painted once alongside */
        const shadow = document.createElement('canvas');
        shadow.width = W;
        shadow.height = H;
        const sg = shadow.getContext('2d');
        sg.shadowColor = 'rgba(8, 38, 30, 0.42)';
        sg.shadowBlur = Math.max(2 * px, s * 0.9);
        sg.shadowOffsetX = W * 2;
        sg.drawImage(canvas, -W * 2, 0);

        return { canvas: canvas, shadow: shadow, ox: ox, oy: oy, L: L, W: W, H: H, x0: x0 };
    }

    const cache = new Map();
    const CACHE_MAX = 60;

    function cached(id, len, r0, r1, px, variant) {
        const L = Math.max(24, Math.round(len / 6) * 6);
        const key = id + '|' + L + '|' + r0.toFixed(1) + '|' + r1.toFixed(1) + '|' + px + '|' + variant;
        let item = cache.get(key);
        if (item) {
            cache.delete(key);
            cache.set(key, item);
            return item;
        }
        item = paintCue(id, L, r0, r1, px, variant);
        cache.set(key, item);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        return item;
    }

    /* ---------- the live touches ---------- */

    const LIVE = { laser: true };
    function animated(id) {
        if (reducedMotion()) return false;
        return !!LIVE[id] || rarityOf(id) === 'legendary';
    }

    function sparkle(g, x, y, r, a) {
        g.save();
        g.globalAlpha = a;
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
        g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r);
        g.fill();
        g.globalAlpha = a * 0.6;
        g.beginPath(); g.arc(x, y, r * 0.28, 0, Math.PI * 2); g.fill();
        g.restore();
    }

    function liveTouches(g, id, item, r0, r1, px, variant, time) {
        const rarity = rarityOf(id);
        const still = reducedMotion() || time === undefined;
        const L = item.L;
        const R = radiusAt(L, r0, r1);
        if (id === 'laser') {
            const pulse = still ? 0.45 : 0.5 + 0.5 * Math.sin(time / 520);
            g.save();
            g.globalCompositeOperation = 'lighter';
            g.shadowColor = '#ff2020';
            g.shadowBlur = r1 * (0.6 + 1.4 * pulse);
            g.strokeStyle = 'rgba(255, ' + Math.round(70 + 120 * pulse) + ', ' + Math.round(60 + 100 * pulse) + ', ' + (0.35 + 0.6 * pulse) + ')';
            g.lineWidth = Math.max(1 * px, r0 * (0.28 + 0.25 * pulse));
            g.beginPath(); g.moveTo(PART.ferrule[1] * L, 0); g.lineTo(PART.forearm[1] * L, 0); g.stroke();
            g.restore();
        }
        if (rarity === 'legendary') {
            const flip = variant === 1 ? -1 : 1;
            if (!still) {
                /* a slow shimmer sweeping down the cue */
                const phase = (time % 3600) / 3600;
                const xc = -0.25 * L + 1.5 * L * phase;
                g.save();
                profile(g, L, r0, r1, item.x0);
                g.clip();
                const gr = g.createLinearGradient(xc - r1 * 3, -r1 * flip, xc + r1 * 3, r1 * flip);
                gr.addColorStop(0, 'rgba(255, 255, 255, 0)');
                gr.addColorStop(0.5, 'rgba(255, 252, 230, 0.6)');
                gr.addColorStop(1, 'rgba(255, 255, 255, 0)');
                g.fillStyle = gr;
                g.fillRect(xc - r1 * 4, -r1 * 1.5, r1 * 8, r1 * 3);
                g.restore();
            }
            /* a few sparkles */
            const spots = [[0.2, -0.55], [0.58, -0.45], [0.78, 0.35], [0.93, -0.4]];
            spots.forEach(function (p, i) {
                const x = Math.max(item.x0 + r1, p[0] * L);
                const a = still ? 0.55 : Math.pow(Math.max(0, Math.sin(time / 480 + i * 1.9)), 4);
                if (a > 0.02) sparkle(g, x, p[1] * flip * R(x), r1 * 0.75, a);
            });
        }
    }

    /* ---------- the one entry point ----------
       Draws cue `id` with its tip at (x, y), lying along `angle` (the
       direction from the tip to the butt), `len` long, half widths w0 at
       the tip and w1 at the butt (canvas pixels). opts: px (pixels per
       CSS pixel), shadow: [dx, dy] in canvas pixels, time: ms for the
       live touches (leave it out for a still picture). */
    function draw(c, id, x, y, angle, len, w0, w1, opts) {
        opts = opts || {};
        const px = opts.px || 1;
        /* keep the shine on the side facing up on screen */
        const variant = Math.cos(angle) >= 0 ? 0 : 1;
        const item = cached(id, len, w0, w1, px, variant);
        const sx = len / item.L;
        if (opts.shadow) {
            c.save();
            c.translate(x + opts.shadow[0], y + opts.shadow[1]);
            c.rotate(angle);
            c.scale(sx, 1);
            c.drawImage(item.shadow, -item.ox, -item.oy);
            c.restore();
        }
        c.save();
        c.translate(x, y);
        c.rotate(angle);
        c.scale(sx, 1);
        c.drawImage(item.canvas, -item.ox, -item.oy);
        if (DESIGNS[id] && (LIVE[id] || rarityOf(id) === 'legendary')) liveTouches(c, id, item, w0, w1, px, variant, opts.time);
        c.restore();
    }

    window.WhalePoolCueArt = { draw: draw, animated: animated, reducedMotion: reducedMotion, ids: Object.keys(DESIGNS) };
})();
