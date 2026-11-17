/* ============================================================
   W2048Sound — Whale 2048's sound effects.

   Built on the arcade's shared kit (arcade-sound.js, which must load
   first): same quiet master volume and limiter as the Cigar Lounge,
   unlocked on the first tap or key, mute remembered in this browser.

   CREDITS / LICENSE: every sound here is synthesized with the Web
   Audio API (a filtered-noise swish for slides, rising sine
   "bloops" for merges, triangle-wave jingles). No recordings or
   sample packs, nothing third-party to license; original to this
   site and released as CC0.
   ============================================================ */

(function () {
    'use strict';

    window.W2048Sound = window.ArcadeSound.create({
        store: 'ssow-2048-muted',
        volume: 0.3,
        sounds: function (kit) {
            const tone = kit.tone;
            const noise = kit.noise;

            /* a bubble: a quick upward sine blip */
            function bubble(t, f, gain) {
                tone(t, f, 0.07, { to: f * 1.7, gain: gain || 0.08 });
            }

            return {
                /* the sea shifts: a short, soft water swish */
                slide: function (t) {
                    noise(t, 0.08, { f0: 1100, f1: 520, q: 0.8, gain: 0.15, attack: 0.012 });
                },
                /* nothing moved that way: a dull little bump */
                bump: function (t) {
                    tone(t, 150, 0.06, { to: 110, gain: 0.12 });
                },
                /* two creatures become one: a bloop that climbs with the creature */
                merge: function (t, level) {
                    const f = 300 * Math.pow(2, ((level || 1) - 1) / 6);
                    tone(t, f, 0.12, { to: f * 1.9, gain: 0.2 });
                    tone(t + 0.015, f * 2, 0.06, { gain: 0.05 });
                    bubble(t + 0.05, f * 3, 0.05);
                },
                /* a creature you haven't made this game: a sparkly arpeggio */
                creature: function (t) {
                    [659.25, 783.99, 1046.5, 1318.5].forEach(function (f, i) {
                        tone(t + i * 0.07, f, 0.22, { type: 'triangle', gain: 0.12 });
                    });
                    tone(t + 0.3, 2093, 0.45, { gain: 0.035 });
                    bubble(t + 0.05, 900, 0.05);
                    bubble(t + 0.16, 1300, 0.04);
                },
                /* the King Whale: a little fanfare */
                win: function (t) {
                    [523.25, 659.25, 783.99].forEach(function (f, i) { tone(t + i * 0.1, f, 0.18, { type: 'triangle', gain: 0.17 }); });
                    tone(t + 0.32, 1046.5, 0.7, { type: 'triangle', gain: 0.17 });
                    tone(t + 0.32, 659.25, 0.7, { type: 'triangle', gain: 0.09 });
                    tone(t + 0.32, 783.99, 0.7, { type: 'triangle', gain: 0.09 });
                    for (let i = 0; i < 6; i++) bubble(t + 0.4 + i * 0.07, 700 + i * 160, 0.05);
                },
                /* no more moves: down it goes, glug */
                over: function (t) {
                    [392, 349.23, 293.66].forEach(function (f, i) { tone(t + i * 0.2, f, 0.36, { type: 'triangle', gain: 0.14 }); });
                    tone(t + 0.6, 196, 0.6, { type: 'triangle', gain: 0.13 });
                    tone(t + 0.62, 140, 0.4, { to: 70, gain: 0.12 });
                }
            };
        }
    });
})();
