/* ============================================================
   Golden Whale — a catchable easter egg.

   Every so often a gold-skin whale drifts in somewhere on the
   page with its background cut away. Click it and it pops.
   Ignore it and it fades out again.

   HOW THE BACKGROUND IS REMOVED
   The art has flat single-colour backgrounds, so the image is
   drawn to an offscreen canvas, the corner pixel is sampled, and
   every pixel within tolerance of it is made transparent — with
   a soft edge so the cutout is not jagged. Whales on textured
   backgrounds (Wood, Army) never reach here; tools/find-gold.js
   filters them out, because keying those looks ragged.

   This needs getImageData, which needs a CORS-clean image. The
   IPFS gateway sends Access-Control-Allow-Origin: *, so it is.

   No tally is kept yet — catching is its own reward for now.
   ============================================================ */

(function () {
    'use strict';

    const CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';

    /* Cadence. 30s is the brief; it is a single constant so it is
       easy to dial back if sightings start feeling like traffic
       rather than luck. */
    const EVERY_MS = 30000;
    const FIRST_DELAY_MS = 12000;   /* let the page settle before the first one */
    const VISIBLE_MS = 7000;        /* how long it lingers if ignored */
    const KEY_TOLERANCE = 42;       /* colour distance counted as background */

    const whales = window.GOLD_WHALES;
    if (!whales || !whales.length) return;

    const reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let host = null;
    let timer = null;
    let hideTimer = null;
    let lastId = null;

    function mount() {
        host = document.createElement('div');
        host.className = 'Golden';
        host.setAttribute('aria-hidden', 'true');   /* decorative */
        document.body.appendChild(host);
    }

    /* ---------------------------------------------------------
       Cutting the background out
       --------------------------------------------------------- */

    function cutout(img) {
        const size = 320;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

        let data;
        try {
            data = ctx.getImageData(0, 0, size, size);
        } catch (err) {
            return null;      /* tainted canvas — bail rather than show a box */
        }

        const px = data.data;
        const kr = px[0], kg = px[1], kb = px[2];   /* top-left corner = background */

        for (let i = 0; i < px.length; i += 4) {
            const dr = px[i] - kr;
            const dg = px[i + 1] - kg;
            const db = px[i + 2] - kb;
            const dist = Math.sqrt(dr * dr + dg * dg + db * db);

            if (dist < KEY_TOLERANCE) {
                px[i + 3] = 0;
            } else if (dist < KEY_TOLERANCE * 1.6) {
                /* feather the boundary so the silhouette is not stair-stepped */
                px[i + 3] = Math.round(
                    255 * ((dist - KEY_TOLERANCE) / (KEY_TOLERANCE * 0.6))
                );
            }
        }

        ctx.putImageData(data, 0, 0);
        return canvas;
    }

    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.crossOrigin = 'anonymous';       /* required for getImageData */
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('gold whale image failed')); };
            img.src = src;
        });
    }

    /* ---------------------------------------------------------
       Showing one
       --------------------------------------------------------- */

    /* Spawn in the side margins, never across the middle.

       The whale is clickable, so anywhere it lands it also swallows
       clicks — and the first test dropped one straight onto the
       Download button. The centre column is where every page keeps its
       controls, so the outer bands are both safer and a better fit for
       something that is meant to read as background. */
    function randomSpot() {
        const top = 20 + Math.random() * 55;              /* 20% - 75% */
        const onLeft = Math.random() < 0.5;
        const left = onLeft
            ? 1 + Math.random() * 8                        /* 1% - 9%   */
            : 84 + Math.random() * 8;                      /* 84% - 92% */
        return { top: top, left: left };
    }

    function pick() {
        if (whales.length === 1) return whales[0];
        let w;
        do { w = whales[Math.floor(Math.random() * whales.length)]; }
        while (w.id === lastId);
        return w;
    }

    /* Click and it just pops — no card, no links, no decision to make.
       The whole reward is the pop. */
    function pop() {
        if (host.classList.contains('is-popped')) return;
        host.classList.add('is-popped');
        window.clearTimeout(hideTimer);

        const ring = document.createElement('span');
        ring.className = 'Golden-ring';
        host.appendChild(ring);

        window.setTimeout(function () {
            host.classList.remove('is-visible', 'is-popped');
            host.innerHTML = '';
        }, 520);
    }

    function dismiss() {
        host.classList.remove('is-visible', 'is-popped');
        host.setAttribute('aria-hidden', 'true');
        window.clearTimeout(hideTimer);
        window.setTimeout(function () {
            if (!host.classList.contains('is-visible')) host.innerHTML = '';
        }, 600);
    }

    async function appear() {
        if (document.hidden) return;
        if (host.classList.contains('is-visible')) return;

        const whale = pick();
        lastId = whale.id;

        let canvas;
        try {
            const img = await loadImage(whale.image);
            canvas = cutout(img);
        } catch (err) {
            /* Skip this round rather than showing a broken box — but say
               so, because a silent return makes this impossible to debug. */
            console.warn('[golden whale] skipped:', err.message);
            return;
        }
        if (!canvas) {
            console.warn('[golden whale] cutout failed (tainted canvas?)');
            return;
        }

        const spot = randomSpot();
        host.style.top = spot.top + '%';
        host.style.left = spot.left + '%';

        host.innerHTML = '';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'Golden-whale';
        btn.setAttribute('aria-label', 'Catch the golden whale');
        canvas.className = 'Golden-img';
        btn.appendChild(canvas);
        btn.addEventListener('click', pop);
        host.appendChild(btn);

        host.removeAttribute('aria-hidden');
        /* next frame, so the transition has a start state to run from */
        window.requestAnimationFrame(function () {
            host.classList.add('is-visible');
        });

        hideTimer = window.setTimeout(function () {
            if (!host.classList.contains('is-popped')) dismiss();
        }, VISIBLE_MS);
    }

    function start() {
        window.clearInterval(timer);
        timer = window.setInterval(appear, EVERY_MS);
    }

    mount();

    /* ?golden — summon one immediately instead of waiting out the timer.
       Handy for demoing it without standing there for 30 seconds. */
    const forced = /(^|[?&])golden(=|&|$)/.test(window.location.search);

    if (!reduced) {
        if (forced) {
            appear();
            start();
        } else {
            window.setTimeout(function () { appear(); start(); }, FIRST_DELAY_MS);
        }
    }

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            window.clearInterval(timer);
        } else if (!reduced) {
            start();
        }
    });
})();
