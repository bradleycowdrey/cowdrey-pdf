/* ---------------- files on a page, video and sound, portfolios ----------------
   Attach file (Comment tab): a paperclip on the page that holds a file (a FileAttachment comment). Insert video or
   audio (Edit tab): a video or sound file kept in the PDF, shown by a poster picture, played here (and in readers that
   play media) from a Play button. Video, sound and Sound comments in an opened PDF play the same way, from the file
   they hold (never from the web). A portfolio (a PDF made as a folder of files) shows its files with Open and Save.

   Marks: { type: 'mdFile', x, y (top left), fid, name, mime, size, desc, icon, at }
          { type: 'mdMedia', rect [x0, y0, x1, y1], fid, name, mime, size, poster (data URL), at }
   The files' bytes are kept on this device with the attached files (15-view.js: IndexedDB, by fid), not in the marks. */
const MD_ICONS = [['PushPin', 'Push pin'], ['Paperclip', 'Paperclip'], ['Graph', 'Graph'], ['Tag', 'Tag']];
const MD_MEDIA_MAX = 200 * 1024 * 1024;
const MD = { at: null, media: null, players: new Set() };
const mdIcon = () => (MD_ICONS.some(([k]) => k === S.mdIcon) ? S.mdIcon : 'PushPin');

/* ---- keeping a file's bytes on this device ---- */
async function mdKeep(bytes) {
  const fid = uid();
  try { await vwDbDo('readwrite', (s) => s.put({ id: fid, doc: doc.id, bytes })); } catch (e) { console.warn('could not keep the file on this device', e); }
  vwBytes.set(fid, bytes);
  return fid;
}

/* ---- the PDF objects: an embedded file and its file specification ---- */
function mdFileSpec(L, out, bytes, name, mime, desc, when) {
  const { PDFName, PDFString, PDFHexString } = L, c = out.context, date = when ? new Date(when) : new Date();
  const ef = c.register(c.flateStream(bytes, { Type: 'EmbeddedFile', ...(mime ? { Subtype: mime } : {}), Params: { Size: bytes.length, CreationDate: PDFString.fromDate(date), ModDate: PDFString.fromDate(date) } }));
  const spec = c.obj({ Type: 'Filespec', EF: { F: ef, UF: ef } });
  spec.set(PDFName.of('F'), PDFString.of(name.replace(/[^\x20-\x7E]/g, '_')));
  spec.set(PDFName.of('UF'), PDFHexString.fromText(name));
  if (desc) spec.set(PDFName.of('Desc'), PDFHexString.fromText(desc));
  return c.register(spec);
}
const mdNum = (n) => { const r = Math.round(n * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
function mdAddAnnot(L, out, p, dict) {
  const { PDFName } = L;
  const ref = dict instanceof L.PDFRef ? dict : out.context.register(dict);
  let annots = p.node.lookup(PDFName.of('Annots'));
  if (!annots) { annots = out.context.obj([]); p.node.set(PDFName.of('Annots'), annots); }
  annots.push(ref);
  return ref;
}

/* ---- Attach file: a file attachment comment ---- */
TOOL_HINTS.mdattach = 'Click where the file goes';
const mdAttachInput = Object.assign(document.createElement('input'), { type: 'file', hidden: true, id: 'mdAttachInput' });
document.body.appendChild(mdAttachInput);
FEATURE.tools.mdattach = {
  down(e, v) {
    e.preventDefault();
    const [x, y] = toPdf(v, ...localPoint(e, v));
    MD.at = { entry: v.entry, x, y };
    mdAttachInput.click();
  },
};
mdAttachInput.addEventListener('change', async () => {
  const f = mdAttachInput.files[0], at = MD.at; mdAttachInput.value = ''; MD.at = null;
  if (!f || !at || !doc) return;
  if (f.size > 100 * 1024 * 1024) { toast(`${f.name} is too big to attach (over 100 MB).`); return; }
  await mdAttachAt(at.entry, at.x, at.y, f.name || 'Attachment', f.type, new Uint8Array(await f.arrayBuffer()));
});
async function mdAttachAt(entry, x, y, name, mime, bytes) {
  const fid = await mdKeep(bytes), before = snapshot();
  const m = { id: uid(), type: 'mdFile', x, y, fid, name, mime: mime || 'application/octet-stream', size: bytes.length, desc: '', icon: mdIcon(), at: Date.now() };
  marksOf(entry).push(m);
  changed(before, 'Attach file');
  setTool('select');
  const v = views.find((vv) => vv.entry === entry);
  if (v) { drawMarks(v); selectNew(v, m); }
  toast(`Attached ${name}. Double-click it to add a description.`);
  if (S.side === 'files') renderSide();
  return m;
}
// The icon, drawn in a 16 × 20 box (PDF units, y up), as paths for the screen and the saved appearance.
function mdIconPaths(icon) {
  switch (icon) {
    case 'Paperclip': return [['M', 11, 6], ['L', 11, 15], ['C', 11, 18.5, 5, 18.5, 5, 15], ['L', 5, 5], ['C', 5, 2.5, 9, 2.5, 9, 5], ['L', 9, 14], ['C', 9, 15.2, 7, 15.2, 7, 14], ['L', 7, 7]];
    case 'Graph': return [['M', 3, 3], ['L', 3, 17], ['M', 3, 3], ['L', 14, 3], ['M', 6, 5], ['L', 6, 10], ['M', 9, 5], ['L', 9, 14], ['M', 12, 5], ['L', 12, 8]];
    case 'Tag': return [['M', 3, 4], ['L', 3, 12], ['L', 8, 17], ['L', 13, 12], ['L', 13, 4], ['Z'], ['M', 7, 12], ['L', 9, 12]];
    default: return [['M', 8, 2], ['L', 8, 10], ['M', 4, 10], ['L', 12, 10], ['M', 5, 10], ['L', 6, 16], ['L', 10, 16], ['L', 11, 10], ['M', 5.5, 16], ['L', 10.5, 16], ['L', 10.5, 18], ['L', 5.5, 18], ['Z']];
  }
}
const MD_W = 16, MD_H = 20;
FEATURE.markTypes.mdFile = {
  draw(v, m) {
    const g = svgEl('g', { class: 'mk' }), P = (u, w) => toView(v, m.x + u, m.y - MD_H + w);
    const box = [P(0, 0), P(MD_W, 0), P(MD_W, MD_H), P(0, MD_H)];
    g.appendChild(svgEl('polygon', { points: box.map((q) => q.join(',')).join(' '), fill: '#FFF3BF', stroke: '#8A6D00', 'stroke-width': 1 }));
    const d = mdIconPaths(m.icon).map((c) => c[0] === 'Z' ? 'Z' : c[0] === 'C' ? `C${P(c[1], c[2]).join(' ')} ${P(c[3], c[4]).join(' ')} ${P(c[5], c[6]).join(' ')}` : c[0] + P(c[1], c[2]).join(' ')).join('');
    g.appendChild(svgEl('path', { d, fill: 'none', stroke: '#5C4800', 'stroke-width': Math.max(1, 1.3 * scale), 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const t = svgEl('title', {}); t.textContent = m.desc ? `${m.name}: ${m.desc}` : m.name; g.appendChild(t);
    g.addEventListener('dblclick', (e) => { if (app.dataset.tool === 'select') { e.stopPropagation(); mdEditFile(v, m); } });
    return g;
  },
  move(m, o, dx, dy) { m.x = o.x + dx; m.y = o.y + dy; },
  menu: ['md_fileDesc', 'md_fileSave', ...MD_ICONS.map(([k]) => 'md_icon' + k)],
  async save({ L, out, p, m }) {
    const { PDFName, PDFString, PDFHexString } = L, bytes = await vwFileBytes(m.fid);
    if (!bytes) { console.warn('attachment missing on this device', m.name); return; }
    const spec = mdFileSpec(L, out, bytes, m.name, m.mime, m.desc, m.at);
    const rect = [m.x, m.y - MD_H, m.x + MD_W, m.y];
    const ops = ['q', '1 0.953 0.749 rg 0.541 0.427 0 RG 1 w', `0.5 0.5 ${MD_W - 1} ${MD_H - 1} re B`, '0.361 0.282 0 RG 1.3 w 1 J 1 j'];
    for (const c of mdIconPaths(m.icon)) ops.push(c[0] === 'Z' ? 'h' : c.slice(1).map(mdNum).join(' ') + ' ' + { M: 'm', L: 'l', C: 'c' }[c[0]]);
    ops.push('S', 'Q');
    const ap = out.context.register(out.context.stream(ops.join('\n'), { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, MD_W, MD_H], Matrix: [1, 0, 0, 1, 0, 0] }));
    const annot = out.context.obj({ Type: 'Annot', Subtype: 'FileAttachment', Rect: rect, F: 4, C: [1, 0.83, 0.23], FS: spec, Name: m.icon || 'PushPin', AP: { N: ap } });
    annot.set(PDFName.of('Contents'), PDFHexString.fromText(m.desc || m.name));
    annot.set(PDFName.of('NM'), PDFString.of('cpdf-' + m.id));
    annot.set(PDFName.of('M'), PDFString.fromDate(new Date(m.at || Date.now())));
    const who = m.author || S.author; if (who) annot.set(PDFName.of('T'), PDFHexString.fromText(who));
    annot.set(PDFName.of('P'), p.ref);
    mdAddAnnot(L, out, p, annot);
  },
};
FEATURE.markLabels.push((m) => (m.type === 'mdFile' ? { label: 'Attached file', text: m.desc ? `${m.name}: ${m.desc}` : m.name } : m.type === 'mdMedia' ? { label: /^audio\//.test(m.mime) ? 'Sound' : 'Video', text: m.name } : null));
async function mdEditFile(v, m) {
  const t = await askText('Description', m.name, m.desc || '', 'Save', false, true);
  if (t == null || t === (m.desc || '')) return;
  const before = snapshot(); m.desc = t.trim(); drawMarks(v); changed(before, 'Attachment');
}
const mdSelFile = () => { const m = doc && selectedMark(); return m && m.type === 'mdFile' ? m : null; };
cmd('md_attachFile', { label: 'Attach file', icon: 'paperclip', enabled: has, pressed: () => app.dataset.tool === 'mdattach', run: () => { setTool('mdattach'); toast('Click where the file goes'); } });
cmd('md_fileDesc', { label: 'Edit description…', icon: 'pencil', enabled: () => !!mdSelFile(), run: () => { const m = mdSelFile(), v = m && views.find((x) => x.entry === selMark.entry); if (v) mdEditFile(v, m); } });
cmd('md_fileSave', { label: 'Save the file…', icon: 'download', enabled: () => !!mdSelFile(), run: async () => { const m = mdSelFile(); if (!m) return; const b = await vwFileBytes(m.fid); if (!b) { toast('That file is no longer on this device. Attach it again.'); return; } await saveFile(b, m.name, m.mime); } });
for (const [k, label] of MD_ICONS) cmd('md_icon' + k, { label: `Icon: ${label}`, icon: 'paperclip', enabled: () => !!mdSelFile(), pressed: () => { const m = mdSelFile(); return !!m && m.icon === k; }, run: () => { const m = mdSelFile(); if (!m) return; S.mdIcon = k; saveSettings(); const before = snapshot(); m.icon = k; redrawPage(selMark.entry); changed(before, 'Attachment'); } });
ribbonAdd('markup', 'Add', ['md_attachFile']);
menuAdd('Comment', ['md_attachFile']);
addStyle(`.app[data-tool="mdattach"] .marks { cursor: copy; }`);
TEST_HOOKS.mdAttachAt = async (n, x, y, name, mime, bytes) => { const m = await mdAttachAt(views[n].entry, x, y, name, mime, new Uint8Array(bytes)); return m.id; };

/* ---- Insert video or audio ---- */
const mdMediaInput = Object.assign(document.createElement('input'), { type: 'file', hidden: true, id: 'mdMediaInput', accept: 'video/mp4,video/webm,audio/mpeg,audio/mp4,audio/x-m4a,.mp4,.m4v,.webm,.mp3,.m4a' });
document.body.appendChild(mdMediaInput);
const mdMimeOf = (name, type) => (/^(video|audio)\//.test(type || '') ? type : ({ mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4' })[(String(name).split('.').pop() || '').toLowerCase()] || '');
mdMediaInput.addEventListener('change', async () => {
  const f = mdMediaInput.files[0]; mdMediaInput.value = '';
  if (!f || !doc) return;
  await mdMediaChosen(f.name, f.type, new Uint8Array(await f.arrayBuffer()));
});
async function mdMediaChosen(name, type, bytes) {
  const mime = mdMimeOf(name, type);
  if (!mime) { toast('Choose an MP4, WebM, MP3 or M4A file.'); return false; }
  if (bytes.length > MD_MEDIA_MAX) { toast(`${name} is too big (over 200 MB).`); return false; }
  const poster = await mdPoster(bytes, mime, name);
  MD.media = { name, mime, bytes, ...poster };
  setTool('mdplace');
  toast(coarse() ? 'Tap where it goes' : 'Drag a box where it goes, or click for its own size');
  return true;
}
// A picture for the page: a frame from the video (its own proportions), else a plain one with the file's name.
async function mdPoster(bytes, mime, name) {
  if (/^video\//.test(mime)) {
    const url = URL.createObjectURL(new Blob([bytes], { type: mime })), v = document.createElement('video');
    try {
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('video')); setTimeout(() => rej(new Error('timeout')), 6000); });
      const t = Math.min(0.5, (Number.isFinite(v.duration) ? v.duration : 1) / 3);
      if (t > 0) await new Promise((res) => { v.onseeked = res; v.currentTime = t; setTimeout(res, 2500); });
      const W = v.videoWidth, H = v.videoHeight; if (!W || !H) throw new Error('no frame');
      const k = Math.min(1, 640 / Math.max(W, H)), c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
      const g = c.getContext('2d'); g.drawImage(v, 0, 0, c.width, c.height); mdPlayGlyph(g, c.width, c.height);
      return { poster: c.toDataURL('image/jpeg', 0.85), w: W, h: H }; // a frame: JPEG, kept as it is in the PDF
    } catch (e) { console.warn('no poster frame', e); } finally { URL.revokeObjectURL(url); v.removeAttribute('src'); }
  }
  const audio = /^audio\//.test(mime), c = document.createElement('canvas'); c.width = audio ? 480 : 640; c.height = audio ? 120 : 360;
  const g = c.getContext('2d'); g.fillStyle = '#1F2430'; g.fillRect(0, 0, c.width, c.height);
  mdPlayGlyph(g, audio ? c.height : c.width, c.height);
  g.fillStyle = '#FFFFFF'; g.font = '600 22px Helvetica, Arial, sans-serif'; g.textBaseline = 'middle';
  const label = String(name).length > 34 ? String(name).slice(0, 33) + '…' : String(name);
  if (audio) g.fillText(label, c.height + 4, c.height / 2); else { g.textAlign = 'center'; g.fillText(label, c.width / 2, c.height - 34); }
  return { poster: c.toDataURL('image/png'), w: c.width, h: c.height };
}
function mdPlayGlyph(g, w, h) {
  const r = Math.min(w, h) * 0.16, cx = w / 2, cy = h / 2;
  g.fillStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#FFFFFF'; g.beginPath(); g.moveTo(cx - r * 0.35, cy - r * 0.5); g.lineTo(cx + r * 0.55, cy); g.lineTo(cx - r * 0.35, cy + r * 0.5); g.closePath(); g.fill();
}
TOOL_HINTS.mdplace = 'Drag a box where the video or sound goes';
FEATURE.tools.mdplace = {
  down(e, v) {
    e.preventDefault();
    const pend = MD.media; if (!pend) { setTool('select'); return; }
    const [sx, sy] = localPoint(e, v), box = document.createElement('div');
    box.className = 'md-drag'; v.el.appendChild(box);
    let last = [sx, sy];
    const show = () => { const [x, y] = last; Object.assign(box.style, { left: Math.min(x, sx) + 'px', top: Math.min(y, sy) + 'px', width: Math.abs(x - sx) + 'px', height: Math.abs(y - sy) + 'px' }); };
    const move = (ev) => { last = localPoint(ev, v); show(); };
    const up = async () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); box.remove();
      const a = toPdf(v, sx, sy), b = toPdf(v, ...last);
      let rect = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
      if (rect[2] - rect[0] < 12 || rect[3] - rect[1] < 12) { // a click: its own proportions, 240 points wide, from there
        const w = /^audio\//.test(pend.mime) ? 240 : 240, h = w * pend.h / pend.w;
        rect = [a[0], a[1] - h, a[0] + w, a[1]];
      }
      MD.media = null;
      await mdPlaceMedia(v.entry, rect, pend);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
};
async function mdPlaceMedia(entry, rect, pend) {
  const fid = await mdKeep(pend.bytes), before = snapshot();
  const m = { id: uid(), type: 'mdMedia', rect: rect.map((n) => +n.toFixed(3)), fid, name: pend.name, mime: pend.mime, size: pend.bytes.length, poster: pend.poster, at: Date.now() };
  marksOf(entry).push(m);
  changed(before, /^audio\//.test(m.mime) ? 'Insert sound' : 'Insert video');
  setTool('select');
  const v = views.find((vv) => vv.entry === entry); if (v) { drawMarks(v); selectNew(v, m); }
  toast('Added. Some apps show only its picture; Cowdrey.PDF and Acrobat play it.');
  return m;
}
FEATURE.markTypes.mdMedia = {
  draw(v, m) {
    const g = svgEl('g', { class: 'mk' }), [x0, y0, x1, y1] = m.rect;
    const o = toView(v, x0, y1), X = toView(v, x1, y1), Y = toView(v, x0, y0);
    g.appendChild(svgEl('image', { x: 0, y: 0, width: 1, height: 1, href: m.poster, preserveAspectRatio: 'none', transform: `matrix(${X[0] - o[0]} ${X[1] - o[1]} ${Y[0] - o[0]} ${Y[1] - o[1]} ${o[0]} ${o[1]})` }));
    const q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([a, b]) => toView(v, a, b).join(','));
    g.appendChild(svgEl('polygon', { points: q.join(' '), fill: 'transparent', stroke: '#5F5F5F', 'stroke-width': 1 }));
    g.addEventListener('dblclick', (e) => { if (app.dataset.tool === 'select') { e.stopPropagation(); mdPlayMark(v, m); } });
    return g;
  },
  move(m, o, dx, dy) { m.rect = [o.rect[0] + dx, o.rect[1] + dy, o.rect[2] + dx, o.rect[3] + dy]; },
  menu: ['md_play'],
  async save({ L, out, p, m }) {
    const { PDFName, PDFString, PDFHexString } = L, c = out.context, bytes = await vwFileBytes(m.fid);
    if (!bytes) { console.warn('media missing on this device', m.name); return; }
    const spec = mdFileSpec(L, out, bytes, m.name, m.mime, '', m.at);
    const [x0, y0, x1, y1] = m.rect, w = x1 - x0, h = y1 - y0;
    const img = FEATURE.picXObject ? await FEATURE.picXObject(L, out, { data: m.poster }, {}) : (await out.embedPng(m.poster)).ref;
    const ap = c.register(c.stream(`q ${mdNum(w)} 0 0 ${mdNum(h)} 0 0 cm /Poster Do Q`, { Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, w, h], Resources: { XObject: { Poster: img } } }));
    const ref = c.nextRef(), audio = /^audio\//.test(m.mime);
    const clip = c.obj({ Type: 'MediaClip', S: 'MCD', D: spec, P: { Type: 'MediaPermissions' } });
    clip.set(PDFName.of('N'), PDFHexString.fromText(m.name));
    clip.set(PDFName.of('CT'), PDFString.of(m.mime));
    clip.lookup(PDFName.of('P')).set(PDFName.of('TF'), PDFString.of('TEMPACCESS'));
    const rendition = c.obj({ Type: 'Rendition', S: 'MR', C: clip, P: { Type: 'MediaPlayParams', BE: { C: true } } });
    rendition.set(PDFName.of('N'), PDFHexString.fromText(m.name));
    const annot = c.obj({ Type: 'Annot', Subtype: 'Screen', Rect: [x0, y0, x1, y1], F: 4, P: p.ref, AP: { N: ap }, A: { Type: 'Action', S: 'Rendition', OP: 0, AN: ref, R: rendition } });
    annot.set(PDFName.of('T'), PDFHexString.fromText(m.name));
    annot.set(PDFName.of('Contents'), PDFHexString.fromText(`${audio ? 'Sound' : 'Video'}: ${m.name}`));
    annot.set(PDFName.of('NM'), PDFString.of('cpdf-' + m.id));
    annot.set(PDFName.of('M'), PDFString.fromDate(new Date(m.at || Date.now())));
    c.assign(ref, annot);
    mdAddAnnot(L, out, p, ref);
  },
};
const mdSelMedia = () => { const m = doc && selectedMark(); return m && m.type === 'mdMedia' ? m : null; };
cmd('md_insertMedia', { label: 'Insert video or audio…', rlabel: 'Video or audio', icon: 'clapperboard', enabled: has, pressed: () => app.dataset.tool === 'mdplace', run: () => mdMediaInput.click() });
cmd('md_play', { label: 'Play', icon: 'play', enabled: () => !!mdSelMedia(), run: () => { const m = mdSelMedia(), v = m && views.find((x) => x.entry === selMark.entry); if (v) mdPlayMark(v, m); } });
ribbonAdd('edit', 'Add', ['md_insertMedia']);
{ const em = MENUS.find(([t]) => t === 'Edit')[1], j = em.indexOf('image'); em.splice(j < 0 ? em.length : j + 1, 0, 'md_insertMedia'); }
TEST_HOOKS.mdMediaChosen = (name, type, bytes) => mdMediaChosen(name, type, new Uint8Array(bytes));
TEST_HOOKS.mdPlaceMedia = async (n, rect) => { const pend = MD.media; MD.media = null; const m = await mdPlaceMedia(views[n].entry, rect, pend); return m.id; };

/* ---- playing: a player in the media's box ---- */
addStyle(`
.page .annotationLayer .mediaAnnotation { display: none !important; }
.md-play { position: absolute; z-index: 5; display: flex; align-items: center; gap: 6px; transform: translate(-50%, -50%); height: 34px; padding: 0 14px 0 10px; border-radius: 17px; border: 1px solid rgba(255,255,255,.6); background: rgba(20,22,28,.78); color: #fff; font: 600 13px/1 var(--font, system-ui); cursor: pointer; box-shadow: 0 3px 12px rgba(0,0,0,.3); }
.md-play:hover { background: rgba(20,22,28,.92); }
.md-play svg { width: 16px; height: 16px; }
.md-player { position: absolute; z-index: 5; background: #000; object-fit: contain; }
audio.md-player { background: transparent; }
.md-drag { position: absolute; z-index: 5; border: 1.5px dashed var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); pointer-events: none; }
.app[data-tool="mdplace"] .marks { cursor: crosshair; }
`);
// The box on screen of a rect in PDF units (any page rotation).
function mdBox(v, r) {
  const q = [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]].map(([x, y]) => toView(v, x, y));
  const xs = q.map((p) => p[0]), ys = q.map((p) => p[1]);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}
function mdPlayer(v, rect, bytes, mime, name, key) {
  const old = v.el.querySelector(`:scope > .md-player[data-key="${CSS.escape(key)}"]`); if (old) { old.play && old.play().catch(() => {}); return old; }
  const type = /^(video|audio)\//.test(mime || '') ? mime : 'video/mp4';
  const url = URL.createObjectURL(new Blob([bytes], { type })), audio = type.startsWith('audio/');
  const el = document.createElement(audio ? 'audio' : 'video'), b = mdBox(v, rect);
  el.className = 'md-player'; el.dataset.key = key; el.src = url; el.controls = true; el.autoplay = true; el.title = name || '';
  if (!audio) el.playsInline = true;
  Object.assign(el.style, { left: b.left + 'px', top: (audio ? b.top + Math.max(0, b.height - 54) / 2 : b.top) + 'px', width: b.width + 'px', height: (audio ? Math.min(54, b.height || 54) : b.height) + 'px' });
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('emptied', () => URL.revokeObjectURL(url), { once: true });
  v.el.appendChild(el); MD.players.add(el);
  el.play().catch(() => {});
  return el;
}
async function mdPlayMark(v, m) {
  const b = await vwFileBytes(m.fid);
  if (!b) { toast('That file is no longer on this device. Insert it again.'); return; }
  mdPlayer(v, m.rect, b, m.mime, m.name, 'm' + m.id);
}
// Video, sound and Sound comments in the PDF: a Play button on each (what they hold is read only when it is pressed).
FEATURE.afterRender.push(async (v) => {
  let annots; try { annots = await v.page.getAnnotations({ intent: 'display' }); } catch { return; }
  if (!v.el.isConnected) return;
  const gone = new Set(marksOf(v.entry).filter((m) => m.type === 'ae' && m.deleted).map((m) => m.ref));
  const pd = pdfDocs.get(v.entry.src);
  for (const a of annots) {
    if (!a.rect || gone.has(a.id) || !['Screen', 'RichMedia', 'Sound'].includes(a.subtype)) continue;
    const media = a.richMedia;
    if (!media && a.subtype !== 'Sound') continue;
    if (v.el.querySelector(`:scope > .md-play[data-key="${CSS.escape('a' + a.id)}"]`)) continue;
    const b = mdBox(v, a.rect), btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'md-play'; btn.dataset.key = 'a' + a.id;
    btn.innerHTML = `${ic('play')}<span>Play</span>`;
    btn.setAttribute('aria-label', `Play ${(media && media.filename) || 'sound'}`);
    btn.style.left = b.left + b.width / 2 + 'px'; btn.style.top = b.top + b.height / 2 + 'px';
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
    btn.addEventListener('click', async (e) => {
      e.stopPropagation(); btn.disabled = true;
      let bytes = null, mime = media && media.contentType;
      try { bytes = media ? await pd.getAttachmentContent(media.fileId) : null; } catch (er) { console.warn(er); }
      if (a.subtype === 'Sound' && (!bytes || !mdIsRiff(bytes))) { const w = await mdSoundWav(v.entry, a.id).catch(() => null); if (w) { bytes = w; mime = 'audio/wav'; } }
      btn.disabled = false;
      if (!bytes) { toast('This media can’t be played here.'); return; }
      btn.remove();
      mdPlayer(v, a.rect, bytes, mime, media && media.filename, 'a' + a.id);
    });
    v.el.appendChild(btn); icons();
  }
});
const mdIsRiff = (b) => b && b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46;
// A Sound comment's samples as a WAV file: /R rate, /C channels, /B bits, /E encoding (Raw, Signed, muLaw, ALaw).
function mdWav(samples, rate, ch, bits, enc) {
  const law = enc === 'muLaw' || enc === 'ALaw', outBits = law ? 16 : bits === 16 ? 16 : 8, n = law ? samples.length : Math.floor(samples.length / (bits === 16 ? 2 : 1));
  const data = new Uint8Array(n * (outBits / 8)), dv = new DataView(data.buffer);
  for (let i = 0; i < n; i++) {
    if (law) {
      const u = ~samples[i] & 0xFF;
      let s;
      if (enc === 'muLaw') { const t = ((u & 0x0F) << 3) + 0x84; s = (t << ((u & 0x70) >> 4)) - 0x84; s = u & 0x80 ? -s : s; }
      else { const a = samples[i] ^ 0x55, seg = (a & 0x70) >> 4; let t = (a & 0x0F) << 4; t += seg ? 0x108 : 8; if (seg > 1) t <<= seg - 1; s = a & 0x80 ? t : -t; }
      dv.setInt16(i * 2, Math.max(-32768, Math.min(32767, s)), true);
    } else if (bits === 16) { // PDF samples are big-endian; WAV wants little-endian, signed
      let x = (samples[i * 2] << 8) | samples[i * 2 + 1];
      if (enc === 'Signed') { if (x >= 0x8000) x -= 0x10000; } else x -= 0x8000;
      dv.setInt16(i * 2, x, true);
    } else data[i] = enc === 'Signed' ? (samples[i] + 128) & 0xFF : samples[i]; // WAV 8-bit is unsigned
  }
  const head = new DataView(new ArrayBuffer(44)), w = (o, s) => { for (let k = 0; k < 4; k++) head.setUint8(o + k, s.charCodeAt(k)); };
  const align = ch * outBits / 8;
  w(0, 'RIFF'); head.setUint32(4, 36 + data.length, true); w(8, 'WAVE'); w(12, 'fmt '); head.setUint32(16, 16, true); head.setUint16(20, 1, true);
  head.setUint16(22, ch, true); head.setUint32(24, rate, true); head.setUint32(28, rate * align, true); head.setUint16(32, align, true); head.setUint16(34, outBits, true);
  w(36, 'data'); head.setUint32(40, data.length, true);
  const out = new Uint8Array(44 + data.length); out.set(new Uint8Array(head.buffer), 0); out.set(data, 44);
  return out;
}
async function mdSoundWav(entry, id) {
  const r = /^(\d+)R(\d*)$/.exec(String(id || '')); if (!r) return null;
  const L = await loadPdfLib(), d = await picSrcDoc(entry.src); if (!d) return null;
  const a = d.context.lookup(L.PDFRef.of(+r[1], +(r[2] || 0))); if (!(a instanceof L.PDFDict)) return null;
  const st = a.lookup(L.PDFName.of('Sound')); if (!st || !st.dict) return null;
  const num = (k, dflt) => { const x = st.dict.lookup(L.PDFName.of(k)); return x instanceof L.PDFNumber ? x.asNumber() : dflt; };
  const e = st.dict.lookup(L.PDFName.of('E')), enc = e ? String(e).slice(1) : 'Raw';
  return mdWav(picStreamBytes(L, st), Math.round(num('R', 8000)), num('C', 1), num('B', 8), enc);
}
TEST_HOOKS.mdWav = (s, r, c, b, e) => Array.from(mdWav(new Uint8Array(s), r, c, b, e));
FEATURE.onDocClosed.push(() => { for (const el of MD.players) { try { el.pause(); el.removeAttribute('src'); el.load(); } catch {} } MD.players.clear(); });

/* ---- portfolios: a PDF that is a folder of files ---- */
let mdPf = null; // { doc, files: [{ key, name, desc, size, mod, fields: {}, folder, bytes() }], schema: [{ key, name, type }] }
async function mdReadPortfolio(d) {
  const L = await loadPdfLib(), pdf = await picSrcDoc(0); if (!pdf || doc !== d) return null;
  const { PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFNumber } = L, N = (k) => PDFName.of(k), c = pdf.context;
  const look = (o) => (o instanceof PDFRef ? c.lookup(o) : o);
  const col = look(pdf.catalog.get(N('Collection'))); if (!(col instanceof PDFDict)) return null;
  const str = (o) => { o = look(o); return o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : o instanceof PDFNumber ? String(o.asNumber()) : ''; };
  // Columns: the schema's fields, in their order, those shown
  const schema = [], sc = look(col.get(N('Schema')));
  if (sc instanceof PDFDict) for (const [k, v] of sc.entries()) {
    const f = look(v); if (!(f instanceof PDFDict) || String(f.get(N('Type'))) === '/CollectionSchema') continue;
    const V = look(f.get(N('V'))), O = look(f.get(N('O')));
    if (V && String(V) === 'false') continue;
    schema.push({ key: k.decodeText(), name: str(f.get(N('N'))) || k.decodeText(), type: String(f.get(N('Subtype')) || '/S').slice(1), order: O instanceof PDFNumber ? O.asNumber() : 999 });
  }
  schema.sort((a, b) => a.order - b.order);
  // Folders: ids to their path
  const folders = new Map(), fr = look(col.get(N('Folders')));
  const walk = (f, path, seen = new Set()) => {
    for (let x = f; x instanceof PDFDict && !seen.has(x); x = look(x.get(N('Next')))) {
      seen.add(x);
      const id = look(x.get(N('ID'))), name = str(x.get(N('Name'))), p = path === null ? '' : path ? `${path}/${name}` : name;
      if (id instanceof PDFNumber) folders.set(id.asNumber(), p);
      walk(look(x.get(N('Child'))), p, seen);
      if (path === null) break; // the root has no siblings
    }
  };
  if (fr instanceof PDFDict) walk(fr, null);
  const files = [];
  const names = look(pdf.catalog.get(N('Names'))), tree = names instanceof PDFDict ? look(names.get(N('EmbeddedFiles'))) : null;
  const leaves = (node, seen = new Set()) => {
    if (!(node instanceof PDFDict) || seen.has(node)) return; seen.add(node);
    const arr = look(node.get(N('Names')));
    if (arr instanceof PDFArray) for (let k = 0; k + 1 < arr.size(); k += 2) {
      const key = str(arr.get(k)), spec = look(arr.get(k + 1)); if (!(spec instanceof PDFDict)) continue;
      const ef = look(spec.get(N('EF'))), st = ef instanceof PDFDict ? look(ef.get(N('UF')) || ef.get(N('F'))) : null;
      const params = st && st.dict ? look(st.dict.get(N('Params'))) : null, size = params instanceof PDFDict ? look(params.get(N('Size'))) : null;
      const ci = look(spec.get(N('CI'))), fields = {};
      if (ci instanceof PDFDict) for (const [fk, fv] of ci.entries()) { const x = look(fv); fields[fk.decodeText()] = x instanceof PDFDict ? str(x.get(N('D'))) : str(x); }
      const fm = /^<(\d+)>(.*)$/.exec(key), name = str(spec.get(N('UF'))) || str(spec.get(N('F'))) || (fm ? fm[2] : key);
      let mod = ''; try { const md = params instanceof PDFDict ? look(params.get(N('ModDate'))) : null; const dt = md && md.decodeDate && md.decodeDate(); if (dt) mod = dt.toLocaleDateString(); } catch {}
      files.push({ key, name, desc: str(spec.get(N('Desc'))), size: size instanceof PDFNumber ? size.asNumber() : 0, mod, fields, folder: fm ? folders.get(+fm[1]) || '' : '', bytes: () => (st && st.dict ? picStreamBytes(L, st) : null) });
    }
    const kids = look(node.get(N('Kids'))); if (kids instanceof PDFArray) for (const r of kids.asArray()) leaves(look(r), seen);
  };
  leaves(tree);
  files.sort((a, b) => a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  return { doc: d, files, schema };
}
FEATURE.onDocShown.push(async (d) => {
  mdPf = null; mdPfBar();
  let pf = null; try { pf = await mdReadPortfolio(d); } catch (e) { console.warn('portfolio', e); }
  if (doc !== d) return;
  mdPf = pf; mdPfBar();
});
FEATURE.onDocClosed.push(() => { mdPf = null; mdPfBar(); });
function mdPfBar() {
  let bar = $('#mdPfBar');
  if (!mdPf || mdPf.doc !== doc) { if (bar) bar.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'mdPfBar'; bar.className = 'md-pf-bar'; bar.setAttribute('role', 'status');
    viewer.parentNode.insertBefore(bar, viewer);
  }
  const n = mdPf.files.length;
  bar.innerHTML = `${ic('folder-open')}<span><b>Portfolio</b> · This PDF holds ${n} file${n === 1 ? '' : 's'}.</span><button type="button" class="btn" data-cmd="md_portfolio">Show files</button>`;
  icons();
}
async function mdPfPanel() {
  const pf = mdPf; if (!pf) return;
  const cols = pf.schema.length ? pf.schema : [{ key: '_name', name: 'Name', type: 'F' }, { key: '_desc', name: 'Description', type: 'Desc' }, { key: '_size', name: 'Size', type: 'Size' }];
  const cell = (f, c) => c.type === 'F' ? f.name : c.type === 'Desc' ? f.desc : c.type === 'Size' ? vwSize(f.size) : c.type === 'ModDate' ? f.mod : c.type === 'CreationDate' ? '' : f.fields[c.key] || '';
  let folder = null;
  const rows = pf.files.map((f, k) => {
    const head = f.folder !== folder ? `<tr class="md-pf-folder"><td colspan="${cols.length + 1}">${ic('folder')} ${esc(f.folder || 'Top level')}</td></tr>` : '';
    folder = f.folder;
    const pdf = /\.pdf$/i.test(f.name);
    return head + `<tr class="md-pf-file">${cols.map((c) => `<td>${esc(cell(f, c))}</td>`).join('')}<td class="md-pf-acts">${pdf ? `<button type="button" class="btn" data-pf-open="${k}">Open</button>` : ''}<button type="button" class="btn" data-pf-save="${k}">Save</button></td></tr>`;
  }).join('');
  const body = `<p>The files in this portfolio. Open a PDF to read it here, or save any file.</p><div class="md-pf-wrap"><table class="md-pf"><thead><tr>${cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}<th></th></tr></thead><tbody>${rows || `<tr><td colspan="${cols.length + 1}">No files.</td></tr>`}</tbody></table></div>`;
  await dialog('Portfolio', body, [{ label: 'Close', primary: true }], (dlg) => {
    $$('[data-pf-open]', dlg).forEach((b) => { b.onclick = async () => { const f = pf.files[+b.dataset.pfOpen], bytes = f && f.bytes(); if (!bytes) return; $('[data-x]', dlg).click(); await openBytes(new Uint8Array(bytes), f.name); }; });
    $$('[data-pf-save]', dlg).forEach((b) => { b.onclick = async () => { const f = pf.files[+b.dataset.pfSave], bytes = f && f.bytes(); if (bytes) await saveFile(bytes, f.name, 'application/octet-stream'); }; });
  });
}
cmd('md_portfolio', { label: 'Portfolio files…', icon: 'folder-open', enabled: () => !!mdPf && mdPf.doc === doc, hidden: false, run: mdPfPanel });
addStyle(`
.md-pf-bar { display: flex; align-items: center; gap: 10px; padding: 6px 12px; background: color-mix(in srgb, var(--accent) 12%, var(--surface)); color: var(--ink); border-bottom: 1px solid var(--line); font-size: 13px; }
.md-pf-bar svg { width: 16px; height: 16px; flex: none; }
.md-pf-bar span { flex: 1; min-width: 0; }
.md-pf-bar .btn { height: 28px; padding: 0 12px; }
.md-pf-wrap { max-height: 55vh; overflow: auto; }
.md-pf { width: 100%; border-collapse: collapse; font-size: 13px; }
.md-pf th { text-align: left; font-weight: 600; color: var(--ink-2); border-bottom: 1px solid var(--line); padding: 6px; position: sticky; top: 0; background: var(--surface); }
.md-pf td { padding: 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
.md-pf .md-pf-folder td { font-weight: 600; color: var(--ink-2); }
.md-pf .md-pf-folder svg { width: 14px; height: 14px; vertical-align: -2px; }
.md-pf .md-pf-acts { white-space: nowrap; text-align: right; }
.md-pf .md-pf-acts .btn { height: 26px; padding: 0 10px; margin-left: 4px; font-size: 12px; }
`);
TEST_HOOKS.portfolio = () => mdPf && { files: mdPf.files.map((f) => ({ name: f.name, folder: f.folder, desc: f.desc, fields: f.fields })), schema: mdPf.schema };
TEST_HOOKS.addSource = (bytes, name) => addSource(new Uint8Array(bytes), null, null, name);
TEST_HOOKS.annotFiles = async (n) => {
  const v = views[n], pd = pdfDocs.get(v.entry.src), list = await v.page.getAnnotations({ intent: 'display' });
  return Promise.all(list.filter((a) => a.subtype === 'FileAttachment').map(async (a) => ({ name: a.file && a.file.filename, desc: a.contentsObj && a.contentsObj.str, icon: a.name, bytes: Array.from((a.file && a.file.content) || await pd.getAttachmentContent(a.fileId) || []) })));
};
