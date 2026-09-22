/* ============================================================
   Whale Spotlight — rotates through random whales with a crossfade.

   ---- HOW TO POINT THIS AT YOUR OWN IMAGES --------------------
   Drop files into images/whales/ and list them in LOCAL_WHALES:

       const LOCAL_WHALES = [
           { id: 3955, src: 'images/whales/3955.png' },
           { id: 6707, src: 'images/whales/6707.png' }
       ];

   As soon as that array has entries it is used instead of the
   remote CDN, and you can set USE_REMOTE_FALLBACK to false.
   -------------------------------------------------------------

   The remote fallback reads Etherscan's NFT image bucket. It is
   NOT a real API: some token ids 404, it intermittently 503s, and
   it sends no CORS header. That is survivable here because an
   <img> tag doesn't need CORS — but it means these images cannot
   be drawn into a <canvas> and exported. The ID and meme
   generators will need local files or a CORS-enabled host.
   ============================================================ */

(function () {
    'use strict';

    const CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';

    const LOCAL_WHALES = [
        /* { id: 3955, src: 'images/whales/3955.png' }, */
    ];

    const USE_REMOTE_FALLBACK = true;
    const SUPPLY = 10000;

    /* The art lives on public IPFS gateways: ~5s for the metadata, ~6s
       for a 1-2 MB original. Nothing here can make that fast, so the
       strategy is to hide it — the next whale is fetched during the
       current one's turn on screen, and a swap only happens once it is
       decoded and ready. The timer is a floor, not a deadline. */
    const ROTATE_MS = 7000;
    const FADE_MS = 600;
    const MAX_TRIES = 8;      /* ids whose gateways all fail get skipped */

    const root = document.querySelector('[data-spotlight]');
    if (!root) return;

    const img = root.querySelector('.Spotlight-img');
    const label = root.querySelector('.Spotlight-id');
    const link = root.querySelector('.Spotlight-link');
    if (!img) return;

    const useLocal = LOCAL_WHALES.length > 0;
    let timer = null;
    let paused = false;
    let lastId = null;

    const reduced = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function randomLocal() {
        const pick = LOCAL_WHALES[Math.floor(Math.random() * LOCAL_WHALES.length)];
        return Promise.resolve({ id: pick.id, src: pick.src });
    }

    /* Resolve the token's real image through IPFS (see whale.js) rather
       than guessing a CDN path — every id in 1..10000 works. */
    async function randomRemote() {
        const id = Math.floor(Math.random() * SUPPLY) + 1;
        const whale = await window.WhaleSource.load(id);
        return { id: whale.id, src: whale.image };
    }

    /* Resolves once the image is downloaded AND decoded, so handing it to
       the <img> is instant and the crossfade never stalls mid-way. */
    function readyWhale(triesLeft) {
        return findWhale(triesLeft).then(function (candidate) {
            return window.WhaleSource
                .loadImage({ id: candidate.id, image: candidate.src })
                .then(function () { return candidate; });
        });
    }

    /* Resolve to a whale whose image actually loads, so the crossfade
       never reveals a broken image. */
    async function findWhale(triesLeft) {
        let candidate;
        try {
            candidate = useLocal ? await randomLocal() : await randomRemote();
        } catch (err) {
            if (triesLeft <= 1) throw new Error('no whale image available');
            return findWhale(triesLeft - 1);
        }

        if (candidate.id === lastId && triesLeft > 1) {
            return findWhale(triesLeft - 1);
        }

        return new Promise(function (resolve, reject) {
            const probe = new Image();
            probe.onload = function () { resolve(candidate); };
            probe.onerror = function () {
                if (triesLeft <= 1) {
                    reject(new Error('no whale image available'));
                } else {
                    resolve(findWhale(triesLeft - 1));
                }
            };
            probe.src = candidate.src;
        });
    }

    function show(whale) {
        lastId = whale.id;

        img.classList.remove('is-visible');

        window.setTimeout(function () {
            img.src = whale.src;
            img.alt = 'Secret Society of Whales #' + whale.id;
            img.classList.add('is-visible');

            if (label) label.textContent = '#' + whale.id;
            if (link) {
                link.href = 'https://opensea.io/item/ethereum/' + CONTRACT + '/' + whale.id;
            }
            root.classList.remove('is-empty');
        }, reduced ? 0 : FADE_MS);
    }

    /* There is always one whale in flight, fetched while the previous one
       is still on screen. That is what hides the ~11s round trip. */
    let pending = null;

    function queueNext() {
        pending = readyWhale(useLocal ? 3 : MAX_TRIES).catch(function () { return null; });
        return pending;
    }

    /* Swap only when the queued whale is decoded and ready. If it is still
       downloading, leave the current one up and try again next tick —
       fading out to an empty frame is worse than holding a little longer. */
    function next() {
        if (!pending) queueNext();

        const inFlight = pending;
        inFlight.then(function (whale) {
            if (inFlight !== pending) return;       /* superseded */
            if (!whale) {
                root.classList.add('is-empty');
                queueNext();
                return;
            }
            show(whale);
            queueNext();                            /* start the next one now */
        });
    }

    /* Rotation runs for everyone. Under prefers-reduced-motion the swap
       still happens, it just lands instantly — the crossfade is disabled
       by the reduced-motion block in index.css. */
    function start() {
        stop();
        timer = window.setInterval(function () {
            if (!paused) next();
        }, ROTATE_MS);
    }

    function stop() {
        if (timer) window.clearInterval(timer);
        timer = null;
    }

    root.addEventListener('pointerenter', function () { paused = true; });
    root.addEventListener('pointerleave', function () { paused = false; });

    /* Don't burn requests while the tab is in the background. */
    document.addEventListener('visibilitychange', function () {
        paused = document.hidden;
    });

    next();
    start();
})();
