/* ============================================================
   Meme generator — whale picking, canvas rendering, PNG export.

   Whale images come from the same source as the home page
   spotlight. See LOCAL_WHALES below to point it at your own art.
   ============================================================ */

(function () {
    'use strict';

    const SUPPLY = 10000;
    const SIZE = 1000;              /* canvas is square, 1000x1000 */

    const FONTS = {
        impact: 'Impact, "Arial Black", sans-serif',
        display: "'Syne', 'Trebuchet MS', sans-serif",
        mono: "'JetBrains Mono', ui-monospace, monospace"
    };

    const $ = function (id) { return document.getElementById(id); };

    const canvas = $('memeCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const els = {
        whaleId: $('whaleId'),
        loadWhale: $('loadWhale'),
        whaleStatus: $('whaleStatus'),
        captionStatus: $('captionStatus'),
        captionList: $('captionList'),
        topText: $('topText'),
        bottomText: $('bottomText'),
        fontFamily: $('fontFamily'),
        fontSize: $('fontSize'),
        fontSizeOut: $('fontSizeOut'),
        fillColor: $('fillColor'),
        strokeColor: $('strokeColor'),
        strokeWidth: $('strokeWidth'),
        strokeWidthOut: $('strokeWidthOut'),
        uppercase: $('uppercase'),
        download: $('downloadMeme'),
        reset: $('resetMeme'),
        stageEmpty: $('stageEmpty'),
        stageNote: $('stageNote')
    };

    const state = {
        whale: null,
        image: null,
        tainted: false,          /* true when the image host blocks canvas export */
        top:    { x: SIZE / 2, y: 90 },
        bottom: { x: SIZE / 2, y: SIZE - 90 },
        dragging: null
    };

    /* ---------------------------------------------------------
       Loading a whale
       --------------------------------------------------------- */

    /* The IPFS gateway sends Access-Control-Allow-Origin: *, so requesting
       the image with crossOrigin keeps the canvas exportable. */
    function loadImage(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = function () { resolve({ img: img, tainted: false }); };
            img.onerror = function () {
                /* Last resort: show it, but the PNG export will be blocked. */
                const plain = new Image();
                plain.onload = function () { resolve({ img: plain, tainted: true }); };
                plain.onerror = function () { reject(new Error('image failed to load')); };
                plain.src = src;
            };
            img.src = src;
        });
    }

    async function loadWhale(id) {
        els.loadWhale.disabled = true;
        setStatus(els.whaleStatus, 'loading #' + id + '…');

        try {
            const whale = await window.WhaleSource.load(id);       /* metadata + traits */
            const result = await loadImage(whale.image);           /* the art itself */

            state.whale = whale;
            state.image = result.img;
            state.tainted = result.tainted;

            els.whaleId.value = id;
            els.stageEmpty.hidden = true;
            els.download.disabled = state.tainted;

            const traitCount = whale.traits.length;
            setStatus(
                els.whaleStatus,
                'whale #' + id + ' loaded · ' + traitCount + ' traits',
                'ok'
            );

            resetPositions();
            render();

            /* Captions are the point of the page — write them straight away. */
            await generateCaptions();
        } catch (err) {
            setStatus(els.whaleStatus, 'could not load #' + id + ' (' + err.message + ')', 'error');
        } finally {
            els.loadWhale.disabled = false;
        }
    }

    /* ---------------------------------------------------------
       Captions
       --------------------------------------------------------- */

    async function generateCaptions() {
        if (!state.whale) return;

        setStatus(els.captionStatus, 'writing captions…');
        els.captionList.innerHTML = '';

        const result = await window.WhaleCaptions.generate(state.whale);

        renderCaptions(result.captions);

        /* Land with a caption already on the meme — the first one goes
           straight onto the canvas, the other four are one click away. */
        if (result.captions.length) {
            els.topText.value = result.captions[0];
            render();
        }

        setStatus(
            els.captionStatus,
            result.note || ('5 captions by ' + result.source),
            result.source === 'claude' ? 'ok' : 'warn'
        );
    }

    function renderCaptions(captions) {
        els.captionList.innerHTML = '';

        captions.forEach(function (text) {
            const li = document.createElement('li');
            li.className = 'Caption';

            const span = document.createElement('span');
            span.className = 'Caption-text';
            span.textContent = text;

            const actions = document.createElement('span');
            actions.className = 'Caption-actions';

            [['Top', els.topText], ['Bottom', els.bottomText]].forEach(function (pair) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'Caption-btn';
                btn.textContent = pair[0];
                btn.addEventListener('click', function () {
                    pair[1].value = text;
                    render();
                });
                actions.appendChild(btn);
            });

            li.appendChild(span);
            li.appendChild(actions);
            els.captionList.appendChild(li);
        });
    }

    /* ---------------------------------------------------------
       Rendering
       --------------------------------------------------------- */

    function wrapLines(text, maxWidth) {
        const words = text.split(/\s+/).filter(Boolean);
        const lines = [];
        let line = '';

        words.forEach(function (word) {
            const test = line ? line + ' ' + word : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                lines.push(line);
                line = word;
            } else {
                line = test;
            }
        });

        if (line) lines.push(line);
        return lines;
    }

    function drawCaption(text, anchor, align) {
        if (!text) return;

        const size = Number(els.fontSize.value);
        const weight = els.fontFamily.value === 'impact' ? '400' : '800';
        ctx.font = weight + ' ' + size + 'px ' + FONTS[els.fontFamily.value];
        ctx.textAlign = 'center';
        ctx.lineJoin = 'round';    /* stops spikes on sharp glyph corners */
        ctx.miterLimit = 2;

        const value = els.uppercase.checked ? text.toUpperCase() : text;
        const lines = wrapLines(value, SIZE - 80);
        const lineHeight = size * 1.1;

        /* anchor.y is the top edge for the top caption and the bottom
           edge for the bottom one, so each grows away from its edge */
        const startY = align === 'top'
            ? anchor.y
            : anchor.y - (lines.length - 1) * lineHeight;

        ctx.strokeStyle = els.strokeColor.value;
        ctx.lineWidth = Number(els.strokeWidth.value);
        ctx.fillStyle = els.fillColor.value;

        lines.forEach(function (line, i) {
            const y = startY + i * lineHeight;
            if (ctx.lineWidth > 0) ctx.strokeText(line, anchor.x, y);
            ctx.fillText(line, anchor.x, y);
        });

        return { lines: lines, lineHeight: lineHeight, startY: startY, size: size };
    }

    function drawImageCover() {
        const img = state.image;
        const scale = Math.max(SIZE / img.width, SIZE / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
    }

    function render() {
        ctx.clearRect(0, 0, SIZE, SIZE);

        if (!state.image) return;

        drawImageCover();
        ctx.textBaseline = 'top';
        drawCaption(els.topText.value, state.top, 'top');
        ctx.textBaseline = 'bottom';
        drawCaption(els.bottomText.value, state.bottom, 'bottom');
    }

    function resetPositions() {
        state.top = { x: SIZE / 2, y: 90 };
        state.bottom = { x: SIZE / 2, y: SIZE - 90 };
    }

    /* ---------------------------------------------------------
       Dragging captions
       --------------------------------------------------------- */

    function canvasPoint(evt) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (evt.clientX - rect.left) * (SIZE / rect.width),
            y: (evt.clientY - rect.top) * (SIZE / rect.height)
        };
    }

    canvas.addEventListener('pointerdown', function (evt) {
        if (!state.image) return;
        const p = canvasPoint(evt);
        /* whichever caption's anchor is nearer, as long as it has text */
        const candidates = [];
        if (els.topText.value) candidates.push(['top', state.top]);
        if (els.bottomText.value) candidates.push(['bottom', state.bottom]);
        if (!candidates.length) return;

        candidates.sort(function (a, b) {
            return Math.abs(a[1].y - p.y) - Math.abs(b[1].y - p.y);
        });

        state.dragging = candidates[0][0];
        canvas.setPointerCapture(evt.pointerId);
    });

    canvas.addEventListener('pointermove', function (evt) {
        if (!state.dragging) return;
        const p = canvasPoint(evt);
        state[state.dragging] = { x: p.x, y: p.y };
        render();
    });

    canvas.addEventListener('pointerup', function (evt) {
        state.dragging = null;
        if (canvas.hasPointerCapture(evt.pointerId)) {
            canvas.releasePointerCapture(evt.pointerId);
        }
    });

    /* ---------------------------------------------------------
       Export
       --------------------------------------------------------- */

    function download() {
        try {
            const url = canvas.toDataURL('image/png');
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ssow-' + (state.whale ? state.whale.id : 'meme') + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            /* Tainted canvas. Opened from disk the browser treats even
               same-folder images as cross-origin, so the export is refused. */
            const isFile = window.location.protocol === 'file:';
            setStatus(
                els.whaleStatus,
                isFile
                    ? 'downloads need the page served over HTTP — try: npx serve'
                    : 'the browser blocked the export (' + (err.message || 'tainted canvas') + ')',
                'error'
            );
            if (isFile && els.stageNote) {
                els.stageNote.innerHTML =
                    'This page is open as a <code>file://</code> path, so the browser refuses ' +
                    'to export the canvas. From the project folder run <code>npx serve</code> ' +
                    '(or <code>python -m http.server</code>) and open the ' +
                    '<code>http://localhost:…</code> address it prints.';
            }
        }
    }

    /* ---------------------------------------------------------
       Wiring
       --------------------------------------------------------- */

    function setStatus(el, message, kind) {
        if (!el) return;
        el.textContent = message || '';
        el.className = 'Field-status' + (kind ? ' is-' + kind : '');
    }

    els.loadWhale.addEventListener('click', function () {
        const id = parseInt(els.whaleId.value, 10);
        if (!window.WhaleSource.isValidId(id)) {
            setStatus(els.whaleStatus, 'pick a number between 1 and ' + SUPPLY, 'error');
            return;
        }
        loadWhale(id);
    });

    els.whaleId.addEventListener('keydown', function (evt) {
        if (evt.key === 'Enter') els.loadWhale.click();
    });

    els.download.addEventListener('click', download);

    els.reset.addEventListener('click', function () {
        els.topText.value = '';
        els.bottomText.value = '';
        els.captionList.innerHTML = '';
        setStatus(els.captionStatus, '');
        resetPositions();
        render();
    });

    [els.topText, els.bottomText, els.fontFamily, els.fillColor,
     els.strokeColor, els.uppercase].forEach(function (el) {
        el.addEventListener('input', render);
    });

    els.fontSize.addEventListener('input', function () {
        els.fontSizeOut.textContent = els.fontSize.value;
        render();
    });

    els.strokeWidth.addEventListener('input', function () {
        els.strokeWidthOut.textContent = els.strokeWidth.value;
        render();
    });

    /* Impact and the Google fonts may land after first paint. */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(render).catch(function () {});
    }
})();
