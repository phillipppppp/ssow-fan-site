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
        { id: 'staff',   name: 'The Staff',     rarity: 'legendary', price: 0,    stats: [5, 4, 5], holder: 'staff',   blurb: 'Only for holders of a whale with the Staff.' },
        { id: 'trident', name: 'The Trident',   rarity: 'legendary', price: 0,    stats: [5, 5, 4], holder: 'trident', blurb: 'Only for holders of a whale with the Trident.' }
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
       In "cue space": x runs from the tip (0) to the butt (len), y across.
       c: a 2D context already placed and rotated; w0/w1: half widths at
       tip and butt; px: one screen pixel in these units. */

    function shape(c, len, w0, w1) {
        c.beginPath();
        c.moveTo(0, -w0);
        c.lineTo(len, -w1);
        c.lineTo(len, w1);
        c.lineTo(0, w0);
        c.closePath();
    }

    function band(c, len, w1, x0, x1, fill) {
        c.fillStyle = fill;
        c.fillRect(x0 * len, -w1 - 2, (x1 - x0) * len, (w1 + 2) * 2);
    }

    const DESIGNS = {
        house:   { tip: '#3f6fd1', shaft: '#efd9ae', joint: '#f4b740', butt: '#5b3a22', rings: [[0.78, 0.8, '#f4b740']], cap: INK },
        pixel:   { tip: '#3f6fd1', shaft: '#f4efe4', joint: '#e0887a', butt: '#2563c9', cap: INK, deco: function (c, len, w1, px) {
            const s = Math.max(w1 * 0.9, 2.5 * px);
            for (let x = 0.66 * len, k = 0; x < 0.95 * len; x += s, k++) {
                for (let y = -w1, j = 0; y < w1; y += s, j++) {
                    c.fillStyle = (k + j) % 3 === 0 ? '#83c7b3' : ((k + j) % 3 === 1 ? '#2563c9' : '#1d3f86');
                    c.fillRect(x, y, s, s);
                }
            }
        } },
        cigar:   { tip: '#3f6fd1', shaft: '#efd9ae', joint: '#e2582c', butt: '#7a4a26', cap: '#3b2b1d', deco: function (c, len, w1) {
            band(c, len, w1, 0.70, 0.77, '#fbf6ea');
            band(c, len, w1, 0.715, 0.725, '#d9503a');
            band(c, len, w1, 0.745, 0.755, '#d9503a');
            /* tobacco-leaf veins */
            c.strokeStyle = 'rgba(40, 20, 8, 0.45)';
            c.lineWidth = w1 * 0.18;
            for (let x = 0.8; x < 0.95; x += 0.035) { c.beginPath(); c.moveTo(x * len, -w1); c.lineTo((x + 0.02) * len, w1); c.stroke(); }
        } },
        rainbow: { tip: '#3f6fd1', shaft: '#fbf6ea', joint: '#1d1b20', butt: '#e0352b', cap: INK, deco: function (c, len, w1) {
            const cols = ['#e0352b', '#f07a1a', '#f5c400', '#1f8a4c', '#2563c9', '#7046a8'];
            for (let i = 0; i < 6; i++) band(c, len, w1, 0.655 + i * 0.05, 0.705 + i * 0.05, cols[i]);
        } },
        neon:    { tip: '#ff4fd8', shaft: '#2a1f3d', joint: '#3ee8ff', butt: '#1d1530', cap: '#ff4fd8', glow: true, deco: function (c, len, w1, px) {
            c.lineWidth = Math.max(1.2 * px, w1 * 0.22);
            c.shadowBlur = 6 * px;
            c.shadowColor = '#ff4fd8'; c.strokeStyle = '#ff7ae4';
            c.beginPath(); c.moveTo(0.03 * len, -w1 * 0.4); c.lineTo(0.96 * len, -w1 * 0.45); c.stroke();
            c.shadowColor = '#3ee8ff'; c.strokeStyle = '#7ef0ff';
            c.beginPath(); c.moveTo(0.03 * len, w1 * 0.4); c.lineTo(0.96 * len, w1 * 0.45); c.stroke();
            c.shadowBlur = 0;
        } },
        laser:   { tip: '#d9503a', shaft: '#3a3840', joint: '#d9503a', butt: '#26242b', cap: INK, deco: function (c, len, w1, px) {
            c.shadowBlur = 8 * px;
            c.shadowColor = '#ff2a2a';
            c.strokeStyle = '#ff4a3a';
            c.lineWidth = Math.max(1.4 * px, w1 * 0.3);
            c.beginPath(); c.moveTo(0.025 * len, 0); c.lineTo(0.95 * len, 0); c.stroke();
            c.shadowBlur = 0;
        } },
        orca:    { tip: '#3f6fd1', shaft: '#fbf6ea', joint: INK, butt: INK, cap: INK, deco: function (c, len, w1) {
            c.fillStyle = '#fbf6ea';
            c.beginPath(); c.ellipse(0.74 * len, -w1 * 0.25, 0.05 * len, w1 * 0.5, 0, 0, Math.PI * 2); c.fill();
            c.beginPath(); c.ellipse(0.88 * len, w1 * 0.35, 0.035 * len, w1 * 0.45, 0, 0, Math.PI * 2); c.fill();
            c.fillStyle = '#f4b740';
            c.beginPath(); c.arc(0.81 * len, 0, w1 * 0.55, 0, Math.PI * 2); c.fill();
            c.strokeStyle = INK; c.lineWidth = w1 * 0.15; c.stroke();
        } },
        narwhal: { tip: '#3f6fd1', shaft: '#f3ead7', joint: '#bec4c3', butt: '#e6dcc4', cap: '#94989c', deco: function (c, len, w1, px) {
            c.strokeStyle = 'rgba(120, 100, 70, 0.55)';
            c.lineWidth = Math.max(1 * px, w1 * 0.16);
            for (let x = 0.03 * len; x < 0.97 * len; x += w1 * 2.6) { c.beginPath(); c.moveTo(x, -w1 * 1.2); c.lineTo(x + w1 * 2.2, w1 * 1.2); c.stroke(); }
        } },
        kraken:  { tip: '#3f6fd1', shaft: '#efd9ae', joint: '#5f4c88', butt: '#7046a8', cap: '#3b2a5e', deco: function (c, len, w1) {
            c.strokeStyle = '#9d7ccf';
            c.lineWidth = w1 * 0.55;
            c.beginPath();
            for (let x = 0.66 * len, k = 0; x <= 0.95 * len; x += len * 0.01, k++) {
                const y = Math.sin(k * 0.55) * w1 * 0.55;
                if (k === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.stroke();
            c.fillStyle = '#f2c6d6';
            for (let x = 0.68; x < 0.95; x += 0.04) { c.beginPath(); c.arc(x * len, w1 * 0.62, w1 * 0.26, 0, Math.PI * 2); c.fill(); }
        } },
        golden:  { tip: '#3f6fd1', shaft: '#f4b740', joint: INK, butt: '#e0a21c', cap: INK, gold: true, deco: function (c, len, w1) {
            const g = c.createLinearGradient(0, -w1, 0, w1);
            g.addColorStop(0, 'rgba(255, 240, 190, 0.85)');
            g.addColorStop(0.4, 'rgba(255, 220, 120, 0)');
            c.fillStyle = g;
            c.fillRect(0.02 * len, -w1, 0.96 * len, w1);
            c.fillStyle = '#fffaf1';
            [0.72, 0.84].forEach(function (x) { c.beginPath(); c.moveTo(x * len, -w1 * 0.6); c.lineTo(x * len + w1 * 0.4, 0); c.lineTo(x * len, w1 * 0.6); c.lineTo(x * len - w1 * 0.4, 0); c.closePath(); c.fill(); });
        } },
        wealthy: { tip: '#3f6fd1', shaft: '#2a2730', joint: '#f4b740', butt: '#141216', cap: '#f4b740', deco: function (c, len, w1) {
            c.fillStyle = '#e8f6ff';
            for (let x = 0.68; x < 0.95; x += 0.035) { c.beginPath(); c.moveTo(x * len, -w1 * 0.35); c.lineTo(x * len + w1 * 0.3, 0); c.lineTo(x * len, w1 * 0.35); c.lineTo(x * len - w1 * 0.3, 0); c.closePath(); c.fill(); }
            band(c, len, w1, 0.2, 0.205, '#f4b740');
        } },
        staff:   { tip: '#3f6fd1', shaft: '#9a6a36', joint: '#5a3a1c', butt: '#7a4f25', cap: '#5a3a1c', deco: function (c, len, w1) {
            c.fillStyle = 'rgba(70, 40, 15, 0.55)';
            [0.18, 0.37, 0.55, 0.71, 0.86].forEach(function (x, i) { c.beginPath(); c.ellipse(x * len, (i % 2 ? 1 : -1) * w1 * 0.3, w1 * 0.9, w1 * 0.45, 0, 0, Math.PI * 2); c.fill(); });
            c.strokeStyle = 'rgba(60, 35, 12, 0.4)';
            c.lineWidth = w1 * 0.12;
            c.beginPath(); c.moveTo(0.03 * len, -w1 * 0.2); c.bezierCurveTo(0.3 * len, w1 * 0.4, 0.6 * len, -w1 * 0.5, 0.97 * len, w1 * 0.2); c.stroke();
        }, after: function (c, len, w1, px) {
            /* a glowing orb set in the butt */
            c.shadowBlur = 10 * px;
            c.shadowColor = '#7ef0ff';
            c.fillStyle = '#9ff4ff';
            c.beginPath(); c.arc(len + w1 * 1.1, 0, w1 * 1.5, 0, Math.PI * 2); c.fill();
            c.shadowBlur = 0;
            c.fillStyle = 'rgba(255, 255, 255, 0.9)';
            c.beginPath(); c.arc(len + w1 * 0.7, -w1 * 0.5, w1 * 0.45, 0, Math.PI * 2); c.fill();
            c.strokeStyle = INK; c.lineWidth = Math.max(1.2 * px, w1 * 0.18);
            c.beginPath(); c.arc(len + w1 * 1.1, 0, w1 * 1.5, 0, Math.PI * 2); c.stroke();
            c.fillStyle = '#5a3a1c';
            c.fillRect(len - w1 * 0.4, -w1 * 1.25, w1 * 0.8, w1 * 2.5);
            c.strokeRect(len - w1 * 0.4, -w1 * 1.25, w1 * 0.8, w1 * 2.5);
        } },
        trident: { tip: '#3f6fd1', shaft: '#6fb6ad', joint: '#f4b740', butt: '#2f7f74', cap: '#f4b740', deco: function (c, len, w1) {
            c.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            c.lineWidth = w1 * 0.25;
            c.beginPath(); c.moveTo(0.03 * len, -w1 * 0.45); c.lineTo(0.96 * len, -w1 * 0.55); c.stroke();
            band(c, len, w1, 0.86, 0.88, '#f4b740');
        }, after: function (c, len, w1, px) {
            /* a gold trident head on the butt end */
            const L = w1 * 7, base = len + w1 * 0.4;
            c.fillStyle = '#f4b740';
            c.strokeStyle = INK;
            c.lineWidth = Math.max(1.2 * px, w1 * 0.18);
            c.beginPath();
            c.moveTo(base, -w1 * 2.2); c.lineTo(base + w1 * 0.9, -w1 * 2.2); c.lineTo(base + w1 * 0.9, w1 * 2.2); c.lineTo(base, w1 * 2.2); c.closePath();
            c.fill(); c.stroke();
            [-1, 0, 1].forEach(function (k) {
                const y = k * w1 * 1.7;
                c.beginPath();
                c.moveTo(base + w1 * 0.9, y - w1 * 0.35);
                c.lineTo(base + L * (k ? 0.75 : 0.95), y - w1 * 0.35);
                c.lineTo(base + L * (k ? 0.75 : 0.95) + w1 * 1.1, y);
                c.lineTo(base + L * (k ? 0.75 : 0.95), y + w1 * 0.35);
                c.lineTo(base + w1 * 0.9, y + w1 * 0.35);
                c.closePath();
                c.fill(); c.stroke();
            });
        } }
    };

    /* draw cue `id`: tip at (x, y) pointing away from angle (radians, the
       direction from tip to butt), len and half widths in canvas pixels */
    function drawCue(c, id, x, y, angle, len, w0, w1, opts) {
        const d = DESIGNS[id] || DESIGNS.house;
        const px = (opts && opts.px) || 1;
        c.save();
        if (opts && opts.shadow) {
            /* a soft shadow on the felt, offset in screen space */
            c.save();
            c.globalAlpha = 0.22;
            c.translate(x + opts.shadow[0], y + opts.shadow[1]);
            c.rotate(angle);
            shape(c, len, w0, w1);
            c.fillStyle = '#0b2a22';
            c.fill();
            c.restore();
        }
        c.translate(x, y);
        c.rotate(angle);
        c.save();
        shape(c, len, w0, w1);
        c.clip();
        band(c, len, w1, 0, 0.62, d.shaft);
        band(c, len, w1, 0.62, 1, d.butt);
        band(c, len, w1, 0.62, 0.645, d.joint);
        (d.rings || []).forEach(function (r) { band(c, len, w1, r[0], r[1], r[2]); });
        if (d.deco) d.deco(c, len, w1, px);
        band(c, len, w1, 0.96, 1, d.cap);
        band(c, len, w1, 0.011, 0.03, '#fbf6ea');                  /* ferrule */
        band(c, len, w1, 0, 0.011, d.tip);                        /* tip */
        c.restore();
        shape(c, len, w0, w1);
        c.lineWidth = Math.max(1.2, 1.6 * px);
        c.strokeStyle = INK;
        c.stroke();
        if (d.after) d.after(c, len, w1, px);
        c.restore();
    }

    window.WhalePoolCues = {
        CUES: CUES, RARITY: RARITY, BOT_CUE: BOT_CUE, REWARD: REWARD,
        get: function (id) { return BY_ID[id] || BY_ID.house; },
        load: load, owns: function (id) { return owns(load(), id); },
        buy: buy, equip: equip, equipped: equipped, award: award,
        checkWallet: checkWallet, autoCheck: autoCheck,
        drawCue: drawCue,
        /* what a stat does */
        aimOf: function (cue) { return cue.stats[0]; },
        powerCap: function (cue) { return 0.85 + 0.0375 * (cue.stats[1] - 1); },
        spinReach: function (cue) { return 0.55 + 0.1125 * (cue.stats[2] - 1); }
    };
})();
