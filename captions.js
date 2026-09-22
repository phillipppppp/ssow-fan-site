/* ============================================================
   Whale caption writer — 5 captions per whale.

   Two modes, chosen automatically:

   1. CLAUDE  — if window.WHALE_CONFIG.anthropicApiKey is set,
                captions are written by Claude (claude-opus-5)
                from the whale's actual traits.
   2. BUILT-IN — otherwise, captions are assembled locally from
                per-trait template banks, seeded by the token
                number. Because the templates interpolate the
                whale's own trait values, two whales with
                different hats get different jokes.

   ---- SECURITY, READ THIS ------------------------------------
   Mode 1 puts your API key in the browser. Anyone who opens
   DevTools on a deployed copy of this page can read it and spend
   your credits. Fine for a local demo on your own machine; NOT
   fine on a public URL.

   Before deploying anywhere public, either delete config.js so
   the page falls back to mode 2, or move the API call behind a
   small server that holds the key.

   Keep config.js out of version control.
   ------------------------------------------------------------- */

(function () {
    'use strict';

    const API_URL = 'https://api.anthropic.com/v1/messages';
    const MODEL = 'claude-opus-5';
    const CAPTION_COUNT = 5;

    function getKey() {
        return (window.WHALE_CONFIG && window.WHALE_CONFIG.anthropicApiKey) || '';
    }

    function getWorkspace() {
        return (window.WHALE_CONFIG && window.WHALE_CONFIG.anthropicWorkspaceId) || '';
    }

    function describe(traits) {
        if (!traits || !traits.length) return 'unknown';
        return traits.map(function (t) { return t.trait_type + ': ' + t.value; }).join(', ');
    }

    function traitValue(traits, type) {
        const hit = (traits || []).find(function (t) { return t.trait_type === type; });
        return hit ? hit.value : '';
    }

    /* Small deterministic PRNG — same id in, same sequence out. */
    function makeRandom(seed) {
        let s = (seed * 2654435761) % 2147483647;
        if (s <= 0) s += 2147483646;
        return function () {
            s = (s * 16807) % 2147483647;
            return (s - 1) / 2147483646;
        };
    }

    function shuffle(rand, list) {
        const out = list.slice();
        for (let i = out.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
        }
        return out;
    }

    /* ---------------------------------------------------------
       Mode 1 — Claude
       --------------------------------------------------------- */

    const SYSTEM_PROMPT =
        'You write short, punchy meme captions for the Secret Society of Whales, ' +
        'a 10,000-piece NFT community that launched in August 2021. The community ' +
        'is known for its community-governed vault, proposal votes, cigar-lounge ' +
        'culture, gaming guilds in Pixels and Nifty Island, and the rallying cry ' +
        '#TogetherWeWhale. Captions are affectionate insider humour — never mean, ' +
        'never financial advice. Each caption is at most 60 characters and has to ' +
        'work as impact-font text laid over a picture.';

    /* A larger pool than we use, sampled per call, so regenerating the
       same whale gives a different five. */
    const ANGLES = [
        'the specific hat, taken far too seriously',
        'the outfit as a fake profession',
        'the eyes as a mood the whale cannot escape',
        'the mouth or cigar as a whole personality',
        'diamond hands / refusing to sell',
        'a DAO proposal nobody read',
        'the cigar lounge',
        'checking the floor price too often',
        'explaining NFTs to a relative',
        'four years in the pod and nothing has changed',
        'quiet smugness about being early',
        'the whale judging you personally',
        'a tiny domestic problem, whale-scale',
        'misplaced confidence'
    ];

    async function generateWithClaude(whale) {
        const rand = makeRandom(Date.now() % 100000);
        const angles = shuffle(rand, ANGLES).slice(0, CAPTION_COUNT);

        const body = {
            model: MODEL,
            max_tokens: 2000,
            system: SYSTEM_PROMPT,
            /* Simple task — low effort keeps it fast and cheap while
               leaving adaptive thinking on (disabling it on Opus 5 has
               known failure modes). */
            output_config: {
                effort: 'low',
                format: {
                    type: 'json_schema',
                    schema: {
                        type: 'object',
                        properties: {
                            captions: {
                                type: 'array',
                                minItems: CAPTION_COUNT,
                                maxItems: CAPTION_COUNT,
                                items: { type: 'string' }
                            }
                        },
                        required: ['captions'],
                        additionalProperties: false
                    }
                }
            },
            /* If a safety classifier declines, the API re-runs the request
               on a fallback model inside the same call. The beta itself
               goes in the anthropic-beta HEADER below — `betas: [...]` in
               the body is an SDK convenience, and this is raw HTTP. */
            fallbacks: 'default',
            messages: [{
                role: 'user',
                content:
                    'Write ' + CAPTION_COUNT + ' meme captions for Secret Society of Whales #' +
                    whale.id + '.\n\n' +
                    'This whale\'s traits: ' + describe(whale.traits) + '\n\n' +
                    'Use one of these angles per caption, in this order:\n' +
                    angles.map(function (a, i) { return (i + 1) + '. ' + a; }).join('\n') +
                    '\n\nHard rules:\n' +
                    '- Name the whale\'s actual trait values where the angle calls for it. ' +
                    '"Sushi Chef hat" beats "funny hat".\n' +
                    '- No two captions may begin with the same word.\n' +
                    '- Vary the length: at least one under 25 characters, at least one over 45.\n' +
                    '- Do not use the words "when" or "me" to start more than one caption.\n' +
                    '- No emoji, no quotation marks, no hashtags except #TogetherWeWhale.'
            }]
        };

        const headers = {
            'content-type': 'application/json',
            'x-api-key': getKey(),
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'server-side-fallback-2026-07-01',
            /* Without this the browser request is blocked by CORS. */
            'anthropic-dangerous-direct-browser-access': 'true'
        };

        /* An organisation-level key has to name a workspace; a
           workspace-scoped key does not. Optional in config.js. */
        const workspace = getWorkspace();
        if (workspace) headers['anthropic-workspace-id'] = workspace;

        const res = await fetch(API_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const detail = await res.text();
            throw new Error('Claude API ' + res.status + ': ' + detail.slice(0, 200));
        }

        const data = await res.json();

        if (data.stop_reason === 'refusal') {
            throw new Error('the request was declined');
        }

        const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
        if (!textBlock) throw new Error('no text in response');

        const parsed = JSON.parse(textBlock.text);
        if (!parsed.captions || !parsed.captions.length) throw new Error('no captions in response');

        return parsed.captions.slice(0, CAPTION_COUNT);
    }

    /* ---------------------------------------------------------
       Mode 2 — built-in writer

       One bank per trait type. Every line interpolates the whale's
       own value, so "Sushi Chef" and "Top Hat" whales never share a
       joke even when the same template is picked.
       --------------------------------------------------------- */

    const BANKS = {
        Hat: [
            function (v) { return 'the ' + v + ' is not a costume, it is a lifestyle'; },
            function (v) { return 'yes i wore the ' + v + ' to the vote. next question'; },
            function (v) { return 'born to whale, forced to wear a ' + v; },
            function (v) { return 'nobody asked about the ' + v + '. everybody noticed'; },
            function (v) { return 'i own one hat. it is a ' + v; },
            function (v) { return 'the ' + v + ' does all the talking'; },
            function (v) { return 'put the ' + v + ' on the mural'; },
            function (v) { return 'four years of ' + v + '. zero regrets'; }
        ],
        Outfit: [
            function (v) { return 'dressed as a ' + v + ' for a vote nobody attended'; },
            function (v) { return v + ' by day, whale by conviction'; },
            function (v) { return 'my linkedin says ' + v + '. my wallet disagrees'; },
            function (v) { return 'hired as a ' + v + ', promoted to pod member'; },
            function (v) { return 'trust me, i am practically a ' + v; },
            function (v) { return 'the ' + v + ' fit goes unreasonably hard'; },
            function (v) { return 'no ' + v + ' has ever been this liquid'; }
        ],
        Eyes: [
            function (v) { return v + ' eyes, diamond fins'; },
            function (v) { return 'this is my ' + v + ' face and it is permanent'; },
            function (v) { return 'reading the roadmap, ' + v; },
            function (v) { return v + ', and still holding'; },
            function (v) { return 'the ' + v + ' look you get at "just sweep it"'; },
            function (v) { return 'born ' + v + '. stayed ' + v; }
        ],
        Mouth: [
            function (v) { return v + ' energy, all day'; },
            function (v) { return 'you cannot rush a ' + v; },
            function (v) { return 'the ' + v + ' is carrying this entire pfp'; },
            function (v) { return 'caught mid ' + v + '. no notes'; },
            function (v) { return 'ten thousand whales, one ' + v; }
        ],
        Skin: [
            function (v) { return v + ' whale, green candles, eventually'; },
            function (v) { return 'yes i am ' + v + '. yes it was on purpose'; },
            function (v) { return v + ' outside, cigar smoke inside'; },
            function (v) { return 'they said ' + v + ' would not sell. they were right'; }
        ],
        Background: [
            function (v) { return 'same ' + v + ' background since august 2021'; },
            function (v) { return v + ' background, unchanged worldview'; },
            function (v) { return 'chose ' + v + '. would choose ' + v + ' again'; },
            function (v) { return 'the ' + v + ' never once moved'; }
        ],
        Fin: [
            function (v) { return 'the ' + v + ' were an investment'; },
            function (v) { return v + ' on the fin, priorities in order'; },
            function (v) { return 'you would wear the ' + v + ' too'; }
        ],
        'Blowhole Ring': [
            function (v) { return 'the ' + v + ' is my entire personality'; },
            function (v) { return 'had the ' + v + ' before it was cool'; }
        ]
    };

    /* Used only to top up when a whale has very few traits. */
    const GENERIC = [
        'still not selling',
        'sir, this is a cigar lounge',
        'the vault is fine. the vault is always fine',
        'proposal passed. we whaling',
        'day 1,400 in the pod',
        'i have seen things. mostly charts',
        'togetherwewhale or whatever',
        'ten thousand whales and mine is the weird one'
    ];

    function generateLocally(whale) {
        const rand = makeRandom(Number(whale.id) || 1);
        const traits = whale.traits || [];

        /* Build one candidate line per trait the whale actually has,
           then take five from five different trait types so no two
           captions in a set rhyme with each other. */
        const byType = shuffle(rand, Object.keys(BANKS)).map(function (type) {
            const raw = traitValue(traits, type);
            if (!raw || !BANKS[type]) return null;
            const value = raw.toLowerCase();
            const bank = BANKS[type];
            return bank[Math.floor(rand() * bank.length)](value);
        }).filter(Boolean);

        const out = byType.slice(0, CAPTION_COUNT);

        const spare = shuffle(rand, GENERIC);
        let i = 0;
        while (out.length < CAPTION_COUNT && i < spare.length) {
            if (out.indexOf(spare[i]) === -1) out.push(spare[i]);
            i++;
        }

        return shuffle(rand, out).slice(0, CAPTION_COUNT);
    }

    /* ---------------------------------------------------------
       Public API
       --------------------------------------------------------- */

    window.WhaleCaptions = {
        usingClaude: function () {
            return Boolean(getKey());
        },

        /* Always resolves — a Claude failure falls back to the local
           writer rather than leaving the user with nothing. Resolves to
           { captions: [...], source: 'claude' | 'built-in', note: string }. */
        generate: async function (whale) {
            if (getKey()) {
                try {
                    const captions = await generateWithClaude(whale);
                    return { captions: captions, source: 'claude', note: '' };
                } catch (err) {
                    return {
                        captions: generateLocally(whale),
                        source: 'built-in',
                        note: 'Claude call failed (' + err.message + ') — used the built-in writer.'
                    };
                }
            }

            return {
                captions: generateLocally(whale),
                source: 'built-in',
                note: 'No API key in config.js — used the built-in writer.'
            };
        }
    };
})();
