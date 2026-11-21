/* ---------------- actions: the same steps on many PDFs (src/features/65-batch.js) ----------------
   File > Actions… (and Export > Batch): an action is a named list of steps (rotate, Bates numbers, properties,
   optimize, OCR…). Run on files… opens each PDF in turn as a working document in the normal pipeline, applies the
   steps through the same marks and document settings the app saves, writes it with buildPdf(), and puts the result
   in a .zip, a folder, or next to the originals (with a suffix, on the Mac). The document you have open is put
   back as it was afterwards: its pages, marks, undo and redo are kept aside while the action runs. One file that fails
   does not stop the run; Cancel stops after the file being worked on. Bates numbers carry on from file to file and
   are listed in a log that can be saved as .csv.
   Steps: FEATURE.batchSteps[id] = { label, icon?, available?(), defaults(), options(opts) -> form HTML (fields with
   data-bk="key"), summary?(opts), prepare?(opts, run) (asks for anything not kept, such as passwords, once per run),
   run(ctx, opts) }. ctx: { doc, file: { name, base }, index, total, counter (carried from file to file), log(text),
   post (functions bytes -> bytes, after saving), extra (more files to write: { name, data }), skipPdf, secrets }.
   Steps of other modules register the same way; each built-in step checks that what it uses is there.
   Saved actions: store key 'actions' (no passwords: those are asked for when an action runs). */
FEATURE.batchSteps ||= {};
const BATCH_STEPS = FEATURE.batchSteps;
const BATCH_MM = 72 / 25.4;
const batchPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const batchBase = (name) => String(name || 'Document').replace(/\.pdf$/i, '');
const batchTokens = (s, ctx) => String(s || '').replace(/<<\s*file\s*>>/gi, ctx.file.base).replace(/<<\s*date\s*>>/gi, new Date().toISOString().slice(0, 10));
const batchRange = (range, n) => (range && String(range).trim() ? parseRange(String(range), n) : [...Array(n).keys()]);

/* ----- form fields for a step's options ----- */
const bf = {
  text: (k, label, v = '', ph = '') => `<label class="field"><span>${esc(label)}</span><input type="text" data-bk="${k}" value="${esc(v)}" placeholder="${esc(ph)}" autocomplete="off"></label>`,
  num: (k, label, v, min = 0, max = 100000, step = 1) => `<label class="field"><span>${esc(label)}</span><input type="number" data-bk="${k}" value="${esc(v)}" min="${min}" max="${max}" step="${step}" inputmode="numeric"></label>`,
  sel: (k, label, v, list) => `<label class="field"><span>${esc(label)}</span><select data-bk="${k}">${list.map(([x, l]) => `<option value="${esc(x)}"${String(x) === String(v) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`,
  check: (k, label, on) => `<label class="batch-check"><input type="checkbox" data-bk="${k}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`,
  note: (t) => `<p class="batch-note">${esc(t)}</p>`,
};
// Reads a step's form back: numbers stay numbers and ticks stay true or false, as in its defaults.
function batchReadForm(root, defaults) {
  const o = { ...defaults };
  for (const el of root.querySelectorAll('[data-bk]')) {
    const k = el.dataset.bk;
    if (el.type === 'checkbox') o[k] = el.checked;
    else if (el.type === 'number' || typeof defaults[k] === 'number') o[k] = el.value === '' ? defaults[k] : +el.value;
    else o[k] = el.value;
  }
  return o;
}

/* ----- the built-in steps ----- */
const BATCH_SLOTS = [['br', 'Bottom right'], ['bc', 'Bottom centre'], ['bl', 'Bottom left'], ['tr', 'Top right'], ['tc', 'Top centre'], ['tl', 'Top left']];
const batchHasDesign = () => typeof pdDefaults !== 'undefined' && typeof pdItems === 'function';
function batchDesign(ctx, type, opts) {
  if (!batchHasDesign()) throw new Error('Page design is not in this version');
  const m = { id: uid(), rev: uid(), type, ...pdDefaults[type](), ...opts };
  docMarks().push(m);
  return m;
}
Object.assign(BATCH_STEPS, {
  rotate: {
    label: 'Rotate pages', icon: 'rotate-cw',
    defaults: () => ({ range: '', angle: 90 }),
    options: (o) => `<div class="batch-row">${bf.text('range', 'Pages (empty: all)', o.range, 'For example 1, 3-5')}${bf.sel('angle', 'Turn', o.angle, [[90, 'Right (90°)'], [180, 'Upside down (180°)'], [270, 'Left (90°)']])}</div>`,
    summary: (o) => `${o.range ? 'Pages ' + o.range : 'All pages'}, ${o.angle === 270 ? 'left' : o.angle === 180 ? '180°' : 'right'}`,
    run(ctx, o) { const a = ((+o.angle % 360) + 360) % 360; for (const n of batchRange(o.range, ctx.doc.pages.length)) { const e = ctx.doc.pages[n]; e.rot = (e.rot + a) % 360; } },
  },
  deletePages: {
    label: 'Delete pages', icon: 'trash-2',
    defaults: () => ({ range: '' }),
    options: (o) => bf.text('range', 'Pages to delete', o.range, 'For example 1, 3-5'),
    summary: (o) => (o.range ? 'Pages ' + o.range : 'No pages chosen'),
    run(ctx, o) {
      if (!String(o.range || '').trim()) return;
      const gone = new Set(parseRange(String(o.range), ctx.doc.pages.length));
      if (gone.size >= ctx.doc.pages.length) throw new Error('That would delete every page');
      ctx.doc.pages = ctx.doc.pages.filter((_, n) => !gone.has(n));
      if (gone.size) ctx.log(`Deleted ${batchPlural(gone.size, 'page')}`);
    },
  },
  crop: {
    label: 'Crop margins', icon: 'frame',
    defaults: () => ({ top: 10, bottom: 10, left: 10, right: 10, range: '' }),
    options: (o) => `<div class="batch-row4">${bf.num('top', 'Top (mm)', o.top)}${bf.num('bottom', 'Bottom (mm)', o.bottom)}${bf.num('left', 'Left (mm)', o.left)}${bf.num('right', 'Right (mm)', o.right)}</div>${bf.text('range', 'Pages (empty: all)', o.range)}`,
    summary: (o) => `${o.top} / ${o.bottom} / ${o.left} / ${o.right} mm`,
    async run(ctx, o) {
      const [t, b, l, r] = [o.top, o.bottom, o.left, o.right].map((x) => Math.max(0, +x || 0) * BATCH_MM);
      for (const n of batchRange(o.range, ctx.doc.pages.length)) {
        const e = ctx.doc.pages[n], page = await pageOf(e), vp = page.getViewport({ scale: 1, rotation: (page.rotate + e.rot) % 360 });
        if (vp.width - l - r < 18 || vp.height - t - b < 18) continue;
        const [ax, ay] = vp.convertToPdfPoint(l, t), [bx, by] = vp.convertToPdfPoint(vp.width - r, vp.height - b), q = (x) => Math.round(x * 100) / 100;
        e.crop = [q(Math.min(ax, bx)), q(Math.min(ay, by)), q(Math.max(ax, bx)), q(Math.max(ay, by))];
      }
    },
  },
  watermark: {
    label: 'Add watermark', icon: 'droplets', available: batchHasDesign,
    defaults: () => ({ text: 'CONFIDENTIAL', size: 64, color: '#E03131', opacity: 30, rotation: 45, layout: 'center', front: 'front', range: '' }),
    options: (o) => `${bf.text('text', 'Text (<<file>> is the file name)', o.text)}<div class="batch-row">${bf.num('size', 'Size (pt)', o.size, 4, 400)}${bf.num('opacity', 'Opacity (%)', o.opacity, 1, 100)}${bf.num('rotation', 'Angle (°)', o.rotation, -180, 180)}${bf.text('color', 'Colour', o.color)}${bf.sel('layout', 'Layout', o.layout, [['center', 'Once, in the middle'], ['tile', 'Repeated']])}${bf.sel('front', 'Place', o.front, [['front', 'In front of the page'], ['behind', 'Behind the page']])}</div>${bf.text('range', 'Pages (empty: all)', o.range)}`,
    summary: (o) => `“${o.text}”`,
    run(ctx, o) { batchDesign(ctx, 'pd_watermark', { ...o, kind: 'text', text: batchTokens(o.text, ctx), size: +o.size || 64 }); },
  },
  headfoot: {
    label: 'Header & footer', icon: 'panel-top', available: batchHasDesign,
    defaults: () => ({ tl: '', tc: '', tr: '', bl: '', bc: 'Page <<page>> of <<pages>>', br: '', size: 10, color: '#333333', start: 1, range: '' }),
    options: (o) => `<div class="batch-slots">${[['tl', 'Top left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['bl', 'Bottom left'], ['bc', 'Bottom centre'], ['br', 'Bottom right']].map(([k, l]) => bf.text(k, l, o[k])).join('')}</div>${bf.note('<<page>>, <<pages>>, <<date>> and <<file>> are filled in.')}<div class="batch-row">${bf.num('size', 'Size (pt)', o.size, 4, 72)}${bf.text('color', 'Colour', o.color)}${bf.num('start', 'First page number', o.start, 0)}${bf.text('range', 'Pages (empty: all)', o.range)}</div>`,
    summary: (o) => ['tl', 'tc', 'tr', 'bl', 'bc', 'br'].map((k) => o[k]).filter(Boolean).join(' · ') || 'Empty',
    run(ctx, o) {
      const slots = {}; for (const k of ['tl', 'tc', 'tr', 'bl', 'bc', 'br']) slots[k] = String(o[k] || '').replace(/<<\s*file\s*>>/gi, ctx.file.base);
      batchDesign(ctx, 'pd_headfoot', { ...o, ...slots, size: +o.size || 10, start: +o.start || 1 });
    },
  },
  bates: {
    label: 'Bates numbering', icon: 'hash', available: batchHasDesign,
    defaults: () => ({ prefix: 'ABC', start: 1, digits: 6, suffix: '', slot: 'br', size: 10, range: '' }),
    options: (o) => `<div class="batch-row">${bf.text('prefix', 'Prefix', o.prefix)}${bf.num('start', 'Start at (first file)', o.start, 0)}${bf.num('digits', 'Digits', o.digits, 1, 12)}${bf.text('suffix', 'Suffix', o.suffix)}${bf.sel('slot', 'Place', o.slot, BATCH_SLOTS)}${bf.num('size', 'Size (pt)', o.size, 4, 72)}</div>${bf.note('The numbers carry on from one file to the next.')}`,
    summary: (o) => `${o.prefix}${String(o.start).padStart(o.digits, '0')}${o.suffix}…`,
    run(ctx, o) {
      const key = 'bates';
      if (ctx.counter[key] == null) ctx.counter[key] = Math.max(0, Math.round(+o.start || 0));
      const m = batchDesign(ctx, 'pd_bates', { ...o, start: ctx.counter[key], digits: Math.max(1, Math.min(12, +o.digits || 6)), size: +o.size || 10 });
      // the pages it lands on are counted once every step has run (a later step may delete pages)
      ctx.after.push(() => {
        const n = pdPages(m, ctx.doc.pages.length).length;
        ctx.bates = { first: pdBates(m, m.start), last: pdBates(m, m.start + Math.max(0, n - 1)), pages: n };
        ctx.counter[key] = m.start + n;
        ctx.log(`Bates ${ctx.bates.first}–${ctx.bates.last}`);
      });
    },
  },
  docinfo: {
    label: 'Set document properties', icon: 'file-cog',
    defaults: () => ({ title: '<<file>>', author: '', subject: '', keywords: '' }),
    options: (o) => `<div class="batch-row">${bf.text('title', 'Title', o.title)}${bf.text('author', 'Author', o.author)}${bf.text('subject', 'Subject', o.subject)}${bf.text('keywords', 'Keywords', o.keywords)}</div>${bf.note('<<file>> is the file name and <<date>> today’s date. Empty fields are left as they are.')}`,
    summary: (o) => ['title', 'author', 'subject', 'keywords'].filter((k) => o[k]).map((k) => `${k[0].toUpperCase() + k.slice(1)}: ${o[k]}`).join(', ') || 'Nothing to change',
    run(ctx, o) {
      const m = { id: uid(), type: 'docinfo' };
      for (const k of ['title', 'author', 'subject', 'keywords']) if (String(o[k] || '').trim()) m[k] = batchTokens(o[k], ctx).trim();
      if (Object.keys(m).length <= 2) return;
      const list = docMarks(), at = list.findIndex((x) => x.type === 'docinfo');
      if (at >= 0) list[at] = { ...list[at], ...m, id: list[at].id }; else list.push(m);
    },
  },
  flatten: {
    label: 'Flatten form', icon: 'layers-2', available: () => typeof protFlattenPage === 'function',
    defaults: () => ({ comments: false }),
    options: (o) => bf.check('comments', 'Also flatten comments', o.comments),
    summary: (o) => (o.comments ? 'Form fields and comments' : 'Form fields'),
    run(ctx, o) { const l = docMarks(); for (let k = l.length - 1; k >= 0; k--) if (l[k].type === 'protflatten') l.splice(k, 1); l.push({ id: uid(), type: 'protflatten', forms: true, comments: !!o.comments }); },
  },
  clean: {
    label: 'Remove hidden information', icon: 'eye-off', available: () => typeof protClean === 'function',
    defaults: () => ({ metadata: true, attachments: true, javascript: true, comments: false }),
    options: (o) => `${bf.check('metadata', 'Document properties and metadata', o.metadata)}${bf.check('attachments', 'Attached files', o.attachments)}${bf.check('javascript', 'Scripts and actions', o.javascript)}${bf.check('comments', 'Comments', o.comments)}`,
    summary: (o) => ['metadata', 'attachments', 'javascript', 'comments'].filter((k) => o[k]).join(', ') || 'Nothing',
    run(ctx, o) { const l = docMarks(); for (let k = l.length - 1; k >= 0; k--) if (l[k].type === 'protclean') l.splice(k, 1); l.push({ id: uid(), type: 'protclean', metadata: !!o.metadata, attachments: !!o.attachments, javascript: !!o.javascript, comments: !!o.comments }); },
  },
  optimize: {
    label: 'Optimize', icon: 'shrink', available: () => typeof optimizeBytes === 'function',
    defaults: () => ({ preset: 'smaller', gray: false, cmyk: false }),
    options: (o) => `<div class="batch-row">${bf.sel('preset', 'How', o.preset, typeof OPT_PRESETS !== 'undefined' ? Object.entries(OPT_PRESETS).map(([k, p]) => [k, p.label]) : [['smaller', 'Smaller']])}</div>${bf.check('gray', 'Make all pictures grey', o.gray)}${bf.check('cmyk', 'Convert CMYK pictures to RGB', o.cmyk)}`,
    summary: (o) => (typeof OPT_PRESETS !== 'undefined' && OPT_PRESETS[o.preset] ? OPT_PRESETS[o.preset].label : o.preset),
    run(ctx, o) {
      // applied while the PDF is written, before any password (82-optimize's save step)
      const l = docMarks(); for (let k = l.length - 1; k >= 0; k--) if (l[k].type === 'optimize' || l[k].type === 'protcompress') l.splice(k, 1);
      l.push({ id: uid(), type: 'optimize', opts: optOptions(o.preset, { gray: !!o.gray, cmyk: !!o.cmyk }) });
      ctx.post.push(async (bytes) => { const r = typeof optLast !== 'undefined' && optLast; if (r) ctx.log(r.same ? 'Already compact' : `Optimized: ${optSize(r.before)} → ${optSize(r.after)}`); return bytes; });
    },
  },
  password: {
    label: 'Set password and limits', icon: 'lock', available: () => typeof protSecrets !== 'undefined',
    defaults: () => ({ useOpen: true, limit: false, print: true, copy: false, edit: false, comment: true, forms: true }),
    options: (o) => `${bf.check('useOpen', 'Require a password to open', o.useOpen)}${bf.check('limit', 'Limit printing, copying and changes', o.limit)}<div class="batch-sub">${bf.check('print', 'Allow printing', o.print)}${bf.check('copy', 'Allow copying text and pictures', o.copy)}${bf.check('edit', 'Allow changes', o.edit)}${bf.check('comment', 'Allow comments', o.comment)}${bf.check('forms', 'Allow filling in forms', o.forms)}</div>${bf.note('You type the passwords when the action runs. They are not kept on this device.')}`,
    summary: (o) => [o.useOpen && 'Open password', o.limit && 'limits'].filter(Boolean).join(' and ') || 'Nothing',
    async prepare(o, run) {
      if (run.secrets.password) return true;
      const ask = (label) => `<label class="field"><span>${label}</span><input type="password" data-pw="${label}" autocomplete="new-password"></label>`;
      let err = '';
      for (;;) {
        let vals = null;
        const a = await dialog('Passwords for this run', `${err ? `<p class="prot-err" role="alert">${esc(err)}</p>` : ''}${o.useOpen ? ask('Open password') + ask('Type it again') : ''}${o.limit ? ask('Permissions password') : ''}<p class="batch-note">Every file in this run gets them. They are not kept on this device.</p>`,
          [{ label: 'Cancel' }, { label: 'Use these', value: 'ok', primary: true }], (dlg) => {
            const read = () => { vals = Object.fromEntries($$('[data-pw]', dlg).map((i) => [i.dataset.pw, i.value])); };
            dlg.addEventListener('input', read); read();
          });
        if (a !== 'ok' || !vals) return false;
        const open = vals['Open password'] || '', again = vals['Type it again'] || '', owner = vals['Permissions password'] || '';
        if (o.useOpen && !open) err = 'Type an open password.';
        else if (o.useOpen && open !== again) err = 'The two open passwords are different.';
        else if (o.limit && !owner) err = 'Type a permissions password.';
        else if (o.limit && o.useOpen && owner === open) err = 'Use a permissions password that is different from the open password.';
        else { run.secrets.password = { open: o.useOpen ? open : '', owner: o.limit ? owner : '' }; return true; }
      }
    },
    run(ctx, o) {
      const s = ctx.secrets.password; if (!s) throw new Error('No password was given');
      const l = docMarks(); for (let k = l.length - 1; k >= 0; k--) if (l[k].type === 'protsec') l.splice(k, 1);
      const m = { id: uid(), type: 'protsec', mode: 'set', open: !!o.useOpen, limit: !!o.limit, perms: o.limit ? { print: !!o.print, copy: !!o.copy, edit: !!o.edit, comment: !!o.comment, forms: !!o.forms } : null };
      protSecrets.set(m.id, { open: s.open, owner: s.owner }); ctx.cleanup.push(() => protSecrets.delete(m.id));
      l.push(m);
    },
  },
  ocr: {
    label: 'Recognize text (OCR)', icon: 'scan-text', available: () => typeof ocrRunHeadless === 'function' || typeof ocrRun === 'function',
    defaults: () => ({ lang: 'eng', redo: false }),
    options: (o) => `<div class="batch-row">${bf.sel('lang', 'Language', o.lang, typeof OCR_LANGS !== 'undefined' ? OCR_LANGS : [['eng', 'English']])}</div>${bf.check('redo', 'Also pages that already have text', o.redo)}`,
    summary: (o) => (typeof OCR_LANGS !== 'undefined' ? ((OCR_LANGS.find(([c]) => c === o.lang) || [])[1] || o.lang) : o.lang),
    async run(ctx, o) {
      const pages = ctx.doc.pages.map((_, n) => n);
      const r = typeof ocrRunHeadless === 'function' ? await ocrRunHeadless({ pages, lang: o.lang, redo: !!o.redo }) : await ocrRun({ pages, lang: o.lang, redo: !!o.redo });
      if (r && (r.failed || r.error)) throw new Error('The text reader could not start');
      if (r) ctx.log(r.pages ? `Text recognized on ${batchPlural(r.pages, 'page')}` : 'Already had text');
    },
  },
  pdfa: {
    label: 'Save as PDF/A', icon: 'archive', available: () => typeof pdfaConvert === 'function',
    defaults: () => ({ level: '2b' }),
    options: (o) => bf.sel('level', 'Kind', o.level, [['2b', 'PDF/A-2b (recommended)'], ['1b', 'PDF/A-1b'], ['3b', 'PDF/A-3b']]),
    summary: (o) => 'PDF/A-' + o.level,
    run(ctx, o) {
      ctx.post.push(async (bytes) => {
        const r = await pdfaConvert(bytes, { ...o, name: ctx.file.base });
        const out = r && r.bytes ? r.bytes : r instanceof Uint8Array ? r : null;
        if (!out) throw new Error('Could not make a PDF/A file');
        ctx.log('PDF/A-' + o.level);
        return out;
      });
    },
  },
  text: {
    label: 'Export as text', icon: 'file-text',
    defaults: () => ({ keepPdf: true }),
    options: (o) => bf.check('keepPdf', 'Save the PDF too', o.keepPdf),
    summary: (o) => (o.keepPdf ? 'A .txt beside each PDF' : 'Only the .txt'),
    async run(ctx, o) {
      const parts = [];
      for (const e of ctx.doc.pages) { const tc = await (await pageOf(e)).getTextContent(); parts.push(tc.items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join('')); }
      ctx.extra.push({ name: ctx.file.base + '.txt', data: new TextEncoder().encode(parts.join('\n\n')) });
      if (!o.keepPdf) ctx.skipPdf = true;
    },
  },
});
// A step by its id: only the registry's own entries (an imported id such as 'constructor' finds nothing).
const batchStep = (id) => (typeof id === 'string' && Object.prototype.hasOwnProperty.call(BATCH_STEPS, id) ? BATCH_STEPS[id] : null);
const batchStepOk = (id) => { const s = batchStep(id); return !!s && (!s.available || s.available()); };

/* ----- saved actions ----- */
const BATCH_PRESETS = [
  { id: 'preset-bates', preset: true, name: 'Bates number a set of PDFs', steps: [{ id: 'bates', opts: { prefix: 'ABC', start: 1, digits: 6, suffix: '', slot: 'br', size: 10, range: '' } }] },
  { id: 'preset-ocr', preset: true, name: 'Make searchable (OCR)', steps: [{ id: 'ocr', opts: { lang: 'eng', redo: false } }] },
  { id: 'preset-pdfa', preset: true, name: 'Prepare for archive (PDF/A)', steps: [{ id: 'pdfa', opts: { level: '2b' } }] },
  { id: 'preset-smaller', preset: true, name: 'Make smaller', steps: [{ id: 'optimize', opts: { preset: 'smaller', gray: false, cmyk: false } }] },
];
const batchSaved = () => { const l = store.get('actions', []); return Array.isArray(l) ? l.filter((a) => a && a.id && Array.isArray(a.steps)) : []; };
// Built-in actions whose steps this version doesn't have are not listed.
const batchPresets = () => BATCH_PRESETS.filter((a) => a.steps.every((s) => batchStepOk(s.id)));
const batchAll = () => [...batchPresets(), ...batchSaved()];
function batchKeep(action) {
  const list = batchSaved(), clean = { id: action.id && !action.preset ? action.id : uid(), name: String(action.name || 'Action').trim() || 'Action', steps: action.steps.map((s) => ({ id: s.id, opts: s.opts || {} })) };
  const k = list.findIndex((a) => a.id === clean.id);
  if (k >= 0) list[k] = clean; else list.push(clean);
  store.set('actions', list);
  return clean;
}
function batchForget(id) { store.set('actions', batchSaved().filter((a) => a.id !== id)); }
// An action as a .json file, and back. Steps this version doesn't have are kept, and said so when it runs.
function batchExportJson(action) { return JSON.stringify({ cowdreyPdfAction: 1, name: action.name, steps: action.steps.map((s) => ({ id: s.id, opts: s.opts || {} })) }, null, 2); }
function batchImportJson(text) {
  let o; try { o = JSON.parse(text); } catch { throw new Error('This is not an action file'); }
  if (!o || o.cowdreyPdfAction !== 1 || !Array.isArray(o.steps)) throw new Error('This is not an action file');
  const steps = o.steps.filter((s) => s && typeof s.id === 'string').map((s) => ({ id: s.id, opts: s.opts && typeof s.opts === 'object' ? s.opts : {} }));
  return { name: String(o.name || 'Imported action').slice(0, 120), steps };
}
const batchStepSummary = (s) => { const d = batchStep(s.id); if (!d) return 'Not in this version'; const o = { ...d.defaults(), ...s.opts }; try { return d.summary ? d.summary(o) : ''; } catch { return ''; } };

/* ----- running ----- */
let batchBusy = false;
// Keeps the open document aside (and anything that would store or show the working ones) while an action runs.
function batchEnter() {
  closeLineEditor(true); closePopover();
  if (app.dataset.organize === '1' && typeof pg60Organize === 'function') pg60Organize(false);
  if (!$('#findbar').hidden) closeFind();
  const kept = { doc, pdfDocs: new Map(pdfDocs), current, selMark, undo: [...undoStack], redo: [...redoStack], dirty: doc ? !!doc.dirty : false, state: $('#saveState').innerHTML, persist };
  if (app.dataset.tool !== 'select') setTool('select');
  persist = () => {}; // working documents are never kept in Recent
  app.dataset.batch = 'on';
  if (typeof optQuiet !== 'undefined') optQuiet = true;
  return kept;
}
async function batchLeave(kept) {
  clearTimeout(persistTimer); persistTimer = null;
  for (const p of pdfDocs.values()) if (![...kept.pdfDocs.values()].includes(p)) try { p.destroy(); } catch {}
  pdfDocs.clear(); for (const [k, v] of kept.pdfDocs) pdfDocs.set(k, v);
  doc = kept.doc; current = kept.current; selMark = kept.selMark; selContent = null;
  undoStack.splice(0, undoStack.length, ...kept.undo); redoStack.splice(0, redoStack.length, ...kept.redo);
  persist = kept.persist;
  if (typeof optQuiet !== 'undefined') optQuiet = false;
  findState.texts.clear(); teCache.clear();
  delete app.dataset.batch;
  if (doc) {
    doc.dirty = kept.dirty; syncHiddenComments();
    await layoutPages(true);
    $('#saveState').innerHTML = kept.state;
  } else { pagesEl.innerHTML = ''; views = []; updateStatus(); }
  setTitle(); renderSide(); refreshRibbon();
}
async function batchOpenInput(input) {
  const bytes = await input.read();
  await loadPdfjs();
  let pd;
  try { pd = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false, fontExtraProperties: true }).promise; }
  catch (e) { throw new Error(e && e.name === 'PasswordException' ? 'It needs a password to open. Remove the password first.' : 'It may not be a PDF'); }
  return { bytes, pd };
}
// A name not used yet in this run, and (for a folder) not already a file there: nothing is ever replaced.
async function batchUnique(used, name, exists) {
  const dot = name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length;
  for (let k = 1; ; k++) {
    const n = k === 1 ? name : `${name.slice(0, dot)} (${k})${name.slice(dot)}`;
    if (k < 10000 && (used.has(n.toLowerCase()) || (exists && (await exists(n))))) continue;
    used.add(n.toLowerCase()); return n;
  }
}
// Runs an action on inputs ([{ name, path?, read() }]). out: { kind: 'zip' | 'folder' | 'next', write?(name, data, input) }.
// progress: { cancelled, file(i, status, note) }. Returns { results, files, csv, cancelled }.
async function batchRun(action, inputs, { out = { kind: 'zip' }, progress = null, secrets = {} } = {}) {
  const steps = action.steps.map((s) => ({ ...s, def: batchStep(s.id) }));
  const counter = {}, results = [], files = [], used = new Set();
  const kept = batchEnter();
  let cancelled = false;
  try {
    for (let i = 0; i < inputs.length; i++) {
      if (progress && progress.cancelled) { cancelled = true; for (let j = i; j < inputs.length; j++) { results.push({ name: inputs[j].rel || inputs[j].name, status: 'cancelled' }); progress.file(j, 'cancelled'); } break; }
      const input = inputs[i], base = batchBase(input.name), row = { name: input.rel || input.name, status: 'done', notes: [] };
      results.push(row);
      if (progress) progress.file(i, 'running');
      const ctx = { file: { name: input.name, base }, index: i, total: inputs.length, counter, secrets, post: [], extra: [], after: [], cleanup: [], skipPdf: false, log: (t) => row.notes.push(t) };
      const counterBefore = { ...counter };
      try {
        const missing = steps.find((s) => !s.def || (s.def.available && !s.def.available()));
        if (missing) throw new Error(`The step “${missing.def ? missing.def.label : missing.id}” is not in this version`);
        const { bytes, pd } = await batchOpenInput(input);
        for (const p of pdfDocs.values()) if (![...kept.pdfDocs.values()].includes(p)) try { p.destroy(); } catch {}
        pdfDocs.clear(); pdfDocs.set(0, pd);
        doc = { id: 'batch-' + uid(), name: base, sources: [bytes], pages: [...Array(pd.numPages).keys()].map((n) => ({ src: 0, i: n, rot: 0 })), marks: {}, updated: Date.now(), handle: null, path: null, mtime: 0 };
        current = 0; selMark = null; undoStack.length = redoStack.length = 0;
        ctx.doc = doc;
        for (const s of steps) await s.def.run(ctx, { ...s.def.defaults(), ...s.opts });
        for (const f of ctx.after) f();
        let outBytes = await buildPdf();
        if (!outBytes) throw new Error('It could not be saved');
        for (const f of ctx.post) outBytes = await f(outBytes);
        const outName = out.kind === 'next' ? `${base}${out.suffix || ' (processed)'}.pdf` : `${base}.pdf`;
        const write = [...(ctx.skipPdf ? [] : [{ name: outName, data: outBytes }]), ...ctx.extra];
        for (const f of write) {
          f.name = out.kind === 'next' ? safeName(f.name) : await batchUnique(used, safeName(f.name), out.kind === 'folder' ? out.exists : null);
          if (out.write) await out.write(f.name, f.data, input); else files.push(f);
        }
        row.out = write.map((f) => f.name); row.pages = doc.pages.length; row.size = outBytes.length;
        if (ctx.bates) row.bates = ctx.bates;
        if (progress) progress.file(i, 'done', row.notes.join(' · '));
      } catch (e) {
        console.warn('action: ' + input.name, e);
        Object.assign(counter, counterBefore); // a failed file uses no numbers
        row.status = 'failed'; row.error = (e && e.message) || String(e);
        if (progress) progress.file(i, 'failed', row.error);
      } finally {
        for (const f of ctx.cleanup) try { f(); } catch {}
      }
    }
  } finally { await batchLeave(kept); }
  return { results, files, csv: batchCsv(results), cancelled };
}
function batchCsv(results) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [['File', 'Saved as', 'Status', 'Pages', 'First Bates', 'Last Bates', 'Note']];
  for (const r of results) rows.push([r.name, (r.out || []).join('; '), r.status, r.pages ?? '', r.bates ? r.bates.first : '', r.bates ? r.bates.last : '', r.error || (r.notes || []).join('; ')]);
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}

/* ----- choosing files and where they go ----- */
const BATCH_CAN_FOLDER_WEB = typeof window.showDirectoryPicker === 'function';
const batchInputFromFile = (f, rel) => ({ name: f.name, rel: rel || f.name, size: f.size, read: async () => new Uint8Array(await f.arrayBuffer()) });
const batchInputFromPath = (path, viaFolder, rel) => ({ name: path.split('/').pop(), path, rel: rel || undefined, viaFolder: !!viaFolder, read: async () => b64ToBytes((await MAC_APP.core.invoke('read_text_file', { path })).content) });
async function batchPickFiles() {
  if (MAC_APP) {
    const picked = await MAC_APP.dialog.open({ multiple: true, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    const list = Array.isArray(picked) ? picked : picked ? [picked] : [];
    return list.map((x) => (typeof x === 'string' ? x : x && x.path)).filter(Boolean).map((p) => batchInputFromPath(p));
  }
  if (window.showOpenFilePicker) {
    try {
      const hs = await window.showOpenFilePicker({ multiple: true, types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }] });
      return Promise.all(hs.map(async (h) => batchInputFromFile(await h.getFile())));
    } catch (e) { if (e && e.name === 'AbortError') return []; }
  }
  return new Promise((res) => {
    const inp = $('#batchInput');
    inp.onchange = () => { const fs = [...inp.files].filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'); inp.value = ''; res(fs.map((f) => batchInputFromFile(f))); };
    inp.click();
  });
}
async function batchPickFolder() {
  if (MAC_APP) {
    const dir = await MAC_APP.dialog.open({ directory: true });
    const path = typeof dir === 'string' ? dir : dir && dir.path; if (!path) return [];
    const l = await MAC_APP.core.invoke('list_folder', { dir: path });
    return l.files.map((f) => batchInputFromPath(path.replace(/\/$/, '') + '/' + f.path, true, f.path)).sort((a, b) => a.path.localeCompare(b.path));
  }
  if (!BATCH_CAN_FOLDER_WEB) return [];
  let dh; try { dh = await window.showDirectoryPicker({ mode: 'read' }); } catch { return []; }
  const out = [];
  const walk = async (h, pre, depth) => {
    for await (const [name, e] of h.entries()) {
      if (name.startsWith('.')) continue;
      if (e.kind === 'file' && /\.pdf$/i.test(name)) out.push(batchInputFromFile(await e.getFile(), pre + name));
      else if (e.kind === 'directory' && depth < 4) await walk(e, pre + name + '/', depth + 1);
    }
  };
  await walk(dh, '', 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}
async function batchPickOutFolder() {
  if (MAC_APP) {
    const dir = await MAC_APP.dialog.open({ directory: true }); const path = typeof dir === 'string' ? dir : dir && dir.path;
    if (!path) return null;
    const at = (name) => path.replace(/\/$/, '') + '/' + name;
    const exists = async (name) => { try { return (await MAC_APP.core.invoke('file_modified', { path: at(name) })) > 0; } catch { return false; } };
    return { kind: 'folder', label: path.split('/').pop(), exists, write: (name, data) => MAC_APP.core.invoke('write_binary_file', { path: at(name), base64: bytesToB64(data) }) };
  }
  if (!BATCH_CAN_FOLDER_WEB) return null;
  let dh; try { dh = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch { return null; }
  const exists = async (name) => { try { await dh.getFileHandle(name); return true; } catch { return false; } };
  return { kind: 'folder', label: dh.name, exists, write: async (name, data) => { const fh = await dh.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(data); await w.close(); } };
}
// Next to the originals: the Mac app, when it may write there (always outside the App Store; there, for files that came
// from a chosen folder).
const batchCanNext = (inputs) => !!MAC_APP && inputs.length > 0 && inputs.every((x) => x.path && (!APP_STORE_BUILD || x.viaFolder));

/* ----- the dialogs ----- */
// A dialog whose own buttons (in the body) choose: `pick(value)` closes it with that value.
function batchAsk(title, body, actions, setup) {
  return dialog(title, body, [...actions, { label: 'pick', value: '__pick' }], (dlg) => {
    const hidden = $(`.dlg-foot [data-a="${actions.length}"]`, dlg); hidden.hidden = true; hidden.style.display = 'none'; hidden.tabIndex = -1; hidden.setAttribute('aria-hidden', 'true');
    let picked = null;
    const pick = (v) => { picked = v; hidden.click(); };
    dlg.__batchPicked = () => picked;
    if (setup) setup(dlg, pick);
  }).then((v) => (v === '__pick' ? $('#dialog').__batchPicked() : v));
}
async function batchDialog() {
  if (batchBusy) return;
  for (;;) {
    const all = batchAll();
    const row = (a) => `<li class="batch-act" data-id="${esc(a.id)}"><div class="batch-what"><strong>${esc(a.name)}</strong><span>${esc(a.steps.map((s) => (batchStep(s.id) ? batchStep(s.id).label : s.id)).join(' → '))}</span></div>
      <button type="button" class="btn primary" data-do="run">Run on files…</button><button type="button" class="btn" data-do="edit">${a.preset ? 'Copy and edit' : 'Edit'}</button>
      <button type="button" class="btn" data-do="export" aria-label="Export ${esc(a.name)}">Export</button>${a.preset ? '' : `<button type="button" class="icon-btn" data-do="delete" aria-label="Delete ${esc(a.name)}">${ic('trash-2')}</button>`}</li>`;
    const v = await batchAsk('Actions', `<p>An action is a list of steps that runs on many PDFs at once, on this device.</p><ul class="batch-acts">${all.map(row).join('')}</ul>`,
      [{ label: 'Import…', value: 'import' }, { label: 'New action', value: 'new' }, { label: 'Close' }], (dlg, pick) => {
        dlg.classList.add('batch-dlg'); dlg.addEventListener('close', () => dlg.classList.remove('batch-dlg'), { once: true });
        $$('.batch-act [data-do]', dlg).forEach((b) => b.addEventListener('click', () => pick({ what: b.dataset.do, id: b.closest('.batch-act').dataset.id })));
      });
    if (!v) return;
    if (v === 'new') { const a = await batchEdit({ name: 'New action', steps: [] }); if (a) batchKeep(a); continue; }
    if (v === 'import') { const a = await batchImportAsk(); if (a) { batchKeep(a); toast(`Imported “${a.name}”`); } continue; }
    const act = batchAll().find((a) => a.id === v.id); if (!act) continue;
    if (v.what === 'run') { await batchRunDialog(act); return; }
    if (v.what === 'edit') { const a = await batchEdit(act.preset ? { name: act.name + ' (copy)', steps: JSON.parse(JSON.stringify(act.steps)) } : act); if (a) batchKeep(a); continue; }
    if (v.what === 'export') { await saveFile(batchExportJson(act), `${act.name}.json`, 'application/json'); continue; }
    if (v.what === 'delete') { batchForget(act.id); toast(`Deleted “${act.name}”`); continue; }
  }
}
function batchImportAsk() {
  return new Promise((res) => {
    const inp = $('#batchJson');
    inp.onchange = async () => {
      const f = inp.files[0]; inp.value = ''; if (!f) return res(null);
      try { res(batchImportJson(await f.text())); } catch (e) { toast(e.message); res(null); }
    };
    inp.click();
  });
}
// The step editor: name, ordered steps with their options; add, remove, move up and down.
async function batchEdit(action) {
  const work = { name: action.name, id: action.id, steps: action.steps.map((s) => ({ id: s.id, opts: { ...(batchStep(s.id) ? batchStep(s.id).defaults() : {}), ...s.opts }, key: uid() })) };
  const addable = Object.entries(BATCH_STEPS).filter(([id]) => batchStepOk(id));
  const r = await dialog(action.id ? 'Edit action' : 'New action', `<div class="batch-ed">
      <label class="field"><span>Name</span><input type="text" id="batchName" value="${esc(work.name)}" autocomplete="off"></label>
      <ol class="batch-steps" id="batchSteps"></ol>
      <div class="batch-add"><label class="field"><span>Add a step</span><select id="batchAddSel">${addable.map(([id, s]) => `<option value="${esc(id)}">${esc(s.label)}</option>`).join('')}</select></label><button type="button" class="btn" id="batchAddBtn">${ic('plus')} Add</button></div>
    </div>`, [{ label: 'Cancel' }, { label: 'Save', value: 'save', primary: true }], (dlg) => {
    dlg.classList.add('batch-dlg'); dlg.addEventListener('close', () => dlg.classList.remove('batch-dlg'), { once: true });
    const list = $('#batchSteps', dlg);
    const sync = () => { for (const li of $$('.batch-step', list)) { const s = work.steps.find((x) => x.key === li.dataset.key); const d = batchStep(s.id); if (d) s.opts = batchReadForm(li, d.defaults()); } work.name = $('#batchName', dlg).value; };
    const draw = () => {
      list.innerHTML = work.steps.length ? work.steps.map((s, k) => { const d = batchStep(s.id); return `<li class="batch-step" data-key="${s.key}"><div class="batch-step-h"><span class="batch-n">${k + 1}</span><strong>${esc(d ? d.label : s.id)}</strong>
        <button type="button" class="icon-btn" data-mv="-1" aria-label="Move up"${k ? '' : ' disabled'}>${ic('arrow-up')}</button><button type="button" class="icon-btn" data-mv="1" aria-label="Move down"${k < work.steps.length - 1 ? '' : ' disabled'}>${ic('arrow-down')}</button><button type="button" class="icon-btn" data-rm aria-label="Remove step">${ic('x')}</button></div>
        <div class="batch-opts">${d ? d.options(s.opts) : bf.note('This step is not in this version of Cowdrey.PDF. It is kept, but files fail when it runs.')}</div></li>`; }).join('') : '<li class="batch-empty">No steps yet. Add one below.</li>';
      icons();
    };
    list.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      sync(); const k = work.steps.findIndex((s) => s.key === b.closest('.batch-step').dataset.key);
      if (b.hasAttribute('data-rm')) work.steps.splice(k, 1);
      else if (b.dataset.mv) { const t = k + +b.dataset.mv; if (t >= 0 && t < work.steps.length) { const [s] = work.steps.splice(k, 1); work.steps.splice(t, 0, s); } }
      draw();
    });
    $('#batchAddBtn', dlg).addEventListener('click', () => { sync(); const id = $('#batchAddSel', dlg).value; work.steps.push({ id, opts: batchStep(id).defaults(), key: uid() }); draw(); });
    dlg.__batchSync = sync;
    draw();
  });
  if (r !== 'save') return null;
  $('#dialog').__batchSync();
  if (!work.steps.length) { toast('Add a step first'); return batchEdit({ ...work, steps: work.steps }); }
  return { id: work.id, name: work.name.trim() || 'Action', steps: work.steps.map(({ id, opts }) => ({ id, opts })) };
}
// Choose the PDFs and where they go, then run with a progress list.
async function batchRunDialog(action) {
  let inputs = [], outFolder = null;
  const unknown = action.steps.filter((s) => !batchStepOk(s.id));
  const r = await dialog(`Run “${action.name}”`, `<div class="batch-run">
      ${unknown.length ? `<p class="prot-err">${esc(unknown.map((s) => (batchStep(s.id) ? batchStep(s.id).label : s.id)).join(', '))}: not in this version. Every file would fail.</p>` : ''}
      <p class="batch-steps-line">${action.steps.map((s, k) => `${k + 1}. ${esc(batchStep(s.id) ? batchStep(s.id).label : s.id)} <span>${esc(batchStepSummary(s))}</span>`).join('<br>')}</p>
      <div class="batch-pick"><button type="button" class="btn" id="batchFiles">${ic('files')} Choose PDFs…</button>${MAC_APP || BATCH_CAN_FOLDER_WEB ? `<button type="button" class="btn" id="batchFolder">${ic('folder-open')} Choose a folder…</button>` : ''}</div>
      <ul class="batch-files" id="batchFileList"><li class="batch-empty">No files chosen yet.</li></ul>
      <fieldset class="batch-outs"><legend>Save the results</legend>
        <label class="batch-check" data-out="zip"><input type="radio" name="batchOut" value="zip" checked><span>In one .zip file</span></label>
        ${MAC_APP || BATCH_CAN_FOLDER_WEB ? '<label class="batch-check" data-out="folder"><input type="radio" name="batchOut" value="folder"><span>In a folder… <small id="batchOutLabel"></small></span></label>' : ''}
        ${MAC_APP ? `<label class="batch-check" data-out="next" hidden><input type="radio" name="batchOut" value="next"><span>Next to the originals, ending in <input type="text" id="batchSuffix" value=" (processed)" aria-label="Ending of the new file names" autocomplete="off"></span></label>` : ''}
      </fieldset></div>`, [{ label: 'Cancel' }, { label: 'Run', value: 'run', primary: true }], (dlg) => {
    dlg.classList.add('batch-dlg'); dlg.addEventListener('close', () => dlg.classList.remove('batch-dlg'), { once: true });
    const list = $('#batchFileList', dlg), runBtn = $('.dlg-foot .btn.primary', dlg);
    const draw = () => {
      list.innerHTML = inputs.length ? inputs.map((x, k) => `<li><span>${esc(x.rel || x.path || x.name)}</span><button type="button" class="icon-btn" data-rm="${k}" aria-label="Remove ${esc(x.name)}">${ic('x')}</button></li>`).join('') : '<li class="batch-empty">No files chosen yet.</li>';
      runBtn.disabled = !inputs.length; runBtn.textContent = inputs.length ? `Run on ${batchPlural(inputs.length, 'file')}` : 'Run';
      const nx = $('[data-out="next"]', dlg); if (nx) { nx.hidden = !batchCanNext(inputs); if (nx.hidden && $('input', nx).checked) $('[value="zip"]', dlg).checked = true; }
      icons();
    };
    const add = (l) => { const seen = new Set(inputs.map((x) => x.path || x.rel || x.name)); for (const x of l) if (!seen.has(x.path || x.rel || x.name)) inputs.push(x); draw(); };
    $('#batchFiles', dlg).addEventListener('click', async () => add(await batchPickFiles()));
    const fb = $('#batchFolder', dlg); if (fb) fb.addEventListener('click', async () => add(await batchPickFolder()));
    list.addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b) { inputs.splice(+b.dataset.rm, 1); draw(); } });
    const fo = $('[value="folder"]', dlg);
    if (fo) fo.addEventListener('change', async () => { outFolder = await batchPickOutFolder(); if (!outFolder) $('[value="zip"]', dlg).checked = true; $('#batchOutLabel', dlg).textContent = outFolder ? outFolder.label : ''; });
    dlg.__batchOut = () => ({ kind: ($('[name="batchOut"]:checked', dlg) || {}).value || 'zip', suffix: ($('#batchSuffix', dlg) || {}).value });
    dlg.__batchSetInputs = (l) => add(l);
    draw();
  });
  if (r !== 'run' || !inputs.length) return;
  const choice = $('#dialog').__batchOut();
  let out = { kind: 'zip' };
  if (choice.kind === 'folder' && outFolder) out = outFolder;
  else if (choice.kind === 'next' && batchCanNext(inputs)) {
    const suffix = String(choice.suffix || '').trim() ? choice.suffix : ' (processed)';
    out = { kind: 'next', suffix, write: (name, data, input) => MAC_APP.core.invoke('write_binary_file', { path: input.path.replace(/[^/]+$/, '') + name, base64: bytesToB64(data) }) };
  }
  return batchStart(action, inputs, out);
}
// The run, with its progress list: per-file status, Cancel (after the current file), then a summary and the log.
async function batchStart(action, inputs, out) {
  if (batchBusy) return null;
  const secrets = {}, run = { secrets };
  for (const s of action.steps) { const d = batchStep(s.id); if (d && d.prepare && !(await d.prepare({ ...d.defaults(), ...s.opts }, run))) return null; }
  batchBusy = true;
  let dlg, finished = false, result = null, ready;
  const shown = new Promise((r) => { ready = r; });
  const progress = { cancelled: false, file: (i, status, note) => {
    if (!dlg) return;
    const li = $(`[data-f="${i}"]`, dlg); if (!li) return;
    li.dataset.status = status; $('.batch-st', li).textContent = { running: 'Working…', done: 'Done', failed: 'Failed', cancelled: 'Not run' }[status] || status;
    if (note != null) $('.batch-nt', li).textContent = note;
    const head = $('.batch-head', dlg); if (status === 'running' && head) head.textContent = `Running action: file ${i + 1} of ${inputs.length}`;
  } };
  const answer = dialog(`Running “${action.name}”`, `<p class="batch-head" aria-live="polite">Getting ready…</p><ol class="batch-prog">${inputs.map((x, i) => `<li data-f="${i}" data-status="waiting"><span class="batch-fn">${esc(x.rel || x.name)}</span><span class="batch-st">Waiting</span><span class="batch-nt"></span></li>`).join('')}</ol><div class="batch-done" hidden></div>`,
    [{ label: 'Cancel', value: 'cancel' }], (d) => { dlg = d; d.classList.add('batch-dlg'); d.addEventListener('close', () => d.classList.remove('batch-dlg'), { once: true }); ready(); });
  answer.then(() => { if (!finished) { progress.cancelled = true; } });
  await shown;
  const foot = $('.dlg-foot [data-a="0"]', dlg), close = foot.onclick;
  // Cancel stops after this file: the dialog stays until the run has stopped, then its button closes it.
  foot.onclick = () => { if (finished) { close(); return; } progress.cancelled = true; foot.textContent = 'Stopping…'; foot.disabled = true; };
  dlg.oncancel = (e) => { e.preventDefault(); foot.click(); };
  try { result = await batchRun(action, inputs, { out, progress, secrets }); }
  catch (e) { console.error(e); toast(`The action stopped: ${e.message || e}`); result = { results: [], files: [], csv: '', cancelled: true }; }
  finally { batchBusy = false; finished = true; }
  const done = result.results.filter((r) => r.status === 'done').length, failed = result.results.filter((r) => r.status === 'failed').length, skipped = result.results.filter((r) => r.status === 'cancelled').length;
  const summary = [`${batchPlural(done, 'file')} done`, failed && `${failed} failed`, skipped && `${skipped} not run (cancelled)`].filter(Boolean).join(', ') + '.';
  if (dlg.open) {
    $('.batch-head', dlg).textContent = summary;
    const box = $('.batch-done', dlg); box.hidden = false;
    const bates = result.results.some((r) => r.bates);
    box.innerHTML = `${bates ? `<button type="button" class="btn" data-log>${ic('download')} Save Bates log (.csv)</button>` : `<button type="button" class="btn" data-log>${ic('download')} Save log (.csv)</button>`}`;
    icons();
    $('[data-log]', box).onclick = () => saveFile(result.csv, `${action.name} ${bates ? 'Bates log' : 'log'}.csv`, 'text/csv');
    foot.textContent = 'Done'; foot.disabled = false; foot.classList.add('primary');
  }
  if (out.kind === 'zip' && result.files.length) {
    try { await saveFile(crdZip(result.files), `${action.name}.zip`, 'application/zip'); }
    catch (e) { console.error(e); toast(`Could not save the results: ${e.message || e}`); }
  } else if (out.kind !== 'zip' && done) toast(`Saved ${batchPlural(result.results.reduce((t, r) => t + (r.out ? r.out.length : 0), 0), 'file')}${out.label ? ' in ' + out.label : ''}`);
  window.__batchLast = result;
  return result;
}

/* ----- commands ----- */
document.body.insertAdjacentHTML('beforeend', '<input type="file" id="batchInput" accept="application/pdf,.pdf" multiple hidden><input type="file" id="batchJson" accept="application/json,.json" hidden>');
cmd('batch', { label: 'Actions…', rlabel: 'Actions', icon: 'list-video', enabled: () => !batchBusy, run: batchDialog });
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('exportText') : -1; if (i >= 0) fm[1].splice(i + 1, 0, 'batch'); else menuAdd('File', ['batch']); }
ribbonAdd('export', 'Batch', ['batch']);
CHANGE_NAMES.optimize ||= 'Optimize';
// Tests: run an action on PDFs given as base64, without the dialogs.
TEST_HOOKS.batchRun = async (action, list, o = {}) => {
  const inputs = list.map((x) => ({ name: x.name, read: async () => b64ToBytes(x.b64) }));
  const progress = { cancelled: false, seen: [], file(i, status) { this.seen.push([i, status]); if (o.cancelAt === i && status === 'running') this.cancelled = true; } };
  const r = await batchRun(action, inputs, { out: { kind: 'zip' }, progress: o.cancelAt != null ? progress : null, secrets: o.secrets || {} });
  return { results: r.results, csv: r.csv, cancelled: r.cancelled, zip: bytesToB64(crdZip(r.files)), names: r.files.map((f) => f.name) };
};
TEST_HOOKS.batchExportJson = batchExportJson;
TEST_HOOKS.batchImportJson = batchImportJson;
TEST_HOOKS.batchSteps = () => Object.keys(BATCH_STEPS).filter(batchStepOk);
TEST_HOOKS.batchPresets = () => batchPresets().map((a) => a.name);
TEST_HOOKS.batchSaved = batchSaved;
TEST_HOOKS.batchKeep = batchKeep;
addStyle(`
.app[data-batch="on"] #pages, .app[data-batch="on"] #sidePanel { visibility: hidden; }
.batch-dlg { width: min(680px, calc(100vw - 32px)); }
.batch-dlg .dlg-body { max-height: min(72vh, 720px); overflow: auto; }
.batch-acts, .batch-steps, .batch-files, .batch-prog { list-style: none; margin: 6px 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.batch-act { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.batch-act .batch-what { flex: 1 1 220px; min-width: 0; display: flex; flex-direction: column; }
.batch-act .batch-what strong { color: var(--ink); font-weight: 600; }
.batch-act .batch-what span, .batch-note, .batch-steps-line span { font-size: 12px; color: var(--ink-3); }
.batch-act .btn { height: 30px; padding: 0 12px; }
.batch-step { border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; }
.batch-step-h { display: flex; align-items: center; gap: 6px; }
.batch-step-h strong { flex: 1; color: var(--ink); }
.batch-n { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--chrome); color: var(--ink-2); font-size: 12px; }
.batch-opts { margin-top: 6px; }
.batch-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.batch-row4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 8px; }
.batch-slots { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0 8px; }
.batch-dlg .field { margin: 4px 0; min-width: 0; }
.batch-dlg .field > span { font-size: 12px; color: var(--ink-3); }
.batch-dlg .field input, .batch-dlg .field select, #batchSuffix { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; width: 100%; box-sizing: border-box; min-width: 0; }
#batchSuffix { width: 140px; padding: 3px 8px; margin-left: 4px; }
.batch-check { display: flex; align-items: center; gap: 8px; margin: 5px 0; color: var(--ink); }
.batch-check input[type="checkbox"], .batch-check input[type="radio"] { accent-color: var(--accent); }
.batch-check small { color: var(--ink-3); }
.batch-sub { padding-left: 24px; }
.batch-add { display: flex; align-items: end; gap: 8px; margin-top: 8px; }
.batch-add .field { flex: 1; }
.batch-add .btn { height: 34px; }
.batch-pick { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
.batch-files { max-height: 180px; overflow: auto; gap: 2px; }
.batch-files li { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 4px 2px 10px; border-radius: 8px; background: var(--chrome); color: var(--ink); font-size: 13px; overflow-wrap: anywhere; }
.batch-empty { color: var(--ink-3); font-size: 13px; background: none !important; }
.batch-outs { border: 0; padding: 0; margin: 10px 0 0; }
.batch-outs legend { font-size: 13px; font-weight: 600; color: var(--ink); margin-bottom: 2px; }
.batch-prog { gap: 2px; }
.batch-prog li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; padding: 5px 10px; border-radius: 8px; background: var(--chrome); font-size: 13px; color: var(--ink); }
.batch-fn { overflow-wrap: anywhere; }
.batch-st { color: var(--ink-3); }
.batch-nt { grid-column: 1 / -1; font-size: 12px; color: var(--ink-3); }
.batch-nt:empty { display: none; }
.batch-prog li[data-status="done"] .batch-st { color: var(--ok, #2f9e44); }
.batch-prog li[data-status="failed"] .batch-st, .batch-prog li[data-status="failed"] .batch-nt { color: var(--danger, #c92a2a); }
.batch-prog li[data-status="running"] .batch-st { color: var(--accent); }
.batch-head { font-weight: 600; color: var(--ink); }
.batch-done { margin-top: 10px; }
@media (max-width: 560px) { .batch-row, .batch-slots { grid-template-columns: minmax(0, 1fr); } .batch-row4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`);
