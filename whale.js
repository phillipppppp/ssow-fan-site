/* ============================================================
   Whale source — resolves a token number to its art and traits.

   The contract's tokenURI is ipfs://<CID>/<id>, and each token's
   metadata names its own image CID:

       tokenURI(1) -> ipfs://Qmd Ax.../1
       -> { attributes: [...7 traits...], image: "https://.../Qmbb..." }

   Both the metadata and the images are served with
   Access-Control-Allow-Origin: *, which is what makes canvas
   export (the PNG download) possible.

   Falls through a list of gateways so one being down isn't fatal.
   ============================================================ */

(function () {
    'use strict';

    /* Base CID from tokenURI() on 0x88091012eedF8Dba59D08e27Ed7B22008F5d6fe5 */
    const BASE_CID = 'QmdAxHGSCS2NftXn52WbumMn2ENMKXcmk55QgXbmWr86KL';

    /* Pinata first — it's the gateway the metadata itself points at. */
    const GATEWAYS = [
        'https://gateway.pinata.cloud/ipfs/',
        'https://ipfs.io/ipfs/',
        'https://cloudflare-ipfs.com/ipfs/',
        'https://nftstorage.link/ipfs/'
    ];

    const SUPPLY = 10000;
    const cache = {};        /* id -> whale metadata */
    const imageCache = {};   /* id -> decoded HTMLImageElement */

    /* Ask every gateway at once and keep the first that answers. Trying
       them in sequence meant a slow leader cost its full latency (~5s)
       before the next was even attempted. */
    async function fetchMetadata(id) {
        const attempts = GATEWAYS.map(function (base) {
            return fetch(base + BASE_CID + '/' + id, { mode: 'cors' })
                .then(function (res) {
                    if (!res.ok) throw new Error('gateway returned ' + res.status);
                    return res.json();
                });
        });

        if (typeof Promise.any === 'function') {
            return Promise.any(attempts);
        }

        /* Older engines: first settled success wins, same idea. */
        return new Promise(function (resolve, reject) {
            let failures = 0;
            attempts.forEach(function (p) {
                p.then(resolve).catch(function () {
                    failures++;
                    if (failures === attempts.length) {
                        reject(new Error('every IPFS gateway failed'));
                    }
                });
            });
        });
    }

    window.WhaleSource = {
        SUPPLY: SUPPLY,

        isValidId: function (id) {
            const n = Number(id);
            return Number.isInteger(n) && n >= 1 && n <= SUPPLY;
        },

        /* Resolves to { id, image, traits: [{trait_type, value}, ...] } */
        load: async function (id) {
            const key = String(id);
            if (cache[key]) return cache[key];

            const meta = await fetchMetadata(id);
            const whale = {
                id: Number(id),
                image: meta.image,
                traits: meta.attributes || []
            };

            cache[key] = whale;
            return whale;
        },

        /* Fetch and fully decode a whale's art, cached by token id.
           These are the original 1-2 MB files, so a repeat view should
           never pay for it twice. Resolves to an HTMLImageElement that
           is ready to draw — decode() means no jank on first paint. */
        loadImage: function (whale) {
            const key = String(whale.id);
            if (imageCache[key]) return Promise.resolve(imageCache[key]);

            return new Promise(function (resolve, reject) {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    const done = function () { imageCache[key] = img; resolve(img); };
                    if (img.decode) { img.decode().then(done).catch(done); } else { done(); }
                };
                img.onerror = function () { reject(new Error('image failed to load')); };
                img.src = whale.image;
            });
        },

        /* Warm the caches without doing anything with the result. */
        prefetch: function (id) {
            const self = window.WhaleSource;
            return self.load(id).then(self.loadImage).catch(function () { /* ignore */ });
        },

        /* "Top Hat, Shy eyes, Unshaved Cigar" — for prompts and captions. */
        describeTraits: function (traits) {
            if (!traits || !traits.length) return '';
            return traits.map(function (t) {
                return t.trait_type + ': ' + t.value;
            }).join(', ');
        }
    };
})();
