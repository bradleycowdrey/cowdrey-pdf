// Builds desktop/dist: the web app with every library it loads from jsDelivr copied in, so the apps work offline.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const nm = path.join(here, 'node_modules');
const dist = path.join(here, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'vendor'), { recursive: true });

// Every https://cdn.jsdelivr.net/npm/<package>@<version>/<file> in the page (script tags and the app's own imports,
// such as pdf.js and its worker) becomes vendor/<package>/<file>, copied from the pinned package.
let html = fs.readFileSync(path.join(here, '..', 'index.html'), 'utf8');
// pdf.js's comment icons: the page names the folder, and pdf.js adds each file name.
const ICONS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/web/images/';
if (html.includes(ICONS)) {
  const from = path.join(nm, 'pdfjs-dist/web/images'), to = path.join(dist, 'vendor/pdfjs-dist/web/images');
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) if (f.startsWith('annotation-')) fs.copyFileSync(path.join(from, f), path.join(to, f));
  html = html.split(ICONS).join('./vendor/pdfjs-dist/web/images/');
}
const copied = new Set();
html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/'"\s]+\/([^'"\s)]+)/g, (whole, pkg, file) => {
  const rel = `${pkg}/${file}`;
  // WKWebView runs a module only when it is served as JavaScript, and .mjs isn't always given that type: copy it as .js.
  const out = rel.replace(/\.mjs$/, '.js');
  const src = path.join(nm, rel);
  if (!fs.existsSync(src)) throw new Error(`Missing ${src}. Run npm ci in desktop/ first.`);
  if (!copied.has(rel)) { const dest = path.join(dist, 'vendor', out); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); copied.add(rel); }
  return `./vendor/${out}`;
});
fs.writeFileSync(path.join(dist, 'index.html'), html);
console.log(`desktop/dist ready (${copied.size} libraries: ${[...copied].join(', ')})`);
