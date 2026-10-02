/* ============================================================
   Whale Road — the page: drawing, keys, wallet, name, shop, board.

   The rules live in game-sim.js (WhaleSim), not here. This file
   only shows what the simulation says, feeds it key presses, and
   keeps a log of them — because the server replays that log with
   the same game-sim.js to decide your score. Nothing drawn here
   (particles, squash, the seagull swoop) can change a result, and
   none of it may touch the simulation's random numbers.

   Three zones re-skin the same five kinds of lane:
     harbour  sand · roads · driftwood rivers · trams
     sea      shallows · boats · kelp riptides · sharks · nets
     arctic   snow · ice roads · ice floes · orcas
   with a seagull for anyone who dawdles, everywhere.

   Who you play: paste a wallet and every OG whale it holds unlocks
   its Pixel Whale twin (same number, same traits, on Polygon).
   No wallet: the built-in guest whale. Either way you pick a name
   before playing; a wallet's name is permanent once set.

   Keyboard only. Phones get a notice instead (see game.html).
   ============================================================ */

(function () {
    'use strict';

    const arcade = document.getElementById('arcade');
    if (!arcade) return;

    /* Phones and tablets have no keys to play with. A touchscreen
       laptop still reports a fine primary pointer, so it plays. */
    const touchOnly = window.matchMedia &&
        window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    if (touchOnly) {
        arcade.hidden = true;
        document.getElementById('desktopOnly').hidden = false;
        return;
    }

    /* ---------------------------------------------------------
       Constants — the geometry comes from the simulation
       --------------------------------------------------------- */

    const Sim = window.WhaleSim;
    const Rules = window.WhaleRules;
    const CELL = Sim.CELL;
    const COLS = Sim.COLS;
    const ROWS = Sim.ROWS;
    const W = Sim.W;
    const H = Sim.H;
    const DT = 1 / Sim.TICK_HZ;

    /* tokenURI() on the Pixel Whales contract is ipfs://<this>/<id> */
    const PIXEL_CID = 'QmYsgzpjiefYzYBY27mvb7y7RS8hpAKbGgN6HSYPvcZR1Q';
    const SUPPLY = 10000;            /* ids 0 - 9999 */
    const GATEWAYS = [
        'https://gateway.pinata.cloud/ipfs/',
        'https://ipfs.filebase.io/ipfs/',
        'https://ipfs.io/ipfs/',
        'https://dweb.link/ipfs/'
    ];

    const $ = function (id) { return document.getElementById(id); };
    const canvas = $('gameCanvas');
    const ctx = canvas.getContext('2d');
    const preview = $('previewCanvas');
    const els = {
        overlay: $('overlay'),
        kicker: $('overlayKicker'),
        title: $('overlayTitle'),
        text: $('overlayText'),
        button: $('overlayButton'),
        score: $('hudScore'),
        coins: $('hudCoins'),
        powers: $('hudPowers'),
        banner: $('zoneBanner'),
        best: $('bestScore'),
        banked: $('bankedCoins'),
        wallet: $('walletAddress'),
        checkWallet: $('checkWallet'),
        walletStatus: $('walletStatus'),
        holdings: $('holdings'),
        holdingsMore: $('holdingsMore'),
        name: $('whaleName'),
        traits: $('whaleTraits'),
        whaleStatus: $('whaleStatus'),
        playerName: $('playerName'),
        claimName: $('claimName'),
        nameStatus: $('nameStatus'),
        shop: $('shop'),
        shopNote: $('shopNote'),
        leaders: $('leaders'),
        live: $('liveDot'),
        frame: $('boardFrame')
    };

    /* ---------------------------------------------------------
       Small helpers
       --------------------------------------------------------- */

    function rand(a, b) { return a + Math.random() * (b - a); }   /* cosmetics only */
    function lerp(a, b, t) { return a + (b - a) * t; }
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
    function colX(c) { return c * CELL + CELL / 2; }

    function readStore(key, fallback) {
        try {
            const raw = window.localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (err) {
            return fallback;
        }
    }

    function writeStore(key, value) {
        try { window.localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* fine */ }
    }

    function fill(color, x, y, w, h) {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    /* #rrggbb lightened or darkened by amt (-255..255) */
    function shade(hex, amt) {
        const n = parseInt(hex.slice(1), 16);
        const r = clamp((n >> 16) + amt, 0, 255);
        const g = clamp(((n >> 8) & 255) + amt, 0, 255);
        const b = clamp((n & 255) + amt, 0, 255);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function shortAddress(a) { return a ? a.slice(0, 6) + '…' + a.slice(-4) : ''; }


    /* ---------------------------------------------------------
       The whale: metadata, art, cutout
       --------------------------------------------------------- */

    /* Content-addressed, so it can be cached forever. */
    async function fetchMeta(id) {
        const key = 'ssow-pixel:' + PIXEL_CID + ':' + id;
        const stored = readStore(key, null);
        if (stored && stored.image) return stored;

        const attempts = GATEWAYS.map(function (base) {
            return fetch(base + PIXEL_CID + '/' + id, { mode: 'cors' }).then(function (res) {
                if (!res.ok) throw new Error('gateway ' + res.status);
                return res.json();
            });
        });
        const meta = await Promise.any(attempts).catch(function () {
            throw new Error('every IPFS gateway failed');
        });

        const whale = { id: id, image: meta.image, traits: meta.attributes || [] };
        writeStore(key, whale);
        return whale;
    }

    function loadImg(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.crossOrigin = 'anonymous';         /* getImageData needs a CORS-clean image */
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image failed')); };
            img.src = src;
        });
    }

    /* The metadata names Pinata, but the same CID is just as good from
       any gateway — so ask them all at once and keep the first. The
       art is 11 KB, so racing costs nothing, while waiting on Pinata
       alone took ~6s in testing (Filebase answered in under one). */
    function loadArt(whale) {
        const m = /\/ipfs\/([^/?#]+)/.exec(whale.image || '');
        const urls = m ? GATEWAYS.map(function (g) { return g + m[1]; }) : [];
        if (whale.image && urls.indexOf(whale.image) < 0) urls.unshift(whale.image);
        if (!urls.length) return Promise.reject(new Error('art unavailable'));
        return Promise.any(urls.map(loadImg)).catch(function () {
            throw new Error('art unavailable');
        });
    }

    /* 1000px PNG of a 100px grid on a flat background -> a cropped,
       transparent, native-size sprite. The flood fill starts from the
       border, so background-coloured pixels *inside* the whale stay. */
    function makeSprite(img) {
        const N = Math.max(1, Math.round(img.naturalWidth / 10));
        const c = document.createElement('canvas');
        c.width = N;
        c.height = N;
        const g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.drawImage(img, 0, 0, N, N);

        let data;
        try { data = g.getImageData(0, 0, N, N); } catch (err) { return null; }
        const d = data.data;
        const bg = [d[0], d[1], d[2]];
        const isBg = function (p) {
            const i = p * 4;
            return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) < 24;
        };

        const seen = new Uint8Array(N * N);
        const stack = [];
        for (let i = 0; i < N; i++) stack.push(i, (N - 1) * N + i, i * N, i * N + N - 1);
        while (stack.length) {
            const p = stack.pop();
            if (seen[p]) continue;
            seen[p] = 1;
            if (!isBg(p)) continue;
            d[p * 4 + 3] = 0;
            const x = p % N;
            const y = (p / N) | 0;
            if (x > 0) stack.push(p - 1);
            if (x < N - 1) stack.push(p + 1);
            if (y > 0) stack.push(p - N);
            if (y < N - 1) stack.push(p + N);
        }
        g.putImageData(data, 0, 0);

        /* crop to what's left */
        let x0 = N, y0 = N, x1 = -1, y1 = -1;
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                if (d[(y * N + x) * 4 + 3]) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    if (y > y1) y1 = y;
                }
            }
        }
        if (x1 < 0) return null;

        const out = document.createElement('canvas');
        out.width = x1 - x0 + 1;
        out.height = y1 - y0 + 1;
        out.getContext('2d').drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
        return out;
    }

    /* Plays while IPFS is still answering, or if it never does. */
    function fallbackSprite() {
        const map = [
            '.....kkkkk.....',
            '...kkbbbbbkk...',
            '..kbbbbbbbbbk..',
            '.kbbbwkbbbbbbk.',
            '.kbbbkkbbbbbbk.',
            '.kbbbbbbbbbbbk.',
            '.kbbbbbbbbbbbk.',
            '..kbbbbbbbbbk..',
            '..kbbsssssbbk..',
            '..kbbsssssbbk..',
            '..kbbbbbbbbbk..',
            '...kbbk.kbbk...',
            '...kkkk.kkkk...'
        ];
        const colors = { k: '#13263d', b: '#3f86c9', w: '#ffffff', s: '#a9d3f2' };
        const px = 3;
        const c = document.createElement('canvas');
        c.width = map[0].length * px;
        c.height = map.length * px;
        const g = c.getContext('2d');
        map.forEach(function (line, y) {
            for (let x = 0; x < line.length; x++) {
                const col = colors[line[x]];
                if (col) { g.fillStyle = col; g.fillRect(x * px, y * px, px, px); }
            }
        });
        return c;
    }

    /* ---------------------------------------------------------
       Which whale you play: your wallet decides

       Paste a wallet; every OG whale it holds on Ethereum unlocks
       the Pixel Whale with the same number on Polygon — same
       traits, drawn in pixels. No wallet, or no OG whales: you
       play the built-in guest whale.

       Like the ID card, this reads the pasted address and asks for
       no signature, so it is a convenience, not proof of ownership.
       --------------------------------------------------------- */

    const Chain = window.WhaleChain;
    const GUEST = fallbackSprite();
    const GUEST_TEXT = 'Every OG whale you hold unlocks its Pixel twin — same number, same traits.';
    const PAGE_SIZE = 24;

    let sprite = GUEST;
    let whaleId = null;       /* the whale being played; null = the guest */
    let loadToken = 0;
    let holdings = null;      /* { address, balance, ids: [...] } */
    let checkToken = 0;       /* bumped to abandon a lookup still running */

    function setStatus(el, msg, kind) {
        el.textContent = msg || '';
        el.classList.toggle('is-error', kind === 'error');
        el.classList.toggle('is-ok', kind === 'ok');
    }

    function drawPreview() {
        preview.width = 100;
        preview.height = 100;
        const g = preview.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.clearRect(0, 0, 100, 100);
        const s = sprite;
        const scale = Math.max(1, Math.floor(Math.min(96 / s.width, 96 / s.height)));
        const w = s.width * scale;
        const h = s.height * scale;
        g.drawImage(s, Math.round((100 - w) / 2), 100 - h - 2, w, h);
    }

    function describe(traits) {
        const want = ['Hat', 'Eyes', 'Mouth', 'Outfit'];
        return want.map(function (t) {
            const hit = traits.find(function (x) { return x.trait_type === t; });
            return hit && hit.value && hit.value !== 'None' ? hit.value : null;
        }).filter(Boolean).join(' · ');
    }

    /* OG ids run 1-10000 and Pixel ids 0-9999, so OG #10000 is the one
       whale without a twin. */
    function hasTwin(id) { return Number.isInteger(id) && id >= 0 && id < SUPPLY; }

    function markActive(id) {
        els.holdings.querySelectorAll('.Holding').forEach(function (b) {
            b.classList.toggle('is-active', Number(b.dataset.id) === id);
        });
    }

    function playAsGuest() {
        loadToken++;                 /* drop any art still on its way */
        sprite = GUEST;
        whaleId = null;
        els.name.textContent = 'Guest whale';
        els.traits.textContent = GUEST_TEXT;
        setStatus(els.whaleStatus, '');
        markActive(null);
        drawPreview();
        onWhaleChange();
    }

    /* Only ever called with an id the wallet holds. */
    async function playWhale(id) {
        const token = ++loadToken;
        markActive(id);
        setStatus(els.whaleStatus, 'loading Pixel Whale #' + id + '…');
        try {
            const whale = await fetchMeta(id);
            if (token !== loadToken) return;
            const img = await loadArt(whale);
            if (token !== loadToken) return;
            const s = makeSprite(img);
            if (!s) throw new Error('could not cut out the art');
            sprite = s;
            whaleId = id;
            writeStore('ssow-road-whale', id);
            els.name.textContent = 'Pixel Whale #' + id;
            els.traits.textContent = describe(whale.traits) || ' ';
            drawPreview();
            setStatus(els.whaleStatus, '');
            onWhaleChange();
        } catch (err) {
            if (token !== loadToken) return;
            setStatus(els.whaleStatus, 'couldn’t load #' + id + ' — ' + err.message, 'error');
        }
    }

    function renderHoldings(ids, reset) {
        if (reset) els.holdings.innerHTML = '';
        const frag = document.createDocumentFragment();
        ids.forEach(function (id) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'Holding';
            btn.dataset.id = id;
            btn.textContent = '#' + id;
            if (!hasTwin(id)) {
                btn.disabled = true;
                btn.title = 'OG #' + id + ' has no Pixel twin';
            }
            li.appendChild(btn);
            frag.appendChild(li);
        });
        els.holdings.appendChild(frag);
    }

    /* A wallet can hold a lot of whales (one holds 1,490), so they come
       in pages of 24 — the same approach as the ID card. */
    async function loadHoldingsPage() {
        const h = holdings;
        const from = h.ids.length;
        const page = await Chain.tokensOfOwner(h.address, from, Math.min(h.balance, from + PAGE_SIZE));
        if (holdings !== h) return [];          /* the wallet changed meanwhile */

        h.ids.push.apply(h.ids, page);
        renderHoldings(page, from === 0);
        setStatus(
            els.walletStatus,
            h.balance > h.ids.length
                ? h.balance + ' OG whales — showing ' + h.ids.length
                : h.balance + (h.balance === 1 ? ' OG whale' : ' OG whales'),
            'ok'
        );
        els.holdingsMore.hidden = h.ids.length >= h.balance;
        return page;
    }

    /* preferId: the whale played last time — picked again if still held */
    async function checkWallet(preferId) {
        const raw = els.wallet.value.trim();
        if (!Chain.isAddress(raw)) {
            setStatus(els.walletStatus, raw ? 'that isn’t a valid 0x address' : 'paste your wallet address first', 'error');
            return;
        }

        const address = raw.toLowerCase();
        const token = ++checkToken;
        els.checkWallet.disabled = true;
        setStatus(els.walletStatus, 'reading the chain…');

        try {
            const balance = await Chain.balanceOf(address);
            if (token !== checkToken) return;
            const h = { address: address, balance: balance, ids: [] };
            holdings = h;
            els.holdings.innerHTML = '';
            els.holdingsMore.hidden = true;
            writeStore('ssow-road-wallet', address);

            if (!balance) {
                setStatus(els.walletStatus, 'no OG whales here — playing as the guest', 'error');
                playAsGuest();
                return;
            }

            await loadHoldingsPage();
            if (holdings !== h) return;

            let pick = null;
            if (hasTwin(preferId) &&
                (h.ids.indexOf(preferId) >= 0 || await Chain.ownsWhale(address, preferId))) {
                pick = preferId;
            }
            if (holdings !== h) return;
            if (pick === null) pick = h.ids.find(hasTwin);
            if (pick === undefined || pick === null) playAsGuest();
            else playWhale(pick);
        } catch (err) {
            if (token === checkToken) setStatus(els.walletStatus, 'lookup failed (' + err.message + ')', 'error');
        } finally {
            if (token === checkToken) els.checkWallet.disabled = false;
        }
    }

    async function showMoreHoldings() {
        if (!holdings) return;
        const label = els.holdingsMore.textContent;
        els.holdingsMore.disabled = true;
        els.holdingsMore.textContent = 'loading…';
        try {
            await loadHoldingsPage();
        } catch (err) {
            setStatus(els.walletStatus, 'could not load more (' + err.message + ')', 'error');
        } finally {
            els.holdingsMore.disabled = false;
            els.holdingsMore.textContent = label;
        }
    }

    /* ---------------------------------------------------------
       Online: your name, your coins, run tickets, the board

       All of it goes through one edge function (see
       supabase/functions/whale-road). ?backend=local points the page
       at tools/dev-backend.ts instead, for testing offline.
       --------------------------------------------------------- */

    const CONFIG = window.WHALE_ROAD_CONFIG || {};
    const params = new URLSearchParams(window.location.search);
    const API = params.get('backend') === 'local' ? 'http://localhost:8787' : (CONFIG.functionUrl || '');
    const online = !!API;

    /* One session per identity: the guest, and each wallet. */
    let sessions = readStore('ssow-road-sessions', {});
    let account = null;            /* { coins, items: { shield, dash, magnet } } */
    let myBest = null;            /* best score of whoever is playing now */
    let shownIdentity = null;
    const bring = { shield: false, dash: false, magnet: false };

    const ITEMS = [
        { id: 'shield', icon: '\u{1FAE7}', name: 'Bubble Shield', desc: 'Shrugs off one hit or one drowning.' },
        { id: 'dash', icon: '\u{1F4A8}', name: 'Speed Dash', desc: 'Press E to rocket 1–30 rows ahead.' },
        { id: 'magnet', icon: '\u{1F9F2}', name: 'Cigar Magnet', desc: 'Pulls in $CIGAR from nearby lanes.' }
    ];

    async function api(action, body) {
        const headers = { 'content-type': 'application/json' };
        if (CONFIG.anonKey && API === CONFIG.functionUrl) {
            headers.apikey = CONFIG.anonKey;
            headers.authorization = 'Bearer ' + CONFIG.anonKey;
        }
        let res;
        try {
            res = await fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(Object.assign({ action: action }, body || {})) });
        } catch (err) {
            const e = new Error('can’t reach the server');
            e.status = 0;
            throw e;
        }
        let data = {};
        try { data = await res.json(); } catch (err) { /* empty */ }
        if (!res.ok) {
            const e = new Error(data.error || 'server error ' + res.status);
            e.status = res.status;
            throw e;
        }
        return data;
    }

    /* A Pixel Whale only counts for the wallet that holds it. */
    function identity() {
        if (whaleId !== null && holdings) return { kind: 'wallet', key: holdings.address, wallet: holdings.address };
        return { kind: 'guest', key: 'guest', wallet: null };
    }

    function currentSession() { return sessions[identity().key] || null; }

    function saveSession(key, value) {
        sessions[key] = value;
        writeStore('ssow-road-sessions', sessions);
    }

    function dropSession(key) {
        delete sessions[key];
        writeStore('ssow-road-sessions', sessions);
    }

    /* The secret that owns a guest name. Lose it (clear the browser)
       and the name can't be claimed back. */
    function guestKey() {
        let key = readStore('ssow-road-guest-key', null);
        if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key)) {
            key = Array.from(crypto.getRandomValues(new Uint8Array(32)), function (b) {
                return b.toString(16).padStart(2, '0');
            }).join('');
            writeStore('ssow-road-guest-key', key);
        }
        return key;
    }

    /* Wallets: no signing. Load a wallet that holds OG whales, give it a
       name once, and that name is the wallet's for good — so pasting
       someone else's address can't rename them. Paste it again later and
       you're straight back in. Guests can rename: their name is tied to a
       secret key in this browser that nobody else has. */
    const walletChecked = {};     /* wallet -> 'checking' | 'needs-name' */

    async function signInWallet(wallet) {
        if (walletChecked[wallet]) return;
        walletChecked[wallet] = 'checking';
        setStatus(els.nameStatus, 'looking up this wallet\u2026');
        try {
            const res = await api('claim', { kind: 'wallet', wallet: wallet });
            saveSession(wallet, { token: res.token, username: res.player.username });
            account = { coins: res.player.coins, items: res.player.items };
            delete walletChecked[wallet];
        } catch (err) {
            walletChecked[wallet] = err.status === 404 ? 'needs-name' : null;
            if (err.status !== 404) {
                delete walletChecked[wallet];
                if (identity().key === wallet) setStatus(els.nameStatus, err.message, 'error');
                return;
            }
        }
        if (identity().key === wallet) refreshIdentity();
    }

    function refreshIdentity() {
        const id = identity();
        const sess = currentSession();
        /* a best score belongs to one player: forget it when the player changes */
        const who = id.key + ':' + (sess ? sess.username : '');
        if (who !== shownIdentity) { shownIdentity = who; myBest = null; updateRecords(); }
        if (!online) {
            els.playerName.disabled = true;
            els.claimName.disabled = true;
            setStatus(els.nameStatus, 'leaderboard offline \u2014 practice runs only');
            renderShop();
            return;
        }

        const locked = id.kind === 'wallet' && !!sess;    /* a wallet's name never changes */
        els.playerName.disabled = locked;
        els.claimName.hidden = locked;
        els.claimName.textContent = sess ? 'Rename' : 'Save';
        if (sess) els.playerName.value = sess.username;
        else if (document.activeElement !== els.playerName) els.playerName.value = '';

        if (id.kind === 'wallet' && !sess) {
            if (!walletChecked[id.wallet]) { signInWallet(id.wallet); return; }
            if (walletChecked[id.wallet] === 'checking') return;
        }

        setStatus(
            els.nameStatus,
            sess ? 'playing as ' + sess.username + (id.kind === 'wallet' ? ' \u00b7 ' + shortAddress(id.wallet) : ' \u00b7 guest')
                : id.kind === 'wallet' ? 'name this wallet \u2014 it\u2019s permanent, so choose well'
                    : 'pick a name to get on the board',
            sess ? 'ok' : null
        );
        refreshAccount();
        highlightMe();
    }

    async function refreshAccount() {
        const id = identity();
        const sess = currentSession();
        if (!online || !sess) { account = null; renderShop(); updateRecords(); return; }
        try {
            const res = await api('me', { token: sess.token });
            if (identity().key !== id.key) return;
            account = { coins: res.player.coins, items: res.player.items };
        } catch (err) {
            if (err.status === 401) { dropSession(id.key); refreshIdentity(); return; }
        }
        renderShop();
        updateRecords();
    }

    async function claimName() {
        const name = els.playerName.value.trim();
        const why = Rules.checkName(name);
        if (why) { setStatus(els.nameStatus, why, 'error'); return; }
        const id = identity();
        els.claimName.disabled = true;
        try {
            const body = id.kind === 'wallet'
                ? { kind: 'wallet', wallet: id.wallet, username: name }
                : { kind: 'guest', username: name, guestKey: guestKey() };
            const res = await api('claim', body);
            saveSession(id.key, { token: res.token, username: res.player.username });
            delete walletChecked[id.key];
            account = { coins: res.player.coins, items: res.player.items };
            renderShop();          /* the claim already told us your coins: unlock now */
            refreshIdentity();
        } catch (err) {
            setStatus(els.nameStatus, err.message, 'error');
        } finally {
            els.claimName.disabled = false;
        }
    }

    /* ---------- the $CIGAR shop ---------- */

    function renderShop() {
        const sess = currentSession();
        const ready = online && sess && account;
        els.shop.innerHTML = '';
        ITEMS.forEach(function (item) {
            const owned = ready ? account.items[item.id] : 0;
            if (owned <= 0) bring[item.id] = false;
            const li = document.createElement('li');
            li.className = 'Shop-item';
            li.innerHTML =
                '<span class="Shop-icon" aria-hidden="true"></span>' +
                '<span class="Shop-text"><strong></strong><small></small></span>' +
                '<span class="Shop-owned"></span>' +
                '<button type="button" class="Btn Shop-buy"></button>' +
                '<label class="Shop-bring"><input type="checkbox"> bring</label>';
            li.querySelector('.Shop-icon').textContent = item.icon;
            li.querySelector('strong').textContent = item.name;
            li.querySelector('small').textContent = item.desc;
            li.querySelector('.Shop-owned').textContent = '×' + owned;
            const buy = li.querySelector('.Shop-buy');
            buy.textContent = Sim.PRICES[item.id] + ' $CIGAR';
            buy.disabled = !ready || account.coins < Sim.PRICES[item.id];
            buy.addEventListener('click', function () { buyItem(item.id, buy); });
            const box = li.querySelector('input');
            box.checked = bring[item.id];
            box.disabled = !ready || owned <= 0;
            box.addEventListener('change', function () { bring[item.id] = box.checked; updatePowers(); });
            els.shop.appendChild(li);
        });
        els.shopNote.textContent = !online ? 'the shop opens when the leaderboard is online'
            : !sess ? 'save your name to use the shop'
                : 'tick “bring” to use one on your next run';
        updatePowers();
    }

    async function buyItem(id, button) {
        const sess = currentSession();
        if (!sess) return;
        button.disabled = true;
        try {
            const res = await api('buy', { token: sess.token, item: id });
            account = { coins: res.coins, items: res.items };
        } catch (err) {
            els.shopNote.textContent = err.message;
        }
        renderShop();
        updateRecords();
    }

    function chosenLoadout() {
        const out = {};
        ITEMS.forEach(function (i) { out[i.id] = !!(bring[i.id] && account && account.items[i.id] > 0); });
        return out;
    }

    /* ---------- the leaderboard ---------- */

    let boardRows = [];

    function renderBoard(rows) {
        boardRows = rows;
        els.leaders.innerHTML = '';
        if (!rows.length) {
            const li = document.createElement('li');
            li.className = 'Leaders-empty';
            li.textContent = 'No scores yet — be the first.';
            els.leaders.appendChild(li);
            return;
        }
        rows.forEach(function (r, i) {
            const li = document.createElement('li');
            li.className = 'Leader';
            li.dataset.name = String(r.username).toLowerCase();
            const cells = [
                ['Leader-rank', '#' + (i + 1)],
                ['Leader-name', r.username],
                ['Leader-whale', r.whale_id !== null && r.whale_id !== undefined ? 'Pixel #' + r.whale_id : 'guest whale'],
                ['Leader-wallet', r.wallet ? shortAddress(r.wallet) : '—'],
                ['Leader-score', String(r.score)]
            ];
            cells.forEach(function (c) {
                const span = document.createElement('span');
                span.className = c[0];
                span.textContent = c[1];
                li.appendChild(span);
            });
            els.leaders.appendChild(li);
        });
        highlightMe();
    }

    function highlightMe() {
        const sess = currentSession();
        const me = sess ? sess.username.toLowerCase() : null;
        els.leaders.querySelectorAll('.Leader').forEach(function (li) {
            li.classList.toggle('is-me', li.dataset.name === me);
        });
        const mine = me && boardRows.find(function (r) { return String(r.username).toLowerCase() === me; });
        if (mine && (myBest === null || mine.score > myBest)) { myBest = mine.score; updateRecords(); }
    }

    let boardTimer = null;
    async function refreshBoard() {
        if (!online) {
            els.leaders.innerHTML = '<li class="Leaders-empty">The leaderboard is offline.</li>';
            return;
        }
        try {
            renderBoard((await api('board')).rows || []);
        } catch (err) {
            if (!boardRows.length) els.leaders.innerHTML = '<li class="Leaders-empty">Leaderboard unavailable right now.</li>';
        }
    }

    function soonRefreshBoard() {
        clearTimeout(boardTimer);
        boardTimer = setTimeout(refreshBoard, 400);
    }

    /* Realtime pushes a nudge whenever any row changes; the page then
       re-reads the top 20. A slow poll covers everything else. */
    function goLive() {
        if (!online) return;
        let live = false;
        if (CONFIG.supabaseUrl && CONFIG.anonKey && API === CONFIG.functionUrl) {
            /* 218 KB, and only needed for the live nudge — so it loads here,
               not in the page head, and only once the backend is configured */
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
            script.onload = subscribe;
            document.head.appendChild(script);
        }
        function subscribe() {
            if (!window.supabase || !window.supabase.createClient) return;
            try {
                const client = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.anonKey, { auth: { persistSession: false } });
                client.channel('wr-leaderboard')
                    .on('postgres_changes', { event: '*', schema: 'public', table: 'wr_leaderboard' }, soonRefreshBoard)
                    .subscribe(function (status) {
                        live = status === 'SUBSCRIBED';
                        els.live.classList.toggle('is-live', live);
                        els.live.textContent = live ? 'live' : 'updating';
                    });
            } catch (err) { /* polling still works */ }
        }
        setInterval(function () { if (!document.hidden && !live) refreshBoard(); }, 15000);
        refreshBoard();
    }

    /* ---------------------------------------------------------
       Drawing — everything here is cosmetic
       --------------------------------------------------------- */

    let sim = null;
    let acc = 0;
    let time = 0;
    let particles = [];
    let gull = null;
    let landSquash = 0;
    let bumpT = 0;
    let bumpDx = 0;
    let dashTrail = null;

    /* lanes where a whale is swimming rather than standing */
    const SWIM = { shallows: true, boats: true, sharks: true, nets: true, orcas: true };

    function laneY(row) { return Math.round(H - (row - sim.camY + 1) * CELL); }
    function screenY(wy) { return H - (wy - sim.camY * CELL); }

    function burst(x, wy, colors, n, up) {
        for (let i = 0; i < n; i++) {
            particles.push({
                x: x, wy: wy,
                vx: rand(-90, 90), vy: rand(up ? 120 : 80, up ? 260 : 230),
                life: rand(0.35, 0.7),
                color: colors[i % colors.length],
                size: Math.random() < 0.5 ? 3 : 4
            });
        }
    }

    function updateParticles(dt) {
        particles.forEach(function (q) {
            q.x += q.vx * dt;
            q.wy += q.vy * dt;
            q.vy -= 600 * dt;
            q.life -= dt;
        });
        particles = particles.filter(function (q) { return q.life > 0; });
    }

    function drawShadow(cx, y, w) {
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(Math.round(cx - w / 2), Math.round(y), Math.round(w), 5);
    }

    function ripples(lane, y, color, count, speedFactor) {
        const drift = time * lane.dir * Math.max(lane.speed, 30) * speedFactor;
        for (let i = 0; i < count; i++) {
            const rx = ((((lane.seed * 37 + i * 109 + drift) % (W + 40)) + (W + 40)) % (W + 40)) - 20;
            fill(color, rx, y + 10 + ((i * 11) % 28), 10, 2);
        }
    }

    /* The express lanes warn you in their own way: a signal, a fin, a spout. */
    function expressCue(lane, y) {
        const e = lane.express;
        const blink = e.phase === 'pass' || (e.phase === 'warn' && Math.floor(time * 8) % 2 === 0);
        if (lane.type === 'rail') {
            fill('#2b2f36', W - 14, y - 10, 4, 34);
            fill('#1c1f24', W - 19, y - 18, 14, 10);
            fill(blink ? '#ff4d4d' : '#5a1e1e', W - 17, y - 16, 10, 6);
            return;
        }
        if (e.phase !== 'warn') return;
        const ex = lane.dir > 0 ? 18 : W - 18;
        if (lane.type === 'sharks') {
            const bob = Math.floor(time * 6) % 2;
            fill('#5f6d7b', ex - 4, y + 14 + bob, 8, 12);
            fill('#5f6d7b', ex - 2, y + 8 + bob, 5, 6);
            fill('#c6e6f5', ex - 10, y + 26, 20, 2);
        } else {
            if (blink) {
                fill('#ffffff', ex - 2, y + 2, 4, 14);
                fill('#e6f6ff', ex - 7, y - 2, 4, 6);
                fill('#e6f6ff', ex + 3, y - 2, 4, 6);
            }
        }
    }

    function drawGround(lane, y) {
        const alt = (lane.row & 1) === 0;
        const t = lane.type;
        if (t === 'sand' || t === 'snow') {
            const snow = t === 'snow';
            fill(snow ? (alt ? '#eef3f8' : '#e6edf4') : (alt ? '#ead59e' : '#e3cc90'), 0, y, W, CELL);
            for (let i = 0; i < 7; i++) {
                const sx = (lane.seed * 13 + i * 89) % W;
                const sy = (lane.seed * 7 + i * 17) % (CELL - 8);
                fill(snow ? '#cfdbe7' : '#d4bb81', sx, y + 3 + sy, 3, 3);
            }
            fill(snow ? '#c9d6e2' : '#cdb47a', 0, y + CELL - 3, W, 3);
        } else if (t === 'road' || t === 'icelane') {
            const ice = t === 'icelane';
            fill(ice ? (alt ? '#bcd3e6' : '#b5cde2') : '#3b404c', 0, y, W, CELL);
            const above = sim.lanes.get(lane.row + 1);
            const below = sim.lanes.get(lane.row - 1);
            const line = ice ? '#9fb9cf' : '#d9dde3';
            if (above && above.type === t) {
                for (let x = 8; x < W; x += 44) fill(line, x, y - 1, 22, 2);
            } else {
                fill(ice ? '#e6eef6' : '#8e95a1', 0, y, W, 3);
            }
            if (!below || below.type !== t) fill(ice ? '#9fb9cf' : '#8e95a1', 0, y + CELL - 4, W, 4);
            if (ice) for (let x = (lane.seed % 30); x < W; x += 60) fill('#a9c2d8', x, y + 20, 26, 2);
        } else if (t === 'water') {
            fill(alt ? '#2c79b4' : '#2a73ad', 0, y, W, CELL);
            fill('#1d5a8a', 0, y, W, 4);
            ripples(lane, y, '#5aa7dc', 7, 0.25);
        } else if (t === 'rail') {
            fill(alt ? '#80776d' : '#796f66', 0, y, W, CELL);
            for (let x = lane.seed % 24; x < W; x += 24) fill('#5b4636', x, y + 10, 8, 30);
            fill('#c3c8d0', 0, y + 16, W, 3);
            fill('#c3c8d0', 0, y + 31, W, 3);
            fill('#eef1f5', 0, y + 16, W, 1);
            fill('#eef1f5', 0, y + 31, W, 1);
            expressCue(lane, y);
        } else if (t === 'shallows') {
            fill(alt ? '#4fb3c4' : '#4aabbd', 0, y, W, CELL);
            for (let i = 0; i < 6; i++) fill('#7fd0d9', (lane.seed * 13 + i * 97) % W, y + 6 + ((i * 13) % 30), 4, 3);
            ripples(lane, y, '#a8e6ee', 4, 0.15);
        } else if (t === 'boats') {
            fill(alt ? '#2f86b8' : '#2c7fb0', 0, y, W, CELL);
            ripples(lane, y, '#6cb3dc', 6, 0.35);
        } else if (t === 'riptide') {
            fill(alt ? '#1f5f8f' : '#1d5886', 0, y, W, CELL);
            fill('#164a73', 0, y, W, 4);
            const drift = time * lane.dir * lane.speed * 0.9;
            for (let i = 0; i < 9; i++) {
                const rx = ((((lane.seed * 23 + i * 71 + drift) % (W + 40)) + (W + 40)) % (W + 40)) - 20;
                const ry = y + 12 + ((i * 9) % 24);
                fill('#d9f1ff', rx, ry, 6, 2);
                fill('#d9f1ff', rx + (lane.dir > 0 ? 4 : -2), ry + 2, 4, 2);
            }
        } else if (t === 'sharks' || t === 'orcas') {
            const arctic = t === 'orcas';
            fill(arctic ? (alt ? '#1d4a6e' : '#1b466a') : (alt ? '#245f86' : '#225a80'), 0, y, W, CELL);
            ripples(lane, y, arctic ? '#4e7ea3' : '#4f8fbb', 5, 0.2);
            expressCue(lane, y);
        } else if (t === 'nets') {
            fill(alt ? '#3a8fb8' : '#378ab2', 0, y, W, CELL);
            ripples(lane, y, '#76bde0', 5, 0.3);
        } else if (t === 'floes') {
            fill(alt ? '#173d5c' : '#163a57', 0, y, W, CELL);
            fill('#0f2c45', 0, y, W, 4);
            for (let i = 0; i < 6; i++) fill('#9fc0d8', (lane.seed * 31 + i * 103 + time * lane.dir * 12) % W, y + 12 + ((i * 7) % 24), 5, 3);
        }
    }

    function drawDecor(kind, cx, y) {
        const base = y + CELL - 10;
        if (kind === 'palm') {
            drawShadow(cx, base + 2, 30);
            for (let i = 0; i < 5; i++) fill(i % 2 ? '#8a5a33' : '#9b6a3d', cx - 4, base - 6 - i * 8, 8, 8);
            const ty = base - 48;
            fill('#2f8f45', cx - 22, ty, 44, 8);
            fill('#3fa856', cx - 15, ty - 7, 30, 8);
            fill('#2f8f45', cx - 27, ty + 8, 12, 6);
            fill('#2f8f45', cx + 15, ty + 8, 12, 6);
            fill('#6b4423', cx - 5, ty + 8, 4, 4);
            fill('#6b4423', cx + 1, ty + 8, 4, 4);
        } else if (kind === 'crate') {
            drawShadow(cx, base + 2, 36);
            fill('#c08a52', cx - 17, y + 6, 34, 9);
            fill('#a8743f', cx - 17, y + 15, 34, 24);
            fill('#7a4e25', cx - 17, y + 26, 34, 2);
            fill('#7a4e25', cx - 2, y + 15, 3, 24);
            fill('#5d3a1a', cx - 17, y + 37, 34, 2);
        } else if (kind === 'umbrella') {
            drawShadow(cx, base + 2, 26);
            fill('#e6e6e6', cx - 1, y + 4, 3, CELL - 12);
            fill('#e8524a', cx - 24, y + 2, 48, 6);
            fill('#ffffff', cx - 16, y - 3, 32, 5);
            fill('#e8524a', cx - 8, y - 6, 16, 3);
        } else if (kind === 'coral') {
            fill('#ff7a8a', cx - 3, y + 8, 6, 30);
            fill('#ff7a8a', cx - 14, y + 14, 6, 20);
            fill('#ff7a8a', cx + 8, y + 12, 6, 22);
            fill('#ff7a8a', cx - 14, y + 30, 28, 6);
            fill('#ffb0bb', cx - 3, y + 6, 6, 4);
            fill('#ffb0bb', cx - 14, y + 12, 6, 3);
            fill('#ffb0bb', cx + 8, y + 10, 6, 3);
        } else if (kind === 'buoy') {
            fill('#f4f4f4', cx - 1, y - 4, 3, 10);
            fill('#e8524a', cx - 9, y + 6, 18, 8);
            fill('#f4f4f4', cx - 9, y + 14, 18, 6);
            fill('#e8524a', cx - 9, y + 20, 18, 8);
            fill('#2c7fb0', cx - 14, y + 30, 28, 3);
        } else if (kind === 'rock') {
            fill('#5f6b75', cx - 16, y + 18, 32, 18);
            fill('#7b8893', cx - 12, y + 12, 24, 8);
            fill('#9aa7b1', cx - 8, y + 14, 8, 3);
        } else if (kind === 'iceberg') {
            drawShadow(cx, base + 2, 34);
            fill('#bfe0f2', cx - 17, y + 14, 34, 26);
            fill('#e8f6ff', cx - 12, y - 2, 22, 18);
            fill('#ffffff', cx - 6, y - 8, 12, 8);
            fill('#9cc8e0', cx + 4, y + 16, 12, 22);
        } else if (kind === 'snowman') {
            drawShadow(cx, base + 2, 26);
            fill('#ffffff', cx - 12, y + 20, 24, 18);
            fill('#f4f8fb', cx - 9, y + 6, 18, 15);
            fill('#2b2f36', cx - 8, y - 4, 16, 10);
            fill('#2b2f36', cx - 11, y + 5, 22, 3);
            fill('#f2913a', cx + 3, y + 12, 7, 3);
            fill('#2b2f36', cx - 4, y + 10, 2, 2);
            fill('#2b2f36', cx + 2, y + 10, 2, 2);
        } else if (kind === 'igloo') {
            drawShadow(cx, base + 2, 40);
            fill('#eef6fb', cx - 20, y + 16, 40, 24);
            fill('#eef6fb', cx - 14, y + 8, 28, 10);
            fill('#cfe0ec', cx - 20, y + 26, 40, 2);
            fill('#cfe0ec', cx - 14, y + 16, 28, 2);
            fill('#1f3346', cx - 6, y + 26, 12, 14);
        }
    }

    function drawCoin(cx, y) {
        const cy = y + 24 + Math.round(Math.sin(time * 4 + cx) * 2);
        drawShadow(cx, y + CELL - 12, 12);
        fill('#b8860b', cx - 6, cy - 8, 12, 16);
        fill('#b8860b', cx - 8, cy - 6, 16, 12);
        fill('#ffcf4a', cx - 5, cy - 7, 10, 14);
        fill('#ffcf4a', cx - 7, cy - 5, 14, 10);
        fill('#7a4a22', cx - 5, cy - 1, 8, 3);
        fill('#ff5a36', cx + 3, cy - 1, 2, 3);
    }

    /* Cars and their cousins: one shape, different paint. */
    function drawVehicle(it, y, dir) {
        const x = Math.round(it.x);
        const w = it.w;
        const k = it.kind;
        if (k === 'jetski' || k === 'boat' || k === 'yacht' || k === 'icebreaker') {
            drawHull(it, x, w, y, dir);
            return;
        }
        let body = k === 'icecream' ? '#fbfbfb' : k === 'snowmobile' ? '#d9413a' : k === 'sled' ? '#a8743f' : it.color;
        drawShadow(x + w / 2, y + CELL - 9, w - 6);
        fill(shade(body, 25), x + 2, y + 10, w - 4, 6);
        fill(body, x, y + 14, w, 18);
        fill(shade(body, -45), x, y + 30, w, 8);
        if (k === 'icecream') {
            fill('#f28fb1', x, y + 22, w, 4);
            fill('#e7b169', x + w / 2 - 4, y + 2, 8, 8);
            fill('#f28fb1', x + w / 2 - 6, y - 4, 12, 7);
            fill('#2a3a4f', (dir > 0 ? x + w - 22 : x + 6), y + 16, 16, 7);
        } else if (k === 'snowmobile' || k === 'sled') {
            fill('#2b2f36', x + 10, y + 8, w - 26, 8);
            fill('#cfd6dd', x - 2, y + 38, w + 4, 3);
        } else {
            const cab = k === 'van' ? w - 14 : w - 26;
            const cx = dir > 0 ? x + w - cab - 8 : x + 8;
            fill(shade(body, 40), cx, y + 6, cab, 10);
            fill('#2a3a4f', cx + 3, y + 8, cab - 6, 6);
        }
        if (k !== 'sled' && k !== 'snowmobile') {
            fill('#141414', x + 7, y + 36, 11, 6);
            fill('#141414', x + w - 18, y + 36, 11, 6);
        }
        fill('#ffe28a', dir > 0 ? x + w - 3 : x, y + 20, 3, 6);
        fill('#c0392b', dir > 0 ? x : x + w - 3, y + 20, 3, 6);
    }

    function drawHull(it, x, w, y, dir) {
        const k = it.kind;
        const hull = k === 'icebreaker' ? '#c0392b' : '#f4f4f4';
        const nose = dir > 0 ? x + w : x;
        fill('rgba(255,255,255,0.35)', dir > 0 ? x - 14 : x + w + 2, y + 30, 12, 3);
        fill(hull, x + 4, y + 20, w - 8, 16);
        fill(shade(hull.length === 7 ? hull : '#f4f4f4', -60), x + 6, y + 34, w - 12, 4);
        fill(hull, dir > 0 ? nose - 6 : nose, y + 22, 6, 10);
        if (k === 'jetski') {
            fill('#e0563f', x + w / 2 - 8, y + 12, 16, 8);
            fill('#2b2f36', x + w / 2 - 3, y + 8, 6, 5);
        } else if (k === 'boat') {
            fill('#2c7fb0', x + 4, y + 26, w - 8, 3);
            fill('#ffffff', x + w / 2 - 16, y + 8, 32, 12);
            fill('#2a3a4f', x + w / 2 - 12, y + 11, 24, 5);
        } else if (k === 'yacht') {
            fill('#2a3a4f', x + 10, y + 26, w - 20, 3);
            fill('#ffffff', x + 16, y + 6, w - 32, 14);
            fill('#ffffff', x + 30, y - 2, w - 60, 9);
            for (let wx = x + 20; wx < x + w - 26; wx += 14) fill('#2a3a4f', wx, y + 10, 8, 5);
        } else {
            fill('#1a1d22', x + 4, y + 30, w - 8, 3);
            fill('#f4f4f4', x + w / 2 - 22, y + 4, 44, 16);
            fill('#2a3a4f', x + w / 2 - 18, y + 8, 36, 5);
            fill('#2b2f36', x + w / 2 - 4, y - 6, 8, 10);
        }
    }

    function drawRaft(it, y) {
        const x = Math.round(it.x);
        if (it.kind === 'log') {
            fill('#6d4420', x, y + 36, it.w, 4);
            fill('#8b5a2b', x, y + 18, it.w, 18);
            fill('#a8743d', x, y + 14, it.w, 6);
            for (let bx = x + 14; bx < x + it.w - 10; bx += 22) fill('#74481f', bx, y + 24, 10, 2);
            fill('#c9a173', x, y + 16, 6, 20);
            fill('#c9a173', x + it.w - 6, y + 16, 6, 20);
        } else if (it.kind === 'kelp') {
            fill('#2f5a24', x, y + 34, it.w, 4);
            fill('#4f7a3a', x, y + 16, it.w, 18);
            for (let bx = x + 6; bx < x + it.w - 6; bx += 10) fill('#6b9a48', bx, y + 12 + ((bx / 10) % 2) * 4, 4, 14);
        } else {
            fill('#8fb4cc', x + 2, y + 34, it.w - 4, 5);
            fill('#e8f1f8', x, y + 16, it.w, 18);
            fill('#ffffff', x + 4, y + 14, it.w - 8, 5);
            for (let bx = x + 12; bx < x + it.w - 12; bx += 30) fill('#cfe0ec', bx, y + 24, 12, 2);
        }
    }

    function drawNet(it, y) {
        const x = Math.round(it.x);
        ctx.fillStyle = 'rgba(138,106,58,0.85)';
        for (let gx = x; gx <= x + it.w; gx += 8) ctx.fillRect(gx, y + 10, 1, 28);
        for (let gy = y + 10; gy <= y + 38; gy += 7) ctx.fillRect(x, gy, it.w, 1);
        fill('#8a6a3a', x, y + 9, it.w, 2);
        for (let fx = x + 4; fx < x + it.w; fx += 24) fill('#f2913a', fx, y + 6, 6, 6);
    }

    function drawRider(r, y, dir) {
        const x = Math.round(r.x);
        if (r.kind === 'tram') {
            const seg = CELL * 3;
            for (let s = 0; s * seg < r.w; s++) {
                const sx = Math.round(x + s * seg);
                drawShadow(sx + seg / 2, y + CELL - 8, seg - 6);
                fill('#e46a5e', sx + 2, y + 2, seg - 6, 6);
                fill('#c8473d', sx + 2, y + 8, seg - 6, 26);
                fill('#f2f2f2', sx + 2, y + 22, seg - 6, 4);
                fill('#8e2b23', sx + 2, y + 34, seg - 6, 6);
                for (let wx = sx + 10; wx < sx + seg - 16; wx += 22) fill('#2a3a4f', wx, y + 11, 14, 8);
            }
            fill('#ffe28a', dir > 0 ? x + r.w - 6 : x + 2, y + 14, 4, 8);
            return;
        }
        const shark = r.kind === 'shark';
        const body = shark ? '#7d8b99' : '#14181d';
        const head = dir > 0 ? x + r.w : x;
        fill(body, x + 6, y + 16, r.w - 12, 16);
        fill(shark ? '#e9eef2' : '#ffffff', x + 10, y + 28, r.w - 24, 5);
        fill(body, dir > 0 ? head - 10 : head, y + 19, 10, 10);
        fill(body, dir > 0 ? x : x + r.w - 8, y + 12, 8, 24);
        fill(body, x + r.w / 2 - 5, y + 2, 10, 15);
        if (!shark) fill('#ffffff', dir > 0 ? head - 22 : head + 12, y + 18, 9, 5);
        fill('#000000', dir > 0 ? head - 14 : head + 10, y + 20, 3, 3);
    }

    function drawThings(lane, y) {
        if (lane.cat === 'safe') lane.blocked.forEach(function (kind, c) { drawDecor(kind, colX(c), y); });
        lane.coins.forEach(function (c) { drawCoin(colX(c), y); });
        if (lane.cat === 'traffic') lane.items.forEach(function (it) { drawVehicle(it, y, lane.dir); });
        else if (lane.cat === 'river') lane.items.forEach(function (it) { drawRaft(it, y); });
        else if (lane.cat === 'net') lane.items.forEach(function (it) { drawNet(it, y); });
        else if (lane.cat === 'express' && lane.express.rider) drawRider(lane.express.rider, y, lane.dir);
    }

    function footY(row) {
        const lane = sim.laneAt(row);
        return laneY(row) + (lane.cat === 'river' ? CELL - 12 : CELL - 7);
    }

    function hopT() {
        const p = sim.player;
        return p.hop ? clamp((p.hop.ticks + acc / DT) / Sim.HOP_TICKS, 0, 1) : 0;
    }

    /* The hop arc, squash on landing, stretch in the air, a lean that
       alternates hop to hop, a slow idle breath, and the way it dies. */
    function playerPose() {
        const p = sim.player;
        let x = p.x;
        let fy = footY(p.row);
        let lift = 0;
        let sx = 1;
        let sy = 1;
        let rot = 0;
        let alpha = 1;

        if (p.hop) {
            const t = hopT();
            const a = Math.sin(Math.PI * t);
            x = lerp(p.hop.fromX, p.hop.toX, t);
            fy = lerp(footY(p.hop.fromRow), footY(p.hop.toRow), t);
            lift = a * 14;
            sy = 1 + 0.1 * a;
            sx = 1 - 0.07 * a;
            rot = p.tilt * 0.12 * a;
        } else if (p.alive) {
            const breath = Math.sin(time * 3.2) * 0.02;
            sy = 1 + breath - 0.16 * landSquash;
            sx = 1 + 0.12 * landSquash;
        }
        if (bumpT) x += bumpDx * 3 * Math.sin(bumpT * Math.PI * 3);
        if (p.alive && p.grace > 0 && Math.floor(time * 12) % 2 === 0) alpha = 0.45;

        if (p.death) {
            const k = p.death.kind;
            const t = (sim.tick - sim.deathTick) / Sim.TICK_HZ;
            if (k === 'traffic' || k === 'express') {
                sy = 0.22;
                sx = 1.4;
                rot = 0;
            } else if (k === 'drown' || k === 'drift') {
                lift = -Math.min(1, t * 1.6) * 26;
                alpha = Math.max(0, 1 - t * 1.4);
            }
        }
        return { x: x, fy: fy, lift: lift, sx: sx, sy: sy, rot: rot, alpha: alpha };
    }

    function drawWhale(x, feet, sx, sy, rot, alpha, facing) {
        const s = sprite;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(Math.round(x), Math.round(feet));
        ctx.rotate(rot);
        ctx.scale(sx * facing, sy);
        ctx.drawImage(s, -Math.round(s.width / 2), -s.height);
        ctx.restore();
    }

    function drawPlayer(pose) {
        const p = sim.player;
        if (p.death && p.death.kind === 'seagull' && gull && gull.t > 0.45) return;
        const lane = sim.laneAt(p.row);
        const sinking = p.death && (p.death.kind === 'drown' || p.death.kind === 'drift');
        const swimming = !p.hop && !sinking && SWIM[lane.type];

        if (sinking || swimming) {
            /* cut the sprite off at the waterline: under water, out of sight */
            const surface = swimming ? pose.fy - Math.round(sprite.height * 0.42) : footY(p.row) - 2;
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, W, surface);
            ctx.clip();
            drawWhale(pose.x, pose.fy - pose.lift + (swimming ? 4 + Math.round(Math.sin(time * 3) * 2) : 0), pose.sx, pose.sy, pose.rot, pose.alpha, p.facing);
            ctx.restore();
            if (swimming) {
                const wob = Math.round(Math.sin(time * 4) * 2);
                fill('rgba(255,255,255,0.75)', pose.x - 20 - wob, surface, 14, 2);
                fill('rgba(255,255,255,0.75)', pose.x + 6 + wob, surface, 14, 2);
            }
        } else {
            drawShadow(pose.x, pose.fy - 3, 24 * (1 - 0.35 * (pose.lift / 14)));
            drawWhale(pose.x, pose.fy - pose.lift, pose.sx, pose.sy, pose.rot, pose.alpha, p.facing);
        }

        if (p.alive && p.shield) {
            const cy = pose.fy - pose.lift - sprite.height / 2;
            const r = Math.max(sprite.width, sprite.height) / 2 + 4;
            ctx.save();
            ctx.globalAlpha = 0.5 + Math.sin(time * 5) * 0.15;
            ctx.strokeStyle = '#9fe7ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(Math.round(pose.x), Math.round(cy), r, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        if (p.alive && p.trap > 0) {
            ctx.fillStyle = 'rgba(138,106,58,0.9)';
            const top = pose.fy - sprite.height * 0.6;
            for (let gx = -16; gx <= 16; gx += 6) ctx.fillRect(Math.round(pose.x + gx), Math.round(top), 1, Math.round(sprite.height * 0.55));
            for (let gy = 0; gy < sprite.height * 0.55; gy += 6) ctx.fillRect(Math.round(pose.x - 16), Math.round(top + gy), 33, 1);
        }
    }

    function drawGull() {
        if (!gull) return;
        const p = sim.player;
        const wx = p.x;
        const wy = footY(p.row) - sprite.height * 0.85;
        let gx;
        let gy;
        if (gull.t < 0.45) {
            const u = gull.t / 0.45;
            const e = 1 - (1 - u) * (1 - u);
            gx = lerp(W + 40, wx, e);
            gy = lerp(-30, wy - 6, e);
        } else {
            const u = Math.min(1, (gull.t - 0.45) / 0.8);
            gx = lerp(wx, -80, u * u);
            gy = lerp(wy - 6, -120, u);
            drawWhale(gx, gy + 6 + sprite.height, 1, 1, -0.25, 1, p.facing);
        }
        const flap = Math.floor(time * 14) % 2 === 0;
        ctx.save();
        ctx.translate(Math.round(gx), Math.round(gy));
        ctx.scale(2, 2);
        fill('#c9ced4', -16, -2, 7, 5);
        fill('#f4f4f4', -10, -4, 20, 9);
        fill('#f4f4f4', 8, -9, 8, 8);
        fill('#f2a33a', 16, -6, 6, 3);
        fill('#111111', 12, -7, 2, 2);
        if (flap) fill('#9aa3ad', -8, -15, 14, 11);
        else fill('#9aa3ad', -8, 3, 14, 8);
        ctx.restore();
    }

    function drawDashTrail() {
        if (!dashTrail) return;
        const a = 1 - dashTrail.t / 0.5;
        if (a <= 0) { dashTrail = null; return; }
        const top = laneY(dashTrail.to) + CELL / 2;
        const bottom = laneY(dashTrail.from) + CELL;
        ctx.save();
        ctx.globalAlpha = a * 0.6;
        fill('#9fe7ff', dashTrail.x - 3, Math.max(0, top), 6, Math.max(0, Math.min(H, bottom) - Math.max(0, top)));
        ctx.globalAlpha = a * 0.3;
        fill('#ffffff', dashTrail.x - 9, Math.max(0, top), 18, Math.max(0, Math.min(H, bottom) - Math.max(0, top)));
        ctx.restore();
    }

    function draw() {
        ctx.setTransform(k, 0, 0, k, 0, 0);
        ctx.imageSmoothingEnabled = false;
        fill('#0c1a2a', 0, 0, W, H);
        if (!sim) return;

        const p = sim.player;
        const pose = playerPose();
        const sinking = p.death && (p.death.kind === 'drown' || p.death.kind === 'drift');
        const playerRow = sinking ? p.row : Math.ceil(sim.camY - 1 + (H - (pose.fy - pose.lift)) / CELL);

        const top = Math.ceil(sim.camY + ROWS);
        const bottom = Math.floor(sim.camY) - 1;
        for (let row = top; row >= bottom; row--) {
            const lane = sim.laneAt(row);
            const y = laneY(row);
            drawGround(lane, y);
            drawThings(lane, y);
            if (row === playerRow) drawPlayer(pose);
        }
        if (playerRow > top || playerRow < bottom) drawPlayer(pose);

        drawDashTrail();
        particles.forEach(function (q) {
            fill(q.color, q.x - q.size / 2, screenY(q.wy) - q.size / 2, q.size, q.size);
        });
        drawGull();
    }

    /* ---------------------------------------------------------
       Runs: tickets, the fixed-tick loop, the key log
       --------------------------------------------------------- */

    let state = 'ready';     /* ready starting playing paused dying submitting over */
    let ticket = null;       /* { runId, seed, loadout, whaleId } — null in practice */
    let practice = false;
    let offerPractice = false;
    let inputs = [];
    let pending = [];
    let zoneShown = 'harbour';
    let bannerTimer = null;

    const NAMES = {
        car: 'a car', van: 'a van', icecream: 'an ice cream truck', jetski: 'a jet ski',
        boat: 'a boat', yacht: 'a yacht', snowmobile: 'a snowmobile', icebreaker: 'an icebreaker',
        sled: 'a sled', tram: 'a tram', shark: 'a shark', orca: 'an orca'
    };

    function deathMessage(d) {
        if (!d) return '';
        if (d.kind === 'traffic') return 'Flattened by ' + (NAMES[d.what] || 'traffic') + '.';
        if (d.kind === 'express') {
            return d.what === 'tram' ? 'The tram waits for no whale.'
                : d.what === 'shark' ? 'A shark had other plans.'
                    : 'Orcas: the ocean’s actual bosses.';
        }
        if (d.kind === 'drown') {
            return d.zone === 'sea' ? 'Swept off by the riptide.'
                : d.zone === 'arctic' ? 'Froze solid. Stay on the ice.'
                    : 'Turns out whales in suits can’t swim.';
        }
        if (d.kind === 'drift') return d.what === 'net' ? 'Tangled in a net and hauled away.' : 'Drifted out to sea.';
        return 'Snatched by a seagull. Keep moving!';
    }

    function randomSeed() { return crypto.getRandomValues(new Uint32Array(1))[0]; }

    function newRun(seed, loadout) {
        sim = Sim.create({ seed: seed, loadout: loadout });
        inputs = [];
        pending = [];
        acc = 0;
        particles = [];
        gull = null;
        dashTrail = null;
        zoneShown = 'harbour';
        updateHud();
    }

    async function begin(firstMove) {
        if (state === 'starting' || state === 'submitting' || state === 'playing') return;
        offerPractice = false;
        if (online) {
            const sess = currentSession();
            if (!sess) {
                showOverlay('One more thing', 'Pick a name', 'Save a name on the left first — it’s how the leaderboard knows you.', 'OK');
                state = 'ready';
                els.playerName.focus();
                return;
            }
            state = 'starting';
            showOverlay('Whale Road', 'Ready…', 'Getting your run ticket…', null);
            try {
                const lo = chosenLoadout();
                const t = await api('start', { token: sess.token, loadout: lo, whaleId: whaleId });
                ticket = t;
                practice = false;
                if (account) ITEMS.forEach(function (i) { if (t.loadout[i.id]) account.items[i.id]--; });
                renderShop();
                newRun(t.seed, t.loadout);
            } catch (err) {
                state = 'ready';
                if (err.status === 401) { dropSession(identity().key); refreshIdentity(); }
                if (err.status === 0) {
                    offerPractice = true;
                    showOverlay('Can’t reach the server', 'Practice?', 'The leaderboard is unreachable right now. Press <kbd>Space</kbd> for a practice run — it won’t be recorded.', 'Practice');
                    return;
                }
                showOverlay('Couldn’t start', 'Hmm.', '', 'Try again');
                els.text.textContent = err.message;
                return;
            }
        } else {
            startPractice();
            return;
        }
        state = 'playing';
        hideOverlay();
        if (firstMove) pending.push(firstMove);
        canvas.focus({ preventScroll: true });
    }

    function startPractice(firstMove) {
        practice = true;
        ticket = null;
        offerPractice = false;
        newRun(randomSeed(), {});
        state = 'playing';
        hideOverlay();
        if (firstMove) pending.push(firstMove);
        canvas.focus({ preventScroll: true });
    }

    async function runOver() {
        const score = sim.score;
        const msg = deathMessage(sim.player.death);

        if (practice || !ticket) {
            state = 'over';
            const best = Math.max(readStore('ssow-road-practice-best', 0), score);
            writeStore('ssow-road-practice-best', best);
            showOverlay(msg, String(score), 'Practice run — not recorded · press <kbd>Space</kbd> to go again', 'Play again');
            return;
        }

        state = 'submitting';
        showOverlay(msg, String(score), 'Checking your run with the server…', null);
        const sess = currentSession();
        const prevBest = myBest;
        try {
            const res = await api('finish', { token: sess.token, runId: ticket.runId, inputs: inputs, clientScore: score });
            if (account) account.coins = res.balance;
            if (res.best !== null && (myBest === null || res.best > myBest)) myBest = res.best;
            let text;
            if (res.flagged) {
                text = 'This run was flagged for review, so it won’t show on the board for now.';
            } else if (res.score > (prevBest === null ? -1 : prevBest) && res.rank) {
                text = 'New best! #' + res.rank + ' on the board.';
            } else {
                text = res.rank ? 'Your best: ' + res.best + ' · #' + res.rank + ' on the board.' : '';
            }
            text += (res.coins ? ' +' + res.coins + ' $CIGAR.' : '') + ' Press <kbd>Space</kbd> to go again.';
            state = 'over';
            showOverlay(msg, String(res.score), text, 'Play again');
            renderShop();
            updateRecords();
            soonRefreshBoard();
        } catch (err) {
            state = 'over';
            showOverlay(msg, String(score), '', 'Play again');
            els.text.textContent = 'Couldn’t record this run (' + err.message + ').';
        }
        ticket = null;
    }

    function handleEvents(events) {
        for (let i = 0; i < events.length; i++) {
            const e = events[i];
            if (e.type === 'coin') {
                burst(colX(e.col), e.row * CELL + 26, ['#ffcf4a', '#fff1b0', '#b8860b'], 10);
                updateHud();
            } else if (e.type === 'land') {
                landSquash = 1;
                updateHud();
            } else if (e.type === 'bump') {
                bumpT = 1;
                bumpDx = e.dx || 0;
            } else if (e.type === 'shield') {
                burst(sim.player.x, sim.player.row * CELL + 34, ['#9fe7ff', '#ffffff', '#5fc9f2'], 18, true);
                updatePowers();
            } else if (e.type === 'dash') {
                dashTrail = { from: e.from, to: e.to, x: sim.player.x, t: 0 };
                burst(sim.player.x, e.to * CELL + 20, ['#9fe7ff', '#ffffff'], 14, true);
                updateHud();
                updatePowers();
            } else if (e.type === 'trapped') {
                burst(sim.player.x, sim.player.row * CELL + 24, ['#c9a26a', '#8a6a3a'], 8);
            } else if (e.type === 'death') {
                if (e.kind === 'drown' || e.kind === 'drift') {
                    burst(sim.player.x, sim.player.row * CELL + 18, ['#ffffff', '#bfe3ff', '#5aa7dc'], 16);
                }
                if (e.kind === 'seagull') gull = { t: 0 };
            }
        }
        const zone = Sim.zoneOf(sim.player.row);
        if (zone !== zoneShown && (zone === 'sea' || zone === 'arctic')) {
            zoneShown = zone;
            showBanner(zone === 'sea' ? 'The Open Sea' : 'The Arctic');
        }
    }

    function showBanner(text) {
        els.banner.textContent = text;
        els.banner.hidden = false;
        clearTimeout(bannerTimer);
        bannerTimer = setTimeout(function () { els.banner.hidden = true; }, 2200);
    }

    function updateHud() {
        els.score.textContent = sim ? sim.score : 0;
        els.coins.textContent = sim ? sim.coins : 0;
    }

    function updatePowers() {
        const parts = [];
        const p = sim && state !== 'ready' ? sim.player : null;
        if (p && p.alive) {
            if (p.shield) parts.push('\u{1FAE7}');
            if (p.dashes > 0) parts.push('\u{1F4A8} E');
            if (p.magnet) parts.push('\u{1F9F2}');
        }
        els.powers.textContent = parts.join('  ');
    }

    function updateRecords() {
        els.best.textContent = myBest === null ? (online ? '—' : readStore('ssow-road-practice-best', 0)) : myBest;
        els.banked.textContent = account ? account.coins : '—';
    }

    function showOverlay(kicker, title, html, button) {
        els.kicker.textContent = kicker;
        els.title.textContent = title;
        els.text.innerHTML = html;
        els.button.hidden = !button;
        if (button) els.button.textContent = button;
        els.overlay.hidden = false;
    }

    function hideOverlay() { els.overlay.hidden = true; }

    function pause() {
        if (state !== 'playing') return;
        state = 'paused';
        showOverlay('Paused', 'Breather', 'Press <kbd>P</kbd> or <kbd>Space</kbd> to keep going.', 'Resume');
    }

    function resume() {
        state = sim.player.alive ? 'playing' : 'dying';
        acc = 0;
        last = performance.now();
        hideOverlay();
        canvas.focus({ preventScroll: true });
    }

    function primary(firstMove) {
        if (state === 'paused') { resume(); return; }
        if (state !== 'ready' && state !== 'over') return;
        if (offerPractice) startPractice(firstMove);
        else begin(firstMove);
    }

    let k = 1;   /* device pixels per world pixel */

    /* An integer number of device pixels per art pixel keeps the pixel
       art crisp; CSS then makes up the small remaining difference. */
    function resize() {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const next = clamp(Math.round((rect.width * dpr) / W), 1, 4);
        if (next !== k || canvas.width !== W * next) {
            k = next;
            canvas.width = W * k;
            canvas.height = H * k;
        }
    }

    let last = performance.now();

    /* Fixed 60 Hz ticks, exactly as the server replays them. Keys wait
       for the next tick boundary and are logged with that tick. */
    function frame(now) {
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        time += dt;

        if (sim && (state === 'playing' || state === 'dying' || (state === 'ready' && !sim.started))) {
            acc += dt;
            let steps = 0;
            while (acc >= DT && steps < 6) {
                if (state === 'playing' && pending.length && sim.player.alive) {
                    for (let i = 0; i < pending.length; i++) {
                        inputs.push([sim.tick, pending[i]]);
                        sim.input(pending[i]);
                    }
                }
                pending.length = 0;
                sim.step();
                handleEvents(sim.drain());
                acc -= DT;
                steps++;
                if (state === 'playing' && !sim.player.alive) state = 'dying';
                if (state === 'dying' && sim.over) { runOver(); break; }
            }
            if (steps >= 6) acc = 0;
            updatePowers();
        }

        updateParticles(dt);
        if (landSquash > 0) landSquash = Math.max(0, landSquash - dt * 8);
        if (bumpT > 0) bumpT = Math.max(0, bumpT - dt * 6);
        if (gull) gull.t += dt;
        if (dashTrail) dashTrail.t += dt;

        draw();
        window.requestAnimationFrame(frame);
    }

    const KEYS = {
        ArrowUp: 'u', KeyW: 'u',
        ArrowDown: 'd', KeyS: 'd',
        ArrowLeft: 'l', KeyA: 'l',
        ArrowRight: 'r', KeyD: 'r',
        KeyE: 'e'
    };

    /* Only grab keys while the board is on screen, so arrow keys still
       scroll the page when you're down reading the leaderboard. */
    let boardVisible = true;
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            boardVisible = entries[0].isIntersecting;
        }, { threshold: 0.35 }).observe(els.frame);
    }

    window.addEventListener('keydown', function (e) {
        const tag = (e.target && e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        const code = KEYS[e.code];
        const inGame = state === 'playing' || state === 'paused' || state === 'dying' || state === 'starting';
        if (!inGame && !boardVisible) return;
        if (!code && e.code !== 'Space' && e.code !== 'KeyP' && e.code !== 'Escape') return;

        e.preventDefault();
        if (e.repeat) return;                      /* tap to hop, no holding */

        if (e.code === 'Space') { primary(); return; }
        if (e.code === 'KeyP' || e.code === 'Escape') {
            if (state === 'playing') pause();
            else if (state === 'paused') resume();
            return;
        }
        if (state === 'playing') pending.push(code);
        else if ((state === 'ready' || state === 'over') && code !== 'e') primary(code);
    });

    els.button.addEventListener('click', function () { primary(); });
    els.claimName.addEventListener('click', claimName);
    els.playerName.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); claimName(); }
    });

    /* Tabbing away mid-run shouldn't kill you. */
    window.addEventListener('blur', pause);
    document.addEventListener('visibilitychange', function () {
        if (document.hidden) pause();
        last = performance.now();
    });

    els.checkWallet.addEventListener('click', function () {
        checkWallet(readStore('ssow-road-whale', null));
    });
    els.wallet.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); els.checkWallet.click(); }
    });
    /* A different wallet means the old one's whales are off the table. */
    els.wallet.addEventListener('input', function () {
        if (holdings && els.wallet.value.trim().toLowerCase() === holdings.address) return;
        checkToken++;                        /* forget any lookup still running */
        els.checkWallet.disabled = false;
        if (!holdings && !els.walletStatus.textContent) return;
        holdings = null;
        els.holdings.innerHTML = '';
        els.holdingsMore.hidden = true;
        setStatus(els.walletStatus, '');
        playAsGuest();
    });
    els.holdings.addEventListener('click', function (e) {
        const btn = e.target.closest('.Holding');
        if (btn && !btn.disabled) playWhale(Number(btn.dataset.id));
    });
    els.holdingsMore.addEventListener('click', showMoreHoldings);

    /* Called by the wallet section whenever the whale you'd play changes. */
    function onWhaleChange() {
        refreshIdentity();
    }

    /* ---------------------------------------------------------
       Boot
       --------------------------------------------------------- */

    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    window.addEventListener('resize', resize);
    resize();

    /* the world idles behind the menu until a run begins */
    sim = Sim.create({ seed: randomSeed(), loadout: {} });

    playAsGuest();
    renderShop();
    refreshIdentity();
    updateRecords();
    showOverlay(
        online ? 'Whale Road' : 'Whale Road · practice',
        'Ready?',
        online ? 'Save a name on the left, then press <kbd>Space</kbd> or <kbd>W</kbd>. <kbd>E</kbd> fires a Speed Dash.'
            : 'The leaderboard is offline, so runs aren’t recorded. Press <kbd>Space</kbd> to play.',
        'Play'
    );

    const savedWallet = readStore('ssow-road-wallet', null);
    if (savedWallet && window.WhaleChain.isAddress(savedWallet)) {
        els.wallet.value = savedWallet;
        checkWallet(readStore('ssow-road-whale', null));
    }

    goLive();
    window.requestAnimationFrame(frame);
})();
