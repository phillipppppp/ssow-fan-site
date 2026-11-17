/* ============================================================
   PokerBots — bot whales for the Cigar Lounge.

   Each bot plays the way its whale looks: the traits pick a
   personality (Sleepy eyes play safe, Laser eyes raise everything,
   a cigar means bluffs, gold skin bets big). Decisions come from a
   quick Monte Carlo: deal the unknown cards a couple of hundred
   times and count how often this hand wins.

   Bots only ever see what a player at their seat could see — the
   engine's view() for that seat — so they can't peek either.
   ============================================================ */

(function (root) {
    'use strict';

    const E = (typeof module !== 'undefined' && module.exports)
        ? require('./poker-engine.js')
        : root.PokerEngine;

    /* tight: how picky about starting hands (0 loose .. 1 rock)
       aggr:  bet/raise instead of check/call
       bluff: how often to fire with nothing
       size:  bet size as a share of the pot */
    const BASE = { style: 'Regular', tight: 0.5, aggr: 0.5, bluff: 0.08, size: 0.6 };

    const EYES = {
        'Sleepy':          { style: 'The Rock',       tight: 0.8,  aggr: 0.25, bluff: 0.02 },
        'Laser':           { style: 'Maniac',         tight: 0.15, aggr: 0.9,  bluff: 0.25 },
        'Shy':             { style: 'Nit',            tight: 0.7,  aggr: 0.35 },
        'Stoned':          { style: 'Calling Station', tight: 0.2, aggr: 0.15 },
        'Skeptical':       { style: 'Skeptic',        tight: 0.4,  aggr: 0.3,  bluff: 0.04 },
        'Battle Scar':     { style: 'Brawler',        tight: 0.35, aggr: 0.75 },
        'Bloodshot':       { style: 'Night Owl',      tight: 0.3,  aggr: 0.6 },
        'Circle Shades':   { style: 'Shark',          tight: 0.55, aggr: 0.65, bluff: 0.12 },
        'Glasses':         { style: 'Professor',      tight: 0.6,  aggr: 0.55 },
        'Groucho Glasses': { style: 'Joker',          tight: 0.3,  aggr: 0.5,  bluff: 0.2 }
    };

    /* mouths and skins nudge whatever the eyes decided */
    function mouth(p, v) {
        if (/Cigar/.test(v)) { p.bluff += 0.18; p.style = 'Bluffer'; }
        if (/Grin|Grill/.test(v)) p.aggr += 0.1;
        if (/Tongue/.test(v)) p.tight -= 0.1;
        if (/Unamused/.test(v)) p.tight += 0.05;
    }

    function personaFor(traits) {
        const p = Object.assign({}, BASE);
        const t = {};
        (traits || []).forEach(function (a) { t[a.trait_type] = String(a.value); });
        if (EYES[t.Eyes]) Object.assign(p, EYES[t.Eyes]);
        if (t.Mouth) mouth(p, t.Mouth);
        if (t.Skin === 'Gold') {
            p.style = 'High Roller';
            p.size = 1.0;
            p.aggr += 0.15;
        }
        p.tight = Math.min(0.95, Math.max(0.05, p.tight));
        p.aggr = Math.min(0.95, Math.max(0.05, p.aggr));
        p.bluff = Math.min(0.4, Math.max(0, p.bluff));
        return p;
    }

    /* How often `hole` wins against `opponents` random hands, given
       the board so far. Ties count as a share. */
    function equity(hole, board, opponents, iters, rand) {
        const known = hole.concat(board);
        const rest = [];
        for (let c = 0; c < 52; c++) if (known.indexOf(c) < 0) rest.push(c);
        const need = opponents * 2 + (5 - board.length);
        let total = 0;
        for (let i = 0; i < iters; i++) {
            /* a partial shuffle is enough: we only need the first `need` cards */
            for (let k = 0; k < need; k++) {
                const j = k + Math.floor(rand() * (rest.length - k));
                const tmp = rest[k]; rest[k] = rest[j]; rest[j] = tmp;
            }
            const full = board.concat(rest.slice(opponents * 2, need));
            const mine = E.evaluate(hole.concat(full));
            let best = 0;
            let ties = 0;
            for (let o = 0; o < opponents; o++) {
                const theirs = E.evaluate([rest[o * 2], rest[o * 2 + 1]].concat(full));
                if (theirs > best) best = theirs;
            }
            if (mine > best) total += 1;
            else if (mine === best) {
                for (let o = 0; o < opponents; o++) {
                    if (E.evaluate([rest[o * 2], rest[o * 2 + 1]].concat(full)) === mine) ties++;
                }
                total += 1 / (ties + 1);
            }
        }
        return total / iters;
    }

    /* view: engine.view(table, seat). Returns an action for engine.act. */
    function decide(view, seat, persona, rand) {
        const t = view;
        const h = t.hand;
        const L = E.legal(t, seat);
        if (!L) return null;
        const p = persona || BASE;
        const me = t.seats[seat];

        let opponents = 0;
        for (let s = 0; s < E.SEATS; s++) if (s !== seat && h.dealt[s] && !h.folded[s]) opponents++;
        opponents = Math.max(1, opponents);

        const eq = equity(h.holes[seat], h.board, opponents, h.board.length ? 220 : 160, rand);
        const pot = E.pot(t);
        const toCall = L.toCall;
        const odds = toCall > 0 ? toCall / (pot + toCall) : 0;
        /* a fair share of the pot against this many players */
        const fair = 1 / (opponents + 1);
        /* how much better than "fair" a hand must be to put chips in */
        const strength = eq / fair;

        const bb = h.blinds[1];
        function raiseTo(fraction) {
            if (!L.raise) return null;
            const wiggle = 0.8 + rand() * 0.4;
            let to = h.currentBet + Math.max(h.minRaise, Math.round(pot * fraction * wiggle / bb) * bb);
            /* committing most of the stack anyway? just shove */
            if (to - h.bets[seat] > me.stack * 0.6) to = L.raise.max;
            to = Math.max(L.raise.min, Math.min(L.raise.max, to));
            return { type: 'raise', to: to };
        }

        const valueBar = 1.25 + p.tight * 0.6 - p.aggr * 0.35;     /* raise for value above this */
        const callBar = 0.75 + p.tight * 0.5;                        /* enter pots above this */

        if (toCall === 0) {
            if (strength >= valueBar && rand() < 0.55 + p.aggr * 0.45) return raiseTo(p.size) || { type: 'check' };
            if (rand() < p.bluff * (opponents <= 2 ? 1.3 : 0.6)) return raiseTo(p.size * 0.8) || { type: 'check' };
            return { type: 'check' };
        }

        /* facing a bet */
        const priceOk = eq >= odds * (0.85 + p.tight * 0.35);
        if (strength >= valueBar + 0.35 && rand() < p.aggr) return raiseTo(p.size * 1.2) || { type: 'call' };
        if (priceOk && strength >= callBar * (h.board.length ? 0.85 : 1)) return { type: 'call' };
        /* cheap enough to look at another card? */
        if (toCall <= bb && eq >= odds) return { type: 'call' };
        if (h.board.length && rand() < p.bluff * 0.4) return raiseTo(p.size) || { type: 'fold' };
        return { type: 'fold' };
    }

    const api = { personaFor: personaFor, equity: equity, decide: decide };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PokerBots = api;
})(typeof window !== 'undefined' ? window : globalThis);
