/* ---------------- document properties (src/features/12-docinfo.js) ----------------
   File > Document properties (Ctrl/Cmd+D), like PDFelement's, in four tabs:
   Description  Title, Author, Subject, Keywords (a list, shown as chips), the app that made it (Creator), the
                language (the catalog's /Lang) and the created and modified dates, all editable.
   Custom       the Info dictionary's own keys: add, rename and delete them (the app's page-design key is hidden).
   Initial view the page it opens at (/OpenAction [page /XYZ null null null]), the page layout (/PageLayout), the
                panel shown (/PageMode) and the reader's window (/ViewerPreferences: DisplayDocTitle, HideToolbar,
                HideMenubar, FitWindow, CenterWindow).
   File         read-only facts: file name and size, page size and count, PDF version, producer, security, fonts.
   docMarks(): { id, type: 'docinfo', title?, author?, subject?, keywords?, creator?, lang?, created?, modified?,
   custom?: { key: text }, view?: { page, layout, mode, displayTitle, toolbar, menubar, fit, center } }: only what
   was changed (a cleared field is ''), so undo, Documents and saving keep them. Saving writes them into the Info
   dictionary and the catalog. The XMP packet (pdfaWriteXmp, in 84-pdfa.js) is written again from the final Info
   on every save of a file that had one or whose properties were changed, so the two always agree. When the pages
   are copied into a new PDF, the opened file's Info is carried over; the core only sets the title to the file name
   when the PDF has none. */

const DI_FIELDS = [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords']];
const DI_HIDDEN_KEYS = new Set(['CowdreyPdfPD']); // page design's settings (40-page-design.js)
const DI_STD_KEYS = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']);
const DI_LAYOUTS = [['', "Reader's choice"], ['SinglePage', 'Single page'], ['OneColumn', 'Continuous'], ['TwoPageLeft', 'Two pages'], ['TwoColumnLeft', 'Two pages, continuous'], ['TwoPageRight', 'Two pages, cover page'], ['TwoColumnRight', 'Two pages, continuous, cover page']];
const DI_MODES = [['', "Reader's choice"], ['UseNone', 'Page only'], ['UseOutlines', 'Bookmarks panel'], ['UseThumbs', 'Pages panel'], ['UseAttachments', 'Attachments panel']];
const DI_PREFS = [['displayTitle', 'DisplayDocTitle', 'Show the document title in the title bar'], ['fit', 'FitWindow', 'Fit the window to the first page'], ['center', 'CenterWindow', 'Centre the window on the screen'], ['toolbar', 'HideToolbar', "Hide the reader's toolbar"], ['menubar', 'HideMenubar', "Hide the reader's menu bar"]];
const DI_LANGS = [['en', 'English'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['fr', 'French'], ['de', 'German'], ['es', 'Spanish'], ['it', 'Italian'], ['pt', 'Portuguese'], ['pt-BR', 'Portuguese (Brazil)'], ['nl', 'Dutch'], ['sv', 'Swedish'], ['da', 'Danish'], ['nb', 'Norwegian'], ['fi', 'Finnish'], ['pl', 'Polish'], ['cs', 'Czech'], ['el', 'Greek'], ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['ar', 'Arabic'], ['he', 'Hebrew'], ['hi', 'Hindi'], ['zh-Hans', 'Chinese (Simplified)'], ['zh-Hant', 'Chinese (Traditional)'], ['ja', 'Japanese'], ['ko', 'Korean'], ['id', 'Indonesian'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['ga', 'Irish'], ['cy', 'Welsh'], ['mi', 'Māori']];
const DI_LANG_RE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const diMark = () => (doc ? docMarks().find((m) => m.type === 'docinfo') : null);
const diPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function diSize(b) {
  if (b < 1024) return diPlural(b, 'byte');
  const kb = b / 1024; if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024; return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}
function diDateObj(raw) { if (!raw) return null; let d = null; try { d = pdfjs.PDFDateString.toDateObject(raw); } catch {} return d && !Number.isNaN(+d) ? d : null; }
function diDate(raw) { const d = diDateObj(raw); return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : raw ? String(raw) : ''; }
// A Date as the value of a datetime-local field (local time, to the second).
const diLocal = (d) => { if (!d) return ''; const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const diKeywords = (s) => String(s || '').split(/\s*[;,]\s*/).map((x) => x.trim()).filter(Boolean);
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
// A source opened with pdf-lib (with its password when it has one), or null.
async function diLoad(src) {
  const L = await loadPdfLib(), { PDFDocument } = L; let d;
  try { d = src.password ? await PDFDocument.load(src, { password: src.password, updateMetadata: false }) : await PDFDocument.load(src, { ignoreEncryption: true, updateMetadata: false }); }
  catch { return null; }
  if (d.isEncrypted && !src.password) { try { d = await PDFDocument.load(src, { password: '', updateMetadata: false }); } catch {} }
  return d;
}
// The fonts the document's pages use: [{ name, type, embedded: 'Embedded' | 'Embedded subset' | 'Not embedded' }]
async function diFonts() {
  const L = await loadPdfLib(); const { PDFName, PDFDict, PDFStream, PDFRef } = L; const N = PDFName.of;
  const list = new Map();
  for (const k of new Set(doc.pages.map((e) => e.src))) {
    const d = await diLoad(doc.sources[k]); if (!d) continue;
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
// What pdf.js doesn't give: the Info dictionary's own keys, the language and the initial view, read with pdf-lib.
const diMetaCache = new WeakMap();
function diMeta(k = 0) {
  const src = doc && doc.sources[k]; if (!src) return Promise.resolve({ custom: {}, view: {} });
  if (!diMetaCache.has(src)) diMetaCache.set(src, (async () => {
    const meta = { custom: {}, view: {}, lang: '', hasXmp: false };
    const L = await loadPdfLib(), d = await diLoad(src); if (!d) return meta;
    const { PDFName, PDFDict, PDFArray, PDFNumber, PDFRef, PDFBool } = L, N = PDFName.of, cat = d.catalog, info = d.getInfoDict();
    for (const [key] of info.entries()) { const name = key.decodeText(); if (DI_STD_KEYS.has(name) || DI_HIDDEN_KEYS.has(name) || info.lookup(key) instanceof PDFName) continue; const t = pdfaText(L, info, name); if (typeof t === 'string') meta.custom[name] = t; }
    meta.lang = pdfaText(L, cat, 'Lang') || '';
    meta.hasXmp = !!cat.get(N('Metadata'));
    meta.view.layout = pdfaName(L, cat.lookup(N('PageLayout'))) || '';
    meta.view.mode = pdfaName(L, cat.lookup(N('PageMode'))) || '';
    const vp = cat.lookup(N('ViewerPreferences'));
    for (const [k2, key] of DI_PREFS) meta.view[k2] = vp instanceof PDFDict && vp.lookup(N(key)) === PDFBool.True;
    let oa = cat.lookup(N('OpenAction')); if (oa instanceof PDFDict && pdfaName(L, oa.get(N('S'))) === 'GoTo') oa = oa.lookup(N('D'));
    meta.view.page = 0;
    if (oa instanceof PDFArray && oa.size()) {
      const p0 = oa.get(0);
      if (p0 instanceof PDFRef) { const i = d.getPages().findIndex((p) => p.ref.tag === p0.tag); if (i >= 0) meta.view.page = i + 1; }
      else if (p0 instanceof PDFNumber) meta.view.page = p0.asNumber() + 1;
    }
    return meta;
  })().catch(() => ({ custom: {}, view: {}, lang: '' })));
  return diMetaCache.get(src);
}
// The values the saved PDF will have: changes first, then what the file had.
function diValue(info, f) { const m = diMark(); return m && m[f] != null ? m[f] : String(info[f[0].toUpperCase() + f.slice(1)] ?? ''); }
const diExtra = (info, meta) => {
  const m = diMark() || {}, view = { ...meta.view, ...(m.view || {}) };
  const created = m.created != null ? (m.created ? new Date(m.created) : null) : diDateObj(info.CreationDate);
  return { creator: m.creator != null ? m.creator : String(info.Creator ?? ''), lang: m.lang != null ? m.lang : meta.lang || '', created: diLocal(created), modified: m.modified ? diLocal(new Date(m.modified)) : '', custom: m.custom || meta.custom || {}, view };
};
// Does the document change what the pages show (so a PDF/A claim the file had may no longer hold)?
const diContentChanged = () => Object.entries(doc.marks).some(([k, v]) => (k === '__doc' ? v.some((x) => !/^(docinfo|protsec)$/.test(x.type)) : Array.isArray(v) && v.length > 0));

async function diShow() {
  if (!has()) return;
  const [info, size, sec, fonts, meta] = await Promise.all([diInfo(), diPageSize(), diSecurity(), diFonts().catch(() => []), diMeta(0)]);
  const x = diExtra(info, meta);
  const bytes = doc.sources.reduce((t, b) => t + (b.length || b.byteLength || 0), 0);
  const row = (k, v) => (v ? `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>` : '');
  const allow = (v) => (v === 'low' ? 'Allowed (low quality)' : v ? 'Allowed' : 'Not allowed');
  const pending = docMarks().some((m) => m.type === 'protsec');
  const opt = (list, now) => { const l = list.some(([v]) => v === now) ? list : [...list, [now, now]]; return l.map(([v, t]) => `<option value="${esc(v)}"${v === now ? ' selected' : ''}>${esc(t)}</option>`).join(''); };
  const tab = (k, t, on) => `<button type="button" role="tab" id="di-t-${k}" data-di-tab="${k}" aria-controls="di-p-${k}" aria-selected="${on}" tabindex="${on ? 0 : -1}">${t}</button>`;
  const custRow = (k, v) => `<div class="di-crow"><input type="text" data-ck value="${esc(k)}" placeholder="Name" aria-label="Property name" autocomplete="off" spellcheck="false"><input type="text" data-cv value="${esc(v)}" placeholder="Value" aria-label="Property value" autocomplete="off"><button type="button" class="icon-btn" data-cdel aria-label="Delete property">${ic('trash-2')}</button></div>`;
  const body = `<div class="di">
    <div class="di-tabs seg" role="tablist" aria-label="Document properties">${tab('desc', 'Description', true)}${tab('custom', 'Custom', false)}${tab('view', 'Initial view', false)}${tab('file', 'File', false)}</div>
    <section class="di-panel" id="di-p-desc" role="tabpanel" aria-labelledby="di-t-desc">
      <div class="di-fields">${DI_FIELDS.map(([f, label]) => `<label class="field${f === 'keywords' ? ' di-kw' : ''}"><span>${label}</span><input type="text" data-di="${f}" value="${esc(diValue(info, f))}" autocomplete="off" spellcheck="${f !== 'keywords'}"${f === 'keywords' ? ' placeholder="Separate them with ; or ,"' : ''}></label>`).join('')}
      <div class="di-chips" data-chips aria-label="Keywords" role="list"></div>
      <label class="field"><span>Made with</span><input type="text" data-dx="creator" value="${esc(x.creator)}" autocomplete="off" spellcheck="false"></label>
      <label class="field"><span>Language</span><input type="text" data-dx="lang" value="${esc(x.lang)}" list="diLangs" placeholder="For example en or fr-CA" autocomplete="off" spellcheck="false"></label>
      <datalist id="diLangs">${DI_LANGS.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('')}</datalist>
      <label class="field"><span>Created</span><input type="datetime-local" step="1" data-dx="created" value="${esc(x.created)}"></label>
      <label class="field"><span>Modified</span><input type="datetime-local" step="1" data-dx="modified" value="${esc(x.modified)}"><small class="di-hint">Leave empty to use the time you save.</small></label></div>
    </section>
    <section class="di-panel" id="di-p-custom" role="tabpanel" aria-labelledby="di-t-custom" hidden>
      <p class="di-note">Your own properties, saved in the file's document information. Other apps show them as custom properties.</p>
      <div class="di-custom" data-custom>${Object.entries(x.custom).map(([k, v]) => custRow(k, v)).join('')}</div>
      <button type="button" class="btn di-cadd" data-cadd>${ic('plus')}<span>Add property</span></button>
    </section>
    <section class="di-panel" id="di-p-view" role="tabpanel" aria-labelledby="di-t-view" hidden>
      <p class="di-note">How the PDF opens in other apps.</p>
      <div class="di-fields">
      <label class="field"><span>Open at page</span><input type="number" min="1" max="${doc.pages.length}" step="1" data-dx="page" value="${x.view.page ? esc(x.view.page) : ''}" placeholder="1"></label>
      <label class="field"><span>Page layout</span><select data-dx="layout">${opt(DI_LAYOUTS, x.view.layout || '')}</select></label>
      <label class="field"><span>Show</span><select data-dx="mode">${opt(DI_MODES, x.view.mode || '')}</select></label></div>
      <div class="di-checks">${DI_PREFS.map(([k, , t]) => `<label class="di-check"><input type="checkbox" data-dx="${k}"${x.view[k] ? ' checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>
    </section>
    <section class="di-panel" id="di-p-file" role="tabpanel" aria-labelledby="di-t-file" hidden>
    <h3 class="di-h">File</h3>
    <dl class="di-dl">${row('File name', doc.name + '.pdf')}${row('File size', diSize(bytes))}${row('Pages', String(doc.pages.length))}${row(`Page size (page ${Math.min(current, doc.pages.length - 1) + 1})`, size)}${row('PDF version', info.PDFFormatVersion ? 'PDF ' + info.PDFFormatVersion : '')}${row('Made with', info.Creator)}${row('Producer', info.Producer)}${row('Created', diDate(info.CreationDate))}${row('Modified', diDate(info.ModDate))}</dl>
    <h3 class="di-h">Security</h3>
    <dl class="di-dl">${row('Password to open', sec.password ? 'Yes' : 'No')}${sec.rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd class="${v ? 'di-yes' : 'di-no'}">${allow(v)}</dd>`).join('')}</dl>
    ${pending ? '<p class="di-note">The security you set in Protect is used when you save.</p>' : ''}
    <h3 class="di-h">Fonts <span class="di-count">${fonts.length}</span></h3>
    ${fonts.length ? `<ul class="di-fonts">${fonts.map((f) => `<li><span class="di-fn">${esc(f.name)}</span><span class="di-ft">${esc(f.type)} · ${esc(f.embedded)}</span></li>`).join('')}</ul>` : '<p class="di-note">No fonts. The pages may be scanned images.</p>'}
    </section>
  </div>`;
  let vals = null;
  const res = await dialog('Document properties', body, [{ label: 'Cancel' }, { label: 'Done', value: 'ok', primary: true }], (dlg) => {
    dlg.classList.add('di-dlg');
    const read = () => {
      vals = { x: {}, custom: [] };
      $$('[data-di]', dlg).forEach((i) => { vals[i.dataset.di] = i.value; });
      $$('[data-dx]', dlg).forEach((i) => { vals.x[i.dataset.dx] = i.type === 'checkbox' ? i.checked : i.value; });
      $$('.di-crow', dlg).forEach((r) => vals.custom.push([$('[data-ck]', r).value, $('[data-cv]', r).value]));
    };
    // tabs
    const tabs = $$('[data-di-tab]', dlg);
    const choose = (b) => { for (const t of tabs) { const on = t === b; t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1; $('#di-p-' + t.dataset.diTab, dlg).hidden = !on; } };
    tabs.forEach((b) => b.addEventListener('click', () => choose(b)));
    $('.di-tabs', dlg).addEventListener('keydown', (e) => tabKeys(e, tabs, (b) => { choose(b); b.focus(); }));
    // keywords: each one a chip, with a button that takes it out of the list
    const kw = $('[data-di="keywords"]', dlg), chips = $('[data-chips]', dlg);
    const drawChips = () => {
      const list = diKeywords(kw.value);
      chips.innerHTML = list.map((w, k) => `<span class="di-chip" role="listitem"><span>${esc(w)}</span><button type="button" data-chip="${k}" aria-label="Remove ${esc(w)}">${ic('x')}</button></span>`).join('');
      chips.hidden = !list.length; icons();
    };
    chips.addEventListener('click', (e) => { const b = e.target.closest('[data-chip]'); if (!b) return; const list = diKeywords(kw.value); list.splice(+b.dataset.chip, 1); kw.value = list.join('; '); drawChips(); read(); kw.focus(); });
    kw.addEventListener('input', drawChips); drawChips();
    // custom properties
    const cust = $('[data-custom]', dlg);
    $('[data-cadd]', dlg).addEventListener('click', () => { cust.insertAdjacentHTML('beforeend', custRow('', '')); icons(); read(); const r = cust.lastElementChild; $('[data-ck]', r).focus(); });
    cust.addEventListener('click', (e) => { const b = e.target.closest('[data-cdel]'); if (!b) return; b.closest('.di-crow').remove(); read(); });
    dlg.addEventListener('input', read); dlg.addEventListener('change', read);
    $$('[data-di]', dlg).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); read(); $('.dlg-foot .btn.primary', dlg).click(); } }));
    read();
    const first = $('[data-di]', dlg); if (!matchMedia('(pointer: coarse)').matches) setTimeout(() => first && first.focus(), 0);
    dlg.addEventListener('close', () => dlg.classList.remove('di-dlg'), { once: true });
  });
  if (res !== 'ok' || !vals || !doc) return;
  diSet(vals, info, meta);
}
// Keeps the fields that differ from the file's own values (or from earlier changes); one undo step.
function diSet(vals, info, meta = { custom: {}, view: {}, lang: '' }) {
  const old = diMark(), next = { id: old ? old.id : uid(), type: 'docinfo' };
  for (const [f] of DI_FIELDS) {
    const v = String(vals[f] ?? '').trim(), orig = String(info[f[0].toUpperCase() + f.slice(1)] ?? '');
    if (v !== orig.trim()) next[f] = v;
  }
  const x = vals.x || {};
  if (x.creator != null && String(x.creator).trim() !== String(info.Creator ?? '').trim()) next.creator = String(x.creator).trim();
  if (x.lang != null) {
    const v = String(x.lang).trim();
    if (v && !DI_LANG_RE.test(v)) toast(`“${v}” is not a language code. Use one like en, fr or pt-BR.`);
    else if (v !== (meta.lang || '')) next.lang = v;
  }
  if (x.created != null) {
    const fileC = diDateObj(info.CreationDate), d = x.created ? new Date(x.created) : null;
    const same = fileC ? d && Math.abs(+d - Math.floor(+fileC / 1000) * 1000) < 1000 : !x.created;
    if (!same) { if (!x.created) next.created = ''; else if (d && !Number.isNaN(+d)) next.created = d.toISOString(); }
  }
  if (x.modified) { const d = new Date(x.modified); if (!Number.isNaN(+d)) next.modified = d.toISOString(); }
  if (vals.custom) {
    const map = {}, skipped = [];
    for (const [k0, v] of vals.custom) {
      const k = String(k0).trim(); if (!k && !String(v).trim()) continue;
      if (!k || DI_STD_KEYS.has(k) || DI_HIDDEN_KEYS.has(k) || /[\s()<>[\]{}/%#]/.test(k) || k.length > 120) { skipped.push(k || '(no name)'); continue; }
      map[k] = String(v);
    }
    if (skipped.length) toast(`Not kept: ${skipped.join(', ')}. Property names can't have spaces or brackets, or be one of the standard ones.`);
    const sorted = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
    if (sorted(map) !== sorted(meta.custom || {})) next.custom = map;
  }
  const view = {}, mv = meta.view || {};
  if (x.page != null) { const n = Math.round(+x.page) || 0; const p = n >= 1 ? Math.min(n, doc.pages.length) : 0; if (p !== (mv.page || 0)) view.page = p; }
  if (x.layout != null && x.layout !== (mv.layout || '')) view.layout = x.layout;
  if (x.mode != null && x.mode !== (mv.mode || '')) view.mode = x.mode;
  for (const [k] of DI_PREFS) if (x[k] != null && !!x[k] !== !!mv[k]) view[k] = !!x[k];
  if (Object.keys(view).length) next.view = view;
  const same = JSON.stringify(old || { id: next.id, type: 'docinfo' }) === JSON.stringify(next);
  if (same) return;
  const before = snapshot();
  const list = docMarks(), k = list.findIndex((m) => m.type === 'docinfo');
  if (Object.keys(next).length <= 2) { if (k >= 0) list.splice(k, 1); }
  else if (k >= 0) list[k] = next; else list.push(next);
  changed(before);
  toast('Document properties changed');
}

// Saving: the fields above, into the Info dictionary and the catalog. When the pages were copied into a new PDF, the
// opened file's Info is carried over (with its creator, creation date and own keys); changes made here replace it.
FEATURE.saveDoc.push(async ({ L, out, pages }) => {
  const { PDFName, PDFHexString, PDFString, PDFDict, PDFBool } = L, N = PDFName.of;
  const m = diMark(), src = doc.pages.length ? doc.pages[0].src : 0, info = await diInfo(src), meta = await diMeta(src);
  const setters = { title: 'setTitle', author: 'setAuthor', subject: 'setSubject', keywords: 'setKeywords' }, dict = out.getInfoDict();
  for (const [f] of DI_FIELDS) {
    const v = m && m[f] != null ? m[f] : info[f[0].toUpperCase() + f.slice(1)];
    if (v == null || (typeof v !== 'string')) continue;
    if (f === 'keywords') { if (v) dict.set(N('Keywords'), PDFHexString.fromText(v)); else dict.delete(N('Keywords')); }
    else out[setters[f]](v);
  }
  const creator = m && m.creator != null ? m.creator : info.Creator;
  if (typeof creator === 'string') { if (creator) { if (out.getCreator() !== creator) out.setCreator(creator); } else dict.delete(N('Creator')); }
  if (m && m.created != null) { if (m.created) out.setCreationDate(new Date(m.created)); else dict.delete(N('CreationDate')); }
  else if (info.CreationDate) { const d = diDateObj(info.CreationDate); if (d) out.setCreationDate(d); }
  // the Info dictionary's own keys
  const custom = m && m.custom ? m.custom : meta.custom || {};
  if (m && m.custom) for (const k of dict.keys()) { const name = k.decodeText(); if (!DI_STD_KEYS.has(name) && !DI_HIDDEN_KEYS.has(name) && !(name in custom)) dict.delete(k); }
  for (const [k, v] of Object.entries(custom)) if ((m && m.custom) || !dict.get(N(k))) dict.set(N(k), PDFHexString.fromText(v));
  // language and initial view
  const lang = m && m.lang != null ? m.lang : meta.lang;
  if (lang) out.catalog.set(N('Lang'), PDFString.of(lang)); else if (m && m.lang === '') out.catalog.delete(N('Lang'));
  const view = (m && m.view) || {};
  if (view.page != null) {
    const p = view.page && pages[Math.min(view.page, pages.length) - 1];
    if (p) out.catalog.set(N('OpenAction'), out.context.obj([p.ref, N('XYZ'), null, null, null])); else out.catalog.delete(N('OpenAction'));
  }
  if (view.layout != null) { if (view.layout) out.catalog.set(N('PageLayout'), N(view.layout)); else out.catalog.delete(N('PageLayout')); }
  if (view.mode != null) { if (view.mode) out.catalog.set(N('PageMode'), N(view.mode)); else out.catalog.delete(N('PageMode')); }
  if (DI_PREFS.some(([k]) => view[k] != null)) {
    let vp = out.catalog.lookup(N('ViewerPreferences'));
    if (!(vp instanceof PDFDict)) { vp = out.context.obj({}); out.catalog.set(N('ViewerPreferences'), vp); }
    for (const [k, key] of DI_PREFS) if (view[k] != null) { if (view[k]) vp.set(N(key), PDFBool.True); else vp.delete(N(key)); }
    if (!vp.keys().length) out.catalog.delete(N('ViewerPreferences'));
  }
  // The XMP packet is written last, from the final Info (the core sets the producer, the modification date and the
  // title after these hooks), so readers that show the XMP title show the one set here. Removing hidden information
  // (Protect) takes it out instead.
  const hadXmp = !!out.catalog.get(N('Metadata'));
  const cleaning = docMarks().some((x) => x.type === 'protclean' && x.metadata);
  if (!cleaning && (hadXmp || m) && !out.__diXmp) {
    out.__diXmp = true;
    const save = out.save.bind(out), keepClaims = !diContentChanged();
    out.save = async (...a) => {
      const mm = diMark();
      if (mm && mm.modified) out.setModificationDate(new Date(mm.modified));
      if (!hadXmp || out.catalog.get(N('Metadata'))) { try { pdfaWriteXmp(L, out, { keepClaims }); } catch (e) { console.warn('Could not write the XMP metadata', e); } }
      return save(...a);
    };
  }
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
TEST_HOOKS.diMeta = (k) => diMeta(k);

addStyle(`
.di-dlg { width: min(580px, calc(100vw - 32px)); }
.di-dlg .dlg-body { max-height: min(70vh, 640px); overflow: auto; }
.di-tabs.seg { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0 0 10px; }
.di-tabs.seg > button { padding: 5px 4px; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.di-panel[hidden] { display: none; }
.di-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.di-fields .field { margin: 4px 0; min-width: 0; }
.di-fields .field span, .di-fields .field .di-hint { color: var(--ink-2); font-size: 13px; }
.di-fields .field .di-hint { font-size: 12px; color: var(--ink-3); }
.di-fields .field input, .di-fields .field select { min-width: 0; width: 100%; box-sizing: border-box; }
.di-fields .field select { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
.di-chips { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; margin: 2px 0 6px; }
.di-chips[hidden] { display: none; }
.di-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px 2px 10px; border-radius: 999px; background: var(--hover); color: var(--ink); font-size: 13px; max-width: 100%; }
.di-chip > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.di-chip button { display: inline-flex; border: 0; background: none; color: var(--ink-3); padding: 2px; border-radius: 50%; cursor: pointer; }
.di-chip button:hover { color: var(--ink); background: var(--press, rgba(0,0,0,.08)); }
.di-chip svg { width: 13px; height: 13px; }
.di-custom { display: grid; gap: 6px; margin: 6px 0 8px; }
.di-crow { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr) auto; gap: 6px; align-items: center; }
.di-crow input { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 7px 10px; min-width: 0; }
.di-cadd { display: inline-flex; align-items: center; gap: 6px; }
.di-cadd svg { width: 16px; height: 16px; }
.di-checks { display: grid; gap: 6px; margin: 8px 0 0; }
.di-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink); }
.di-h { margin: 14px 0 6px; font-size: 13px; font-weight: 600; color: var(--ink); display: flex; align-items: center; gap: 6px; }
#di-p-file > .di-h:first-child { margin-top: 2px; }
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
@media (max-width: 560px) { .di-fields { grid-template-columns: 1fr; } .di-dl { grid-template-columns: 130px 1fr; } .di-fonts li { flex-direction: column; gap: 0; } .di-ft { white-space: normal; } .di-tabs.seg > button { padding: 5px 2px; font-size: 12px; } }
`);
