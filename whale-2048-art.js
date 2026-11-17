/* ============================================================
   Whale2048Art — the creatures of Whale 2048.

   Every creature is drawn here, by hand, as SVG: ink outlines,
   flat fills and a cel-shaded side, like the OG art. Nothing is
   traced or borrowed from other 2048 games. The whales reuse the
   site's own pfp whale (images/pfp), so the food chain ends with
   one of ours.

   Each tile's colour is one of the OG backdrop traits, in ladder
   order, until the King Whale takes gold. Past 2048 the King turns
   gold itself, then cosmic.

   The page calls Whale2048Art.ensure() once: it adds a hidden
   sprite of <symbol id="w2-cN"> (N = the tile's exponent) that
   tiles, the ladder and the leaderboard all <use>.
   ============================================================ */

(function () {
    'use strict';

    const INK = '#1d1b20';
    const WHITE = '#fffdf7';
    const BLUSH = '#f28fb1';

    /* index = exponent: 1 is a 2, 11 is 2048. 12 and 13 go on forever. */
    const CREATURES = [
        null,
        { name: 'Krill',        tile: '#bec4c3' },
        { name: 'Shrimp',       tile: '#add4db' },
        { name: 'Fish',         tile: '#c1dbb6' },
        { name: 'Pufferfish',   tile: '#a1c0d6' },
        { name: 'Jellyfish',    tile: '#ab9abf' },
        { name: 'Turtle',       tile: '#83c7b3' },
        { name: 'Dolphin',      tile: '#e0887a' },
        { name: 'Shark',        tile: '#e28537' },
        { name: 'Orca',         tile: '#ba976a' },
        { name: 'Whale',        tile: '#496342', dark: true },
        { name: 'King Whale',   tile: '#f4b740' },
        { name: 'Golden King',  tile: '#2b2731', dark: true },
        { name: 'Cosmic Whale', tile: '#3a2d5c', dark: true }
    ];
    const LAST = CREATURES.length - 1;

    function idx(e) { return Math.max(1, Math.min(LAST, e | 0)); }

    /* ---------- drawing helpers (a 100 x 100 box) ---------- */

    function shape(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '"' + (more || '') + '/>'; }
    function flat(d, fill, more) { return '<path d="' + d + '" fill="' + fill + '" stroke="none"' + (more || '') + '/>'; }
    function line(d, w, color) {
        return '<path d="' + d + '" fill="none" stroke-width="' + (w || 3) + '"' + (color ? ' stroke="' + color + '"' : '') + '/>';
    }
    /* fill, then the shading, then the outline on top */
    function shaded(d, fill, shade) { return flat(d, fill) + shade + line(d, 4); }

    function eye(x, y, r) {
        return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="' + INK + '" stroke="none"/>' +
            '<circle cx="' + (x + r * 0.35).toFixed(1) + '" cy="' + (y - r * 0.38).toFixed(1) + '" r="' + (r * 0.38).toFixed(1) + '" fill="#fff" stroke="none"/>';
    }
    function blush(x, y, rx) {
        return '<ellipse cx="' + x + '" cy="' + y + '" rx="' + (rx || 4.5) + '" ry="' + ((rx || 4.5) * 0.65).toFixed(1) + '" fill="' + BLUSH + '" opacity="0.6" stroke="none"/>';
    }
    function shine(d, w) { return line(d, w || 3, '#ffffff') .replace('/>', ' opacity="0.75"/>'); }
    function sparkle(x, y, s, fill) {
        const d = 'M' + x + ' ' + (y - s) + ' Q' + x + ' ' + y + ' ' + (x + s) + ' ' + y + ' Q' + x + ' ' + y + ' ' + x + ' ' + (y + s) +
            ' Q' + x + ' ' + y + ' ' + (x - s) + ' ' + y + ' Q' + x + ' ' + y + ' ' + x + ' ' + (y - s) + ' Z';
        return '<path d="' + d + '" fill="' + (fill || '#fff') + '" stroke-width="2"/>';
    }

    /* ---------- the creatures ---------- */

    const ART = {};

    ART[1] = (function () {           /* Krill: tiny, pink, all eye */
        const body = 'M14 52 C14 40 28 33 46 33 C62 33 76 39 80 50 C82 57 76 61 66 62 C52 64 32 66 22 63 C17 61 14 57 14 52 Z';
        return line('M22 42 C14 32 10 24 4 20', 3) + line('M27 39 C25 28 26 20 22 12', 3) +
            line('M34 62 L30 72 M42 63 L40 74 M50 63 L50 74 M58 62 L60 72', 3) +
            shape('M76 46 L94 36 L90 50 L96 62 L76 58 Z', '#f4a3a0') +
            shaded(body, '#f4a3a0', flat('M17 58 C30 62 54 61 79 54 C78 59 72 61 66 62 C52 64 32 66 22 63 C19 62 17 60 17 58 Z', '#de7d7b')) +
            line('M49 35 Q45 48 48 63 M59 36 Q56 48 58 62 M69 39 Q67 49 68 61', 2.5) +
            shine('M32 37 C37 35 42 35 46 35', 2.5) +
            eye(28, 46, 7.5) + blush(38, 54, 4) + line('M16 55 Q19 57.5 22 55.5', 2.5);
    })();

    ART[2] = (function () {           /* Shrimp: curled, coral, long feelers */
        const band = 'M16 60 C14 34 32 16 54 16 C76 16 90 34 88 54 C87 64 82 72 74 78 L62 68 C68 64 72 58 72 52 C72 40 62 32 52 32 C42 32 34 40 34 52 C34 56 35 60 36 62 Z';
        const head = 'M9 57 C9 46 18 41 27 43 C35 45 39 51 38 59 C37 66 29 70 21 69 C14 68 9 63 9 57 Z';
        return line('M12 48 C4 38 3 26 9 14', 2.5) + line('M17 44 C13 33 15 23 22 15', 2.5) +
            line('M42 47 l7 6 M49 39 l4 8 M58 37 l0 8 M66 43 l-5 6', 2.5) +
            shape('M66 71 L54 91 Q68 99 84 91 L77 74 Z', '#f28b5e') +
            line('M60 82 L68 92 M70 79 L74 92', 2) +
            shaded(band, '#f28b5e', flat('M80 34 C88 44 89 60 80 72 L74 78 L62 68 C68 64 72 58 72 52 C72 46 70 41 67 37 Z', '#d9693e')) +
            line('M40 21 L45 34 M54 16 L53 32 M68 20 L64 35 M81 31 L70 42 M88 47 L72 51 M85 63 L71 59', 2.5) +
            shaded(head, '#f6a07a', flat('M10 62 C14 69 26 72 33 67 C29 70 22 71 18 70 C13 69 10 66 10 62 Z', '#d9693e')) +
            shine('M44 22 C50 19 57 18 63 19', 2.5) +
            eye(22, 52, 5.5) + blush(30, 61, 3.8) + line('M11 60 Q14 62.5 17 61', 2.2);
    })();

    ART[3] = (function () {           /* Fish: round, yellow, two orange stripes */
        const body = 'M10 50 C12 34 30 24 48 24 C64 24 76 36 78 50 C76 64 64 76 48 76 C30 76 12 66 10 50 Z';
        return shape('M70 50 L92 29 C89 42 89 58 92 71 Z', '#f08a3c') +
            shape('M33 31 C39 15 56 13 64 28 Z', '#f08a3c') +
            shape('M44 70 C46 81 54 85 61 81 C59 77 57 72 55 68 Z', '#f08a3c') +
            flat(body, '#ffcd5e') +
            line('M40 25 C34 40 34 60 40 75', 7, '#f08a3c') + line('M59 27 C54 40 54 60 59 73', 7, '#f08a3c') +
            flat('M13 58 C22 70 36 76 48 76 C62 76 72 68 76 58 C66 66 30 68 13 58 Z', '#e09a2e') +
            line(body, 4) +
            line('M29 36 Q23 50 29 64', 3) +
            shape('M45 50 C51 45 60 49 57 58 C52 58 47 56 45 50 Z', '#f08a3c', ' stroke-width="3"') +
            shine('M31 30 C37 27 44 26 50 27', 3) +
            eye(20, 44, 6.5) + blush(24, 56, 3.6) + line('M11 52 Q15 56 19 53', 3);
    })();

    ART[4] = (function () {           /* Pufferfish: puffed up, spiky, pouting */
        let spikes = '';
        for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 - Math.PI / 2;
            const w = 0.17;
            const p = function (ang, r) { return (50 + Math.cos(ang) * r).toFixed(1) + ' ' + (52 + Math.sin(ang) * r).toFixed(1); };
            spikes += 'M' + p(a - w, 29) + ' L' + p(a, 43) + ' L' + p(a + w, 29) + ' Z ';
        }
        const body = 'M18 52 A32 32 0 1 0 82 52 A32 32 0 1 0 18 52 Z';
        return shape(spikes, '#f3cf6c', ' stroke-width="3"') +
            shape('M20 57 C9 49 4 59 7 68 C14 68 18 64 22 61 Z', '#e9a93c') +
            shape('M80 57 C91 49 96 59 93 68 C86 68 82 64 78 61 Z', '#e9a93c') +
            shaded(body, '#f6d77d', flat('M21 62 C28 82 72 82 79 62 C72 72 28 72 21 62 Z', '#fdf0c8') +
                flat('M22 67 C30 82 70 82 78 67 C76 76 64 84 50 84 C36 84 24 76 22 67 Z', '#ecd59a')) +
            '<g fill="#c98f3d" stroke="none"><circle cx="36" cy="31" r="3"/><circle cx="50" cy="26" r="3.6"/><circle cx="64" cy="31" r="3"/><circle cx="28" cy="43" r="2.4"/><circle cx="72" cy="43" r="2.4"/></g>' +
            shine('M27 36 C30 30 35 26 41 24', 3) +
            eye(38, 47, 7) + eye(62, 47, 7) + blush(28, 59, 4.5) + blush(72, 59, 4.5) +
            '<ellipse cx="50" cy="64" rx="6.5" ry="5.5" fill="' + BLUSH + '" stroke-width="3"/>' +
            '<ellipse cx="50" cy="64.6" rx="2.6" ry="2.1" fill="' + INK + '" stroke="none"/>';
    })();

    ART[5] = (function () {           /* Jellyfish: a pink bell and wavy tentacles */
        const t = ['M28 56 C24 66 32 74 28 84 C26 90 28 94 30 96', 'M40 58 C38 70 44 78 40 92', 'M50 58 C52 70 46 80 50 94',
            'M60 58 C62 70 56 78 60 92', 'M72 56 C76 66 68 74 72 84 C74 90 72 94 70 96'];
        const bell = 'M14 54 C14 28 30 12 50 12 C70 12 86 28 86 54 Q80 62 74 54 Q68 62 62 54 Q56 62 50 54 Q44 62 38 54 Q32 62 26 54 Q20 62 14 54 Z';
        return t.map(function (d) { return line(d, 8.5); }).join('') +
            t.map(function (d) { return line(d, 3.6, '#fbd0e3'); }).join('') +
            shaded(bell, '#f7a8cc', flat('M15 45 C30 52 70 52 85 45 C85.6 48 86 51 86 54 Q80 62 74 54 Q68 62 62 54 Q56 62 50 54 Q44 62 38 54 Q32 62 26 54 Q20 62 14 54 C14 51 14.4 48 15 45 Z', '#e07fab')) +
            shine('M25 31 C27 23 33 18 40 16', 4) + '<circle cx="23" cy="38" r="2.2" fill="#fff" stroke="none" opacity="0.8"/>' +
            eye(40, 35, 4.6) + eye(60, 35, 4.6) + blush(32, 43, 4) + blush(68, 43, 4) +
            line('M45 42 Q50 47 55 42', 3);
    })();

    ART[6] = (function () {           /* Turtle: green shell, flippers out */
        const dome = 'M24 58 C24 36 42 22 60 22 C78 22 92 36 92 58 Z';
        return shape('M76 62 C82 70 90 74 97 74 C95 66 88 60 80 58 Z', '#bfdc7e') +
            shape('M34 62 C30 72 22 80 11 82 C13 74 20 64 28 58 Z', '#bfdc7e') +
            shape('M88 54 L97 57 L88 61 Z', '#bfdc7e', ' stroke-width="3"') +
            shaded('M32 46 C26 39 8 39 5 51 C3 62 13 67 22 64 C26 63 30 61 33 58 Z', '#bfdc7e', flat('M7 58 C11 65 20 66 27 62 C24 64 20 65 17 65 C12 65 8 62 7 58 Z', '#9cbf5c')) +
            shaded(dome, '#5f8f3e', flat('M27 56 C27 52 28 48 30 45 C34 50 80 50 89 45 C91 49 92 53 92 58 L24 58 Z', '#4a7430')) +
            shape('M50 31 L65 31 L71 43 L65 55 L50 55 L44 43 Z', '#86b955', ' stroke-width="3"') +
            line('M44 43 L26 43 M71 43 L90 43 M50 31 L45 23 M65 31 L71 23', 3) +
            shape('M20 58 L96 58 C96 63 92 66 86 66 L28 66 C23 66 20 62 20 58 Z', '#efe2a0') +
            shine('M40 29 C46 25 52 24 58 24', 3) +
            eye(13, 50, 4.2) + blush(19, 57, 3.2) + line('M6 56 Q10 59.5 15 57.5', 2.5);
    })();

    ART[7] = (function () {           /* Dolphin: arched in a leap, beak first, all smiles */
        const body = 'M4 68 C6 62 12 58 19 56 C24 40 38 27 56 26 C72 25 84 36 87 52 C88 57 86 61 82 63 ' +
            'C80 54 72 46 60 46 C46 46 36 56 30 66 C26 72 18 74 11 73 C7 72.5 4 71 4 68 Z';
        return shape('M48 29 C51 18 58 11 67 9 C65 17 65 23 67 29 Z', '#7fa9cf') +
            shape('M80 58 C87 61 94 61 99 57 C96 64 95 71 97 80 C91 74 86 68 80 66 Z', '#7fa9cf') +
            shaded(body, '#7fa9cf', flat('M8 71 C16 72 24 70 29 64 C36 54 46 48 58 48 C70 48 79 54 83 62 C80 54 72 46 60 46 C46 46 36 56 30 66 C26 72 18 74 11 73 C9.5 72.8 8.6 72 8 71 Z', '#e8f1f8') +
                flat('M30 38 C40 29 56 25 70 29 C58 28 44 32 32 42 Z', '#5d88b0')) +
            shape('M36 58 C33 66 29 72 22 76 C25 68 27 62 30 56 Z', '#5d88b0') +
            shine('M33 36 C40 30 48 28 56 28', 3) +
            eye(25, 55, 4.4) + blush(30, 62, 3.6) + line('M5 67.5 Q13 70 21 65', 2.6);
    })();

    ART[8] = (function () {           /* Shark: grey, cool, a toothy grin */
        const body = 'M4 56 C12 42 30 34 50 34 C66 34 80 40 86 50 C88 54 88 58 86 62 C78 70 64 74 48 74 C28 74 12 68 4 56 Z';
        return shape('M44 36 C50 23 58 15 68 11 C66 21 64 29 66 38 Z', '#8f9bab') +
            shape('M83 51 L98 34 C96 46 96 59 98 72 L85 62 Z', '#8f9bab') +
            shaded(body, '#8f9bab', flat('M6 59 C18 66 40 72 66 69 C58 73 53 74 48 74 C28 74 14 68 6 59 Z', '#f3f5f7') +
                flat('M18 42 C32 35 62 33 82 45 C66 39 40 38 18 46 Z', '#6f7b8b')) +
            line('M43 46 Q40 52 43 58 M49 46 Q46 52 49 58 M55 46 Q52 52 55 58', 2.6) +
            shape('M40 66 C38 76 32 84 24 88 C28 78 30 70 32 64 Z', '#6f7b8b') +
            shape('M8 57 C15 64 27 66 35 59 C27 61 17 61 8 57 Z', WHITE, ' stroke-width="2.6"') +
            '<path d="M14 59.3 L16.5 63.5 L19 60.2 Z M22 60.6 L24.5 64.6 L27 60.5 Z" fill="' + INK + '" stroke="none" opacity="0.85"/>' +
            shine('M26 40 C34 37 42 36 50 36', 3) +
            eye(23, 48, 4.5) + line('M16 41.5 L29 43.5', 3.2);
    })();

    ART[9] = (function () {           /* Orca: black and white, tall fin */
        const body = 'M6 58 C8 44 24 36 44 36 C62 36 76 42 84 50 C86 54 86 58 84 62 C74 72 56 76 38 74 C20 72 8 68 6 58 Z';
        return shape('M49 38 C51 25 55 13 62 6 C63 18 64 28 68 40 Z', '#2f2c36') +
            shape('M81 51 L97 40 C95 50 95 58 98 70 L83 62 Z', '#2f2c36') +
            shaded(body, '#2f2c36', flat('M9 63 C20 70 42 74 62 70 C53 75 45 75 38 74 C22 73 12 69 9 63 Z', '#f7f7f2') +
                '<ellipse cx="33" cy="47" rx="8.5" ry="4.2" transform="rotate(-12 33 47)" fill="#f7f7f2" stroke="none"/>' +
                flat('M55 39 C62 40 68 43 73 47 C66 46 60 45 53 44 Z', '#9aa0a6')) +
            shape('M34 66 C32 76 26 84 18 86 C20 76 24 68 28 64 Z', '#2f2c36') +
            line('M22 41 C29 38.5 36 37.5 43 37.5', 3, '#6a6672') +
            '<circle cx="21" cy="52" r="4.6" fill="#f7f7f2" stroke="none"/>' + eye(21, 52, 3.2) +
            line('M8 60.5 Q14 63.5 21 61.5', 2.4, '#f7f7f2');
    })();

    /* the whales: our own pfp whale (images/pfp), on a 200 box, halved */
    function whale(o) {
        const body = 'M22 132 C22 92 58 70 100 72 C142 74 160 104 156 134 C152 166 120 180 84 178 C48 176 22 160 22 132 Z';
        let s = '<g transform="translate(-4 4) scale(0.5)" stroke-width="7.5">' +
            shape('M146 128 C166 120 172 98 186 86 C182 108 194 118 198 112 C192 136 170 148 148 146 Z', o.body) +
            flat(body, o.body) +
            flat('M30 146 C52 166 112 170 150 148 C140 170 112 180 84 178 C58 176 38 166 30 146 Z', o.belly) +
            flat('M128 84 C150 96 160 118 156 136 C150 124 138 104 120 90 Z', o.shade) +
            line(body, 7.5) +
            line('M30 146 C52 166 112 170 150 148', 6) +
            (o.speckles || '') +
            shape('M96 150 C102 164 116 170 126 168 C120 158 112 150 96 150 Z', o.body, ' stroke-width="6"') +
            line('M44 132 Q62 146 84 136', 6) +
            '<circle cx="68" cy="112" r="9" fill="' + INK + '" stroke="none"/><circle cx="71" cy="108.6" r="3.2" fill="#fff" stroke="none"/>' +
            '<circle cx="50" cy="124" r="7" fill="' + BLUSH + '" opacity="0.6" stroke="none"/>' +
            line('M48 84 C60 78 74 75 86 75', 6, '#ffffff').replace('/>', ' opacity="0.6"/>') +
            o.hat + '</g>';
        return s + (o.extra || '');
    }

    const TOP_HAT =
        '<rect x="70" y="64" width="64" height="11" rx="5" fill="' + INK + '" transform="rotate(-10 102 70)"/>' +
        '<rect x="82" y="26" width="38" height="42" rx="4" fill="' + INK + '" transform="rotate(-10 101 47)"/>' +
        '<rect x="83" y="54" width="36" height="8" fill="#f4b740" stroke="none" transform="rotate(-10 101 58)"/>';

    function crown(gold, deep, gem) {
        return '<g transform="rotate(-10 100 54)">' +
            '<path d="M68 76 L62 32 L84 52 L100 20 L116 52 L138 32 L132 76 Z" fill="' + gold + '"/>' +
            '<path d="M67 64 L133 64 L132 76 L68 76 Z" fill="' + deep + '" stroke-width="6"/>' +
            '<circle cx="62" cy="31" r="6" fill="' + gold + '" stroke-width="5"/>' +
            '<circle cx="100" cy="19" r="6.5" fill="' + gold + '" stroke-width="5"/>' +
            '<circle cx="138" cy="31" r="6" fill="' + gold + '" stroke-width="5"/>' +
            '<circle cx="100" cy="52" r="7" fill="' + gem + '" stroke-width="5"/>' +
            '<circle cx="80" cy="58" r="4.5" fill="#2bb3a3" stroke-width="4"/>' +
            '<circle cx="120" cy="58" r="4.5" fill="#2bb3a3" stroke-width="4"/>' +
            '<path d="M76 40 L80 50" stroke="#fff" stroke-width="5" opacity="0.7" fill="none"/>' +
            '</g>';
    }

    ART[10] = whale({ body: '#6f9fd8', belly: '#e3eefa', shade: '#4f7bb0', hat: TOP_HAT });

    ART[11] = whale({ body: '#3f6fbf', belly: '#dfe9fb', shade: '#2d559c', hat: crown('#ffd75e', '#e0a526', '#e0485a'),
        extra: sparkle(14, 20, 7) + sparkle(88, 14, 5) + sparkle(92, 88, 6) });

    ART[12] = whale({ body: '#f4b740', belly: '#fff0c4', shade: '#d18f1c', hat: crown('#fff3c2', '#f4b740', '#e0485a'),
        extra: sparkle(14, 20, 7, '#ffd75e') + sparkle(88, 14, 5, '#ffd75e') + sparkle(92, 88, 6, '#ffd75e') + sparkle(8, 84, 4, '#ffd75e') });

    ART[13] = whale({ body: '#7a5fd0', belly: '#c9bdf2', shade: '#5a43a8', hat: crown('#ffd75e', '#e0a526', '#2bb3a3'),
        speckles: '<g fill="#fff" stroke="none" opacity="0.9"><circle cx="70" cy="90" r="3"/><circle cx="118" cy="98" r="2.4"/><circle cx="96" cy="118" r="3.4"/><circle cx="136" cy="122" r="2.4"/><circle cx="110" cy="80" r="2"/><circle cx="168" cy="118" r="2"/></g>',
        extra: '<ellipse cx="48" cy="9" rx="17" ry="4.5" fill="none" stroke="#ffd75e" stroke-width="3.5"/>' +
            sparkle(12, 24, 6, '#ffd75e') + sparkle(90, 18, 5) + sparkle(92, 88, 6, '#ffd75e') + sparkle(8, 86, 4) +
            '<g fill="#fff" stroke="none"><circle cx="24" cy="10" r="1.6"/><circle cx="78" cy="30" r="1.4"/><circle cx="96" cy="60" r="1.6"/><circle cx="6" cy="58" r="1.4"/></g>' });

    /* ---------- the sprite ---------- */

    function markup(e) {
        return '<g stroke="' + INK + '" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">' + ART[idx(e)] + '</g>';
    }

    let added = false;
    function ensure() {
        if (added) return;
        added = true;
        let s = '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false">';
        for (let e = 1; e <= LAST; e++) s += '<symbol id="w2-c' + e + '" viewBox="0 0 100 100">' + markup(e) + '</symbol>';
        s += '</svg>';
        const holder = document.createElement('div');
        holder.innerHTML = s;                       /* our own constant markup, never user text */
        document.body.insertBefore(holder.firstChild, document.body.firstChild);
    }

    /* an <svg> showing creature e, sized by CSS */
    function icon(e, cls) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        if (cls) svg.setAttribute('class', cls);
        const use = document.createElementNS(NS, 'use');
        use.setAttribute('href', '#w2-c' + idx(e));
        svg.appendChild(use);
        return svg;
    }

    window.Whale2048Art = {
        CREATURES: CREATURES,
        LAST: LAST,
        nameOf: function (e) { return CREATURES[idx(e)].name; },
        tileOf: function (e) { return CREATURES[idx(e)].tile; },
        isDark: function (e) { return !!CREATURES[idx(e)].dark; },
        valueOf: function (e) { return Math.pow(2, e); },
        markup: markup,
        ensure: ensure,
        icon: icon
    };
})();
