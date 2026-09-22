/* ============================================================
   Watercolor — an animated two-colour noise background.

   Technique: fractal Brownian motion (layered value noise) fed
   through two rounds of domain warping, so the field folds back
   into itself and bleeds like pigment spreading on wet paper.
   The result is mixed between two colours and drawn to a
   full-screen WebGL canvas sitting behind the page.

   Usage:  <div class="Watercolor" data-watercolor></div>

   Tunables, all optional data-* attributes:
     data-color1        hex, defaults to the page's --accent
     data-color2        hex, defaults to the page's --amethyst
     data-opacity       0–1        (default 0.38)
     data-scale         0.5–5      (default 2.2) pattern size
     data-octaves       1–8        (default 5)   noise detail
     data-persistence   0–1        (default 0.5) octave falloff
     data-lacunarity    1–4        (default 2.0) octave frequency step
     data-speed         0.01–3     (default 0.12) overall flow
     data-drift-speed   0–3        (default 0.06) slow wander
     data-warp-speed    0–3        (default 0.20) warp churn
     data-warp          0–3        (default 1.1) warp strength
     data-saturation    0–2        (default 1.0)
     data-brightness    0–2        (default 1.0)
     data-cursor        "true"     warps harder near the pointer

   Degrades quietly: no WebGL, no canvas — the page keeps whatever
   background the CSS already gives it.
   ============================================================ */

(function () {
    'use strict';

    const VERT = [
        'attribute vec2 aPos;',
        'void main() { gl_Position = vec4(aPos, 0.0, 1.0); }'
    ].join('\n');

    const FRAG = [
        'precision highp float;',
        '',
        'uniform vec2  uResolution;',
        'uniform float uTime;',
        'uniform vec2  uMouse;',
        'uniform float uCursor;',
        'uniform float uScale;',
        'uniform float uOctaves;',
        'uniform float uPersistence;',
        'uniform float uLacunarity;',
        'uniform float uDriftSpeed;',
        'uniform float uWarpSpeed;',
        'uniform float uWarp;',
        'uniform vec3  uColor1;',
        'uniform vec3  uColor2;',
        'uniform float uSaturation;',
        'uniform float uBrightness;',
        'uniform float uOpacity;',
        '',
        'float hash(vec2 p) {',
        '    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);',
        '}',
        '',
        '/* value noise with a smoothstep-interpolated lattice */',
        'float noise(vec2 p) {',
        '    vec2 i = floor(p);',
        '    vec2 f = fract(p);',
        '    vec2 u = f * f * (3.0 - 2.0 * f);',
        '    float a = hash(i);',
        '    float b = hash(i + vec2(1.0, 0.0));',
        '    float c = hash(i + vec2(0.0, 1.0));',
        '    float d = hash(i + vec2(1.0, 1.0));',
        '    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);',
        '}',
        '',
        '/* Constant loop bound with a conditional inside — GLSL ES 1.00',
        '   will not accept a uniform as the loop limit. */',
        'float fbm(vec2 p) {',
        '    float sum = 0.0;',
        '    float amp = 0.5;',
        '    float freq = 1.0;',
        '    for (int i = 0; i < 8; i++) {',
        '        if (float(i) < uOctaves) {',
        '            sum += amp * noise(p * freq);',
        '            freq *= uLacunarity;',
        '            amp *= uPersistence;',
        '        }',
        '    }',
        '    return sum;',
        '}',
        '',
        'void main() {',
        '    /* normalise on the short edge so the pattern never stretches */',
        '    vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / min(uResolution.x, uResolution.y);',
        '    vec2 p = uv * uScale;',
        '',
        '    float t = uTime;',
        '',
        '    /* extra warp near the pointer, falling off with distance */',
        '    float pull = 0.0;',
        '    if (uCursor > 0.5) {',
        '        vec2 m = (uMouse - 0.5 * uResolution) / min(uResolution.x, uResolution.y);',
        '        pull = exp(-dot(p - m, p - m) * 3.0) * 0.9;',
        '    }',
        '    float warp = uWarp + pull;',
        '',
        '    /* first warp: displace the sample point by its own noise */',
        '    vec2 q = vec2(',
        '        fbm(p + vec2(0.0, t * uDriftSpeed)),',
        '        fbm(p + vec2(5.2, 1.3) - vec2(t * uDriftSpeed, 0.0))',
        '    );',
        '',
        '    /* second warp: displace again using the first result */',
        '    vec2 r = vec2(',
        '        fbm(p + warp * q + vec2(1.7, 9.2) + t * uWarpSpeed),',
        '        fbm(p + warp * q + vec2(8.3, 2.8) - t * uWarpSpeed)',
        '    );',
        '',
        '    float v = fbm(p + warp * r);',
        '',
        '    /* push the midtones apart so washes read as separate blooms */',
        '    v = smoothstep(0.15, 0.85, v);',
        '',
        '    vec3 col = mix(uColor1, uColor2, clamp(v, 0.0, 1.0));',
        '',
        '    /* the second warp field doubles as a density map — where the',
        '       pigment pooled, the colour sits heavier */',
        '    float density = clamp(length(r) * 0.9, 0.0, 1.0);',
        '    col *= 0.65 + 0.6 * density;',
        '',
        '    float grey = dot(col, vec3(0.299, 0.587, 0.114));',
        '    col = mix(vec3(grey), col, uSaturation) * uBrightness;',
        '',
        '    float alpha = uOpacity * (0.35 + 0.65 * density);',
        '    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));',
        '}'
    ].join('\n');

    function hexToRgb(hex) {
        const h = String(hex || '').trim().replace('#', '');
        if (h.length !== 6) return null;
        return [
            parseInt(h.slice(0, 2), 16) / 255,
            parseInt(h.slice(2, 4), 16) / 255,
            parseInt(h.slice(4, 6), 16) / 255
        ];
    }

    function num(value, fallback) {
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function compile(gl, type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    function init(host) {
        const cs = getComputedStyle(host);
        const d = host.dataset;

        const opts = {
            color1: hexToRgb(d.color1 || cs.getPropertyValue('--accent')) || [0.30, 0.88, 0.77],
            color2: hexToRgb(d.color2 || cs.getPropertyValue('--amethyst')) || [0.61, 0.50, 0.94],
            opacity: num(d.opacity, 0.38),
            scale: num(d.scale, 2.2),
            octaves: Math.min(8, Math.max(1, num(d.octaves, 5))),
            persistence: num(d.persistence, 0.5),
            lacunarity: num(d.lacunarity, 2.0),
            speed: num(d.speed, 0.12),
            driftSpeed: num(d.driftSpeed, 0.06),
            warpSpeed: num(d.warpSpeed, 0.20),
            warp: num(d.warp, 1.1),
            saturation: num(d.saturation, 1.0),
            brightness: num(d.brightness, 1.0),
            cursor: d.cursor === 'true'
        };

        const canvas = document.createElement('canvas');
        canvas.className = 'Watercolor-canvas';
        host.appendChild(canvas);

        const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false })
            || canvas.getContext('experimental-webgl', { alpha: true });

        if (!gl) {
            /* No WebGL — remove the canvas and leave the CSS background alone. */
            host.removeChild(canvas);
            return;
        }

        const vs = compile(gl, gl.VERTEX_SHADER, VERT);
        const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) { host.removeChild(canvas); return; }

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { host.removeChild(canvas); return; }
        gl.useProgram(prog);

        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1, -1, 1, -1, -1, 1,
            -1, 1, 1, -1, 1, 1
        ]), gl.STATIC_DRAW);

        const aPos = gl.getAttribLocation(prog, 'aPos');
        gl.enableVertexAttribArray(aPos);
        gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        const U = {};
        ['uResolution', 'uTime', 'uMouse', 'uCursor', 'uScale', 'uOctaves',
         'uPersistence', 'uLacunarity', 'uDriftSpeed', 'uWarpSpeed', 'uWarp',
         'uColor1', 'uColor2', 'uSaturation', 'uBrightness', 'uOpacity'
        ].forEach(function (name) { U[name] = gl.getUniformLocation(prog, name); });

        gl.uniform1f(U.uScale, opts.scale);
        gl.uniform1f(U.uOctaves, opts.octaves);
        gl.uniform1f(U.uPersistence, opts.persistence);
        gl.uniform1f(U.uLacunarity, opts.lacunarity);
        gl.uniform1f(U.uDriftSpeed, opts.driftSpeed);
        gl.uniform1f(U.uWarpSpeed, opts.warpSpeed);
        gl.uniform1f(U.uWarp, opts.warp);
        gl.uniform3fv(U.uColor1, opts.color1);
        gl.uniform3fv(U.uColor2, opts.color2);
        gl.uniform1f(U.uSaturation, opts.saturation);
        gl.uniform1f(U.uBrightness, opts.brightness);
        gl.uniform1f(U.uOpacity, opts.opacity);
        gl.uniform1f(U.uCursor, opts.cursor ? 1.0 : 0.0);

        const mouse = { x: 0, y: 0 };

        /* A full-screen fragment shader is fill-rate bound, so cap the pixel
           ratio — rendering this at 3x on a phone is wasted heat. */
        function resize() {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            const w = Math.floor(host.clientWidth * dpr);
            const h = Math.floor(host.clientHeight * dpr);
            if (canvas.width === w && canvas.height === h) return;
            canvas.width = w;
            canvas.height = h;
            gl.viewport(0, 0, w, h);
            gl.uniform2f(U.uResolution, w, h);
            mouse.x = w / 2;
            mouse.y = h / 2;
        }

        function draw(timeSeconds) {
            gl.uniform1f(U.uTime, timeSeconds);
            gl.uniform2f(U.uMouse, mouse.x, mouse.y);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        resize();
        window.addEventListener('resize', resize);

        if (opts.cursor) {
            window.addEventListener('pointermove', function (evt) {
                const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
                mouse.x = evt.clientX * dpr;
                mouse.y = (host.clientHeight - evt.clientY) * dpr;   /* GL origin is bottom-left */
            });
        }

        const reduced = window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduced) {
            /* One frame, held. The wash still looks painted, it just
               stops moving. */
            draw(0);
            return;
        }

        let running = true;
        let start = null;

        function frame(now) {
            if (!running) return;
            if (start === null) start = now;
            draw(((now - start) / 1000) * opts.speed * 10);
            window.requestAnimationFrame(frame);
        }

        window.requestAnimationFrame(frame);

        /* Don't render to a tab nobody is looking at. */
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                running = false;
            } else if (!running) {
                running = true;
                start = null;
                window.requestAnimationFrame(frame);
            }
        });
    }

    function boot() {
        document.querySelectorAll('[data-watercolor]').forEach(init);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
