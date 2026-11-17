/* ============================================================
   Cigar Lounge — Practice mode.

   You against up to five bot whales, all in the browser: the
   engine (poker-engine.js) deals and keeps the rules, the bots
   (poker-bots.js) decide, and poker-table.js draws. Nothing is
   sent anywhere — it's practice.

   The screen is always drawn from PokerEngine.view(table, you),
   so the page can't show a bot's cards before the showdown even
   by accident.
   ============================================================ */

(function () {
    'use strict';

    const E = window.PokerEngine;
    const B = window.PokerBots;
    const $ = function (id) { return document.getElementById(id); };
    const fmt = window.PokerTable.fmt;
    const YOU = 0;

    /* The bot whales: their art lives in images/whales/<id>.webp,
       their traits decide how they play. */
    const ROSTER = [
        { id: 1,    bg: '#83c7b3', Eyes: 'Shy',           Mouth: 'Unshaved Cigar',     Skin: 'Red' },
        { id: 127,  bg: '#add4db', Eyes: 'Glasses',       Mouth: 'Unamused',           Skin: 'Gold' },
        { id: 777,  bg: '#496342', Eyes: 'Skeptical',     Mouth: 'Unamused',           Skin: 'Light Gray' },
        { id: 1784, bg: '#bec4c3', Eyes: 'Laser',         Mouth: 'Grin',               Skin: 'Dark Gray' },
        { id: 2469, bg: '#ab9abf', Eyes: 'Battle Scar',   Mouth: 'Grin',               Skin: 'Pink' },
        { id: 2500, bg: '#c1dbb6', Eyes: 'Circle Shades', Mouth: 'Tongue Out',         Skin: 'Light Blue' },
        { id: 2880, bg: '#e0887a', Eyes: 'Shy',           Mouth: 'Unshaved Toothpick', Skin: 'Pink' },
        { id: 4921, bg: '#ba976a', Eyes: 'Shy',           Mouth: 'Rainbow Grill',      Skin: 'Black' },
        { id: 6465, bg: '#a1c0d6', Eyes: 'Sleepy',        Mouth: 'Grin',               Skin: 'Dark Gray' },
        { id: 9695, bg: '#e28537', Eyes: 'Stoned',        Mouth: 'Unamused',           Skin: 'Gold' }
    ];

    /* where bots sit for 1..5 of them, so the table looks balanced */
    const LAYOUT = { 1: [3], 2: [2, 4], 3: [2, 3, 4], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5] };
    const SPEED = { turbo: 5, regular: 8, slow: 12 };
    const STORE = 'ssow-lounge-settings';
    /* poker.html?fast plays everything at 20x — for testing a whole game */
    const PACE = /[?&]fast(&|$)/.test(window.location.search) ? 0.05 : 1;

    const els = {
        setup: $('setup'), lounge: $('lounge'),
        startChips: $('startChips'), botCount: $('botCount'), deal: $('deal'),
        over: $('over'), overTitle: $('overTitle'), overText: $('overText'),
        again: $('again'), change: $('change')
    };

    const T = window.PokerTable.get({
        table: $('table'), board: $('board'), pot: $('pot'), say: $('say'),
        status: $('status'), actions: $('actions'),
        fold: $('fold'), call: $('call'), raise: $('raise'),
        raiseBox: $('raiseBox'), raiseRange: $('raiseRange'),
        blinds: $('blindsInfo'), log: $('log')
    });

    let table = null;
    let who = [];            /* per seat: { name, img, bg, persona, style } */
    let settings = null;
    let timer = null;
    let rand = Math.random;
    let active = false;      /* practice owns the table right now */

    /* ---------------------------------------------------------
       Settings
       --------------------------------------------------------- */

    function readSettings() {
        const speed = (document.querySelector('input[name="speed"]:checked') || {}).value || 'regular';
        let chips = Math.round(Number(els.startChips.value) / 10) * 10;
        if (!Number.isFinite(chips)) chips = 1500;
        chips = Math.min(100000, Math.max(200, chips));
        els.startChips.value = chips;
        return { chips: chips, bots: Number(els.botCount.value) || 5, speed: speed };
    }

    function loadSettings() {
        try {
            const s = JSON.parse(window.localStorage.getItem(STORE));
            if (!s) return;
            if (s.chips) els.startChips.value = s.chips;
            if (s.bots) els.botCount.value = String(s.bots);
            const r = document.querySelector('input[name="speed"][value="' + s.speed + '"]');
            if (r) r.checked = true;
        } catch (e) { /* defaults are fine */ }
    }

    function saveSettings(s) {
        try { window.localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { /* fine */ }
    }

    /* a fresh, unguessable seed per game, so no two tables run the same */
    function newRand() {
        let seed = Math.floor(Math.random() * 4294967296);
        try {
            const a = new Uint32Array(1);
            window.crypto.getRandomValues(a);
            seed = a[0];
        } catch (e) { /* Math.random seed is fine for practice */ }
        return E.rng32(seed);
    }

    /* ---------------------------------------------------------
       A game
       --------------------------------------------------------- */

    function startGame() {
        settings = readSettings();
        saveSettings(settings);
        rand = newRand();
        active = true;

        const bots = ROSTER.slice();
        for (let i = bots.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = bots[i]; bots[i] = bots[j]; bots[j] = tmp;
        }

        who = [null, null, null, null, null, null];
        const players = [null, null, null, null, null, null];
        who[YOU] = { name: 'You', img: 'images/OG_logo-nav.webp', bg: '#fffaf1', logo: true };
        players[YOU] = { id: 'you', name: 'You', stack: settings.chips };
        LAYOUT[settings.bots].forEach(function (s, i) {
            const r = bots[i];
            const traits = ['Eyes', 'Mouth', 'Skin'].map(function (k) { return { trait_type: k, value: r[k] }; });
            const persona = B.personaFor(traits);
            who[s] = { name: 'Whale #' + r.id, img: 'images/whales/' + r.id + '.webp', bg: r.bg, persona: persona, style: persona.style };
            players[s] = { id: 'bot' + r.id, name: who[s].name, stack: settings.chips };
        });

        table = E.createTable(players);
        T.setPlayers(who, YOU);
        T.onAct(function (action) { apply(YOU, action); });
        T.clearLog();
        T.say('');
        els.over.hidden = true;
        els.setup.hidden = true;
        els.lounge.hidden = false;
        document.dispatchEvent(new CustomEvent('lounge:mode', { detail: 'practice' }));
        els.lounge.scrollIntoView({ block: 'start', behavior: 'smooth' });
        clearTimeout(timer);
        timer = setTimeout(nextHand, 500 * PACE);
    }

    function handsPerLevel() { return SPEED[settings.speed] || 8; }

    function blindsText() {
        const lv = table.hand ? table.hand.blinds : E.blinds(table);
        const per = handsPerLevel();
        const left = per - (table.handNo % per || per) + 1;
        T.blinds('Blinds ' + fmt(lv[0]) + '/' + fmt(lv[1]) + ' · hand ' + table.handNo +
            ' · blinds go up in ' + left + (left === 1 ? ' hand' : ' hands'));
    }

    function draw(newHand) {
        const v = E.view(table, YOU);
        T.render(v, { newHand: newHand });
        blindsText();
        if (!T.controls(v) && v.hand && !v.hand.result && who[v.hand.toAct]) {
            T.status(who[v.hand.toAct].name + ' is thinking…');
        }
    }

    function nextHand() {
        if (!active) return;
        if (table.finished || table.seats[YOU].out) { gameOver(); return; }
        table.levelIndex = Math.floor(table.handNo / handsPerLevel());
        E.startHand(table, rand);
        if (table.finished) { gameOver(); return; }
        T.log('Hand ' + table.hand.no + ' · blinds ' + fmt(table.hand.blinds[0]) + '/' + fmt(table.hand.blinds[1]), 'is-hand');
        draw(true);
        step();
    }

    /* bots think, you click */
    function step() {
        clearTimeout(timer);
        if (!active) return;
        const h = table.hand;
        if (h.result) { showResult(); return; }
        draw();
        const s = h.toAct;
        if (s === YOU) return;
        const think = (650 + Math.random() * 750) * PACE;
        timer = setTimeout(function () {
            apply(s, B.decide(E.view(table, s), s, who[s].persona, Math.random));
        }, think);
    }

    function apply(s, action) {
        if (!active || !table.hand || table.hand.result || table.hand.toAct !== s) return;
        const before = table.hand.log.length;
        try {
            E.act(table, s, action);
        } catch (err) {
            /* a bot should never pick an illegal move; if one does, it folds or checks */
            const L = E.legal(table, s);
            if (!L) return;
            E.act(table, s, L.canCheck ? { type: 'check' } : { type: 'fold' });
        }
        table.hand.log.slice(before).forEach(T.entry);
        step();
    }

    function showResult() {
        draw();
        T.hideControls();
        const r = table.hand.result;
        T.result(E.view(table, YOU));
        T.status(r.showdown ? 'Showdown' : 'Hand over');
        timer = setTimeout(function () {
            T.say('');
            if (table.finished || table.seats[YOU].out) gameOver();
            else nextHand();
        }, (r.showdown ? 4200 : 2200) * PACE);
    }

    function ordinal(n) { return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }

    function gameOver() {
        clearTimeout(timer);
        const me = table.seats[YOU];
        const won = table.finished && table.winner === YOU;
        const seated = table.seats.filter(Boolean).length;
        els.overTitle.textContent = won ? 'You win the Lounge!' : 'You finished ' + ordinal(me.place || seated);
        els.overText.textContent = won
            ? 'Last whale standing after ' + table.handNo + ' hands.'
            : 'Out on hand ' + table.handNo + ' of a ' + seated + '-whale table.';
        els.again.hidden = false;
        els.change.hidden = false;
        els.over.hidden = false;
        T.hideControls();
        T.status('Game over');
        els.again.focus({ preventScroll: true });
    }

    /* the online tables take the same table over */
    document.addEventListener('lounge:mode', function (e) {
        if (e.detail !== 'practice') { active = false; clearTimeout(timer); }
    });

    els.deal.addEventListener('click', startGame);
    els.again.addEventListener('click', startGame);
    els.change.addEventListener('click', function () {
        if (!active) return;
        active = false;
        clearTimeout(timer);
        els.lounge.hidden = true;
        els.setup.hidden = false;
        els.setup.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });

    loadSettings();
})();
