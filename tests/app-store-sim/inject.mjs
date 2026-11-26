// Makes the capture build: puts boot.js first in the <head> of desktop/dist/index.html (after `node build.mjs`), so
// the app built from it plays the App Store stories for run.mjs. Only the Simulator capture in CI runs this; the
// App Store, TestFlight and Mac builds bundle desktop/dist without it.
//
// Usage: node tests/app-store-sim/inject.mjs [desktop/dist]
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(process.argv[2] || path.join(here, '../../desktop/dist'));
const file = path.join(dist, 'index.html');
let html = fs.readFileSync(file, 'utf8');
if (html.includes('data-store-capture')) { console.log('already a capture build:', file); process.exit(0); }
const boot = fs.readFileSync(path.join(here, 'boot.js'), 'utf8');
const m = html.match(/<head[^>]*>/i);
if (!m) throw new Error('no <head> in ' + file);
html = html.replace(m[0], `${m[0]}\n<script data-store-capture>\n${boot}</script>`);
fs.writeFileSync(file, html);
console.log('capture build:', file);
