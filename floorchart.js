/* ============================================================
   OG collection price panel — hero number + mini time series.

   Data comes from data/floor.json, produced by tools/fetch-floor.js.
   The OpenSea API is CORS-blocked, so it cannot be called from here;
   the JSON is fetched at build time instead.

   The series is the LOWEST COMPLETED SALE PER DAY, not the listing
   floor — OpenSea publishes a current floor but no floor history.
   The caption says so rather than letting the chart imply otherwise.

   Sales are sparse and irregular (28 trading days across 90), so the
   x-axis is scaled by real time and every actual observation gets a
   dot. Spacing points evenly would invent a regular cadence that
   does not exist.
   ============================================================ */

(function () {
    'use strict';

    const root = document.querySelector('[data-floor-chart]');
    if (!root) return;

    const VB_W = 720;
    const VB_H = 170;
    const PAD = { t: 18, r: 16, b: 26, l: 46 };

    function fmt(v) {
        return v < 0.01 ? v.toFixed(5) : v.toFixed(4);
    }

    function shortDate(iso) {
        const d = new Date(iso + 'T00:00:00Z');
        return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function build(data) {
        const series = (data.series || []).slice().sort(function (a, b) {
            return a.date < b.date ? -1 : 1;
        });

        if (series.length < 2) {
            root.innerHTML = '<p class="Floor-empty">not enough trades to chart yet</p>';
            return;
        }

        const times = series.map(function (d) { return Date.parse(d.date + 'T00:00:00Z'); });
        const vals = series.map(function (d) { return d.eth; });

        const tMin = times[0];
        const tMax = times[times.length - 1];
        const vMin = Math.min.apply(null, vals);
        const vMax = Math.max.apply(null, vals);
        const pad = (vMax - vMin) * 0.15 || vMax * 0.1;
        const yLo = Math.max(0, vMin - pad);
        const yHi = vMax + pad;

        const x = function (t) {
            return PAD.l + ((t - tMin) / (tMax - tMin)) * (VB_W - PAD.l - PAD.r);
        };
        const y = function (v) {
            return VB_H - PAD.b - ((v - yLo) / (yHi - yLo)) * (VB_H - PAD.t - PAD.b);
        };

        const pts = series.map(function (d, i) {
            return { x: x(times[i]), y: y(d.eth), d: d };
        });

        const line = pts.map(function (p, i) {
            return (i ? 'L' : 'M') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        }).join(' ');

        const area = line +
            ' L' + pts[pts.length - 1].x.toFixed(1) + ' ' + (VB_H - PAD.b) +
            ' L' + pts[0].x.toFixed(1) + ' ' + (VB_H - PAD.b) + ' Z';

        const iMax = vals.indexOf(vMax);
        const iMin = vals.indexOf(vMin);

        /* recessive gridlines at the two labelled values only */
        const grid = [yLo, yHi].map(function (v) {
            return '<line class="Floor-grid" x1="' + PAD.l + '" x2="' + (VB_W - PAD.r) +
                   '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>';
        }).join('');

        const yLabels =
            '<text class="Floor-axis" x="' + (PAD.l - 8) + '" y="' + (y(yHi) + 4).toFixed(1) +
                '" text-anchor="end">' + fmt(yHi) + '</text>' +
            '<text class="Floor-axis" x="' + (PAD.l - 8) + '" y="' + (y(yLo) + 4).toFixed(1) +
                '" text-anchor="end">' + fmt(yLo) + '</text>';

        const xLabels =
            '<text class="Floor-axis" x="' + PAD.l + '" y="' + (VB_H - 8) + '">' +
                shortDate(series[0].date) + '</text>' +
            '<text class="Floor-axis" x="' + (VB_W - PAD.r) + '" y="' + (VB_H - 8) +
                '" text-anchor="end">' + shortDate(series[series.length - 1].date) + '</text>';

        /* every observation gets a dot — the sampling is uneven and
           hiding that would misrepresent the data */
        const dots = pts.map(function (p, i) {
            const isEdge = i === iMax || i === iMin;
            return '<circle class="Floor-dot' + (isEdge ? ' is-edge' : '') + '" cx="' +
                   p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (isEdge ? 4 : 2.6) + '"/>';
        }).join('');

        /* Selective direct labels: the high and the low, nothing else.
           A centred label on an edge point overlaps the axis label next
           to it, so the anchor flips when the point is near either end. */
        function callout(p, value, above) {
            let anchor = 'middle';
            let dx = 0;
            if (p.x < PAD.l + 30) { anchor = 'start'; dx = -1; }
            else if (p.x > VB_W - PAD.r - 30) { anchor = 'end'; dx = 1; }

            const ty = above
                ? Math.max(PAD.t + 8, p.y - 9)
                : Math.min(VB_H - PAD.b - 5, p.y + 15);

            return '<text class="Floor-callout" x="' + (p.x + dx).toFixed(1) + '" y="' +
                   ty.toFixed(1) + '" text-anchor="' + anchor + '">' + value + '</text>';
        }

        const callouts = callout(pts[iMax], fmt(vMax), true) +
                         callout(pts[iMin], fmt(vMin), false);

        const rows = series.map(function (d) {
            return '<tr><td>' + d.date + '</td><td>' + fmt(d.eth) + '</td><td>' + d.sales + '</td></tr>';
        }).join('');

        root.innerHTML =
            '<div class="Floor-head">' +
                '<div>' +
                    '<p class="Floor-label">OG Collection &middot; floor</p>' +
                    '<p class="Floor-hero">' + fmt(data.currentFloorEth) +
                        ' <span class="Floor-unit">ETH</span></p>' +
                '</div>' +
                '<dl class="Floor-stats">' +
                    '<div><dt>Owners</dt><dd>' + Number(data.owners).toLocaleString() + '</dd></div>' +
                    '<div><dt>Volume</dt><dd>' + Number(data.totalVolumeEth).toLocaleString() +
                        ' ETH</dd></div>' +
                    '<div><dt>Trading days</dt><dd>' + series.length + '</dd></div>' +
                '</dl>' +
            '</div>' +

            '<figure class="Floor-figure">' +
                '<svg class="Floor-svg" viewBox="0 0 ' + VB_W + ' ' + VB_H + '" role="img" ' +
                     'aria-label="Lowest daily sale price in ETH over the last 90 days">' +
                    '<defs><linearGradient id="floorFill" x1="0" y1="0" x2="0" y2="1">' +
                        '<stop offset="0%" stop-color="#4ce0c4" stop-opacity="0.28"/>' +
                        '<stop offset="100%" stop-color="#4ce0c4" stop-opacity="0"/>' +
                    '</linearGradient></defs>' +
                    grid + yLabels + xLabels +
                    '<path class="Floor-area" d="' + area + '"/>' +
                    '<path class="Floor-line" d="' + line + '"/>' +
                    dots + callouts +
                    '<line class="Floor-cross" x1="0" y1="' + PAD.t + '" x2="0" y2="' +
                        (VB_H - PAD.b) + '" hidden/>' +
                '</svg>' +
                '<figcaption class="Floor-caption">Lowest completed sale per day &mdash; a floor ' +
                    'proxy, since OpenSea publishes no floor history. Captured ' +
                    esc(String(data.capturedAt).slice(0, 10)) + '.</figcaption>' +
            '</figure>' +

            '<div class="Floor-tip" hidden></div>' +

            '<details class="Floor-data">' +
                '<summary>View as table</summary>' +
                '<table><thead><tr><th>Date</th><th>Lowest sale (ETH)</th><th>Sales</th></tr></thead>' +
                '<tbody>' + rows + '</tbody></table>' +
            '</details>';

        attachHover(pts, series);
    }

    /* crosshair + tooltip: an HTML/SVG chart should be inspectable */
    function attachHover(pts, series) {
        const svg = root.querySelector('.Floor-svg');
        const cross = root.querySelector('.Floor-cross');
        const tip = root.querySelector('.Floor-tip');
        if (!svg || !tip) return;

        function nearest(clientX) {
            const box = svg.getBoundingClientRect();
            const vbX = ((clientX - box.left) / box.width) * VB_W;
            let best = 0;
            let dist = Infinity;
            pts.forEach(function (p, i) {
                const d = Math.abs(p.x - vbX);
                if (d < dist) { dist = d; best = i; }
            });
            return best;
        }

        function show(evt) {
            const i = nearest(evt.clientX);
            const p = pts[i];
            const d = series[i];
            const box = svg.getBoundingClientRect();
            const scale = box.width / VB_W;

            cross.setAttribute('x1', p.x);
            cross.setAttribute('x2', p.x);
            cross.hidden = false;

            tip.innerHTML =
                '<strong>' + fmt(d.eth) + ' ETH</strong>' +
                '<span>' + shortDate(d.date) + ' &middot; ' + d.sales +
                (d.sales === 1 ? ' sale' : ' sales') + '</span>';
            tip.hidden = false;
            tip.style.left = (p.x * scale) + 'px';
            tip.style.top = (p.y * scale) + 'px';
        }

        function hide() {
            cross.hidden = true;
            tip.hidden = true;
        }

        svg.addEventListener('pointermove', show);
        svg.addEventListener('pointerleave', hide);
    }

    /* data/floor.js sets window.FLOOR_DATA via a <script> tag, which works
       whether the page is served over HTTP or opened straight from disk.
       fetch() of a local file is blocked outright on file://, so the JSON
       is only the fallback. */
    if (window.FLOOR_DATA) {
        build(window.FLOOR_DATA);
    } else {
        fetch('data/floor.json')
            .then(function (r) {
                if (!r.ok) throw new Error('floor.json ' + r.status);
                return r.json();
            })
            .then(build)
            .catch(function () {
                const onDisk = window.location.protocol === 'file:';
                root.innerHTML = '<p class="Floor-empty">' + (onDisk
                    ? 'price data needs data/floor.js &mdash; run <code>node tools/fetch-floor.js</code>'
                    : 'price data unavailable &mdash; run <code>node tools/fetch-floor.js</code>'
                ) + '</p>';
            });
    }
})();
