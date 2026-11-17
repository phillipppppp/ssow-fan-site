/* ============================================================
   Minigames hub — puts each game's current #1 on its card.

   Reads the same public leaderboards the games show (one POST to
   each game's function). If a backend isn't configured or doesn't
   answer, its card simply keeps its usual line.
   ============================================================ */

(function () {
    'use strict';

    const cfg = window.WHALE_ROAD_CONFIG || {};

    function top(line, url, pick) {
        if (!line || !url) return;
        fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'board' })
        })
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (!data) return;
                const row = data.rows && data.rows[0];
                line.textContent = row
                    ? '\u{1F3C6} #1 ' + pick(row) + ' · ' + Number(row.score).toLocaleString('en-US')
                    : '\u{1F3C6} No scores yet — be the first';
                line.hidden = false;
            })
            .catch(function () { /* the card keeps its usual line */ });
    }

    top(document.querySelector('[data-game-top="whale-road"]'), cfg.functionUrl,
        function (r) { return r.username; });
    top(document.querySelector('[data-game-top="whale-2048"]'),
        cfg.supabaseUrl ? cfg.supabaseUrl + '/functions/v1/whale-2048' : '',
        function (r) { return r.name; });
})();
