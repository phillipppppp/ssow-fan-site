/* ============================================================
   Orca Race sounds — built on the arcade's shared kit
   (arcade-sound.js): all synthesized with Web Audio, no files.

   beep     countdown 3-2-1
   horn     GO! (a chunky two-tone air horn)
   splash   a speed burst kicks up water
   whoosh   slow motion kicks in for a close finish
   finish   a racer touches the line
   cheer    the crowd at the finish (filtered noise + a fanfare)
   ============================================================ */

(function () {
    'use strict';
    if (!window.ArcadeSound) return;

    window.OrcaSound = window.ArcadeSound.create({
        store: 'ssow-orca-race-muted',
        volume: 0.32,
        sounds: function (kit) {
            return {
                beep: function (t) {
                    kit.tone(t, 660, 0.16, { type: 'square', gain: 0.18 });
                },
                horn: function (t) {
                    kit.tone(t, 330, 0.75, { type: 'sawtooth', gain: 0.16, attack: 0.02 });
                    kit.tone(t, 415, 0.75, { type: 'sawtooth', gain: 0.12, attack: 0.02 });
                    kit.tone(t, 990, 0.25, { type: 'square', gain: 0.08 });
                },
                splash: function (t, strength) {
                    const s = Math.max(0.3, Math.min(1, strength || 0.6));
                    kit.noise(t, 0.28, { type: 'bandpass', f0: 2400, f1: 500, q: 0.8, gain: 0.3 * s });
                    kit.noise(t + 0.03, 0.18, { type: 'highpass', f0: 3500, q: 0.5, gain: 0.12 * s });
                },
                whoosh: function (t) {
                    kit.noise(t, 0.9, { type: 'bandpass', f0: 300, f1: 1800, q: 1.4, gain: 0.35, attack: 0.25 });
                    kit.tone(t, 220, 0.9, { type: 'sine', to: 110, gain: 0.15, attack: 0.1 });
                },
                finish: function (t) {
                    kit.tone(t, 1046, 0.18, { type: 'triangle', gain: 0.18 });
                    kit.tone(t + 0.07, 1568, 0.22, { type: 'triangle', gain: 0.14 });
                },
                cheer: function (t) {
                    /* a crowd: a few overlapping noise swells */
                    kit.noise(t, 1.8, { type: 'bandpass', f0: 900, f1: 1400, q: 0.6, gain: 0.35, attack: 0.15 });
                    kit.noise(t + 0.2, 1.5, { type: 'bandpass', f0: 1800, f1: 1100, q: 0.7, gain: 0.25, attack: 0.1 });
                    kit.noise(t + 0.5, 1.2, { type: 'bandpass', f0: 600, f1: 900, q: 0.5, gain: 0.25, attack: 0.1 });
                    /* and a fanfare */
                    [523, 659, 784, 1046].forEach(function (f, i) {
                        kit.tone(t + i * 0.12, f, i === 3 ? 0.6 : 0.16, { type: 'triangle', gain: 0.2 });
                    });
                }
            };
        }
    });
})();
