/* ============================================================
   Minigames hub — puts each game's current #1 on its card.

   Reads the same public leaderboard the game shows (one POST to the
   whale-road function). If the backend isn't configured or doesn't
   answer, the card simply goes without the line.
   ============================================================ */

(function () {
    'use strict';

    const line = document.querySelector('[data-game-top]');
    const cfg = window.WHALE_ROAD_CONFIG || {};
    if (!line || !cfg.functionUrl) return;

    fetch(cfg.functionUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'board' })
    })
        .then(function (res) { return res.ok ? res.json() : null; })
        .then(function (data) {
            const top = data && data.rows && data.rows[0];
            line.textContent = top
                ? '\u{1F3C6} #1 ' + top.username + ' · ' + top.score
                : '\u{1F3C6} No scores yet — be the first';
            line.hidden = false;
        })
        .catch(function () { /* no line, no fuss */ });
})();
