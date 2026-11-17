/* ============================================================
   PokerEngine — No-Limit Texas Hold'em, sit & go style.

   Pure logic, no DOM. The practice table runs it in the browser;
   multiplayer tables will run this same file on the server (the
   way game-sim.js is shared with the Whale Road backend), so the
   server is the dealer and nobody's browser ever sees the deck.

   State is plain JSON (it can sit in a database between moves).
   Functions mutate the state they're given.

   Cards are ints 0..51: rank = c >> 2 (0 = deuce .. 12 = ace),
   suit = c & 3 (spades, hearts, diamonds, clubs).
   ============================================================ */

(function (root) {
    'use strict';

    const SEATS = 6;
    const RANKS = '23456789TJQKA';
    const SUITS = 'shdc';

    /* Tournament blinds, [small, big]. A table starts at level 0 and
       the host's speed setting decides how fast it climbs. */
    const LEVELS = [
        [10, 20], [15, 30], [25, 50], [50, 100], [75, 150], [100, 200],
        [150, 300], [200, 400], [300, 600], [400, 800], [600, 1200],
        [800, 1600], [1000, 2000], [1500, 3000], [2000, 4000],
        [3000, 6000], [5000, 10000], [8000, 16000], [12000, 24000]
    ];

    function rankOf(c) { return c >> 2; }
    function suitOf(c) { return c & 3; }
    function cardName(c) { return RANKS[rankOf(c)] + SUITS[suitOf(c)]; }
    function parseCard(s) { return RANKS.indexOf(s[0]) * 4 + SUITS.indexOf(s[1]); }

    /* mulberry32 — the same tiny seeded RNG Whale Road uses */
    function rng32(seed) {
        let a = seed >>> 0;
        return function () {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function shuffledDeck(rand) {
        const d = [];
        for (let i = 0; i < 52; i++) d.push(i);
        for (let i = 51; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const t = d[i]; d[i] = d[j]; d[j] = t;
        }
        return d;
    }

    /* ---------------------------------------------------------
       Hand evaluation — best five of five to seven cards.
       Returns one number; higher beats lower, equal ties.
       --------------------------------------------------------- */

    const CATEGORY = ['High Card', 'Pair', 'Two Pair', 'Three of a Kind', 'Straight',
                      'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];

    /* high card of the best straight in a 13-bit rank mask, or -1 */
    function straightHigh(mask) {
        for (let hi = 12; hi >= 4; hi--) {
            const m = 0x1f << (hi - 4);
            if ((mask & m) === m) return hi;
        }
        return (mask & 0x100f) === 0x100f ? 3 : -1;     /* A-2-3-4-5, the wheel */
    }

    function pack(cat, ranks) {
        let s = cat;
        for (let i = 0; i < 5; i++) s = s * 16 + (ranks[i] === undefined ? 0 : ranks[i]);
        return s;
    }

    function topRanks(mask, n) {
        const out = [];
        for (let r = 12; r >= 0 && out.length < n; r--) if (mask & (1 << r)) out.push(r);
        return out;
    }

    function evaluate(cards) {
        const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const suitCount = [0, 0, 0, 0];
        const suitMask = [0, 0, 0, 0];
        let mask = 0;
        for (let i = 0; i < cards.length; i++) {
            const r = cards[i] >> 2;
            const s = cards[i] & 3;
            counts[r]++;
            suitCount[s]++;
            suitMask[s] |= 1 << r;
            mask |= 1 << r;
        }

        let flush = null;
        for (let s = 0; s < 4; s++) {
            if (suitCount[s] >= 5) {
                const sh = straightHigh(suitMask[s]);
                if (sh >= 0) return pack(8, [sh]);
                flush = topRanks(suitMask[s], 5);
            }
        }

        const quads = [], trips = [], pairs = [];
        for (let r = 12; r >= 0; r--) {
            if (counts[r] === 4) quads.push(r);
            else if (counts[r] === 3) trips.push(r);
            else if (counts[r] === 2) pairs.push(r);
        }
        /* the best ranks left once some are used */
        function kickers(used, n) {
            let m = mask;
            used.forEach(function (r) { m &= ~(1 << r); });
            return topRanks(m, n);
        }

        if (quads.length) return pack(7, [quads[0]].concat(kickers([quads[0]], 1)));
        if (trips.length && (trips.length > 1 || pairs.length)) {
            const pair = Math.max(trips.length > 1 ? trips[1] : -1, pairs.length ? pairs[0] : -1);
            return pack(6, [trips[0], pair]);
        }
        if (flush) return pack(5, flush);
        const st = straightHigh(mask);
        if (st >= 0) return pack(4, [st]);
        if (trips.length) return pack(3, [trips[0]].concat(kickers([trips[0]], 2)));
        if (pairs.length >= 2) return pack(2, [pairs[0], pairs[1]].concat(kickers([pairs[0], pairs[1]], 1)));
        if (pairs.length === 1) return pack(1, [pairs[0]].concat(kickers([pairs[0]], 3)));
        return pack(0, topRanks(mask, 5));
    }

    const ONE = ['Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
    const MANY = ['Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];

    /* "Two Pair, Kings and Sevens" */
    function describe(score) {
        const r = [];
        let s = score;
        for (let i = 0; i < 5; i++) { r.unshift(s % 16); s = Math.floor(s / 16); }
        const cat = s;
        switch (cat) {
            case 8: return r[0] === 12 ? 'Royal Flush' : 'Straight Flush, ' + ONE[r[0]] + ' high';
            case 7: return 'Four ' + MANY[r[0]];
            case 6: return 'Full House, ' + MANY[r[0]] + ' full of ' + MANY[r[1]];
            case 5: return 'Flush, ' + ONE[r[0]] + ' high';
            case 4: return 'Straight, ' + ONE[r[0]] + ' high';
            case 3: return 'Three ' + MANY[r[0]];
            case 2: return 'Two Pair, ' + MANY[r[0]] + ' and ' + MANY[r[1]];
            case 1: return 'Pair of ' + MANY[r[0]];
            default: return ONE[r[0]] + ' High';
        }
    }

    function categoryOf(score) { return Math.floor(score / 1048576); }   /* 16^5 */

    /* ---------------------------------------------------------
       The table
       --------------------------------------------------------- */

    /* players: up to six { id, name, stack, ... } (index = seat; null = empty) */
    function createTable(players) {
        const seats = [];
        for (let i = 0; i < SEATS; i++) {
            const p = players[i];
            seats.push(p ? Object.assign({}, p, { stack: p.stack, out: false }) : null);
        }
        return { seats: seats, button: -1, levelIndex: 0, handNo: 0, hand: null, places: [], finished: false };
    }

    function blinds(t) { return LEVELS[Math.min(t.levelIndex, LEVELS.length - 1)]; }

    function alive(t, s) { const p = t.seats[s]; return !!p && !p.out && p.stack > 0; }

    function nextSeat(from, ok) {
        for (let i = 1; i <= SEATS; i++) {
            const s = (from + i + SEATS) % SEATS;
            if (ok(s)) return s;
        }
        return -1;
    }

    function inHand(h, s) { return h.dealt[s] && !h.folded[s]; }
    function canAct(t, s) { const h = t.hand; return inHand(h, s) && !h.allIn[s]; }
    function needsToAct(t, s) { const h = t.hand; return canAct(t, s) && (!h.acted[s] || h.bets[s] < h.currentBet); }

    function log(t, entry) { t.hand.log.push(entry); }

    function put(t, s, amount) {
        const h = t.hand;
        const p = t.seats[s];
        const a = Math.min(amount, p.stack);
        p.stack -= a;
        h.bets[s] += a;
        h.total[s] += a;
        if (p.stack === 0) h.allIn[s] = true;
        return a;
    }

    function startHand(t, rand) {
        const players = [];
        for (let s = 0; s < SEATS; s++) if (alive(t, s)) players.push(s);
        if (players.length < 2) { t.finished = true; return t; }

        t.handNo++;
        t.button = nextSeat(t.button, function (s) { return alive(t, s); });
        const headsUp = players.length === 2;
        const sb = headsUp ? t.button : nextSeat(t.button, function (s) { return alive(t, s); });
        const bb = nextSeat(sb, function (s) { return alive(t, s); });
        const lv = blinds(t);

        const zeros = function () { return [0, 0, 0, 0, 0, 0]; };
        const no = function () { return [false, false, false, false, false, false]; };
        const h = t.hand = {
            no: t.handNo,
            deck: shuffledDeck(rand),
            board: [],
            holes: [null, null, null, null, null, null],
            dealt: no(), folded: no(), allIn: no(), acted: no(),
            bets: zeros(), total: zeros(), seen: zeros(),
            street: 'preflop',
            currentBet: lv[1],
            minRaise: lv[1],
            raises: 0,
            sb: sb, bb: bb, blinds: lv,
            toAct: -1,
            log: [],
            result: null
        };
        players.forEach(function (s) { h.dealt[s] = true; h.holes[s] = []; });

        /* two rounds, one card at a time, starting left of the button */
        for (let round = 0; round < 2; round++) {
            let s = t.button;
            for (let k = 0; k < players.length; k++) {
                s = nextSeat(s, function (x) { return h.dealt[x]; });
                h.holes[s].push(h.deck.pop());
            }
        }

        log(t, { seat: sb, type: 'sb', amount: put(t, sb, lv[0]) });
        log(t, { seat: bb, type: 'bb', amount: put(t, bb, lv[1]) });

        h.toAct = nextSeat(bb, function (s) { return needsToAct(t, s); });
        if (h.toAct < 0) advance(t);
        return t;
    }

    /* What seat s may do right now. */
    function legal(t, s) {
        const h = t.hand;
        if (!h || h.result || h.toAct !== s) return null;
        const p = t.seats[s];
        const toCall = Math.max(0, h.currentBet - h.bets[s]);
        const maxTo = h.bets[s] + p.stack;
        let others = 0;
        for (let x = 0; x < SEATS; x++) if (x !== s && canAct(t, x)) others++;
        const reopened = !h.acted[s] || h.seen[s] < h.raises;
        const canRaise = reopened && others > 0 && maxTo > h.currentBet;
        return {
            toCall: Math.min(toCall, p.stack),
            canCheck: toCall === 0,
            raise: canRaise ? { min: Math.min(h.currentBet + h.minRaise, maxTo), max: maxTo } : null
        };
    }

    /* action: { type: 'fold' | 'check' | 'call' | 'raise', to } — 'raise'
       also covers an opening bet; `to` is the seat's total bet this street. */
    function act(t, s, action) {
        const L = legal(t, s);
        if (!L) throw new Error('not your turn');
        const h = t.hand;
        const type = action && action.type;

        if (type === 'fold') {
            if (L.canCheck) throw new Error('nothing to fold to — check instead');
            h.folded[s] = true;
            log(t, { seat: s, type: 'fold' });
        } else if (type === 'check') {
            if (!L.canCheck) throw new Error('there is a bet to call');
            log(t, { seat: s, type: 'check' });
        } else if (type === 'call') {
            if (L.canCheck) throw new Error('nothing to call — check instead');
            log(t, { seat: s, type: 'call', amount: put(t, s, L.toCall), allIn: h.allIn[s] });
        } else if (type === 'raise') {
            if (!L.raise) throw new Error('raising is not allowed here');
            const to = Math.floor(Number(action.to));
            if (!(to >= L.raise.min && to <= L.raise.max)) throw new Error('raise must be between ' + L.raise.min + ' and ' + L.raise.max);
            const by = to - h.currentBet;
            const opening = h.currentBet === 0;
            put(t, s, to - h.bets[s]);
            /* a full raise reopens the betting; an all-in for less doesn't */
            if (by >= h.minRaise) { h.minRaise = by; h.raises++; }
            h.currentBet = to;
            log(t, { seat: s, type: opening ? 'bet' : 'raise', to: to, allIn: h.allIn[s] });
        } else {
            throw new Error('unknown action');
        }

        h.acted[s] = true;
        h.seen[s] = h.raises;
        advance(t, s);
        return t;
    }

    function advance(t, from) {
        const h = t.hand;
        const live = [];
        for (let s = 0; s < SEATS; s++) if (inHand(h, s)) live.push(s);

        if (live.length === 1) { finishHand(t, live); return; }

        const next = nextSeat(from === undefined ? h.toAct : from, function (s) { return needsToAct(t, s); });
        if (next >= 0) { h.toAct = next; return; }

        /* the street is over */
        let actors = 0;
        live.forEach(function (s) { if (!h.allIn[s]) actors++; });

        if (h.street === 'river' || actors <= 1) {
            while (h.board.length < 5) dealStreet(t);
            finishHand(t, live);
            return;
        }

        dealStreet(t);
        h.bets = [0, 0, 0, 0, 0, 0];
        h.acted = [false, false, false, false, false, false];
        h.seen = [0, 0, 0, 0, 0, 0];
        h.currentBet = 0;
        h.minRaise = h.blinds[1];
        h.raises = 0;
        h.toAct = nextSeat(t.button, function (s) { return canAct(t, s); });
    }

    function dealStreet(t) {
        const h = t.hand;
        h.deck.pop();                                   /* burn */
        const n = h.board.length === 0 ? 3 : 1;
        for (let i = 0; i < n; i++) h.board.push(h.deck.pop());
        h.street = h.board.length === 3 ? 'flop' : h.board.length === 4 ? 'turn' : 'river';
        log(t, { type: h.street, cards: h.board.slice() });
    }

    /* Main pot and side pots from what everyone put in. Folded chips
       still count; only players still in can win them. */
    function buildPots(h) {
        const levels = [];
        for (let s = 0; s < SEATS; s++) {
            if (inHand(h, s) && levels.indexOf(h.total[s]) < 0) levels.push(h.total[s]);
        }
        levels.sort(function (a, b) { return a - b; });
        const pots = [];
        let prev = 0;
        levels.forEach(function (lv) {
            let amount = 0;
            const eligible = [];
            for (let s = 0; s < SEATS; s++) {
                amount += Math.max(0, Math.min(h.total[s], lv) - prev);
                if (inHand(h, s) && h.total[s] >= lv) eligible.push(s);
            }
            if (amount > 0) pots.push({ amount: amount, eligible: eligible });
            prev = lv;
        });
        /* anything above the top level (a folder who'd put in more) */
        let spare = 0;
        for (let s = 0; s < SEATS; s++) spare += Math.max(0, h.total[s] - prev);
        if (spare && pots.length) pots[pots.length - 1].amount += spare;
        return pots;
    }

    function finishHand(t, live) {
        const h = t.hand;
        const showdown = live.length > 1;
        const scores = [null, null, null, null, null, null];
        if (showdown) live.forEach(function (s) { scores[s] = evaluate(h.holes[s].concat(h.board)); });

        const pots = buildPots(h);
        const won = [0, 0, 0, 0, 0, 0];
        const potResults = pots.map(function (pot) {
            let winners;
            if (!showdown) {
                winners = live.slice();
            } else {
                let best = -1;
                pot.eligible.forEach(function (s) { if (scores[s] > best) best = scores[s]; });
                winners = pot.eligible.filter(function (s) { return scores[s] === best; });
            }
            /* split evenly; odd chips go round from the left of the button */
            const share = Math.floor(pot.amount / winners.length);
            let odd = pot.amount - share * winners.length;
            winners.forEach(function (s) { won[s] += share; });
            for (let i = 1; odd > 0 && i <= SEATS; i++) {
                const s = (t.button + i) % SEATS;
                if (winners.indexOf(s) >= 0) { won[s]++; odd--; }
            }
            return { amount: pot.amount, winners: winners };
        });

        for (let s = 0; s < SEATS; s++) if (won[s]) t.seats[s].stack += won[s];

        h.result = {
            showdown: showdown,
            pots: potResults,
            won: won,
            shown: showdown ? live.slice() : [],
            hands: scores.map(function (sc) { return sc === null ? null : describe(sc); })
        };
        h.toAct = -1;
        h.street = 'done';

        /* who's out — whoever started the hand with more finishes higher */
        const busted = [];
        for (let s = 0; s < SEATS; s++) {
            if (h.dealt[s] && t.seats[s].stack === 0) busted.push(s);
        }
        busted.sort(function (a, b) { return h.total[a] - h.total[b]; });
        let remaining = 0;
        for (let s = 0; s < SEATS; s++) if (alive(t, s)) remaining++;
        busted.forEach(function (s, i) {
            t.seats[s].out = true;
            t.seats[s].place = remaining + busted.length - i;
            t.places.push(s);
        });
        if (remaining <= 1) {
            t.finished = true;
            for (let s = 0; s < SEATS; s++) if (alive(t, s)) { t.seats[s].place = 1; t.winner = s; }
        }
    }

    function pot(t) {
        const h = t.hand;
        if (!h) return 0;
        return h.total.reduce(function (a, b) { return a + b; }, 0);
    }

    /* What one seat is allowed to know: no deck, nobody else's hole
       cards until they're shown down. seat -1 = a spectator. */
    function view(t, seat) {
        const v = JSON.parse(JSON.stringify(t));
        if (v.hand) {
            delete v.hand.deck;
            const shown = v.hand.result ? v.hand.result.shown : [];
            v.hand.holes = v.hand.holes.map(function (cards, s) {
                if (!cards) return null;
                return (s === seat || shown.indexOf(s) >= 0) ? cards : [-1, -1];
            });
        }
        return v;
    }

    const api = {
        SEATS: SEATS,
        LEVELS: LEVELS,
        RANKS: RANKS,
        SUITS: SUITS,
        CATEGORY: CATEGORY,
        rng32: rng32,
        shuffledDeck: shuffledDeck,
        rankOf: rankOf,
        suitOf: suitOf,
        cardName: cardName,
        parseCard: parseCard,
        evaluate: evaluate,
        describe: describe,
        categoryOf: categoryOf,
        createTable: createTable,
        startHand: startHand,
        legal: legal,
        act: act,
        pot: pot,
        blinds: blinds,
        buildPots: buildPots,
        view: view
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PokerEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
