/* ============================================================
   OrcaRaceSim — the whole Orca Race, decided before it starts.

       const race = OrcaRaceSim.run({ code: 'K7QX2M', racers: [{ name, orcaId }, ...] });

   Fair by construction, because it's used for giveaways:

   - The race is decided ONLY by the race code and the racer list.
     Both are hashed into a seed, and every random number comes
     from a small seeded generator (sfc32). No Math.random, no
     clock, no frame rate: the page just plays the result back.
   - The racer list is sorted before it is hashed and simulated,
     so lane order is cosmetic. "Shuffle lanes" can't change who
     wins; only a different code or a different set of racers can.
   - The race length (10s / 20s / 30s) only stretches time. The
     finishing order is the same at any length.
   - Only + - * / and comparisons are used (no sin, exp, pow), so
     the floating-point results are bit-identical in every browser
     and in Node.

   Racers are identified by their trimmed, lower-cased name and
   their orca ID. Two racers with the same name and ID are the
   same entry twice; which lane each one sits in can't matter.
   ============================================================ */

(function (root) {
    'use strict';

    const VERSION = 1;
    const STEPS_TARGET = 600;          // roughly where the winner finishes, in steps
    const MAX_STEPS = 4000;            // nobody is ever left swimming forever
    const COAST = 0.06;                // finished orcas keep gliding this far past the line

    /* cyrb128: a well-mixed 128-bit string hash -> four uint32s */
    function hash128(str) {
        let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
        for (let i = 0; i < str.length; i++) {
            const k = str.charCodeAt(i);
            h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
            h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
            h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
            h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
        }
        h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
        h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
        h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
        h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
        h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
        return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
    }

    /* sfc32: small, fast, seeded. Returns floats in [0, 1). */
    function sfc32(a, b, c, d) {
        return function () {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            let t = (a + b) | 0;
            a = b ^ (b >>> 9);
            b = (c + (c << 3)) | 0;
            c = (c << 21) | (c >>> 11);
            d = (d + 1) | 0;
            t = (t + d) | 0;
            c = (c + t) | 0;
            return (t >>> 0) / 4294967296;
        };
    }

    function rngFrom(str) {
        const s = hash128(str);
        const r = sfc32(s[0], s[1], s[2], s[3]);
        for (let i = 0; i < 15; i++) r();       // warm up
        return r;
    }

    function cleanCode(code) {
        return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
    }

    function cleanName(name) {
        return String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f-\u009f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    }

    function cleanId(id) {
        if (id === null || id === undefined || id === '') return null;
        const n = Number(id);
        return Number.isInteger(n) && n >= 0 && n <= 999999 ? n : null;
    }

    function keyOf(r) {
        return cleanName(r.name).toLowerCase() + '#' + (cleanId(r.orcaId) === null ? '' : cleanId(r.orcaId));
    }

    function hex(n) { return ('00000000' + (n >>> 0).toString(16)).slice(-8); }

    /* a short fingerprint of the racer set, shown next to the code so
       anyone can check they're replaying the same list */
    function fingerprint(racers) {
        const keys = racers.map(keyOf).sort();
        return hex(hash128('ssow-orca-racers|' + keys.join('\n'))[0]).slice(0, 6);
    }

    function run(opts) {
        const code = cleanCode(opts.code);
        const racers = (opts.racers || []).map(function (r) { return { name: cleanName(r.name), orcaId: cleanId(r.orcaId) }; });
        const n = racers.length;
        if (!code) throw new Error('a race needs a race code');
        if (n < 2) throw new Error('a race needs at least two racers');

        /* canonical order: sorted by identity; lanes are just where we draw them */
        const canon = racers.map(function (r, lane) { return { lane: lane, key: keyOf(r) }; });
        canon.sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : x.lane - y.lane; });
        const keys = canon.map(function (c) { return c.key; });
        const rand = rngFrom('ssow-orca-race|v' + VERSION + '|' + code + '|' + keys.join('\n'));
        function between(lo, hi) { return lo + (hi - lo) * rand(); }

        /* each racer's character, drawn in canonical order */
        const st = canon.map(function () {
            return {
                base: between(0.965, 1.035) / STEPS_TARGET,
                mul: 1,
                target: between(0.9, 1.1),
                segLeft: Math.floor(between(25, 90)),
                burst: 0,               // steps of burst left
                burstMul: 1,
                stamina: between(0.0, 1.0),   // who digs deep at the end
                pos: 0,
                finish: -1
            };
        });

        const path = st.map(function () { return [0]; });
        const bursts = st.map(function () { return []; });     // [step, ...] a burst started
        let finished = 0;
        let step = 0;
        let leader = -1;
        let leadChanges = 0;

        while (finished < n && step < MAX_STEPS) {
            step++;
            let lead = 0;
            for (let i = 0; i < n; i++) if (st[i].pos > lead) lead = st[i].pos;

            for (let i = 0; i < n; i++) {
                const s = st[i];
                /* cruising pace wanders between segments */
                if (--s.segLeft <= 0) {
                    s.target = between(0.86, 1.14);
                    s.segLeft = Math.floor(between(25, 90));
                }
                s.mul += (s.target - s.mul) * 0.06;

                /* speed bursts: anyone can get one, those behind get them more */
                const gap = lead - s.pos;
                const behind = gap > 0.12 ? 1 : gap / 0.12;
                let chance = 0.0035 + 0.011 * behind;
                if (lead > 0.72 && s.finish < 0) chance += 0.004 + 0.008 * s.stamina;   // the late kick
                if (s.burst <= 0 && s.pos < 1 && rand() < chance) {
                    s.burst = Math.floor(between(18, 42));
                    s.burstMul = between(1.35, 1.8);
                    bursts[i].push(step);
                } else if (s.burst > 0) {
                    s.burst--;
                }
                const boost = s.burst > 0 ? s.burstMul : 1;
                const v = s.pos >= 1 ? s.base * 0.55 : s.base * s.mul * boost;
                const prev = s.pos;
                s.pos = s.pos >= 1 + COAST ? s.pos : s.pos + v;
                if (s.finish < 0 && s.pos >= 1) {
                    /* the exact crossing, between this step and the last */
                    s.finish = (step - 1) + (1 - prev) / (s.pos - prev);
                    finished++;
                }
                path[i].push(s.pos);
            }

            /* who's in front (unfinished leaders only count while racing) */
            let best = -1, bestPos = -1;
            for (let i = 0; i < n; i++) if (st[i].pos > bestPos) { bestPos = st[i].pos; best = i; }
            if (bestPos < 1) {
                if (leader !== -1 && best !== leader) leadChanges++;
                leader = best;
            }
        }
        /* a racer that somehow never finished (can't really happen) finishes last */
        for (let i = 0; i < n; i++) {
            if (st[i].finish < 0) { st[i].finish = MAX_STEPS + (1 - st[i].pos); }
        }

        const orderCanon = canon.map(function (_, i) { return i; }).sort(function (a, b) {
            return st[a].finish - st[b].finish || a - b;
        });
        const winnerSteps = st[orderCanon[0]].finish;

        /* back to lane order for the page */
        const byLane = new Array(n);
        canon.forEach(function (c, i) {
            byLane[c.lane] = {
                lane: c.lane,
                name: racers[c.lane].name,
                orcaId: racers[c.lane].orcaId,
                finishSteps: st[i].finish,
                path: Float64Array.from(path[i]),
                bursts: bursts[i]
            };
        });

        return {
            version: VERSION,
            code: code,
            fingerprint: fingerprint(racers),
            steps: step,
            winnerSteps: winnerSteps,
            leadChanges: leadChanges,
            racers: byLane,
            order: orderCanon.map(function (i) { return canon[i].lane; })   // lanes, 1st to last
        };
    }

    /* seconds per simulated step for a chosen race length */
    function timeScale(race, seconds) { return seconds / race.winnerSteps; }

    /* where a racer is (0 = start, 1 = finish) at fractional step s */
    function posAt(racer, s) {
        const p = racer.path;
        if (s <= 0) return 0;
        const i = Math.floor(s);
        if (i >= p.length - 1) return p[p.length - 1];
        return p[i] + (p[i + 1] - p[i]) * (s - i);
    }

    function burstingAt(racer, s) {
        for (let i = racer.bursts.length - 1; i >= 0; i--) {
            const b = racer.bursts[i];
            if (b <= s) return s - b < 30;
        }
        return false;
    }

    const api = {
        VERSION: VERSION,
        run: run,
        timeScale: timeScale,
        posAt: posAt,
        burstingAt: burstingAt,
        fingerprint: fingerprint,
        cleanCode: cleanCode,
        cleanName: cleanName,
        cleanId: cleanId,
        hash128: hash128
    };
    root.OrcaRaceSim = api;
    if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
