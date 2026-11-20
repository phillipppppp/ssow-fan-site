/* ============================================================
   Orca Race and Whale Race — the page: setup, the race on a
   canvas, results. One script for both: <body data-race="whale">
   races OG whales (whale-race.html), anything else races Security
   Orcas (orca-race.html). Only the pictures and the wording differ;
   the race itself is the same OrcaRaceSim either way.

   Who wins is NOT decided here. orca-race-sim.js works out the
   whole race from the race code and the racer list before the
   countdown ends; this file only plays it back, draws it, and
   makes noise. Nothing in this file calls Math.random: race
   codes come from crypto.getRandomValues, and the cosmetic bits
   (splash spray, confetti) use a generator seeded by the code.

   Orca pictures come from the orca-race edge function, which asks
   OpenSea with a key only the server has. If it can't be reached,
   or an orca number doesn't exist, or a picture won't load, the
   racer simply gets the default orca picture.
   ============================================================ */

(function () {
    'use strict';

    const Sim = window.OrcaRaceSim;
    const $ = function (id) { return document.getElementById(id); };
    if (!Sim || !$('setup')) return;

    /* what's racing: everything that differs between the two pages */
    const KINDS = {
        orca: {
            action: 'orcas',            // the function's picture lookup
            gaps: true,                 // the numbers have gaps: ask the server which are real
            noun: 'orca', nouns: 'orcas', Noun: 'Orca',
            collection: 'Security Orca', collections: 'Security Orcas',
            tag: 'Orca #',
            idLength: 6,
            defaultImg: 'images/orca.avif',
            defaultCut: 'images/orca-default-cut.webp',
            cutout: function () { return window.OrcaCutout; },
            store: 'ssow-orca-race',
            salt: 'ssow-orca-picture|',
            title: '🐋 **SSoW Orca Race — results**'
        },
        whale: {
            action: 'whales',
            gaps: false,                // OG whales are simply #0 to #9999 (the contract has no #10000)
            supply: 10000,
            first: 0,
            noun: 'whale', nouns: 'whales', Noun: 'Whale',
            collection: 'OG whale', collections: 'OG whales',
            tag: 'Whale #',
            idLength: 5,
            defaultImg: 'images/pfp/whale-0.svg',
            defaultCut: 'images/whale-default-cut.svg',
            cutout: function () { return window.WhaleCutout; },
            store: 'ssow-whale-race',
            salt: 'ssow-whale-picture|',
            title: '🐳 **SSoW Whale Race — results**'
        }
    };
    const K = KINDS[document.body.dataset.race] || KINDS.orca;

    const CONFIG = window.WHALE_ROAD_CONFIG || {};
    const LOCAL = new URLSearchParams(window.location.search).get('backend') === 'local';
    const API = LOCAL ? 'http://localhost:8790' : (CONFIG.supabaseUrl ? CONFIG.supabaseUrl + '/functions/v1/orca-race' : '');
    const DEFAULT_IMG = K.defaultImg;
    const DEFAULT_CUT = K.defaultCut;
    const MIN_RACERS = 2;
    const MAX_RACERS = 30;
    const FALLBACK_SUPPLY = 1000;      // used for "random orcas" only until the server says how many there are
    const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const STORE = K.store;
    const COUNTDOWN = 3.6;             // 3, 2, 1, GO
    const Sound = window.OrcaSound || { play: function () {}, isMuted: function () { return true; }, toggle: function () { return true; } };

    const els = {
        setup: $('setup'), list: $('list'), empty: $('empty'), count: $('count'), status: $('setupStatus'),
        addRacer: $('addRacer'), addRandom: $('addRandom'), shuffle: $('shuffle'), clear: $('clear'),
        code: $('code'), fingerprint: $('fingerprint'), newCode: $('newCode'),
        replayForm: $('replayForm'), replayCode: $('replayCode'), start: $('start'),
        stage: $('stage'), pool: $('pool'), canvas: $('canvas'), confetti: $('confetti'),
        clock: $('clock'), hudCode: $('hudCode'), leader: $('leader'),
        mute: $('mute'), fullscreen: $('fullscreen'),
        results: $('results'), resultsMeta: $('resultsMeta'), podium: $('podium'), order: $('order'),
        copy: $('copy'), again: $('again'), newRace: $('newRace'), copyStatus: $('copyStatus'),
        announce: $('announce'),
        /* "Paste a list" (only on pages that have it) */
        paste: $('paste'), pastePanel: $('pastePanel'), pasteText: $('pasteText'),
        pasteAdd: $('pasteAdd'), pasteReplace: $('pasteReplace'), pasteCancel: $('pasteCancel')
    };

    /* ============================================================
       State
       ============================================================ */

    let racers = [];                   // { uid, name, id } (id is the raw text typed)
    let uid = 0;
    let code = '';
    let supply = K.supply || null;
    /* every real number: orcas have gaps, so the server says which; OG whales are 0 to 9999 */
    let catalog = K.gaps ? null : Array.from({ length: K.supply }, function (_, i) { return i + K.first; });
    const images = new Map();          // orca number -> url | null (null: no picture, use the default)
    const pending = new Set();

    function randomInt(n) {
        const a = new Uint32Array(1);
        window.crypto.getRandomValues(a);
        return a[0] % n;
    }

    function newCode() {
        let c = '';
        for (let i = 0; i < 6; i++) c += CODE_CHARS[randomInt(CODE_CHARS.length)];
        return c;
    }

    function lengthSeconds() {
        const on = document.querySelector('input[name="length"]:checked');
        const v = on ? Number(on.value) : 20;
        return v === 10 || v === 30 ? v : 20;
    }

    function setLength(v) {
        const r = document.querySelector('input[name="length"][value="' + v + '"]');
        if (r) r.checked = true;
    }

    function idOf(r) { return Sim.cleanId(String(r.id).trim()); }

    /* the list the race actually uses: blank names get a sensible one */
    function finalRacers() {
        return racers.map(function (r, i) {
            const id = String(r.id).trim() === '' ? null : idOf(r);
            let name = Sim.cleanName(r.name);
            if (!name) name = id !== null ? K.tag + id : 'Racer ' + (i + 1);
            return { name: name, orcaId: id };
        });
    }

    function imageFor(id) {
        if (id === null || id === undefined) return DEFAULT_IMG;
        const u = images.get(id);
        return u || DEFAULT_IMG;
    }

    /* Every racer gets a different orca to look at. A typed number is that
       orca; a racer with just a name gets one picked from their name (the
       same name always gets the same orca, and no two racers share one).
       It's only the picture: the race itself never sees it. */
    function pictureIds(entries) {
        const out = entries.map(function (e) { return e.id; });
        if (!catalog || !catalog.length) return out;
        const taken = new Set(out.filter(function (x) { return x !== null; }));
        const need = entries.map(function (_, i) { return i; }).filter(function (i) { return out[i] === null; });
        need.sort(function (a, b) { return entries[a].key < entries[b].key ? -1 : entries[a].key > entries[b].key ? 1 : a - b; });
        need.forEach(function (i) {
            let k = Sim.hash128(K.salt + entries[i].key)[0] % catalog.length;
            for (let tries = 0; taken.has(catalog[k]) && tries < catalog.length; tries++) k = (k + 1) % catalog.length;
            out[i] = catalog[k];
            taken.add(catalog[k]);
        });
        return out;
    }

    function setupPictures() {
        return pictureIds(racers.map(function (r, i) {
            const typed = String(r.id).trim() !== '';
            return { id: typed ? idOf(r) : null, key: Sim.cleanName(r.name).toLowerCase() || 'racer ' + (i + 1) };
        }));
    }

    function isRealOrca(id) { return id !== null && (!catalog || catalog.indexOf(id) >= 0); }

    function save() {
        try {
            window.localStorage.setItem(STORE, JSON.stringify({
                racers: racers.map(function (r) { return { name: r.name, id: r.id }; }),
                length: lengthSeconds()
            }));
        } catch (e) { /* fine */ }
    }

    function say(text, kind) {
        els.status.textContent = text || '';
        els.status.className = 'Wallet-status' + (kind ? ' is-' + kind : '');
    }

    /* ============================================================
       Orca pictures (through our edge function; the key stays there)
       ============================================================ */

    async function api(body) {
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok) throw new Error(data.error || 'something went wrong');
        return data;
    }

    async function fetchImages() {
        const want = [];
        setupPictures().forEach(function (id) {
            if (id !== null && !images.has(id) && !pending.has(id) && want.indexOf(id) < 0) want.push(id);
        });
        if (!want.length) return;
        if (!API) { want.forEach(function (id) { images.set(id, null); }); refreshPics(); return; }
        want.forEach(function (id) { pending.add(id); });
        try {
            for (let i = 0; i < want.length; i += MAX_RACERS) {
                const part = want.slice(i, i + MAX_RACERS);
                const data = await api({ action: K.action, ids: part });
                if (data.supply) supply = data.supply;
                part.forEach(function (id) {
                    const u = data.images && data.images[id];
                    images.set(id, typeof u === 'string' && /^https:\/\//.test(u) ? u : null);
                });
            }
        } catch (e) {
            /* no pictures right now: default orcas, and we'll ask again next time */
            say('Couldn’t load ' + K.noun + ' pictures right now — the default ' + K.noun + ' will swim instead.', 'warn');
        } finally {
            want.forEach(function (id) { pending.delete(id); });
            refreshPics();
        }
    }

    /* how many orcas there are, and which numbers really exist (they have gaps) */
    let catalogWait = null;
    function fetchSupply() {
        if (!K.gaps) return Promise.resolve(catalog);       /* already known */
        if (!API) return Promise.resolve(null);
        if (!catalogWait) {
            catalogWait = api({ action: 'info' }).then(function (d) {
                if (d.supply) supply = d.supply;
                if (Array.isArray(d.ids) && d.ids.length) {
                    catalog = d.ids.filter(function (x) { return Number.isInteger(x); });
                    refreshPics();
                    fetchImages();
                }
                return catalog;
            }).catch(function () { catalogWait = null; return null; });     /* try again next time */
        }
        return catalogWait;
    }

    /* resolves once test() is true, or after `ms` either way */
    function waitFor(test, ms) {
        return new Promise(function (done) {
            const until = Date.now() + ms;
            (function check() {
                if (test() || Date.now() > until) done();
                else setTimeout(check, 100);
            })();
        });
    }

    /* the orca list, waiting for it at most `ms` (the first visit of a day takes a few seconds) */
    function ensureCatalog(ms) {
        if (catalog || !API) return Promise.resolve(catalog);
        return Promise.race([fetchSupply(), new Promise(function (r) { setTimeout(function () { r(null); }, ms); })]);
    }

    /* racers whose number isn't a Security Orca (remembered from before, or typed) */
    function badRacers() {
        if (!catalog) return [];
        return racers.filter(function (r) { return String(r.id).trim() !== '' && !isRealOrca(idOf(r)); });
    }

    function warnBad() {
        const bad = badRacers();
        if (!bad.length) {
            if (els.status.dataset.bad) { say(''); delete els.status.dataset.bad; }
            return;
        }
        const nums = bad.map(function (r) { return '#' + String(r.id).trim(); }).join(', ');
        say((bad.length === 1 ? nums + ' isn’t ' + article(K.collection) + ' ' + K.collection : nums + ' aren’t ' + K.collections) +
            (K.gaps ? ' (the numbers have gaps)' : ' (they go from #' + K.first + ' to #' + (K.first + K.supply - 1) + ')') +
            ', so ' + (bad.length === 1 ? 'it races' : 'they race') + ' as the default ' + K.noun + '. ', 'warn');
        const fix = document.createElement('button');
        fix.type = 'button';
        fix.className = 'Btn Or-small';
        fix.textContent = bad.length === 1 ? 'Swap for a real ' + K.noun : 'Swap for real ' + K.nouns;
        fix.addEventListener('click', swapBad);
        els.status.appendChild(fix);
        els.status.dataset.bad = '1';
    }

    function article(word) { return /^[aeiou]/i.test(word) ? 'an' : 'a'; }

    /* give those racers real ones instead; a typed name stays */
    function swapBad() {
        const taken = new Set(racers.map(idOf).filter(isRealOrca));
        setupPictures().forEach(function (x) { if (x !== null) taken.add(x); });
        badRacers().forEach(function (r) {
            let id = null;
            for (let tries = 0; tries < 200 && (id === null || taken.has(id)); tries++) id = catalog[randomInt(catalog.length)];
            if (id === null) return;
            taken.add(id);
            const old = String(r.id).trim();
            if (!Sim.cleanName(r.name) || Sim.cleanName(r.name) === K.tag + old) r.name = K.tag + id;
            r.id = String(id);
        });
        render();
    }

    /* an <img> that falls back to the default orca, once */
    function safeImg(src, size) {
        const i = document.createElement('img');
        i.alt = '';
        if (/^https:\/\//.test(src)) i.crossOrigin = 'anonymous';    /* same request the cut-out makes */
        i.width = size;
        i.height = size;
        i.decoding = 'async';
        i.addEventListener('error', function () {
            if (i.dataset.fallback) return;
            i.dataset.fallback = '1';
            i.src = DEFAULT_IMG;
        });
        i.src = src;
        return i;
    }

    function refreshPics() {
        const pics = setupPictures();
        els.list.querySelectorAll('.Racer').forEach(function (row) {
            const at = racers.findIndex(function (x) { return String(x.uid) === row.dataset.uid; });
            if (at < 0) return;
            const r = racers[at];
            const typed = String(r.id).trim() !== '';
            const id = typed ? idOf(r) : null;
            const src = imageFor(pics[at]);
            const box = row.querySelector('.Racer-pic');
            const img = box.querySelector('img');
            if (!img || img.dataset.want !== src) {
                const n = safeImg(src, 44);
                n.dataset.want = src;
                box.replaceChildren(n);
            }
            box.title = !typed && pics[at] !== null ? 'Picked for you: ' + K.tag + pics[at] + ' (just the picture, it doesn’t change the race)' : '';
            const bad = typed && (id === null || !isRealOrca(id) || (images.has(id) && images.get(id) === null && API));
            row.querySelector('.Racer-id').classList.toggle('is-bad', bad);
            row.querySelector('.Racer-id').title = bad ? 'There’s no ' + K.noun + ' with that number — the default ' + K.noun + ' will race' : '';
            /* get the 2D cut-out ready before the race starts */
            if (K.cutout() && /^https:\/\//.test(src)) K.cutout().prepare(src);
        });
        warnBad();
    }

    /* ============================================================
       Setup list
       ============================================================ */

    function addRacer(name, id) {
        if (racers.length >= MAX_RACERS) return null;
        const r = { uid: ++uid, name: name || '', id: id === null || id === undefined ? '' : String(id) };
        racers.push(r);
        return r;
    }

    function rowFor(r) {
        const li = document.createElement('li');
        li.className = 'Racer';
        li.dataset.uid = r.uid;

        const pic = document.createElement('span');
        pic.className = 'Racer-pic';

        const name = document.createElement('input');
        name.type = 'text';
        name.maxLength = 24;
        name.placeholder = 'Name';
        name.value = r.name;
        name.setAttribute('aria-label', 'Racer name');
        name.spellcheck = false;
        name.addEventListener('input', function () {
            r.name = name.value;
            save();
            updateCode();
            /* a racer with just a name gets its picture from the name: show the new one */
            clearTimeout(name._t);
            name._t = setTimeout(function () { refreshPics(); fetchImages(); }, 450);
        });

        const id = document.createElement('input');
        id.type = 'text';
        id.inputMode = 'numeric';
        id.maxLength = K.idLength;
        id.placeholder = K.tag;
        id.className = 'Racer-id';
        id.value = r.id;
        id.setAttribute('aria-label', K.Noun + ' number (optional)');
        id.addEventListener('input', function () {
            id.value = id.value.replace(/[^0-9]/g, '');
            r.id = id.value;
            save();
            updateCode();
            clearTimeout(id._t);
            id._t = setTimeout(function () { refreshPics(); fetchImages(); }, 450);
        });

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'Racer-del';
        del.setAttribute('aria-label', 'Remove racer');
        del.title = 'Remove';
        del.textContent = '×';
        del.addEventListener('click', function () {
            racers = racers.filter(function (x) { return x !== r; });
            render();
        });

        li.append(pic, name, id, del);
        return li;
    }

    function render() {
        els.list.replaceChildren.apply(els.list, racers.map(rowFor));
        els.empty.hidden = racers.length > 0;
        els.count.textContent = racers.length + ' / ' + MAX_RACERS;
        els.addRacer.disabled = racers.length >= MAX_RACERS;
        els.addRandom.disabled = racers.length >= MAX_RACERS;
        els.shuffle.disabled = racers.length < 2;
        els.clear.disabled = !racers.length;
        els.start.disabled = racers.length < MIN_RACERS;
        refreshPics();
        updateCode();
        save();
        fetchImages();
    }

    function updateCode() {
        els.code.textContent = code;
        els.fingerprint.textContent = 'racers #' + (racers.length ? Sim.fingerprint(finalRacers()) : '------');
    }

    els.addRacer.addEventListener('click', function () {
        const r = addRacer('', '');
        render();
        if (r) {
            const row = els.list.querySelector('[data-uid="' + r.uid + '"] input');
            if (row) row.focus();
        }
    });

    els.addRandom.addEventListener('click', async function () {
        /* only real ones: wait for the list if it's still on its way */
        if (!catalog && API) {
            els.addRandom.disabled = true;
            say('Getting the list of ' + K.nouns + '…');
            await ensureCatalog(15000);
            if (!els.status.dataset.bad) say('');
            els.addRandom.disabled = racers.length >= MAX_RACERS;
        }
        const max = supply || FALLBACK_SUPPLY;
        const taken = new Set(racers.map(idOf).filter(function (x) { return x !== null; }));
        setupPictures().forEach(function (x) { if (x !== null) taken.add(x); });     /* not anyone's picture either */
        let added = 0;
        for (let tries = 0; added < 5 && racers.length < MAX_RACERS && tries < 200; tries++) {
            /* only numbers that exist, once the server has said which */
            const id = catalog && catalog.length ? catalog[randomInt(catalog.length)] : 1 + randomInt(max);
            if (taken.has(id)) continue;
            taken.add(id);
            addRacer(K.tag + id, id);
            added++;
        }
        render();
    });

    els.shuffle.addEventListener('click', function () {
        for (let i = racers.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            const t = racers[i]; racers[i] = racers[j]; racers[j] = t;
        }
        render();
        say('Lanes shuffled. (Lane order never changes who wins.)', 'ok');
    });

    /* ---------- Paste a list: one racer per line ---------- */

    /* "deez", "Champ #1234", "Doc, 777", "1. @someone (#42)", "#5000".
       A number counts as the racer's only after a #, a comma, a tab,
       a | or a ( — so a name like "Racer2" stays a name. */
    function parseList(text) {
        const out = [];
        String(text || '').split(/\r?\n/).forEach(function (raw) {
            let line = raw.trim()
                .replace(/^(?:\d{1,3}[.)]\s+|[-*•·]\s+)/, '')     /* "1. ", "2) ", "- ", "• " */
                .replace(/^@+/, '');                             /* a Discord mention: just the name */
            if (!line) return;
            let id = '';
            const m = /^(.*?)\s*(?:#|[,;|\t(]\s*#?)\s*(\d{1,6})\s*\)?\s*$/.exec(line);
            if (m) { line = m[1].replace(/[\s,;|(-]+$/, '').trim(); id = m[2]; }
            const name = Sim.cleanName(line).slice(0, 24);
            if (!name && !id) return;
            out.push({ name: name || (K.tag + id), id: id.slice(0, K.idLength) });
        });
        return out;
    }

    function openPaste(open) {
        if (!els.pastePanel) return;
        els.pastePanel.hidden = !open;
        els.paste.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) els.pasteText.focus();
    }

    function usePaste(replace) {
        const got = parseList(els.pasteText.value);
        if (!got.length) { say('Paste some names first — one racer per line.', 'warn'); els.pasteText.focus(); return; }
        if (replace) racers = [];
        const room = MAX_RACERS - racers.length;
        got.slice(0, room).forEach(function (r) { addRacer(r.name, r.id); });
        const left = got.length - Math.max(0, room);
        els.pasteText.value = '';
        openPaste(false);
        render();
        say(left > 0
            ? 'Added ' + Math.max(0, room) + ' — only ' + MAX_RACERS + ' racers fit, so the last ' + left + ' line' + (left === 1 ? ' was' : 's were') + ' left out.'
            : 'Added ' + got.length + ' racer' + (got.length === 1 ? '' : 's') + '.', left > 0 ? 'warn' : 'ok');
    }

    if (els.paste && els.pastePanel) {
        els.paste.addEventListener('click', function () { openPaste(els.pastePanel.hidden); });
        els.pasteAdd.addEventListener('click', function () { usePaste(false); });
        els.pasteReplace.addEventListener('click', function () {
            if (racers.length > 3 && !window.confirm('Replace all ' + racers.length + ' racers with the pasted list?')) return;
            usePaste(true);
        });
        els.pasteCancel.addEventListener('click', function () { openPaste(false); });
    }

    els.clear.addEventListener('click', function () {
        if (racers.length > 3 && !window.confirm('Remove all ' + racers.length + ' racers?')) return;
        racers = [];
        render();
        say('');
    });

    els.newCode.addEventListener('click', function () { code = newCode(); updateCode(); });

    document.querySelectorAll('input[name="length"]').forEach(function (r) { r.addEventListener('change', save); });

    els.replayForm.addEventListener('submit', function (e) {
        e.preventDefault();
        const c = Sim.cleanCode(els.replayCode.value);
        if (!c) { say('Type the race code you want to replay.', 'warn'); els.replayCode.focus(); return; }
        code = c;
        updateCode();
        startWhenReady();
    });

    /* Racers with just a name get their orca from the list, and every picture
       has to be known before the race draws it: wait a few seconds for both,
       at most, then go. (Nothing here can change who wins.) */
    async function startWhenReady() {
        if (API && (!catalog || setupPictures().some(function (id) { return id !== null && !images.has(id); }))) {
            els.start.disabled = true;
            say('Getting the ' + K.nouns + ' ready…');
            await ensureCatalog(5000);
            fetchImages();
            await waitFor(function () {
                return setupPictures().every(function (id) { return id === null || images.has(id); });
            }, 4000);
            if (!els.status.dataset.bad) say('');
            els.start.disabled = racers.length < MIN_RACERS;
        }
        startRace();
    }

    els.start.addEventListener('click', startWhenReady);

    /* ============================================================
       The race
       ============================================================ */

    const ctx = els.canvas.getContext('2d');
    const cctx = els.confetti.getContext('2d');
    let race = null;            // OrcaRaceSim.run(...) result
    let R = [];                 // per-lane drawing state
    let secPerStep = 0;
    let seconds = 20;
    let phase = 'idle';         // countdown | race | done
    let phaseT = 0;             // seconds into the countdown
    let raceT = 0;              // race clock (seconds)
    let lastFrame = 0;
    let raf = 0;
    let layoutInfo = null;
    let slow = null;            // { from, to } race-clock window played in slow motion
    let lastFinishT = 0;
    let topThreeT = 0;
    let events = [];            // { t, lane, kind } in race-clock seconds
    let nextEvent = 0;
    let lastSplashSound = -1;
    let leaderLane = -1;
    let banner = null;          // { text, until }
    let spray = [];
    let cosmetic = null;        // seeded generator for spray/confetti only
    let lastCount = 4;
    let slowSounded = false;

    function seeded(str) {
        const s = Sim.hash128(str);
        let a = s[0], b = s[1], c = s[2], d = s[3];
        return function () {
            a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
            let t = (a + b) | 0;
            a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
            t = (t + d) | 0; c = (c + t) | 0;
            return (t >>> 0) / 4294967296;
        };
    }

    function fmt(t) {
        if (!(t >= 0)) t = 0;
        const ms = Math.floor(t * 1000 + 1e-6);
        const m = Math.floor(ms / 60000);
        const s = Math.floor(ms / 1000) % 60;
        const r = ms % 1000;
        return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(r).padStart(3, '0');
    }

    function finishTime(lane) { return race.racers[lane].finishSteps * secPerStep; }

    function startRace() {
        const list = finalRacers();
        if (list.length < MIN_RACERS) { say('Add at least two racers first.', 'warn'); return; }
        if (!code) code = newCode();
        try {
            race = Sim.run({ code: code, racers: list });
        } catch (e) {
            say('Couldn’t start: ' + e.message, 'error');
            return;
        }
        seconds = lengthSeconds();
        secPerStep = Sim.timeScale(race, seconds);
        cosmetic = seeded('cosmetic|' + race.code + '|' + race.fingerprint);

        /* the finish order, and a close finish worth slowing down for */
        const t1 = finishTime(race.order[0]);
        const t2 = finishTime(race.order[1]);
        slow = (t2 - t1) < seconds * 0.006 ? { from: t1 - 0.9, to: t2 + 0.25 } : null;
        lastFinishT = finishTime(race.order[race.order.length - 1]);
        topThreeT = finishTime(race.order[Math.min(2, race.order.length - 1)]);

        /* sound and banner cues, all in race-clock time */
        events = [];
        race.racers.forEach(function (r, lane) {
            r.bursts.forEach(function (b) { events.push({ t: b * secPerStep, lane: lane, kind: 'burst' }); });
            events.push({ t: finishTime(lane), lane: lane, kind: 'finish' });
        });
        events.sort(function (a, b) { return a.t - b.t || a.lane - b.lane; });
        nextEvent = 0;

        const pics = pictureIds(race.racers.map(function (r, lane) {
            return { id: r.orcaId, key: r.name.toLowerCase() || 'racer ' + (lane + 1) };
        }));
        R = race.racers.map(function (r, lane) {
            return {
                name: r.name,
                id: r.orcaId,
                pic: pics[lane],         // the orca we draw (their own, or one picked for them)
                phase: lane * 1.7,
                img: null,
                sprite: null,
                cut: null,               // the 2D cut-out, once it's ready
                place: 0
            };
        });
        R.forEach(loadPortrait);

        els.setup.hidden = true;
        els.stage.hidden = false;
        els.results.hidden = true;
        els.hudCode.textContent = race.code;
        els.leader.textContent = '—';
        els.clock.textContent = fmt(0);
        spray = [];
        banner = null;
        leaderLane = -1;
        lastSplashSound = -1;
        lastCount = 4;
        slowSounded = false;
        raceT = 0;
        phaseT = 0;
        phase = 'countdown';
        cctx.clearRect(0, 0, els.confetti.width, els.confetti.height);
        confetti = [];
        layout();
        els.stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
        announce('Race code ' + race.code + '. ' + race.racers.length + ' racers. Countdown!');
        lastFrame = 0;
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
    }

    /* each racer's orca picture, with the default orca if it won't load */
    function loadPortrait(r) {
        const want = imageFor(r.pic);
        const img = new Image();
        img.decoding = 'async';
        if (/^https:\/\//.test(want)) img.crossOrigin = 'anonymous';
        img.onload = function () { r.img = img; r.sprite = null; };
        function useCut(c) { if (c) { r.cut = c; r.halo = null; r.edge = null; } }
        /* the racer without its background, if it cuts cleanly; the card until then */
        if (K.cutout() && /^https:\/\//.test(want)) K.cutout().prepare(want).then(useCut);
        else if (want === DEFAULT_IMG) defaultCutout().then(useCut);
        img.onerror = function () {
            if (img.src.indexOf(DEFAULT_IMG) < 0 && want !== DEFAULT_IMG) {
                img.src = DEFAULT_IMG;
                if (!r.cut) defaultCutout().then(useCut);
                return;
            }
            r.img = null;          // even the default failed: a plain circle it is
        };
        img.src = want;
    }

    /* the default orca, already cut out (images/orca-default-cut.webp, made
       from images/orca.avif the same way), so nobody races as a square card */
    let defaultCut = null;
    function defaultCutout() {
        if (!defaultCut) {
            defaultCut = new Promise(function (done) {
                const i = new Image();
                i.onload = function () {
                    const c = document.createElement('canvas');
                    c.width = i.naturalWidth;
                    c.height = i.naturalHeight;
                    c.getContext('2d').drawImage(i, 0, 0);
                    done(c);
                };
                i.onerror = function () { done(null); };
                i.src = DEFAULT_CUT;
            });
        }
        return defaultCut;
    }

    /* each racer's NFT art, cut to a rounded card once (cheap to draw every frame) */
    function sprite(r, d) {
        if (!r.img) return null;
        const px = Math.max(8, Math.round(d * layoutInfo.dpr));
        if (r.sprite && r.sprite.width === px) return r.sprite;
        const c = document.createElement('canvas');
        c.width = c.height = px;
        const g = c.getContext('2d');
        try {
            rr(g, 0, 0, px, px, px * 0.2);
            g.clip();
            const iw = r.img.naturalWidth || px, ih = r.img.naturalHeight || px;
            const s = Math.max(px / iw, px / ih);
            g.drawImage(r.img, (px - iw * s) / 2, (px - ih * s) / 2, iw * s, ih * s);
        } catch (e) { return null; }
        r.sprite = c;
        return c;
    }

    function layout() {
        const n = race ? race.racers.length : 6;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const W = els.pool.clientWidth;
        const fs = isFullscreen();
        let laneH;
        if (fs) {
            const avail = Math.max(120, els.pool.clientHeight);
            laneH = avail / n;
        } else {
            const avail = n > 12 ? Math.min(window.innerHeight * 0.82, 900) : Math.min(window.innerHeight * 0.68, 620);
            laneH = Math.max(16, Math.min(86, avail / n));
        }
        const H = Math.round(laneH * n);
        els.canvas.style.height = H + 'px';
        els.canvas.width = Math.round(W * dpr);
        els.canvas.height = Math.round(H * dpr);
        els.confetti.width = Math.round(W * dpr);
        els.confetti.height = Math.round(H * dpr);
        const startX = Math.max(26, W * 0.045);
        const finishX = W - Math.max(26, W * 0.06);
        const bodyLen = Math.max(14, Math.min(laneH * (laneH < 34 ? 1.12 : 0.88), W * 0.13, 110));   // card size; crowded lanes overlap a little
        layoutInfo = { W: W, H: H, laneH: H / n, n: n, dpr: dpr, startX: startX, finishX: finishX, bodyLen: bodyLen };
        R.forEach(function (r) { r.sprite = null; });
    }

    window.addEventListener('resize', function () { if (race && !els.stage.hidden) layout(); });

    /* ---------- the clock: how fast race time runs right now ---------- */

    function rateAt(t) {
        if (slow && t >= slow.from && t <= slow.to) return 0.28;
        if (t > topThreeT + 1.2) return 3;          // the rest of the pack, fast-forwarded
        return 1;
    }

    function frame(now) {
        raf = requestAnimationFrame(frame);
        const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 0;
        lastFrame = now;
        const wall = now / 1000;

        if (phase === 'countdown') {
            phaseT += dt;
            const left = Math.ceil(3 - phaseT);
            if (left !== lastCount && left >= 1 && left <= 3) { lastCount = left; Sound.play('beep'); }
            if (phaseT >= 3 && lastCount !== 0) { lastCount = 0; Sound.play('horn'); }
            if (phaseT >= COUNTDOWN) { phase = 'race'; }
        } else if (phase === 'race') {
            const r = rateAt(raceT);
            raceT += dt * r;
            if (slow && !slowSounded && raceT >= slow.from) {
                slowSounded = true;
                Sound.play('whoosh');
                banner = { text: 'PHOTO FINISH!', until: slow.to + 0.6 };
            }
            runEvents();
            if (raceT >= lastFinishT + 0.6) {
                raceT = lastFinishT + 0.6;
                phase = 'done';
                finish();
            }
        }

        const shown = phase === 'countdown' ? 0 : Math.min(raceT, lastFinishT);
        els.clock.textContent = fmt(shown);
        draw(wall, phase === 'countdown' ? 0 : raceT);
        drawConfetti(dt);
        if (phase === 'done' && !confetti.length) { cancelAnimationFrame(raf); raf = 0; }
    }

    function runEvents() {
        while (nextEvent < events.length && events[nextEvent].t <= raceT) {
            const e = events[nextEvent++];
            if (e.kind === 'burst') {
                if (raceT - lastSplashSound > 0.18 && raceT - e.t < 0.3) { Sound.play('splash', 0, 0.7); lastSplashSound = raceT; }
                splashAt(e.lane, 10);
            } else if (e.kind === 'finish') {
                const place = race.order.indexOf(e.lane) + 1;
                R[e.lane].place = place;
                splashAt(e.lane, 16);
                if (place <= 3) Sound.play('finish');
                if (place === 1) {
                    Sound.play('cheer', 0.15);
                    banner = { text: R[e.lane].name + ' WINS!', until: raceT + 99 };
                    els.leader.textContent = '🏆 ' + R[e.lane].name;
                    announce(R[e.lane].name + ' wins!');
                    startConfetti(70);
                }
            }
        }
    }

    function stepAt(t) { return t / secPerStep; }

    /* ---------- drawing ---------- */

    const LANE_A = '#3a87a9';
    const LANE_B = '#327b9c';

    function draw(wall, t) {
        if (!layoutInfo) return;
        const L = layoutInfo;
        const g = ctx;
        g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
        const s = stepAt(t);

        /* water and lanes */
        for (let i = 0; i < L.n; i++) {
            const y = i * L.laneH;
            g.fillStyle = i % 2 ? LANE_B : LANE_A;
            g.fillRect(0, y, L.W, L.laneH + 1);
        }
        /* moving wave lines */
        g.strokeStyle = 'rgba(255,255,255,0.16)';
        g.lineWidth = Math.max(1, L.laneH * 0.05);
        const amp = L.laneH * 0.07;
        const shift = (wall * 40) % 60;
        for (let i = 0; i < L.n; i++) {
            const y0 = i * L.laneH;
            for (let k = 1; k <= (L.laneH > 34 ? 2 : 1); k++) {
                const yy = y0 + L.laneH * (k / (L.laneH > 34 ? 3 : 2));
                g.beginPath();
                for (let x = -60 + shift - (i % 2) * 30; x <= L.W + 20; x += 15) {
                    const yv = yy + Math.sin((x + i * 23) * 0.105 - wall * 2.2) * amp;
                    if (x === -60 + shift - (i % 2) * 30) g.moveTo(x, yv); else g.lineTo(x, yv);
                }
                g.stroke();
            }
        }
        /* lane ropes: little red and white buoys */
        const buoy = Math.max(1.5, Math.min(3.5, L.laneH * 0.06));
        for (let i = 1; i < L.n; i++) {
            const y = i * L.laneH;
            g.fillStyle = 'rgba(29,27,32,0.35)';
            g.fillRect(0, y - 0.5, L.W, 1);
            for (let x = 6, k = 0; x < L.W; x += buoy * 5, k++) {
                g.fillStyle = k % 2 ? '#fffaf1' : '#d9503a';
                g.beginPath(); g.arc(x, y, buoy, 0, Math.PI * 2); g.fill();
            }
        }
        /* start line and the checkered finish */
        g.fillStyle = 'rgba(255,250,241,0.75)';
        g.fillRect(L.startX - 1.5, 0, 3, L.H);
        const sq = Math.max(4, Math.min(9, L.laneH / 4));
        for (let y = 0, r = 0; y < L.H; y += sq, r++) {
            for (let c = 0; c < 2; c++) {
                g.fillStyle = (r + c) % 2 ? '#1d1b20' : '#fffaf1';
                g.fillRect(L.finishX + c * sq, y, sq, sq);
            }
        }
        /* lane numbers */
        if (L.laneH >= 20) {
            g.font = '900 ' + Math.round(Math.min(13, L.laneH * 0.36)) + 'px Nunito, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            for (let i = 0; i < L.n; i++) {
                g.fillStyle = 'rgba(255,250,241,0.55)';
                g.fillText(String(i + 1), L.startX / 2, i * L.laneH + L.laneH / 2);
            }
        }

        /* the orcas: back lanes first so names don't hide under neighbours */
        let lead = -1, leadPos = -1;
        for (let i = 0; i < L.n; i++) {
            const p = Sim.posAt(race.racers[i], s);
            if (p > leadPos) { leadPos = p; lead = i; }
        }
        for (let i = 0; i < L.n; i++) drawOrca(i, s, wall, i === lead && phase !== 'countdown');

        /* spray */
        drawSpray(g, wall);

        /* lead changes, while nobody has finished */
        if (phase === 'race' && leadPos < 1 && lead !== leaderLane) {
            if (leaderLane !== -1 && t > 1.5 && (!banner || banner.until < t)) banner = { text: 'LEAD CHANGE!', until: t + 1.1 };
            leaderLane = lead;
            els.leader.textContent = R[lead].name;
        }

        /* countdown and banners */
        if (phase === 'countdown') {
            const left = 3 - phaseT;
            const txt = left > 0 ? String(Math.ceil(left)) : 'GO!';
            const frac = left > 0 ? left - Math.floor(left) : (COUNTDOWN - phaseT) / (COUNTDOWN - 3);
            bigText(g, txt, L.W / 2, L.H / 2, Math.min(L.H * 0.55, L.W * 0.22) * (0.75 + 0.35 * frac), left > 0 ? '#ffcd5e' : '#83c7b3');
            smallText(g, 'Race code ' + race.code + '  ·  racers #' + race.fingerprint, L.W / 2, Math.min(L.H - 14, L.H / 2 + Math.min(L.H * 0.3, 80)));
        } else if (banner && t <= banner.until) {
            bigText(g, banner.text, L.W / 2, Math.min(L.H * 0.5, Math.max(30, L.H * 0.18)), Math.min(L.W * 0.075, 54, Math.max(20, L.H * 0.16)), '#ffcd5e');
        }
    }

    /* a rounded rectangle path (roundRect isn't in every phone browser yet) */
    function rr(g, x, y, w, h, rad) {
        const q = Math.min(rad, w / 2, h / 2);
        g.beginPath();
        g.moveTo(x + q, y);
        g.arcTo(x + w, y, x + w, y + h, q);
        g.arcTo(x + w, y + h, x, y + h, q);
        g.arcTo(x, y + h, x, y, q);
        g.arcTo(x, y, x + w, y, q);
        g.closePath();
    }

    /* Each racer IS its orca: the NFT art on a comic sticker card, inked
       like the collection, bobbing and rocking through the water. */
    function drawOrca(i, s, wall, leading) {
        const L = layoutInfo;
        const g = ctx;
        const r = R[i];
        const pos = Sim.posAt(race.racers[i], s);
        const c = L.bodyLen;                                   // the card's size
        const nose = L.startX + c + pos * (L.finishX - L.startX - c);  // the card's front edge
        const moving = phase === 'race' && pos < 1.04;
        const bursting = phase === 'race' && Sim.burstingAt(race.racers[i], s) && pos < 1;
        const bob = Math.sin(wall * 4.2 + r.phase) * L.laneH * 0.06;
        /* a cut-out keeps its own shape: a bit taller than the card, as wide as its ride */
        let w = c, h = c;
        if (r.cut) {
            h = c * (L.laneH >= 40 ? 1.3 : 1.12);              /* roomy lanes: they can ride big */
            w = h * r.cut.width / r.cut.height;
            if (w > c * 2) { w = c * 2; h = w * r.cut.height / r.cut.width; }
        }
        const cx = nose - w / 2;
        const cy = i * L.laneH + L.laneH / 2 + bob;
        const tilt = Math.sin(wall * 3.1 + r.phase) * (moving ? 0.07 : 0.03) - (bursting ? 0.1 : 0);
        const ink = Math.max(1.5, c * 0.045);
        const back = nose - w;

        /* the wake: foam puffs trailing behind, longer on a burst */
        if (moving) {
            const puffs = bursting ? 6 : 3;
            g.fillStyle = 'rgba(255,255,255,0.55)';
            for (let k = 0; k < puffs; k++) {
                const f = ((wall * (bursting ? 2.6 : 1.4) + k / puffs + r.phase) % 1);
                const px = back + c * 0.1 - f * c * (bursting ? 1.1 : 0.6);
                const py = cy + c * 0.32 + Math.sin(k * 2.1 + wall * 5) * c * 0.06;
                const pr = Math.max(1, c * 0.11 * (1 - f));
                g.beginPath(); g.arc(px, py, pr, 0, Math.PI * 2); g.fill();
            }
        }
        /* speed lines on a burst */
        if (bursting) {
            g.strokeStyle = 'rgba(255,255,255,0.75)';
            g.lineWidth = Math.max(1, c * 0.04);
            for (let k = -1; k <= 1; k++) {
                const x0 = back - c * 0.1 - (wall * 300 + k * 37) % (c * 0.5);
                g.beginPath();
                g.moveTo(x0, cy + k * c * 0.25);
                g.lineTo(x0 - c * 0.5, cy + k * c * 0.25);
                g.stroke();
            }
        }

        /* the name, trailing behind */
        if (L.laneH >= 16) {
            const fs = Math.round(Math.max(9, Math.min(14, L.laneH * 0.32)));
            g.font = '900 ' + fs + 'px Nunito, sans-serif';
            g.textAlign = 'right';
            g.textBaseline = 'middle';
            const label = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
            const lx = back - c * (bursting ? 0.65 : 0.12);
            if (lx > 30) {
                g.lineWidth = 3;
                g.lineJoin = 'round';
                g.strokeStyle = 'rgba(29,27,32,0.8)';
                g.strokeText(label, lx, cy);
                g.fillStyle = '#fffaf1';
                g.fillText(label, lx, cy);
            }
        }

        if (r.cut) {
            drawCut(g, r, cx, cy, w, h, tilt, wall, leading);
        } else {
        /* the card itself, rocking on the swell */
        const rad = c * 0.2;
        g.save();
        g.translate(cx, cy);
        g.rotate(tilt);
        /* hard ink shadow, like every sticker on the site */
        g.fillStyle = '#1d1b20';
        rr(g, -c / 2 + c * 0.07, -c / 2 + c * 0.07, c, c, rad);
        g.fill();
        if (leading) {
            g.fillStyle = '#f4b740';
            rr(g, -c / 2 - ink * 1.6, -c / 2 - ink * 1.6, c + ink * 3.2, c + ink * 3.2, rad + ink * 1.6);
            g.fill();
        }
        const sp = sprite(r, c);
        if (sp) {
            g.drawImage(sp, -c / 2, -c / 2, c, c);
        } else {
            g.fillStyle = '#a1c0d6';
            rr(g, -c / 2, -c / 2, c, c, rad);
            g.fill();
        }
        /* water lapping at the bottom of the card */
        g.save();
        rr(g, -c / 2, -c / 2, c, c, rad);
        g.clip();
        const wl = c * 0.3 + Math.sin(wall * 5 + r.phase) * c * 0.03;
        g.fillStyle = 'rgba(58,135,169,0.55)';
        g.beginPath();
        g.moveTo(-c / 2, wl);
        for (let x = -c / 2; x <= c / 2 + 1; x += Math.max(2, c / 8)) {
            g.lineTo(x, wl + Math.sin(x * 0.25 + wall * 6 + r.phase) * c * 0.025);
        }
        g.lineTo(c / 2, c / 2);
        g.lineTo(-c / 2, c / 2);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1, c * 0.03);
        g.stroke();
        g.restore();
        /* the ink outline */
        g.lineWidth = ink;
        g.strokeStyle = '#1d1b20';
        g.lineJoin = 'round';
        rr(g, -c / 2, -c / 2, c, c, rad);
        g.stroke();
        g.restore();
        }

        /* place badge once finished */
        if (r.place) {
            const bd = Math.max(12, Math.min(26, c * 0.38));
            const bx = nose, by = cy - h / 2 + bd * 0.15;
            g.fillStyle = r.place === 1 ? '#f4b740' : r.place === 2 ? '#bec4c3' : r.place === 3 ? '#ba976a' : '#fffaf1';
            g.beginPath(); g.arc(bx, by, bd / 2, 0, Math.PI * 2); g.fill();
            g.lineWidth = 1.5; g.strokeStyle = '#1d1b20'; g.stroke();
            g.fillStyle = '#1d1b20';
            g.font = '900 ' + Math.round(bd * 0.58) + 'px Nunito, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(String(r.place), bx, by + 0.5);
        }
    }

    /* ---------- the 2D cut-out orca, riding in the water ---------- */

    const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]];

    /* the sprite's shape in one flat colour, for its ink edge and the leader's glow */
    function silhouette(sp, color) {
        const c = document.createElement('canvas');
        c.width = sp.width;
        c.height = sp.height;
        const g = c.getContext('2d');
        g.drawImage(sp, 0, 0);
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = color;
        g.fillRect(0, 0, c.width, c.height);
        return c;
    }

    /* the water's surface across the sprite; above or below it */
    function surface(g, x0, x1, wl, h, wall, phase, above) {
        const step = Math.max(2, (x1 - x0) / 12);
        g.beginPath();
        g.moveTo(x0, wl + Math.sin(x0 * 0.25 + wall * 6 + phase) * h * 0.025);
        for (let x = x0 + step; x < x1 + step; x += step) g.lineTo(x, wl + Math.sin(x * 0.25 + wall * 6 + phase) * h * 0.025);
        g.lineTo(x1 + step, above ? -h : h);
        g.lineTo(x0, above ? -h : h);
        g.closePath();
    }

    function drawCut(g, r, cx, cy, w, h, tilt, wall, leading) {
        const sp = r.cut;
        if (!r.edge) r.edge = silhouette(sp, '#1d1b20');
        if (leading && !r.halo) r.halo = silhouette(sp, '#f4b740');
        const ow = Math.max(1, Math.min(2.4, h * 0.028));            /* ink edge */
        const gw = Math.max(2, h * 0.065);                            /* the leader's glow */
        const wl = h * 0.27 + Math.sin(wall * 5 + r.phase) * h * 0.025;   /* waterline */
        const x0 = -w / 2 - gw - 2, x1 = w / 2 + gw + 2;
        g.save();
        g.translate(cx, cy);
        g.rotate(tilt);
        /* its shadow in the water */
        g.fillStyle = 'rgba(16, 52, 72, 0.28)';
        g.beginPath();
        g.ellipse(0, wl + h * 0.04, w * 0.46, h * 0.09, 0, 0, Math.PI * 2);
        g.fill();
        /* below the surface: faded, seen through the water */
        g.save();
        surface(g, x0, x1, wl, h, wall, r.phase, false);
        g.clip();
        g.globalAlpha = 0.35;
        g.drawImage(sp, -w / 2, -h / 2, w, h);
        g.restore();
        /* above it: the glow, the ink edge, the orca */
        g.save();
        surface(g, x0, x1, wl, h, wall, r.phase, true);
        g.clip();
        if (leading) AROUND.forEach(function (d) { g.drawImage(r.halo, -w / 2 + d[0] * gw, -h / 2 + d[1] * gw, w, h); });
        AROUND.forEach(function (d) { g.drawImage(r.edge, -w / 2 + d[0] * ow, -h / 2 + d[1] * ow, w, h); });
        g.drawImage(sp, -w / 2, -h / 2, w, h);
        g.restore();
        /* foam where it meets the water */
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1, h * 0.035);
        g.lineCap = 'round';
        g.beginPath();
        for (let x = -w * 0.44, k = 0; x <= w * 0.44; x += Math.max(2, w / 14), k++) {
            const y = wl + Math.sin(x * 0.25 + wall * 6 + r.phase) * h * 0.025;
            if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
        g.restore();
    }

    function bigText(g, text, x, y, size, fill) {
        g.font = Math.round(size) + "px 'Lilita One', 'Arial Rounded MT Bold', sans-serif";
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = Math.max(3, size * 0.12);
        g.strokeStyle = '#1d1b20';
        g.fillStyle = '#1d1b20';
        g.fillText(text, x + size * 0.06, y + size * 0.06);
        g.strokeText(text, x, y);
        g.fillStyle = fill;
        g.fillText(text, x, y);
    }

    function smallText(g, text, x, y) {
        g.font = '900 13px Nunito, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineWidth = 3;
        g.strokeStyle = 'rgba(29,27,32,0.85)';
        g.strokeText(text, x, y);
        g.fillStyle = '#fffaf1';
        g.fillText(text, x, y);
    }

    /* ---------- splashes (cosmetic, seeded) ---------- */

    function splashAt(lane, count) {
        if (!layoutInfo || !cosmetic) return;
        const L = layoutInfo;
        const pos = Sim.posAt(race.racers[lane], stepAt(raceT));
        const x = L.startX + pos * (L.finishX - L.startX - L.bodyLen);
        const y = lane * L.laneH + L.laneH / 2;
        for (let k = 0; k < count && spray.length < 400; k++) {
            spray.push({
                x: x, y: y,
                vx: -(30 + cosmetic() * 90),
                vy: -(40 + cosmetic() * 120) * Math.min(1, L.laneH / 40),
                life: 0.5 + cosmetic() * 0.4,
                age: 0,
                r: Math.max(1, L.laneH * (0.04 + cosmetic() * 0.05))
            });
        }
    }

    let lastSprayWall = 0;
    function drawSpray(g, wall) {
        const dt = lastSprayWall ? Math.min(0.1, wall - lastSprayWall) : 0;
        lastSprayWall = wall;
        g.fillStyle = 'rgba(255,255,255,0.85)';
        for (let i = spray.length - 1; i >= 0; i--) {
            const p = spray[i];
            p.age += dt;
            if (p.age >= p.life) { spray.splice(i, 1); continue; }
            p.vy += 380 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            g.globalAlpha = 1 - p.age / p.life;
            g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
    }

    /* ---------- confetti (cosmetic, seeded) ---------- */

    let confetti = [];
    const CONFETTI_COLORS = ['#f4b740', '#83c7b3', '#e0887a', '#ab9abf', '#add4db', '#fffaf1', '#e28537'];

    function startConfetti(n) {
        if (!layoutInfo || !cosmetic) return;
        const L = layoutInfo;
        for (let i = 0; i < n; i++) {
            confetti.push({
                x: cosmetic() * L.W,
                y: -10 - cosmetic() * L.H * 0.5,
                vx: (cosmetic() - 0.5) * 60,
                vy: 60 + cosmetic() * 120,
                rot: cosmetic() * 6.28,
                vr: (cosmetic() - 0.5) * 10,
                w: 5 + cosmetic() * 6,
                h: 3 + cosmetic() * 4,
                c: CONFETTI_COLORS[Math.floor(cosmetic() * CONFETTI_COLORS.length)],
                age: 0
            });
        }
        if (!raf) { lastFrame = 0; raf = requestAnimationFrame(frame); }
    }

    function drawConfetti(dt) {
        if (!layoutInfo) return;
        const L = layoutInfo;
        cctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
        cctx.clearRect(0, 0, L.W, L.H + 400);
        if (!confetti.length) return;
        const H = els.confetti.clientHeight || L.H;
        for (let i = confetti.length - 1; i >= 0; i--) {
            const p = confetti[i];
            p.age += dt;
            p.x += (p.vx + Math.sin(p.age * 3 + p.rot) * 30) * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            if (p.y > H + 20 || p.age > 8) { confetti.splice(i, 1); continue; }
            cctx.save();
            cctx.translate(p.x, p.y);
            cctx.rotate(p.rot);
            cctx.fillStyle = p.c;
            cctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.age * 5 + p.rot)) + 0.5);
            cctx.restore();
        }
    }

    /* ============================================================
       Results
       ============================================================ */

    function finish() {
        Sound.play('cheer');
        startConfetti(160);
        els.podium.replaceChildren();
        const medals = ['🥇', '🥈', '🥉'];
        [1, 0, 2].forEach(function (k) {
            const lane = race.order[k];
            if (lane === undefined) return;
            const r = race.racers[lane];
            const li = document.createElement('li');
            li.className = 'is-' + (k + 1);
            const pic = document.createElement('span');
            pic.className = 'Podium-pic';
            pic.appendChild(safeImg(imageFor(R[lane] ? R[lane].pic : r.orcaId), 112));
            const name = document.createElement('span');
            name.className = 'Podium-name';
            name.textContent = medals[k] + ' ' + r.name;
            name.title = r.name + (r.orcaId !== null ? ' (' + K.tag + r.orcaId + ')' : '');
            const time = document.createElement('span');
            time.className = 'Podium-time';
            time.textContent = fmt(finishTime(lane));
            const step = document.createElement('span');
            step.className = 'Podium-step';
            step.textContent = String(k + 1);
            li.append(pic, name, time, step);
            els.podium.appendChild(li);
        });
        els.order.replaceChildren.apply(els.order, race.order.map(function (lane) {
            const r = race.racers[lane];
            const li = document.createElement('li');
            li.textContent = r.name + (r.orcaId !== null && r.name !== K.tag + r.orcaId ? ' (#' + r.orcaId + ')' : '');
            const t = document.createElement('span');
            t.textContent = fmt(finishTime(lane));
            li.appendChild(t);
            return li;
        }));
        els.resultsMeta.innerHTML = '';
        els.resultsMeta.append(
            'Race code ', codeEl(race.code), ' · racers ', codeEl('#' + race.fingerprint),
            ' · ' + seconds + 's · ' + race.leadChanges + ' lead change' + (race.leadChanges === 1 ? '' : 's')
        );
        els.copyStatus.textContent = '';
        els.results.hidden = false;
        announce('Results: ' + race.order.slice(0, 3).map(function (l, i) { return (i + 1) + '. ' + race.racers[l].name; }).join(', '));
    }

    function codeEl(t) { const c = document.createElement('code'); c.textContent = t; return c; }

    function resultsText() {
        const d = new Date();
        const date = d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
        const medals = ['🥇', '🥈', '🥉'];
        /* Names are pasted into Discord as they are, so take the teeth out:
           "@everyone" mustn't ping the server, and *, _, ~, ` and friends
           in a name mustn't turn the message into formatting. */
        const safe = function (s) { return String(s).replace(/[\\*_~`|>[\]]/g, '\\$&').replace(/@/g, '@\u200b').replace(/<(?=[@#:at])/g, '<\u200b'); };
        const who = function (r) { return safe(r.name) + (r.orcaId !== null && r.name !== K.tag + r.orcaId ? ' (' + K.tag + r.orcaId + ')' : ''); };
        const lines = [
            K.title,
            'Race code: `' + race.code + '` · racers `#' + race.fingerprint + '` · ' + race.racers.length + ' racers · ' + seconds + 's race',
            'Date: ' + date,
            ''
        ];
        race.order.slice(0, 3).forEach(function (lane, i) {
            lines.push(medals[i] + ' **' + who(race.racers[lane]) + '** — ' + fmt(finishTime(lane)));
        });
        lines.push('', '**Full order**');
        race.order.forEach(function (lane, i) {
            lines.push((i + 1) + '. ' + who(race.racers[lane]) + ' — ' + fmt(finishTime(lane)));
        });
        lines.push('', 'Replay it: same code + same racers at ' + pageUrl());
        return lines.join('\n');
    }

    function pageUrl() {
        const u = window.location.href.split('#')[0].split('?')[0];
        return u.replace(/\/index\.html$/, '/');
    }

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
        } catch (e) { /* fall through */ }
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
        return ok;
    }

    els.copy.addEventListener('click', async function () {
        if (!race) return;
        const ok = await copyText(resultsText());
        els.copyStatus.textContent = ok ? 'Copied! Paste it in Discord.' : 'Couldn’t copy — your browser blocked it.';
        els.copyStatus.className = 'Wallet-status ' + (ok ? 'is-ok' : 'is-error');
    });

    els.again.addEventListener('click', function () {
        code = newCode();
        updateCode();
        startRace();
    });

    els.newRace.addEventListener('click', function () {
        stopRace();
        code = newCode();
        els.stage.hidden = true;
        els.setup.hidden = false;
        render();
        els.setup.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    function stopRace() {
        cancelAnimationFrame(raf);
        raf = 0;
        phase = 'idle';
        confetti = [];
        if (isFullscreen()) toggleFullscreen();
    }

    /* ============================================================
       Mute, fullscreen
       ============================================================ */

    function markMute() {
        const m = Sound.isMuted();
        els.mute.textContent = m ? '🔇' : '🔊';
        els.mute.setAttribute('aria-pressed', m ? 'true' : 'false');
        els.mute.setAttribute('aria-label', m ? 'Sound off — unmute' : 'Sound on — mute');
    }
    els.mute.addEventListener('click', function () { Sound.toggle(); markMute(); });
    markMute();

    function nativeFs() { return document.fullscreenElement || document.webkitFullscreenElement; }
    function isFullscreen() { return !!nativeFs() || els.stage.classList.contains('is-fs'); }

    function toggleFullscreen() {
        if (isFullscreen()) {
            if (nativeFs()) {
                (document.exitFullscreen || document.webkitExitFullscreen).call(document);
            } else {
                els.stage.classList.remove('is-fs');
                document.documentElement.classList.remove('or-lock');
                afterFs();
            }
            return;
        }
        const req = els.stage.requestFullscreen || els.stage.webkitRequestFullscreen;
        if (req) {
            try {
                const p = req.call(els.stage);
                if (p && p.catch) p.catch(pseudoFs);
                return;
            } catch (e) { /* fall back below */ }
        }
        pseudoFs();
    }

    /* phones without element fullscreen (iPhone): fill the window instead */
    function pseudoFs() {
        els.stage.classList.add('is-fs');
        document.documentElement.classList.add('or-lock');
        afterFs();
    }

    function afterFs() {
        els.fullscreen.setAttribute('aria-label', isFullscreen() ? 'Exit fullscreen' : 'Fullscreen');
        if (race && !els.stage.hidden) requestAnimationFrame(function () { layout(); if (!raf) draw(performance.now() / 1000, raceT); });
    }

    els.fullscreen.addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', afterFs);
    document.addEventListener('webkitfullscreenchange', afterFs);
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && els.stage.classList.contains('is-fs')) toggleFullscreen();
    });

    function announce(text) { els.announce.textContent = text; }

    /* ============================================================
       Start-up: saved racers, or a shared link (#code=...&r=...)
       ============================================================ */

    function loadSaved() {
        try {
            const s = JSON.parse(window.localStorage.getItem(STORE));
            if (s && Array.isArray(s.racers)) {
                s.racers.slice(0, MAX_RACERS).forEach(function (r) { addRacer(String(r.name || '').slice(0, 24), String(r.id || '').replace(/[^0-9]/g, '').slice(0, K.idLength)); });
            }
            if (s && s.length) setLength(s.length);
        } catch (e) { /* fresh start */ }
    }

    function loadHash() {
        const h = new URLSearchParams(window.location.hash.slice(1));
        const list = h.get('r');
        if (!list) return false;
        racers = [];
        list.split('|').slice(0, MAX_RACERS).forEach(function (part) {
            const bits = part.split('~');
            addRacer(Sim.cleanName(bits[0]), (bits[1] || '').replace(/[^0-9]/g, '').slice(0, K.idLength));
        });
        const c = Sim.cleanCode(h.get('code'));
        if (c) code = c;
        const len = Number(h.get('len'));
        if (len) setLength(len);
        return true;
    }

    code = newCode();
    if (!loadHash()) loadSaved();
    render();
    fetchSupply();
})();
