/* ---------------- PDF/X (src/features/85-pdfx.js) ----------------
   File > Save as PDF/X… (and Export > Print): a copy for commercial printing in PDF/X-1a:2003, PDF/X-3:2003 or
   PDF/X-4, made by pdfaConvert (84-pdfa.js) with the FOGRA39 coated CMYK printing condition as the output intent
   (GTS_PDFX, with its ICC profile). What it changes: every font embedded, a TrimBox on every page, /Trapped stated,
   the version in the Info dictionary (and the XMP), RGB defined as sRGB (DefaultRGB) for X-3 and X-4, comments inside
   the printed area kept but set not to print, scripts removed once you agree. What it refuses (nothing is saved):
   RGB or calibrated colour in X-1a; transparency, 16-bit and JPEG 2000 pictures in X-1a and X-3 (PDF 1.4 kinds);
   attachments. It does not convert colours.
   - pdfxCheck(bytes, { pdfx }) -> the same shape as pdfaCheck: a built-in rule subset modelled on ISO 15930-4
     (X-1a:2003), 15930-6 (X-3:2003) and 15930-7 (X-4). veraPDF does not check PDF/X; neither is this a certified
     validator. */

const PDFX_KINDS = [['1a', 'PDF/X-1a', 'CMYK and grey only. For printers that ask for X-1a.'], ['3', 'PDF/X-3', 'Also keeps RGB colours, defined as sRGB.'], ['4', 'PDF/X-4', 'Keeps transparency and every colour space. The modern choice.']];

async function pdfxCheck(bytes, opts = {}) {
  const L = await loadPdfLib(), { PDFName, PDFDict, PDFArray, PDFStream, PDFNumber } = L, N = PDFName.of;
  const problems = [], passed = [], names = []; let cur = null;
  const rule = (id, fn) => { names.push(id); const n = problems.length; cur = id; try { fn(); } catch (e) { problems.push({ rule: id, severity: 'error', fix: 'manual', text: `Could not check: ${e.message || e}` }); } if (problems.length === n) passed.push(id); };
  const bad = (text, o = {}) => problems.push({ rule: cur, severity: o.severity || 'error', ...(o.page ? { page: o.page } : {}), fix: o.fix || 'manual', text });
  let out;
  try { out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
  catch (e) { const r = [{ rule: 'parse', severity: 'error', fix: 'manual', text: `The file could not be read: ${e.message || e}` }]; r.passed = []; r.checks = 1; return r; }
  const ctx = out.context, look = (o) => ctx.lookup(o), cat = out.catalog, info = look(ctx.trailerInfo.Info);
  const want = String(opts.pdfx || '').toLowerCase() || ({ 'PDF/X-1a:2003': '1a', 'PDF/X-1a:2001': '1a', 'PDF/X-3:2003': '3', 'PDF/X-3:2002': '3', 'PDF/X-4': '4' })[pdfaText(L, info, 'GTS_PDFXVersion')] || '4';
  const P = pdfaProfile({ pdfx: want });
  const head = pdfaLatin1(bytes.subarray(0, 16)), m = /^%PDF-1\.(\d)/.exec(head);
  rule('header', () => { if (!m) bad('The file header is not %PDF-1.x.'); else if (+m[1] > P.version) bad(`The file says it is PDF 1.${m[1]}; ${P.label} allows PDF 1.${P.version} at most.`); });
  rule('no-encryption', () => { if (ctx.trailerInfo.Encrypt || out.isEncrypted) bad('The file is encrypted.'); });
  rule('trailer-id', () => { const id = look(ctx.trailerInfo.ID); if (!(id instanceof PDFArray) || id.size() !== 2) bad('The file has no ID in its trailer.'); });
  if (P.version <= 4) rule('pdf14', () => { if (/\/Type\s*\/ObjStm\b/.test(pdfaLatin1(bytes))) bad(`The file uses object streams, which ${P.label} (PDF 1.4) doesn't allow.`); });
  rule('version-key', () => {
    const v = info instanceof PDFDict ? pdfaText(L, info, 'GTS_PDFXVersion') : undefined;
    if (v !== P.gts) bad(`The document information doesn't say ${P.gts} (GTS_PDFXVersion is ${v ? `“${v}”` : 'missing'}).`);
  });
  rule('trapped', () => { const t = info instanceof PDFDict ? pdfaText(L, info, 'Trapped') : undefined; if (t !== 'True' && t !== 'False') bad('The document information doesn\'t say whether the file is trapped (Trapped True or False).'); });
  rule('title', () => { if (!(info instanceof PDFDict) || !pdfaText(L, info, 'Title')) bad('The document has no title.'); });
  rule('dates', () => { for (const k of ['CreationDate', 'ModDate']) if (!(info instanceof PDFDict) || !pdfaParseDate(pdfaText(L, info, k))) bad(`The document information has no ${k === 'ModDate' ? 'modification' : 'creation'} date.`); });
  let profile = null;
  rule('output-intent', () => {
    const oi = cat.lookup(N('OutputIntents')); const list = oi instanceof PDFArray ? oi.asArray().map(look).filter((o) => o instanceof PDFDict && pdfaName(L, o.get(N('S'))) === 'GTS_PDFX') : [];
    if (list.length !== 1) { bad(list.length ? 'The file has more than one PDF/X output intent.' : 'The file has no PDF/X output intent (GTS_PDFX).'); return; }
    if (!pdfaText(L, list[0], 'OutputConditionIdentifier')) bad('The output intent has no OutputConditionIdentifier.');
    const s = list[0].lookup(N('DestOutputProfile'));
    if (!(s instanceof PDFStream)) { bad('The output intent has no destination profile.'); return; }
    profile = pdfaIccInfo(pdfaStreamBytes(L, s));
    if (!profile || profile.magic !== 'acsp') { bad('The destination profile is not a valid ICC profile.'); return; }
    if (profile.cls !== 'prtr') bad('The destination profile is not an output (printer) profile.');
    if (P.version <= 4 && profile.version > 2) bad(`The destination profile is ICC version ${profile.version}; ${P.label} needs version 2.`);
    if (P.pdfx === '1a' && profile.space !== 'CMYK') bad('PDF/X-1a needs a CMYK destination profile.');
    const nn = s.dict.lookup(N('N')), w = { CMYK: 4, 'RGB ': 3, GRAY: 1 }[profile.space]; if (!(nn instanceof PDFNumber) || nn.asNumber() !== w) bad('The destination profile\'s number of colours is wrong.');
  });
  rule('boxes', () => {
    out.getPages().forEach((p, i) => {
      const box = (k) => { const b = p.node.lookup(N(k)); return b instanceof PDFArray && b.size() === 4 ? b.asArray().map((x) => look(x).asNumber()) : null; };
      const norm = (b) => b && [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
      const inside = (a, b) => a[0] >= b[0] - 0.01 && a[1] >= b[1] - 0.01 && a[2] <= b[2] + 0.01 && a[3] <= b[3] + 0.01;
      const media = norm(box('MediaBox')), trim = norm(box('TrimBox')), art = norm(box('ArtBox')), bleed = norm(box('BleedBox'));
      if (!media) { bad(`Page ${i + 1} has no MediaBox.`, { page: i + 1 }); return; }
      if (!trim && !art) bad(`Page ${i + 1} has no TrimBox (its trimmed size).`, { page: i + 1 });
      if (trim && art) bad(`Page ${i + 1} has both a TrimBox and an ArtBox.`, { page: i + 1 });
      if (bleed && !inside(bleed, media)) bad(`Page ${i + 1}: the BleedBox goes outside the MediaBox.`, { page: i + 1 });
      if ((trim || art) && !inside(trim || art, bleed || media)) bad(`Page ${i + 1}: the TrimBox goes outside the ${bleed ? 'BleedBox' : 'MediaBox'}.`, { page: i + 1 });
    });
  });
  const fonts = pdfaPageFonts(L, out);
  rule('fonts-embedded', () => {
    for (const [f, w] of fonts) {
      const sub = pdfaName(L, f.get(N('Subtype'))); if (sub === 'Type3') continue;
      let fd = f.lookup(N('FontDescriptor'));
      if (sub === 'Type0') { const ds = f.lookup(N('DescendantFonts')); const cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null; fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null; }
      if (!(fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.lookup(N(k)) instanceof PDFStream))) bad(`Font ${(pdfaName(L, f.get(N('BaseFont'))) || w.key).replace(/^[A-Z]{6}\+/, '')} is not embedded${w.page ? ` on page ${w.page}` : ''}.`, { page: w.page || undefined });
    }
  });
  const seen = pdfaInspect(L, out);
  rule('colour', () => {
    const dest = profile ? profile.space : 'CMYK';
    seen.pages.forEach((r, i) => {
      const n = i + 1;
      if (P.pdfx === '1a' && (r.RGB || r.icc.size || r.cie)) bad(`Page ${n} uses RGB or calibrated colour, which PDF/X-1a doesn't allow.`, { page: n });
      else if (r.RGB && dest !== 'RGB ') bad(`Page ${n} uses device RGB colour that is not defined (no DefaultRGB).`, { page: n });
      if (r.CMYK && dest !== 'CMYK') bad(`Page ${n} uses CMYK colour, which the output intent doesn't cover.`, { page: n });
    });
  });
  if (!P.alpha) rule('transparency', () => { seen.pages.forEach((r, i) => { if (r.alpha.size) bad(`Page ${i + 1} has see-through objects (${[...r.alpha][0]}), which ${P.label} doesn't allow.`, { page: i + 1 }); }); seen.annots.forEach((x) => { if (x.rec.alpha.size && pdfaFlag(L, x.a) & 4) bad(`A printing comment on page ${x.page} is see-through.`, { page: x.page }); }); });
  if (!P.bits16) rule('bit-depth', () => { seen.pages.forEach((r, i) => { if (r.bits16) bad(`Page ${i + 1} has a 16-bit picture, which ${P.label} (PDF 1.4) doesn't allow.`, { page: i + 1 }); if (r.jpx) bad(`Page ${i + 1} has a JPEG 2000 picture, which ${P.label} doesn't allow.`, { page: i + 1 }); }); });
  if (P.version <= 4) rule('icc-version', () => { seen.pages.forEach((r, i) => { if (r.iccV4) bad(`Page ${i + 1} uses an ICC version 4 profile, which ${P.label} doesn't allow.`, { page: i + 1 }); }); });
  rule('annotations', () => {
    out.getPages().forEach((p, i) => {
      const an = p.node.lookup(N('Annots')); if (!(an instanceof PDFArray)) return;
      const b = p.node.lookup(N('BleedBox')) || p.node.lookup(N('TrimBox')) || p.node.lookup(N('MediaBox')), v = b instanceof PDFArray ? b.asArray().map((x) => look(x).asNumber()) : [0, 0, 0, 0];
      for (const r of an.asArray()) {
        const a = look(r); if (!(a instanceof PDFDict)) continue;
        const sub = pdfaName(L, a.get(N('Subtype'))); if (sub === 'TrapNet' || sub === 'PrinterMark' || !(pdfaFlag(L, a) & 4)) continue;
        const rr = a.lookup(N('Rect')), q = rr instanceof PDFArray ? rr.asArray().map((x) => look(x).asNumber()) : null;
        if (!q || !(Math.max(q[0], q[2]) < Math.min(v[0], v[2]) || Math.min(q[0], q[2]) > Math.max(v[0], v[2]) || Math.max(q[1], q[3]) < Math.min(v[1], v[3]) || Math.min(q[1], q[3]) > Math.max(v[1], v[3]))) { bad(`A ${sub === 'Widget' ? 'form field' : 'comment'} on page ${i + 1} prints inside the page area.`, { page: i + 1 }); break; }
      }
    });
  });
  rule('no-javascript', () => { const sc = pdfaScripts(L, out); if (sc.any) bad(`The file has ${pdfaScriptsText(sc)}.`); });
  rule('no-attachments', () => { if (pdfaEmbeddedFiles(L, out).length) bad('The file has attachments.'); });
  rule('no-external', () => { for (const { obj } of pdfaReachable(L, out)) if (obj instanceof PDFStream && (obj.dict.get(N('F')) || obj.dict.get(N('FFilter')))) { bad('The file refers to data outside it.'); break; } });
  rule('graphics-state', () => { for (const { obj } of pdfaReachable(L, out)) { if (obj instanceof PDFStream) continue; if (pdfaName(L, obj.get(N('Type'))) === 'ExtGState' && (obj.get(N('TR')) || (obj.get(N('TR2')) && pdfaName(L, obj.get(N('TR2'))) !== 'Default'))) { bad('The file uses transfer functions.'); break; } } });
  if (P.pdfx === '4') rule('xmp', () => {
    const x = pdfaXmpOf(L, out);
    if (!x) { bad('PDF/X-4 needs XMP metadata.'); return; }
    if (!/pdfxid:GTS_PDFXVersion(>|=")\s*PDF\/X-4/.test(x)) bad('The XMP metadata doesn\'t say PDF/X-4 (pdfxid:GTS_PDFXVersion).');
    // ISO 15930-7, 6.7.2: the dates, a title, and the document's identity (DocumentID, VersionID, RenditionClass)
    const r = pdfaReadXmp(x), fv = (ns, n) => { const k = r.foreignName.findIndex((m, i) => m === n && r.foreignNs[i] === ns); return k < 0 ? '' : r.foreign[k].replace(/<[^>]*>/g, '').trim(); };
    const has = (k) => { const [p, n] = k.split(':'); return String(r.props[k] ?? fv(PDFA_NS[p], n)).trim() !== ''; };
    for (const k of ['xmp:CreateDate', 'xmp:ModifyDate', 'xmp:MetadataDate', 'dc:title', 'xmpMM:DocumentID', 'xmpMM:VersionID', 'xmpMM:RenditionClass']) if (r.ok ? !has(k) : !x.includes('<' + k + '>')) bad(`The XMP metadata has no ${k}.`);
  });
  problems.passed = passed; problems.checks = names.length;
  return problems;
}
// The same file, no longer claiming to be PDF/X (Save anyway).
async function pdfxDropClaim(bytes) {
  const L = await loadPdfLib(), out = await L.PDFDocument.load(bytes, { updateMetadata: false }), N = L.PDFName.of;
  const info = out.getInfoDict(); info.delete(N('GTS_PDFXVersion')); info.delete(N('GTS_PDFXConformance'));
  pdfaWriteXmp(L, out, { dropNs: ['http://ns.adobe.com/pdfx/1.3/', 'http://www.npes.org/pdfx/ns/id/'] });
  return out.save({ useObjectStreams: false });
}
async function pdfxSave(kind) {
  if (!has() || pdfaBusy) return;
  if (!kind) {
    const body = `<p class="pdfa-intro">A copy for a printing company, for coated paper (FOGRA39, CMYK): fonts are embedded and the page's trimmed size is set. Colours are not converted.</p>
      <div class="pdfa-levels" role="radiogroup" aria-label="Kind of PDF/X">${PDFX_KINDS.map(([v, t, d]) => `<label class="pdfa-level"><input type="radio" name="pdfxKind" value="${v}"${v === '4' ? ' checked' : ''}><span><b>${t}</b><small>${esc(d)}</small></span></label>`).join('')}</div>`;
    let pick = '4';
    const a = await dialog('Save as PDF/X', body, [{ label: 'Cancel' }, { label: 'Save', value: 'ok', primary: true }], (dlg) => { pdfaDlg(dlg); $$('[name="pdfxKind"]', dlg).forEach((i) => i.addEventListener('change', () => { pick = i.value; })); });
    if (a !== 'ok') return;
    kind = pick;
  }
  return pdfaExport({ pdfx: kind });
}

cmd('savePdfx', { label: 'Save as PDF/X…', rlabel: 'Save as PDF/X', icon: 'printer-check', enabled: has, run: () => pdfxSave() });
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('savePdfa') : -1; if (i >= 0) fm[1].splice(i + 1, 0, 'savePdfx'); else menuAdd('File', ['savePdfx']); }
ribbonAdd('export', 'Archive', ['savePdfx']);
Object.assign(TEST_HOOKS, { pdfxCheck, pdfxSave });
