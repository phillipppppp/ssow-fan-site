/* ============================================================
   WhaleCutout — an OG whale without its background, for the race.

       WhaleCutout.prepare(url).then(function (canvas) { ... })

   gives a canvas of just the whale (transparent around it, facing
   right like the art already does), or null if this picture can't
   be cut cleanly, in which case the page keeps the square card.

   Much simpler than the orcas: every OG whale sits on one flat
   colour (the Background trait), and the art is inked, so

     1. the backdrop is the colour most of the picture's top and
        sides share
     2. flood in from the edges through that colour only; the ink
        outline stops it
     3. small pockets of exactly that colour shut inside the art
        (inside an earring, between an arm and the body) go too
     4. the edge pixels are part ink, part backdrop: unmix them so
        no coloured fringe is left around the whale

   Nothing here decides the race; it's only how the racers look.
   OpenSea's image server allows this (Access-Control-Allow-Origin: *).
   ============================================================ */

(function () {
    'use strict';

    const N = 500;                           /* OG pictures are 500 x 500 */
    const TOL = 36;                          /* summed RGB difference that still counts as backdrop */
    const POCKET_TOL = 10;                   /* a shut-in pocket must match the backdrop this closely */
    const POCKET_MIN = 250;                  /* ... and be bigger than a speck of shading (pixels) */
    const POCKET_MAX = 0.012;                /* ... and smaller than this share of the picture */
    const INK = [29, 27, 32];                /* the art's outline colour, for unmixing the edge */
    const OUT = 256;                         /* longest side of the finished sprite */

    const cache = new Map();                 /* url -> Promise<canvas|null> */
    let queue = Promise.resolve();

    function pause() { return new Promise(function (r) { setTimeout(r, 0); }); }

    function pixels(img) {
        const c = document.createElement('canvas');
        c.width = N;
        c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, N, N);
        return g.getImageData(0, 0, N, N).data;          /* throws if the picture isn't shareable */
    }

    function loadImage(url) {
        return new Promise(function (ok, bad) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.onload = function () { ok(img); };
            img.onerror = bad;
            img.src = url;
        });
    }

    function diff(px, i, c) {
        return Math.abs(px[i] - c[0]) + Math.abs(px[i + 1] - c[1]) + Math.abs(px[i + 2] - c[2]);
    }

    /* The backdrop colour: the one most of the top edge and the upper sides
       share (the bottom edge is usually the whale's body). null when no
       colour clearly wins: not a flat backdrop, so don't cut. */
    function backdrop(px) {
        const counts = new Map();
        const sums = new Map();
        function add(x, y) {
            const i = (y * N + x) * 4;
            const k = (px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | (px[i + 2] >> 3);
            counts.set(k, (counts.get(k) || 0) + 1);
            const s = sums.get(k) || [0, 0, 0];
            s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2];
            sums.set(k, s);
        }
        let total = 0;
        for (let x = 0; x < N; x += 2) { add(x, 0); add(x, 1); total += 2; }
        for (let y = 2; y < N * 0.7; y += 2) { add(0, y); add(1, y); add(N - 1, y); add(N - 2, y); total += 4; }
        let best = -1, n = 0;
        counts.forEach(function (v, k) { if (v > n) { n = v; best = k; } });
        if (n < total * 0.35) return null;
        const s = sums.get(best);
        return [s[0] / n, s[1] / n, s[2] / n];
    }

    /* 0 = backdrop, 255 = whale, in between on the unmixed edge */
    function mask(px, bg) {
        const NN = N * N;
        const gone = new Uint8Array(NN);
        const queueA = new Int32Array(NN);
        let head = 0, tail = 0;
        function seed(p) {
            if (!gone[p] && diff(px, p * 4, bg) <= TOL) { gone[p] = 1; queueA[tail++] = p; }
        }
        for (let x = 0; x < N; x++) { seed(x); seed((N - 1) * N + x); }
        for (let y = 0; y < N; y++) { seed(y * N); seed(y * N + N - 1); }
        while (head < tail) {
            const p = queueA[head++];
            const x = p % N;
            if (x > 0) seed(p - 1);
            if (x < N - 1) seed(p + 1);
            if (p >= N) seed(p - N);
            if (p < NN - N) seed(p + N);
        }

        /* pockets of the exact backdrop colour shut inside the art */
        const seen = new Uint8Array(NN);
        const comp = new Int32Array(NN);
        for (let p0 = 0; p0 < NN; p0++) {
            if (gone[p0] || seen[p0] || diff(px, p0 * 4, bg) > POCKET_TOL) continue;
            let h = 0, t = 0;
            seen[p0] = 1; comp[t++] = p0;
            while (h < t) {
                const p = comp[h++];
                const x = p % N;
                const nb = [x > 0 ? p - 1 : -1, x < N - 1 ? p + 1 : -1, p - N, p + N];
                for (let k = 0; k < 4; k++) {
                    const q = nb[k];
                    if (q < 0 || q >= NN || seen[q] || gone[q] || diff(px, q * 4, bg) > POCKET_TOL) continue;
                    seen[q] = 1; comp[t++] = q;
                }
            }
            if (t >= POCKET_MIN && t <= NN * POCKET_MAX) for (let k = 0; k < t; k++) gone[comp[k]] = 1;
        }

        /* The edge: a pixel next to the backdrop that sits between the
           backdrop colour and the ink is a blend of the two; take the
           backdrop's share out. Anything else there is art: keep it whole.
           (Judged against the flood alone, so one decision never spreads.) */
        const alpha = new Uint8Array(NN);
        const ib = [INK[0] - bg[0], INK[1] - bg[1], INK[2] - bg[2]];
        const ibLen = ib[0] * ib[0] + ib[1] * ib[1] + ib[2] * ib[2] || 1;
        let kept = 0;
        for (let p = 0; p < NN; p++) {
            if (gone[p]) continue;
            const x = p % N;
            const edge = (x > 0 && gone[p - 1]) || (x < N - 1 && gone[p + 1]) || (p >= N && gone[p - N]) || (p < NN - N && gone[p + N]);
            if (!edge) { alpha[p] = 255; kept++; continue; }
            const i = p * 4;
            const d0 = px[i] - bg[0], d1 = px[i + 1] - bg[1], d2 = px[i + 2] - bg[2];
            const t = (d0 * ib[0] + d1 * ib[1] + d2 * ib[2]) / ibLen;
            const r0 = d0 - t * ib[0], r1 = d1 - t * ib[1], r2 = d2 - t * ib[2];
            if (t > 1 || r0 * r0 + r1 * r1 + r2 * r2 > 30 * 30) { alpha[p] = 255; kept++; continue; }
            const a = Math.max(0, t);
            if (a < 0.12) continue;                         /* practically backdrop */
            alpha[p] = Math.round(a * 255);
            for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, Math.round((px[i + c] - (1 - a) * bg[c]) / a)));
            kept++;
        }
        const share = kept / NN;
        if (share < 0.12 || share > 0.92) return null;     /* didn't find a whale-shaped piece */
        return alpha;
    }

    /* the finished sprite: trimmed, at most OUT px */
    function sprite(px, alpha) {
        let x0 = N, y0 = N, x1 = -1, y1 = -1;
        for (let p = 0; p < N * N; p++) {
            if (alpha[p] < 128) continue;
            const x = p % N, y = (p / N) | 0;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
        if (x1 < x0) return null;
        x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2);
        x1 = Math.min(N - 1, x1 + 2); y1 = Math.min(N - 1, y1 + 2);
        const full = document.createElement('canvas');
        full.width = N;
        full.height = N;
        const fg = full.getContext('2d');
        const out = fg.createImageData(N, N);
        for (let p = 0; p < N * N; p++) {
            const i = p * 4;
            out.data[i] = px[i]; out.data[i + 1] = px[i + 1]; out.data[i + 2] = px[i + 2]; out.data[i + 3] = alpha[p];
        }
        fg.putImageData(out, 0, 0);
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const k = Math.min(1, OUT / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k));
        c.height = Math.max(1, Math.round(h * k));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.drawImage(full, x0, y0, w, h, 0, 0, c.width, c.height);
        return c;
    }

    /* cut an already-loaded picture (the page uses prepare; tests use this) */
    function cut(img) {
        const px = pixels(img);
        const bg = backdrop(px);
        if (!bg) return null;
        const alpha = mask(px, bg);
        return alpha ? sprite(px, alpha) : null;
    }

    async function make(url) {
        const img = await loadImage(url);
        await pause();
        return cut(img);
    }

    /* one cut at a time, so a 30-whale race never stalls the page */
    function prepare(url) {
        if (!url || !/^https:\/\//.test(url)) return Promise.resolve(null);
        if (!cache.has(url)) {
            const job = queue.then(function () { return make(url); }).catch(function () { return null; });
            queue = job.then(pause);
            cache.set(url, job);
        }
        return cache.get(url);
    }

    window.WhaleCutout = { prepare: prepare, cut: cut };
})();
