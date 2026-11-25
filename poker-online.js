/* ============================================================
   Cigar Lounge — Play with friends (multiplayer tables).

   The server (supabase/functions/poker) is the dealer: it shuffles,
   deals, keeps the rules and the clock. This page only:
     - hosts or joins a table and keeps its seat key in this browser
       (so reopening the link puts you back in your seat),
     - listens for the public table (Supabase Realtime pushes every
       change; a slow poll covers anything missed),
     - asks the server for its OWN two cards — nobody else's are ever
       sent here until the showdown,
     - sends your moves, and pings `tick` when it sees a deadline
       pass, so time-outs happen even if nobody clicks.

   Tournaments (up to 20 players, one link) come from the same server
   as one public row holding every table. This page shows your own
   table (or, once you're out, any table you pick) through the same
   table drawing as a normal game, plus the sign-up list, standings
   and "you've been moved" notices.

   Everything a player typed (names) goes on screen as plain text.
   Avatars: this page sends only which one (an OG whale's number or one
   of our pfps — see poker-avatar.js); the server finds the picture and
   tells everyone its URL. No wallet ever reaches a table.
   ============================================================ */

(function () {
    'use strict';

    const E = window.PokerEngine;
    const $ = function (id) { return document.getElementById(id); };
    const fmt = window.PokerTable.fmt;
    const CONFIG = window.WHALE_ROAD_CONFIG || {};
    const params = new URLSearchParams(window.location.search);
    /* poker.html?backend=local talks to tools/dev-poker.ts instead */
    const LOCAL = params.get('backend') === 'local';
    const API = LOCAL ? 'http://localhost:8788' : (CONFIG.supabaseUrl ? CONFIG.supabaseUrl + '/functions/v1/poker' : '');

    const SEATS_STORE = 'ssow-lounge-seats';     /* { CODE: { key, seat } } */
    const PROFILE_STORE = 'ssow-lounge-profile'; /* { name } */
    const RESULT_MS = 4500;
    const SHOWDOWN_MS = 7000;

    const els = {
        tabPractice: $('tabPractice'), tabOnline: $('tabOnline'),
        setup: $('setup'), online: $('online'), lounge: $('lounge'),
        you: $('you'), name: $('playerName'),
        hostChips: $('hostChips'), hostSeats: $('hostSeats'), hostGo: $('hostGo'),
        joinCode: $('joinCode'), joinGo: $('joinGo'), status: $('onlineStatus'),
        room: $('room'), roomCode: $('roomCode'), roomLink: $('roomLink'), roomCopy: $('roomCopy'),
        roomStatus: $('roomStatus'), roomStart: $('roomStart'), roomBack: $('roomBack'), roomLeave: $('roomLeave'),
        over: $('over'), overTitle: $('overTitle'), overText: $('overText'),
        again: $('again'), change: $('change'), overLobby: $('overLobby'),
        tourney: $('tourney'), tourneyLine: $('tourneyLine'), tourneyTables: $('tourneyTables'),
        tourneyList: $('tourneyList'), tableBox: $('table'),
        roomLabel: document.querySelector('.Room-code .Field-label')
    };

    const T = window.PokerTable.get({
        table: $('table'), board: $('board'), pot: $('pot'), say: $('say'),
        status: $('status'), actions: $('actions'),
        fold: $('fold'), call: $('call'), raise: $('raise'),
        raiseBox: $('raiseBox'), raiseRange: $('raiseRange'),
        blinds: $('blindsInfo'), log: $('log')
    });

    let active = false;      /* the table on screen is an online one */
    let code = null;
    let key = null;
    let mySeat = -1;
    let pub = null;          /* the latest public table */
    let version = 0;
    let rosterKey = '';
    let myCards = null;
    let myHand = 0;
    let handShown = 0;       /* hand number already announced in the log */
    let logShown = 0;        /* entries of that hand already logged */
    let resultShown = 0;
    let clockOffset = 0;     /* server clock minus ours */
    let channel = null;
    let pollTimer = null;
    let clockTimer = null;
    let ticking = false;
    let present = null;      /* seats with a browser open (Realtime presence) */
    let tour = null;         /* the latest tournament (all its tables), or null at a normal table */
    let myEntrant = -1;      /* your number in the tournament */
    let viewTable = -1;      /* which of its tables is on screen */
    let pickedTable = -1;    /* the table you chose to watch once you're out */
    let notice = null;       /* { text, until }: "you've been moved" */
    let outNoted = false;
    let quietDue = 0;        /* a deadline a tick already found nothing to do for */
    let quietUntil = 0;

    /* ---------------------------------------------------------
       Small helpers
       --------------------------------------------------------- */

    function read(store, fallback) {
        try { return JSON.parse(window.localStorage.getItem(store)) || fallback; } catch (e) { return fallback; }
    }
    function write(store, value) {
        try { window.localStorage.setItem(store, JSON.stringify(value)); } catch (e) { /* fine */ }
    }

    function say(text, kind) {
        els.status.textContent = text || '';
        els.status.className = 'Online-status' + (kind ? ' is-' + kind : '');
    }

    function serverNow() { return Date.now() + clockOffset; }

    function cleanCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }

    /* a crowded table (a tournament at the start) can briefly answer "busy": try again a few times */
    async function api(action, body) {
        for (let attempt = 0; ; attempt++) {
            try { return await callApi(action, body); } catch (e) {
                if (!(e.status === 409 && /busy/.test(e.message)) || attempt >= 3) throw e;
                await new Promise(function (r) { setTimeout(r, 250 + Math.random() * 500 * (attempt + 1)); });
            }
        }
    }

    async function callApi(action, body) {
        if (!API) throw new Error('multiplayer isn’t set up on this copy of the site');
        let res;
        try {
            res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(Object.assign({ action: action }, body || {}))
            });
        } catch (e) {
            const err = new Error('the lounge isn’t answering — check your connection and try again');
            err.status = 0;
            throw err;
        }
        let data = {};
        try { data = await res.json(); } catch (e) { /* empty */ }
        if (!res.ok) {
            const err = new Error(data.error || 'something went wrong');
            err.status = res.status;
            throw err;
        }
        return data;
    }

    /* ---------------------------------------------------------
       Lobby: who you are, host, join
       --------------------------------------------------------- */

    function profile() {
        const name = els.name.value.replace(/\s+/g, ' ').trim();
        if (name.length < 2 || name.length > 16) throw new Error('pick a name of 2 to 16 characters');
        if (!/^[\p{L}\p{N} _.\-]+$/u.test(name)) throw new Error('names can use letters, numbers, spaces and _ . -');
        write(PROFILE_STORE, { name: name });
        const avatar = window.LoungeAvatar ? window.LoungeAvatar.payload() : { kind: 'alt', v: 0 };
        return { name: name, avatar: avatar };
    }

    function loadProfile() {
        const p = read(PROFILE_STORE, null);
        if (p && p.name) els.name.value = p.name;
    }

    function remember(c, k, seat, entrant) {
        const all = read(SEATS_STORE, {});
        all[c] = { key: k, seat: seat, entrant: entrant === undefined ? -1 : entrant, at: Date.now() };
        /* keep the last few tables only */
        Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; }).slice(10).forEach(function (old) { delete all[old]; });
        write(SEATS_STORE, all);
    }

    function forget(c) {
        const all = read(SEATS_STORE, {});
        delete all[c];
        write(SEATS_STORE, all);
    }

    function busy(on) {
        els.hostGo.disabled = on;
        els.joinGo.disabled = on;
    }

    async function host() {
        let me;
        try { me = profile(); } catch (e) { say(e.message, 'error'); els.name.focus(); return; }
        busy(true);
        say('Opening a table…');
        try {
            const r = await api('create', {
                name: me.name, avatar: me.avatar,
                chips: Number(els.hostChips.value),
                seats: els.hostSeats.value === 'tournament' ? 'tournament' : Number(els.hostSeats.value),
                speed: (document.querySelector('input[name="hostSpeed"]:checked') || {}).value || 'regular'
            });
            remember(r.code, r.key, r.seat, r.entrant);
            say('');
            enter(r.code, r.key, r.seat, r.table, r.entrant);
        } catch (e) {
            say(e.message, 'error');
        } finally {
            busy(false);
        }
    }

    async function join(c) {
        let me;
        try { me = profile(); } catch (e) { say(e.message, 'error'); els.name.focus(); return; }
        c = cleanCode(c || els.joinCode.value);
        if (c.length !== 6) { say('table codes are 6 letters and numbers', 'error'); els.joinCode.focus(); return; }
        busy(true);
        say('Finding a seat…');
        try {
            const r = await api('join', { code: c, name: me.name, avatar: me.avatar });
            remember(r.code, r.key, r.seat, r.entrant);
            say('');
            enter(r.code, r.key, r.seat, r.table, r.entrant);
        } catch (e) {
            /* a game that has started can still be watched */
            if (e.status === 409 && /started/.test(e.message)) {
                say('That game has already started — you can watch it.', 'warn');
                watch(c);
            } else {
                say(e.message, 'error');
            }
        } finally {
            busy(false);
        }
    }

    async function watch(c) {
        try {
            const r = await api('state', { code: c });
            enter(c, null, -1, r.table);
        } catch (e) {
            say(e.message, 'error');
        }
    }

    /* opened from a link: back into your seat if this browser has one */
    async function fromLink(c) {
        showOnline();
        els.joinCode.value = c;
        const mine = read(SEATS_STORE, {})[c];
        if (mine && mine.key) {
            say('Taking you back to your seat…');
            try {
                const m = await api('me', { code: c, key: mine.key });
                const s = await api('state', { code: c });
                say('');
                enter(c, mine.key, m.seat, s.table, m.entrant);
                return;
            } catch (e) {
                if (e.status === 401 || e.status === 404) forget(c);
                if (e.status === 404) { say(e.message, 'error'); return; }
            }
        }
        try {
            const s = await api('state', { code: c });
            if (s.table.status === 'waiting') {
                say((s.table.kind === 'tournament' ? 'Tournament ' : 'Table ') + c + ' — pick a name and a whale, then press Take a seat.');
                els.name.focus();
            } else {
                watch(c);
            }
        } catch (e) {
            say(e.message, 'error');
        }
    }

    /* ---------------------------------------------------------
       Modes
       --------------------------------------------------------- */

    function setTab(online) {
        els.tabPractice.setAttribute('aria-selected', online ? 'false' : 'true');
        els.tabOnline.setAttribute('aria-selected', online ? 'true' : 'false');
        els.setup.hidden = online;
        els.online.hidden = !online;
    }

    function showOnline() {
        document.dispatchEvent(new CustomEvent('lounge:mode', { detail: 'lobby' }));
        setTab(true);
        els.lounge.hidden = true;
    }

    function showPractice() {
        document.dispatchEvent(new CustomEvent('lounge:mode', { detail: 'lobby' }));
        setTab(false);
        els.lounge.hidden = true;
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname + (LOCAL ? '?backend=local' : ''));
    }

    document.addEventListener('lounge:mode', function (e) {
        if (e.detail !== 'online') stop();
        if (e.detail === 'practice') {
            els.room.hidden = true;
            els.overLobby.hidden = true;
        }
    });

    /* ---------------------------------------------------------
       At the table
       --------------------------------------------------------- */

    function enter(c, k, seat, table, entrant) {
        stop();
        tour = null;
        myEntrant = entrant === undefined || entrant === null ? -1 : entrant;
        viewTable = -1;
        pickedTable = -1;
        notice = null;
        outNoted = false;
        els.tourney.hidden = true;
        els.tableBox.removeAttribute('data-felt');
        if (els.roomLabel) els.roomLabel.textContent = 'Table';
        els.roomStart.textContent = 'Start the game';
        document.dispatchEvent(new CustomEvent('lounge:mode', { detail: 'online' }));
        active = true;
        code = c;
        key = k;
        mySeat = seat;
        pub = null;
        version = 0;
        rosterKey = '';
        myCards = null;
        myHand = 0;
        handShown = 0;
        logShown = 0;
        resultShown = 0;
        present = null;
        T.clearLog();
        T.say('');
        T.onAct(send);
        T.hush(2500);          /* a table we join mid-hand catches up quietly */

        els.setup.hidden = true;
        els.online.hidden = true;
        els.lounge.hidden = false;
        els.room.hidden = false;
        els.over.hidden = true;
        els.roomCode.textContent = c;
        const link = window.location.origin + window.location.pathname + '?table=' + c + (LOCAL ? '&backend=local' : '');
        els.roomLink.value = link;
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', link.replace(window.location.origin, ''));
        els.lounge.scrollIntoView({ block: 'start', behavior: 'smooth' });

        onPublic(table);
        listen();
        clockTimer = setInterval(clock, 500);
    }

    function stop() {
        active = false;
        if (channel) { try { channel.unsubscribe(); } catch (e) { /* gone */ } channel = null; }
        clearInterval(pollTimer);
        clearInterval(clockTimer);
        pollTimer = null;
        clockTimer = null;
    }

    function backToLobby() {
        stop();
        els.room.hidden = true;
        els.over.hidden = true;
        els.overLobby.hidden = true;
        T.hideControls();
        showOnline();
        if (window.history && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname + (LOCAL ? '?backend=local' : ''));
    }

    /* Supabase Realtime pushes every change to pk_public (a table
       browsers can read but not write). A slow poll covers anything
       missed; with no Realtime (local testing) it polls quickly. */
    function listen() {
        const fast = LOCAL || !CONFIG.supabaseUrl || !CONFIG.anonKey;
        pollTimer = setInterval(function () { if (!document.hidden || fast) refresh(); }, fast ? 1000 : 8000);
        if (fast) return;
        loadRealtime(function () {
            if (!active || !window.supabase || !window.supabase.createClient) return;
            try {
                const client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false } });
                const myCode = code;
                channel = client.channel('lounge-' + myCode, { config: { presence: { key: myEntrant >= 0 ? 'e' + myEntrant : String(mySeat >= 0 ? mySeat : 'watch-' + Math.random()) } } })
                    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pk_public', filter: 'code=eq.' + myCode }, function (msg) {
                        if (active && code === myCode && msg.new && msg.new.data) onPublic(msg.new.data);
                    })
                    .on('presence', { event: 'sync' }, function () {
                        const state = channel.presenceState();
                        present = {};
                        Object.keys(state).forEach(function (k) { if (/^(\d|e\d+)$/.test(k)) present[k] = true; });
                        if (pub) draw();
                    })
                    .subscribe(function (status) {
                        if (status === 'SUBSCRIBED') {
                            channel.track({ at: Date.now() });
                            refresh();
                        }
                    });
            } catch (e) { /* the poll still works */ }
        });
    }

    let realtimeLoading = null;
    function loadRealtime(done) {
        if (window.supabase && window.supabase.createClient) { done(); return; }
        if (!realtimeLoading) {
            realtimeLoading = [];
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
            script.onload = function () { realtimeLoading.forEach(function (f) { f(); }); realtimeLoading = null; };
            document.head.appendChild(script);
        }
        if (realtimeLoading) realtimeLoading.push(done);
    }

    async function refresh() {
        if (!active || !code) return;
        try {
            const r = await api('state', { code: code });
            onPublic(r.table);
        } catch (e) {
            if (e.status === 404) { T.status(e.message); stop(); }
        }
    }

    /* the server's clock moves only when someone calls: when this browser
       sees a deadline pass, it asks the dealer to run what's due */
    function clock() {
        if (!active || !pub) return;
        draw(true);
        if (tour) { tourClock(); return; }
        if (pub.status !== 'playing' || !pub.table) return;
        const h = pub.table.hand;
        let due = 0;
        if (h && !h.result) due = pub.deadline;
        else if (h && h.result) due = pub.resultAt + (h.result.showdown ? SHOWDOWN_MS : RESULT_MS);
        if (!due || ticking) return;
        /* each seat waits a little differently, so six browsers don't all call at once */
        const spread = 250 + (mySeat >= 0 ? mySeat : 6) * 180;
        if (serverNow() < due + spread) return;
        ticking = true;
        api('tick', { code: code })
            .then(function (r) { onPublic(r.table); })
            .catch(function () { /* the next look will try again */ })
            .then(function () { setTimeout(function () { ticking = false; }, 600); });
    }

    function tourClock() {
        if (tour.status !== 'playing' || ticking) return;
        let due = 0;
        tour.tables.forEach(function (Tb) {
            if (Tb.closed || Tb.idle || !Tb.table) return;
            const h = Tb.table.hand;
            let d = 0;
            if (h && !h.result) d = Tb.deadline;
            else if (h && h.result) d = Tb.resultAt + (h.result.showdown ? SHOWDOWN_MS : RESULT_MS);
            if (d && (!due || d < due)) due = d;
        });
        if (!due) return;
        if (due === quietDue && Date.now() < quietUntil) return;
        /* each player waits a little differently, so twenty browsers don't all call at once */
        const spread = 250 + ((myEntrant >= 0 ? myEntrant : 21) % 24) * 110;
        if (serverNow() < due + spread) return;
        ticking = true;
        api('tick', { code: code })
            .then(function (r) {
                if (!r.changed) { quietDue = due; quietUntil = Date.now() + 4000; }
                onPublic(r.table);
            })
            .catch(function () { /* the next look will try again */ })
            .then(function () { setTimeout(function () { ticking = false; }, 600); });
    }

    async function fetchMyCards(handNo) {
        if (mySeat < 0 || !key) return;
        try {
            const m = await api('me', { code: code, key: key });
            if (m.hand === handNo && (!tour || m.table === viewTable + 1)) { myCards = m.cards; myHand = handNo; draw(); }
        } catch (e) {
            if (e.status === 401) { T.status('This browser lost its seat key — you can still watch.'); mySeat = -1; key = null; }
        }
    }

    async function send(action) {
        if (!pub || !pub.table || !pub.table.hand) return;
        T.status('Sending…');
        try {
            const r = await api('act', Object.assign({ code: code, key: key, hand: pub.table.hand.no, table: tour ? viewTable + 1 : undefined }, action));
            onPublic(r.table);
        } catch (e) {
            T.status(e.message);
            await refresh();
            draw();
        }
    }

    /* ---------------------------------------------------------
       Drawing the public table
       --------------------------------------------------------- */

    /* the picture the server picked for this player (never a link a
       browser supplied), or our first pfp if it couldn't find one */
    function avatarOf(p) {
        const a = p.avatar || {};
        if (a.kind === 'alt' && window.LoungeAvatar) return { img: window.LoungeAvatar.pfpImage(a.v), bg: window.LoungeAvatar.pfpColor(a.v) };
        if (p.image) return { img: p.image, bg: '#fffaf1' };
        return { img: 'images/pfp/whale-0.svg', bg: '#83c7b3' };
    }

    function seatPlayers(p) {
        const sig = JSON.stringify(p.players.map(function (x) { return x && [x.name, x.image, x.avatar]; })) + ':' + mySeat;
        if (sig === rosterKey) return;
        rosterKey = sig;
        const who = p.players.map(function (x, s) {
            if (!x) return null;
            const w = avatarOf(x);
            return { name: x.name, img: w.img, bg: w.bg, style: s === p.host ? 'Host' : '' };
        });
        /* you always sit at the bottom: turn the table round your seat */
        const turn = mySeat >= 0 ? mySeat : 0;
        T.setPlayers(who, mySeat, function (s) { return (s - turn + 6) % 6; });
    }

    function onPublic(p) {
        if (!active || !p || p.code !== code) return;
        if (p.version < version) return;
        const fresh = p.version > version;
        version = p.version;
        clockOffset = p.now - Date.now();
        if (p.kind === 'tournament') { tour = p; pub = tourView(p); }
        else { tour = null; pub = p; }
        seatPlayers(pub);
        if (fresh) draw();
    }

    /* ---------------------------------------------------------
       Tournaments
       --------------------------------------------------------- */

    /* the tournament, seen as one table: yours, or the one you watch */
    function tourView(p) {
        const me = myEntrant >= 0 ? p.entrants[myEntrant] : null;
        let ti = -1;
        if (me && !me.place && me.table >= 0) ti = me.table;
        else if (pickedTable >= 0 && p.tables[pickedTable] && !p.tables[pickedTable].closed) ti = pickedTable;
        else {
            /* the busiest open table */
            let best = -1;
            p.tables.forEach(function (Tb, i) {
                if (Tb.closed || !Tb.table) return;
                const n = Tb.table.seats.filter(Boolean).length;
                if (best < 0 || n > p.tables[best].table.seats.filter(Boolean).length) best = i;
            });
            ti = best;
        }
        if (ti !== viewTable) {
            if (viewTable >= 0 && ti >= 0 && me && !me.place) {
                notice = { text: p.tables[ti].final ? 'You’re at the final table!' : 'You’ve been moved to Table ' + (ti + 1) + '.', until: Date.now() + 9000 };
                T.sound('turn', 0.5);
            }
            viewTable = ti;
            rosterKey = '';
            handShown = 0;
            logShown = 0;
            resultShown = 0;
            myCards = null;
            myHand = 0;
            T.clearLog();
            T.hush(1500);
        }
        mySeat = me && !me.place && !me.moving && me.table === ti ? me.seat : -1;
        const Tb = ti >= 0 ? p.tables[ti] : null;
        const players = [0, 1, 2, 3, 4, 5].map(function (s) {
            const seat = Tb && Tb.table && Tb.table.seats[s];
            if (!seat) return null;
            const ei = Number(String(seat.id).slice(1));
            const e = p.entrants[ei];
            return e ? { name: e.name, avatar: e.avatar, image: e.image, whale: e.whale, sittingOut: e.sittingOut, pkey: 'e' + ei } : null;
        });
        return {
            code: p.code, version: p.version, now: p.now, status: p.status,
            settings: { chips: p.settings.chips, speed: p.settings.speed, seats: 6 },
            host: -1, players: players,
            startedAt: p.startedAt, deadline: Tb ? Tb.deadline : 0, resultAt: Tb ? Tb.resultAt : 0,
            levelMs: p.levelMs, turnMs: p.turnMs, table: Tb ? withPlaces(p, Tb.table) : null, tour: true
        };
    }

    /* a busted seat shows its place in the whole tournament, not just at this table */
    function withPlaces(p, table) {
        if (!table) return table;
        const v = JSON.parse(JSON.stringify(table));
        v.seats.forEach(function (seat) {
            if (!seat) return;
            const e = p.entrants[Number(String(seat.id).slice(1))];
            if (e && e.place) seat.place = e.place;
        });
        return v;
    }

    function entrantPic(e) {
        const w = avatarOf(e);
        return w.img;
    }

    function rosterItem(e, i, extra, out) {
        const li = document.createElement('li');
        if (i === myEntrant) li.className = 'is-me';
        if (out) li.classList.add('is-out');
        const img = document.createElement('img');
        img.src = entrantPic(e);
        img.alt = '';
        const name = document.createElement('span');
        name.className = 'Tn-name';
        name.textContent = e.name + (i === tour.host && tour.status === 'waiting' ? ' (host)' : '');
        li.append(img, name);
        if (extra) {
            const c = document.createElement('span');
            c.className = 'Tn-chips';
            c.textContent = extra;
            li.appendChild(c);
        }
        return li;
    }

    /* waiting for the start: who's signed up */
    function drawTourLobby() {
        const list = tour.entrants.map(function (e, i) { return e ? i : -1; }).filter(function (i) { return i >= 0; });
        const amHost = myEntrant >= 0 && tour.host === myEntrant;
        if (els.roomLabel) els.roomLabel.textContent = 'Tournament';
        T.render({ seats: [null, null, null, null, null, null], button: -1, hand: null }, {});
        T.hideControls();
        els.roomStart.hidden = !amHost;
        els.roomStart.disabled = list.length < 2;
        els.roomStart.textContent = 'Start the tournament';
        els.roomBack.hidden = true;
        els.roomLeave.hidden = myEntrant < 0;
        els.roomStatus.textContent = tour.status === 'closed' ? 'This tournament was closed.'
            : list.length + ' of ' + tour.settings.max + ' signed up · ' +
              (amHost ? (list.length < 2 ? 'waiting for at least one more player' : 'start whenever everyone’s in')
                      : 'waiting for the host to start');
        T.status(myEntrant < 0 ? 'Watching' : 'You’re in — waiting for the start');
        els.tourney.hidden = false;
        els.tourneyLine.textContent = 'Tournament · up to ' + tour.settings.max + ' players at tables of 6 · ' +
            fmt(tour.settings.chips) + ' chips each · last whale standing wins';
        els.tourneyTables.textContent = '';
        els.tourneyList.textContent = '';
        list.forEach(function (i) { els.tourneyList.appendChild(rosterItem(tour.entrants[i], i, '', false)); });
    }

    /* playing (or over): where you are, the standings, the other tables */
    function drawTour(tick) {
        els.tourney.hidden = false;
        if (els.roomLabel) els.roomLabel.textContent = 'Tournament';
        const all = tour.entrants.map(function (e, i) { return e ? i : -1; }).filter(function (i) { return i >= 0; });
        const alive = all.filter(function (i) { return !tour.entrants[i].place || (tour.status === 'finished' && tour.entrants[i].place === 1); });
        const me = myEntrant >= 0 ? tour.entrants[myEntrant] : null;
        const Tb = viewTable >= 0 ? tour.tables[viewTable] : null;
        const ranked = alive.slice().sort(function (a, b) { return tour.entrants[b].stack - tour.entrants[a].stack; });
        let line = (Tb ? (Tb.final ? 'Final table' : 'Table ' + (viewTable + 1)) + ' · ' : '') +
            (tour.status === 'finished' ? 'tournament over' : alive.length + ' of ' + all.length + ' left');
        if (me && me.place && tour.status === 'playing') line += ' · you finished ' + ordinal(me.place) + ', now watching';
        else if (me && me.moving) line += ' · you’ll sit in at Table ' + (me.table + 1) + ' when its hand ends';
        else if (me && !me.place && tour.status === 'playing') {
            /* your rank by chips; level stacks (like at the start) don't get a rank */
            const mine = me.stack;
            const above = alive.filter(function (i) { return tour.entrants[i].stack > mine; }).length;
            const level = alive.every(function (i) { return tour.entrants[i].stack === mine; });
            if (!level) line += ' · you’re ' + (alive.some(function (i) { return i !== myEntrant && tour.entrants[i].stack === mine; }) ? 'joint ' : '') + ordinal(above + 1) + ' in chips';
        }
        if (notice && Date.now() < notice.until) line = notice.text + ' ' + line;
        els.tourneyLine.textContent = line;
        if (tour.status === 'playing') els.roomStatus.textContent = alive.length + ' of ' + all.length + ' whales still in' + (me && me.sittingOut && !me.place ? ' · you’re sitting out' : '');
        if (tick) return;

        if (me && me.place && tour.status === 'playing' && !outNoted) {
            outNoted = true;
            T.sound('lose', 0.4);
            T.status('You’re out in ' + ordinal(me.place) + ' place — watch the rest from any table');
        }

        /* felt colour: one per table, gold for the final */
        if (Tb) els.tableBox.setAttribute('data-felt', Tb.final ? 'final' : String((viewTable % 4) + 1));

        /* other tables: only to watch, once you're not playing */
        els.tourneyTables.textContent = '';
        const canPick = !me || !!me.place;
        const open = tour.tables.filter(function (x) { return !x.closed; });
        if (canPick && open.length > 1 && tour.status === 'playing') {
            tour.tables.forEach(function (x, i) {
                if (x.closed) return;
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'Btn';
                b.textContent = 'Table ' + (i + 1) + ' · ' + (x.table ? x.table.seats.filter(Boolean).length : 0);
                b.setAttribute('aria-pressed', i === viewTable ? 'true' : 'false');
                b.addEventListener('click', function () {
                    pickedTable = i;
                    pub = tourView(tour);
                    seatPlayers(pub);
                    draw();
                });
                els.tourneyTables.appendChild(b);
            });
        }

        /* standings: chips for those still in, places for the rest */
        els.tourneyList.textContent = '';
        ranked.forEach(function (i) {
            const e = tour.entrants[i];
            els.tourneyList.appendChild(rosterItem(e, i, fmt(e.stack) + (tour.status === 'playing' && e.table >= 0 ? ' · T' + (e.table + 1) : ''), false));
        });
        all.filter(function (i) { return alive.indexOf(i) < 0; })
            .sort(function (a, b) { return tour.entrants[a].place - tour.entrants[b].place; })
            .forEach(function (i) { els.tourneyList.appendChild(rosterItem(tour.entrants[i], i, ordinal(tour.entrants[i].place), true)); });
    }

    function tourOver() {
        if (!els.over.hidden) return;
        const n = tour.entrants.filter(Boolean).length;
        const w = tour.winner >= 0 ? tour.entrants[tour.winner] : null;
        const me = myEntrant >= 0 ? tour.entrants[myEntrant] : null;
        if (me) T.sound(tour.winner === myEntrant ? 'win' : 'lose', 0.4);
        if (me && tour.winner === myEntrant) {
            els.overTitle.textContent = 'You win the tournament!';
            els.overText.textContent = 'Last whale standing out of ' + n + '.';
        } else if (me) {
            els.overTitle.textContent = 'You finished ' + ordinal(me.place) + ' of ' + n;
            els.overText.textContent = (w ? w.name + ' won the tournament.' : 'The tournament is over.');
        } else {
            els.overTitle.textContent = 'Tournament over';
            els.overText.textContent = (w ? w.name + ' won, ' : '') + 'out of ' + n + ' players.';
        }
        els.again.hidden = true;
        els.change.hidden = true;
        els.overLobby.hidden = false;
        els.over.hidden = false;
        T.status('Tournament over');
        forget(code);
    }

    function lobbyView(p) {
        return {
            seats: p.players.map(function (x) { return x ? { stack: p.settings.chips } : null; }),
            button: -1,
            hand: null
        };
    }

    function blindsText(p) {
        const t = p.table;
        if (!t) {
            T.blinds('Starting chips ' + fmt(p.settings.chips) + ' · blinds start at ' +
                fmt(E.LEVELS[0][0]) + '/' + fmt(E.LEVELS[0][1]) + ', up every ' + Math.round(p.levelMs / 60000) + ' min');
            return;
        }
        const lv = t.hand ? t.hand.blinds : E.blinds(t);
        const next = p.startedAt + (Math.floor((serverNow() - p.startedAt) / p.levelMs) + 1) * p.levelMs;
        const left = Math.max(0, next - serverNow());
        const mm = Math.floor(left / 60000);
        const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
        T.blinds('Blinds ' + fmt(lv[0]) + '/' + fmt(lv[1]) + ' · hand ' + t.handNo +
            (p.status === 'playing' ? ' · next level in ' + mm + ':' + ss : ''));
    }

    /* tick: true when called by the clock (only times and the status move) */
    function draw(tick) {
        if (tour && (tour.status === 'waiting' || tour.status === 'closed')) {
            blindsText(pub);
            if (!tick) drawTourLobby();
            return;
        }
        if (tour && !pub.table) { blindsText(pub); drawTour(tick); return; }
        drawTable(tick);
        if (tour) drawTour(tick);
    }

    function drawTable(tick) {
        const p = pub;
        if (!p) return;
        const seated = p.players.filter(Boolean).length;
        const amHost = mySeat >= 0 && p.host === mySeat;
        const meP = mySeat >= 0 ? p.players[mySeat] : null;
        blindsText(p);

        if (p.status === 'waiting' || p.status === 'closed') {
            if (tick) return;
            T.render(lobbyView(p), {});
            T.hideControls();
            els.roomStart.hidden = !amHost;
            els.roomStart.disabled = seated < 2;
            els.roomBack.hidden = true;
            els.roomLeave.hidden = mySeat < 0;
            els.roomStatus.textContent = p.status === 'closed' ? 'This table was closed.'
                : seated + ' of ' + p.settings.seats + ' seats taken · ' +
                  (amHost ? (seated < 2 ? 'waiting for at least one more player' : 'start whenever you’re ready')
                          : 'waiting for the host to start');
            T.status(mySeat < 0 ? 'Watching' : 'Waiting for the game to start');
            return;
        }

        const v = JSON.parse(JSON.stringify(p.table));
        const h = v.hand;

        /* your own cards come from the server separately */
        if (h && mySeat >= 0 && h.dealt[mySeat]) {
            if (myHand === h.no && myCards) v.hand.holes[mySeat] = myCards;
            else if (!tick) fetchMyCards(h.no);
        }

        const away = p.players.map(function (x, s) { return !!x && !!present && !present[x.pkey || String(s)] && s !== mySeat; });
        const sittingOut = p.players.map(function (x) { return !!(x && x.sittingOut); });
        const timer = h && !h.result && p.deadline ? { seat: h.toAct, endsAt: p.deadline - clockOffset, total: p.turnMs } : null;

        if (!tick) {
            const newHand = !!h && h.no !== handShown;
            if (newHand) {
                handShown = h.no;
                logShown = 0;
                T.log('Hand ' + h.no + ' · blinds ' + fmt(h.blinds[0]) + '/' + fmt(h.blinds[1]), 'is-hand');
                T.say('');
            }
            if (h) {
                h.log.slice(logShown).forEach(T.entry);
                logShown = h.log.length;
            }
            T.render(v, { newHand: newHand, away: away, sittingOut: sittingOut, timer: timer });
            if (h && h.result && resultShown !== h.no) {
                resultShown = h.no;
                T.result(v);
            }
        }

        /* room bar */
        els.roomStart.hidden = true;
        els.roomLeave.hidden = true;
        els.roomBack.hidden = !(meP && meP.sittingOut && p.status === 'playing');
        const left = v.seats.filter(function (x) { return x && !x.out; }).length;
        els.roomStatus.textContent = p.status === 'finished' ? 'Game over'
            : left + ' whales still in' + (meP && meP.sittingOut ? ' · you’re sitting out' : '');

        if (p.status === 'finished') {
            T.hideControls();
            if (!tick) gameOver(v);
            return;
        }

        if (tick) {
            /* keep the countdown in the status line honest */
            if (h && !h.result && h.toAct !== mySeat && p.players[h.toAct]) {
                const secs = Math.max(0, Math.ceil((p.deadline - serverNow()) / 1000));
                T.status(p.players[h.toAct].name + ' is thinking… ' + secs + 's');
            }
            return;
        }

        if (meP && meP.sittingOut) {
            T.hideControls();
            T.status('You’re sitting out — press I’m back to play again');
        } else if (!(h && T.controls(v))) {
            if (!h) T.status('Dealing…');
            else if (h.result) T.status(h.result.showdown ? 'Showdown' : 'Hand over');
            else if (p.players[h.toAct]) T.status(p.players[h.toAct].name + ' is thinking…');
        }
    }

    function ordinal(n) { return n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'); }

    function gameOver(v) {
        if (tour) { tourOver(); return; }
        if (!els.over.hidden) return;
        const winner = v.winner !== undefined && pub.players[v.winner] ? pub.players[v.winner].name : '';
        const mine = mySeat >= 0 ? v.seats[mySeat] : null;
        if (mine) T.sound(v.winner === mySeat ? 'win' : 'lose', 0.4);
        if (mine && v.winner === mySeat) {
            els.overTitle.textContent = 'You win the Lounge!';
            els.overText.textContent = 'Last whale standing after ' + v.handNo + ' hands.';
        } else if (mine) {
            els.overTitle.textContent = 'You finished ' + ordinal(mine.place || 2);
            els.overText.textContent = (winner ? winner + ' won' : 'Game over') + ' after ' + v.handNo + ' hands.';
        } else {
            els.overTitle.textContent = 'Game over';
            els.overText.textContent = (winner ? winner + ' won' : 'The table is done') + ' after ' + v.handNo + ' hands.';
        }
        els.again.hidden = true;
        els.change.hidden = true;
        els.overLobby.hidden = false;
        els.over.hidden = false;
        T.status('Game over');
        forget(code);
    }

    /* ---------------------------------------------------------
       Wiring
       --------------------------------------------------------- */

    els.tabPractice.addEventListener('click', showPractice);
    els.tabOnline.addEventListener('click', showOnline);
    els.hostGo.addEventListener('click', host);
    els.hostSeats.addEventListener('change', function () {
        els.hostGo.textContent = els.hostSeats.value === 'tournament' ? 'Open the tournament' : 'Open the table';
    });
    els.joinGo.addEventListener('click', function () { join(); });
    els.joinCode.addEventListener('input', function () { els.joinCode.value = cleanCode(els.joinCode.value); });
    els.roomCopy.addEventListener('click', function () {
        const done = function () { els.roomCopy.textContent = 'Copied!'; setTimeout(function () { els.roomCopy.textContent = 'Copy link'; }, 1500); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(els.roomLink.value).then(done, function () { els.roomLink.select(); });
        else { els.roomLink.select(); }
    });
    els.roomStart.addEventListener('click', async function () {
        els.roomStart.disabled = true;
        try { onPublic((await api('start', { code: code, key: key })).table); }
        catch (e) { els.roomStatus.textContent = e.message; els.roomStart.disabled = false; }
    });
    els.roomBack.addEventListener('click', async function () {
        try { onPublic((await api('back', { code: code, key: key })).table); }
        catch (e) { T.status(e.message); }
    });
    els.roomLeave.addEventListener('click', async function () {
        if (key && pub && pub.status === 'waiting') {
            /* (a tournament waiting for its start counts too) */
            try { await api('leave', { code: code, key: key }); } catch (e) { /* leaving anyway */ }
            forget(code);
        }
        backToLobby();
    });
    els.overLobby.addEventListener('click', backToLobby);

    loadProfile();

    const linked = cleanCode(params.get('table'));
    if (linked.length === 6) fromLink(linked);
})();
