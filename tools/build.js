/* ============================================================
   Build the published site into _site/.

       npm install --no-save esbuild@0.25.12
       node tools/build.js

   Runs in the deploy workflow; you never need to run it by hand
   unless you want to preview exactly what gets published.

   The repo keeps the readable source. Only the published copy is
   minified — JS and CSS go through esbuild, everything else is
   copied as-is. An allowlist decides what ships, so tools/,
   originals/, .github/ and any local config.js never reach the
   public site even if they sit in the folder.

   Minifying is safe here without bundling because every script is
   a self-contained IIFE: files share state only through window.X,
   and esbuild never renames property accesses.
   ============================================================ */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '_site');

/* What ships. Top-level pages, scripts and styles, plus these folders. */
const TOP_LEVEL = /\.(html|js|css)$/;
const NEVER = new Set(['config.js', 'config.example.js']);
const FOLDERS = ['data', 'images'];

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(function (e) {
        const full = path.join(dir, e.name);
        return e.isDirectory() ? walk(full) : [full];
    });
}

const files = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(function (e) { return e.isFile() && TOP_LEVEL.test(e.name) && !NEVER.has(e.name); })
    .map(function (e) { return path.join(ROOT, e.name); })
    .concat(FOLDERS.flatMap(function (f) { return walk(path.join(ROOT, f)); }));

fs.rmSync(OUT, { recursive: true, force: true });

let before = 0;
let after = 0;

for (const file of files) {
    const rel = path.relative(ROOT, file);
    const dest = path.join(OUT, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const ext = path.extname(file);
    if (ext === '.js' || ext === '.css') {
        const src = fs.readFileSync(file, 'utf8');
        /* no target: leave syntax exactly as written, only shrink it */
        const out = esbuild.transformSync(src, {
            loader: ext.slice(1),
            minify: true,
            legalComments: 'none'
        }).code;
        fs.writeFileSync(dest, out);
        before += Buffer.byteLength(src);
        after += Buffer.byteLength(out);
    } else {
        fs.copyFileSync(file, dest);
    }
}

console.log(files.length + ' files -> _site/');
console.log('js + css: ' + (before / 1024).toFixed(0) + ' KB -> ' +
            (after / 1024).toFixed(0) + ' KB minified');
