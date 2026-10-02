/* ============================================================
   WhaleRules — the policy around the game, shared by the page
   and the server.

   The page uses it to say "that name won't work" before asking;
   the server uses the very same file to enforce it. Same loading
   trick as game-sim.js: browser global, CommonJS, or a Deno
   side-effect import (globalThis.WhaleRules).
   ============================================================ */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.WhaleRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    /* ---------------------------------------------------------
       Usernames
       --------------------------------------------------------- */

    const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;

    /* Names that would read as official. */
    const RESERVED = ['admin', 'administrator', 'moderator', 'mod', 'official', 'ssow',
        'secretsociety', 'secretsocietyofwhales', 'support', 'staff', 'system', 'whaleroad'];

    /* Matched after folding case, look-alike digits and underscores, so
       "B1tch" and "f_u_c_k" don't slip through. Kept to words with few
       innocent look-alikes ("rape" would block "grape"). */
    const BLOCKED = ['fuck', 'shit', 'cunt', 'bitch', 'nigg', 'faggot', 'retard', 'whore',
        'slut', 'nazi', 'hitler', 'kike', 'chink', 'twat', 'wank', 'porn', 'penis',
        'vagina', 'dildo', 'pussy', 'rapist', 'molest', 'pedo', 'kkk'];

    function fold(name) {
        return name.toLowerCase()
            .replace(/_/g, '')
            .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e')
            .replace(/4/g, 'a').replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b');
    }

    /* Returns null if the name is fine, otherwise why it isn't. */
    function checkName(name) {
        if (typeof name !== 'string' || !NAME_RE.test(name)) {
            return '3-16 letters, numbers or underscores';
        }
        const folded = fold(name);
        if (RESERVED.indexOf(name.toLowerCase()) >= 0 || RESERVED.indexOf(folded) >= 0) {
            return 'that name is reserved';
        }
        for (let i = 0; i < BLOCKED.length; i++) {
            if (folded.indexOf(BLOCKED[i]) >= 0) return 'pick a friendlier name';
        }
        return null;
    }

    /* ---------------------------------------------------------
       Wallet names: the one message a holder signs

       Signing is free — no gas, no transaction — and proves the
       wallet is yours, so nobody can rename it. The timestamp keeps
       an old signature from being replayed later.
       --------------------------------------------------------- */

    const CLAIM_TTL_MS = 10 * 60 * 1000;

    function claimMessage(username, wallet, issuedAt) {
        return 'Whale Road\n' +
            'Claim the name: ' + username + '\n' +
            'Wallet: ' + wallet.toLowerCase() + '\n' +
            'Issued: ' + issuedAt;
    }

    /* ---------------------------------------------------------
       Is this run a bot?

       tells come from WhaleSim.replay(). Thresholds were set by
       playing modelled humans and bots against each other:
       humans topped out at snapShare 0.20, a state-polling bot sat
       at 0.41+; humans' rhythm varies (CV 0.24+), a timer bot's
       doesn't (CV ~0). Short runs aren't judged — too little data,
       and they don't threaten the board anyway.

       A run that finished faster than it could have been played in
       real time is the clearest tell of all: it was computed, not
       played. The seed is only revealed when the run starts, so a
       bot can't work out a route ahead of time.
       --------------------------------------------------------- */

    function judge(tells, ticks, elapsedMs, tickHz) {
        const reasons = [];
        if (tells.burstPerSec > 20) reasons.push('burst');
        if (tells.presses >= 40 && tells.rhythmCV !== null && tells.rhythmCV < 0.12) reasons.push('rhythm');
        if (tells.moves >= 40 && tells.snapShare > 0.35) reasons.push('snap');
        const minimum = (ticks / tickHz) * 1000 * 0.97 - 1500;
        if (elapsedMs < minimum) reasons.push('fast-forward');
        return reasons;
    }

    return {
        NAME_RE: NAME_RE,
        CLAIM_TTL_MS: CLAIM_TTL_MS,
        checkName: checkName,
        claimMessage: claimMessage,
        judge: judge
    };
});
