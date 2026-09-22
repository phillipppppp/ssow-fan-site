/* ============================================================
   Member ID card — renders a whale as a membership card.

   Two ways in:
     - type a token number (works for anyone, no wallet needed)
     - connect a wallet and pick from the whales it actually holds

   The contract implements ERC721Enumerable, so holdings are read
   straight from chain via balanceOf + tokenOfOwnerByIndex through
   the wallet's own provider. No RPC key, no indexer.
   ============================================================ */

(function () {
    'use strict';

    const CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';

    /* function selectors */
    const SEL_BALANCE_OF = '0x70a08231';       /* balanceOf(address)                  */
    const SEL_TOKEN_OF_OWNER = '0x2f745c59';   /* tokenOfOwnerByIndex(address,uint256) */
    const SEL_OWNER_OF = '0x6352211e';         /* ownerOf(uint256)                    */

    /* Public endpoints that allow browser requests (verified ACAO: *).
       Tried in order so one being down isn't fatal. */
    const RPCS = [
        'https://ethereum-rpc.publicnode.com',
        'https://eth.drpc.org',
        'https://rpc.ankr.com/eth',
        'https://eth.merkle.io'
    ];

    const W = 1000;
    const H = 630;
    const MAX_LISTED = 24;                 /* cap the holdings fetch */

    /* Kept in step with the --accent* tokens in idcard.css. */
    const COLORS = {
        abyss: '#0a1628',
        deep: '#1a2744',
        midnight: '#0f1f3a',
        accent: '#4ce0c4',
        accentBright: '#7ef4dc',
        text: '#e8e8e8',
        muted: '#a8a8a8',
        faint: '#7d8895'
    };

    /* Card finishes. Going light is not just a background swap — the
       ink, the engraving, the gradient that fades the art out and the
       "embossing" shadow under the number all have to invert too, or
       the card turns into dark text on a dark scrim. */
    const THEMES = {
        navy: {
            bg: ['#0a1628', '#1a2744', '#0f1f3a'],
            ink: '#e8e8e8', faint: '#7d8895', sub: 'rgba(168, 168, 168, 0.75)',
            accent: '#4ce0c4',
            engrave: 'rgba(76, 224, 196, 0.05)',
            scrim: '15, 31, 58',
            foot: '10, 22, 40',
            edge: 'rgba(76, 224, 196, 0.30)',
            ring: 'rgba(76, 224, 196, 0.45)',
            wave: 'rgba(232, 232, 232, 0.5)',
            sheenRgb: '255, 255, 255', sheen: 0.09,
            emboss: 'rgba(0, 0, 0, 0.55)'
        },
        ice: {
            bg: ['#eaf6fd', '#c3e2f4', '#a3cde8'],
            ink: '#0d2437', faint: '#5c7d94', sub: 'rgba(13, 36, 55, 0.6)',
            accent: '#0b6e91',
            engrave: 'rgba(13, 36, 55, 0.06)',
            scrim: '205, 228, 242',
            foot: '190, 218, 236',
            edge: 'rgba(11, 110, 145, 0.35)',
            ring: 'rgba(11, 110, 145, 0.4)',
            wave: 'rgba(13, 36, 55, 0.45)',
            sheenRgb: '150, 175, 200', sheen: 0.16,
            emboss: 'rgba(255, 255, 255, 0.85)'
        },
        black: {
            bg: ['#0b0b0c', '#18181b', '#0a0a0b'],
            ink: '#f4f4f5', faint: '#8b8b92', sub: 'rgba(244, 244, 245, 0.6)',
            accent: '#dcdcdc',
            engrave: 'rgba(255, 255, 255, 0.045)',
            scrim: '11, 11, 12',
            foot: '8, 8, 9',
            edge: 'rgba(220, 220, 220, 0.25)',
            ring: 'rgba(220, 220, 220, 0.4)',
            wave: 'rgba(244, 244, 245, 0.5)',
            sheenRgb: '255, 255, 255', sheen: 0.10,
            emboss: 'rgba(0, 0, 0, 0.7)'
        },
        white: {
            bg: ['#ffffff', '#f4f6f9', '#e9edf2'],
            ink: '#14181d', faint: '#6b7280', sub: 'rgba(20, 24, 29, 0.6)',
            accent: '#0e8f7a',
            engrave: 'rgba(20, 24, 29, 0.05)',
            scrim: '246, 248, 251',
            foot: '233, 237, 242',
            edge: 'rgba(20, 24, 29, 0.18)',
            ring: 'rgba(14, 143, 122, 0.4)',
            wave: 'rgba(20, 24, 29, 0.42)',
            sheenRgb: '140, 155, 175', sheen: 0.14,
            emboss: 'rgba(255, 255, 255, 0.9)'
        }
    };

    function T() { return THEMES[state.theme] || THEMES.navy; }

    const FONT_DISPLAY = "'Syne', 'Trebuchet MS', sans-serif";
    const FONT_MONO = "'JetBrains Mono', ui-monospace, monospace";

    const $ = function (id) { return document.getElementById(id); };

    const canvas = $('cardCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const els = {
        whaleId: $('whaleId'),
        loadWhale: $('loadWhale'),
        whaleStatus: $('whaleStatus'),
        walletAddress: $('walletAddress'),
        checkWallet: $('checkWallet'),
        walletStatus: $('walletStatus'),
        holdings: $('holdings'),
        memberName: $('memberName'),
        memberSince: $('memberSince'),
        showTraits: $('showTraits'),
        showAddress: $('showAddress'),
        download: $('downloadCard'),
        reset: $('resetCard'),
        stageEmpty: $('stageEmpty')
    };

    const state = {
        whale: null,
        image: null,
        logo: null,
        address: '',        /* the pasted wallet, lowercase */
        owned: false,       /* does that wallet hold the loaded whale? */
        theme: 'navy'
    };

    /* Remember the finish between visits — a per-viewer convenience, so
       localStorage is the right home for it. It can throw outright in a
       private window, hence the guards. */
    try {
        const saved = window.localStorage.getItem('ssow-card-theme');
        if (saved && THEMES[saved]) state.theme = saved;
    } catch (err) { /* storage unavailable; the default stands */ }

    /* ---------------------------------------------------------
       Small helpers
       --------------------------------------------------------- */

    function setStatus(el, message, kind) {
        if (!el) return;
        el.textContent = message || '';
        el.className = 'Field-status' + (kind ? ' is-' + kind : '');
    }

    function shortAddress(addr) {
        if (!addr) return '';
        return addr.slice(0, 6) + '…' + addr.slice(-4);
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    /* letterSpacing isn't in every engine yet — guard it. */
    function withTracking(px, fn) {
        const supported = 'letterSpacing' in ctx;
        if (supported) ctx.letterSpacing = px + 'px';
        fn();
        if (supported) ctx.letterSpacing = '0px';
    }

    function loadImage(src, useCors) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            if (useCors) img.crossOrigin = 'anonymous';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('image failed to load')); };
            img.src = src;
        });
    }

    /* ---------------------------------------------------------
       Drawing the card

       Laid out like a real payment card, because that is the
       visual grammar people already read: chip on the left,
       contactless mark beside it, a long grouped number across
       the middle, and a cardholder row along the bottom.
       --------------------------------------------------------- */

    /* 0x88091012... -> "8809 1012 0000 3955": the first eight digits
       come from the real contract address, the last eight are the
       zero-padded token. Groups of four do the rest of the work. */
    function cardNumber(id) {
        const prefix = CONTRACT.replace(/^0x/, '').replace(/\D/g, '').slice(0, 8).padEnd(8, '0');
        const token = String(id).padStart(8, '0');
        return (prefix + token).replace(/(.{4})/g, '$1 ').trim();
    }

    function drawBase() {
        const grad = ctx.createLinearGradient(0, 0, W, H);
        grad.addColorStop(0, T().bg[0]);
        grad.addColorStop(0.55, T().bg[1]);
        grad.addColorStop(1, T().bg[2]);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);

        /* guilloche - the faint engraved swirl on a real card */
        ctx.save();
        ctx.strokeStyle = T().engrave;
        ctx.lineWidth = 1;
        for (let i = 0; i < 22; i++) {
            ctx.beginPath();
            ctx.ellipse(W * 0.3 + i * 14, H * 0.55, 150 + i * 12, 90 + i * 7, i * 0.12, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    /* The whale bleeds off the right edge and fades towards the middle,
       leaving the left two thirds clear for the card data. */
    function drawArt() {
        const img = state.image;
        const bandX = 600;
        const bandW = W - bandX;

        ctx.save();
        ctx.beginPath();
        ctx.rect(bandX, 0, bandW, H);
        ctx.clip();

        const scale = Math.max(bandW / img.width, H / img.height) * 1.12;
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(img, bandX + (bandW - w) / 2, (H - h) / 2, w, h);
        ctx.globalAlpha = 1;

        const fade = ctx.createLinearGradient(bandX, 0, bandX + 300, 0);
        fade.addColorStop(0, 'rgba(' + T().scrim + ', 1)');
        fade.addColorStop(1, 'rgba(' + T().scrim + ', 0)');
        ctx.fillStyle = fade;
        ctx.fillRect(bandX, 0, bandW, H);
        ctx.restore();

        /* seat the bottom row so it stays readable over the art */
        const foot = ctx.createLinearGradient(0, H - 190, 0, H);
        foot.addColorStop(0, 'rgba(' + T().foot + ', 0)');
        foot.addColorStop(1, 'rgba(' + T().foot + ', 0.88)');
        ctx.fillStyle = foot;
        ctx.fillRect(0, H - 190, W, 190);
    }

    /* the diagonal light streak every glossy card has */
    function drawSheen() {
        const sheen = ctx.createLinearGradient(0, H, W * 0.7, 0);
        sheen.addColorStop(0.00, 'rgba(' + T().sheenRgb + ', 0)');
        sheen.addColorStop(0.46, 'rgba(' + T().sheenRgb + ', ' + (T().sheen * 0.45) + ')');
        sheen.addColorStop(0.52, 'rgba(' + T().sheenRgb + ', ' + T().sheen + ')');
        sheen.addColorStop(0.58, 'rgba(' + T().sheenRgb + ', ' + (T().sheen * 0.22) + ')');
        sheen.addColorStop(1.00, 'rgba(' + T().sheenRgb + ', 0)');
        ctx.fillStyle = sheen;
        ctx.fillRect(0, 0, W, H);
    }

    /* EMV chip. Deliberately the one warm element on the card - the
       gold contact pad is most of what makes a rectangle read as a
       bank card at a glance. */
    function drawChip(x, y, w, h) {
        const g = ctx.createLinearGradient(x, y, x + w, y + h);
        g.addColorStop(0.00, '#f0e3bb');
        g.addColorStop(0.35, '#cbb478');
        g.addColorStop(0.65, '#e2d2a2');
        g.addColorStop(1.00, '#93804c');
        ctx.fillStyle = g;
        roundRect(x, y, w, h, 9);
        ctx.fill();

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.28)';
        ctx.lineWidth = 1.6;
        roundRect(x, y, w, h, 9);
        ctx.stroke();

        const cx = x + w / 2;
        const cy = y + h / 2;
        const iw = w * 0.40;
        const ih = h * 0.42;

        roundRect(cx - iw / 2, cy - ih / 2, iw, ih, 4);
        ctx.stroke();

        ctx.beginPath();
        [-ih / 2 - h * 0.16, -ih / 2 + 2, ih / 2 - 2, ih / 2 + h * 0.16].forEach(function (dy) {
            ctx.moveTo(x + 3, cy + dy);
            ctx.lineTo(cx - iw / 2, cy + dy);
            ctx.moveTo(cx + iw / 2, cy + dy);
            ctx.lineTo(x + w - 3, cy + dy);
        });
        ctx.moveTo(cx, y + 3);
        ctx.lineTo(cx, cy - ih / 2);
        ctx.moveTo(cx, cy + ih / 2);
        ctx.lineTo(cx, y + h - 3);
        ctx.stroke();
    }

    function drawContactless(cx, cy, size) {
        ctx.save();
        ctx.strokeStyle = T().wave;
        ctx.lineCap = 'round';
        for (let i = 1; i <= 4; i++) {
            ctx.lineWidth = size * 0.075;
            ctx.beginPath();
            ctx.arc(cx, cy, size * 0.17 * i, -Math.PI / 3.4, Math.PI / 3.4);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawBrand() {
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        ctx.fillStyle = T().accent;
        ctx.font = '800 20px ' + FONT_DISPLAY;
        withTracking(2.5, function () {
            ctx.fillText('SECRET SOCIETY OF WHALES', 56, 80);
        });

        ctx.fillStyle = T().faint;
        ctx.font = '400 11px ' + FONT_MONO;
        withTracking(4, function () {
            ctx.fillText('MEMBER CARD', 56, 104);
        });

        if (state.logo) {
            const s = 58;
            const lx = W - 56 - s;
            const ly = 48;
            ctx.save();
            ctx.beginPath();
            ctx.arc(lx + s / 2, ly + s / 2, s / 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.drawImage(state.logo, lx, ly, s, s);
            ctx.restore();

            ctx.strokeStyle = T().ring;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(lx + s / 2, ly + s / 2, s / 2, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    function drawNumber() {
        drawChip(56, 168, 86, 66);
        drawContactless(186, 201, 52);

        ctx.textAlign = 'left';
        ctx.fillStyle = T().faint;
        ctx.font = '400 10px ' + FONT_MONO;
        withTracking(3.5, function () {
            ctx.fillText('MEMBER NUMBER', 56, 306);
        });

        /* a soft drop shadow reads as embossing */
        ctx.save();
        ctx.shadowColor = T().emboss;
        ctx.shadowOffsetY = 2;
        ctx.shadowBlur = 5;
        ctx.fillStyle = T().ink;
        ctx.font = '600 40px ' + FONT_MONO;
        withTracking(3, function () {
            ctx.fillText(cardNumber(state.whale.id), 56, 356);
        });
        ctx.restore();
    }

    /* One quiet line, the way small print sits on a real card.

       Ordered by how much each trait says about the whale rather than
       by the order the metadata happens to list them — Background and
       Skin are both colour names and often collide ("LIGHT BLUE .
       LIGHT BLUE"), so they go last and duplicates are dropped. */
    const TRAIT_PRIORITY = ['Hat', 'Outfit', 'Mouth', 'Eyes', 'Fin',
                            'Blowhole Ring', 'Skin', 'Background'];

    function drawTraitLine() {
        if (!els.showTraits.checked) return;

        const all = state.whale.traits || [];
        const seen = {};
        const picked = [];

        TRAIT_PRIORITY.forEach(function (type) {
            if (picked.length >= 4) return;
            const hit = all.find(function (t) { return t.trait_type === type; });
            if (!hit) return;
            const value = String(hit.value).toUpperCase();
            if (seen[value]) return;
            seen[value] = true;
            picked.push(value);
        });

        if (!picked.length) return;
        const line = picked.join('  ·  ');

        ctx.textAlign = 'left';
        ctx.fillStyle = T().sub;
        ctx.font = '400 12px ' + FONT_MONO;
        /* four long trait values plus separators is ~60 characters, so
           the tracking stays tight to keep it clear of the art band */
        withTracking(0.5, function () { ctx.fillText(fitText(line, 545), 56, 404); });
    }

    /* The bottom cells sit at fixed columns, and both the name and the
       "member since" field accept 24 characters — enough to run straight
       into the next column. Clip rather than collide. */
    function fitText(text, maxWidth) {
        if (ctx.measureText(text).width <= maxWidth) return text;
        let t = text;
        while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
            t = t.slice(0, -1);
        }
        return t + '…';
    }

    function drawCell(label, value, x, y, maxWidth) {
        ctx.textAlign = 'left';
        ctx.fillStyle = T().faint;
        ctx.font = '400 9.5px ' + FONT_MONO;
        withTracking(3, function () { ctx.fillText(label, x, y); });

        ctx.fillStyle = T().ink;
        ctx.font = '600 19px ' + FONT_MONO;
        withTracking(1.5, function () { ctx.fillText(fitText(value, maxWidth), x, y + 26); });
    }

    function drawHolderRow() {
        const labelY = H - 82;

        const name = els.memberName.value.trim();
        drawCell('CARDHOLDER', (name || 'WHALE HOLDER').toUpperCase(), 56, labelY, 278);

        const since = els.memberSince.value.trim();
        if (since) drawCell('MEMBER SINCE', since.toUpperCase(), 360, labelY, 228);

        /* Only print the address once ownership is actually verified -
           an unverified address on the card would imply something false. */
        const showAddr = els.showAddress.checked && state.address && state.owned;
        if (showAddr) drawCell('HOLDER', shortAddress(state.address), 610, labelY, 330);

        ctx.textAlign = 'right';
        ctx.fillStyle = T().accent;
        ctx.font = '400 10px ' + FONT_MONO;
        withTracking(2, function () {
            ctx.fillText('#TOGETHERWEWHALE', W - 56, H - 34);
        });
        ctx.textAlign = 'left';
    }

    function render() {
        ctx.clearRect(0, 0, W, H);
        if (!state.whale || !state.image) return;

        /* Clip to a rounded card so the exported PNG has real card
           corners rather than a square with an outline drawn on it. */
        ctx.save();
        roundRect(0, 0, W, H, 44);
        ctx.clip();

        drawBase();
        drawArt();
        drawSheen();
        drawBrand();
        drawNumber();
        drawTraitLine();
        drawHolderRow();

        ctx.restore();

        /* hairline edge, last so it sits above everything */
        ctx.strokeStyle = T().edge;
        ctx.lineWidth = 2;
        roundRect(1, 1, W - 2, H - 2, 44);
        ctx.stroke();
    }
    /* ---------------------------------------------------------
       Loading a whale
       --------------------------------------------------------- */

    async function loadWhale(id) {
        els.loadWhale.disabled = true;
        setStatus(els.whaleStatus, 'loading #' + id + '…');

        try {
            const whale = await window.WhaleSource.load(id);
            const img = await loadImage(whale.image, true);

            state.whale = whale;
            state.image = img;

            els.whaleId.value = id;
            els.stageEmpty.hidden = true;

            render();
            await applyOwnership();     /* decides whether download unlocks */
        } catch (err) {
            setStatus(els.whaleStatus, 'could not load #' + id + ' (' + err.message + ')', 'error');
        } finally {
            els.loadWhale.disabled = false;
        }
    }

    /* ---------------------------------------------------------
       Wallet
       --------------------------------------------------------- */

    function padAddress(addr) {
        return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    }

    function padUint(n) {
        return n.toString(16).padStart(64, '0');
    }

    function isAddress(value) {
        return /^0x[0-9a-fA-F]{40}$/.test((value || '').trim());
    }

    /* Read-only eth_call over plain HTTP — no wallet extension needed. */
    async function ethCall(data) {
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: CONTRACT, data: data }, 'latest']
        });

        let lastError = null;

        for (let i = 0; i < RPCS.length; i++) {
            try {
                const res = await fetch(RPCS[i], {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: payload
                });
                if (!res.ok) { lastError = new Error('rpc ' + res.status); continue; }

                const json = await res.json();
                if (json.error) { lastError = new Error(json.error.message); continue; }
                return json.result;
            } catch (err) {
                lastError = err;
            }
        }

        throw lastError || new Error('every RPC endpoint failed');
    }

    /* Authoritative single-call ownership check. Used to gate the
       download — enumeration only ever shows the first 24, so a whale
       further down the list would otherwise look unowned. */
    async function ownsWhale(address, tokenId) {
        const hex = await ethCall(SEL_OWNER_OF + padUint(tokenId));
        if (!hex || hex === '0x') return false;
        const owner = '0x' + hex.slice(-40);
        return owner.toLowerCase() === address.toLowerCase();
    }

    async function checkWallet() {
        const raw = els.walletAddress.value.trim();

        if (!isAddress(raw)) {
            setStatus(
                els.walletStatus,
                raw ? 'that is not a valid 0x address' : 'paste your wallet address first',
                'error'
            );
            return;
        }

        const address = raw.toLowerCase();
        els.checkWallet.disabled = true;
        setStatus(els.walletStatus, 'reading the chain…');

        try {
            const balanceHex = await ethCall(SEL_BALANCE_OF + padAddress(address));
            const balance = parseInt(balanceHex, 16) || 0;

            state.address = address;

            if (!balance) {
                els.holdings.innerHTML = '';
                setStatus(els.walletStatus, shortAddress(address) + ' holds no OG whales', 'warn');
                await applyOwnership();
                return;
            }

            const count = Math.min(balance, MAX_LISTED);
            const ids = [];
            for (let i = 0; i < count; i++) {
                /* eslint-disable-next-line no-await-in-loop */
                const hex = await ethCall(SEL_TOKEN_OF_OWNER + padAddress(address) + padUint(i));
                ids.push(parseInt(hex, 16));
            }

            renderHoldings(ids);
            setStatus(
                els.walletStatus,
                balance > count
                    ? 'holds ' + balance + ' whales — showing the first ' + count
                    : 'holds ' + balance + (balance === 1 ? ' whale' : ' whales'),
                'ok'
            );

            if (ids.length) loadWhale(ids[0]);
        } catch (err) {
            setStatus(els.walletStatus, 'lookup failed (' + err.message + ')', 'error');
        } finally {
            els.checkWallet.disabled = false;
        }
    }

    /* Download is only unlocked when the pasted wallet actually holds
       the whale currently on the card. */
    async function applyOwnership() {
        if (!state.whale) {
            state.owned = false;
            els.download.disabled = true;
            render();
            return;
        }

        if (!state.address) {
            state.owned = false;
            els.download.disabled = true;
            setStatus(els.whaleStatus, 'paste your wallet above to unlock the download', 'warn');
            render();
            return;
        }

        try {
            state.owned = await ownsWhale(state.address, state.whale.id);
        } catch (err) {
            state.owned = false;
        }

        els.download.disabled = !state.owned;

        setStatus(
            els.whaleStatus,
            state.owned
                ? 'verified — #' + state.whale.id + ' is held by ' + shortAddress(state.address)
                : '#' + state.whale.id + ' is not held by ' + shortAddress(state.address) +
                  ' — preview only',
            state.owned ? 'ok' : 'warn'
        );

        render();
    }

    function renderHoldings(ids) {
        els.holdings.innerHTML = '';
        ids.forEach(function (id) {
            const li = document.createElement('li');
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'Holding';
            btn.textContent = '#' + id;
            btn.addEventListener('click', function () {
                els.holdings.querySelectorAll('.Holding').forEach(function (b) {
                    b.classList.remove('is-active');
                });
                btn.classList.add('is-active');
                loadWhale(id);
            });
            li.appendChild(btn);
            els.holdings.appendChild(li);
        });
        const first = els.holdings.querySelector('.Holding');
        if (first) first.classList.add('is-active');
    }

    /* ---------------------------------------------------------
       Export
       --------------------------------------------------------- */

    function download() {
        if (!state.owned) return;      /* the button is disabled too; belt and braces */
        try {
            const url = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ssow-id-' + (state.whale ? state.whale.id : 'card') + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            /* Almost always a tainted canvas. Opened from disk, the browser
               treats even same-folder images as cross-origin, so drawing one
               poisons the export. Serving the folder over HTTP fixes it. */
            const isFile = window.location.protocol === 'file:';
            setStatus(
                els.whaleStatus,
                isFile
                    ? 'downloads do not work when the page is opened from disk — run a local server (see Stage note)'
                    : 'the browser blocked the export (' + (err.message || 'tainted canvas') + ')',
                'error'
            );
            if (isFile) showFileProtocolHelp();
        }
    }

    /* Spelled out under the card, because the fix is not guessable. */
    function showFileProtocolHelp() {
        const note = document.getElementById('stageNote');
        if (!note) return;
        note.innerHTML =
            'This page is open as a <code>file://</code> path, so the browser refuses to ' +
            'export the canvas. Serve the folder over HTTP instead &mdash; from the project ' +
            'folder run <code>npx serve</code> (or <code>python -m http.server</code>) and ' +
            'open the <code>http://localhost:…</code> address it prints.';
        note.classList.add('is-warning');
    }

    /* ---------------------------------------------------------
       Wiring
       --------------------------------------------------------- */

    els.loadWhale.addEventListener('click', function () {
        const id = parseInt(els.whaleId.value, 10);
        if (!window.WhaleSource.isValidId(id)) {
            setStatus(els.whaleStatus, 'pick a number between 1 and 10000', 'error');
            return;
        }
        loadWhale(id);
    });

    els.whaleId.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') els.loadWhale.click();
    });

    /* ---------------------------------------------------------
       Card finish
       --------------------------------------------------------- */

    function applyTheme(name, persist) {
        if (!THEMES[name]) return;
        state.theme = name;

        document.querySelectorAll('#cardThemes .Swatch').forEach(function (btn) {
            btn.setAttribute('aria-checked', String(btn.dataset.theme === name));
        });

        if (persist) {
            try { window.localStorage.setItem('ssow-card-theme', name); }
            catch (err) { /* private window; the choice just won't stick */ }
        }

        render();
    }

    document.querySelectorAll('#cardThemes .Swatch').forEach(function (btn) {
        btn.addEventListener('click', function () {
            applyTheme(btn.dataset.theme, true);
        });
    });

    applyTheme(state.theme, false);   /* sync the swatches to the saved value */

    els.checkWallet.addEventListener('click', checkWallet);

    els.walletAddress.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') els.checkWallet.click();
    });

    /* Changing the address invalidates any previous verification. */
    els.walletAddress.addEventListener('input', function () {
        state.address = '';
        state.owned = false;
        els.download.disabled = true;
        els.holdings.innerHTML = '';
        render();
    });

    els.download.addEventListener('click', download);

    els.reset.addEventListener('click', function () {
        els.memberName.value = '';
        els.memberSince.value = '';
        els.showTraits.checked = true;
        els.showAddress.checked = true;
        render();
    });

    [els.memberName, els.memberSince, els.showTraits, els.showAddress]
        .forEach(function (el) { el.addEventListener('input', render); });

    /* The logo comes from logo.js as a data: URI rather than from
       images/OG_logo.png. A file:// page treats even its own local images
       as cross-origin, and drawing one taints the canvas so the PNG export
       throws. A data URI never taints.

       To regenerate after changing the art, from the project folder:
         powershell -c "'window.WHALE_LOGO = ''data:image/png;base64,' +
           [Convert]::ToBase64String([IO.File]::ReadAllBytes('images/OG_logo.png')) +
           ''';' | Set-Content logo.js"
    */
    if (window.WHALE_LOGO) {
        loadImage(window.WHALE_LOGO, false)
            .then(function (img) { state.logo = img; render(); })
            .catch(function () { /* card just renders without it */ });
    }

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(render).catch(function () {});
    }

    /* idcard.html?id=3955 — deep-link straight to a whale, so a card
       can be shared as a URL. ?wallet= pre-fills the address too. */
    (function fromUrl() {
        const params = new URLSearchParams(window.location.search);

        const wallet = params.get('wallet');
        if (wallet && isAddress(wallet)) {
            els.walletAddress.value = wallet;
        }

        const id = parseInt(params.get('id'), 10);
        if (window.WhaleSource.isValidId(id)) {
            if (wallet && isAddress(wallet)) {
                checkWallet().then(function () { loadWhale(id); });
            } else {
                loadWhale(id);
            }
        }
    })();
})();
