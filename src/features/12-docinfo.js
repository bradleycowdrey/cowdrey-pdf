/* ---------------- document properties (src/features/12-docinfo.js) ----------------
   File > Document properties (Ctrl/Cmd+D), like PDFelement's: the file's name, size, page size, page count, PDF
   version, producer and creator, dates, what its security allows, and the fonts it uses (read only), plus its Title,
   Author, Subject and Keywords, which can be changed.
   docMarks(): { id, type: 'docinfo', title?, author?, subject?, keywords? } — only the fields that were changed (a
   cleared field is ''), so undo, Documents and saving keep them. Saving writes them into the PDF's Info dictionary.
   On save, the Info fields of the opened file are kept too when the pages are copied into a new PDF; the core only
   sets the title to the file name when the PDF has none. */

const DI_FIELDS = [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords']];
const diMark = () => (doc ? docMarks().find((m) => m.type === 'docinfo') : null);
const diPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function diSize(b) {
  if (b < 1024) return diPlural(b, 'byte');
  const kb = b / 1024; if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024; return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
function diDate(raw) {
  if (!raw) return '';
  let d = null; try { d = pdfjs.PDFDateString.toDateObject(raw); } catch {}
  return d && !Number.isNaN(+d) ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : String(raw);
}
// The page in view: "8.5 × 11 in (216 × 279 mm)"
async function diPageSize() {
  const e = doc.pages[current] || doc.pages[0]; if (!e) return '';
  const pg = await pageOf(e); const vp = pg.getViewport({ scale: 1, rotation: (pg.rotate + e.rot) % 360 });
  const r = (x, k) => Math.round(x * k) / k;
  return `${r(vp.width / 72, 100)} × ${r(vp.height / 72, 100)} in (${Math.round(vp.width / 72 * 25.4)} × ${Math.round(vp.height / 72 * 25.4)} mm)`;
}
// What the opened file's security allows: [[label, allowed: true | false | 'low']]
async function diSecurity() {
  const pd = pdfDocs.get(0);
  let flags = null; try { const f = await pd.getPermissions(); flags = f ? [...f] : null; } catch {}
  const F = pdfjs.PermissionFlag || {}; const can = (f) => !flags || flags.includes(f);
  return {
    password: !!doc.sources[0].password,
    restricted: !!flags,
    rows: [
      ['Printing', can(F.PRINT) ? (can(F.PRINT_HIGH_QUALITY) ? true : 'low') : false],
      ['Copying text and images', can(F.COPY)],
      ['Changing the document', can(F.MODIFY_CONTENTS)],
      ['Commenting', can(F.MODIFY_ANNOTATIONS)],
      ['Filling in forms', can(F.FILL_INTERACTIVE_FORMS) || can(F.MODIFY_ANNOTATIONS)],
      ['Page extraction', can(F.ASSEMBLE)],
    ],
  };
}
// The fonts the document's pages use: [{ name, type, embedded: 'Embedded' | 'Embedded subset' | 'Not embedded' }]
async function diFonts() {
  const L = await loadPdfLib(); const { PDFDocument, PDFName, PDFDict, PDFStream, PDFRef } = L; const N = PDFName.of;
  const list = new Map();
  for (const k of new Set(doc.pages.map((e) => e.src))) {
    const src = doc.sources[k]; let d;
    try { d = src.password ? await PDFDocument.load(src, { password: src.password, updateMetadata: false }) : await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false }); }
    catch { continue; }
    if (d.isEncrypted && !src.password) { try { d = await PDFDocument.load(src, { password: '', updateMetadata: false }); } catch {} }
    const pages = d.getPages(), seen = new Set();
    const nameOf = (o) => (o ? String(o).replace(/^\//, '') : '');
    const addFont = (ref, f) => {
      const key = ref ? `${k}:${ref}` : null; if (key && seen.has(key)) return; if (key) seen.add(key);
      if (!(f instanceof PDFDict)) return;
      const sub = nameOf(f.get(N('Subtype')));
      let base = nameOf(f.get(N('BaseFont'))) || (sub === 'Type3' ? '(Type 3 font)' : '(unnamed)');
      let fd = f.lookup(N('FontDescriptor')), type = { Type1: 'Type 1', MMType1: 'Type 1 (multiple master)', TrueType: 'TrueType', Type3: 'Type 3' }[sub] || sub;
      if (sub === 'Type0') {
        const desc = f.lookup(N('DescendantFonts')); const cid = desc && desc.asArray().length ? d.context.lookup(desc.get(0)) : null;
        if (cid instanceof PDFDict) { fd = cid.lookup(N('FontDescriptor')); type = nameOf(cid.get(N('Subtype'))) === 'CIDFontType2' ? 'TrueType (CID)' : 'Type 1 (CID)'; }
      }
      let file = null;
      if (fd instanceof PDFDict) for (const ff of ['FontFile', 'FontFile2', 'FontFile3']) { const s = fd.lookup(N(ff)); if (s) { file = [ff, s]; break; } }
      if (file && file[0] === 'FontFile3' && file[1] instanceof PDFStream) { const st = nameOf(file[1].dict.get(N('Subtype'))); if (st === 'OpenType') type = 'OpenType'; else if (st === 'Type1C' && sub === 'Type1') type = 'Type 1 (CFF)'; }
      const subset = /^[A-Z]{6}\+/.test(base); base = base.replace(/^[A-Z]{6}\+/, '');
      const embedded = sub === 'Type3' || file ? (subset ? 'Embedded subset' : 'Embedded') : 'Not embedded';
      const id = `${base}|${type}|${embedded}`; if (!list.has(id)) list.set(id, { name: base, type, embedded });
    };
    const walkRes = (res, depth) => {
      if (!(res instanceof PDFDict) || depth > 6 || seen.has(res)) return; seen.add(res);
      const fonts = res.lookup(N('Font'));
      if (fonts instanceof PDFDict) for (const [, v] of fonts.entries()) addFont(v instanceof PDFRef ? String(v) : null, d.context.lookup(v));
      const xo = res.lookup(N('XObject'));
      if (xo instanceof PDFDict) for (const [, v] of xo.entries()) {
        const key = v instanceof PDFRef ? `x${v}` : null; if (key && seen.has(key)) continue; if (key) seen.add(key);
        const s = d.context.lookup(v); if (s instanceof PDFStream && nameOf(s.dict.get(N('Subtype'))) === 'Form') walkRes(s.dict.lookup(N('Resources')), depth + 1);
      }
    };
    for (const e of doc.pages) if (e.src === k && pages[e.i]) { try { walkRes(pages[e.i].node.Resources(), 0); } catch {} }
  }
  return [...list.values()].sort((a, b) => a.name.localeCompare(b.name));
}
// The opened file's Info dictionary, as pdf.js reads it.
async function diInfo(k = 0) { try { const m = await pdfDocs.get(k).getMetadata(); return m.info || {}; } catch { return {}; } }
// The values the saved PDF will have: changes first, then what the file had.
function diValue(info, f) { const m = diMark(); return m && m[f] != null ? m[f] : String(info[f[0].toUpperCase() + f.slice(1)] ?? ''); }

async function diShow() {
  if (!has()) return;
  const [info, size, sec, fonts] = await Promise.all([diInfo(), diPageSize(), diSecurity(), diFonts().catch(() => [])]);
  const bytes = doc.sources.reduce((t, b) => t + (b.length || b.byteLength || 0), 0);
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
  const allow = (v) => (v === 'low' ? 'Allowed (low quality)' : v ? 'Allowed' : 'Not allowed');
  const pending = docMarks().some((m) => m.type === 'protsec');
  const body = `<div class="di">
    <div class="di-fields">${DI_FIELDS.map(([f, label]) => `<label class="field"><span>${label}</span><input type="text" data-di="${f}" value="${esc(diValue(info, f))}" autocomplete="off" spellcheck="${f !== 'keywords'}"></label>`).join('')}</div>
    <h3 class="di-h">File</h3>
    <dl class="di-dl">${row('File name', doc.name + '.pdf')}${row('File size', diSize(bytes))}${row('Pages', String(doc.pages.length))}${row(`Page size (page ${Math.min(current, doc.pages.length - 1) + 1})`, size)}${row('PDF version', info.PDFFormatVersion ? 'PDF ' + info.PDFFormatVersion : '')}${row('Made with', info.Creator)}${row('Producer', info.Producer)}${row('Created', diDate(info.CreationDate))}${row('Modified', diDate(info.ModDate))}</dl>
    <h3 class="di-h">Security</h3>
    <dl class="di-dl">${row('Password to open', sec.password ? 'Yes' : 'No')}${sec.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${v ? 'di-yes' : 'di-no'}">${allow(v)}</dd>`).join('')}</dl>
    ${pending ? '<p class="di-note">The security you set in Protect is used when you save.</p>' : ''}
    <h3 class="di-h">Fonts <span class="di-count">${fonts.length}</span></h3>
    ${fonts.length ? `<ul class="di-fonts">${fonts.map((f) => `<li><span class="di-fn">${esc(f.name)}</span><span class="di-ft">${esc(f.type)} · ${esc(f.embedded)}</span></li>`).join('')}</ul>` : '<p class="di-note">No fonts. The pages may be scanned images.</p>'}
  </div>`;
  let vals = null;
  const res = await dialog('Document properties', body, [{ label: 'Cancel' }, { label: 'Done', value: 'ok', primary: true }], (dlg) => {
    dlg.classList.add('di-dlg');
    const read = () => { vals = {}; $$('[data-di]', dlg).forEach((i) => { vals[i.dataset.di] = i.value; }); };
    $$('[data-di]', dlg).forEach((i) => { i.addEventListener('input', read); i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); read(); $('.dlg-foot .btn.primary', dlg).click(); } }); });
    read();
    const first = $('[data-di]', dlg); if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => first && first.focus(), 0);
    dlg.addEventListener('close', () => dlg.classList.remove('di-dlg'), { once: true });
  });
  if (res !== 'ok' || !vals || !doc) return;
  diSet(vals, info);
}
// Keeps the fields that differ from the file's own values (or from earlier changes); one undo step.
function diSet(vals, info) {
  const old = diMark(), next = { id: old ? old.id : uid(), type: 'docinfo' };
  for (const [f] of DI_FIELDS) {
    const v = String(vals[f] ?? '').trim(), orig = String(info[f[0].toUpperCase() + f.slice(1)] ?? '');
    if (v !== orig.trim()) next[f] = v;
  }
  const same = JSON.stringify(old || { id: next.id, type: 'docinfo' }) === JSON.stringify(next);
  if (same) return;
  const before = snapshot();
  const list = docMarks(), k = list.findIndex((m) => m.type === 'docinfo');
  if (Object.keys(next).length <= 2) { if (k >= 0) list.splice(k, 1); }
  else if (k >= 0) list[k] = next; else list.push(next);
  changed(before);
  toast('Document properties changed');
}

// Saving: Title, Author, Subject and Keywords. When the pages were copied into a new PDF, the opened file's Info is
// carried over (with its creator and creation date); changes made here replace it.
FEATURE.saveDoc.push(async ({ L, out }) => {
  const m = diMark(), info = await diInfo(doc.pages.length ? doc.pages[0].src : 0);
  const setters = { title: 'setTitle', author: 'setAuthor', subject: 'setSubject', keywords: 'setKeywords' };
  for (const [f] of DI_FIELDS) {
    const v = m && m[f] != null ? m[f] : info[f[0].toUpperCase() + f.slice(1)];
    if (v == null || (typeof v !== 'string')) continue;
    if (f === 'keywords') out.setKeywords(v ? [v] : []);
    else out[setters[f]](v);
  }
  if (info.Creator && typeof info.Creator === 'string' && out.getCreator() !== info.Creator) out.setCreator(info.Creator);
  if (info.CreationDate) { let d = null; try { d = pdfjs.PDFDateString.toDateObject(info.CreationDate); } catch {} if (d && !Number.isNaN(+d)) out.setCreationDate(d); }
  // Readers show the XMP title before the Info one; once the Info is changed here, the older XMP copy goes.
  if (m) out.catalog.delete(L.PDFName.of('Metadata'));
});

cmd('docProps', { label: 'Document properties…', icon: 'file-cog', key: 'Mod-d', enabled: has, run: diShow });
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('print') : -1; if (i >= 0) fm[1].splice(i + 1, 0, 'docProps'); else menuAdd('File', ['docProps']); }
ribbonAdd('home', 'File', ['docProps']);
setTimeout(() => { try { ACCEL['Mod-d'] = 'CmdOrCtrl+D'; scheduleMacMenu(); } catch {} }, 0);
document.addEventListener('keydown', (e) => {
  if ($('#dialog').open || !(isMac ? e.metaKey : e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'd' || selMark) return; // with a mark selected, Ctrl+D duplicates it
  e.preventDefault(); run('docProps');
});
TEST_HOOKS.diFonts = diFonts;
TEST_HOOKS.diSecurity = diSecurity;

addStyle(`
.di-dlg { width: min(560px, calc(100vw - 32px)); }
.di-dlg .dlg-body { max-height: min(70vh, 640px); overflow: auto; }
.di-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.di-fields .field { margin: 4px 0; }
.di-fields .field span { color: var(--ink-2); font-size: 13px; }
.di-h { margin: 14px 0 6px; font-size: 13px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 6px; }
.di-count { font-weight: 500; color: var(--ink-3); }
.di-dl { display: grid; grid-template-columns: 170px 1fr; gap: 4px 14px; margin: 0; font-size: 13px; }
.di-dl dt { color: var(--ink-3); }
.di-dl dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.di-dl dd.di-no { color: var(--danger, #c92a2a); }
.di-note { font-size: 12px; color: var(--ink-3); margin: 6px 0; }
.di-fonts { list-style: none; margin: 0; padding: 0; max-height: 180px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
.di-fonts li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 10px; border-bottom: 1px solid var(--line); }
.di-fonts li:last-child { border-bottom: 0; }
.di-fn { color: var(--ink); overflow-wrap: anywhere; }
.di-ft { color: var(--ink-3); white-space: nowrap; }
@media (max-width: 560px) { .di-fields { grid-template-columns: 1fr; } .di-dl { grid-template-columns: 130px 1fr; } .di-fonts li { flex-direction: column; gap: 0; } .di-ft { white-space: normal; } }
`);
