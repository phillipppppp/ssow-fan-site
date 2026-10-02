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

    /* ---------------------------------------------------------
       Music: one looping chiptune per zone

       Each song is four bars of sixteenth-note steps. In a part,
       "." is a rest and "-" holds the previous note a step longer.
       A small look-ahead scheduler queues each step a tenth of a
       second early, which keeps the beat steady even when the page
       is busy drawing.
       --------------------------------------------------------- */

    const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function freq(name) {
        const m = /^([A-G])(#?)(\d)$/.exec(name);
        const midi = 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] ? 1 : 0);
        return 440 * Math.pow(2, (midi - 69) / 12);
    }

    function parse(text) {
        return text.trim().split(/\s+/);
    }

    /* chord tones rolled as sixteenths, for the arpeggio parts */
    function rolled(chords, pattern) {
        const out = [];
        chords.forEach(function (tones) {
            for (let i = 0; i < 16; i++) out.push(tones[pattern[i % pattern.length]]);
        });
        return out;
    }

    const SONGS = {
        /* sunny and bouncy: C major, I-V-vi-IV */
        harbour: {
            bpm: 120,
            lead: { wave: 'square', vol: 0.075, notes: parse(
                'E5 . G5 . A5 . G5 . E5 . D5 . C5 - - . ' +
                'D5 . G5 . A5 . G5 . D5 - - . E5 . D5 . ' +
                'C5 . E5 . A5 - - . G5 . E5 . C5 . D5 . ' +
                'C5 . A4 . C5 . D5 . E5 - - . D5 - - .') },
            bass: { wave: 'triangle', vol: 0.22, notes: parse(
                'C3 . . . G2 . . . C3 . . . G2 . C3 . ' +
                'G2 . . . D3 . . . G2 . . . D3 . G2 . ' +
                'A2 . . . E3 . . . A2 . . . E3 . A2 . ' +
                'F2 . . . C3 . . . F2 . . . C3 . F2 .') },
            arp: { wave: 'triangle', vol: 0.04, notes: rolled(
                [['C4', 'E4', 'G4'], ['G3', 'B3', 'D4'], ['A3', 'C4', 'E4'], ['F3', 'A3', 'C4']], [0, 1, 2, 1]) },
            drums: 'k.h.s.h.k.h.s.hh'
        },
        /* dreamy and flowing: D major sevenths, rolling like swell */
        sea: {
            bpm: 96,
            lead: { wave: 'sine', vol: 0.09, vibrato: 5, notes: parse(
                'F#5 - - - A5 - - - E5 - - - D5 - - - ' +
                'D5 - - - F#5 - - - B4 - - - A4 - - - ' +
                'G5 - - - F#5 - - - D5 - - - B4 - - - ' +
                'A4 - - - C#5 - - - E5 - - - A5 - - -') },
            bass: { wave: 'triangle', vol: 0.15, notes: parse(
                'D2 - - - - - - - A2 - - - - - - - ' +
                'B1 - - - - - - - F#2 - - - - - - - ' +
                'G1 - - - - - - - D2 - - - - - - - ' +
                'A1 - - - - - - - E2 - - - - - - -') },
            arp: { wave: 'triangle', vol: 0.03, notes: rolled(
                [['D4', 'F#4', 'A4', 'C#5'], ['B3', 'D4', 'F#4', 'A4'], ['G3', 'B3', 'D4', 'F#4'], ['A3', 'C#4', 'E4', 'A4']],
                [0, 1, 2, 3, 2, 1]) },
            drums: '..h...h...h...h.'
        },
        /* cold and sparse: A minor, bells with an echo */
        arctic: {
            bpm: 84,
            echo: true,
            lead: { wave: 'sine', vol: 0.1, notes: parse(
                'E5 - . . A5 - . . C6 - . . B5 - . . ' +
                'A5 - - - - - . . E5 - . . F5 - . . ' +
                'G5 - . . E5 - . . C5 - . . D5 - . . ' +
                'E5 - - - - - . . B4 - - - - - . .') },
            bass: { wave: 'triangle', vol: 0.14, notes: parse(
                'A1 - - - - - - - - - - - - - - - ' +
                'F1 - - - - - - - - - - - - - - - ' +
                'C2 - - - - - - - - - - - - - - - ' +
                'E1 - - - - - - - - - - - - - - -') },
            arp: { wave: 'triangle', vol: 0.02, notes: rolled(
                [['A3', 'E4', 'C5'], ['F3', 'C4', 'A4'], ['C4', 'G4', 'E5'], ['E3', 'B3', 'G4']], [0, 1, 2, 1, 0, 2, 1, 2]) },
            drums: '........t.......'
        }
    };

    let musicOff = false;
    try { musicOff = window.localStorage.getItem('ssow-road-music-off') === '1'; } catch (err) { /* fine */ }

    let musicBus = null;      /* every song plays into this; pausing ramps it */
    let song = null;          /* { zone, gain, echo, step, next } */
    let scheduler = null;

    function note(dest, part, name, t, len, songDef) {
        const c = dest.context;
        const osc = c.createOscillator();
        const env = c.createGain();
        osc.type = part.wave;
        osc.frequency.value = freq(name);
        if (part.vibrato) {
            const lfo = c.createOscillator();
            const depth = c.createGain();
            lfo.frequency.value = part.vibrato;
            depth.gain.value = osc.frequency.value * 0.012;
            lfo.connect(depth);
            depth.connect(osc.frequency);
            lfo.start(t);
            lfo.stop(t + len + 0.05);
        }
        env.gain.setValueAtTime(0.0001, t);
        env.gain.exponentialRampToValueAtTime(part.vol, t + 0.015);
        env.gain.setValueAtTime(part.vol, t + Math.max(0.02, len * 0.6));
        env.gain.exponentialRampToValueAtTime(0.0001, t + len);
        osc.connect(env);
        env.connect(dest);
        osc.start(t);
        osc.stop(t + len + 0.05);
    }

    function drum(dest, kind, t) {
        const c = dest.context;
        if (kind === 'k') {
            const osc = c.createOscillator();
            const env = c.createGain();
            osc.frequency.setValueAtTime(150, t);
            osc.frequency.exponentialRampToValueAtTime(45, t + 0.12);
            env.gain.setValueAtTime(0.22, t);
            env.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
            osc.connect(env);
            env.connect(dest);
            osc.start(t);
            osc.stop(t + 0.16);
            return;
        }
        const src = c.createBufferSource();
        src.buffer = noiseFor(c);
        const filter = c.createBiquadFilter();
        filter.type = kind === 's' ? 'bandpass' : 'highpass';
        filter.frequency.value = kind === 's' ? 1800 : kind === 't' ? 6000 : 7000;
        const env = c.createGain();
        const vol = kind === 's' ? 0.12 : kind === 't' ? 0.03 : 0.04;
        const len = kind === 's' ? 0.12 : 0.04;
        env.gain.setValueAtTime(vol, t);
        env.gain.exponentialRampToValueAtTime(0.0001, t + len);
        src.connect(filter);
        filter.connect(env);
        env.connect(dest);
        src.start(t);
        src.stop(t + len + 0.02);
    }

    const noiseCache = new WeakMap();
    function noiseFor(c) {
        if (c === ctx && noise) return noise;
        let buf = noiseCache.get(c);
        if (!buf) {
            buf = c.createBuffer(1, c.sampleRate, c.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            noiseCache.set(c, buf);
        }
        return buf;
    }

    /* The song's own output: its level, plus an echo for the Arctic. */
    function songOutput(c, songDef, dest) {
        const gain = c.createGain();
        gain.connect(dest);
        let lead = gain;
        if (songDef.echo) {
            const delay = c.createDelay(1);
            const feedback = c.createGain();
            delay.delayTime.value = (60 / songDef.bpm) * 0.75;
            feedback.gain.value = 0.35;
            lead = c.createGain();
            lead.connect(gain);
            lead.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);
            delay.connect(gain);
        }
        return { gain: gain, lead: lead };
    }

    /* Queue one sixteenth-note step of a song at time t. */
    function playStep(songDef, out, step, t) {
        const stepLen = 60 / songDef.bpm / 4;
        ['lead', 'bass', 'arp'].forEach(function (name) {
            const part = songDef[name];
            const n = part.notes[step % part.notes.length];
            if (!n || n === '.' || n === '-') return;
            let hold = 1;
            while (part.notes[(step + hold) % part.notes.length] === '-' && hold < 16) hold++;
            note(name === 'lead' ? out.lead : out.gain, part, n, t, hold * stepLen * 0.95, songDef);
        });
        const d = songDef.drums[step % 16];
        if (d !== '.') drum(out.gain, d, t);
    }

    function tickMusic() {
        if (!song || !ctx) return;
        const def = SONGS[song.zone];
        const stepLen = 60 / def.bpm / 4;
        while (song.next < ctx.currentTime + 0.12) {
            playStep(def, song.out, song.step, song.next);
            song.step = (song.step + 1) % 64;
            song.next += stepLen;
        }
    }

    /* Crossfade to a zone's song (null fades the music out). */
    function music(zone) {
        if (!ctx) return;
        if (!musicBus) {
            musicBus = ctx.createGain();
            musicBus.gain.value = 1;
            musicBus.connect(master);
        }
        const wanted = musicOff ? null : zone;
        if (song && song.zone === wanted) return;
        const now = ctx.currentTime;
        if (song) {
            const old = song.out.gain;
            old.gain.setTargetAtTime(0, now, 0.35);
            setTimeout(function () { try { old.disconnect(); } catch (err) { /* gone */ } }, 2500);
            song = null;
        }
        if (!wanted || !SONGS[wanted]) {
            clearInterval(scheduler);
            scheduler = null;
            return;
        }
        const out = songOutput(ctx, SONGS[wanted], musicBus);
        out.gain.gain.setValueAtTime(0.0001, now);
        out.gain.gain.exponentialRampToValueAtTime(1, now + 1.2);
        song = { zone: wanted, out: out, step: 0, next: now + 0.05 };
        if (!scheduler) scheduler = setInterval(tickMusic, 25);
        tickMusic();
    }

    function pauseMusic(paused) {
        if (!musicBus) return;
        musicBus.gain.setTargetAtTime(paused ? 0 : 1, ctx.currentTime, 0.08);
    }

    /* For tests: render a few seconds of a song offline and measure it. */
    async function renderSong(zone, seconds) {
        const def = SONGS[zone];
        const c = new OfflineAudioContext(1, 44100 * seconds, 44100);
        const out = songOutput(c, def, c.destination);
        const stepLen = 60 / def.bpm / 4;
        for (let t = 0, step = 0; t < seconds; t += stepLen, step = (step + 1) % 64) playStep(def, out, step, t);
        const buf = await c.startRendering();
        const d = buf.getChannelData(0);
        let peak = 0;
        let sum = 0;
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
        return { peak: peak, rms: Math.sqrt(sum / d.length) };
    }

    window.WhaleAudio = {
        unlock: unlock,
        music: music,
        pauseMusic: pauseMusic,
        renderSong: renderSong,
        currentSong: function () { return song ? song.zone : null; },
        isMusicOff: function () { return musicOff; },
        setMusicOff: function (value) {
            musicOff = !!value;
            try { window.localStorage.setItem('ssow-road-music-off', musicOff ? '1' : '0'); } catch (err) { /* fine */ }
            if (musicOff) music(null);
        },
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
