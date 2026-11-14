/* ---------------- create and read (95-create-read) ----------------
   Create a PDF: a blank document, a PDF from pictures (picked, dropped or pasted), or a picture from the clipboard
   as a page or placed on the page. Read aloud with the device's own voices, Read mode without the app around the
   page, and every page exported as a picture (one .zip, written here: STORE only, no library). */

const CRD_SIZES = { letter: [612, 792, 'Letter'], a4: [595.28, 841.89, 'A4'], legal: [612, 1008, 'Legal'] };
const CRD_PIC_SIZES = { fit: 'Fit each picture', letter: 'Letter, with margins', a4: 'A4, with margins' };
const crdModKey = isMac ? '⌘' : 'Ctrl+';
const crdIsImage = (f) => /^image\//i.test(f.type) || /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(f.name || '');
const crdIsPdf = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || '');
const crdBase = (name) => String(name || '').replace(/\.[a-z0-9]+$/i, '') || 'Untitled';
const crdOpt = (v, label, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
const crdTyping = () => { const a = document.activeElement; return !!a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable); };

addStyle(`
.crd-form { display: grid; grid-template-columns: auto 1fr; gap: 10px 14px; align-items: center; margin: 8px 0 4px; }
.crd-form label { color: var(--ink-2); }
.crd-form select, .crd-form input { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-width: 0; width: 100%; box-sizing: border-box; }
.crd-seg { justify-self: start; }
.crd-note { font-size: 12px; color: var(--ink-3); margin: 4px 0 0; }
.crd-paste { border: 1.5px dashed var(--line); border-radius: 12px; padding: 22px 16px; text-align: center; color: var(--ink-2); background: var(--chrome); margin: 8px 0; outline: none; caret-color: transparent; }
.crd-paste:focus { border-color: var(--accent); }
.crd-paste kbd { font: 600 13px var(--font-mono); background: var(--surface); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; color: var(--ink); }
.crd-drop-new { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 4px; margin-top: -6px; }
.crd-drop-new .btn { height: 30px; padding: 0 10px; font-size: 13px; }
.crd-bar { position: fixed; z-index: 25; left: 50%; transform: translateX(-50%); bottom: calc(44px + env(safe-area-inset-bottom, 0px)); display: flex; align-items: center; gap: 4px; background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 14px; padding: 5px 6px; box-shadow: 0 10px 32px rgba(0,0,0,.22); max-width: calc(100vw - 24px); box-sizing: border-box; }
.crd-bar[hidden] { display: none; }
.crd-bar .icon-btn { width: 34px; height: 34px; color: var(--ink); }
.crd-bar .icon-btn.crd-main { background: var(--brand); color: #FFFFFF; border-radius: 10px; }
.crd-bar .icon-btn.crd-main:hover { background: var(--brand-hover); }
.crd-bar select { font: inherit; font-size: 13px; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 5px 6px; min-width: 0; }
.crd-bar .crd-voice { max-width: 190px; }
.crd-bar .crd-where { font-size: 13px; color: var(--ink-3); padding: 0 6px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.crd-bar [data-crd="stop"] svg { fill: currentColor; width: 14px; height: 14px; } /* a filled square: the media Stop, not a checkbox */
.crd-say { position: absolute; z-index: 1; pointer-events: none; background: color-mix(in srgb, var(--accent) 26%, transparent); border-radius: 2px; mix-blend-mode: multiply; }
:root[data-theme="dark"] .crd-say { mix-blend-mode: normal; background: rgba(240, 136, 159, .30); }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .crd-say { mix-blend-mode: normal; background: rgba(240, 136, 159, .30); } }
.app.crd-reading { grid-template-rows: 1fr; }
.app.crd-reading > .titlebar, .app.crd-reading > .ribbon, .app.crd-reading > .statusbar, .app.crd-reading .sidebar { display: none; }
.app.crd-reading .workspace, .app.crd-reading[data-sidebar] .workspace { grid-template-columns: 1fr; }
.app.crd-reading .pages { padding-top: calc(16px + env(safe-area-inset-top, 0px)); padding-bottom: 96px; }
.crd-bar.crd-readbar { left: auto; right: max(16px, env(safe-area-inset-right, 0px)); transform: none; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); opacity: .75; transition: opacity .2s; }
.crd-bar.crd-readbar:hover, .crd-bar.crd-readbar:focus-within { opacity: 1; }
.app.crd-reading ~ .crd-saybar { bottom: calc(72px + env(safe-area-inset-bottom, 0px)); }
@media (max-width: 760px), (max-height: 500px) and (pointer: coarse) {
  .crd-bar { bottom: calc(52px + env(safe-area-inset-bottom, 0px)); }
  .crd-bar .crd-voice { max-width: 104px; }
  .crd-bar .crd-where { display: none; }
  .crd-form { grid-template-columns: 1fr; gap: 4px; }
  .crd-form label { margin-top: 6px; }
}
`);

/* ---- making PDFs ---- */
async function crdBlankPdf({ size = 'letter', landscape = false, pages = 1 } = {}) {
  const L = await loadPdfLib();
  const [w, h] = CRD_SIZES[size] || CRD_SIZES.letter;
  const pdf = await L.PDFDocument.create();
  for (let k = 0; k < Math.max(1, Math.min(500, pages | 0)); k++) pdf.addPage(landscape ? [h, w] : [w, h]);
  pdf.setTitle('Untitled'); pdf.setCreator('Cowdrey.PDF'); pdf.setProducer('Cowdrey.PDF');
  return pdf.save();
}
// Decodes a picture with the browser (whatever it can read: PNG, JPEG, WebP, GIF, HEIC on Apple devices…) and
// draws it on a canvas, the right way up, at most 4000 pixels on its longer side.
async function crdDecode(blob) {
  let src, close = () => {};
  try { src = await createImageBitmap(blob); close = () => src.close && src.close(); }
  catch {
    const url = URL.createObjectURL(blob);
    try { src = new Image(); src.src = url; await src.decode(); }
    catch { throw new Error('not a picture this device can read'); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  }
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('the picture is empty');
  const k = Math.min(1, 4000 / Math.max(w0, h0));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w0 * k)); c.height = Math.max(1, Math.round(h0 * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); close();
  return { canvas: c, w: w0, h: h0, opaque: /jpe?g|heic|heif/i.test(blob.type || '') || /\.(jpe?g|heic|heif)$/i.test(blob.name || '') };
}
const crdCanvasBytes = async (c, type, q) => new Uint8Array(await (await new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error('could not encode the picture')), type, q))).arrayBuffer());
// One picture per page, in the order given. size: fit (the page is the picture, at 96 dpi, no larger than A3) or
// letter / a4 (turned to match the picture, 0.5 inch margins, never enlarged past its own size).
async function crdPicturesPdf(files, size = 'fit') {
  const L = await loadPdfLib();
  const pdf = await L.PDFDocument.create();
  const failed = [];
  for (const f of files) {
    let pic;
    try { pic = await crdDecode(f); } catch (e) { failed.push(f.name || 'a picture'); continue; }
    const img = pic.opaque ? await pdf.embedJpg(await crdCanvasBytes(pic.canvas, 'image/jpeg', .92)) : await pdf.embedPng(await crdCanvasBytes(pic.canvas, 'image/png'));
    let iw = pic.w * .75, ih = pic.h * .75;
    if (size === 'fit') {
      const k = Math.min(1, 1190.55 / Math.max(iw, ih)); iw *= k; ih *= k;
      pdf.addPage([iw, ih]).drawImage(img, { x: 0, y: 0, width: iw, height: ih });
    } else {
      let [pw, ph] = CRD_SIZES[size] || CRD_SIZES.letter; if (iw > ih) [pw, ph] = [ph, pw];
      const M = 36, k = Math.min(1, (pw - 2 * M) / iw, (ph - 2 * M) / ih); iw *= k; ih *= k;
      pdf.addPage([pw, ph]).drawImage(img, { x: (pw - iw) / 2, y: (ph - ih) / 2, width: iw, height: ih });
    }
  }
  if (failed.length) toast(`Could not read ${failed.length === 1 ? failed[0] : failed.length + ' pictures'}: this device can't open that kind of picture.`);
  if (!pdf.getPageCount()) return null;
  pdf.setCreator('Cowdrey.PDF'); pdf.setProducer('Cowdrey.PDF');
  return pdf.save();
}

/* ---- dialogs ---- */
async function crdNewBlank() {
  const size = S.crdBlankSize || 'letter', land = !!S.crdBlankLandscape;
  const res = await dialog('New blank PDF', `<div class="crd-form">
    <label for="crdSize">Page size</label><select id="crdSize">${Object.entries(CRD_SIZES).map(([k, v]) => crdOpt(k, v[2], k === size)).join('')}</select>
    <span id="crdOriL">Orientation</span><div class="seg crd-seg" role="radiogroup" aria-labelledby="crdOriL"><label><input type="radio" name="crdOri" value="p"${land ? '' : ' checked'}>Portrait</label><label><input type="radio" name="crdOri" value="l"${land ? ' checked' : ''}>Landscape</label></div>
    <label for="dlgInput">Pages</label><input id="dlgInput" type="number" min="1" max="500" value="1" inputmode="numeric">
  </div>`, [{ label: 'Cancel' }, { label: 'Create', value: 'ok', primary: true }]);
  if (res == null) return;
  const dlg = $('#dialog');
  const opts = { size: $('#crdSize', dlg).value, landscape: $('input[name="crdOri"]:checked', dlg).value === 'l', pages: Math.max(1, Math.min(500, parseInt($('#dlgInput', dlg).value, 10) || 1)) };
  S.crdBlankSize = opts.size; S.crdBlankLandscape = opts.landscape; saveSettings();
  await crdOpenNew(await crdBlankPdf(opts), 'Untitled.pdf');
}
async function crdOpenNew(bytes, name) {
  if (!bytes) return false;
  return serial(() => openBytes(bytes, name));
}
// The picker for pictures. A file input works the same in browsers and in the apps.
const crdPicInput = document.createElement('input');
crdPicInput.type = 'file'; crdPicInput.multiple = true; crdPicInput.hidden = true; crdPicInput.id = 'crdPicInput';
crdPicInput.accept = 'image/*,.heic,.heif';
document.body.appendChild(crdPicInput);
crdPicInput.addEventListener('change', () => { const files = [...crdPicInput.files]; crdPicInput.value = ''; if (files.length) crdPicturesChosen(files); });
// Pictures picked or dropped: ask how to lay them out (and, with a PDF open, where they go), then make the pages.
async function crdPicturesChosen(files) {
  files = files.filter(crdIsImage);
  if (!files.length) { toast('Those files are not pictures'); return; }
  const size = S.crdPicSize || 'fit';
  const n = files.length;
  const res = await dialog(n === 1 ? 'PDF from a picture' : `PDF from ${n} pictures`, `<p>One picture per page, in the order you picked them.</p><div class="crd-form">
    <label for="crdPicSize">Page size</label><select id="crdPicSize">${Object.entries(CRD_PIC_SIZES).map(([k, v]) => crdOpt(k, v, k === size)).join('')}</select>
    ${has() ? `<label for="crdPicWhere">Put ${n === 1 ? 'it' : 'them'} in</label><select id="crdPicWhere">${crdOpt('new', 'A new PDF', true)}${crdOpt('add', `This PDF, after page ${current + 1}`)}</select>` : ''}
  </div>`, [{ label: 'Cancel' }, { label: 'Create', value: 'ok', primary: true }]);
  if (res == null) return;
  const dlg = $('#dialog');
  S.crdPicSize = $('#crdPicSize', dlg).value; saveSettings();
  const where = has() && $('#crdPicWhere', dlg) ? $('#crdPicWhere', dlg).value : 'new';
  try {
    const bytes = await crdPicturesPdf(files, S.crdPicSize);
    if (!bytes) return;
    if (where === 'add') { const at = current + 1; if (await addSource(bytes, null, at, 'the pictures')) { toast(`Added ${n === 1 ? 'a page' : n + ' pages'}`); setTimeout(() => goPage(at), 100); } }
    else await crdOpenNew(bytes, (n === 1 ? crdBase(files[0].name) : 'Untitled') + '.pdf');
  } catch (e) { console.error(e); toast(`Could not make the PDF: ${e.message || e}`); }
}

/* ---- the clipboard ---- */
let crdWaitingPaste = false;
async function crdFromClipboard() {
  crdWaitingPaste = true;
  const touch = matchMedia('(pointer: coarse)').matches;
  await dialog('From the clipboard', `<p>Copy a picture (a screenshot, or one from a web page or another app), then paste it here.</p>
    <div class="crd-paste" id="crdPasteZone" contenteditable="true" role="textbox" aria-label="Paste a picture here" spellcheck="false">${touch ? 'Touch and hold here, then choose Paste' : `Press <kbd>${crdModKey}V</kbd> to paste`}</div>
    <p class="crd-note">Browsers only hand over the clipboard when you paste, so this waits for you to do it. You can also paste anywhere in the app.</p>`, [{ label: 'Cancel' }], (dlg) => {
    const z = $('#crdPasteZone', dlg);
    const keep = z.innerHTML;
    z.addEventListener('input', () => { z.innerHTML = keep; });
    setTimeout(() => z.focus(), 0);
  });
  crdWaitingPaste = false;
}
const crdClipImage = (dt) => { if (!dt) return null; for (const it of dt.items || []) if (it.kind === 'file' && /^image\//.test(it.type)) return it.getAsFile(); for (const f of dt.files || []) if (/^image\//.test(f.type)) return f; return null; };
document.addEventListener('paste', (e) => {
  const inZone = e.target && e.target.closest && e.target.closest('#crdPasteZone');
  if (!inZone && ($('#dialog').open || crdTyping())) return;
  const f = crdClipImage(e.clipboardData);
  if (!f) { if (inZone) { e.preventDefault(); toast('There is no picture on the clipboard'); } return; }
  e.preventDefault();
  if (inZone) { const x = $('#dialog [data-x]'); x && x.click(); }
  crdPasted(f);
});
// A pasted picture: a new one-page PDF, or with a PDF open, a new page or a picture placed on the page.
async function crdPasted(file) {
  let how = 'new';
  if (has()) {
    how = await dialog('Paste picture', `<p>Add the picture as a new page after page ${current + 1}, or place it on the page?</p>`, [{ label: 'Cancel' }, { label: 'New PDF', value: 'new' }, { label: 'New page', value: 'page' }, { label: 'Place on page', value: 'place', primary: true }]);
    if (!how) return;
  }
  try {
    if (how === 'place') {
      const pic = await crdDecode(file);
      const w = Math.min(240, pic.w * .75), h = w * pic.h / pic.w;
      pendingImage = { data: pic.canvas.toDataURL('image/png'), w, h };
      setTool('image'); toast('Click where the picture goes');
      return;
    }
    const bytes = await crdPicturesPdf([file], 'fit');
    if (!bytes) return;
    if (how === 'page') { const at = current + 1; if (await addSource(bytes, [0], at, 'the picture')) setTimeout(() => goPage(at), 100); }
    else await crdOpenNew(bytes, 'Pasted picture.pdf');
  } catch (e) { console.error(e); toast(`Could not use the picture: ${e.message || e}`); }
}

/* ---- dropping pictures (when no PDF is dropped) ---- */
window.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer ? e.dataTransfer.files : [])];
  if (!files.length || files.some(crdIsPdf)) return; // PDFs are opened by the app itself
  const pics = files.filter(crdIsImage);
  if (!pics.length) return;
  e.preventDefault();
  crdPicturesChosen(pics);
});

/* ---- read aloud ---- */
const crdSay = { on: false, paused: false, n: 0, k: 0, sents: [], items: [], token: 0, start: 0, fails: 0 };
const crdSynth = () => window.speechSynthesis;
const crdVoices = () => { try { return crdSynth().getVoices() || []; } catch { return []; } };
// Sentences of a page, each with the text items it covers (for the highlight). Long runs are cut at an item edge.
function crdSentences(items) {
  const out = []; let text = '', idx = new Set(), last = null;
  const push = () => { const t = text.replace(/\s+/g, ' ').trim(); if (/[\p{L}\p{N}]/u.test(t)) out.push({ text: t, items: [...idx] }); text = ''; idx = new Set(); };
  items.forEach((it, i) => {
    const s = it.str || '';
    if (!s && !it.hasEOL) return;
    // A heading, or a new block further down the page, starts a new sentence even without a full stop.
    if (s.trim() && it.transform) {
      const y = it.transform[5], hh = it.height || 10;
      if (last && (Math.abs(y - last.y) > 1.9 * Math.max(hh, last.h) || Math.max(hh, last.h) > 1.45 * Math.min(hh, last.h))) push();
      last = { y, h: hh };
    }
    let rest = s;
    while (rest) {
      const m = rest.match(/^(.*?[.!?…]+["'”’)\]]*)(\s+|$)/);
      if (!m) { text += rest; if (rest.trim()) idx.add(i); rest = ''; break; }
      text += m[1]; if (m[1].trim()) idx.add(i); rest = rest.slice(m[0].length);
      if (m[2] || !rest) push();
    }
    if (it.hasEOL) text += ' ';
    if (text.length > 260) push();
  });
  push();
  return out;
}
function crdSayBar() {
  let bar = $('#crdSayBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'crd-bar crd-saybar'; bar.id = 'crdSayBar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Read aloud');
  bar.innerHTML = `<button type="button" class="icon-btn crd-main" data-crd="play" title="Pause" aria-label="Pause">${ic('pause')}</button>
    <button type="button" class="icon-btn" data-crd="stop" title="Stop" aria-label="Stop">${ic('square')}</button>
    <span class="crd-where" id="crdSayWhere"></span>
    <select class="crd-voice" id="crdSayVoice" aria-label="Voice"></select>
    <select id="crdSayRate" aria-label="Speed">${[.75, 1, 1.25, 1.5, 1.75, 2].map((r) => crdOpt(r, r + '×', r === (S.crdRate || 1))).join('')}</select>`;
  app.after(bar);
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-crd]'); if (!b) return; if (b.dataset.crd === 'stop') crdSayStop(); else crdSayToggle(); });
  $('#crdSayRate', bar).onchange = (e) => { S.crdRate = +e.target.value; saveSettings(); crdSayRestart(); };
  $('#crdSayVoice', bar).onchange = (e) => { S.crdVoice = e.target.value; saveSettings(); crdSayRestart(); };
  crdFillVoices();
  icons();
  return bar;
}
function crdFillVoices() {
  const sel = $('#crdSayVoice'); if (!sel) return;
  const vs = crdVoices().slice().sort((a, b) => (b.default - a.default) || String(a.lang).localeCompare(b.lang) || String(a.name).localeCompare(b.name));
  sel.innerHTML = crdOpt('', 'Voice', !S.crdVoice) + vs.map((v) => crdOpt(v.voiceURI, `${v.name}${v.lang ? ' (' + v.lang + ')' : ''}`, v.voiceURI === S.crdVoice)).join('');
}
try { if (window.speechSynthesis && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', crdFillVoices); } catch {}
function crdSayUi() {
  const bar = crdSayBar();
  bar.hidden = !crdSay.on;
  const b = $('[data-crd="play"]', bar), playing = crdSay.on && !crdSay.paused;
  b.innerHTML = ic(playing ? 'pause' : 'play'); b.title = playing ? 'Pause' : 'Play'; b.setAttribute('aria-label', b.title);
  $('#crdSayWhere', bar).textContent = crdSay.on ? `Page ${crdSay.n + 1} of ${doc ? doc.pages.length : 0}` : '';
  icons(); refreshRibbon();
}
function crdSayStart() {
  if (!has() || !crdSynth()) return;
  if (crdSay.on) { crdSayToggle(); return; }
  Object.assign(crdSay, { on: true, paused: false, start: current, fails: 0 });
  crdSayUi();
  crdSayPage(current, 0);
}
async function crdSayPage(n, k) {
  const token = ++crdSay.token;
  if (!doc || n >= doc.pages.length) { crdSayStop(); toast('Finished reading'); return; }
  const tc = await (await pageOf(doc.pages[n])).getTextContent();
  if (token !== crdSay.token) return;
  Object.assign(crdSay, { n, k, items: tc.items, sents: crdSentences(tc.items) });
  if (n !== current) goPage(n);
  crdSayUi();
  if (!crdSay.sents.length) { crdSayPage(n + 1, 0); return; }
  crdSaySpeak();
}
function crdSaySpeak() {
  const token = ++crdSay.token;
  const s = crdSay.sents[crdSay.k];
  if (!s) { crdSayPage(crdSay.n + 1, 0); return; }
  const u = new SpeechSynthesisUtterance(s.text);
  u.rate = S.crdRate || 1;
  const v = S.crdVoice && crdVoices().find((x) => x.voiceURI === S.crdVoice);
  if (v) { u.voice = v; u.lang = v.lang; }
  let began = false;
  const next = () => { if (token !== crdSay.token || !crdSay.on || crdSay.paused) return; crdSay.k++; crdSaySpeak(); };
  u.onstart = () => { began = true; crdSay.fails = 0; };
  u.onend = () => { began = true; crdSay.fails = 0; next(); };
  // When speech can't work (no voice, no sound, not allowed), reading stops with a message, back on the page it
  // began on. It never skips on through the document. One sentence that fails is skipped, three in a row stop it.
  u.onerror = (e) => {
    const err = String((e && e.error) || '');
    if (/interrupted|canceled/.test(err) || token !== crdSay.token || !crdSay.on) return;
    if (/synthesis-failed|synthesis-unavailable|not-allowed|voice-unavailable|language-unavailable|audio-busy|audio-hardware|network/.test(err) || ++crdSay.fails >= 3) return crdSayFail(err);
    next();
  };
  crdSayPaint();
  crdSynth().speak(u);
  // Some systems have no voice at all and never answer: nothing starts, nothing is queued.
  setTimeout(() => { const sy = crdSynth(); if (!began && token === crdSay.token && crdSay.on && !crdSay.paused && sy && sy.speaking === false && sy.pending === false) crdSayFail('synthesis-unavailable'); }, 8000);
}
function crdSayFail(err) {
  const back = crdSay.start ?? crdSay.n;
  crdSayStop();
  if (doc && back < doc.pages.length && back !== current) goPage(back);
  toast(err === 'not-allowed' ? 'Read aloud needs a click to start. Choose Read aloud again.' : 'Read aloud isn\'t available: no voice could speak. Check your system\'s voices.');
}
function crdSayToggle() {
  if (!crdSay.on) return crdSayStart();
  crdSay.paused = !crdSay.paused;
  // Pausing cancels and resuming says the sentence again: pause() and resume() don't work everywhere.
  if (crdSay.paused) { crdSay.token++; crdSynth().cancel(); } else crdSaySpeak();
  crdSayUi();
}
function crdSayRestart() { if (!crdSay.on || crdSay.paused) return; crdSay.token++; crdSynth().cancel(); crdSaySpeak(); }
function crdSayStop() {
  const was = crdSay.on;
  Object.assign(crdSay, { on: false, paused: false, sents: [], items: [] }); crdSay.token++;
  if (was) try { crdSynth().cancel(); } catch {}
  crdSayPaint(); if ($('#crdSayBar')) crdSayUi();
}
// Highlights the sentence being read, from the positions of its text on the page.
function crdSayPaint(only) {
  for (const v of only ? [only] : views) $$('.crd-say', v.el).forEach((x) => x.remove());
  if (!crdSay.on) return;
  const v = views[crdSay.n], s = crdSay.sents[crdSay.k];
  if (!v || !v.rendered || !s || (only && only !== v)) return;
  let first = null;
  for (const i of s.items) {
    const it = crdSay.items[i]; if (!it || !it.transform) continue;
    const [a, b, , , e, f] = it.transform, h = it.height || Math.hypot(a, b) || 10;
    if (Math.abs(b) > Math.abs(a)) continue; // rotated text: not worth guessing
    const [x1, y1] = v.viewport.convertToViewportPoint(e, f - h * .22), [x2, y2] = v.viewport.convertToViewportPoint(e + (it.width || 0), f + h * .9);
    const r = [x1, y1, x2, y2];
    const box = document.createElement('div'); box.className = 'crd-say';
    Object.assign(box.style, { left: Math.min(r[0], r[2]) + 'px', top: Math.min(r[1], r[3]) + 'px', width: Math.abs(r[2] - r[0]) + 'px', height: Math.abs(r[3] - r[1]) + 'px' });
    v.el.appendChild(box); first = first || box;
  }
  if (first) {
    const vr = viewer.getBoundingClientRect(), br = first.getBoundingClientRect();
    if (br.top < vr.top + 40 || br.bottom > vr.bottom - 120) viewer.scrollBy({ top: br.top - vr.top - vr.height / 3, behavior: 'smooth' });
  }
}
FEATURE.afterRender.push((v) => { if (crdSay.on && views[crdSay.n] === v) crdSayPaint(v); });
FEATURE.onDocShown.push(() => { crdSayStop(); });
FEATURE.onDocClosed.push(() => { crdSayStop(); });

/* ---- read mode ---- */
function crdReadBar() {
  let bar = $('#crdReadBar');
  if (bar) return bar;
  bar = document.createElement('div');
  bar.className = 'crd-bar crd-readbar'; bar.id = 'crdReadBar'; bar.hidden = true; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Read mode');
  bar.innerHTML = `<button type="button" class="icon-btn" data-crd="prev" title="Previous page" aria-label="Previous page">${ic('chevron-left')}</button>
    <span class="crd-where" id="crdReadWhere" style="display:inline"></span>
    <button type="button" class="icon-btn" data-crd="next" title="Next page" aria-label="Next page">${ic('chevron-right')}</button>
    <button type="button" class="icon-btn" data-crd="exit" title="Exit read mode (Esc)" aria-label="Exit read mode">${ic('minimize-2')}</button>`;
  app.after(bar);
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-crd]'); if (!b) return;
    if (b.dataset.crd === 'exit') crdReadMode(false);
    else goPage(current + (b.dataset.crd === 'next' ? 1 : -1));
    crdReadWhere();
  });
  icons();
  return bar;
}
const crdReading = () => app.classList.contains('crd-reading');
function crdReadWhere() { const w = $('#crdReadWhere'); if (w) w.textContent = doc ? `${current + 1} / ${doc.pages.length}` : ''; }
// Each page is shown whole: the zoom fits the page in the window while reading, and comes back on leaving.
let crdZoomBefore = null;
function crdReadMode(on = !crdReading()) {
  if (on === crdReading()) return;
  if (on && !has()) return;
  closePopover();
  app.classList.toggle('crd-reading', on);
  crdReadBar().hidden = !on; crdReadWhere();
  if (on) toast(coarse() ? 'Read mode: the arrows at the bottom turn the pages' : 'Read mode: arrow keys turn the pages, Esc leaves');
  const at = current;
  setTimeout(async () => {
    if (on) { crdZoomBefore = S.zoom; await crdReadFit(at); }
    else if (crdZoomBefore != null) { S.zoom = crdZoomBefore; crdZoomBefore = null; }
    if (doc) { await layoutPages(true); goPage(at, true); }
  }, 30);
  refreshRibbon();
}
async function crdReadFit(n) {
  const e = doc && doc.pages[n]; if (!e) return;
  const page = await pageOf(e), vp = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
  S.zoom = Math.max(25, Math.min(400, 100 * Math.min((viewer.clientWidth - 32) / vp.width, (viewer.clientHeight - 112) / vp.height)));
}
let crdResizeTimer;
window.addEventListener('resize', () => { if (!crdReading() || !doc) return; clearTimeout(crdResizeTimer); crdResizeTimer = setTimeout(async () => { const at = current; await crdReadFit(at); await layoutPages(true); goPage(at, true); }, 250); });
// Don't keep the reading zoom as the zoom for next time.
window.addEventListener('pagehide', () => { if (crdZoomBefore != null) { S.zoom = crdZoomBefore; saveSettings(); } });
viewer.addEventListener('scroll', () => { if (crdReading()) crdReadWhere(); }, { passive: true });
FEATURE.onDocShown.push(() => { if (crdReading()) crdReadWhere(); });

document.addEventListener('keydown', (e) => {
  if ($('#dialog').open || crdTyping()) return;
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === 'F11' || (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'r')) { if (has() || crdReading()) { e.preventDefault(); crdReadMode(); } return; }
  if (!crdReading() || mod || e.altKey) return;
  if (e.key === 'Escape') { e.preventDefault(); crdReadMode(false); return; }
  const d = { ArrowDown: 1, ArrowUp: -1, ' ': e.shiftKey ? -1 : 1, Home: -1e6, End: 1e6 }[e.key];
  if (d) { e.preventDefault(); goPage(current + d); }
  if (/^Arrow|Page|Home|End| /.test(e.key)) setTimeout(crdReadWhere, 0);
});

/* ---- export every page as a picture ---- */
const CRD_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crdCrc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRD_CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
// A .zip with the files stored as they are (pictures are compressed already). UTF-8 names.
function crdZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name), data = f.data, crc = crdCrc32(data);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, time, true); h.setUint16(12, day, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, time, true); c.setUint16(14, day, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let k = 0;
  for (const p of all) { out.set(p, k); k += p.length; }
  return out;
}
async function crdExportPages() {
  const N = doc.pages.length;
  const res = await dialog('Export pages as pictures', `<div class="crd-form">
    <label for="crdFmt">Format</label><select id="crdFmt">${crdOpt('png', 'PNG', S.crdFmt !== 'jpeg')}${crdOpt('jpeg', 'JPEG', S.crdFmt === 'jpeg')}</select>
    <label for="crdDpi">Resolution</label><select id="crdDpi">${[[72, '72 dpi (screen)'], [150, '150 dpi'], [300, '300 dpi (print)']].map(([d, l]) => crdOpt(d, l, d === (S.crdDpi || 150))).join('')}</select>
    <label for="dlgInput">Pages</label><input id="dlgInput" type="text" value="${N === 1 ? '1' : '1-' + N}" autocomplete="off">
  </div><p class="crd-note">For example 1-3, 5. ${N === 1 ? 'The page is saved as a picture.' : 'More than one page is saved as one .zip file.'} Your mark-up is included.</p>`, [{ label: 'Cancel' }, { label: 'Export', value: 'ok', primary: true }]);
  if (res == null) return;
  const dlg = $('#dialog');
  const opts = { format: $('#crdFmt', dlg).value, dpi: +$('#crdDpi', dlg).value, range: $('#dlgInput', dlg).value };
  S.crdFmt = opts.format; S.crdDpi = opts.dpi; saveSettings();
  return crdExportRun(opts);
}
// Renders the chosen pages (from the saved PDF, so mark-up and edits are in them) and saves one picture or a .zip.
async function crdExportRun({ format = 'png', dpi = 150, range } = {}) {
  const want = parseRange(range || `1-${doc.pages.length}`, doc.pages.length);
  if (!want.length) { toast('No pages in that range'); return null; }
  const type = format === 'jpeg' ? 'image/jpeg' : 'image/png', ext = format === 'jpeg' ? 'jpg' : 'png';
  try {
    const bytes = await buildPdf(want);
    if (!bytes) return null;
    await loadPdfjs();
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false }), pd = await task.promise;
    const files = [];
    try {
      for (let k = 0; k < want.length; k++) {
        if (want.length > 1) toast(`Exporting page ${k + 1} of ${want.length}…`);
        const page = await pd.getPage(k + 1);
        let s = dpi / 72; const v1 = page.getViewport({ scale: 1 });
        s = Math.min(s, Math.sqrt(16e6 / (v1.width * v1.height))); // phones can't draw larger canvases
        const vp = page.getViewport({ scale: s });
        const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, canvasContext: g, viewport: vp }).promise;
        files.push({ name: `${doc.name} page ${want[k] + 1}.${ext}`, data: await crdCanvasBytes(c, type, .92) });
        c.width = c.height = 0;
      }
    } finally { task.destroy(); }
    const out = files.length === 1 ? files[0] : { name: `${doc.name} pages.zip`, data: crdZip(files), type: 'application/zip' };
    await saveFile(out.data, out.name, out.type || type);
    return out.name;
  } catch (e) { console.error(e); toast(`Could not export the pages: ${e.message || e}`); return null; }
}

/* ---- commands, menus, ribbon, the empty screen ---- */
cmd('crdNewBlank', { label: 'New blank PDF…', icon: 'file-plus', run: crdNewBlank });
cmd('crdNewPictures', { label: 'New PDF from pictures…', icon: 'images', run: () => crdPicInput.click() });
cmd('crdNewClip', { label: 'New PDF from clipboard…', icon: 'clipboard-paste', run: crdFromClipboard });
cmd('crdBlank', { label: 'Blank PDF…', icon: 'file-plus', run: crdNewBlank });
cmd('crdPictures', { label: 'From pictures…', icon: 'images', run: () => crdPicInput.click() });
cmd('crdClip', { label: 'From clipboard…', icon: 'clipboard-paste', run: crdFromClipboard });
cmd('crdReadAloud', { label: 'Read aloud', icon: 'volume-2', enabled: has, pressed: () => crdSay.on, hidden: !('speechSynthesis' in window) || typeof window.SpeechSynthesisUtterance !== 'function', run: () => (crdSay.on ? crdSayStop() : crdSayStart()) });
cmd('crdReadMode', { label: 'Read mode', icon: 'book-open-text', key: 'Mod-Shift-r', enabled: () => has() || crdReading(), pressed: crdReading, run: () => crdReadMode() });
cmd('crdExportPages', { rlabel: 'All pages as pictures', label: 'Export all pages as pictures…', icon: 'gallery-vertical-end', enabled: has, run: crdExportPages });
MENUS.find(([t]) => t === 'File')[1].unshift('crdNewBlank', 'crdNewPictures', 'crdNewClip', '-');
{ const f = MENUS.find(([t]) => t === 'File')[1]; f.splice(f.indexOf('exportImage') + 1, 0, 'crdExportPages'); }
menuAdd('View', ['crdReadMode', 'crdReadAloud']);
ribbonAdd('home', 'Create', ['crdBlank', 'crdPictures', 'crdClip'], 'Edit');
ribbonAdd('home', 'Read', ['crdReadAloud', 'crdReadMode']);
ribbonAdd('export', 'Export', ['crdExportPages']);
{
  const card = $('#drop .card');
  if (card) {
    const row = document.createElement('div'); row.className = 'crd-drop-new';
    row.innerHTML = `<button class="btn link" type="button" data-cmd="crdNewBlank">${ic('file-plus')}<span>New blank PDF</span></button><button class="btn link" type="button" data-cmd="crdNewPictures">${ic('images')}<span>PDF from pictures</span></button>`;
    card.appendChild(row);
    const p = $('p', card); if (p) p.textContent = coarse() ? 'Open a PDF from Files, or start a new one. It stays on this device.' : 'Drop a PDF or pictures here, or open one from your device. It stays on this device.';
  }
}

Object.assign(TEST_HOOKS, {
  crdPicturesChosen, crdPicturesPdf, crdBlankPdf, crdExportRun, crdZip, crdCrc32, crdSentences,
  crdSayState: () => ({ on: crdSay.on, paused: crdSay.paused, n: crdSay.n, k: crdSay.k, sents: crdSay.sents.map((s) => s.text) }),
});
