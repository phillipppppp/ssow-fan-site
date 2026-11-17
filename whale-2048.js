/* ============================================================
   Whale 2048 — the page.

   The rules live in whale-2048-sim.js (shared with the server),
   the creatures in whale-2048-art.js, the sounds in
   whale-2048-sound.js, and "your whale" in poker-avatar.js (shared
   with the Cigar Lounge). This file is the board, the input, the
   animations, and talking to the whale-2048 function.

   Scores can't be typed in, only played: every game starts from a
   seed the server picked, the page keeps the list of moves, and the
   server replays them to get the score (see the function's notes).
   If the server can't be reached the game still plays, offline; it
   just can't go on the board.

   Kept in this browser: the game in progress (so a reload carries
   on), your best score, your sound setting, and a random player key
   that owns your name on the board.
   ============================================================ */

(function () {
    'use strict';

    const Sim = window.Whale2048;
    const Art = window.Whale2048Art;
    const Snd = window.W2048Sound;
    const Av = window.LoungeAvatar;
    const $ = function (id) { return document.getElementById(id); };

    const params = new URLSearchParams(window.location.search);
    const CONFIG = window.WHALE_ROAD_CONFIG || {};
    const BACKEND = params.get('backend');
    const API = BACKEND === 'local' ? 'http://localhost:8789'
        : BACKEND === 'none' ? ''
        : (CONFIG.supabaseUrl ? CONFIG.supabaseUrl + '/functions/v1/whale-2048' : '');
    /* tests only: lets a test lay out a board. Such games are never sent anywhere. */
    const SANDBOX = params.has('sandbox');

    const STORE = { game: 'ssow-2048-game', best: 'ssow-2048-best', top: 'ssow-2048-top', key: 'ssow-2048-key', name: 'ssow-2048-name' };
    const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const SLIDE_MS = REDUCED ? 0 : 110;            /* keep in step with --slide in whale-2048.css */
    const MAX_GAP_MS = 600000;
    const PFP_SAFE = /^images\/pfp\/whale-[0-5]\.svg$/;
    const IMAGE_SAFE = /^https:\/\/([a-z0-9-]+\.)*(seadn\.io|opensea\.io|openseauserdata\.com)\//;

    const els = {
        score: $('score'), best: $('best'), scorePop: $('scorePop'), newGame: $('newGame'), mute: $('mute'),
        board: $('board'), grid: $('grid'), tiles: $('tiles'), wait: $('wait'), discover: $('discover'),
        overlay: $('overlay'), overArt: $('overArt'), overTitle: $('overTitle'), overText: $('overText'), overNet: $('overNet'),
        keepGoing: $('keepGoing'), overNew: $('overNew'), overName: $('overName'),
        net: $('net'), lbList: $('lbList'), lbEmpty: $('lbEmpty'), lbYou: $('lbYou'),
        nameForm: $('nameForm'), name: $('w2Name'), nameSave: $('nameSave'), nameStatus: $('nameStatus'),
        ladder: $('ladder'), announce: $('announce'), cells: document.querySelector('.Board-cells')
    };
    if (!els.board || !Sim || !Art) return;

    /* ---------- small helpers ---------- */

    function read(k, fallback) {
        try { const v = window.localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    }
    function write(k, v) {
        try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode: fine */ }
    }
    function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
    function play(name, delay, arg) { if (Snd) Snd.play(name, delay, arg); }
    function announce(text) { els.announce.textContent = text; }

    function randomHex(bytes) {
        const a = new Uint8Array(bytes);
        window.crypto.getRandomValues(a);
        return Array.from(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    function randomSeed() { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0]; }

    /* the key that owns your name on the board; only its hash leaves the server */
    function playerKey() {
        let k = read(STORE.key, null);
        if (typeof k !== 'string' || !/^[0-9a-f]{64}$/.test(k)) { k = randomHex(32); write(STORE.key, k); }
        return k;
    }

    async function api(body, opts) {
        if (!API) throw new Error('offline');
        opts = opts || {};
        const ctl = new AbortController();
        const timer = setTimeout(function () { ctl.abort(); }, opts.timeout || 8000);
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: ctl.signal,
                keepalive: !!opts.keepalive
            });
            const data = await res.json().catch(function () { return {}; });
            if (!res.ok) {
                const err = new Error(data.error || 'something went wrong');
                err.status = res.status;
                throw err;
            }
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    function netSay(text, kind) {
        els.net.textContent = text || '';
        els.net.className = 'W2-net' + (kind ? ' is-' + kind : '');
    }

    /* ---------- the board ---------- */

    /* the 16 empty slots */
    for (let i = 0; i < 16; i++) {
        const c = document.createElement('span');
        c.className = 'Cell';
        c.style.setProperty('--x', i % 4);
        c.style.setProperty('--y', Math.floor(i / 4));
        els.cells.appendChild(c);
    }

    let tiles = new Array(16).fill(null);
    let pending = null;              /* the end of the current slide: merges land, a tile appears */

    function place(el, at) {
        el.style.setProperty('--x', at % 4);
        el.style.setProperty('--y', Math.floor(at / 4));
    }

    function makeTile(e, at, cls) {
        const el = document.createElement('div');
        el.className = 'Tile' + (cls ? ' ' + cls : '') + (Art.isDark(e) ? ' is-dark' : '');
        el.style.setProperty('--tile', Art.tileOf(e));
        el.setAttribute('role', 'img');
        el.setAttribute('aria-label', Art.nameOf(e) + ', ' + Art.valueOf(e));
        el.dataset.e = e;
        place(el, at);
        const inner = document.createElement('div');
        inner.className = 'Tile-in';
        inner.appendChild(Art.icon(e, 'Tile-art'));
        const n = document.createElement('span');
        n.className = 'Tile-n' + (String(Art.valueOf(e)).length > 3 ? ' is-long' : '');
        n.textContent = Art.valueOf(e);
        inner.appendChild(n);
        el.appendChild(inner);
        els.tiles.appendChild(el);
        return el;
    }

    function drawStatic() {
        settle();
        els.tiles.textContent = '';
        tiles = new Array(16).fill(null);
        if (!game) return;
        game.st.b.forEach(function (e, at) { if (e) tiles[at] = makeTile(e, at, 'is-new'); });
    }

    function settle() {
        if (!pending) return;
        clearTimeout(pending.timer);
        const fn = pending.fn;
        pending = null;
        fn();
    }

    function animate(res, prevTop) {
        settle();
        const old = tiles;
        const next = new Array(16).fill(null);
        const merging = {};
        res.merges.forEach(function (m) { merging[m.at] = true; });
        const dying = [];
        res.slides.forEach(function (s) {
            const el = old[s[0]];
            if (!el) return;
            el.classList.remove('is-new', 'is-merged', 'is-first');
            place(el, s[1]);
            if (merging[s[1]]) dying.push(el); else next[s[1]] = el;
        });
        tiles = next;
        function land() {
            dying.forEach(function (el) { el.remove(); });
            res.merges.forEach(function (m) {
                tiles[m.at] = makeTile(m.v, m.at, 'is-merged' + (m.v > prevTop ? ' is-first' : ''));
            });
            if (res.spawn) tiles[res.spawn.at] = makeTile(res.spawn.v, res.spawn.at, 'is-new');
        }
        pending = { timer: setTimeout(function () { pending = null; land(); }, SLIDE_MS), fn: land };
    }

    /* a gentle shove when nothing can move that way */
    function nudge(dir) {
        els.grid.classList.remove('is-nudge-U', 'is-nudge-D', 'is-nudge-L', 'is-nudge-R');
        void els.grid.offsetWidth;
        els.grid.classList.add('is-nudge-' + dir);
    }

    /* ---------- score, best, ladder ---------- */

    let best = Number(read(STORE.best, 0)) || 0;
    let bestTop = Number(read(STORE.top, 0)) || 0;

    function showScore(gained) {
        els.score.textContent = fmt(game ? game.st.score : 0);
        if (game && game.st.score > best) { best = game.st.score; write(STORE.best, best); }
        els.best.textContent = fmt(best);
        if (gained > 0 && !REDUCED) {
            els.scorePop.textContent = '+' + fmt(gained);
            els.scorePop.classList.remove('is-on');
            void els.scorePop.offsetWidth;
            els.scorePop.classList.add('is-on');
        }
    }

    const rungs = [];
    function buildLadder() {
        for (let e = 1; e <= Art.LAST; e++) {
            const li = document.createElement('li');
            li.className = 'Ladder-item';
            li.dataset.e = e;
            const tile = document.createElement('div');
            tile.className = 'Ladder-tile' + (Art.isDark(e) ? ' is-dark' : '');
            tile.style.setProperty('--tile', Art.tileOf(e));
            tile.appendChild(Art.icon(e, 'Ladder-art'));
            const n = document.createElement('span');
            n.className = 'Ladder-n';
            n.textContent = fmt(Art.valueOf(e)) + (e === Art.LAST ? '+' : '');
            tile.appendChild(n);
            const name = document.createElement('span');
            name.className = 'Ladder-name';
            name.textContent = Art.nameOf(e);
            li.appendChild(tile);
            li.appendChild(name);
            els.ladder.appendChild(li);
            rungs.push(li);
        }
    }

    function showLadder() {
        const top = game ? game.st.top : 0;
        if (top > bestTop) { bestTop = top; write(STORE.top, bestTop); }
        rungs.forEach(function (li) {
            const e = Number(li.dataset.e);
            li.classList.toggle('is-reached', e <= top);
            li.classList.toggle('is-top', e === Math.min(top, Art.LAST));
            li.classList.toggle('is-best', e === Math.min(bestTop, Art.LAST) && bestTop > top);
        });
    }

    let discoverTimer = 0;
    function discover(e) {
        const d = els.discover;
        d.textContent = '';
        d.appendChild(Art.icon(e, 'Discover-art'));
        const words = document.createElement('span');
        words.className = 'Discover-words';
        const small = document.createElement('small');
        small.textContent = 'New creature!';
        const big = document.createElement('strong');
        big.textContent = Art.nameOf(e);
        words.appendChild(small);
        words.appendChild(big);
        d.appendChild(words);
        d.classList.remove('is-on');
        void d.offsetWidth;
        d.classList.add('is-on');
        clearTimeout(discoverTimer);
        discoverTimer = setTimeout(function () { d.classList.remove('is-on'); }, 2000);
        announce('New creature: ' + Art.nameOf(e) + ', ' + Art.valueOf(e));
    }

    /* ---------- the game ---------- */

    /* game = { seed, runId, online, moves, gaps, st, lastAt, keepGoing, wonShown, savedLen, closed } */
    let game = null;
    let busy = false;
    let me = null;                  /* who the server says you are: { name, avatar, best, rank } */

    let persistTimer = 0;
    function persist() {
        clearTimeout(persistTimer);
        persistTimer = 0;
        if (!game || game.sandbox) return;
        write(STORE.game, {
            seed: game.seed, runId: game.runId, online: game.online, moves: game.moves, gaps: game.gaps,
            keepGoing: game.keepGoing, wonShown: game.wonShown, savedLen: game.savedLen, closed: game.closed
        });
    }
    function persistSoon() { if (!persistTimer) persistTimer = setTimeout(persist, 400); }

    function overlayOpen() { return !els.overlay.hidden; }

    function go(dir) {
        if (!game || busy || overlayOpen()) return;
        const res = Sim.move(game.st, dir);
        if (!res.moved) { play('bump'); nudge(dir); return; }

        const now = Date.now();
        game.gaps.push(Math.max(0, Math.min(MAX_GAP_MS, now - game.lastAt)));
        game.lastAt = now;
        game.moves += dir;
        const prevTop = game.st.top;
        game.st = res.state;

        animate(res, prevTop);
        play('slide');
        if (res.merges.length) {
            const lvl = Math.max.apply(null, res.merges.map(function (m) { return m.v; }));
            play('merge', SLIDE_MS / 1000 * 0.8, lvl);
        }
        const fresh = res.merges.some(function (m) { return m.v > prevTop; });
        if (fresh) {
            discover(game.st.top);
            if (game.st.top < Sim.WIN) play('creature', 0.16, game.st.top);
        }
        showScore(res.gained);
        showLadder();
        persistSoon();

        /* a new creature from the Dolphin up is worth saving straight away */
        if (fresh && game.st.top >= 7) save(game, false, true);

        if (game.st.top >= Sim.WIN && !game.keepGoing && !game.wonShown) {
            game.wonShown = true;
            persist();
            setTimeout(showWin, SLIDE_MS + 450);
        } else if (!Sim.canMove(game.st.b)) {
            const g = game;
            setTimeout(function () { if (g === game) gameOver(); }, SLIDE_MS + 500);
        }
    }

    function begin(seed, ticket) {
        game = {
            seed: seed, runId: ticket ? ticket.runId : null, online: !!ticket,
            moves: '', gaps: [], st: Sim.start(seed), lastAt: Date.now(),
            keepGoing: false, wonShown: false, savedLen: 0, closed: false
        };
        hideOverlay();
        drawStatic();
        showScore(0);
        showLadder();
        persist();
    }

    async function newGame() {
        if (busy) return;
        const old = game;
        if (old && old.online && !old.closed && old.moves.length) save(old, true, true);   /* bank it */
        busy = true;
        game = null;
        hideOverlay();
        els.tiles.textContent = '';
        tiles = new Array(16).fill(null);
        els.wait.hidden = false;
        let ticket = null;
        if (API && !SANDBOX) {
            try {
                ticket = await api({ action: 'start', key: playerKey() }, { timeout: 7000 });
                if (ticket.version !== Sim.VERSION) {
                    ticket = null;
                    netSay('Whale 2048 was just updated — reload the page to play for the leaderboard.', 'warn');
                }
            } catch (e) {
                netSay(e.status === 429 ? e.message
                    : 'Can’t reach the leaderboard right now, so this game is offline: it plays the same, but won’t go on the board.', 'warn');
            }
        }
        if (ticket) netSay('');
        else if (!API) netSay('The leaderboard isn’t set up on this copy of the site, so games stay in this browser.', 'warn');
        els.wait.hidden = true;
        busy = false;
        begin(ticket ? Number(ticket.seed) : randomSeed(), ticket);
    }

    /* Send the moves so far. One save at a time per game, in order. */
    function save(g, final, quiet) {
        if (!g || !g.online || !g.runId || g.closed || g.sandbox) return Promise.resolve(null);
        g.queue = (g.queue || Promise.resolve()).then(async function () {
            if (g.closed) return null;
            if (g.moves.length === g.savedLen && !final) return null;
            const len = g.moves.length;
            const body = { action: 'save', key: playerKey(), runId: g.runId, moves: g.moves, gaps: g.gaps.slice(0, len), final: !!final, clientScore: g.st.score };
            const small = JSON.stringify(body).length < 60000;
            try {
                const r = await api(body, { timeout: 12000, keepalive: quiet && small });
                g.savedLen = Math.max(g.savedLen, len);
                if (final || r.over) g.closed = true;
                if (g === game) persist();
                if (!r.stale) saved(r, g);
                return r;
            } catch (e) {
                if (e.status === 409 && /already over/.test(e.message)) { g.closed = true; if (g === game) persist(); }
                if (!quiet) netSay('Couldn’t save your score just now (' + e.message + '). It’s kept here; it’ll try again.', 'warn');
                return null;
            }
        });
        return g.queue;
    }

    function saved(r) {
        if (r.named === false && r.score > 0 && !r.flagged) {
            netSay('Saved. Pick a name below and it goes on the board.', 'ok');
        } else if (r.flagged) {
            netSay('This game didn’t go on the board: it looked automated.', 'warn');
        }
        refreshBoard();
    }

    /* ---------- overlays ---------- */

    function hideOverlay() { els.overlay.hidden = true; els.board.classList.remove('is-over', 'is-won'); }

    function overlay(kind, artE, title, text) {
        els.overArt.textContent = '';
        els.overArt.appendChild(Art.icon(artE, 'Over-icon'));
        els.overArt.style.setProperty('--tile', Art.tileOf(artE));
        els.overArt.classList.toggle('is-dark', Art.isDark(artE));
        els.overTitle.textContent = title;
        els.overText.textContent = text;
        els.overNet.textContent = '';
        els.keepGoing.hidden = kind !== 'won';
        els.overName.hidden = true;
        els.overlay.hidden = false;
        els.board.classList.toggle('is-won', kind === 'won');
        els.board.classList.toggle('is-over', kind === 'over');
        (kind === 'won' ? els.keepGoing : els.overNew).focus({ preventScroll: true });
    }

    function showWin() {
        if (!game) return;
        overlay('won', Sim.WIN, 'You reached King Whale!',
            '2,048 — the top of the food chain. Keep going to chase the Golden King, or start fresh.');
        play('win');
        announce('You reached King Whale!');
    }

    async function gameOver() {
        if (!game) return;
        const g = game;
        overlay('over', g.st.top, 'No more moves!',
            'You grew a ' + Art.nameOf(g.st.top) + ' and scored ' + fmt(g.st.score) + '.');
        play('over');
        announce('No more moves. Score ' + fmt(g.st.score) + '.');
        if (!g.online) {
            els.overNet.textContent = g.sandbox ? '' : 'This game was offline, so it stays in this browser.';
            return;
        }
        els.overNet.textContent = 'Checking your game…';
        const r = g.closed ? null : await save(g, true, false);
        if (g !== game) return;
        if (!r) {
            els.overNet.textContent = g.closed ? '' : 'Couldn’t reach the leaderboard. Your game is kept here.';
            return;
        }
        if (r.flagged) els.overNet.textContent = 'This one didn’t go on the board: it looked automated.';
        else if (!r.named) { els.overNet.textContent = 'Checked! Pick a name to put it on the board.'; els.overName.hidden = false; }
        else if (r.best === r.score) els.overNet.textContent = 'Checked! You’re #' + r.rank + ' on the board.';
        else els.overNet.textContent = 'Checked! Your best (' + fmt(r.best) + ') is #' + r.rank + ' on the board.';
    }

    els.keepGoing.addEventListener('click', function () {
        if (!game) return;
        game.keepGoing = true;
        persist();
        hideOverlay();
        if (!Sim.canMove(game.st.b)) gameOver();       /* the King arrived on a full board */
    });
    els.overNew.addEventListener('click', newGame);
    els.newGame.addEventListener('click', newGame);
    els.overName.addEventListener('click', function () {
        els.name.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
        els.name.focus({ preventScroll: true });
    });

    /* ---------- input: keys ---------- */

    const KEYS = {
        ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R',
        w: 'U', W: 'U', s: 'D', S: 'D', a: 'L', A: 'L', d: 'R', D: 'R'
    };
    document.addEventListener('keydown', function (e) {
        if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        const dir = KEYS[e.key];
        if (!dir || overlayOpen() || !game) return;
        e.preventDefault();
        if (e.repeat) return;             /* holding a key down isn't a move a second */
        go(dir);
    });

    /* ---------- input: swipes (touch, pen, or a mouse drag) ---------- */

    let swipe = null;
    els.board.addEventListener('pointerdown', function (e) {
        if (e.target.closest('.Board-over')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, done: false };
        try { els.board.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
    });
    els.board.addEventListener('pointermove', function (e) {
        if (!swipe || swipe.id !== e.pointerId || swipe.done) return;
        const dx = e.clientX - swipe.x;
        const dy = e.clientY - swipe.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        swipe.done = true;
        go(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : (dy > 0 ? 'D' : 'U'));
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (ev) {
        els.board.addEventListener(ev, function (e) { if (swipe && swipe.id === e.pointerId) swipe = null; });
    });
    /* belt and braces for older phones: a swipe on the board never scrolls the page */
    els.board.addEventListener('touchmove', function (e) {
        if (!e.target.closest('.Board-over')) e.preventDefault();
    }, { passive: false });

    /* ---------- sound button ---------- */

    function showMute(m) {
        els.mute.textContent = m ? '\u{1F507}' : '\u{1F50A}';
        els.mute.setAttribute('aria-pressed', m ? 'true' : 'false');
        els.mute.setAttribute('aria-label', m ? 'Sound off — turn it on' : 'Sound on — mute');
    }
    if (Snd) {
        showMute(Snd.isMuted());
        els.mute.addEventListener('click', function () { showMute(Snd.toggle()); });
    } else {
        els.mute.hidden = true;
    }

    /* ---------- leaderboard ---------- */

    function avatarSrc(avatar, image) {
        if (avatar && avatar.kind === 'alt') {
            const p = 'images/pfp/whale-' + avatar.v + '.svg';
            if (PFP_SAFE.test(p)) return p;
        }
        if (typeof image === 'string' && IMAGE_SAFE.test(image)) return image;
        return 'images/pfp/whale-0.svg';
    }
    function avatarBg(avatar) {
        return avatar && avatar.kind === 'alt' && Av ? Av.pfpColor(avatar.v) : '#fffaf1';
    }

    function boardSay(text) {
        els.lbList.textContent = '';
        els.lbEmpty.textContent = text;
        els.lbEmpty.hidden = false;
    }

    function drawBoard(d) {
        const rows = (d && d.rows) || [];
        els.lbList.textContent = '';
        els.lbEmpty.hidden = rows.length > 0;
        if (!rows.length) els.lbEmpty.textContent = 'No scores yet — be the first.';
        rows.forEach(function (r, i) {
            const li = document.createElement('li');
            li.className = 'Lb-row' + (r.you ? ' is-you' : '') + (i < 3 ? ' is-medal-' + (i + 1) : '');
            const rank = document.createElement('span');
            rank.className = 'Lb-rank';
            rank.textContent = i + 1;
            const pic = document.createElement('img');
            pic.className = 'Lb-pic';
            pic.alt = '';
            pic.width = 40;
            pic.height = 40;
            pic.loading = 'lazy';
            pic.src = avatarSrc(r.avatar, r.image);
            pic.style.setProperty('--seat-bg', avatarBg(r.avatar));
            const name = document.createElement('span');
            name.className = 'Lb-name';
            name.textContent = r.name;                       /* always text, never markup */
            const top = Art.icon(r.top, 'Lb-art');
            const topWrap = document.createElement('span');
            topWrap.className = 'Lb-top';
            topWrap.title = Art.nameOf(r.top);
            topWrap.setAttribute('aria-label', 'best creature: ' + Art.nameOf(r.top));
            topWrap.appendChild(top);
            const score = document.createElement('strong');
            score.className = 'Lb-score';
            score.textContent = fmt(r.score);
            [rank, pic, name, topWrap, score].forEach(function (x) { li.appendChild(x); });
            els.lbList.appendChild(li);
        });

        me = d && d.you ? d.you : me;
        let line = '';
        if (!me || !me.name) line = 'Pick a name below to put your scores on the board.';
        else if (me.best === null || me.best === undefined) line = 'You’re “' + me.name + '”. Score some points to get on the board.';
        else if (!rows.some(function (r) { return r.you; })) line = 'You: #' + me.rank + ' with ' + fmt(me.best) + '.';
        els.lbYou.textContent = line;
        els.lbYou.hidden = !line;

        if (me && me.name && !els.name.value) els.name.value = me.name;
    }

    let boardBusy = false;
    async function refreshBoard() {
        if (!API) { boardSay('The leaderboard isn’t set up on this copy of the site.'); return; }
        if (boardBusy) return;
        boardBusy = true;
        try {
            drawBoard(await api({ action: 'board', key: playerKey() }));
        } catch (e) {
            if (!els.lbList.children.length) boardSay('The leaderboard isn’t answering right now.');
        } finally {
            boardBusy = false;
        }
    }

    /* ---------- your name ---------- */

    function nameSay(text, kind) {
        els.nameStatus.textContent = text || '';
        els.nameStatus.className = 'Wallet-status' + (kind ? ' is-' + kind : '');
    }

    async function claim(name, quiet) {
        if (!API) { nameSay('The leaderboard isn’t set up on this copy of the site.', 'warn'); return; }
        const checked = Sim.checkName(name);
        if (checked.error) { nameSay(checked.error, 'error'); return; }
        els.nameSave.disabled = true;
        if (!quiet) nameSay('Saving…');
        try {
            const avatar = Av ? Av.payload() : { kind: 'alt', v: 0 };
            const r = await api({ action: 'claim', key: playerKey(), name: checked.name, avatar: avatar });
            write(STORE.name, r.name);
            els.name.value = r.name;
            me = Object.assign({}, me || {}, { name: r.name, avatar: r.avatar, image: r.image, best: r.best, rank: r.rank });
            if (!quiet) {
                nameSay(r.best ? 'Saved! You’re #' + r.rank + ' with ' + fmt(r.best) + '.' : 'Saved! Your scores will go on the board as “' + r.name + '”.', 'ok');
            }
            refreshBoard();
        } catch (e) {
            nameSay(e.message, 'error');
        } finally {
            els.nameSave.disabled = false;
        }
    }

    els.nameForm.addEventListener('submit', function (e) {
        e.preventDefault();
        claim(els.name.value, false);
    });

    /* a new whale or pfp follows you onto the board */
    let avatarTimer = 0;
    document.addEventListener('lounge:avatar', function () {
        if (!me || !me.name) return;
        clearTimeout(avatarTimer);
        avatarTimer = setTimeout(function () { claim(me.name, true); }, 500);
    });

    /* ---------- leaving and coming back ---------- */

    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'hidden' || !game) return;
        persist();
        save(game, false, true);
    });
    window.addEventListener('pagehide', persist);

    function restore() {
        const s = read(STORE.game, null);
        if (!s || typeof s.moves !== 'string' || !Number.isFinite(Number(s.seed))) return false;
        let r;
        try { r = Sim.replay(Number(s.seed), s.moves); } catch (e) { return false; }
        if (r.noops) return false;
        game = {
            seed: Number(s.seed), runId: s.runId || null, online: !!(s.online && s.runId && API),
            moves: s.moves, st: r.state, lastAt: Date.now(),
            gaps: Array.isArray(s.gaps) && s.gaps.length === s.moves.length ? s.gaps : new Array(s.moves.length).fill(0),
            keepGoing: !!s.keepGoing, wonShown: !!s.wonShown, savedLen: Number(s.savedLen) || 0, closed: !!s.closed
        };
        drawStatic();
        showScore(0);
        showLadder();
        if (r.over) {
            if (game.closed || !game.online) { newGame(); return true; }
            gameOver();
        } else if (game.st.top >= Sim.WIN && !game.keepGoing) {
            game.wonShown = true;
            showWin();
        } else if (game.online && !game.closed && game.moves.length > game.savedLen) {
            save(game, false, true);
        }
        if (game && !game.online && API) netSay('This game started offline, so it won’t go on the board. Press New game to play for the leaderboard.', 'warn');
        return true;
    }

    /* ---------- tests only ---------- */

    if (SANDBOX) {
        window.W2048Test = {
            /* lay out a board of exponents and play on from there, offline */
            load: function (board, score) {
                settle();
                game = {
                    seed: 1, runId: null, online: false, sandbox: true, moves: '', gaps: [], lastAt: Date.now(),
                    st: { b: board.slice(), score: score || 0, top: Math.max.apply(null, board), r: 12345, n: 0 },
                    keepGoing: false, wonShown: false, savedLen: 0, closed: true
                };
                hideOverlay();
                drawStatic();
                showScore(0);
                showLadder();
            },
            state: function () { return game ? { b: game.st.b.slice(), score: game.st.score, top: game.st.top, moves: game.moves } : null; },
            go: go
        };
    }

    /* ---------- start ---------- */

    Art.ensure();
    buildLadder();
    showScore(0);
    const lounge = read('ssow-lounge-profile', null);
    const savedName = read(STORE.name, '') || (lounge && lounge.name) || '';
    if (typeof savedName === 'string') els.name.value = savedName.slice(0, 16);
    if (!restore()) newGame();
    refreshBoard();
})();
