/* ============================================================
   StrokeText — vanilla port of the React Bits component.
   Draws each letter's outline, then fills it with a wipe.

   Usage:  <h1 data-stroke-text>Secret Society of Whales</h1>

   Progressive enhancement: the heading is plain styled text until
   this script runs, so it still reads correctly if JS or the GSAP
   CDN fails. Options come from data-* attributes; colours default
   to the page's --accent so it stays on theme.
   ============================================================ */

(function () {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';

    const DEFAULTS = {
        strokeWidth: 1.4,
        drawDuration: 1.6,
        fillDelay: 0.2,
        stagger: 0.05,
        ease: 'power2.out',
        trigger: 'mount',      // mount | hover | loop
        fillMode: 'wipe',      // wipe | fade | none
        fontSize: 128,
        fontWeight: 800,
        letterSpacing: -4,
        reverse: false
    };

    let uid = 0;

    function num(value, fallback) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function readOptions(el) {
        const d = el.dataset;
        const cs = getComputedStyle(el);
        const accent = cs.getPropertyValue('--accent').trim() || cs.color;

        return {
            text: (d.strokeTextValue || el.textContent || '').trim(),
            fontFamily: cs.fontFamily,
            strokeColor: d.strokeColor || accent,
            fillColor: d.fillColor || accent,
            strokeWidth: num(d.strokeWidth, DEFAULTS.strokeWidth),
            drawDuration: num(d.drawDuration, DEFAULTS.drawDuration),
            fillDelay: num(d.fillDelay, DEFAULTS.fillDelay),
            stagger: num(d.stagger, DEFAULTS.stagger),
            ease: d.ease || DEFAULTS.ease,
            trigger: d.strokeTrigger || DEFAULTS.trigger,
            fillMode: d.fillMode || DEFAULTS.fillMode,
            fontSize: num(d.fontSize, DEFAULTS.fontSize),
            fontWeight: num(d.fontWeight, DEFAULTS.fontWeight),
            letterSpacing: num(d.letterSpacing, DEFAULTS.letterSpacing),
            reverse: d.reverse === 'true'
        };
    }

    /* Build one <text> made of per-character <tspan>s so each glyph
       can be staggered independently. */
    function buildText(chars, opts, className) {
        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('class', className);
        text.setAttribute('x', '0');
        text.setAttribute('y', '0');
        /* without this, SVG collapses the space-only tspans and the
           title renders as "SecretSocietyofWhales" */
        text.setAttribute('xml:space', 'preserve');
        text.style.fontFamily = opts.fontFamily;
        text.style.fontSize = opts.fontSize + 'px';
        text.style.fontWeight = opts.fontWeight;
        text.style.letterSpacing = opts.letterSpacing + 'px';

        chars.forEach(char => {
            const tspan = document.createElementNS(SVG_NS, 'tspan');
            tspan.textContent = char;
            text.appendChild(tspan);
        });

        return text;
    }

    function render(el) {
        const opts = readOptions(el);
        if (!opts.text) return;

        const chars = Array.from(opts.text);
        const id = 'stroke-text-wipe-' + (uid++);
        const useWipe = opts.fillMode === 'wipe';

        const wrap = document.createElement('span');
        wrap.className = 'stroke-text' + (opts.trigger === 'hover' ? ' stroke-text--hover' : '');
        wrap.setAttribute('role', 'img');
        wrap.setAttribute('aria-label', opts.text);

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'stroke-text__svg');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('aria-hidden', 'true');

        /* wipe clip */
        let wipeRect = null;
        if (useWipe) {
            const defs = document.createElementNS(SVG_NS, 'defs');
            const clip = document.createElementNS(SVG_NS, 'clipPath');
            clip.setAttribute('id', id);
            clip.setAttribute('clipPathUnits', 'userSpaceOnUse');
            wipeRect = document.createElementNS(SVG_NS, 'rect');
            wipeRect.setAttribute('width', '0');
            clip.appendChild(wipeRect);
            defs.appendChild(clip);
            svg.appendChild(defs);
        }

        const strokeText = buildText(chars, opts, 'stroke-text__stroke');
        strokeText.setAttribute('fill', 'none');
        strokeText.setAttribute('stroke', opts.strokeColor);
        strokeText.setAttribute('stroke-width', opts.strokeWidth);
        strokeText.setAttribute('stroke-linejoin', 'round');
        strokeText.setAttribute('stroke-linecap', 'round');

        const fillText = buildText(chars, opts, 'stroke-text__fill');
        fillText.setAttribute('fill', opts.fillColor);
        fillText.setAttribute('stroke', 'none');
        if (useWipe) fillText.setAttribute('clip-path', 'url(#' + id + ')');

        svg.appendChild(strokeText);
        svg.appendChild(fillText);
        wrap.appendChild(svg);

        el.textContent = '';
        el.appendChild(wrap);

        /* Measure only once the real font is loaded — measuring against
           the fallback font gives a wrong viewBox and the title jumps. */
        const measureAndAnimate = () => {
            let bbox;
            try {
                bbox = strokeText.getBBox();
            } catch (err) {
                return;
            }
            if (!bbox || !bbox.width) return;

            const pad = Math.max(opts.strokeWidth, opts.fontSize * 0.1);
            const box = {
                x: bbox.x - pad,
                y: bbox.y - pad,
                width: bbox.width + pad * 2,
                height: bbox.height + pad * 2
            };

            svg.setAttribute('viewBox', box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height);

            if (wipeRect) {
                wipeRect.setAttribute('x', box.x);
                wipeRect.setAttribute('y', box.y);
                wipeRect.setAttribute('height', box.height);
            }

            animate(wrap, strokeText, fillText, wipeRect, box, opts);
        };

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(measureAndAnimate).catch(measureAndAnimate);
        } else {
            measureAndAnimate();
        }
    }

    function animate(root, strokeText, fillText, wipeRect, box, opts) {
        const strokes = Array.from(strokeText.querySelectorAll('tspan'));
        const fills = Array.from(fillText.querySelectorAll('tspan'));
        if (!strokes.length) return;

        const dash = Math.max(opts.fontSize * 7, 200);
        const fillEnabled = opts.fillMode !== 'none';
        const useWipe = fillEnabled && opts.fillMode === 'wipe';
        const fillDuration = Math.max(0.4, opts.drawDuration * 0.5);

        /* No GSAP (offline, CDN blocked)? Show the finished state. */
        if (typeof window.gsap === 'undefined') {
            strokes.forEach(s => { s.style.strokeDasharray = dash; s.style.strokeDashoffset = 0; });
            fills.forEach(f => { f.style.opacity = fillEnabled ? 1 : 0; });
            if (wipeRect) wipeRect.setAttribute('width', fillEnabled ? box.width : 0);
            return;
        }

        const gsap = window.gsap;
        const staggerConfig = opts.reverse ? { each: opts.stagger, from: 'end' } : opts.stagger;
        const targets = strokes.concat(fills, wipeRect ? [wipeRect] : []);

        const setStart = () => {
            gsap.killTweensOf(targets);
            gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: dash });
            gsap.set(fills, { opacity: useWipe ? 1 : 0 });
            if (wipeRect) gsap.set(wipeRect, { attr: { width: 0 } });
        };

        const setEnd = () => {
            gsap.killTweensOf(targets);
            gsap.set(strokes, { strokeDasharray: dash, strokeDashoffset: 0 });
            gsap.set(fills, { opacity: fillEnabled ? 1 : 0 });
            if (wipeRect) gsap.set(wipeRect, { attr: { width: fillEnabled ? box.width : 0 } });
        };

        const reduced = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced) {
            setEnd();
            return;
        }

        const build = () => {
            setStart();
            const tl = gsap.timeline({
                paused: true,
                repeat: opts.trigger === 'loop' ? -1 : 0,
                repeatDelay: opts.trigger === 'loop' ? 0.9 : 0,
                defaults: { overwrite: 'auto' }
            });

            tl.to(strokes, {
                strokeDashoffset: 0,
                duration: opts.drawDuration,
                ease: opts.ease,
                stagger: staggerConfig
            }, 0);

            if (useWipe && wipeRect) {
                tl.to(wipeRect, {
                    attr: { width: box.width },
                    duration: fillDuration,
                    ease: 'power2.inOut'
                }, opts.drawDuration + opts.fillDelay);
            } else if (fillEnabled) {
                tl.to(fills, {
                    opacity: 1,
                    duration: fillDuration,
                    ease: 'power2.out',
                    stagger: staggerConfig
                }, opts.drawDuration + opts.fillDelay);
            }

            return tl;
        };

        let timeline = null;

        if (opts.trigger === 'hover') {
            setEnd();
            root.addEventListener('pointerenter', () => {
                if (timeline) timeline.kill();
                timeline = build();
                timeline.play(0);
            });
        } else {
            timeline = build();
            timeline.play(0);
        }
    }

    function init() {
        document.querySelectorAll('[data-stroke-text]').forEach(render);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
