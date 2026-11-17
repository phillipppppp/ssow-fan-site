/* ============================================================
   ArcadeSound — the minigames' shared sound kit.

   CREDITS / LICENSE: every sound in the arcade is synthesized
   with the Web Audio API (filtered noise for swishes and slides,
   short sine and triangle tones for pings, bloops and jingles).
   No recordings or sample packs are used, so there is nothing to
   download and nothing third-party to license; these sounds are
   original to this site, and released as CC0 like the rest of our
   own code-made assets.

   Each game makes its own set:

       window.LoungeSound = ArcadeSound.create({
           store: 'ssow-lounge-muted',          // where "muted" is remembered
           sounds: function (kit) { return { name: function (t, arg) { ... } }; }
       });

   and gets back { play(name, delay, arg), names, isMuted,
   setMuted, toggle }. A sound gets the start time t and builds
   itself from the kit: tone(t, freq, dur, opts) and
   noise(t, dur, opts).

   Gentle by design: everything runs through one quiet master gain
   and a limiter. Browsers keep audio locked until the player does
   something, so the context starts on the first click / tap / key.
   ============================================================ */

(function () {
    'use strict';

    function create(opts) {
        const STORE = opts.store;
        const VOLUME = opts.volume || 0.3;

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
            /* one second of white noise, reused by every swish */
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

        /* filtered noise: swishes, slides, knocks */
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

        const SOUNDS = opts.sounds({ tone: tone, noise: noise });

        function play(name, delay, arg) {
            if (!ready() || !SOUNDS[name]) return;
            try { SOUNDS[name](ctx.currentTime + 0.01 + (delay || 0), arg); } catch (e) { /* never break the game for a sound */ }
        }

        function setMuted(m) {
            muted = !!m;
            try { window.localStorage.setItem(STORE, muted ? '1' : '0'); } catch (e) { /* fine */ }
            if (master) master.gain.setTargetAtTime(muted ? 0 : VOLUME, ctx.currentTime, 0.02);
            if (opts.event) document.dispatchEvent(new CustomEvent(opts.event, { detail: muted }));
        }

        return {
            play: play,
            names: Object.keys(SOUNDS),
            isMuted: function () { return muted; },
            setMuted: setMuted,
            toggle: function () { unlock(); setMuted(!muted); return muted; }
        };
    }

    window.ArcadeSound = { create: create };
})();
