/* ============================================================
   LoungeSound — the Cigar Lounge's sound effects.

   CREDITS / LICENSE: every sound here is synthesized in this file
   with the Web Audio API (filtered noise for cards and slides,
   short sine partials for chips, plain tones for the pings and
   jingles). No recordings or sample packs are used, so there is
   nothing to download and nothing third-party to license; these
   sounds are original to this site, and released as CC0 like the
   rest of our own code-made assets.

   Gentle by design: everything runs through one quiet master gain
   and a limiter. Browsers keep audio locked until the player does
   something, so the context starts on the first click / tap / key.
   The mute choice is remembered in this browser.
   ============================================================ */

(function () {
    'use strict';

    const STORE = 'ssow-lounge-muted';
    const VOLUME = 0.3;

    let ctx = null;
    let master = null;
    let noiseBuf = null;
    let muted = false;
    try { muted = window.localStorage.getItem(STORE) === '1'; } catch (e) { /* fine */ }

    function ensure() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -14;
        limiter.ratio.value = 8;
        master = ctx.createGain();
        master.gain.value = muted ? 0 : VOLUME;
        master.connect(limiter);
        limiter.connect(ctx.destination);
        /* one second of white noise, reused by every card and slide sound */
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return ctx;
    }

    /* audio may only start after the player does something */
    function unlock() {
        const c = ensure();
        if (c && c.state !== 'running') c.resume().catch(function () { /* next time */ });
    }
    ['pointerdown', 'keydown', 'touchend'].forEach(function (ev) {
        window.addEventListener(ev, unlock, { passive: true });
    });

    function ready() { return ctx && ctx.state === 'running' && !muted; }

    /* ---------- building blocks ---------- */

    function env(g, t, attack, peak, decay) {
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(peak, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    }

    /* filtered noise: card swishes, slides, knocks */
    function noise(t, dur, o) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        const f = ctx.createBiquadFilter();
        f.type = o.type || 'bandpass';
        f.Q.value = o.q || 1;
        f.frequency.setValueAtTime(o.f0, t);
        if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + dur);
        const g = ctx.createGain();
        env(g, t, o.attack || 0.005, o.gain || 0.5, dur);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.05);
    }

    function tone(t, freq, dur, o) {
        o = o || {};
        const osc = ctx.createOscillator();
        osc.type = o.type || 'sine';
        osc.frequency.setValueAtTime(freq, t);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
        const g = ctx.createGain();
        env(g, t, o.attack || 0.004, o.gain || 0.3, dur);
        osc.connect(g); g.connect(master);
        osc.start(t);
        osc.stop(t + dur + 0.05);
    }

    /* one clay chip on another: two bright partials and a tick */
    function chip(t, pitch) {
        const p = (pitch || 1) * (0.94 + Math.random() * 0.12);
        tone(t, 2350 * p, 0.07, { gain: 0.16 });
        tone(t, 3720 * p, 0.05, { gain: 0.1 });
        noise(t, 0.02, { type: 'highpass', f0: 4000, gain: 0.18 });
    }

    /* ---------- the sounds ---------- */

    const SOUNDS = {
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

    function play(name, delay) {
        if (!ready() || !SOUNDS[name]) return;
        try { SOUNDS[name](ctx.currentTime + 0.01 + (delay || 0)); } catch (e) { /* never break the game for a sound */ }
    }

    function setMuted(m) {
        muted = !!m;
        try { window.localStorage.setItem(STORE, muted ? '1' : '0'); } catch (e) { /* fine */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.02);
        document.dispatchEvent(new CustomEvent('lounge:muted', { detail: muted }));
    }

    window.LoungeSound = {
        play: play,
        names: Object.keys(SOUNDS),
        isMuted: function () { return muted; },
        setMuted: setMuted,
        toggle: function () { unlock(); setMuted(!muted); return muted; }
    };
})();
