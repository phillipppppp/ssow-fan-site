/* ============================================================
   Whale of the Day — one whale, held for a full day.

   The whale is *derived from the date*, not picked randomly:
   the UTC date string is hashed and folded into 1..10000. So it
   survives a reload, it is the same whale for everyone opening
   the page, and it rolls over exactly at UTC midnight. Using
   Math.random() here would hand every visitor a different whale
   and change it on every refresh, which is a different feature.

   UTC rather than local time so the pod is looking at the same
   whale on the same day regardless of timezone.
   ============================================================ */

(function () {
    'use strict';

    const CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';
    const SUPPLY = 10000;
    const MAX_TRIES = 6;       /* skip a token whose metadata will not load */

    const root = document.querySelector('[data-whale-of-the-day]');
    if (!root || !window.WhaleSource) return;

    let currentKey = null;
    let ticker = null;

    function dayKey(date) {
        return date.getUTCFullYear() + '-' +
               String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
               String(date.getUTCDate()).padStart(2, '0');
    }

    /* FNV-1a, then a MurmurHash3 finalizer.

       The avalanche step is not optional here. Consecutive dates differ
       by a single character, and plain FNV-1a maps that to a constant
       offset — the picked whale walked forward by exactly 2381 every
       day, which is the opposite of what this feature is for. Mixing
       the bits afterwards breaks that relationship. */
    function hash(str) {
        let h = 2166136261;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        h ^= h >>> 16;
        h = Math.imul(h, 2246822507);
        h ^= h >>> 13;
        h = Math.imul(h, 3266489909);
        h ^= h >>> 16;
        return h >>> 0;
    }

    function whaleFor(key, attempt) {
        return (hash(key + (attempt ? ':' + attempt : '')) % SUPPLY) + 1;
    }

    function prettyDate(date) {
        try {
            return date.toLocaleDateString(undefined, {
                weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC'
            }).toUpperCase();
        } catch (err) {
            return dayKey(date);
        }
    }

    function msUntilNextUtcDay() {
        const now = new Date();
        const next = Date.UTC(
            now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
        );
        return next - now.getTime();
    }

    function countdown() {
        const total = Math.max(0, Math.floor(msUntilNextUtcDay() / 1000));
        const h = String(Math.floor(total / 3600)).padStart(2, '0');
        const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return h + ':' + m + ':' + s;
    }

    function skeleton() {
        root.innerHTML =
            '<h2 class="Daily-heading">Whale of the Day</h2>' +
            '<div class="Daily-panel is-loading">' +
                '<p class="Daily-loading">picking today’s whale…</p>' +
            '</div>';
    }

    function paint(whale, date) {
        const traits = (whale.traits || []).map(function (t) {
            return '<li class="Daily-trait" title="' + t.trait_type + '">' +
                   '<span class="Daily-traitType">' + t.trait_type + '</span>' +
                   '<span class="Daily-traitValue">' + t.value + '</span></li>';
        }).join('');

        root.innerHTML =
            '<h2 class="Daily-heading">Whale of the Day</h2>' +
            '<div class="Daily-panel">' +
                '<div class="Daily-art">' +
                    '<img src="' + whale.image + '" alt="Secret Society of Whales #' + whale.id + '">' +
                '</div>' +
                '<div class="Daily-info">' +
                    '<p class="Daily-date">' + prettyDate(date) + '</p>' +
                    '<p class="Daily-id">#' + whale.id + '</p>' +
                    '<ul class="Daily-traits">' + traits + '</ul>' +
                    '<div class="Daily-actions">' +
                        '<a class="Daily-link" target="_blank" rel="noopener noreferrer" ' +
                           'href="https://opensea.io/item/ethereum/' + CONTRACT + '/' + whale.id + '">' +
                           'View on OpenSea</a>' +
                        '<a class="Daily-link Daily-link--ghost" ' +
                           'href="idcard.html?id=' + whale.id + '">Make its card</a>' +
                    '</div>' +
                    '<p class="Daily-next">NEXT WHALE IN <span class="Daily-clock">' +
                        countdown() + '</span></p>' +
                '</div>' +
            '</div>';
    }

    function fail() {
        root.innerHTML =
            '<h2 class="Daily-heading">Whale of the Day</h2>' +
            '<div class="Daily-panel is-loading">' +
                '<p class="Daily-loading">could not reach the pod &mdash; try again shortly</p>' +
            '</div>';
    }

    async function pick() {
        const date = new Date();
        const key = dayKey(date);
        currentKey = key;

        skeleton();

        for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
            const id = whaleFor(key, attempt);
            try {
                const whale = await window.WhaleSource.load(id);
                await window.WhaleSource.loadImage(whale);
                if (currentKey !== key) return;      /* day rolled over mid-fetch */
                paint(whale, date);
                return;
            } catch (err) {
                /* that token's gateways were unreachable; nudge the seed */
            }
        }

        fail();
    }

    function startTicker() {
        if (ticker) window.clearInterval(ticker);
        ticker = window.setInterval(function () {
            const clock = root.querySelector('.Daily-clock');
            if (clock) clock.textContent = countdown();

            /* rolled past UTC midnight — fetch the new day's whale */
            if (dayKey(new Date()) !== currentKey) pick();
        }, 1000);
    }

    pick();
    startTicker();

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) {
            if (ticker) { window.clearInterval(ticker); ticker = null; }
        } else {
            if (dayKey(new Date()) !== currentKey) pick();
            startTicker();
        }
    });
})();
