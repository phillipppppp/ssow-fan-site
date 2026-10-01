/* ============================================================
   WhaleChain — read-only access to the OG whale contract.

   Shared by the ID card (download gating) and Whale Road (which
   whales you can play). Plain eth_call over public RPCs: no wallet
   extension, no API key, no indexer. The contract implements
   ERC721Enumerable, so a wallet's whales come straight from
   balanceOf + tokenOfOwnerByIndex.

   Nothing here proves who is at the keyboard — it reads whatever
   address is pasted. Real proof would need a wallet signature.
   ============================================================ */

(function () {
    'use strict';

    const CONTRACT = '0x88091012eedf8dba59d08e27ed7b22008f5d6fe5';

    /* function selectors */
    const SEL_BALANCE_OF = '0x70a08231';       /* balanceOf(address)                   */
    const SEL_TOKEN_OF_OWNER = '0x2f745c59';   /* tokenOfOwnerByIndex(address,uint256) */
    const SEL_OWNER_OF = '0x6352211e';         /* ownerOf(uint256)                     */

    /* Public endpoints that allow browser requests (verified ACAO: *).
       Tried in order so one being down isn't fatal. (Ankr was dropped
       in Sep 2026 — it started demanding an API key.) */
    const RPCS = [
        'https://ethereum-rpc.publicnode.com',
        'https://rpc.mevblocker.io',
        'https://eth.drpc.org',
        'https://eth.merkle.io'
    ];

    /* The subset verified to answer a full 24-call JSON-RPC batch.
       drpc's free tier caps batches at 3, and merkle rate-limits them. */
    const BATCH_RPCS = [
        'https://ethereum-rpc.publicnode.com',
        'https://rpc.mevblocker.io'
    ];

    function padAddress(addr) {
        return addr.toLowerCase().replace(/^0x/, '').padStart(64, '0');
    }

    function padUint(n) {
        return n.toString(16).padStart(64, '0');
    }

    function isAddress(value) {
        return /^0x[0-9a-fA-F]{40}$/.test((value || '').trim());
    }

    const TIMEOUT_MS = 8000;     /* give up on any one endpoint after this */
    const STAGGER_MS = 1200;     /* ...but bring in the next one after this */

    /* Hedged requests. Ask the first endpoint; if it hasn't answered
       within STAGGER_MS, ask the next one too, and so on. The first
       usable answer wins and the rest are cancelled; a failure brings
       in the next endpoint straight away.

       Asking strictly one after another, with no timeout, meant a
       single endpoint that hangs instead of failing stalled every
       lookup on the site — publicnode did exactly that for 30+ seconds
       per call in Oct 2026. Now it costs about a second.

       accept(json) returns the value, or throws if the reply is unusable. */
    function hedged(urls, body, accept) {
        return new Promise(function (resolve, reject) {
            let settled = false;
            let started = 0;
            let failures = 0;
            let lastError = null;
            const controllers = [];
            const timers = [];

            function finish() {
                settled = true;
                timers.forEach(clearTimeout);
                controllers.forEach(function (c) { c.abort(); });
            }

            function fail(err) {
                if (settled) return;
                lastError = err;
                failures++;
                if (failures === urls.length) {
                    finish();
                    reject(lastError || new Error('every RPC endpoint failed'));
                } else {
                    startNext();
                }
            }

            function startNext() {
                if (settled || started >= urls.length) return;
                const url = urls[started++];
                const ctrl = new AbortController();
                controllers.push(ctrl);
                const kill = setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS);

                fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: body,
                    signal: ctrl.signal
                })
                    .then(function (res) {
                        if (!res.ok) throw new Error('rpc ' + res.status);
                        return res.json();
                    })
                    .then(function (json) {
                        clearTimeout(kill);
                        if (settled) return;
                        const value = accept(json);
                        finish();
                        resolve(value);
                    })
                    .catch(function (err) {
                        clearTimeout(kill);
                        fail(err);
                    });
            }

            startNext();
            for (let i = 1; i < urls.length; i++) timers.push(setTimeout(startNext, i * STAGGER_MS));
        });
    }

    function ethCall(data) {
        const payload = JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'eth_call',
            params: [{ to: CONTRACT, data: data }, 'latest']
        });

        return hedged(RPCS, payload, function (json) {
            if (json.error) throw new Error(json.error.message);
            return json.result;
        });
    }

    /* Many eth_calls in one HTTP request (JSON-RPC batching).

       Listing a wallet used to await tokenOfOwnerByIndex once per whale,
       in sequence — 24 round trips back to back, the N+1 pattern. A
       batch is one round trip. A reply only counts if every item came
       back clean: some free endpoints accept the batch and then answer
       each item with a "batch too large" error instead. */
    async function ethCallBatch(datas) {
        if (datas.length === 1) return [await ethCall(datas[0])];

        const payload = JSON.stringify(datas.map(function (data, i) {
            return {
                jsonrpc: '2.0',
                id: i,
                method: 'eth_call',
                params: [{ to: CONTRACT, data: data }, 'latest']
            };
        }));

        try {
            return await hedged(BATCH_RPCS, payload, function (json) {
                if (!Array.isArray(json)) throw new Error('endpoint would not batch');

                /* replies may arrive in any order — match them up by id */
                const results = [];
                json.forEach(function (item) { results[item.id] = item; });

                for (let i = 0; i < datas.length; i++) {
                    const item = results[i];
                    if (!item || item.error || !item.result || item.result === '0x') {
                        throw new Error('batch came back incomplete');
                    }
                }
                return results.map(function (item) { return item.result; });
            });
        } catch (err) {
            /* fall through to single calls */
        }

        /* Nobody would batch. Fall back to single calls, six at a time —
           still a handful of round trips rather than one per whale, and
           gentle enough not to trip the public nodes' rate limits. */
        const out = [];
        for (let i = 0; i < datas.length; i += 6) {
            /* eslint-disable-next-line no-await-in-loop */
            const chunk = await Promise.all(datas.slice(i, i + 6).map(ethCall));
            out.push.apply(out, chunk);
        }
        return out;
    }

    window.WhaleChain = {
        CONTRACT: CONTRACT,
        isAddress: isAddress,

        /* How many OG whales the address holds. */
        balanceOf: async function (address) {
            const hex = await ethCall(SEL_BALANCE_OF + padAddress(address));
            return parseInt(hex, 16) || 0;
        },

        /* Token ids at holdings index [from, to) — one batched request. */
        tokensOfOwner: async function (address, from, to) {
            const calls = [];
            for (let i = from; i < to; i++) {
                calls.push(SEL_TOKEN_OF_OWNER + padAddress(address) + padUint(i));
            }
            if (!calls.length) return [];
            return (await ethCallBatch(calls)).map(function (hex) { return parseInt(hex, 16); });
        },

        /* Authoritative single-call ownership check. Holdings lists are
           paged, so a whale that hasn't been listed yet would otherwise
           look unowned. */
        ownsWhale: async function (address, tokenId) {
            const hex = await ethCall(SEL_OWNER_OF + padUint(tokenId));
            if (!hex || hex === '0x') return false;
            return ('0x' + hex.slice(-40)).toLowerCase() === address.toLowerCase();
        }
    };
})();
