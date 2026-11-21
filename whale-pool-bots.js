/* ============================================================
   Whale Pool — the bot whales (WhalePoolBots)

   A bot plays the way a decent player thinks:
     1. list the pots it can see (ghost-ball aim, clear paths, not
        too thin a cut), easiest first;
     2. try the best few for real, at a few speeds and spins, by
        running the actual table simulation (WhalePoolSim.shot) —
        so it knows where the cue ball will end up;
     3. prefer a pot that leaves an easy next shot; if nothing
        drops, play a safe shot that leaves the other player
        little;
     4. then miss a bit, like a person: its aim and speed get a
        random wobble that depends on its skill.
   Ball in hand: it tries spots behind each pottable ball and
   keeps the one with the easiest shot.

   Bots never see anything a player couldn't: they read the same
   table state and send the same kind of shot input.
   ============================================================ */

(function (root) {
    'use strict';

    const S = root.WhalePoolSim || (typeof require !== 'undefined' ? require('./whale-pool-sim.js') : null);

    /* aim: wobble in degrees (one standard deviation); speed: relative
       wobble; look: how many pots it tries for real; plan: plays for
       position; safe: plays real safeties */
    const SKILLS = {
        easy:   { aim: 1.1,  speed: 0.12, look: 3,  plan: false, safe: false, spins: [[0, 0]] },
        normal: { aim: 0.4,  speed: 0.06, look: 7,  plan: true,  safe: true,  spins: [[0, 0], [0, -0.5], [0, 0.5]] },
        hard:   { aim: 0.14, speed: 0.03, look: 12, plan: true,  safe: true,  spins: [[0, 0], [0, -0.6], [0, 0.55], [0, -0.25]] }
    };
    const POWERS = [0.16, 0.24, 0.33, 0.45, 0.6, 0.78];

    function gauss(rand) {
        let u = 0, v = 0;
        while (u === 0) u = rand();
        while (v === 0) v = rand();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    function rot(d, deg) {
        const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
        return [d[0] * c - d[1] * s, d[0] * s + d[1] * c];
    }
    function unit(dx, dy) { const l = Math.sqrt(dx * dx + dy * dy) || 1; return [dx / l, dy / l]; }

    /* is the straight path from a to b clear of every ball but `skip`
       (a ball of radius R travelling: needs a 2R corridor) */
    function clear(balls, ax, ay, bx, by, skip, extra) {
        const dx = bx - ax, dy = by - ay;
        const L2 = dx * dx + dy * dy || 1;
        const lim = (S.D - 0.5) * (S.D - 0.5);
        for (let i = 0; i < balls.length; i++) {
            const b = balls[i];
            if (b[0] === skip || b[0] === extra) continue;
            let t = ((b[1] - ax) * dx + (b[2] - ay) * dy) / L2;
            if (t < 0 || t > 1) continue;
            const px = ax + dx * t - b[1], py = ay + dy * t - b[2];
            if (px * px + py * py < lim) return false;
        }
        return true;
    }

    /* every direct pot from cue position (cx, cy), easiest first */
    function pots(state, cx, cy) {
        const out = [];
        const balls = state.balls;
        const want = S.targets(state);
        want.forEach(function (n) {
            const b = balls.find(function (x) { return x[0] === n; });
            if (!b) return;
            S.POCKETS.forEach(function (P, p) {
                const to = unit(P.ax - b[1], P.ay - b[2]);
                /* side pockets only take balls coming at them fairly square */
                if ((p === 1 || p === 4) && Math.abs(to[1]) < 0.55) return;
                const gx = b[1] - to[0] * S.D, gy = b[2] - to[1] * S.D;
                if (gx < S.R - 1 || gx > S.W - S.R + 1 || gy < S.R - 1 || gy > S.H - S.R + 1) return;
                const aim = unit(gx - cx, gy - cy);
                const cos = aim[0] * to[0] + aim[1] * to[1];
                if (cos < 0.2) return;                                  // thinner than ~78 degrees
                const dc = Math.sqrt((gx - cx) * (gx - cx) + (gy - cy) * (gy - cy));
                const dp = Math.sqrt((P.ax - b[1]) * (P.ax - b[1]) + (P.ay - b[2]) * (P.ay - b[2]));
                if (!clear(balls, cx, cy, gx, gy, n)) return;
                if (!clear(balls, b[1], b[2], P.ax, P.ay, n)) return;
                const ease = cos * cos / ((1 + dc / 500) * (1 + dp / 450)) * (p === 1 || p === 4 ? 0.85 : 1);
                out.push({ n: n, pocket: p, dir: aim, ease: ease, cut: cos, dc: dc, dp: dp });
            });
        });
        out.sort(function (a, b) { return b.ease - a.ease; });
        return out;
    }

    /* how good is the table for whoever is to shoot (0 = nothing on) */
    function outlook(state) {
        if (state.over) return 0;
        if (state.inHand) return 1.2;                                 // ball in hand is worth a lot
        if (!state.cue) return 1.2;
        const p = pots(state, state.cue[0], state.cue[1]);
        return p.length ? p[0].ease : 0;
    }

    function callFor(state, plan) {
        const need = S.needsCall(state);
        if (!need) return undefined;
        if (need === 'pocket') return { ball: 8, pocket: plan.pocket };
        return { ball: plan.n, pocket: plan.pocket };
    }

    /* Score one simulated shot from the shooter's point of view. */
    function judge(state, res, skill) {
        const me = state.turn;
        const o = res.outcome;
        if (res.state.over) return res.state.winner === me ? 10000 : -10000;
        if (o.foul) return -300 - 100 * outlook(res.state);
        if (o.cont) return 400 + (skill.plan ? 300 * outlook(res.state) : 0) + 20 * o.potted.length;
        /* turn passes: the less the other player has, the better */
        return skill.safe ? -200 * outlook(res.state) : -100;
    }

    function tryShot(state, input) {
        try { return S.shot(state, input); } catch (e) { return null; }
    }

    /* the best shot from one cue position: { input, score, plan } */
    function bestFrom(state, cue, skill, budget) {
        const base = cue ? { cue: cue } : {};
        const from = cue || state.cue;
        const list = pots(state, from[0], from[1]).slice(0, skill.look);
        let best = null;
        const consider = function (input, plan) {
            if (budget.left-- <= 0) return;
            const res = tryShot(state, input);
            if (!res) return;
            const score = judge(state, res, skill);
            if (!best || score > best.score) best = { input: input, score: score, plan: plan, res: res };
        };
        list.forEach(function (c) {
            const call = callFor(state, c);
            skill.spins.forEach(function (spin) {
                POWERS.forEach(function (power) {
                    /* skip speeds that can't reach, or that are silly for a short shot */
                    const need = (c.dc + c.dp / Math.max(0.3, c.cut)) / 2400;
                    if (power < need * 0.6 || power > need * 2.6 + 0.25) return;
                    consider(Object.assign({ dir: c.dir, power: power, spin: spin, call: call }, base), c);
                });
            });
        });
        if ((!best || best.score < 300) && skill.safe) {
            /* no good pot: look for a safe touch on a legal ball */
            const want = S.targets(state);
            want.slice(0, 4).forEach(function (n) {
                const b = state.balls.find(function (x) { return x[0] === n; });
                if (!b) return;
                [-0.7, -0.35, 0, 0.35, 0.7].forEach(function (thin) {
                    const d = unit(b[1] - from[0], b[2] - from[1]);
                    const dir = unit(b[1] + d[1] * thin * S.D - from[0], b[2] - d[0] * thin * S.D - from[1]);
                    [0.18, 0.3, 0.45].forEach(function (power) {
                        const plan = { n: n, pocket: S.pocketAlong(state, b[1], b[2], d, n) || 0, safety: true };
                        consider(Object.assign({ dir: dir, power: power, spin: [0, 0], call: callFor(state, plan) }, base), plan);
                    });
                });
            });
        }
        if (!best) {
            /* nothing simulated well: just hit the first legal ball firmly */
            const n = S.targets(state)[0];
            const b = state.balls.find(function (x) { return x[0] === n; });
            const dir = b ? unit(b[1] - from[0], b[2] - from[1]) : [1, 0];
            const plan = { n: n, pocket: 0, safety: true };
            best = { input: Object.assign({ dir: dir, power: 0.4, spin: [0, 0], call: callFor(state, plan) }, base), score: -1000, plan: plan };
        }
        return best;
    }

    /* where to put the cue ball when it's in hand */
    function placements(state, rand) {
        const spots = [];
        if (state.inHand === 'kitchen') {
            for (let i = 0; i < 18; i++) spots.push([40 + rand() * (S.HEAD_X - 60), 40 + rand() * (S.H - 80)]);
            return spots.filter(function (s) { return S.canPlace(state, s[0], s[1]); });
        }
        S.targets(state).forEach(function (n) {
            const b = state.balls.find(function (x) { return x[0] === n; });
            if (!b) return;
            S.POCKETS.forEach(function (P) {
                const to = unit(P.ax - b[1], P.ay - b[2]);
                [0, 14, -14, 28, -28].forEach(function (deg) {
                    const back = rot([-to[0], -to[1]], deg);
                    [90, 170].forEach(function (dist) {
                        const x = b[1] - to[0] * S.D + back[0] * dist, y = b[2] - to[1] * S.D + back[1] * dist;
                        if (S.canPlace(state, x, y)) spots.push([x, y]);
                    });
                });
            });
        });
        for (let i = 0; i < 8; i++) spots.push([30 + rand() * (S.W - 60), 30 + rand() * (S.H - 60)]);
        return spots.filter(function (s) { return S.canPlace(state, s[0], s[1]); });
    }

    function breakShot(state, rand) {
        const apex = state.balls.reduce(function (a, b) { return b[1] < a[1] ? b : a; });
        let cue = [S.HEAD_X - 40 - rand() * 30, S.MID_Y + (rand() - 0.5) * 60];
        if (!S.canPlace(state, cue[0], cue[1])) cue = [S.HEAD_X - 50, S.MID_Y];
        const dir = unit(apex[1] - cue[0], apex[2] + (rand() - 0.5) * 3 - cue[1]);
        return { input: { dir: dir, power: 0.93 + rand() * 0.07, spin: [0, -0.15], cue: cue }, plan: { brk: true } };
    }

    /* Pick a shot. rand: a () => [0,1) source. Returns
       { input, plan } where plan says what it's going for (for the
       page: { n, pocket } or { safety } or { brk }). */
    function choose(state, level, rand) {
        const skill = SKILLS[level] || SKILLS.normal;
        rand = rand || Math.random;
        if (!state.broke && state.inHand === 'kitchen') return breakShot(state, rand);
        const budget = { left: level === 'easy' ? 60 : (level === 'hard' ? 420 : 220) };
        let best;
        if (state.inHand) {
            /* rank spots by the easiest pot from there, simulate the best few */
            const ranked = placements(state, rand).map(function (s) {
                const p = pots(state, s[0], s[1]);
                return { s: s, ease: p.length ? p[0].ease : 0 };
            }).sort(function (a, b) { return b.ease - a.ease; }).slice(0, level === 'easy' ? 1 : 3);
            ranked.forEach(function (r) {
                const b = bestFrom(state, r.s, skill, budget);
                if (!best || b.score > best.score) best = b;
            });
            if (!best) {
                const s = state.cue && S.canPlace(state, state.cue[0], state.cue[1]) ? state.cue : placements(state, rand)[0];
                best = bestFrom(state, s, skill, budget);
            }
        } else {
            best = bestFrom(state, null, skill, budget);
        }
        /* the human touch: a little wobble on aim and speed */
        const input = Object.assign({}, best.input);
        input.dir = rot(input.dir, gauss(rand) * skill.aim);
        input.power = Math.min(1, Math.max(0.05, input.power * (1 + gauss(rand) * skill.speed)));
        return { input: input, plan: best.plan };
    }

    const api = { SKILLS: SKILLS, choose: choose, pots: pots, outlook: outlook };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.WhalePoolBots = api;
})(typeof window !== 'undefined' ? window : globalThis);
