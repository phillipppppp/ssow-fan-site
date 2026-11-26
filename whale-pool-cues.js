/* ============================================================
   Whale Pool — cues, Pearls and the Cue Shop (WhalePoolCues)

   Every cue has three stats, 1 to 5:
     aim    how much of the aim guide you see (the house cue only
            shows a short line; the best show where both balls go)
     power  how hard the cue can hit (85% to 100% of full power)
     spin   how far off centre the tip can reach (55% to 100%)

   Pearls are this game's own play coins: earned by beating the bot
   whales, spent in the Cue Shop. They are not money, not a token
   and not tradeable, and for now they live in this browser only.

   The two Legendary cues can't be bought. The Staff and the
   Trident belong to anyone whose OG whale holds a Staff or a
   Trident (the "Fin" trait): paste a wallet and the site's own
   server (the poker function's `legend` action) finds its OG
   whales on OpenSea and reads their traits from the collection's
   public IPFS metadata. No signing, and the wallet is never shown
   to anyone.

   Cue art is original and drawn in code (comic style: flat colour,
   ink outline).
   ============================================================ */

(function () {
    'use strict';

    const STORE = 'ssow-pool-locker';
    const LOUNGE_WALLET = 'ssow-lounge-wallet';     /* the wallet pasted in the Cigar Lounge / Whale 2048 */
    const INK = '#1d1b20';

    const RARITY = {
        common:    { name: 'Common',    color: '#bec4c3', pip: '#5d5862' },
        rare:      { name: 'Rare',      color: '#a1c0d6', pip: '#2563c9' },
        epic:      { name: 'Epic',      color: '#ab9abf', pip: '#7046a8' },
        legendary: { name: 'Legendary', color: '#f4b740', pip: '#d9901a' }
    };

    /* the cues. stats: [aim, power, spin] */
    const CUES = [
        { id: 'house',   name: 'House Cue',     rarity: 'common',    price: 0,    stats: [1, 1, 1], blurb: 'The lounge’s own. Short aim line — the rest is up to you.' },
        { id: 'pixel',   name: 'Pixel Whale',   rarity: 'rare',      price: 600,  stats: [3, 2, 2], blurb: 'Chunky 8-bit blocks, for the Pixel Whales.' },
        { id: 'cigar',   name: 'Cigar Lounge',  rarity: 'rare',      price: 600,  stats: [2, 2, 3], blurb: 'A cigar-wrapped butt with a paper band and an ember ring.' },
        { id: 'rainbow', name: 'Rainbow Grill', rarity: 'rare',      price: 600,  stats: [2, 3, 2], blurb: 'Every colour of the grill, end to end.' },
        { id: 'neon',    name: 'Neon Arcade',   rarity: 'rare',      price: 900,  stats: [3, 2, 3], blurb: 'Glows like an arcade sign at 2 a.m.' },
        { id: 'laser',   name: 'Laser Eyes',    rarity: 'epic',      price: 2000, stats: [4, 3, 3], blurb: 'A red laser runs down the shaft. Sees the angles.' },
        { id: 'orca',    name: 'Security Orca', rarity: 'epic',      price: 2000, stats: [3, 4, 3], blurb: 'Black and white, with a badge. Hits like security.' },
        { id: 'narwhal', name: 'Narwhal',       rarity: 'epic',      price: 2200, stats: [4, 2, 4], blurb: 'A spiral shaft like the tusk of the sea’s unicorn.' },
        { id: 'kraken',  name: 'Kraken',        rarity: 'epic',      price: 2200, stats: [3, 3, 4], blurb: 'A tentacle wraps the grip. Bends the cue ball.' },
        { id: 'golden',  name: 'Golden Whale',  rarity: 'legendary', price: 5000, stats: [5, 4, 4], blurb: 'Solid gold, for the rarest skin in the pod.' },
        { id: 'wealthy', name: 'Wealthy Whale', rarity: 'legendary', price: 5000, stats: [4, 4, 5], blurb: 'Black lacquer, diamond inlays, a top-hat cap.' },
        { id: 'staff',   name: 'The Staff',     rarity: 'legendary', price: 0,    stats: [5, 4, 5], holder: 'staff',   blurb: 'The golden scepter: a kraken crown gripping an amethyst. Holders only.' },
        { id: 'trident', name: 'The Trident',   rarity: 'legendary', price: 0,    stats: [5, 5, 4], holder: 'trident', blurb: 'The golden trident with the squid and its amethyst. Holders only.' }
    ];
    const BY_ID = {};
    CUES.forEach(function (c) { BY_ID[c.id] = c; });

    /* what the bots play with */
    const BOT_CUE = { easy: 'house', normal: 'cigar', hard: 'laser' };

    /* Pearls for a finished game against a bot */
    const REWARD = { easy: 40, normal: 90, hard: 180 };
    const LOSS = 10, DAILY = 100, BREAK_RUN = 150, START = 200;

    /* ---------- the locker: your Pearls and cues, in this browser ---------- */

    function today() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function load() {
        let L = null;
        try { L = JSON.parse(window.localStorage.getItem(STORE) || 'null'); } catch (e) { L = null; }
        if (!L || L.v !== 1) {
            /* a first visit: the welcome Pearls, kept from now on */
            L = { v: 1, pearls: START, owned: { house: true }, equipped: 'house', daily: '', legend: {}, wallet: '' };
            save(L);
        }
        L.owned = L.owned || { house: true };
        L.owned.house = true;
        L.legend = L.legend || {};
        if (!BY_ID[L.equipped] || !owns(L, L.equipped)) L.equipped = 'house';
        return L;
    }
    function save(L) { try { window.localStorage.setItem(STORE, JSON.stringify(L)); } catch (e) { /* fine */ } }

    function owns(L, id) {
        const c = BY_ID[id];
        if (!c) return false;
        if (c.holder) return !!(L.legend && L.legend[c.holder]);
        return !!L.owned[id];
    }

    function buy(id) {
        const L = load();
        const c = BY_ID[id];
        if (!c || c.holder) throw new Error('that cue isn’t for sale');
        if (owns(L, id)) return L;
        if (L.pearls < c.price) throw new Error('not enough Pearls yet');
        L.pearls -= c.price;
        L.owned[id] = true;
        L.equipped = id;
        save(L);
        return L;
    }

    function equip(id) {
        const L = load();
        if (!owns(L, id)) throw new Error('you don’t own that cue yet');
        L.equipped = id;
        save(L);
        return L;
    }

    function equipped() { return BY_ID[load().equipped] || BY_ID.house; }

    /* a finished game against a bot: { win, level, pro, breakRun } -> { total, lines } */
    function award(r) {
        const L = load();
        const lines = [];
        let total = 0;
        const base = r.win ? REWARD[r.level] || 0 : LOSS;
        lines.push([r.win ? 'Win vs ' + r.level : 'Game played', base]);
        total += base;
        if (r.pro) {
            const extra = Math.round(base / 2);
            lines.push(['No aim lines (+50%)', extra]);
            total += extra;
        }
        if (r.win && L.daily !== today()) {
            lines.push(['First win today', DAILY]);
            total += DAILY;
            L.daily = today();
        }
        if (r.win && r.breakRun) {
            lines.push(['Break and run', BREAK_RUN]);
            total += BREAK_RUN;
        }
        L.pearls += total;
        save(L);
        return { total: total, lines: lines, pearls: L.pearls };
    }

    /* ---------- the Legendary cues: does this wallet hold a Staff or a Trident? ---------- */

    async function checkWallet(address) {
        address = String(address || '').trim();
        if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('that doesn’t look like a wallet address');
        const cfg = window.WHALE_ROAD_CONFIG || {};
        if (!cfg.supabaseUrl) throw new Error('wallet lookups aren’t set up on this copy of the site');
        let res;
        try {
            res = await fetch(cfg.supabaseUrl + '/functions/v1/poker', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'legend', address: address })
            });
        } catch (e) {
            throw new Error('the lookup isn’t answering — check your connection and try again');
        }
        let data = {};
        try { data = await res.json(); } catch (e) { /* empty */ }
        if (!res.ok) throw new Error(data.error || 'something went wrong');
        const staff = data.staff || [];
        const trident = data.trident || [];
        const L = load();
        L.legend = { staff: staff.length > 0, trident: trident.length > 0, checked: today() };
        L.wallet = address.toLowerCase();
        if (!owns(L, L.equipped)) L.equipped = 'house';
        save(L);
        return { count: data.count || 0, staff: staff, trident: trident, unread: data.unread || 0 };
    }

    /* a wallet already pasted elsewhere on the site: check it quietly once a day */
    function autoCheck(done) {
        const L = load();
        let w = L.wallet;
        if (!w) { try { w = JSON.parse(window.localStorage.getItem(LOUNGE_WALLET) || '""'); } catch (e) { w = ''; } }
        if (!w || (L.legend && L.legend.checked === today() && L.wallet === String(w).toLowerCase())) return;
        checkWallet(w).then(function (r) { if (done) done(r); }, function () { /* try again another day */ });
    }

    /* ---------- drawing a cue ----------
       All cue artwork lives in whale-pool-cue-art.js (WhalePoolCueArt),
       one renderer shared by the Cue Shop cards and the cue on the
       table, so they always match. */
    function drawCue(c, id, x, y, angle, len, w0, w1, opts) {
        if (window.WhalePoolCueArt) window.WhalePoolCueArt.draw(c, id, x, y, angle, len, w0, w1, opts);
    }

    window.WhalePoolCues = {
        CUES: CUES, RARITY: RARITY, BOT_CUE: BOT_CUE, REWARD: REWARD,
        get: function (id) { return BY_ID[id] || BY_ID.house; },
        load: load, owns: function (id) { return owns(load(), id); },
        buy: buy, equip: equip, equipped: equipped, award: award,
        checkWallet: checkWallet, autoCheck: autoCheck,
        drawCue: drawCue,
        /* does this cue have live touches (pulse, shimmer) right now */
        animated: function (id) { return !!window.WhalePoolCueArt && window.WhalePoolCueArt.animated(id); },
        /* what a stat does */
        aimOf: function (cue) { return cue.stats[0]; },
        powerCap: function (cue) { return 0.85 + 0.0375 * (cue.stats[1] - 1); },
        spinReach: function (cue) { return 0.55 + 0.1125 * (cue.stats[2] - 1); }
    };
})();
