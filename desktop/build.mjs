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
// OCR (tesseract.js): the engine and English work offline in the apps. The worker runs from a blob, so these paths
// must be absolute: they are turned into expressions that resolve against the app's own address.
const OCR = [
  ["'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js'", 'tesseract.js/dist/tesseract.min.js'],
  ["'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js'", 'tesseract.js/dist/worker.min.js'],
  ["'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1'", 'tesseract.js-core'],
];
if (html.includes(OCR[0][0])) {
  for (const [lit, rel] of OCR) html = html.split(lit).join(`new URL('./vendor/${rel}', location.href).href`);
  const copyFile = (rel) => { const to = path.join(dist, 'vendor', rel); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(path.join(nm, rel), to); };
  copyFile('tesseract.js/dist/tesseract.min.js'); copyFile('tesseract.js/dist/worker.min.js');
  for (const f of fs.readdirSync(path.join(nm, 'tesseract.js-core'))) if (/lstm\.(js|wasm|wasm\.js)$/.test(f)) copyFile('tesseract.js-core/' + f);
  copyFile('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  const LANG = '`https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int`';
  if (html.includes(LANG)) html = html.split(LANG).join("(lang === 'eng' ? new URL('./vendor/@tesseract.js-data/eng/4.0.0_best_int', location.href).href : " + LANG + ')');
}
const copied = new Set();
html = html.replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[^/]+\/)?[^@/]+)@[^/'"\s]+\/([^'"\s)]+)/g, (whole, pkg, file) => {
  if (pkg.includes('${') || file.includes('`')) return whole; // an address built at run time (online-only OCR languages)
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
