/* ============================================================
   LoungeSound — the Cigar Lounge's sound effects.

   Built on the arcade's shared kit (arcade-sound.js, which must load
   first): the audio setup, the quiet master volume and limiter, the
   unlock-on-first-click and the remembered mute all live there.
   This file is just the Lounge's sounds.

   CREDITS / LICENSE: every sound here is synthesized with the Web
   Audio API (filtered noise for cards and slides, short sine
   partials for chips, plain tones for the pings and jingles). No
   recordings or sample packs, nothing third-party to license;
   original to this site and released as CC0.
   ============================================================ */

(function () {
    'use strict';

    window.LoungeSound = window.ArcadeSound.create({
        store: 'ssow-lounge-muted',
        volume: 0.3,
        event: 'lounge:muted',
        sounds: function (kit) {
            const tone = kit.tone;
            const noise = kit.noise;

            /* one clay chip on another: two bright partials and a tick */
            function chip(t, pitch) {
                const p = (pitch || 1) * (0.94 + Math.random() * 0.12);
                tone(t, 2350 * p, 0.07, { gain: 0.16 });
                tone(t, 3720 * p, 0.05, { gain: 0.1 });
                noise(t, 0.02, { type: 'highpass', f0: 4000, gain: 0.18 });
            }

            return {
                /* cards */
                shuffle: function (t) {
                    for (let i = 0; i < 16; i++) noise(t + i * 0.032 + Math.random() * 0.01, 0.03, { f0: 3200, q: 0.8, gain: 0.22 });
                    noise(t + 0.56, 0.06, { type: 'lowpass', f0: 900, gain: 0.35 });          /* squared up */
                },
                deal: function (t) { noise(t, 0.09, { f0: 2600, f1: 1200, q: 0.9, gain: 0.32 }); },
                flip: function (t) {
                    noise(t, 0.045, { type: 'highpass', f0: 2800, gain: 0.3 });
                    tone(t + 0.01, 900, 0.03, { gain: 0.06 });
                },

                /* chips */
                bet: function (t) { chip(t); chip(t + 0.05, 1.04); },
                call: function (t) { chip(t); chip(t + 0.05, 0.97); },
                raise: function (t) { chip(t); chip(t + 0.045, 1.05); chip(t + 0.09, 0.98); chip(t + 0.14, 1.02); },
                allin: function (t) {
                    tone(t, 140, 0.35, { to: 70, gain: 0.25 });                                  /* the push */
                    noise(t, 0.3, { type: 'lowpass', f0: 1200, f1: 400, gain: 0.25 });
                    for (let i = 0; i < 9; i++) chip(t + 0.05 + i * 0.045 + Math.random() * 0.02, 0.92 + Math.random() * 0.16);
                },
                push: function (t) {                                                          /* pot slides to the winner */
                    noise(t, 0.35, { type: 'lowpass', f0: 1400, f1: 500, gain: 0.22, attack: 0.03 });
                    for (let i = 0; i < 6; i++) chip(t + 0.12 + i * 0.05, 0.95 + Math.random() * 0.1);
                },

                /* the table */
                check: function (t) {                                                         /* two knocks */
                    [0, 0.11].forEach(function (d) {
                        tone(t + d, 190, 0.07, { to: 85, gain: 0.32 });
                        noise(t + d, 0.04, { type: 'lowpass', f0: 700, gain: 0.25 });
                    });
                },
                fold: function (t) { noise(t, 0.24, { f0: 1700, f1: 500, q: 0.7, gain: 0.26, attack: 0.02 }); },

                /* you */
                turn: function (t) {                                                          /* a soft ping */
                    tone(t, 1046.5, 0.6, { gain: 0.13 });
                    tone(t, 1568, 0.45, { gain: 0.06 });
                },
                tick: function (t) { tone(t, 1750, 0.03, { type: 'square', gain: 0.045 }); },
                win: function (t) {
                    [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) { tone(t + i * 0.12, f, 0.3, { type: 'triangle', gain: 0.18 }); });
                    tone(t + 0.48, 1318.5, 0.6, { type: 'triangle', gain: 0.14 });
                    for (let i = 0; i < 6; i++) chip(t + 0.5 + i * 0.06, 1.1);
                },
                lose: function (t) {
                    [392, 311.13, 261.63].forEach(function (f, i) { tone(t + i * 0.22, f, 0.42, { type: 'triangle', gain: 0.15 }); });
                }
            };
        }
    });
})();
