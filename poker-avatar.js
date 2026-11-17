/* ============================================================
   LoungeAvatar — "Your whale" for the Cigar Lounge, and for the
   Whale 2048 leaderboard (same markup, same remembered choice).

   Paste a wallet, press Load: the poker function asks OpenSea
   (with a key only the server has) which OG whales it holds, and
   they show up as a grid. Tap one to play as it. No whales, or
   rather not say? Pick one of our own whale pfps instead.

   Remembered in this browser: the wallet (so it loads by itself
   next time) and the chosen avatar. The wallet only ever goes to
   the lookup; tables get the avatar ({ kind: 'og', id } or
   { kind: 'alt', v }) and never see the address. No signing —
   it's play chips, the picture is cosmetic.
   ============================================================ */

(function () {
    'use strict';

    const $ = function (id) { return document.getElementById(id); };
    const CONFIG = window.WHALE_ROAD_CONFIG || {};
    const LOCAL = new URLSearchParams(window.location.search).get('backend') === 'local';
    const API = LOCAL ? 'http://localhost:8788' : (CONFIG.supabaseUrl ? CONFIG.supabaseUrl + '/functions/v1/poker' : '');
    const WALLET_STORE = 'ssow-lounge-wallet';
    const AVATAR_STORE = 'ssow-lounge-avatar';
    const PFP_COLORS = ['#83c7b3', '#e0887a', '#ab9abf', '#add4db', '#e28537', '#c1dbb6'];
    const PFP_NAMES = ['Blue whale', 'Grey whale', 'Pink whale', 'Gold whale', 'Black whale', 'White whale'];

    const els = {
        wallet: $('walletInput'), load: $('walletLoad'), status: $('walletStatus'),
        grid: $('walletGrid'), pfps: $('pfpRow'),
        preview: $('avatarPreview'), label: $('avatarLabel')
    };
    if (!els.wallet) return;

    let avatar = read(AVATAR_STORE, null) || { kind: 'alt', v: 0 };
    let whales = [];

    function read(k, fallback) {
        try { return JSON.parse(window.localStorage.getItem(k)) || fallback; } catch (e) { return fallback; }
    }
    function write(k, v) {
        try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* fine */ }
    }

    function pfpImage(v) { return 'images/pfp/whale-' + v + '.svg'; }

    function imageOf(a) {
        if (a.kind === 'og') return a.image || pfpImage(0);
        return pfpImage(a.v || 0);
    }

    function say(text, kind) {
        els.status.textContent = text || '';
        els.status.className = 'Wallet-status' + (kind ? ' is-' + kind : '');
    }

    function choose(a) {
        avatar = a;
        write(AVATAR_STORE, a);
        mark();
        document.dispatchEvent(new CustomEvent('lounge:avatar', { detail: current() }));
    }

    /* the preview and which button looks pressed */
    function mark() {
        els.preview.src = imageOf(avatar);
        els.preview.parentNode.style.setProperty('--seat-bg', avatar.kind === 'alt' ? PFP_COLORS[avatar.v || 0] : '#fffaf1');
        els.label.textContent = avatar.kind === 'og' ? 'OG Whale #' + avatar.id : PFP_NAMES[avatar.v || 0];
        document.querySelectorAll('.Avatar-pick').forEach(function (b) {
            const on = (b.dataset.kind === 'og' && avatar.kind === 'og' && Number(b.dataset.id) === avatar.id) ||
                       (b.dataset.kind === 'alt' && avatar.kind === 'alt' && Number(b.dataset.v) === (avatar.v || 0));
            b.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
    }

    function button(kind, label, img, bg) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'Avatar-pick';
        b.dataset.kind = kind;
        b.setAttribute('aria-label', label);
        b.setAttribute('aria-pressed', 'false');
        b.title = label;
        if (bg) b.style.setProperty('--seat-bg', bg);
        const i = document.createElement('img');
        i.alt = '';
        i.width = 64;
        i.height = 64;
        i.loading = 'lazy';
        i.src = img;
        b.appendChild(i);
        return b;
    }

    function buildPfps() {
        PFP_COLORS.forEach(function (bg, v) {
            const b = button('alt', PFP_NAMES[v], pfpImage(v), bg);
            b.dataset.v = v;
            b.addEventListener('click', function () { choose({ kind: 'alt', v: v }); });
            els.pfps.appendChild(b);
        });
    }

    function buildGrid() {
        els.grid.innerHTML = '';
        whales.forEach(function (w) {
            const b = button('og', 'OG Whale #' + w.id, w.image || pfpImage(0));
            b.dataset.id = w.id;
            const tag = document.createElement('span');
            tag.className = 'Avatar-id';
            tag.textContent = '#' + w.id;
            b.appendChild(tag);
            b.addEventListener('click', function () { choose({ kind: 'og', id: w.id, image: w.image }); });
            els.grid.appendChild(b);
        });
        els.grid.hidden = !whales.length;
        mark();
    }

    async function load(quiet) {
        const address = els.wallet.value.trim();
        if (!address) { say('Paste a wallet address first.', 'warn'); return; }
        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
            say('That doesn’t look like a wallet address (0x and 40 letters or numbers). Pick a pfp below instead.', 'error');
            return;
        }
        if (!API) { say('Whale lookups aren’t set up on this copy of the site — pick a pfp below.', 'warn'); return; }
        els.load.disabled = true;
        if (!quiet) say('Looking for your whales…');
        try {
            const res = await fetch(API, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'wallet', address: address })
            });
            const data = await res.json().catch(function () { return {}; });
            if (!res.ok) throw new Error(data.error || 'something went wrong');
            whales = data.whales || [];
            write(WALLET_STORE, address);
            buildGrid();
            if (!whales.length) {
                say('No SSoW whales in that wallet — no worries, pick a pfp below.', 'warn');
            } else {
                say(whales.length === 1 ? 'Found 1 whale. Tap it to play as it.' : 'Found ' + whales.length + ' whales. Tap one to play as it.', 'ok');
                /* a remembered whale that's no longer in this wallet goes back to a pfp */
                if (avatar.kind === 'og' && !whales.some(function (w) { return w.id === avatar.id; })) choose({ kind: 'alt', v: 0 });
            }
        } catch (e) {
            say('Couldn’t load whales right now (' + e.message + '). Try again in a minute, or pick a pfp below.', 'error');
        } finally {
            els.load.disabled = false;
        }
    }

    /* what tables are told: which avatar, never the wallet */
    function current() {
        return avatar.kind === 'og'
            ? { kind: 'og', id: avatar.id, image: avatar.image || null }
            : { kind: 'alt', v: avatar.v || 0, image: pfpImage(avatar.v || 0) };
    }

    els.load.addEventListener('click', function () { load(false); });
    els.wallet.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); load(false); } });

    /* the panel shows in the lobby, not while a game is on */
    const panel = $('you');
    document.addEventListener('lounge:mode', function (e) { if (panel) panel.hidden = e.detail !== 'lobby'; });

    buildPfps();
    mark();
    const saved = read(WALLET_STORE, '');
    if (saved) { els.wallet.value = saved; load(true); }

    window.LoungeAvatar = {
        current: current,
        payload: function () {
            const a = current();
            return a.kind === 'og' ? { kind: 'og', id: a.id } : { kind: 'alt', v: a.v };
        },
        pfpImage: pfpImage,
        pfpColor: function (v) { return PFP_COLORS[v] || PFP_COLORS[0]; }
    };
})();
