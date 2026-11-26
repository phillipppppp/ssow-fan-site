/* ============================================================
   Whale Pool — the table, the balls and the rules (WhalePoolSim)

   Everything that decides a shot lives here, and nothing here
   draws anything. The page animates a shot by stepping the very
   same simulation, so what you see is exactly what the rules
   judge. The same file runs in Node for the tests (and later on
   the server, which will replay online shots to referee them).

   Determinism: a shot is decided only by the table, the shot
   input and these rules. The simulation sticks to + - * / and
   Math.sqrt (exactly rounded everywhere), never sin/cos/pow/exp/
   hypot, whose last digits differ between browsers. Inputs are
   rounded on the way in (cleanInput), so a replayed shot is the
   same shot on every machine.

   Units: the playing surface is 1000 x 500 (a 7-foot table, so
   one unit is about 2 mm), balls have radius 14. x runs to the
   right, y runs DOWN (screen style). The head string (break
   side) is on the left, the foot spot on the right.

   Physics, in short:
     - a ball slides until its spin matches its speed, then rolls
       (that is what makes draw, follow and stun work);
     - ball-ball hits are near-elastic, with no spin transfer;
     - cushions bounce at 0.78 and side spin (english) changes
       the rebound angle;
     - pockets have angled jaws that can rattle a ball out; a ball
       is down once its centre is past the cushion line.
   Collisions are found exactly within each 2 ms step (time of
   impact), so aim lines and the physics agree.

   Rules (WPA-flavoured, app-simple):
     8-ball  open table after the break; your first legal pot picks
             solids or stripes; clear them, then call a pocket for
             the 8. Potting the 8 early, in the wrong pocket or
             with a foul loses. 8 on the break is re-spotted.
     9-ball  hit the lowest ball first; anything that drops on a
             legal shot keeps you at the table; the 9 wins, even on
             the break or in a combination.
     10-ball like 9-ball, but every shot after the break is called
             (ball and pocket). Only the called ball in the called
             pocket keeps you shooting; the 10 only wins when
             called; otherwise it comes back up.
     Fouls (all games): scratch, missing everything, hitting the
     wrong ball first, or no ball reaching a cushion after contact
     (when nothing drops). A foul gives the other player the cue
     ball in hand, anywhere.
   ============================================================ */

(function (root) {
    'use strict';

    const VERSION = 1;

    /* ---------- the table ---------- */

    const W = 1000;
    const H = 500;
    const R = 14;                  // ball radius
    const D = 2 * R;
    const CORNER = 47;             // nose distance from each corner along the rails (mouth ~2.4 balls, app-friendly)
    const SIDE = 34;               // half the side-pocket mouth (~2.4 balls)
    const JAW = 22;                // how far the jaws reach into the pocket
    const HEAD_X = W / 4;          // break from behind this line
    const FOOT_X = W * 3 / 4;      // the rack's apex sits here
    const MID_Y = H / 2;
    const POT_M = -0.5;            // a ball is down once its centre reaches a cushion line (only possible in a pocket)
    const DROP = CORNER / 2;       // ...or is this deep into a corner pocket's mouth (over the hole)

    /* the cushions and the pocket jaws, as line segments */
    const SEGS = [];
    function seg(ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        const len = Math.sqrt(dx * dx + dy * dy);
        const ux = dx / len, uy = dy / len;
        SEGS.push({ ax: ax, ay: ay, bx: bx, by: by, len: len, ux: ux, uy: uy, nx: -uy, ny: ux });
    }
    /* rails */
    seg(CORNER, 0, W / 2 - SIDE, 0);
    seg(W / 2 + SIDE, 0, W - CORNER, 0);
    seg(CORNER, H, W / 2 - SIDE, H);
    seg(W / 2 + SIDE, H, W - CORNER, H);
    seg(0, CORNER, 0, H - CORNER);
    seg(W, CORNER, W, H - CORNER);
    /* corner jaws: from each nose, back into the pocket, narrowing a little */
    const CJ = 25;
    seg(CORNER, 0, CORNER - CJ, -JAW);            seg(0, CORNER, -JAW, CORNER - CJ);
    seg(W - CORNER, 0, W - CORNER + CJ, -JAW);    seg(W, CORNER, W + JAW, CORNER - CJ);
    seg(CORNER, H, CORNER - CJ, H + JAW);         seg(0, H - CORNER, -JAW, H - CORNER + CJ);
    seg(W - CORNER, H, W - CORNER + CJ, H + JAW); seg(W, H - CORNER, W + JAW, H - CORNER + CJ);
    /* side jaws */
    const SJ = 6;
    seg(W / 2 - SIDE, 0, W / 2 - SIDE + SJ, -JAW); seg(W / 2 + SIDE, 0, W / 2 + SIDE - SJ, -JAW);
    seg(W / 2 - SIDE, H, W / 2 - SIDE + SJ, H + JAW); seg(W / 2 + SIDE, H, W / 2 + SIDE - SJ, H + JAW);

    /* pockets: 0 top-left, 1 top-middle, 2 top-right, 3 bottom-left,
       4 bottom-middle, 5 bottom-right. (x, y) is where the hole is
       drawn; (ax, ay) is the spot to send a ball at. */
    const POCKETS = [
        { x: -13, y: -13, r: 29, ax: 3, ay: 3 },
        { x: W / 2, y: -20, r: 26, ax: W / 2, ay: -3 },
        { x: W + 13, y: -13, r: 29, ax: W - 3, ay: 3 },
        { x: -13, y: H + 13, r: 29, ax: 3, ay: H - 3 },
        { x: W / 2, y: H + 20, r: 26, ax: W / 2, ay: H + 3 },
        { x: W + 13, y: H + 13, r: 29, ax: W - 3, ay: H - 3 }
    ];

    /* ---------- the cloth and the cue ---------- */

    const G = 4806;                // gravity, units/s^2
    const MU_SLIDE = 0.16;         // cloth friction while a ball skids (a bit under real cloth, so spin carries)
    const MU_ROLL = 0.02;          // rolling resistance (a touch faster than real cloth, so shots settle snappily)
    const SPIN_DECAY = 260;        // side spin fades (surface speed, units/s^2)
    const E_BALL = 0.95;
    const E_RAIL = 0.78;
    const MU_RAIL = 0.2;
    const RAIL_ROLL = 0.85;        // how much of its roll a ball keeps (reversed) off a cushion
    const DT = 1 / 500;            // one physics step, seconds
    const MAX_TIME = 45;           // a shot never runs longer than this
    const V_MAX = 4300;            // full power, units/s (~8.8 m/s, a hard break)
    const TIP = 0.6;               // the cue tip reaches 0.6 of a radius off centre

    /* the cue's power curve: soft shots get fine control */
    function speedFor(power) { return V_MAX * (0.25 * power + 0.75 * power * power); }

    /* ---------- a small seeded random, for racks only ---------- */

    function rng(seed) {
        let a = (seed >>> 0) || 1;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }
    function shuffle(list, rand) {
        for (let i = list.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = list[i]; list[i] = list[j]; list[j] = t;
        }
        return list;
    }

    /* ---------- racks ---------- */

    const MODES = {
        '8':  { name: '8-Ball',  balls: 15, money: 8 },
        '9':  { name: '9-Ball',  balls: 9,  money: 9 },
        '10': { name: '10-Ball', balls: 10, money: 10 }
    };

    /* rack spots, row by row from the apex toward the foot rail */
    function rackSpots(rows, rand) {
        const gap = 0.05;          // a tight rack breaks well
        const dx = (D + gap) * 0.8660254037844386;   // cos 30
        const out = [];
        rows.forEach(function (n, r) {
            for (let k = 0; k < n; k++) {
                const jx = (rand() - 0.5) * 0.04, jy = (rand() - 0.5) * 0.04;   // a hair of wobble, never an overlap
                out.push({ row: r, k: k, n: n, x: FOOT_X + r * dx + jx, y: MID_Y + (k - (n - 1) / 2) * (D + gap) + jy });
            }
        });
        return out;
    }

    function rack(mode, rand) {
        if (mode === '8') {
            const spots = rackSpots([1, 2, 3, 4, 5], rand);
            const at = new Array(15);
            const middle = spots.findIndex(function (s) { return s.row === 2 && s.k === 1; });
            const back = spots.map(function (s, i) { return s.row === 4 && (s.k === 0 || s.k === 4) ? i : -1; }).filter(function (i) { return i >= 0; });
            at[middle] = 8;
            const solids = shuffle([1, 2, 3, 4, 5, 6, 7], rand);
            const stripes = shuffle([9, 10, 11, 12, 13, 14, 15], rand);
            /* one of each in the back corners */
            const flip = rand() < 0.5;
            at[back[0]] = flip ? solids.pop() : stripes.pop();
            at[back[1]] = flip ? stripes.pop() : solids.pop();
            const rest = shuffle(solids.concat(stripes), rand);
            for (let i = 0; i < 15; i++) if (at[i] === undefined) at[i] = rest.pop();
            return spots.map(function (s, i) { return [at[i], s.x, s.y]; });
        }
        if (mode === '9') {
            const spots = rackSpots([1, 2, 3, 2, 1], rand);
            const rest = shuffle([2, 3, 4, 5, 6, 7, 8], rand);
            return spots.map(function (s) {
                const n = s.row === 0 ? 1 : (s.row === 2 && s.k === 1 ? 9 : rest.pop());
                return [n, s.x, s.y];
            });
        }
        const spots = rackSpots([1, 2, 3, 4], rand);
        const rest = shuffle([2, 3, 4, 5, 6, 7, 8, 9], rand);
        return spots.map(function (s) {
            const n = s.row === 0 ? 1 : (s.row === 2 && s.k === 1 ? 10 : rest.pop());
            return [n, s.x, s.y];
        });
    }

    function newGame(mode, seed) {
        mode = String(mode);
        if (!MODES[mode]) throw new Error('unknown game: ' + mode);
        seed = (Number(seed) >>> 0) || 1;
        return {
            v: VERSION,
            mode: mode,
            seed: seed,
            balls: rack(mode, rng(seed)).map(function (b) { return [b[0], round(b[1]), round(b[2])]; }),
            cue: [HEAD_X - 60, MID_Y],        // where the cue ball waits for the break (in hand behind the line)
            turn: 0,
            groups: [null, null],            // 8-ball: 'solids' | 'stripes'
            broke: false,
            inHand: 'kitchen',               // 'kitchen' | 'any' | null
            shots: 0,
            over: false,
            winner: null,
            reason: ''
        };
    }

    function round(v) { return Math.round(v * 1000) / 1000; }

    /* ---------- what the shooter has to do ---------- */

    function groupOf(n) { return n >= 1 && n <= 7 ? 'solids' : (n >= 9 && n <= 15 ? 'stripes' : null); }
    function onTable(state, n) { return state.balls.some(function (b) { return b[0] === n; }); }
    function lowest(state) {
        let lo = null;
        state.balls.forEach(function (b) { if (b[0] > 0 && (lo === null || b[0] < lo)) lo = b[0]; });
        return lo;
    }
    function left(state, group) {
        return state.balls.filter(function (b) { return groupOf(b[0]) === group; }).length;
    }

    /* which balls the shooter may hit first */
    function targets(state) {
        if (state.mode !== '8') { const lo = lowest(state); return lo === null ? [] : [lo]; }
        const mine = state.groups[state.turn];
        const balls = state.balls.map(function (b) { return b[0]; }).filter(function (n) { return n > 0; });
        if (!mine) return balls.filter(function (n) { return n !== 8; });
        const own = balls.filter(function (n) { return groupOf(n) === mine; });
        return own.length ? own : [8];
    }

    /* what has to be called before this shot */
    function needsCall(state) {
        if (state.over || !state.broke) return null;
        if (state.mode === '10') return 'ball';
        if (state.mode === '8' && state.groups[state.turn] && left(state, state.groups[state.turn]) === 0) return 'pocket';
        return null;
    }

    function canPlace(state, x, y) {
        if (!state.inHand) return false;
        if (!(x >= R && x <= W - R && y >= R && y <= H - R)) return false;
        if (state.inHand === 'kitchen' && x > HEAD_X) return false;
        return state.balls.every(function (b) {
            const dx = b[1] - x, dy = b[2] - y;
            return dx * dx + dy * dy >= (D + 0.01) * (D + 0.01);
        });
    }

    /* ---------- shot input ---------- */

    function q(v, step) { return Math.round(v / step) * step; }

    /* Rounds and checks a shot so a replay is bit-for-bit the same.
       dir: [dx, dy] (any length), power 0..1, spin [side, top] inside
       the unit circle (right english +, follow +), cue [x, y] when the
       ball is in hand, call {ball, pocket} when the game needs one. */
    function cleanInput(state, input) {
        if (!input || !Array.isArray(input.dir)) throw new Error('no aim');
        let dx = q(Number(input.dir[0]) || 0, 1e-6), dy = q(Number(input.dir[1]) || 0, 1e-6);
        const len = Math.sqrt(dx * dx + dy * dy);
        if (!(len > 1e-4)) throw new Error('no aim');
        dx /= len; dy /= len;
        const power = Math.min(1, Math.max(0.02, q(Number(input.power) || 0, 0.001)));
        let sa = 0, sb = 0;
        if (Array.isArray(input.spin)) {
            sa = q(Math.min(1, Math.max(-1, Number(input.spin[0]) || 0)), 0.01);
            sb = q(Math.min(1, Math.max(-1, Number(input.spin[1]) || 0)), 0.01);
            const s2 = sa * sa + sb * sb;
            if (s2 > 1) {
                /* pull it back inside the circle (truncating toward the centre) */
                const k = 1 / Math.sqrt(s2);
                sa = Math.trunc(sa * k * 100) / 100;
                sb = Math.trunc(sb * k * 100) / 100;
            }
        }
        const out = { dir: [dx, dy], power: power, spin: [sa, sb] };
        if (state.inHand && Array.isArray(input.cue)) {
            const cx = q(Number(input.cue[0]), 0.01), cy = q(Number(input.cue[1]), 0.01);
            if (!canPlace(state, cx, cy)) throw new Error('the cue ball can’t go there');
            out.cue = [cx, cy];
        } else if (!state.cue) {
            throw new Error('place the cue ball first');
        }
        const need = needsCall(state);
        if (need && input.call) {
            const pocket = Number(input.call.pocket);
            const ball = need === 'pocket' ? 8 : Number(input.call.ball);
            if (Number.isInteger(pocket) && pocket >= 0 && pocket < 6 && onTable(state, ball)) out.call = { ball: ball, pocket: pocket };
        }
        return out;
    }

    /* ---------- the physics ---------- */

    function makeBall(n, x, y) { return { n: n, x: x, y: y, vx: 0, vy: 0, rx: 0, ry: 0, sz: 0, on: true }; }

    /* A shot in progress. The page calls step() to animate it; the
       rules read firstHit / railAfter / potted when it's done. */
    function begin(state, rawInput) {
        if (state.over) throw new Error('the game is over');
        const input = cleanInput(state, rawInput);
        const cue = input.cue || state.cue;
        const balls = [makeBall(0, cue[0], cue[1])].concat(state.balls.map(function (b) { return makeBall(b[0], b[1], b[2]); }));
        const c = balls[0];
        const V = speedFor(input.power);
        const dx = input.dir[0], dy = input.dir[1];
        c.vx = V * dx; c.vy = V * dy;
        /* follow / draw: the spin's own "rolling velocity", along the aim */
        const top = 2.5 * TIP * input.spin[1] * V;
        c.rx = top * dx; c.ry = top * dy;
        /* english: right of centre spins the ball anticlockwise seen from above */
        c.sz = -2.5 * TIP * input.spin[0] * V;
        return {
            input: input,
            balls: balls,
            time: 0,
            steps: 0,
            done: false,
            firstHit: null,
            railAfter: false,
            railBefore: 0,
            potted: [],
            log: [{ t: 0, kind: 'cue', speed: V }]
        };
    }

    function ballTOI(a, b, left) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const wx = b.vx - a.vx, wy = b.vy - a.vy;
        const bb = dx * wx + dy * wy;
        if (bb >= 0) return -1;                         // not closing
        const cc = dx * dx + dy * dy - D * D;
        if (cc <= 0) return 0;                          // touching already
        const aa = wx * wx + wy * wy;
        /* broad phase: can they even meet within this step? */
        if (cc > 0 && bb * bb < aa * cc) return -1;
        const t = (-bb - Math.sqrt(bb * bb - aa * cc)) / aa;
        return t <= left ? Math.max(0, t) : -1;
    }

    function pointTOI(b, px, py, left) {
        const dx = b.x - px, dy = b.y - py;
        const bb = dx * b.vx + dy * b.vy;
        if (bb >= 0) return -1;
        const cc = dx * dx + dy * dy - R * R;
        if (cc <= 0) return 0;
        const aa = b.vx * b.vx + b.vy * b.vy;
        const disc = bb * bb - aa * cc;
        if (disc < 0) return -1;
        const t = (-bb - Math.sqrt(disc)) / aa;
        return t <= left ? Math.max(0, t) : -1;
    }

    function segTOI(b, s, left) {
        let best = -1;
        const px = b.x - s.ax, py = b.y - s.ay;
        const along = px * s.ux + py * s.uy;
        const off = px * s.nx + py * s.ny;
        const vn = b.vx * s.nx + b.vy * s.ny;
        const va = b.vx * s.ux + b.vy * s.uy;
        let t = -1;
        if (off >= 0 && vn < 0) t = (off - R) / -vn;
        else if (off < 0 && vn > 0) t = (-off - R) / vn;
        if (t !== -1) {
            if (t < 0) t = (off < R && off > -R) ? 0 : -1;
            if (t >= 0 && t <= left) {
                const a = along + va * t;
                if (a >= 0 && a <= s.len) best = t;
            }
        }
        const ta = pointTOI(b, s.ax, s.ay, left);
        if (ta >= 0 && (best < 0 || ta < best)) best = ta;
        const tb = pointTOI(b, s.bx, s.by, left);
        if (tb >= 0 && (best < 0 || tb < best)) best = tb;
        return best;
    }

    function nextEvent(run, left) {
        const balls = run.balls;
        let best = null;
        for (let i = 0; i < balls.length; i++) {
            const a = balls[i];
            if (!a.on) continue;
            const am = a.vx !== 0 || a.vy !== 0;
            for (let j = i + 1; j < balls.length; j++) {
                const b = balls[j];
                if (!b.on) continue;
                if (!am && b.vx === 0 && b.vy === 0) continue;
                const t = ballTOI(a, b, left);
                if (t >= 0 && (!best || t < best.t)) best = { t: t, i: i, j: j };
            }
            if (!am) continue;
            /* cushions only matter near the edge */
            const reach = (Math.abs(a.vx) + Math.abs(a.vy)) * left + R + 2;
            if (a.x > reach + 2 && a.x < W - reach - 2 && a.y > reach + 2 && a.y < H - reach - 2) continue;
            for (let k = 0; k < SEGS.length; k++) {
                const t = segTOI(a, SEGS[k], left);
                if (t >= 0 && (!best || t < best.t)) best = { t: t, i: i, s: k };
            }
        }
        return best;
    }

    function move(run, dt) {
        const balls = run.balls;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b.on || (b.vx === 0 && b.vy === 0)) continue;
            b.x += b.vx * dt;
            b.y += b.vy * dt;
        }
    }

    function hitBalls(run, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const nx = dx / d, ny = dy / d;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel <= 0) return;
        const j = (1 + E_BALL) / 2 * rel;
        a.vx -= j * nx; a.vy -= j * ny;
        b.vx += j * nx; b.vy += j * ny;
        if (run.firstHit === null && (a.n === 0 || b.n === 0)) run.firstHit = a.n === 0 ? b.n : a.n;
        run.log.push({ t: run.time, kind: 'ball', a: a.n, b: b.n, speed: rel });
    }

    function hitRail(run, b, s) {
        /* closest point on the segment */
        const px = b.x - s.ax, py = b.y - s.ay;
        const along = Math.min(s.len, Math.max(0, px * s.ux + py * s.uy));
        const cx = s.ax + s.ux * along, cy = s.ay + s.uy * along;
        let nx = b.x - cx, ny = b.y - cy;
        const d = Math.sqrt(nx * nx + ny * ny) || 1;
        nx /= d; ny /= d;
        const vn = b.vx * nx + b.vy * ny;
        if (vn >= 0) return;
        const tx = -ny, ty = nx;
        const vt = b.vx * tx + b.vy * ty;
        /* the bounce */
        let nvn = -E_RAIL * vn;
        /* friction at the cushion: side spin bends the rebound */
        const ut = vt - b.sz;
        const lim = Math.abs(ut) / 3.5;
        let P = Math.min(MU_RAIL * (1 + E_RAIL) * -vn, lim);
        if (ut > 0) P = -P;
        const nvt = vt + P;
        b.sz -= 2.5 * P;
        b.vx = nvn * nx + nvt * tx;
        b.vy = nvn * ny + nvt * ty;
        /* the roll reverses too (mostly), so a rolling ball comes off rolling */
        const rn = b.rx * nx + b.ry * ny, rt = b.rx * tx + b.ry * ty;
        const nrn = rn < 0 ? -RAIL_ROLL * E_RAIL * rn : rn;
        b.rx = nrn * nx + rt * tx;
        b.ry = nrn * ny + rt * ty;
        if (b.n === 0 && run.firstHit === null) run.railBefore++;
        else if (run.firstHit !== null) run.railAfter = true;
        run.log.push({ t: run.time, kind: 'rail', a: b.n, speed: -vn });
    }

    function friction(run, dt) {
        const balls = run.balls;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b.on) continue;
            const ux = b.vx - b.rx, uy = b.vy - b.ry;
            const us = Math.sqrt(ux * ux + uy * uy);
            if (us > 1e-6) {
                const dec = 3.5 * MU_SLIDE * G * dt;
                if (us <= dec) {
                    b.vx -= ux / 3.5; b.vy -= uy / 3.5;
                    b.rx = b.vx; b.ry = b.vy;
                } else {
                    const k = MU_SLIDE * G * dt / us;
                    b.vx -= ux * k; b.vy -= uy * k;
                    b.rx += 2.5 * ux * k; b.ry += 2.5 * uy * k;
                }
            } else if (b.vx !== 0 || b.vy !== 0) {
                const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                const dec = MU_ROLL * G * dt;
                if (sp <= dec) { b.vx = 0; b.vy = 0; b.rx = 0; b.ry = 0; }
                else { const f = 1 - dec / sp; b.vx *= f; b.vy *= f; b.rx = b.vx; b.ry = b.vy; }
            }
            if (b.sz !== 0) {
                const d = SPIN_DECAY * dt;
                b.sz = Math.abs(b.sz) <= d ? 0 : b.sz - (b.sz > 0 ? d : -d);
            }
            if (b.vx === 0 && b.vy === 0 && b.rx === 0 && b.ry === 0) b.sz = 0;
        }
    }

    function nearestPocket(x, y) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < POCKETS.length; i++) {
            const dx = POCKETS[i].x - x, dy = POCKETS[i].y - y;
            const d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    /* over a hole? past a cushion line (only a pocket lets a ball get
       there), or deep in a corner pocket's mouth */
    function isDown(x, y) {
        if (x < -POT_M || x > W + POT_M || y < -POT_M || y > H + POT_M) return true;
        const fx = x < W / 2 ? x : W - x, fy = y < H / 2 ? y : H - y;
        return fx + fy < DROP;
    }

    function pockets(run) {
        const balls = run.balls;
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (!b.on) continue;
            if (isDown(b.x, b.y)) {
                b.on = false;
                const p = nearestPocket(b.x, b.y);
                run.potted.push({ n: b.n, pocket: p });
                run.log.push({ t: run.time, kind: 'pot', a: b.n, pocket: p, speed: Math.sqrt(b.vx * b.vx + b.vy * b.vy) });
                b.vx = b.vy = b.rx = b.ry = b.sz = 0;
            }
        }
    }

    /* one physics step (DT seconds) */
    function step(run) {
        if (run.done) return;
        let left = DT;
        for (let guard = 0; left > 0 && guard < 400; guard++) {
            const ev = nextEvent(run, left);
            const t = ev ? ev.t : left;
            if (t > 0) move(run, t);
            left -= t;
            if (!ev) { left = 0; break; }
            if (ev.s !== undefined) hitRail(run, run.balls[ev.i], SEGS[ev.s]);
            else hitBalls(run, run.balls[ev.i], run.balls[ev.j]);
        }
        if (left > 0) move(run, left);
        friction(run, DT);
        pockets(run);
        run.time += DT;
        run.steps++;
        let still = true;
        for (let i = 0; i < run.balls.length; i++) {
            const b = run.balls[i];
            if (b.on && (b.vx !== 0 || b.vy !== 0 || b.rx !== 0 || b.ry !== 0)) { still = false; break; }
        }
        if (still || run.time >= MAX_TIME) run.done = true;
    }

    function runToEnd(run) { while (!run.done) step(run); return run; }

    /* ---------- the rules ---------- */

    /* put a money ball back on the foot spot (or the nearest free spot
       behind it on the long string, then in front of it) */
    function respot(balls, n, cue) {
        const all = cue ? balls.concat([[0, cue[0], cue[1]]]) : balls;
        const free = function (x, y) {
            return all.every(function (b) {
                const dx = b[1] - x, dy = b[2] - y;
                return dx * dx + dy * dy >= (D + 0.02) * (D + 0.02);
            });
        };
        let x = FOOT_X;
        while (x <= W - R && !free(x, MID_Y)) x += 1;
        if (x > W - R) { x = FOOT_X; while (x >= R && !free(x, MID_Y)) x -= 1; }
        balls.push([n, x, MID_Y]);
    }

    function finish(state, run) {
        if (!run.done) runToEnd(run);
        const mode = state.mode;
        const me = state.turn, them = 1 - me;
        const input = run.input;
        const potted = run.potted.slice();
        const pottedNs = potted.map(function (p) { return p.n; });
        const balls = run.balls.filter(function (b) { return b.on && b.n !== 0; }).map(function (b) { return [b.n, round(b.x), round(b.y)]; });
        balls.sort(function (a, b) { return a[0] - b[0]; });
        const cueBall = run.balls[0];
        const out = {
            foul: null, firstHit: run.firstHit, potted: potted, cont: false,
            assigned: null, respotted: null, win: false, lose: false, reason: '', called: input.call || null, calledIn: null
        };

        const wasBreak = !state.broke;
        const targetsBefore = targets(state);
        const somethingDown = pottedNs.some(function (n) { return n !== 0; });
        if (pottedNs.indexOf(0) >= 0) out.foul = 'scratch';
        else if (run.firstHit === null) out.foul = 'no-hit';
        else if (targetsBefore.indexOf(run.firstHit) < 0 && !(wasBreak && mode === '8')) out.foul = 'wrong-ball';
        else if (!run.railAfter && !somethingDown) out.foul = 'no-rail';

        const next = {
            v: VERSION, mode: mode, seed: state.seed, balls: balls,
            cue: cueBall.on ? [round(cueBall.x), round(cueBall.y)] : null,
            turn: me, groups: state.groups.slice(), broke: true, inHand: null,
            shots: state.shots + 1, over: false, winner: null, reason: ''
        };
        const foul = !!out.foul;

        if (mode === '8') {
            const eight = potted.find(function (p) { return p.n === 8; });
            const mine = state.groups[me];
            const mineBefore = mine ? left(state, mine) : null;
            if (eight) {
                if (wasBreak) {
                    respot(next.balls, 8, next.cue);
                    out.respotted = 8;
                } else if (mine && mineBefore === 0 && !foul && input.call && eight.pocket === input.call.pocket) {
                    out.win = true; out.reason = 'potted the 8';
                } else {
                    out.lose = true;
                    out.reason = !mine || mineBefore > 0 ? 'potted the 8 too early'
                        : (foul ? (out.foul === 'scratch' ? 'scratched on the 8' : 'fouled on the 8') : 'put the 8 in the wrong pocket');
                }
            }
            if (!out.win && !out.lose) {
                if (!mine && !wasBreak && !foul) {
                    const first = potted.find(function (p) { return groupOf(p.n); });
                    if (first) {
                        const g = groupOf(first.n);
                        next.groups[me] = g;
                        next.groups[them] = g === 'solids' ? 'stripes' : 'solids';
                        out.assigned = g;
                    }
                }
                const now = next.groups[me];
                if (!foul) {
                    if (wasBreak) out.cont = somethingDown;
                    else if (!mine) out.cont = !!out.assigned;
                    else out.cont = potted.some(function (p) { return groupOf(p.n) === now; });
                }
            }
        } else {
            const money = MODES[mode].money;
            const m = potted.find(function (p) { return p.n === money; });
            if (mode === '9') {
                if (m && !foul) { out.win = true; out.reason = 'potted the 9'; }
                else if (m) { respot(next.balls, 9, next.cue); out.respotted = 9; }
                if (!out.win && !foul) out.cont = somethingDown;
            } else {
                const call = input.call;
                const calledIn = !wasBreak && !foul && !!call && potted.some(function (p) { return p.n === call.ball && p.pocket === call.pocket; });
                if (!wasBreak) out.calledIn = calledIn;
                if (m) {
                    if (calledIn && call.ball === 10) { out.win = true; out.reason = 'potted the 10'; }
                    else { respot(next.balls, 10, next.cue); out.respotted = 10; }
                }
                if (!out.win && !foul) out.cont = wasBreak ? somethingDown : calledIn;
            }
        }

        if (out.win || out.lose) {
            next.over = true;
            next.winner = out.win ? me : them;
            next.reason = out.reason;
            out.cont = false;
        } else {
            if (!out.cont) next.turn = them;
            if (foul) next.inHand = 'any';
            if (!next.cue) next.inHand = 'any';
        }
        if (!next.cue) next.cue = null;
        next.balls.sort(function (a, b) { return a[0] - b[0]; });
        return { state: next, outcome: out };
    }

    /* the whole shot in one go (bots, tests, the server) */
    function shot(state, input) { return finish(state, runToEnd(begin(state, input))); }

    /* ---------- the aim guide ---------- */

    /* Where the cue ball goes first along dir from (x, y): the first
       ball it touches (with the ghost-ball spot and both balls' new
       directions), a cushion, or a pocket. Uses the same contact
       maths as the physics. */
    function predict(state, x, y, dir) {
        const len = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1]) || 1;
        const dx = dir[0] / len, dy = dir[1] / len;
        const probe = { x: x, y: y, vx: dx, vy: dy };
        const FAR = 5000;
        let best = { t: FAR, kind: 'none' };
        state.balls.forEach(function (b) {
            const t = ballTOI(probe, { x: b[1], y: b[2], vx: 0, vy: 0 }, FAR);
            if (t >= 0 && t < best.t) best = { t: t, kind: 'ball', n: b[0], bx: b[1], by: b[2] };
        });
        SEGS.forEach(function (s) {
            const t = segTOI(probe, s, FAR);
            if (t >= 0 && t < best.t) best = { t: t, kind: 'rail', s: s };
        });
        /* off the table through a pocket mouth */
        let te = FAR;
        if (dx < 0) te = Math.min(te, (x + POT_M) / -dx);
        if (dx > 0) te = Math.min(te, (W + POT_M - x) / dx);
        if (dy < 0) te = Math.min(te, (y + POT_M) / -dy);
        if (dy > 0) te = Math.min(te, (H + POT_M - y) / dy);
        if (te < best.t) best = { t: te, kind: 'pocket' };
        const cx = x + dx * best.t, cy = y + dy * best.t;
        const out = { kind: best.kind, x: cx, y: cy, t: best.t };
        if (best.kind === 'ball') {
            let nx = best.bx - cx, ny = best.by - cy;
            const d = Math.sqrt(nx * nx + ny * ny) || 1;
            nx /= d; ny /= d;
            const along = dx * nx + dy * ny;           // 1 = full ball, 0 = a thin graze
            out.n = best.n;
            out.ball = [best.bx, best.by];
            out.objDir = [nx, ny];
            out.full = along;
            let tx = dx - along * nx, ty = dy - along * ny;
            const tl = Math.sqrt(tx * tx + ty * ty);
            out.cueDir = tl > 1e-6 ? [tx / tl, ty / tl] : [0, 0];
        } else if (best.kind === 'rail') {
            const s = best.s;
            const px = cx - s.ax, py = cy - s.ay;
            const along = Math.min(s.len, Math.max(0, px * s.ux + py * s.uy));
            let nx = cx - (s.ax + s.ux * along), ny = cy - (s.ay + s.uy * along);
            const d = Math.sqrt(nx * nx + ny * ny) || 1;
            nx /= d; ny /= d;
            const vn = dx * nx + dy * ny;
            out.cueDir = [dx - 2 * vn * nx, dy - 2 * vn * ny];
        } else if (best.kind === 'pocket') {
            out.pocket = nearestPocket(cx, cy);
        }
        return out;
    }

    /* which pocket a ball rolling from (x, y) along dir is headed for, if any */
    function pocketAlong(state, x, y, dir, skip) {
        const probe = { x: x, y: y, vx: dir[0], vy: dir[1] };
        const FAR = 5000;
        let best = FAR;
        state.balls.forEach(function (b) {
            if (b[0] === skip) return;
            const t = ballTOI(probe, { x: b[1], y: b[2], vx: 0, vy: 0 }, FAR);
            if (t >= 0 && t < best) best = t;
        });
        SEGS.forEach(function (s) { const t = segTOI(probe, s, FAR); if (t >= 0 && t < best) best = t; });
        let te = FAR;
        const dx = dir[0], dy = dir[1];
        if (dx < 0) te = Math.min(te, (x + POT_M) / -dx);
        if (dx > 0) te = Math.min(te, (W + POT_M - x) / dx);
        if (dy < 0) te = Math.min(te, (y + POT_M) / -dy);
        if (dy > 0) te = Math.min(te, (H + POT_M - y) / dy);
        return te < best ? nearestPocket(x + dx * te, y + dy * te) : null;
    }

    const api = {
        VERSION: VERSION,
        W: W, H: H, R: R, D: D, HEAD_X: HEAD_X, FOOT_X: FOOT_X, MID_Y: MID_Y,
        CORNER: CORNER, SIDE: SIDE, SEGS: SEGS, POCKETS: POCKETS, MODES: MODES, DT: DT,
        speedFor: speedFor,
        newGame: newGame, cleanInput: cleanInput, begin: begin, step: step, runToEnd: runToEnd,
        finish: finish, shot: shot, predict: predict, pocketAlong: pocketAlong,
        targets: targets, needsCall: needsCall, canPlace: canPlace, lowest: lowest,
        groupOf: groupOf, left: left, rng: rng
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WhalePoolSim = api;
})(typeof window !== 'undefined' ? window : globalThis);
