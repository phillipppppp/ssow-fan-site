/* ============================================================
   Whale2048 — the rules of Whale 2048, shared by the page and
   the server.

   The page plays with it; the whale-2048 edge function replays a
   game's moves with this very file to work out the score, so a
   score can't be typed in, only played. Same loading trick as
   game-sim.js: a browser global, CommonJS, or a Deno side-effect
   import (globalThis.Whale2048).

   A board is 16 numbers, row by row from the top left. Each is an
   exponent: 0 is empty, 1 is a 2 (Krill), 2 is a 4 (Shrimp) ...
   11 is 2048 (King Whale). New tiles come from a seeded RNG, so a
   seed plus the list of moves gives exactly one game.

   Bump VERSION whenever a rule changes: runs started under one
   version can't be finished under another.
   ============================================================ */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.Whale2048 = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const VERSION = 1;
    const SIZE = 4;
    const CELLS = SIZE * SIZE;
    const WIN = 11;                    /* 2^11 = 2048, the King Whale */
    const MAX_MOVES = 50000;           /* far past any human game */

    /* ---------------------------------------------------------
       Seeded RNG (mulberry32). Its whole state is one uint32 kept
       on the game state, so a game is plain JSON.
       --------------------------------------------------------- */

    function rand(st) {
        st.r = (st.r + 0x6D2B79F5) >>> 0;
        let t = st.r;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /* a new 2 (nine times in ten) or 4 in a random empty cell */
    function spawn(st) {
        const empty = [];
        for (let i = 0; i < CELLS; i++) if (!st.b[i]) empty.push(i);
        if (!empty.length) return null;
        const at = empty[Math.floor(rand(st) * empty.length)];
        const v = rand(st) < 0.9 ? 1 : 2;
        st.b[at] = v;
        if (v > st.top) st.top = v;
        return { at: at, v: v };
    }

    function start(seed) {
        const st = { b: new Array(CELLS).fill(0), score: 0, top: 0, r: (Number(seed) >>> 0), n: 0 };
        spawn(st);
        spawn(st);
        return st;
    }

    /* For each direction: the four lines, each listed from the edge the
       tiles slide toward. */
    const LINES = (function () {
        const L = [], R = [], U = [], D = [];
        for (let i = 0; i < SIZE; i++) {
            const row = [], col = [];
            for (let j = 0; j < SIZE; j++) { row.push(i * SIZE + j); col.push(j * SIZE + i); }
            L.push(row);
            R.push(row.slice().reverse());
            U.push(col);
            D.push(col.slice().reverse());
        }
        return { L: L, R: R, U: U, D: D };
    })();

    /* One move. Returns the new state (the old one is left alone) and
       what happened, for the page to animate:
         slides  [from, to] for every tile (two tiles share a `to` when
                 they merge)
         merges  { at, v } for every merge, v the new exponent
         spawn   { at, v } for the new tile
       A move that changes nothing isn't a move: moved is false, the
       state comes back untouched and no tile appears. */
    function move(prev, dir) {
        const lines = LINES[dir];
        if (!lines) throw new Error('bad move');
        const nb = new Array(CELLS).fill(0);
        const slides = [];
        const merges = [];
        let moved = false;
        let gained = 0;
        let top = prev.top;

        for (let l = 0; l < SIZE; l++) {
            const line = lines[l];
            let k = -1;               /* the last filled slot in this line */
            let open = false;         /* may the tile in slot k still merge? */
            for (let j = 0; j < SIZE; j++) {
                const from = line[j];
                const v = prev.b[from];
                if (!v) continue;
                if (open && nb[line[k]] === v) {
                    const to = line[k];
                    nb[to] = v + 1;
                    gained += Math.pow(2, v + 1);
                    if (v + 1 > top) top = v + 1;
                    merges.push({ at: to, v: v + 1 });
                    slides.push([from, to]);
                    open = false;     /* a merged tile doesn't merge again this move */
                    moved = true;
                } else {
                    k++;
                    const to = line[k];
                    nb[to] = v;
                    slides.push([from, to]);
                    open = true;
                    if (from !== to) moved = true;
                }
            }
        }

        if (!moved) return { state: prev, moved: false, gained: 0, slides: [], merges: [], spawn: null };
        const st = { b: nb, score: prev.score + gained, top: top, r: prev.r, n: prev.n + 1 };
        const sp = spawn(st);
        return { state: st, moved: true, gained: gained, slides: slides, merges: merges, spawn: sp };
    }

    function canMove(b) {
        for (let i = 0; i < CELLS; i++) {
            if (!b[i]) return true;
            const x = i % SIZE;
            if (x < SIZE - 1 && b[i] === b[i + 1]) return true;
            if (i + SIZE < CELLS && b[i] === b[i + SIZE]) return true;
        }
        return false;
    }

    /* Play a whole game from its seed and moves ("ULDR..."). Moves that
       change nothing are counted in noops (the page never sends them;
       the server refuses logs that have any). */
    function replay(seed, moves) {
        if (typeof moves !== 'string' || !/^[UDLR]*$/.test(moves)) throw new Error('bad move log');
        if (moves.length > MAX_MOVES) throw new Error('move log too long');
        let st = start(seed);
        let noops = 0;
        for (let i = 0; i < moves.length; i++) {
            const res = move(st, moves[i]);
            if (res.moved) st = res.state;
            else noops++;
        }
        return { state: st, score: st.score, top: st.top, count: st.n, over: !canMove(st.b), noops: noops };
    }

    /* ---------------------------------------------------------
       Leaderboard names: plain text, 2-16 characters, letters
       (any language), numbers, spaces and _ . -  — nothing that
       could ever be read as HTML. The page checks before asking;
       the server enforces the same rule.
       --------------------------------------------------------- */

    const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'official', 'ssow',
        'secretsociety', 'secretsocietyofwhales', 'support', 'staff', 'system', 'whale2048', 'kingwhale'];

    /* matched after folding case, look-alike digits and separators */
    const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'faggot', 'retard', 'whore',
        'slut', 'nazi', 'hitler', 'kike', 'chink', 'twat', 'wank', 'porn', 'penis',
        'vagina', 'dildo', 'pussy', 'rapist', 'molest', 'pedo', 'kkk'];

    function fold(name) {
        return name.toLowerCase()
            .replace(/[\s_.\-]/g, '')
            .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
            .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b');
    }

    /* { name } when it's fine (tidied up), otherwise { error } */
    function checkName(raw) {
        const n = String(raw === null || raw === undefined ? '' : raw)
            .replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (n.length < 2 || n.length > 16) return { error: 'Pick a name of 2 to 16 characters.' };
        if (!/^[\p{L}\p{M}\p{N} _.\-]+$/u.test(n)) return { error: 'Names can use letters, numbers, spaces and _ . - only.' };
        const folded = fold(n);
        if (RESERVED.indexOf(folded) >= 0) return { error: 'That name is reserved.' };
        for (let i = 0; i < BLOCKED.length; i++) {
            if (folded.indexOf(BLOCKED[i]) >= 0) return { error: 'Pick a friendlier name.' };
        }
        return { name: n };
    }

    /* ---------------------------------------------------------
       Does this game look played by a program?

       elapsedMs is the server's own clock, from the ticket to now:
       a game can't have more moves than 20 a second, all game long
       (key repeats are ignored by the page, so even a fast swiper
       averages a few a second). gaps are the page's own timings
       between moves: a timer bot is too regular, a spammer too
       fast. Short games aren't judged.
       --------------------------------------------------------- */

    function judge(count, gaps, elapsedMs) {
        const reasons = [];
        if (count >= 30 && elapsedMs < count * 50) reasons.push('fast-forward');
        if (Array.isArray(gaps) && gaps.length === count && count >= 150) {
            const g = gaps.filter(function (x) { return x > 0 && x < 5000; });
            if (g.length >= 100) {
                const fast = g.filter(function (x) { return x < 45; }).length / g.length;
                if (fast > 0.5) reasons.push('burst');
                const mean = g.reduce(function (a, x) { return a + x; }, 0) / g.length;
                const sd = Math.sqrt(g.reduce(function (a, x) { return a + (x - mean) * (x - mean); }, 0) / g.length);
                if (mean > 0 && sd / mean < 0.12) reasons.push('rhythm');     /* Whale Road's line too */
            }
        }
        return reasons;
    }

    return {
        VERSION: VERSION,
        SIZE: SIZE,
        WIN: WIN,
        MAX_MOVES: MAX_MOVES,
        start: start,
        move: move,
        canMove: canMove,
        replay: replay,
        checkName: checkName,
        judge: judge
    };
});
