/* ============================================================
   OrcaCutout — a Security Orca without its background, for the race.

       OrcaCutout.prepare(url).then(function (canvas) { ... })

   gives a canvas of just the orca and its ride (transparent around
   it, facing right, the way the race swims), or null if this
   picture can't be cut cleanly, in which case the page keeps the
   square card.

   How: every Security Orca sits on one of six painted scenes (the
   collection's Background trait), and a scene is the same picture
   under every orca that has it. images/orca-scenes/ holds those six
   scenes, rebuilt from hundreds of orcas (each vehicle type voted on
   what's behind it). Their alpha says where the scene is known; the
   middle, where some ride always sits, is left unknown.

     1. pick the scene this orca is on (the best match where known)
     2. where the scene is known: matches it -> background
     3. the unknown middle: flood in from the background, only
        through smooth colour, never across the art's ink lines
     4. only background that reaches the picture's edge counts, so
        holes inside the ride stay solid
     5. keep the big pieces, drop specks, soften the edge a pixel

   Nothing here decides the race; it's only how the racers look.
   OpenSea's image server allows this (Access-Control-Allow-Origin: *).
   ============================================================ */

(function () {
    'use strict';

    const N = 500;                           /* orca pictures are 500 x 500 */
    const SCENES = ['gold-volcano', 'citadel', 'coral', 'crystal-cove', 'boulders', 'underwater-plains'];
    const SCENE_URL = 'images/orca-scenes/';
    const MATCH = 42;                        /* summed RGB difference that still counts as the scene */
    const SMOOTH = 28;                       /* step allowed while flooding the unknown middle */
    const INK = 80;                          /* darker than this (every channel) is line art */
    const MAX_ERR = 12;                      /* scene must match this well (median) or we don't cut */
    const OUT = 256;                         /* longest side of the finished sprite */

    let scenes = null;                       /* Promise of [{ data, sample }] */
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

    function loadScenes() {
        if (!scenes) {
            scenes = Promise.all(SCENES.map(function (name) {
                return loadImage(SCENE_URL + name + '.webp').then(function (img) {
                    const data = pixels(img);
                    const sample = [];
                    for (let p = 0; p < N * N; p += 97) if (data[p * 4 + 3] === 255) sample.push(p);
                    return { data: data, sample: sample };
                });
            })).catch(function () { scenes = null; return null; });
        }
        return scenes;
    }

    function pickScene(img, list) {
        let best = null, bestErr = 1e9;
        list.forEach(function (sc) {
            const d = sc.sample.map(function (p) {
                const i = p * 4;
                return Math.abs(img[i] - sc.data[i]) + Math.abs(img[i + 1] - sc.data[i + 1]) + Math.abs(img[i + 2] - sc.data[i + 2]);
            }).sort(function (a, b) { return a - b; });
            const e = d[d.length >> 1];
            if (e < bestErr) { bestErr = e; best = sc; }
        });
        return bestErr <= MAX_ERR ? best : null;
    }

    /* the cut itself: an alpha mask (0..255) for the picture */
    function mask(img, plate) {
        const UNK = 0, BG = 1, FG = 2;
        const lab = new Uint8Array(N * N);
        for (let p = 0; p < N * N; p++) {
            const i = p * 4;
            if (plate[i + 3] === 255) {
                const d = Math.abs(img[i] - plate[i]) + Math.abs(img[i + 1] - plate[i + 1]) + Math.abs(img[i + 2] - plate[i + 2]);
                lab[p] = d < MATCH ? BG : FG;
            }
        }
        const stack = new Int32Array(N * N);
        let top = 0;
        function nbrs(p, fn) {
            const x = p % N;
            if (x > 0) fn(p - 1);
            if (x < N - 1) fn(p + 1);
            if (p >= N) fn(p - N);
            if (p < N * N - N) fn(p + N);
        }
        /* flood the unknown middle from the background, smoothly, never across ink */
        for (let p = 0; p < N * N; p++) if (lab[p] === BG) stack[top++] = p;
        while (top) {
            const p = stack[--top];
            const j = p * 4;
            nbrs(p, function (n) {
                if (lab[n] !== UNK) return;
                const i = n * 4;
                if (Math.max(img[i], img[i + 1], img[i + 2]) < INK) return;
                if (Math.abs(img[i] - img[j]) + Math.abs(img[i + 1] - img[j + 1]) + Math.abs(img[i + 2] - img[j + 2]) > SMOOTH) return;
                lab[n] = BG;
                stack[top++] = n;
            });
        }
        for (let p = 0; p < N * N; p++) if (lab[p] === UNK) lab[p] = FG;
        /* background only counts if it reaches the edge of the picture */
        const outside = new Uint8Array(N * N);
        for (let k = 0; k < N; k++) {
            [k, (N - 1) * N + k, k * N, k * N + N - 1].forEach(function (p) {
                if (lab[p] === BG && !outside[p]) { outside[p] = 1; stack[top++] = p; }
            });
        }
        while (top) {
            const p = stack[--top];
            nbrs(p, function (n) { if (lab[n] === BG && !outside[n]) { outside[n] = 1; stack[top++] = n; } });
        }
        for (let p = 0; p < N * N; p++) if (lab[p] === BG && !outside[p]) lab[p] = FG;
        /* pieces of foreground: keep the big ones, drop specks */
        const comp = new Int32Array(N * N).fill(-1);
        const sizes = [];
        for (let s = 0; s < N * N; s++) {
            if (lab[s] !== FG || comp[s] >= 0) continue;
            const c = sizes.length;
            let n = 0;
            comp[s] = c;
            stack[top++] = s;
            while (top) {
                const p = stack[--top];
                n++;
                nbrs(p, function (m) { if (lab[m] === FG && comp[m] < 0) { comp[m] = c; stack[top++] = m; } });
            }
            sizes.push(n);
        }
        if (!sizes.length) return null;
        const biggest = Math.max.apply(null, sizes);
        const keep = Math.max(150, biggest * 0.04);
        const hard = new Uint8Array(N * N);
        let kept = 0;
        for (let p = 0; p < N * N; p++) if (lab[p] === FG && sizes[comp[p]] >= keep) { hard[p] = 1; kept++; }
        if (kept < N * N * 0.06 || kept > N * N * 0.75) return null;   /* that doesn't look like a clean cut */
        /* a one-pixel soft edge */
        const alpha = new Uint8Array(N * N);
        for (let y = 0; y < N; y++) {
            for (let x = 0; x < N; x++) {
                let s = 0, n = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const xx = x + dx, yy = y + dy;
                        if (xx >= 0 && yy >= 0 && xx < N && yy < N) { s += hard[yy * N + xx]; n++; }
                    }
                }
                const p = y * N + x;
                alpha[p] = Math.round(255 * (hard[p] ? s / n : s / n * 0.5));
            }
        }
        return alpha;
    }

    /* the finished sprite: trimmed, turned to face right, at most OUT px */
    function sprite(img, alpha) {
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
            out.data[i] = img[i]; out.data[i + 1] = img[i + 1]; out.data[i + 2] = img[i + 2]; out.data[i + 3] = alpha[p];
        }
        fg.putImageData(out, 0, 0);
        const w = x1 - x0 + 1, h = y1 - y0 + 1;
        const k = Math.min(1, OUT / Math.max(w, h));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k));
        c.height = Math.max(1, Math.round(h * k));
        const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high';
        g.translate(c.width, 0);
        g.scale(-1, 1);                                      /* the art faces left; the race swims right */
        g.drawImage(full, x0, y0, w, h, 0, 0, c.width, c.height);
        return c;
    }

    async function make(url) {
        const list = await loadScenes();
        if (!list) return null;
        const img = await loadImage(url);
        await pause();
        const px = pixels(img);
        const scene = pickScene(px, list);
        if (!scene) return null;
        await pause();
        const alpha = mask(px, scene.data);
        if (!alpha) return null;
        await pause();
        return sprite(px, alpha);
    }

    /* one cut at a time, so a 30-orca race never stalls the page */
    function prepare(url) {
        if (!url || !/^https:\/\//.test(url)) return Promise.resolve(null);
        if (!cache.has(url)) {
            const job = queue.then(function () { return make(url); }).catch(function () { return null; });
            queue = job.then(pause);
            cache.set(url, job);
        }
        return cache.get(url);
    }

    window.OrcaCutout = { prepare: prepare, SCENES: SCENES };
})();
