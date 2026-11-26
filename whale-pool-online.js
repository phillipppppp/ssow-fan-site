/* ============================================================
   Whale Pool — online with friends (a 1v1 link or a tournament).

   The server (supabase/functions/pool) is the referee: it racks,
   replays every shot with the same whale-pool-sim.js this page
   plays, runs the shot clock and the bracket. This page only:
     - hosts or joins a game and keeps its key in this browser
       (reopening the link puts you back in your seat),
     - listens for the public game (Supabase Realtime pushes each
       change; a slow poll covers anything missed): the game's
       `main` part, plus, in a tournament, the one match on screen,
     - sends your shots, and calls `tick` when it sees a deadline
       pass, so the shot clock runs even if nobody shoots,
     - tells the other screen where you're aiming (a Realtime
       broadcast, a few times a second — looks only, never trusted),
     - draws the room: the link, who's in, the bracket.
   The table itself is whale-pool.js, through window.WhalePoolGame.

   A 1v1 link: the first friend to open it plays the host; anyone
   after that watches. A tournament: up to 32 on one link, the host
   starts it, a knockout with every match at once, the final best
   of 3. Online, cues are looks only (everyone gets the host's aim
   lines and full power and spin), and no Pearls change hands.

   Names go on screen as plain text. Avatars: this page only says
   which one (an OG whale's number or one of our pfps — see
   poker-avatar.js); the server finds the picture. No wallet ever
   reaches a game.
   ============================================================ */

(function () {
    'use strict';

    const Game = window.WhalePoolGame;
    const Cues = window.WhalePoolCues;
    const S = window.WhalePoolSim;
    if (!Game || !Cues || !S) return;

    const $ = function (id) { return document.getElementById(id); };
    const CONFIG = window.WHALE_ROAD_CONFIG || {};
    const params = new URLSearchParams(window.location.search);
    /* whale-pool.html?backend=local talks to tools/dev-pool.ts instead */
    const LOCAL = params.get('backend') === 'local';
    const API = LOCAL ? 'http://localhost:8789' : (CONFIG.supabaseUrl ? CONFIG.supabaseUrl + '/functions/v1/pool' : '');
    const REALTIME = !LOCAL && !!CONFIG.supabaseUrl && !!CONFIG.anonKey;

    const KEYS_STORE = 'ssow-pool-keys';            /* { CODE: { key, seat, entrant, at } } */
    const PROFILE_STORE = 'ssow-lounge-profile';    /* { name }, shared with the Cigar Lounge */
    const TAB_STORE = 'ssow-pool-tab';
    const SWEEP_MS = 45000;                         /* a tournament's slow safety tick */

    const els = {
        where: $('where'), tabHere: $('tabHere'), tabOnline: $('tabOnline'),
        setup: $('setup'), online: $('online'), shop: $('shop'), game: $('game'),
        name: $('playerName'), youCue: $('youCue'),
        hostMatch: $('hostMatch'), hostTour: $('hostTour'), joinCode: $('joinCode'), joinGo: $('joinGo'),
        status: $('onlineStatus'),
        room: $('room'), roomKind: $('roomKind'), roomCode: $('roomCode'), roomLink: $('roomLink'), roomCopy: $('roomCopy'),
        roomStatus: $('roomStatus'), roomList: $('roomList'), roomStart: $('roomStart'), roomLeave: $('roomLeave'),
        bracketWrap: $('bracketWrap'), bracket: $('bracket')
    };
    if (!els.online || !els.room) return;

    /* ---------------------------------------------------------
       State
       --------------------------------------------------------- */

    let active = false;      /* a game is open on this page */
    let code = '';
    let key = null;
    let mySeat = -1;         /* 1v1: 0 host, 1 friend, -1 watching */
    let myEntrant = -1;      /* tournament: your number, or -1 */
    let main = null;         /* the latest main part */
    let match = null;        /* the latest match on the table */
    let versions = {};       /* part -> newest version seen */
    let viewing = '';        /* which match is on the table ('m' for a 1v1) */
    let picked = '';         /* the tournament match you chose to watch */
    let lastMine = '';       /* your latest tournament match */
    let clockOffset = 0;
    let mainChannel = null, tableChannel = null, tableChannelId = '';
    let present = {};
    let pollTimer = null, clockTimer = null;
    let ticking = false, quietDue = 0, quietUntil = 0, nextSweep = 0;
    let aimPending = null, aimTimer = null, aimLast = 0;
    let client = null;

    /* ---------------------------------------------------------
       Small helpers
       --------------------------------------------------------- */

    function read(store, fallback) {
        try { return JSON.parse(window.localStorage.getItem(store)) || fallback; } catch (e) { return fallback; }
    }
    function write(store, value) {
        try { window.localStorage.setItem(store, JSON.stringify(value)); } catch (e) { /* fine */ }
    }
    function serverNow() { return Date.now() + clockOffset; }
    function cleanCode(raw) { return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); }
    function isT() { return !!main && main.kind === 'tournament'; }

    function say(text, kind) {
        els.status.textContent = text || '';
        els.status.className = 'Online-status' + (kind ? ' is-' + kind : '');
    }

    /* a busy tournament can briefly answer "busy": try again a few times */
    async function api(action, body) {
        for (let attempt = 0; ; attempt++) {
            try { return await callApi(action, body); } catch (e) {
                if (!(e.status === 409 && /busy/.test(e.message)) || attempt >= 3) throw e;
                await new Promise(function (r) { setTimeout(r, 250 + Math.random() * 500 * (attempt + 1)); });
            }
        }
    }

    async function callApi(action, body) {
        if (!API) throw new Error('online games aren’t set up on this copy of the site');
        let res;
        try {
            res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(Object.assign({ action: action }, body || {}))
            });
        } catch (e) {
            const err = new Error('the game server isn’t answering — check your connection and try again');
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

    function remember(c, k, seat, entrant) {
        const all = read(KEYS_STORE, {});
        all[c] = { key: k, seat: seat, entrant: entrant, at: Date.now() };
        Object.keys(all).sort(function (a, b) { return all[b].at - all[a].at; }).slice(12).forEach(function (old) { delete all[old]; });
        write(KEYS_STORE, all);
    }
    function forget(c) {
        const all = read(KEYS_STORE, {});
        delete all[c];
        write(KEYS_STORE, all);
    }

    /* ---------------------------------------------------------
       The lobby: who you are, host, join
       --------------------------------------------------------- */

    function profile() {
        const name = els.name.value.replace(/\s+/g, ' ').trim();
        if (name.length < 2 || name.length > 16) throw new Error('Pick a name of 2 to 16 characters first.');
        if (!/^[\p{L}\p{N} _.\-]+$/u.test(name)) throw new Error('Names can use letters, numbers, spaces and _ . -');
        write(PROFILE_STORE, { name: name });
        const avatar = window.LoungeAvatar ? window.LoungeAvatar.payload() : { kind: 'alt', v: 0 };
        return { name: name, avatar: avatar, cue: Cues.equipped().id };
    }

    function busy(on) {
        [els.hostMatch, els.hostTour, els.joinGo].forEach(function (b) { b.disabled = on; });
    }

    function chosen(name, fallback) {
        const i = document.querySelector('input[name="' + name + '"]:checked');
        return i ? i.value : fallback;
    }

    async function host(kind) {
        let me;
        try { me = profile(); } catch (e) { say(e.message, 'error'); els.name.focus(); return; }
        busy(true);
        say(kind === 'tournament' ? 'Opening a tournament…' : 'Getting you a link…');
        try {
            const r = await api('create', Object.assign({ kind: kind, mode: chosen('omode', '8'), guides: chosen('oguides', 'full') }, me));
            remember(r.code, r.key, r.seat, r.entrant);
            say('');
            enter(r.code, r.key, r.seat, r.entrant, r.main, null);
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
        if (c.length !== 6) { say('Game codes are 6 letters and numbers.', 'error'); els.joinCode.focus(); return; }
        busy(true);
        say('Joining…');
        try {
            const r = await api('join', Object.assign({ code: c }, me));
            remember(r.code, r.key, r.seat, r.entrant);
            say('');
            enter(r.code, r.key, r.seat, r.entrant, r.main, null);
        } catch (e) {
            if (e.status === 409 && /watch/.test(e.message)) {
                say(e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.', 'warn');
                watch(c);
            } else {
                say(e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.', 'error');
            }
        } finally {
            busy(false);
        }
    }

    async function watch(c) {
        try {
            const r = await api('state', { code: c });
            enter(c, null, -1, -1, r.main, null);
        } catch (e) {
            say(e.message, 'error');
        }
    }

    /* opened from a link: back into your seat if this browser has one */
    async function fromLink(c) {
        setTab(true);
        els.joinCode.value = c;
        const mine = read(KEYS_STORE, {})[c];
        if (mine && mine.key) {
            say('Taking you back to your game…');
            try {
                const m = await api('me', { code: c, key: mine.key });
                const s = await api('state', { code: c });
                say('');
                enter(c, mine.key, m.seat, m.entrant, s.main, null);
                return;
            } catch (e) {
                if (e.status === 401 || e.status === 404) forget(c);
                if (e.status === 404) { say(e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.', 'error'); return; }
            }
        }
        try {
            const s = await api('state', { code: c });
            const p = s.main;
            const open = p.status === 'waiting' && (p.kind === 'tournament' || !p.players[1]);
            if (open) {
                say((p.kind === 'tournament' ? 'Tournament ' : 'Game ') + c + ' by ' + hostName(p) + ' — pick a name' +
                    (window.LoungeAvatar ? ' and a whale' : '') + ', then press Join.', 'ok');
                els.joinGo.textContent = p.kind === 'tournament' ? 'Sign up' : 'Join';
                els.name.focus();
            } else {
                say(p.status === 'closed' ? 'That game was closed.' : '', p.status === 'closed' ? 'warn' : '');
                if (p.status !== 'closed') watch(c);
            }
        } catch (e) {
            say(e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.', 'error');
        }
    }

    function hostName(p) {
        const list = p.kind === 'tournament' ? p.entrants : p.players;
        const h = list[p.host];
        return h ? h.name : 'a friend';
    }

    /* ---------------------------------------------------------
       Tabs: on this screen / online
       --------------------------------------------------------- */

    function setTab(online) {
        els.tabHere.setAttribute('aria-selected', online ? 'false' : 'true');
        els.tabOnline.setAttribute('aria-selected', online ? 'true' : 'false');
        els.setup.hidden = online;
        els.online.hidden = !online;
        write(TAB_STORE, online ? 'online' : 'here');
        if (online && els.youCue) els.youCue.textContent = Cues.equipped().name;
    }
    els.tabHere.addEventListener('click', function () { setTab(false); });
    els.tabOnline.addEventListener('click', function () { setTab(true); });

    /* a game on this screen hides the tabs too */
    document.addEventListener('pool:table', function (e) {
        if (e.detail) { els.where.hidden = true; els.online.hidden = true; return; }
        if (active) return;
        els.where.hidden = false;
        setTab(els.tabOnline.getAttribute('aria-selected') === 'true');
    });

    /* ---------------------------------------------------------
       In a game
       --------------------------------------------------------- */

    function linkFor(c) {
        return window.location.origin + window.location.pathname + '?game=' + c + (LOCAL ? '&backend=local' : '');
    }

    /* the address bar follows the game (so a reload comes back to it), keeping any other settings */
    function setAddress(c) {
        if (!window.history || !window.history.replaceState) return;
        const q = new URLSearchParams(window.location.search);
        if (c) q.set('game', c); else q.delete('game');
        const s = q.toString().replace(/=(&|$)/g, '$1');
        window.history.replaceState(null, '', window.location.pathname + (s ? '?' + s : ''));
    }

    function enter(c, k, seat, entrant, mainPart, matchPart) {
        stop();
        active = true;
        code = c;
        key = k;
        mySeat = typeof seat === 'number' ? seat : -1;
        myEntrant = typeof entrant === 'number' ? entrant : -1;
        main = null;
        match = null;
        versions = {};
        viewing = '';
        picked = '';
        lastMine = '';
        present = {};
        nextSweep = Date.now() + SWEEP_MS * (0.5 + Math.random());
        els.where.hidden = true;
        els.setup.hidden = true;
        els.online.hidden = true;
        els.shop.hidden = true;
        els.room.hidden = false;
        els.roomCode.textContent = c;
        els.roomLink.value = linkFor(c);
        setAddress(c);
        try { els.room.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* fine */ }
        listenMain();
        pollTimer = setInterval(function () { if (!document.hidden || !REALTIME) refresh(); }, REALTIME ? 8000 : 1000);
        clockTimer = setInterval(clock, 500);
        onMain(mainPart);
        if (matchPart) onMatch(matchPart);
    }

    function stop() {
        active = false;
        unlisten();
        clearInterval(pollTimer);
        clearInterval(clockTimer);
        clearTimeout(aimTimer);
        pollTimer = clockTimer = aimTimer = null;
        aimPending = null;
    }

    /* back to the lobby (the key stays: the link brings you back) */
    function toLobby(msg, kind) {
        stop();
        Game.stop();
        els.room.hidden = true;
        els.bracketWrap.hidden = true;
        els.where.hidden = false;
        Game.showSetup();
        setTab(true);
        say(msg || '', kind);
        els.joinGo.textContent = 'Join';
        setAddress('');
    }

    /* the table's own ✕: at a tournament, unless it's your live match, that
       just puts the table away (you stay in the room, with the bracket) */
    function leaveTable() {
        if (!active) return;
        if (isT() && main && main.status !== 'waiting' && !(viewing && viewing === currentMine() && myMatchLive())) {
            picked = '';
            lastMine = '';
            showMatch('');
            return;
        }
        leaveRoom(true);
    }

    async function leaveRoom(ask) {
        if (!active) return;
        const playing = main && main.status === 'playing';
        const inMatch = playing && myMatchLive();
        if (ask && inMatch && !window.confirm(isT()
            ? 'Leave? The shot clock keeps running, so you’ll lose this match unless you come back (the link brings you back).'
            : 'Leave this game? Your friend can’t finish it without you (the link brings you back).')) return;
        if (main && main.status === 'waiting' && key) {
            try { await api('leave', { code: code, key: key }); } catch (e) { /* fine */ }
            forget(code);
        }
        toLobby();
    }

    els.roomLeave.addEventListener('click', function () { leaveRoom(true); });
    els.roomStart.addEventListener('click', async function () {
        els.roomStart.disabled = true;
        try {
            const r = await api('start', { code: code, key: key });
            onMain(r.main);
        } catch (e) {
            els.roomStatus.textContent = e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.';
        } finally {
            els.roomStart.disabled = false;
        }
    });
    els.roomCopy.addEventListener('click', function () {
        const done = function () { els.roomCopy.textContent = 'Copied!'; setTimeout(function () { els.roomCopy.textContent = 'Copy link'; }, 1600); };
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(els.roomLink.value).then(done, function () { els.roomLink.select(); }); return; }
        } catch (e) { /* below */ }
        els.roomLink.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* the text is selected */ }
    });

    /* ---------------------------------------------------------
       Listening: Realtime, the poll, the clock
       --------------------------------------------------------- */

    let realtimeLoading = null;
    function loadRealtime(done) {
        if (window.supabase && window.supabase.createClient) { done(); return; }
        if (!realtimeLoading) {
            realtimeLoading = [];
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
            script.onload = function () { const q = realtimeLoading; realtimeLoading = null; q.forEach(function (f) { f(); }); };
            document.head.appendChild(script);
        }
        if (realtimeLoading) realtimeLoading.push(done);
    }

    function rt() {
        if (!client && window.supabase && window.supabase.createClient) client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false } });
        return client;
    }

    function listenMain() {
        if (!REALTIME) return;
        const myCode = code;
        loadRealtime(function () {
            if (!active || code !== myCode || !rt()) return;
            try {
                mainChannel = client.channel('pool-' + myCode)
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'pl_public', filter: 'id=eq.' + myCode + '_main' }, function (msg) {
                        if (active && code === myCode && msg.new && msg.new.data) onMain(msg.new.data);
                    })
                    .subscribe(function (status) { if (status === 'SUBSCRIBED') refresh(); });
            } catch (e) { /* the poll still works */ }
        });
    }

    /* the table's own channel: its updates (tournaments), who's here, where they aim */
    function listenTable(id) {
        if (tableChannelId === id) return;
        if (tableChannel) { try { tableChannel.unsubscribe(); } catch (e) { /* gone */ } tableChannel = null; }
        tableChannelId = id;
        present = {};
        if (!REALTIME || !id) return;
        const myCode = code;
        loadRealtime(function () {
            if (!active || code !== myCode || tableChannelId !== id || !rt()) return;
            try {
                const me = presenceKey();
                let ch = client.channel('pool-' + myCode + '-' + id, { config: { presence: { key: me }, broadcast: { self: false } } });
                if (id !== 'm') {
                    ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: 'pl_public', filter: 'id=eq.' + myCode + '_' + id }, function (msg) {
                        if (active && code === myCode && msg.new && msg.new.data) onMatch(msg.new.data);
                    });
                }
                tableChannel = ch
                    .on('broadcast', { event: 'aim' }, function (msg) { if (active && viewing === id && msg && msg.payload) Game.aim(msg.payload); })
                    .on('presence', { event: 'sync' }, function () {
                        const state = ch.presenceState();
                        present = {};
                        Object.keys(state).forEach(function (k) { present[k] = true; });
                        renderRoom();
                    })
                    .subscribe(function (status) {
                        if (status === 'SUBSCRIBED') {
                            if (me.charAt(0) !== 'w') ch.track({ at: Date.now() });
                            refresh();
                        }
                    });
            } catch (e) { /* the poll still works */ }
        });
    }

    function presenceKey() {
        if (isT()) return myEntrant >= 0 ? 'e' + myEntrant : 'w' + Math.random().toString(36).slice(2, 8);
        return mySeat >= 0 ? 'p' + mySeat : 'w' + Math.random().toString(36).slice(2, 8);
    }

    function unlisten() {
        [mainChannel, tableChannel].forEach(function (ch) { if (ch) { try { ch.unsubscribe(); } catch (e) { /* gone */ } } });
        mainChannel = tableChannel = null;
        tableChannelId = '';
    }

    async function refresh() {
        if (!active || !code) return;
        try {
            const r = await api('state', { code: code, part: isT() ? viewing : '' });
            onMain(r.main);
            if (r.match) onMatch(r.match);
        } catch (e) {
            if (e.status === 404) toLobby(e.message.charAt(0).toUpperCase() + e.message.slice(1) + '.', 'error');
        }
    }

    /* the server's clock only moves when someone calls: when a deadline
       passes on the table, ask the referee to run what's due */
    function clock() {
        if (!active || !main) return;
        if (main.status !== 'playing') return;
        const m = match;
        let due = 0;
        if (m && viewing && m.id === viewing) {
            if (m.status === 'playing') due = m.deadline;
            else if (m.status === 'between') due = m.nextAt;
        }
        if (m && m.status === 'between') refreshCard();
        if (isT() && Date.now() > nextSweep) {
            nextSweep = Date.now() + SWEEP_MS * (0.7 + Math.random() * 0.6);
            doTick(0);
            return;
        }
        if (!due || ticking) return;
        if (due === quietDue && Date.now() < quietUntil) return;
        /* players first, a little apart, then anyone watching */
        const who = isT() ? myEntrant : mySeat;
        const playing = m && m.seats && who >= 0 && m.seats.indexOf(isT() ? myEntrant : mySeat) >= 0;
        const spread = playing ? 250 + (who % 8) * 150 : 1600 + Math.random() * 1200;
        if (serverNow() < due + spread) return;
        doTick(due);
    }

    function doTick(due) {
        if (ticking) return;
        ticking = true;
        api('tick', { code: code, part: isT() ? viewing : '' })
            .then(function (r) {
                if (!r.changed && due) { quietDue = due; quietUntil = Date.now() + 4000; }
                onMain(r.main);
                if (r.match) onMatch(r.match);
            })
            .catch(function () { /* the next look will try again */ })
            .then(function () { setTimeout(function () { ticking = false; }, 600); });
    }

    /* ---------------------------------------------------------
       News from the referee
       --------------------------------------------------------- */

    function fresher(part, p) {
        if (!p) return false;
        const v = versions[part] || 0;
        if (p.version < v) return false;
        versions[part] = p.version;
        if (typeof p.now === 'number') clockOffset = p.now - Date.now();
        return true;
    }

    function onMain(p) {
        if (!active || !p || p.code !== code) return;
        if (!fresher('main', p)) return;
        main = p;
        if (p.status === 'closed') { forget(code); toLobby('That game was closed.', 'warn'); return; }
        if (!isT()) {
            if (p.match) onMatch(p.match, true);
            else { if (Game.active()) Game.stop(); viewing = ''; listenTable(''); }
        } else {
            chooseMatch();
        }
        renderRoom();
    }

    /* tournament: which match belongs on the table */
    function currentMine() {
        const me = myEntrant >= 0 && main.entrants[myEntrant];
        return me && me.at ? me.at : '';
    }
    function bracketMatch(id) {
        const r = /^m(\d+)_(\d+)$/.exec(id || '');
        if (!r || !main.rounds[Number(r[1])]) return null;
        return main.rounds[Number(r[1])][Number(r[2])] || null;
    }
    function myMatchLive() {
        if (!isT()) return !!(main && main.match && main.match.status === 'playing' && mySeat >= 0);
        const b = bracketMatch(currentMine());
        return !!b && (b.status === 'playing' || b.status === 'between');
    }

    function chooseMatch() {
        if (main.status === 'waiting') { showMatch(''); return; }
        const mine = currentMine();
        const b = bracketMatch(mine);
        let want = '';
        if (b && (b.status === 'playing' || b.status === 'between')) want = mine;
        else if (picked && bracketMatch(picked) && bracketMatch(picked).status !== 'pending') want = picked;
        else if (viewing && viewing === lastMine) want = viewing;          // your finished match stays up with its result
        if (want === mine && want) lastMine = mine;
        showMatch(want);
    }

    async function showMatch(id) {
        if (id === viewing) return;
        const mine = id && id === currentMine();
        viewing = id;
        match = null;
        listenTable(id);
        if (!id) {
            if (Game.active()) Game.stop();
            renderRoom();
            if (isT() && main && main.status !== 'waiting') els.bracketWrap.hidden = false;
            return;
        }
        if (mine) Game.sound('turn');
        try {
            const r = await api('state', { code: code, part: id });
            if (viewing !== id) return;
            onMain(r.main);
            if (r.match) onMatch(r.match);
        } catch (e) { /* the poll tries again */ }
    }

    function onMatch(m, inMain) {
        if (!active || !m) return;
        if (!inMain && !fresher(m.id, m)) return;
        if (isT()) { if (m.id !== viewing) return; }
        else { viewing = 'm'; listenTable('m'); }
        match = m;
        const seat = isT() ? m.seats.indexOf(myEntrant) : mySeat;
        if (!Game.active() || Game.active() && tableFor !== m.id + ':' + seat) {
            tableFor = m.id + ':' + seat;
            Game.playOnline({
                mode: main.settings.mode,
                guides: main.settings.guides,
                seat: seat,
                players: playersOf(m),
                match: m,
                now: serverNow,
                intro: introFor(m, seat),
                scroll: true,
                hooks: { send: sendShot, aim: sendAim, over: refreshCard, again: rematch, change: cardButton, leave: leaveTable }
            });
        } else {
            Game.sync(m);
        }
        renderRoom();
    }
    let tableFor = '';

    function personOf(i) {
        const list = isT() ? main.entrants : main.players;
        return list[i] || null;
    }

    function picOf(p) {
        const a = (p && p.avatar) || {};
        if (a.kind === 'alt') return { pic: 'images/pfp/whale-' + (a.v || 0) + '.svg', bg: window.LoungeAvatar ? window.LoungeAvatar.pfpColor(a.v || 0) : '#83c7b3' };
        if (p && p.image) return { pic: p.image, bg: '#fffaf1' };
        return { pic: 'images/pfp/whale-0.svg', bg: '#83c7b3' };
    }

    function playersOf(m) {
        return m.seats.map(function (i, s) {
            const p = personOf(i) || { name: '?', cue: 'house' };
            const look = picOf(p);
            const me = isT() ? i === myEntrant : s === mySeat;
            return { name: p.name, pic: look.pic, bg: look.bg, cueId: p.cue || 'house', me: me, bot: null };
        });
    }

    function nameOf(m, s) { const p = personOf(m.seats[s]); return p ? p.name : '?'; }
    function iAm(m, s) { return isT() ? m.seats[s] === myEntrant && myEntrant >= 0 : s === mySeat; }

    function roundName(id) {
        const r = Number(/^m(\d+)_/.exec(id)[1]);
        const left = main.rounds.length - r;
        if (left === 1) return 'the final';
        if (left === 2) return 'the semi-finals';
        if (left === 3) return 'the quarter-finals';
        return 'the round of ' + Math.pow(2, left);
    }

    /* one match, by its round: "Semi-final" */
    function matchTitle(id) {
        const r = Number(/^m(\d+)_/.exec(id)[1]);
        const left = main.rounds.length - r;
        if (left === 1) return 'Final';
        if (left === 2) return 'Semi-final';
        if (left === 3) return 'Quarter-final';
        return 'Round of ' + Math.pow(2, left);
    }

    function introFor(m, seat) {
        const b = m.game ? m.game.turn : m.breaker;
        const breaks = iAm(m, b) ? 'your break.' : nameOf(m, b) + ' breaks.';
        if (!isT()) return (m.gameNo > 1 ? 'Rack ' + m.gameNo + ': ' : 'Game on! ') + cap(breaks);
        const where = matchTitle(m.id) + (m.bestOf > 1 ? ' (best of ' + m.bestOf + ')' : '');
        if (seat >= 0) return where + ': you vs ' + nameOf(m, 1 - seat) + '. ' + cap(breaks);
        return where + ': ' + nameOf(m, 0) + ' vs ' + nameOf(m, 1) + '. ' + cap(breaks);
    }
    function cap(t) { return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; }

    /* ---------------------------------------------------------
       Shots, rematches, aim
       --------------------------------------------------------- */

    async function sendShot(input, no) {
        try {
            const r = await api('shot', { code: code, key: key, no: no, input: input });
            onMain(r.main);
            if (r.match) onMatch(r.match);
        } catch (e) {
            /* the referee said no: take its table */
            let m = null;
            try {
                const s = await api('state', { code: code, part: isT() ? viewing : '' });
                onMain(s.main);
                m = isT() ? s.match : s.main.match;
                if (m) { versions[m.id] = Math.max(versions[m.id] || 0, m.version || 0); match = m; }
            } catch (e2) { /* keep what we have */ }
            if (m) Game.resync(m, cap(e.message) + '.');
        }
    }

    async function rematch() {
        if (!key || isT()) return;
        try {
            const r = await api('rematch', { code: code, key: key });
            onMain(r.main);
        } catch (e) {
            Game.say(cap(e.message) + '.', 'foul');
        }
    }

    function cardButton() {
        if (isT()) {
            /* back to the bracket: stop watching (your own finished match just steps aside) */
            picked = '';
            if (viewing === lastMine) lastMine = '';
            showMatch('');
            try { els.bracketWrap.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* fine */ }
            return;
        }
        leaveRoom(false);
    }

    /* where you're aiming, a few times a second at most: fewer when a
       tournament has many tables going, to stay inside Realtime's limits */
    function sendAim(d) {
        if (!tableChannel || !REALTIME) return;
        const others = Object.keys(present).filter(function (k) { return k !== presenceKey(); }).length;
        if (!others) return;
        aimPending = d;
        if (aimTimer) return;
        const live = isT() ? main.rounds.reduce(function (n, r) { return n + r.filter(function (x) { return x.status === 'playing'; }).length; }, 0) : 1;
        const gap = Math.max(160, live * 60);
        const wait = Math.max(0, aimLast + gap - Date.now());
        aimTimer = setTimeout(function () {
            aimTimer = null;
            aimLast = Date.now();
            const p = aimPending;
            aimPending = null;
            if (!p || !tableChannel) return;
            try { tableChannel.send({ type: 'broadcast', event: 'aim', payload: p }); } catch (e) { /* looks only */ }
        }, wait);
    }

    /* ---------------------------------------------------------
       The game-over card
       --------------------------------------------------------- */

    function score(m) {
        const a = nameOrYou(m, 0), b = nameOrYou(m, 1);
        return a + ' ' + m.wins[0] + ' – ' + m.wins[1] + ' ' + b;
    }
    function nameOrYou(m, s) { return iAm(m, s) ? 'You' : nameOf(m, s); }

    function refreshCard() {
        const m = match;
        if (!m || !Game.active()) return;
        if (m.status === 'playing' && !(m.game && m.game.over)) { Game.card(null); return; }
        const g = m.games[m.games.length - 1];
        if (!g) { Game.card(null); return; }
        const winMe = iAm(m, g.w), byMe = iAm(m, g.by);
        const why = (byMe ? 'You ' : nameOf(m, g.by) + ' ') + g.why + '.';
        const watching = isT() ? m.seats.indexOf(myEntrant) < 0 : mySeat < 0;
        /* the message line under the scoreboard says it too */
        const card = function (c) {
            Game.card(c);
            Game.say(c.title + ' ' + c.text, watching || winMe ? 'good' : 'foul');
        };
        if (!isT()) {
            const other = 1 - mySeat;
            let again = null, off = false;
            if (!watching) {
                if (m.rematch[mySeat]) { again = 'Waiting for ' + nameOf(m, other) + '…'; off = true; }
                else again = m.rematch[other] ? nameOf(m, other) + ' wants a rematch — play!' : 'Rematch';
            }
            card({
                title: winMe ? 'You win!' : nameOf(m, g.w) + ' wins!',
                text: why, note: score(m),
                again: again, againOff: off, change: 'Leave'
            });
            return;
        }
        if (m.status === 'between') {
            const secs = Math.max(0, Math.ceil((m.nextAt - serverNow()) / 1000));
            card({
                title: (winMe ? 'You take' : nameOf(m, g.w) + ' takes') + ' rack ' + m.games.length + '!',
                text: why, note: score(m) + ' · next rack in ' + secs + ' s',
                again: null, change: watching ? 'Back to the bracket' : null
            });
            return;
        }
        /* the match is decided */
        const final = main.rounds.length - Number(/^m(\d+)_/.exec(m.id)[1]) === 1;
        const wonMatch = iAm(m, m.winner);
        let title;
        if (watching) title = nameOf(m, m.winner) + ' wins' + (final ? ' the tournament!' : '!');
        else if (wonMatch) title = final ? 'Champion!' : 'Through to ' + nextRound(m.id) + '!';
        else title = final ? 'Runner-up!' : 'Out in ' + roundName(m.id);
        card({
            title: title, text: why, note: m.bestOf > 1 ? score(m) : '',
            again: null, change: 'Back to the bracket'
        });
    }

    function nextRound(id) {
        const r = Number(/^m(\d+)_/.exec(id)[1]) + 1;
        return roundName('m' + r + '_0');
    }

    /* ---------------------------------------------------------
       The room: link, who's in, the bracket
       --------------------------------------------------------- */

    function renderRoom() {
        if (!active || !main) return;
        const t = isT();
        els.roomKind.textContent = (t ? 'Tournament · ' : '1v1 · ') + S.MODES[main.settings.mode].name + ' · ' +
            ({ full: 'full aim lines', short: 'short aim lines', off: 'no aim lines' })[main.settings.guides];
        const host = myEntrant >= 0 ? main.host === myEntrant : mySeat === main.host;
        let line = '';
        if (!t) {
            const m = main.match;
            if (main.status === 'waiting') line = mySeat === 0 ? 'Send the link to a friend: the first to open it plays you. Waiting…' : 'Waiting for the game to start…';
            else if (m) {
                line = (mySeat < 0 ? 'Watching ' + nameOf(m, 0) + ' vs ' + nameOf(m, 1) + '. ' : '') + score(m) + '.';
                const other = 1 - mySeat;
                if (mySeat >= 0 && REALTIME && tableChannel && Object.keys(present).length && !present['p' + other]) line += ' ' + nameOf(m, other) + ' isn’t on the page right now.';
            }
        } else if (main.status === 'waiting') {
            const n = main.entrants.filter(Boolean).length;
            line = n + ' of ' + main.settings.max + ' signed up. ' + (host ? (n >= 2 ? 'Press Start when everyone’s in.' : 'Send the link round: you need at least one more.') : 'Waiting for ' + hostName(main) + ' to start.');
        } else line = tourLine();
        els.roomStatus.textContent = line;
        els.roomStart.hidden = !(t && main.status === 'waiting' && host);
        els.roomStart.disabled = !(t && main.entrants.filter(Boolean).length >= 2);
        renderList();
        renderBracket();
    }

    function tourLine() {
        if (main.status === 'finished') {
            const w = main.entrants[main.winner];
            return (main.winner === myEntrant ? 'You won the tournament!' : 'Champion: ' + (w ? w.name : '?') + '.') + ' Thanks for playing.';
        }
        const me = myEntrant >= 0 ? main.entrants[myEntrant] : null;
        const watching = function () {
            const b = bracketMatch(viewing);
            if (!b) return 'Pick a live match in the bracket below to watch.';
            const names = b.seats.map(function (e) { return e >= 0 && main.entrants[e] ? main.entrants[e].name : '…'; });
            return 'Watching ' + names[0] + ' vs ' + names[1] + ' (' + matchTitle(b.id).toLowerCase() + '). Pick another in the bracket below any time.';
        };
        if (!me) return watching();
        if (me.place) return 'You’re out (' + ordinal(me.place) + '). ' + (viewing && viewing !== lastMine ? watching() : 'Pick a live match below to watch.');
        const b = bracketMatch(me.at);
        if (!b) return '';
        if (b.status === 'playing' || b.status === 'between') {
            const s = b.seats.indexOf(myEntrant);
            const o = main.entrants[b.seats[1 - s]];
            return matchTitle(b.id) + ': you vs ' + (o ? o.name : '?') + '.';
        }
        return 'Through to ' + roundName(b.id) + '! Waiting for your opponent: ' + feederText(b) + '.';
    }

    function feederText(b) {
        const r = Number(/^m(\d+)_/.exec(b.id)[1]), i = Number(/_(\d+)$/.exec(b.id)[1]);
        const s = b.seats.indexOf(myEntrant);
        const f = main.rounds[r - 1] && main.rounds[r - 1][i * 2 + (1 - s)];
        if (!f) return 'still playing';
        const names = f.seats.map(function (e) { return e >= 0 && main.entrants[e] ? main.entrants[e].name : '…'; });
        return 'the winner of ' + names[0] + ' vs ' + names[1];
    }

    function ordinal(n) {
        if (n === 1) return '1st';
        if (n === 2) return '2nd';
        const lo = n, hi = n * 2 - 2;
        return 'joint ' + lo + (lo % 10 === 3 && lo !== 13 ? 'rd' : 'th') + (hi > lo ? '–' + hi + 'th' : '');
    }

    function avatarImg(p, size) {
        const look = picOf(p);
        const img = document.createElement('img');
        img.className = 'Room-pic';
        img.alt = '';
        img.width = size;
        img.height = size;
        img.src = look.pic;
        img.style.background = look.bg;
        return img;
    }

    function renderList() {
        const show = isT() && main.status === 'waiting';
        els.roomList.hidden = !show;
        if (!show) return;
        els.roomList.textContent = '';
        main.entrants.forEach(function (e, i) {
            if (!e) return;
            const li = document.createElement('li');
            li.className = 'Room-player' + (i === myEntrant ? ' is-me' : '');
            const name = document.createElement('span');
            name.textContent = e.name;
            li.append(avatarImg(e, 28), name);
            if (i === main.host) { const tag = document.createElement('small'); tag.textContent = 'host'; li.appendChild(tag); }
            else if (i === myEntrant) { const tag = document.createElement('small'); tag.textContent = 'you'; li.appendChild(tag); }
            els.roomList.appendChild(li);
        });
    }

    let bracketSig = '';
    function renderBracket() {
        const show = isT() && main.status !== 'waiting';
        els.bracketWrap.hidden = !show;
        if (!show) return;
        const sig = JSON.stringify([main.version, viewing, myEntrant]);
        if (sig === bracketSig) return;
        bracketSig = sig;
        els.bracket.textContent = '';
        main.rounds.forEach(function (round, r) {
            const col = document.createElement('div');
            col.className = 'Bracket-round';
            const h = document.createElement('h3');
            h.textContent = cap(roundName('m' + r + '_0').replace(/^the /, ''));
            col.appendChild(h);
            const list = document.createElement('div');
            list.className = 'Bracket-list';
            round.forEach(function (b) {
                const live = b.status === 'playing' || b.status === 'between';
                const box = document.createElement(live || b.status === 'done' && b.seats[1] >= 0 ? 'button' : 'div');
                box.className = 'Bracket-match is-' + b.status + (b.seats.indexOf(myEntrant) >= 0 && myEntrant >= 0 ? ' is-mine' : '') + (b.id === viewing ? ' is-viewing' : '');
                if (box.tagName === 'BUTTON') {
                    box.type = 'button';
                    box.setAttribute('aria-label', (live ? 'Watch ' : 'See ') + b.seats.map(function (e) { return e >= 0 && main.entrants[e] ? main.entrants[e].name : 'to be decided'; }).join(' vs '));
                    box.addEventListener('click', function () {
                        picked = b.id;
                        showMatch(b.id);
                        try { els.game.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* fine */ }
                    });
                }
                b.seats.forEach(function (e, s) {
                    const row = document.createElement('span');
                    row.className = 'Bracket-row' + (b.status === 'done' && b.winner === s ? ' is-win' : '') + (b.status === 'done' && b.winner === 1 - s ? ' is-lose' : '');
                    const name = document.createElement('span');
                    name.className = 'Bracket-name';
                    if (e >= 0 && main.entrants[e]) { row.appendChild(avatarImg(main.entrants[e], 20)); name.textContent = main.entrants[e].name; }
                    else name.textContent = e === -1 ? 'bye' : '…';
                    row.appendChild(name);
                    if (b.bestOf > 1 && e >= 0 && b.status !== 'pending') {
                        const w = document.createElement('b');
                        w.textContent = b.wins[s];
                        row.appendChild(w);
                    }
                    box.appendChild(row);
                });
                if (live) {
                    const tag = document.createElement('span');
                    tag.className = 'Bracket-live';
                    tag.textContent = b.id === viewing ? 'on the table' : 'live · watch';
                    box.appendChild(tag);
                }
                list.appendChild(box);
            });
            col.appendChild(list);
            els.bracket.appendChild(col);
        });
    }

    /* ---------------------------------------------------------
       Start up
       --------------------------------------------------------- */

    els.hostMatch.addEventListener('click', function () { host('match'); });
    els.hostTour.addEventListener('click', function () { host('tournament'); });
    els.joinGo.addEventListener('click', function () { join(); });
    els.joinCode.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); join(); } });
    els.name.addEventListener('keydown', function (e) { if (e.key === 'Enter' && cleanCode(els.joinCode.value).length === 6) { e.preventDefault(); join(); } });

    const prof = read(PROFILE_STORE, null);
    if (prof && prof.name) els.name.value = prof.name;
    const linked = cleanCode(params.get('game'));
    if (linked.length === 6) fromLink(linked);
    else setTab(read(TAB_STORE, 'here') === 'online');

    /* for tests: ?sandbox exposes the online state */
    if (/[?&]sandbox(&|$)/.test(window.location.search)) {
        window.WhalePoolOnlineTest = {
            state: function () { return { active: active, code: code, mySeat: mySeat, myEntrant: myEntrant, main: main, match: match, viewing: viewing, present: present }; },
            refresh: refresh
        };
    }
})();
