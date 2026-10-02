/* ============================================================
   WhaleAudio — Whale Road's sound, synthesised on the spot.

   Every effect is built from oscillators and a little noise with the
   Web Audio API, like an old console: no sound files to download, no
   licences to worry about, and a chiptune feel that suits the pixel
   art. Purely cosmetic — nothing here can touch the simulation, so it
   can't change a score or a replay.

   Browsers only allow audio after a click or key press, so the
   context is created lazily by unlock(). Muting is remembered.
   ============================================================ */

(function () {
    'use strict';

    const STORE = 'ssow-road-muted';
    let ctx = null;
    let master = null;
    let noise = null;
    let muted = false;
    try { muted = window.localStorage.getItem(STORE) === '1'; } catch (err) { /* fine */ }

    function unlock() {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!ctx) {
            ctx = new AC();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : 0.45;
            master.connect(ctx.destination);

            /* one second of white noise, reused by every splash and crash */
            noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const data = noise.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        if (ctx.state === 'suspended') ctx.resume();
    }

    function ready() { return ctx && !muted && ctx.state === 'running'; }

    /* A single note: wave, pitch (optionally sliding), length, loudness. */
    function tone(opts) {
        const t0 = ctx.currentTime + (opts.delay || 0);
        const osc = ctx.createOscillator();
        const env = ctx.createGain();
        osc.type = opts.wave || 'square';
        osc.frequency.setValueAtTime(opts.from, t0);
        if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.len);
        if (opts.vibrato) {
            const lfo = ctx.createOscillator();
            const depth = ctx.createGain();
            lfo.frequency.value = opts.vibrato;
            depth.gain.value = opts.from * 0.06;
            lfo.connect(depth).connect(osc.frequency);
            lfo.start(t0);
            lfo.stop(t0 + opts.len + 0.02);
        }
        const peak = opts.vol || 0.15;
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(peak, t0 + Math.min(0.01, opts.len / 4));
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.len);
        osc.connect(env).connect(master);
        osc.start(t0);
        osc.stop(t0 + opts.len + 0.02);
    }

    /* A burst of filtered noise: splashes, crunches, whooshes. */
    function hiss(opts) {
        const t0 = ctx.currentTime + (opts.delay || 0);
        const src = ctx.createBufferSource();
        src.buffer = noise;
        const filter = ctx.createBiquadFilter();
        filter.type = opts.filter || 'lowpass';
        filter.frequency.setValueAtTime(opts.from, t0);
        if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, t0 + opts.len);
        filter.Q.value = opts.q || 1;
        const env = ctx.createGain();
        env.gain.setValueAtTime(opts.vol || 0.2, t0);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.len);
        src.connect(filter).connect(env).connect(master);
        src.start(t0, Math.random() * 0.5);
        src.stop(t0 + opts.len + 0.02);
    }

    function jitter(f) { return f * (0.96 + Math.random() * 0.08); }

    const SOUNDS = {
        hop: function () {
            tone({ from: jitter(330), to: jitter(560), len: 0.07, vol: 0.09 });
        },
        coin: function () {
            tone({ from: 988, len: 0.07, vol: 0.12 });
            tone({ from: 1319, len: 0.16, vol: 0.12, delay: 0.07 });
        },
        bump: function () {
            tone({ wave: 'triangle', from: 150, to: 90, len: 0.08, vol: 0.2 });
        },
        crash: function () {
            hiss({ from: 1800, to: 200, len: 0.32, vol: 0.35 });
            tone({ from: 110, to: 45, len: 0.3, vol: 0.22 });
        },
        splash: function () {
            hiss({ filter: 'bandpass', from: 1400, to: 300, len: 0.45, vol: 0.32, q: 0.8 });
            tone({ wave: 'sine', from: 600, to: 1100, len: 0.06, vol: 0.08, delay: 0.18 });
            tone({ wave: 'sine', from: 500, to: 950, len: 0.06, vol: 0.07, delay: 0.3 });
        },
        seagull: function () {
            tone({ wave: 'sawtooth', from: 1100, to: 1500, len: 0.13, vol: 0.07, vibrato: 30 });
            tone({ wave: 'sawtooth', from: 1250, to: 800, len: 0.2, vol: 0.07, vibrato: 30, delay: 0.16 });
        },
        shield: function () {
            tone({ wave: 'sine', from: 420, to: 1300, len: 0.12, vol: 0.16 });
            hiss({ filter: 'highpass', from: 3000, len: 0.06, vol: 0.08, delay: 0.1 });
        },
        dash: function () {
            hiss({ filter: 'bandpass', from: 400, to: 4000, len: 0.35, vol: 0.22, q: 2 });
            [523, 659, 784, 1047].forEach(function (f, i) {
                tone({ from: f, len: 0.06, vol: 0.08, delay: 0.04 * i });
            });
        },
        trapped: function () {
            tone({ wave: 'triangle', from: 200, to: 140, len: 0.3, vol: 0.18, vibrato: 12 });
        },
        freed: function () {
            tone({ wave: 'triangle', from: 260, to: 420, len: 0.1, vol: 0.12 });
        },
        tram: function () {
            for (let i = 0; i < 3; i++) {
                tone({ wave: 'sine', from: 1568, len: 0.22, vol: 0.06, delay: i * 0.3 });
                tone({ wave: 'sine', from: 2349, len: 0.16, vol: 0.03, delay: i * 0.3 });
            }
        },
        shark: function () {
            tone({ wave: 'triangle', from: 82, len: 0.25, vol: 0.3 });
            tone({ wave: 'triangle', from: 87, len: 0.25, vol: 0.3, delay: 0.32 });
        },
        orca: function () {
            tone({ wave: 'sine', from: 900, to: 1700, len: 0.35, vol: 0.07, vibrato: 7 });
        },
        zone: function () {
            [523, 659, 784, 1047].forEach(function (f, i) {
                tone({ from: f, len: i === 3 ? 0.3 : 0.1, vol: 0.1, delay: 0.1 * i });
            });
        },
        start: function () {
            tone({ from: 523, len: 0.07, vol: 0.09 });
            tone({ from: 784, len: 0.12, vol: 0.09, delay: 0.08 });
        },
        over: function () {
            [392, 330, 262].forEach(function (f, i) {
                tone({ wave: 'triangle', from: f, len: i === 2 ? 0.4 : 0.14, vol: 0.18, delay: 0.16 * i });
            });
        },
        best: function () {
            [523, 659, 784, 1047, 1319].forEach(function (f, i) {
                tone({ from: f, len: i === 4 ? 0.35 : 0.09, vol: 0.1, delay: 0.09 * i });
            });
        },
        buy: function () {
            tone({ from: 1047, len: 0.06, vol: 0.1 });
            tone({ from: 1568, len: 0.14, vol: 0.1, delay: 0.06 });
        }
    };

    window.WhaleAudio = {
        unlock: unlock,
        play: function (name) {
            if (!ready() || !SOUNDS[name]) return;
            try { SOUNDS[name](); } catch (err) { /* a missed beep is never worth an error */ }
        },
        isMuted: function () { return muted; },
        setMuted: function (value) {
            muted = !!value;
            try { window.localStorage.setItem(STORE, muted ? '1' : '0'); } catch (err) { /* fine */ }
            if (master) master.gain.setTargetAtTime(muted ? 0 : 0.45, ctx.currentTime, 0.02);
        }
    };
})();
