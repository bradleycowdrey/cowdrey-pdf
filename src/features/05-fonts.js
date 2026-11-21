/* ---------------- fonts: Unicode fonts for text written into the PDF ----------------
   Text typed into a PDF (Edit PDF, Add text, Replace text, watermarks, headers and footers, Bates numbers) is written
   in an embedded font that has its letters, as a subset (only the letters used), so it reads back exactly in every
   PDF reader. pdf-lib writes such a font as Type0 / Identity-H with a ToUnicode map.
     fontsKit()                     fontkit (@pdf-lib/fontkit, pinned), loaded once
     fontsBytes(family, style)      a font file: 'sans' | 'serif' | 'mono' (Noto Sans, Noto Serif, Noto Sans Mono,
                                    bundled with the apps), 'symbols' | 'symbols2', or a script font fetched on demand
     fontsEmbed(out, {family, bold, italic, text})   that font embedded (subset) in pdf-lib document `out`
     fontsFor(text, style)          the face that has every letter of `text` (the family first)
     fontsCovers(font, text)        whether a font (pdf-lib, or fontkit) has every letter
     fontsRuns(out, text, style)    `text` split into runs, each with an embedded font that has its letters; with
                                    style.std (a standard pdf-lib font), the runs it can write stay in it
   Noto Sans CJK (Chinese, Japanese, Korean), Devanagari and Thai are fetched the first time such letters are written,
   after asking, and kept in this browser (IndexedDB); nothing else leaves the device for it. Right-to-left scripts
   need shaping and ordering that is not done yet: saving them is refused with a plain message (no broken text). */
const FONTS_KIT_URL = 'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js';
// Bundled (desktop/build.mjs copies them into the apps): whole TrueType files, Latin, Greek and Cyrillic.
const FONTS_FACES = {
  sans: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.4.2/400Regular/NotoSans_400Regular.ttf',
  'sans-b': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.4.2/700Bold/NotoSans_700Bold.ttf',
  'sans-i': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.4.2/400Regular_Italic/NotoSans_400Regular_Italic.ttf',
  'sans-bi': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans@0.4.2/700Bold_Italic/NotoSans_700Bold_Italic.ttf',
  serif: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-serif@0.4.2/400Regular/NotoSerif_400Regular.ttf',
  'serif-b': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-serif@0.4.2/700Bold/NotoSerif_700Bold.ttf',
  'serif-i': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-serif@0.4.2/400Regular_Italic/NotoSerif_400Regular_Italic.ttf',
  'serif-bi': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-serif@0.4.2/700Bold_Italic/NotoSerif_700Bold_Italic.ttf',
  mono: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-mono@0.4.2/400Regular/NotoSansMono_400Regular.ttf',
  'mono-b': 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-mono@0.4.2/700Bold/NotoSansMono_700Bold.ttf',
  symbols: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-symbols@0.4.1/400Regular/NotoSansSymbols_400Regular.ttf',
  symbols2: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-symbols-2@0.4.1/400Regular/NotoSansSymbols2_400Regular.ttf',
};
// Fetched on demand only (never bundled): one pinned file each. The address is put together at run time, so the
// apps' build leaves it online.
const FONTS_CDN = 'https://cdn.jsdelivr.net/';
const FONTS_MORE = {
  sc: { name: 'Chinese', mb: 10.6, path: 'npm/@expo-google-fonts/noto-sans-sc@0.4.4/400Regular/NotoSansSC_400Regular.ttf' },
  jp: { name: 'Japanese', mb: 5.8, path: 'npm/@expo-google-fonts/noto-sans-jp@0.4.4/400Regular/NotoSansJP_400Regular.ttf' },
  kr: { name: 'Korean', mb: 6.2, path: 'npm/@expo-google-fonts/noto-sans-kr@0.4.4/400Regular/NotoSansKR_400Regular.ttf' },
  deva: { name: 'Hindi', mb: 0.3, path: 'npm/@expo-google-fonts/noto-sans-devanagari@0.4.2/400Regular/NotoSansDevanagari_400Regular.ttf' },
  thai: { name: 'Thai', mb: 0.1, path: 'npm/@expo-google-fonts/noto-sans-thai@0.4.2/400Regular/NotoSansThai_400Regular.ttf' },
};
const fontsMoreUrl = (k) => (fontsUrlOver[k] || FONTS_CDN + FONTS_MORE[k].path);
const fontsUrlOver = {}; // tests point a download at a local file
// (U+FEFF, the byte order mark often in pasted text, is not right-to-left)
const FONTS_RTL = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFE]|\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Syriac}|\p{Script=Thaana}|\p{Script=Nko}/u;
const fontsHan = /[\p{Script=Han}　-〿㈀-㏿！-｠]/u, fontsKana = /[\p{Script=Hiragana}\p{Script=Katakana}]/u, fontsHangul = /\p{Script=Hangul}/u;
// The on-demand fonts a letter could come from, the likeliest first.
function fontsMoreFor(ch, text = '') {
  const lang = (navigator.language || '').toLowerCase();
  if (fontsHangul.test(ch)) return ['kr'];
  if (fontsKana.test(ch)) return ['jp'];
  if (/\p{Script=Devanagari}/u.test(ch)) return ['deva'];
  if (/\p{Script=Thai}/u.test(ch)) return ['thai'];
  if (fontsHan.test(ch)) {
    const order = fontsKana.test(text) || lang.startsWith('ja') ? ['jp', 'sc', 'kr'] : fontsHangul.test(text) || lang.startsWith('ko') ? ['kr', 'sc', 'jp'] : ['sc', 'jp', 'kr'];
    const have = order.filter((k) => fontsHave.has(k)); // one already here first, so no second download
    return [...have, ...order.filter((k) => !have.includes(k))];
  }
  return [];
}
class FontsError extends Error { constructor(m) { super(m); this.name = 'FontsError'; } }
const fontsRtl = (text) => FONTS_RTL.test(String(text || ''));
const FONTS_RTL_MSG = 'Right-to-left text (Arabic, Hebrew) can’t be saved in the PDF yet. Remove it to save.';

/* loading */
// The same as the OCR engine's loader: a script tag, removed again when it fails.
function fontsLoadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => { s.remove(); rej(new Error('Could not load ' + src)); };
    document.head.appendChild(s);
  });
}
let fontsKitP = null;
// fontkit, adapted for @cantoo/pdf-lib: that version asks a subset for its bytes with encode() and no stream, which
// @pdf-lib/fontkit 1.1.1 does through a stream instead; the subset is written into a stream here and read back at once.
function fontsKit() {
  return fontsKitP || (fontsKitP = (async () => {
    if (!window.fontkit) await fontsLoadScript(FONTS_KIT_URL);
    const raw = window.fontkit;
    if (!raw || !raw.create) throw new Error('The font engine did not load');
    const subsetBytes = (P, sub) => {
      const ES = P.encodeStream.call({ encode() {} }).constructor, s = new ES(), parts = [];
      s.push = (b) => { if (b) parts.push(new Uint8Array(b.buffer, b.byteOffset, b.length).slice()); return true; };
      P.encode.call(sub, s); s.flush();
      const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    };
    const create = (...a) => {
      const f = raw.create(...a), cs = f.createSubset;
      if (typeof cs === 'function') f.createSubset = function () {
        const sub = cs.call(this), P = Object.getPrototypeOf(sub);
        if (P.encodeStream && P.encode && P.encode.length >= 1) sub.encode = function (st) { return st ? P.encode.call(this, st) : subsetBytes(P, this); };
        return sub;
      };
      return f;
    };
    return { ...raw, create };
  })().catch((e) => { fontsKitP = null; throw e; }));
}
const fontsFiles = new Map(); // face key -> Promise<Uint8Array>
const fontsHave = new Set(); // on-demand fonts here (fetched, or kept in this browser)
// On-demand fonts the person said no to: not asked again on their own this session (fontsNo), nor again in the same
// save (fontsNoSave, emptied when a save starts), so the next save asks again.
const fontsNo = new Set(), fontsNoSave = new Set();
function fontsSaveStarts() { fontsNoSave.clear(); }
const fontsFaceKey = (family, { bold, italic } = {}) => {
  if (FONTS_MORE[family] || family === 'symbols' || family === 'symbols2') return family;
  const fam = ['sans', 'serif', 'mono'].includes(family) ? family : 'sans';
  const k = fam + (bold && italic ? '-bi' : bold ? '-b' : italic ? '-i' : '');
  return FONTS_FACES[k] ? k : FONTS_FACES[fam + (bold ? '-b' : '')] ? fam + (bold ? '-b' : '') : fam;
};
async function fontsFetch(url) {
  const r = await fetch(url); if (!r.ok) throw new Error('Could not load the font (' + r.status + ')');
  return new Uint8Array(await r.arrayBuffer());
}
// The font file for a family and style (see the top). An on-demand font is read from this browser, or downloaded
// after asking (null when the person says no).
// auto: asked on its own (not for a save), so not again once the person said no.
function fontsBytes(family, style = {}, auto = false) {
  const k = fontsFaceKey(family, style);
  if (!fontsFiles.has(k)) {
    const p = FONTS_MORE[k] ? fontsMoreBytes(k, true, auto) : fontsFetch(FONTS_FACES[k]);
    fontsFiles.set(k, p);
    p.then((b) => { if (!b) fontsFiles.delete(k); }, () => fontsFiles.delete(k));
  }
  return fontsFiles.get(k);
}
// Kept in this browser once downloaded: IndexedDB, a store of its own.
let fontsDbP = null;
function fontsDb() {
  return fontsDbP || (fontsDbP = new Promise((res, rej) => {
    const r = indexedDB.open('cowdrey.pdf.fonts', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('fonts');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }).catch((e) => { fontsDbP = null; throw e; }));
}
async function fontsDbDo(mode, fn) {
  const d = await fontsDb();
  return new Promise((res, rej) => { const tx = d.transaction('fonts', mode), q = fn(tx.objectStore('fonts')); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); });
}
async function fontsMoreBytes(k, ask = true, auto = false) {
  let b = null;
  try { const rec = await fontsDbDo('readonly', (s) => s.get(k)); if (rec && rec.url === fontsMoreUrl(k) && rec.bytes) b = new Uint8Array(rec.bytes); } catch {}
  if (b) { fontsHave.add(k); return b; }
  if (!ask || fontsNoSave.has(k) || (auto && fontsNo.has(k))) return null;
  const F = FONTS_MORE[k], size = F.mb >= 1 ? `${Math.round(F.mb)} MB` : `${Math.max(1, Math.round(F.mb * 1000))} KB`;
  const a = await dialog(`${F.name} letters need a font`, `<p>${F.name} letters need a font download (${size}). Download once?</p><p class="fonts-note">It is kept on this device for next time. Only the font is downloaded; your PDF stays here.</p>`,
    [{ label: 'Not now' }, { label: 'Download', value: 'yes', primary: true }]);
  if (a !== 'yes') { fontsNo.add(k); fontsNoSave.add(k); return null; }
  toast(`Downloading the ${F.name} font…`);
  try { b = await fontsFetch(fontsMoreUrl(k)); }
  catch (e) { toast(`The ${F.name} font could not be downloaded. Check the connection and try again.`); throw e; }
  try { await fontsDbDo('readwrite', (s) => s.put({ url: fontsMoreUrl(k), bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, k)); } catch (e) { console.warn('fonts: could not keep the font on this device', e); }
  fontsHave.add(k);
  toast(`${F.name} font ready`);
  return b;
}
// The on-demand fonts here already (kept from before), so choosing a font needs no question.
// (kept under the address it came from: a font from another address is fetched again)
async function fontsReadKept() {
  try { const recs = await fontsDbDo('readonly', (st) => st.getAll()), keys = await fontsDbDo('readonly', (st) => st.getAllKeys()); (keys || []).forEach((k, i) => { if (FONTS_MORE[k] && recs[i] && recs[i].url === fontsMoreUrl(k)) fontsHave.add(k); }); } catch {}
}
let fontsKnown = fontsReadKept();

/* faces: each font file read once (to know which letters it has) */
const fontsFaces = new Map(); // face key -> Promise<fontkit font | null>
function fontsFace(key) {
  if (!fontsFaces.has(key)) {
    const [fam, st] = key.split('-');
    const p = (async () => { const b = await fontsBytes(fam, { bold: /b/.test(st || ''), italic: /i/.test(st || '') }); return b ? (await fontsKit()).create(b) : null; })();
    fontsFaces.set(key, p); p.then((f) => { if (!f) fontsFaces.delete(key); }, () => fontsFaces.delete(key));
  }
  return fontsFaces.get(key);
}
// Whether a font has every letter of a text (spaces and line breaks aside): a pdf-lib font (a standard one when it can
// write them), or a fontkit font.
function fontsCovers(font, text) {
  const s = [...String(text || '')].filter((c) => !/[\s​-‍﻿]/.test(c)).join('');
  if (!font) return false;
  if (!s) return true;
  const fk = font.hasGlyphForCodePoint ? font : font.embedder && font.embedder.font && font.embedder.font.hasGlyphForCodePoint ? font.embedder.font : null;
  if (fk) return [...s].every((c) => fk.hasGlyphForCodePoint(c.codePointAt(0)));
  // a standard font: what its encoding (WinAnsi) has (pdf-lib would write '?' for the rest)
  const enc = font.embedder && font.embedder.encoding;
  if (enc && enc.canEncodeUnicodeCodePoint) return [...s].every((c) => enc.canEncodeUnicodeCodePoint(c.codePointAt(0)));
  try { font.encodeText(s); return true; } catch { return false; }
}
// The faces to try for a text, in order: the family in its style, its plain style, the symbol fonts, then for each
// letter the script fonts that are fetched on demand.
function fontsChain(text, style = {}) {
  const fam = ['sans', 'serif', 'mono'].includes(style.family) ? style.family : 'sans';
  const keys = [fontsFaceKey(fam, style), fontsFaceKey(fam), ...(fam === 'sans' ? [] : [fontsFaceKey('sans', style), 'sans']), 'symbols2', 'symbols'];
  // (one download a letter at most: the likeliest font, or one that is here already)
  for (const ch of String(text || '')) { const ks = fontsMoreFor(ch, text); keys.push(...ks.filter((k) => fontsHave.has(k)), ...ks.slice(0, 1)); }
  return [...new Set(keys)];
}
// The face that has every letter of a text: its key and the fontkit font (the family's own when none has them all).
async function fontsFor(text, style = {}) {
  if (fontsRtl(text)) throw new FontsError(FONTS_RTL_MSG);
  await fontsKnown;
  const chain = fontsChain(text, style);
  for (const k of chain) { const f = await fontsFace(k); if (f && fontsCovers(f, text)) return { key: k, font: f }; }
  return { key: chain[0], font: await fontsFace(chain[0]) };
}
// Fonts embedded in a pdf-lib document, per document and face (pdf-lib writes the letters used once, at the end).
const fontsEmbedded = new WeakMap(); // out -> Map(face key -> Promise<PDFFont>)
async function fontsEmbedKey(out, key) {
  let m = fontsEmbedded.get(out); if (!m) fontsEmbedded.set(out, m = new Map());
  if (!m.has(key)) {
    const p = (async () => {
      const kit = await fontsKit();
      if (!out.fontkit) out.registerFontkit(kit);
      const [fam, st] = key.split('-'), b = await fontsBytes(fam, { bold: /b/.test(st || ''), italic: /i/.test(st || '') });
      if (!b) throw new FontsError(`${(FONTS_MORE[key] || {}).name || 'These'} letters need the font download to be saved.`);
      return out.embedFont(b, { subset: true });
    })();
    m.set(key, p); p.catch(() => m.delete(key));
  }
  return m.get(key);
}
// An embedded font for a family and style; with `text`, a face that has its letters (see fontsFor).
async function fontsEmbed(out, { family = 'sans', bold = false, italic = false, text = '' } = {}) {
  const key = text ? (await fontsFor(text, { family, bold, italic })).key : fontsFaceKey(family, { bold, italic });
  return fontsEmbedKey(out, key);
}
// A text in runs of one font each: [{ text, font, std }]. Words stay in one font where one has all their letters
// (a word split between fonts is found and copied in pieces by some readers); spaces go with the run before them.
// style: { family, bold, italic, std?, measure? } (std: a standard pdf-lib font, kept for what it can write;
// measure: only measuring, so nothing is said about letters left out).
async function fontsRuns(out, text, style = {}) {
  text = String(text || '');
  if (fontsRtl(text)) throw new FontsError(FONTS_RTL_MSG);
  await fontsKnown;
  text = text.replace(/\uFEFF/g, ''); // a byte order mark from pasted text: nothing to draw
  const runs = [], chain = fontsChain(text, style);
  let lost = false;
  const pick = async (s) => {
    if (style.std && fontsCovers(style.std, s)) return 'std';
    for (const k of chain) { const f = await fontsFace(k); if (f && fontsCovers(f, s)) return k; }
    return null;
  };
  const push = (key, s) => { const last = runs[runs.length - 1]; if (last && last.key === key) last.text += s; else runs.push({ key, text: s }); };
  for (const tok of text.match(/\s+|\S+/g) || []) {
    if (/^\s+$/.test(tok)) { push(runs.length ? runs[runs.length - 1].key : (await pick(' ')) || chain[0], tok); continue; }
    const k = await pick(tok);
    if (k) { push(k, tok); continue; }
    // No one font has the whole word: each letter in the first that has it. A letter only a font that was not
    // downloaded has stops the save (it would be an empty box). One no font has (most emoji) is left out of the
    // drawing (it would be an empty box, read back as nothing useful); runs.lost says so, and Edit PDF keeps it in
    // the line's ActualText, which some readers copy.
    for (const ch of tok) {
      const k1 = await pick(ch);
      if (!k1) {
        const want = fontsMoreFor(ch, text)[0]; if (want) throw new FontsError(`${FONTS_MORE[want].name} letters need the font download to be saved.`);
        if (!/[\u200B-\u200D\u2060\uFE00-\uFE0F\uFEFF]/.test(ch)) lost = true;
        continue;
      }
      push(k1, ch);
    }
  }
  for (const r of runs) { r.std = r.key === 'std'; r.font = r.std ? style.std : await fontsEmbedKey(out, r.key); }
  if (lost) { runs.lost = true; if (!style.measure) fontsSayLost(); }
  return runs;
}
// Said once in a while (a save may write many lines).
let fontsLostAt = 0;
function fontsSayLost() { if (Date.now() - fontsLostAt > 5000) toast('Some letters (like emoji) have no font here and were left out of the PDF.'); fontsLostAt = Date.now(); }
// The width of runs at a size, in points (with character spacing tc, as text is drawn).
const fontsWidth = (runs, size, tc = 0) => runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, size) + [...r.text].length * tc, 0);
// The page's resource name for a font (one per font and page, however often it is used).
const fontsKeys = new WeakMap(); // page node -> Map(font ref tag -> PDFName)
function fontsKey(node, font) {
  let m = fontsKeys.get(node); if (!m) fontsKeys.set(node, m = new Map());
  const t = font.ref.tag || String(font.ref);
  if (!m.has(t)) m.set(t, node.newFontDictionary('CPDFU', font.ref));
  return m.get(t);
}
// Runs drawn on a pdf-lib page, one after the other along the baseline from (x, y), turned `rotate` degrees.
function fontsDraw(L, p, runs, { x, y, size, rotate = 0, ...opts }) {
  const a = rotate * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  let d = 0;
  for (const r of runs) {
    if (r.text) p.drawText(r.text, { ...opts, x: x + c * d, y: y + s * d, size, font: r.font, rotate: L.degrees(rotate) });
    d += r.font.widthOfTextAtSize(r.text, size);
  }
  return d;
}
// The style of a font in a PDF, from its FontDescriptor (fixed pitch, serif, italic, weight, stem width) and its name.
function fontsStyleOf(L, out, fontDict, name = '') {
  const { PDFName, PDFDict, PDFArray, PDFNumber } = L;
  let d = fontDict instanceof PDFDict ? fontDict : null;
  const df = d && d.lookup(PDFName.of('DescendantFonts'));
  if (df instanceof PDFArray && df.lookup(0) instanceof PDFDict) d = df.lookup(0);
  const fd = d && d.lookup(PDFName.of('FontDescriptor')), num = (k) => { const v = fd instanceof PDFDict && fd.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : null; };
  const flags = num('Flags') || 0, weight = num('FontWeight'), stem = num('StemV'), angle = num('ItalicAngle');
  const n = baseName(name || (fontDict instanceof PDFDict ? fontDict.lookup(PDFName.of('BaseFont')) : '')) + ' ' + (fd instanceof PDFDict ? String(fd.lookup(PDFName.of('FontFamily')) || '') : '');
  const named = stdFamily(n);
  const family = /courier|mono|consol|menlo/i.test(n) || (flags & 1 && !/sans|serif/i.test(n)) ? 'mono' : named !== 'sans' ? named : !/sans|arial|helvetica|calibri|carlito|verdana|segoe|roboto/i.test(n) && flags & 2 ? 'serif' : 'sans';
  const bold = /bold|black|heavy|semibold|demi/i.test(n) || !!(flags & (1 << 18)) || (weight != null && weight >= 600) || (stem != null && stem >= 120);
  const italic = /italic|oblique/i.test(n) || !!(flags & (1 << 6)) || (angle != null && angle < -3);
  return { family, bold, italic };
}
// Before saving: the fonts a text will need are here (downloaded after asking, if need be). Says why not when they aren't.
async function fontsEnsure(text, auto = false) {
  text = String(text || '');
  if (fontsRtl(text)) { toast(FONTS_RTL_MSG); return false; }
  await fontsKnown;
  const need = new Set();
  for (const ch of text) { const ks = fontsMoreFor(ch, text); if (ks.length && !ks.some((k) => fontsHave.has(k))) need.add(ks[0]); }
  for (const k of need) { try { if (!(await fontsBytes(k, {}, auto))) return false; } catch { return false; } }
  return true;
}
// Typing letters an on-demand font has asks for it once the editor closes (not while typing); right-to-left text
// is said to be unsupported then too.
document.addEventListener('focusout', (e) => {
  const el = e.target;
  if (!el || !el.matches || !el.matches('.line-editor, .txt-editor')) return;
  const text = el.matches('.txt-editor') ? el.value : el.textContent;
  if (!text || !/[^\x00-ɏ\s]/.test(text)) return;
  setTimeout(() => { fontsEnsure(text, true).catch(() => {}); }, 0);
}, true);
addStyle('.fonts-note { font-size: 12px; color: var(--ink-3); }');
TEST_HOOKS.fontsUrl = (k, url) => { if (url) fontsUrlOver[k] = url; else delete fontsUrlOver[k]; fontsFiles.delete(k); fontsFaces.delete(k); fontsHave.delete(k); fontsNo.delete(k); fontsNoSave.delete(k); fontsKnown = fontsReadKept(); return fontsKnown; };
TEST_HOOKS.fontsFor = async (text, style) => (await fontsFor(text, style)).key;
TEST_HOOKS.fontsBytes = async (family, style) => { const b = await fontsBytes(family, style); return b ? b.length : 0; };
TEST_HOOKS.fontsHave = () => [...fontsHave];
