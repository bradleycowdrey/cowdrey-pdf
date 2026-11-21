/* ---------------- PDF/A and PDF/X (src/features/84-pdfa.js) ----------------
   File > Save as PDF/A… (and Export > Archive): an archival copy in PDF/A-1b, 2b (the default), 2u, 3b or 3u, with
   screen (sRGB) or print (CMYK, FOGRA39) colours. Save as PDF/X… (85-pdfx.js) uses the same conversion for PDF/X-1a,
   X-3 and X-4. Both are made on this device, then checked by a built-in rule subset (modelled on the veraPDF profiles
   for PDF/A, on ISO 15930 for PDF/X), which is not a certified validator.
   - pdfaWriteXmp(L, out, extra): writes the XMP packet from the Info dictionary (title, author, subject, keywords,
     creator tool, producer, dates, document and instance ids, language). 12-docinfo.js calls it on every save that
     keeps or edits metadata; extra = { pdfa: { part, conformance }, pdfua: { part }, extensions: [schema…],
     props: [{ ns, prefix, name, value }], keepClaims, strict } lets PDF/A and PDF/UA add their own schemas.
     pdfaPatchXmp(L, out, opts) changes only what differs in the file's own packet (12-docinfo.js uses it when the
     file had one), so properties the app doesn't manage keep their exact form. A PDF/A packet leaves out pdf:Trapped
     (PDF/A predefines no such property; Info's Trapped stays). extra.version (PDF/X-4) adds xmpMM:VersionID and
     xmpMM:RenditionClass, which ISO 15930-7 asks for with the document id, the dates and the title.
   - pdfaConvert(bytes, { part, conformance, intent: 'srgb' | 'cmyk', pdfx: '1a' | '3' | '4', scripts: 'remove' |
     'refuse' }) -> { bytes, fixes: [text] } or { blocked: 'attachments' | 'scripts' | 'profile', problems? }: the
     conversion (used by the batch tools too). It refuses (blocked 'profile', a plain reason for each problem) what it
     can't make conform without changing how the pages look: CMYK colours with an sRGB output intent and RGB with a
     CMYK one (PDF/A), RGB in PDF/X-1a, transparency in PDF/A-1b, X-1a and X-3, 16-bit and JPEG 2000 pictures in those
     PDF 1.4 kinds, attachments and layers where they are not allowed. scripts: 'refuse' stops at JavaScript and
     forbidden actions (the dialogs ask before removing them); 'remove', the default, removes them.
     PDF/A-1 also gets the CIDSet and CharSet lists its font subsets need. PDF/A-2u and 3u: a CID TrueType font
     whose ToUnicode map misses a glyph the pages show (a ligature, say) gets it from the font program's own cmap
     and GSUB tables (f + t -> "ft"); a glyph that can't be named is reported by the check, not saved silently. Fonts that were not embedded (the standard 14 that page design, Add text, stamps and form
     fields use) are replaced by metric-compatible embedded fonts: Arimo for Helvetica, Tinos for Times, Cousine for
     Courier (SIL Open Font License, from the pinned @expo-google-fonts packages; the desktop and mobile bundle
     vendors them with every other jsDelivr file). They are cut down here to the Latin glyphs a simple font can
     address, keeping glyph ids, so the font's own cmap and widths stay right (fontkit's subsetter drops the cmap,
     which a simple TrueType font needs, so it isn't used). Symbol, ZapfDingbats and fonts with no Latin substitute
     are reported, not replaced. PDF/A-1 allows a TrueType font no /Differences, so a stand-in whose codes mean
     other characters than WinAnsi (a form's PDFDocEncoding) is made symbolic there: no Encoding, and its own
     program with one (3,0) cmap from those codes to the glyphs.
   - pdfaCheck(bytes, { part, conformance }?) -> [{ rule, severity, page?, fix?, text }] with .passed (rule names):
     a built-in check, not a certified validator.
   - The sRGB output intent profile (ICC v2, matrix/TRC with a 1024-point curve) is made in code, so no profile file
     needs a licence. The CMYK one is colord's FOGRA39L Coated (CC0, src/icc/README.md), carried in 84-pdfa-icc.js.
   Annotations keep their dictionaries; where a kind forbids transparency or RGB, the appearances the app can draw
   (notes, boxes, ovals, lines, drawings, highlights) are drawn again opaque or in CMYK (a highlight becomes a bar
   under its text). PDF/X: comments inside the printed area are kept and set not to print. */

const PDFA_NS = {
  x: 'adobe:ns:meta/', rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', dc: 'http://purl.org/dc/elements/1.1/',
  xmp: 'http://ns.adobe.com/xap/1.0/', pdf: 'http://ns.adobe.com/pdf/1.3/', xmpMM: 'http://ns.adobe.com/xap/1.0/mm/',
  pdfaid: 'http://www.aiim.org/pdfa/ns/id/', pdfuaid: 'http://www.aiim.org/pdfua/ns/id/',
  pdfaExtension: 'http://www.aiim.org/pdfa/ns/extension/', pdfaSchema: 'http://www.aiim.org/pdfa/ns/schema#', pdfaProperty: 'http://www.aiim.org/pdfa/ns/property#',
};
// Schemas PDF/A knows without an extension schema (ISO 19005-2, 6.6.2.3.1): kept from an older packet.
const PDFA_PREDEFINED = new Set([PDFA_NS.dc, PDFA_NS.xmp, PDFA_NS.pdf, PDFA_NS.xmpMM, 'http://ns.adobe.com/xap/1.0/rights/', 'http://ns.adobe.com/xap/1.0/bj/',
  'http://ns.adobe.com/xap/1.0/t/pg/', 'http://ns.adobe.com/xmp/1.0/DynamicMedia/', 'http://ns.adobe.com/photoshop/1.0/', 'http://ns.adobe.com/camera-raw-settings/1.0/',
  'http://ns.adobe.com/tiff/1.0/', 'http://ns.adobe.com/exif/1.0/', 'http://ns.adobe.com/exif/1.0/aux/', 'http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/']);
const PDFA_MANAGED = new Set(['dc:title', 'dc:creator', 'dc:description', 'dc:language', 'dc:format', 'xmp:CreatorTool', 'xmp:CreateDate', 'xmp:ModifyDate', 'xmp:MetadataDate',
  'pdf:Producer', 'pdf:Keywords', 'pdf:Trapped', 'xmpMM:DocumentID', 'xmpMM:InstanceID', 'pdfaid:part', 'pdfaid:conformance', 'pdfaid:amd', 'pdfaid:rev', 'pdfuaid:part']);
const PDFUA_EXTENSION = { schema: 'PDF/UA Universal Accessibility Schema', ns: PDFA_NS.pdfuaid, prefix: 'pdfuaid', props: [{ name: 'part', type: 'Integer', category: 'internal', description: 'Indicates, which part of ISO 14289 standard is followed' }] };
const PDFA_INFO_STD = new Set(['Title', 'Author', 'Subject', 'Keywords', 'Creator', 'Producer', 'CreationDate', 'ModDate', 'Trapped']);

const pdfaXml = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pdfaLatin1 = (b) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; };
const pdfaBytes = (s) => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
const pdfaUuid = () => (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
// XMP dates are written in UTC, like the Info dates pdf-lib writes, so the two match to the second.
const pdfaIso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
// A PDF date string (D:YYYYMMDDHHmmSSOHH'mm') as a Date, or null.
function pdfaParseDate(s) {
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?\s*(Z|[+-])?(\d{2})?'?(\d{2})?'?/.exec(String(s || '').trim());
  if (!m) return null;
  const n = (v, d) => (v == null ? d : +v);
  let t = Date.UTC(+m[1], n(m[2], 1) - 1, n(m[3], 1), n(m[4], 0), n(m[5], 0), n(m[6], 0));
  if (m[7] === '+' || m[7] === '-') t -= (m[7] === '+' ? 1 : -1) * (n(m[8], 0) * 60 + n(m[9], 0)) * 60000;
  const d = new Date(t); return Number.isNaN(+d) ? null : d;
}
// An XMP date (YYYY-MM-DDThh:mm:ss±hh:mm) as a Date, or null.
function pdfaParseXmpDate(s) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?)?)?$/.exec(String(s || '').trim());
  if (!m) return null;
  const n = (v, d) => (v == null ? d : +v);
  let t = Date.UTC(+m[1], n(m[2], 1) - 1, n(m[3], 1), n(m[4], 0), n(m[5], 0), n(m[6], 0));
  if (m[7] && m[7] !== 'Z') { const sg = m[7][0] === '+' ? 1 : -1; t -= sg * (+m[7].slice(1, 3) * 60 + +m[7].slice(4, 6)) * 60000; }
  return new Date(t);
}
// A text value of a dictionary (string or name), or undefined.
function pdfaText(L, dict, key) {
  if (!dict) return undefined;
  const v = dict.lookup(L.PDFName.of(key));
  if (v instanceof L.PDFString || v instanceof L.PDFHexString) { try { return v.decodeText(); } catch { return undefined; } }
  if (v instanceof L.PDFName) return v.decodeText();
  return undefined;
}
const pdfaName = (L, o) => (o instanceof L.PDFName ? o.decodeText() : null);
// The bytes of a stream, decoded when pdf-lib can; null when it can't (an image filter).
function pdfaStreamBytes(L, s) {
  try {
    if (s instanceof L.PDFRawStream) return L.decodePDFRawStream(s).decode();
    if (s.getUnencodedContents) return s.getUnencodedContents();
    return s.getContents();
  } catch { return null; }
}
// The catalog's XMP packet, as text ('' when there is none).
function pdfaXmpOf(L, out) {
  const s = out.catalog.lookup(L.PDFName.of('Metadata'));
  if (!(s instanceof L.PDFStream)) return '';
  const b = pdfaStreamBytes(L, s); if (!b) return '';
  try { return new TextDecoder('utf-8').decode(b); } catch { return pdfaLatin1(b); }
}
// Reads a packet: { ok, props: { 'dc:title': value… } (text of simple and first-item values), foreign: [xml], claims }
function pdfaReadXmp(xml) {
  const r = { ok: false, props: {}, foreign: [], foreignNs: [], foreignName: [], declared: new Set(), extensionXml: '' };
  if (!xml || typeof DOMParser === 'undefined') return r;
  const start = xml.indexOf('<x:xmpmeta') >= 0 ? xml.indexOf('<x:xmpmeta') : xml.indexOf('<rdf:RDF');
  const endTag = xml.indexOf('</x:xmpmeta>') >= 0 ? '</x:xmpmeta>' : '</rdf:RDF>';
  const end = xml.indexOf(endTag);
  if (start < 0 || end < 0) return r;
  const docX = new DOMParser().parseFromString(xml.slice(start, end + endTag.length), 'application/xml');
  if (docX.getElementsByTagName('parsererror').length) return r;
  r.ok = true;
  const prefixOf = (ns) => Object.keys(PDFA_NS).find((k) => PDFA_NS[k] === ns);
  const valueOf = (el) => { const li = el.getElementsByTagNameNS(PDFA_NS.rdf, 'li'); const pick = li.length ? ([...li].find((x) => x.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') === 'x-default') || li[0]) : el; return pick.textContent; };
  const listOf = (el) => { const li = el.getElementsByTagNameNS(PDFA_NS.rdf, 'li'); return li.length ? [...li].map((x) => x.textContent) : [el.textContent]; };
  for (const d of docX.getElementsByTagNameNS(PDFA_NS.rdf, 'Description')) {
    if (d.parentNode && d.parentNode.namespaceURI !== PDFA_NS.rdf) continue; // nested (rdf:parseType) values
    for (const a of [...d.attributes]) {
      if (!a.namespaceURI || a.namespaceURI === PDFA_NS.rdf || a.namespaceURI === 'http://www.w3.org/2000/xmlns/' || a.namespaceURI === 'http://www.w3.org/XML/1998/namespace') continue;
      const p = prefixOf(a.namespaceURI), key = p ? `${p}:${a.localName}` : null;
      if (key && PDFA_MANAGED.has(key)) { r.props[key] = a.value; continue; }
      r.foreign.push(`<${a.prefix || 'ns'}:${a.localName} xmlns:${a.prefix || 'ns'}="${pdfaXml(a.namespaceURI)}">${pdfaXml(a.value)}</${a.prefix || 'ns'}:${a.localName}>`); r.foreignNs.push(a.namespaceURI); r.foreignName.push(a.localName);
    }
    for (const el of [...d.children]) {
      const p = prefixOf(el.namespaceURI), key = p ? `${p}:${el.localName}` : null;
      if (key && PDFA_MANAGED.has(key)) { r.props[key] = valueOf(el); if (key === 'dc:creator') r.props['dc:creator#list'] = listOf(el); continue; }
      if (el.namespaceURI === PDFA_NS.pdfaExtension) {
        r.extensionXml = new XMLSerializer().serializeToString(el);
        for (const u of el.getElementsByTagNameNS(PDFA_NS.pdfaSchema, 'namespaceURI')) r.declared.add(u.textContent.trim());
        continue;
      }
      r.foreign.push(new XMLSerializer().serializeToString(el)); r.foreignNs.push(el.namespaceURI); r.foreignName.push(el.localName);
    }
  }
  return r;
}
function pdfaExtensionXml(list) {
  if (!list.length) return '';
  const props = (s) => s.props.map((p) => `<rdf:li rdf:parseType="Resource"><pdfaProperty:name>${pdfaXml(p.name)}</pdfaProperty:name><pdfaProperty:valueType>${pdfaXml(p.type)}</pdfaProperty:valueType><pdfaProperty:category>${pdfaXml(p.category || 'external')}</pdfaProperty:category><pdfaProperty:description>${pdfaXml(p.description || p.name)}</pdfaProperty:description></rdf:li>`).join('');
  return `<rdf:Description rdf:about="" xmlns:pdfaExtension="${PDFA_NS.pdfaExtension}" xmlns:pdfaSchema="${PDFA_NS.pdfaSchema}" xmlns:pdfaProperty="${PDFA_NS.pdfaProperty}">
<pdfaExtension:schemas><rdf:Bag>${list.map((s) => `<rdf:li rdf:parseType="Resource"><pdfaSchema:schema>${pdfaXml(s.schema)}</pdfaSchema:schema><pdfaSchema:namespaceURI>${pdfaXml(s.ns)}</pdfaSchema:namespaceURI><pdfaSchema:prefix>${pdfaXml(s.prefix)}</pdfaSchema:prefix><pdfaSchema:property><rdf:Seq>${props(s)}</rdf:Seq></pdfaSchema:property></rdf:li>`).join('')}</rdf:Bag></pdfaExtension:schemas>
</rdf:Description>`;
}
// Writes the catalog's XMP from the Info dictionary (and the catalog's /Lang). Returns the packet's text.
function pdfaWriteXmp(L, out, extra = {}) {
  const { PDFName } = L, N = PDFName.of, info = out.getInfoDict();
  const t = (k) => pdfaText(L, info, k);
  const old = pdfaReadXmp(pdfaXmpOf(L, out));
  const date = (k) => { const v = t(k); const d = v ? pdfaParseDate(v) : null; return d ? pdfaIso(d) : null; };
  const title = t('Title'), author = t('Author'), subject = t('Subject'), keywords = t('Keywords'), creator = t('Creator'), producer = t('Producer');
  const created = date('CreationDate'), modified = date('ModDate'), trapped = t('Trapped'), lang = pdfaText(L, out.catalog, 'Lang');
  const docId = /^(uuid:|xmp\.did:)/.test(old.props['xmpMM:DocumentID'] || '') ? old.props['xmpMM:DocumentID'] : 'uuid:' + pdfaUuid();
  // Several authors in the packet stay several while Info's Author is still their joined list (not in a PDF/A file,
  // where dc:creator must be the Author text as one entry).
  const oldAuthors = old.props['dc:creator#list'] || [], claimsA = !!(extra.strict || extra.pdfa || (extra.keepClaims && old.props['pdfaid:part']));
  // pdf:Trapped is not one of the properties PDF/A predefines (it needs an extension schema, and Info's Trapped need
  // not be repeated in the XMP), so a PDF/A packet leaves it out; other packets (PDF/X, plain saves) keep it.
  const strictA = !!(extra.strict || extra.pdfa);
  const authors = author == null ? [] : !claimsA && oldAuthors.length > 1 && [';', '; ', ',', ', '].some((j) => oldAuthors.join(j).trim() === author.trim()) ? oldAuthors : [author];
  const el = (name, v) => (v == null || v === '' ? '' : `<${name}>${pdfaXml(v)}</${name}>`);
  const alt = (name, v) => (v == null ? '' : `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${pdfaXml(v)}</rdf:li></rdf:Alt></${name}>`);
  const blocks = [];
  blocks.push(`<rdf:Description rdf:about="" xmlns:dc="${PDFA_NS.dc}">${el('dc:format', 'application/pdf')}${alt('dc:title', title)}${author != null ? `<dc:creator><rdf:Seq>${authors.map((a) => `<rdf:li>${pdfaXml(a)}</rdf:li>`).join('')}</rdf:Seq></dc:creator>` : ''}${alt('dc:description', subject)}${lang ? `<dc:language><rdf:Bag><rdf:li>${pdfaXml(lang)}</rdf:li></rdf:Bag></dc:language>` : ''}</rdf:Description>`);
  blocks.push(`<rdf:Description rdf:about="" xmlns:xmp="${PDFA_NS.xmp}">${el('xmp:CreatorTool', creator)}${el('xmp:CreateDate', created)}${el('xmp:ModifyDate', modified)}${el('xmp:MetadataDate', modified || pdfaIso(new Date()))}</rdf:Description>`);
  blocks.push(`<rdf:Description rdf:about="" xmlns:pdf="${PDFA_NS.pdf}">${el('pdf:Producer', producer)}${keywords != null ? `<pdf:Keywords>${pdfaXml(keywords)}</pdf:Keywords>` : ''}${!strictA && /^(True|False|Unknown)$/.test(trapped || '') ? el('pdf:Trapped', trapped) : ''}</rdf:Description>`);
  // extra.version (PDF/X-4, ISO 15930-7): xmpMM:VersionID and xmpMM:RenditionClass, the version counting up from the
  // packet's own when it had a number.
  const oldVer = old.foreignName.indexOf('VersionID') >= 0 && old.foreignNs[old.foreignName.indexOf('VersionID')] === PDFA_NS.xmpMM ? (/>\s*(\d+)\s*</.exec(old.foreign[old.foreignName.indexOf('VersionID')]) || [])[1] : null;
  const mm = extra.version ? { VersionID: oldVer ? String(+oldVer + 1) : '1', RenditionClass: 'default' } : null;
  blocks.push(`<rdf:Description rdf:about="" xmlns:xmpMM="${PDFA_NS.xmpMM}">${el('xmpMM:DocumentID', docId)}${el('xmpMM:InstanceID', 'uuid:' + pdfaUuid())}${mm ? el('xmpMM:VersionID', mm.VersionID) + el('xmpMM:RenditionClass', mm.RenditionClass) : ''}</rdf:Description>`);
  // Conformance claims: the ones asked for, or (keepClaims) the ones the file had.
  const pdfa = extra.pdfa || (extra.keepClaims && old.props['pdfaid:part'] ? { part: old.props['pdfaid:part'], conformance: old.props['pdfaid:conformance'] } : null);
  const pdfua = extra.pdfua || (extra.keepClaims && old.props['pdfuaid:part'] ? { part: old.props['pdfuaid:part'] } : null);
  if (pdfa) blocks.push(`<rdf:Description rdf:about="" xmlns:pdfaid="${PDFA_NS.pdfaid}">${el('pdfaid:part', String(pdfa.part))}${pdfa.conformance ? el('pdfaid:conformance', String(pdfa.conformance).toUpperCase()) : ''}</rdf:Description>`);
  if (pdfua) blocks.push(`<rdf:Description rdf:about="" xmlns:pdfuaid="${PDFA_NS.pdfuaid}">${el('pdfuaid:part', String(pdfua.part))}</rdf:Description>`);
  for (const p of extra.props || []) blocks.push(`<rdf:Description rdf:about="" xmlns:${p.prefix}="${pdfaXml(p.ns)}">${el(`${p.prefix}:${p.name}`, p.value)}</rdf:Description>`);
  // Properties the app doesn't manage: kept, except (strict, for PDF/A) those PDF/A doesn't know.
  const strict = !!(extra.strict || extra.pdfa);
  const drop = new Set(extra.dropNs || []);
  const kept = old.foreign.filter((x, k) => (!strict || PDFA_PREDEFINED.has(old.foreignNs[k])) && !drop.has(old.foreignNs[k]) && !(mm && old.foreignNs[k] === PDFA_NS.xmpMM && old.foreignName[k] in mm));
  if (kept.length) blocks.push(`<rdf:Description rdf:about="">${kept.join('')}</rdf:Description>`);
  const ext = [...(extra.extensions || [])];
  if (pdfa && pdfua && !ext.some((s) => s.ns === PDFUA_EXTENSION.ns)) ext.push(PDFUA_EXTENSION);
  for (const p of extra.props || []) if (pdfa && !PDFA_PREDEFINED.has(p.ns) && !ext.some((s) => s.ns === p.ns)) ext.push({ schema: p.prefix, ns: p.ns, prefix: p.prefix, props: [{ name: p.name, type: 'Text', category: 'external', description: p.name }] });
  if (ext.length) blocks.push(pdfaExtensionXml(ext));
  else if (!strict && old.extensionXml) blocks.push(`<rdf:Description rdf:about="">${old.extensionXml}</rdf:Description>`);
  const pad = (' '.repeat(99) + '\n').repeat(20);
  const xml = `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="${PDFA_NS.rdf}">
${blocks.join('\n')}
</rdf:RDF>
</x:xmpmeta>
${pad}<?xpacket end="w"?>`;
  const stream = out.context.stream(new TextEncoder().encode(xml), { Type: 'Metadata', Subtype: 'XML' });
  const ref = out.catalog.get(N('Metadata'));
  if (ref instanceof L.PDFRef) out.context.assign(ref, stream); else out.catalog.set(N('Metadata'), out.context.register(stream));
  return xml;
}

// Changes the catalog's XMP packet in place, so it says what the Info dictionary (and /Lang) says: only properties
// whose value differs are touched (a title's other languages, several authors, dc:subject, rights and every property
// the app doesn't manage keep their exact form). The modification and metadata dates and the instance id follow the
// save. extra = { keepClaims, pdfua: { part } | null }: without keepClaims the PDF/A claim is taken out (and PDF/UA's,
// unless pdfua is given). Returns the packet's text, or null when the packet can't be read (then nothing is changed).
function pdfaPatchXmp(L, out, extra = {}) {
  const xml = pdfaXmpOf(L, out);
  if (!xml || typeof DOMParser === 'undefined') return null;
  const start = xml.indexOf('<x:xmpmeta') >= 0 ? xml.indexOf('<x:xmpmeta') : xml.indexOf('<rdf:RDF');
  const endTag = xml.indexOf('</x:xmpmeta>') >= 0 ? '</x:xmpmeta>' : '</rdf:RDF>', end = xml.indexOf(endTag);
  if (start < 0 || end < 0) return null;
  const X = new DOMParser().parseFromString(xml.slice(start, end + endTag.length), 'application/xml');
  if (X.getElementsByTagName('parsererror').length) return null;
  const R = PDFA_NS.rdf, rdf = X.getElementsByTagNameNS(R, 'RDF')[0]; if (!rdf) return null;
  const info = out.getInfoDict(), t = (k) => pdfaText(L, info, k);
  const descs = () => [...rdf.childNodes].filter((n) => n.nodeType === 1 && n.namespaceURI === R && n.localName === 'Description');
  const prefixOf = { [PDFA_NS.dc]: 'dc', [PDFA_NS.xmp]: 'xmp', [PDFA_NS.pdf]: 'pdf', [PDFA_NS.xmpMM]: 'xmpMM' };
  // the element or attribute holding a property
  const find = (ns, name) => {
    for (const d of descs()) {
      if (d.hasAttributeNS(ns, name)) return { d, attr: d.getAttributeNodeNS(ns, name) };
      const el = [...d.children].find((c) => c.namespaceURI === ns && c.localName === name); if (el) return { d, el };
    }
    return null;
  };
  const host = (ns) => {
    let d = descs().find((x) => [...x.children].some((c) => c.namespaceURI === ns) || [...x.attributes].some((a) => a.namespaceURI === ns));
    if (!d) { d = X.createElementNS(R, 'rdf:Description'); d.setAttributeNS(R, 'rdf:about', descs()[0] ? descs()[0].getAttributeNS(R, 'about') || '' : ''); rdf.appendChild(X.createTextNode('\n')); rdf.appendChild(d); }
    if (d.lookupNamespaceURI(prefixOf[ns]) !== ns) d.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns:' + prefixOf[ns], ns);
    return d;
  };
  const make = (ns, name) => X.createElementNS(ns, `${prefixOf[ns]}:${name}`);
  let changed = false;
  const remove = (ns, name) => { const f = find(ns, name); if (!f) return; if (f.attr) f.d.removeAttributeNode(f.attr); else f.el.remove(); changed = true; };
  const simple = (ns, name, v, same = (a, b) => a === b) => {
    const f = find(ns, name);
    if (v == null || v === '') { if (f && v == null) return; if (f) remove(ns, name); return; }
    const cur = f ? (f.attr ? f.attr.value : f.el.textContent) : null;
    if (cur != null && same(cur, v)) return;
    if (f && f.attr) f.attr.value = v; else if (f) f.el.textContent = v; else { const el = make(ns, name); el.textContent = v; host(ns).appendChild(el); }
    changed = true;
  };
  const alt = (ns, name, v) => {
    const f = find(ns, name);
    if (v == null) return;
    if (f && f.attr) { if (f.attr.value !== v) { f.attr.value = v; changed = true; } return; }
    const lis = f ? [...f.el.getElementsByTagNameNS(R, 'li')] : [];
    const li = lis.find((x) => x.getAttributeNS('http://www.w3.org/XML/1998/namespace', 'lang') === 'x-default') || lis[0];
    if (li) { if (li.textContent !== v) { li.textContent = v; changed = true; } return; }
    if (f) f.el.remove();
    const el = make(ns, name), a = X.createElementNS(R, 'rdf:Alt'), l = X.createElementNS(R, 'rdf:li');
    l.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:lang', 'x-default'); l.textContent = v; a.appendChild(l); el.appendChild(a); host(ns).appendChild(el); changed = true;
  };
  const list = (ns, name, kind, values, keep) => {
    const f = find(ns, name);
    if (f && f.el) { const cur = [...f.el.getElementsByTagNameNS(R, 'li')].map((x) => x.textContent); if (keep(cur)) return; f.el.remove(); }
    else if (f && f.attr) { if (keep([f.attr.value])) return; f.d.removeAttributeNode(f.attr); }
    if (!values.length) { if (f) changed = true; return; }
    const el = make(ns, name), s = X.createElementNS(R, 'rdf:' + kind);
    for (const v of values) { const l = X.createElementNS(R, 'rdf:li'); l.textContent = v; s.appendChild(l); }
    el.appendChild(s); host(ns).appendChild(el); changed = true;
  };
  const sameTime = (a, b) => { const x = pdfaParseXmpDate(a), y = pdfaParseXmpDate(b); return !!x && !!y && Math.abs(x - y) < 1000; };
  const date = (k) => { const v = t(k), d = v ? pdfaParseDate(v) : null; return d ? pdfaIso(d) : null; };
  alt(PDFA_NS.dc, 'title', t('Title'));
  const author = t('Author');
  if (author != null) list(PDFA_NS.dc, 'creator', 'Seq', [author], (cur) => cur.length === 1 ? cur[0] === author : cur.length > 1 && [';', '; ', ',', ', '].some((j) => cur.join(j).trim() === author.trim()));
  alt(PDFA_NS.dc, 'description', t('Subject'));
  const kw = t('Keywords');
  if (kw != null) { const f = find(PDFA_NS.pdf, 'Keywords'), before = f ? (f.attr ? f.attr.value : f.el.textContent) : null; simple(PDFA_NS.pdf, 'Keywords', kw); if (before !== kw && find(PDFA_NS.dc, 'subject')) list(PDFA_NS.dc, 'subject', 'Bag', String(kw).split(/\s*[;,]\s*/).filter(Boolean), (cur) => cur.join(', ') === kw); }
  simple(PDFA_NS.xmp, 'CreatorTool', t('Creator'));
  simple(PDFA_NS.pdf, 'Producer', t('Producer'));
  simple(PDFA_NS.xmp, 'CreateDate', date('CreationDate'), sameTime);
  const mod = date('ModDate'), fm = find(PDFA_NS.xmp, 'ModifyDate'), cm = fm ? (fm.attr ? fm.attr.value : fm.el.textContent) : null, modChanged = !!mod && !(cm && sameTime(cm, mod));
  simple(PDFA_NS.xmp, 'ModifyDate', mod, sameTime);
  if (modChanged || changed) simple(PDFA_NS.xmp, 'MetadataDate', mod || pdfaIso(new Date()), sameTime);
  const lang = pdfaText(L, out.catalog, 'Lang');
  if (lang) list(PDFA_NS.dc, 'language', 'Bag', [lang], (cur) => cur.length === 1 && cur[0] === lang);
  if (!find(PDFA_NS.xmpMM, 'DocumentID')) simple(PDFA_NS.xmpMM, 'DocumentID', 'uuid:' + pdfaUuid());
  if (changed) simple(PDFA_NS.xmpMM, 'InstanceID', 'uuid:' + pdfaUuid());
  if (!extra.keepClaims) {
    for (const n of ['part', 'conformance', 'amd', 'rev']) remove(PDFA_NS.pdfaid, n);
    if (!extra.pdfua) remove(PDFA_NS.pdfuaid, 'part');
  }
  // an emptied rdf:Description goes
  for (const d of descs()) if (!d.children.length && ![...d.attributes].some((a) => a.namespaceURI !== R && a.namespaceURI !== 'http://www.w3.org/2000/xmlns/')) d.remove();
  if (!changed) return xml;
  const head = xml.slice(0, start), tail = xml.slice(end + endTag.length);
  const text = head + new XMLSerializer().serializeToString(X.documentElement) + tail;
  const stream = out.context.stream(new TextEncoder().encode(text), { Type: 'Metadata', Subtype: 'XML' });
  const ref = out.catalog.get(L.PDFName.of('Metadata'));
  if (ref instanceof L.PDFRef) out.context.assign(ref, stream); else out.catalog.set(L.PDFName.of('Metadata'), out.context.register(stream));
  return text;
}

/* ----- the sRGB output intent profile: ICC v2, display class, matrix/TRC (D50-adapted sRGB primaries) ----- */
let pdfaIccCache = null;
function pdfaSrgbIcc() {
  if (pdfaIccCache) return pdfaIccCache;
  const s15 = (v) => Math.round(v * 65536) | 0, ascii = (t) => [...t].map((c) => c.charCodeAt(0));
  const block = (n, fill) => { const b = new Uint8Array(n); const v = new DataView(b.buffer); fill(v, b); return b; };
  const xyz = (x, y, z) => block(20, (v, b) => { b.set(ascii('XYZ ')); v.setInt32(8, s15(x)); v.setInt32(12, s15(y)); v.setInt32(16, s15(z)); });
  // textDescriptionType: ASCII part, then empty Unicode and ScriptCode parts
  const desc = (t) => block(12 + t.length + 1 + 4 + 4 + 2 + 1 + 67, (v, b) => { b.set(ascii('desc')); v.setUint32(8, t.length + 1); b.set(ascii(t), 12); });
  const text = (t) => block(8 + t.length + 1, (v, b) => { b.set(ascii('text')); b.set(ascii(t), 8); });
  const curv = block(12 + 1024 * 2, (v, b) => { b.set(ascii('curv')); v.setUint32(8, 1024); for (let i = 0; i < 1024; i++) { const x = i / 1023; v.setUint16(12 + i * 2, Math.round((x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4) * 65535)); } });
  const tags = [['desc', desc('sRGB IEC61966-2.1')], ['cprt', text('No copyright, use freely')], ['wtpt', xyz(0.9642, 1, 0.8249)],
    ['rXYZ', xyz(0.4360747, 0.2225045, 0.0139322)], ['gXYZ', xyz(0.3850649, 0.7168786, 0.0971045)], ['bXYZ', xyz(0.1430804, 0.0606169, 0.7141733)],
    ['rTRC', curv], ['gTRC', 'rTRC'], ['bTRC', 'rTRC']];
  const at = {}; let off = 128 + 4 + tags.length * 12;
  for (const [t, d] of tags) if (typeof d !== 'string') { at[t] = [off, d.length]; off += Math.ceil(d.length / 4) * 4; }
  const icc = new Uint8Array(off), v = new DataView(icc.buffer);
  v.setUint32(0, off); v.setUint32(8, 0x02100000); icc.set(ascii('mntr'), 12); icc.set(ascii('RGB '), 16); icc.set(ascii('XYZ '), 20);
  v.setUint16(24, 2026); v.setUint16(26, 1); v.setUint16(28, 1); icc.set(ascii('acsp'), 36);
  v.setInt32(68, s15(0.9642)); v.setInt32(72, s15(1)); v.setInt32(76, s15(0.8249));
  v.setUint32(128, tags.length);
  tags.forEach(([t, d], i) => { const [o, l] = at[typeof d === 'string' ? d : t]; icc.set(ascii(t), 132 + i * 12); v.setUint32(136 + i * 12, o); v.setUint32(140 + i * 12, l); if (typeof d !== 'string') icc.set(d, o); });
  return (pdfaIccCache = icc);
}
/* ----- the CMYK printing condition: FOGRA39 (84-pdfa-icc.js), kept deflated: it goes into the PDF as it is ----- */
let pdfaCmykCache = null;
const pdfaCmykZ = () => { if (!pdfaCmykCache) { const s = atob(PDFA_FOGRA39.z); pdfaCmykCache = pdfaBytes(s); } return pdfaCmykCache; };
const PDFA_CMYK_COND = { id: 'FOGRA39', info: 'Coated FOGRA39 (ISO 12647-2:2004)', registry: 'http://www.color.org' };
// An ICC profile stream in `out`: { srgb, cmyk } -> ref (one of each per file).
function pdfaIccRef(L, out, kind) {
  out.__pdfaIcc ||= {};
  if (!out.__pdfaIcc[kind]) {
    const ctx = out.context;
    out.__pdfaIcc[kind] = kind === 'cmyk'
      ? ctx.register(L.PDFRawStream.of(ctx.obj({ N: 4, Filter: 'FlateDecode', Length: pdfaCmykZ().length }), pdfaCmykZ()))
      : ctx.register(ctx.flateStream(pdfaSrgbIcc(), { N: 3 }));
  }
  return out.__pdfaIcc[kind];
}

/* ----- the kinds: what each allows ----- */
// pdfaProfile({ part, conformance, intent, pdfx }) -> { kind: 'A' | 'X', label, version (PDF), objStreams, alpha, bits16,
// jpx, intent, rgb: 'ok' | 'default' | 'no', files, layers }
function pdfaProfile(o = {}) {
  if (o.pdfx) {
    const v = String(o.pdfx).toLowerCase();
    const x = { '1a': { label: 'PDF/X-1a', gts: 'PDF/X-1a:2003', version: 4, rgb: 'no', alpha: false }, '3': { label: 'PDF/X-3', gts: 'PDF/X-3:2003', version: 4, rgb: 'default', alpha: false }, '4': { label: 'PDF/X-4', gts: 'PDF/X-4', version: 6, rgb: 'default', alpha: true } }[v];
    if (!x) throw new Error('Unknown PDF/X kind ' + o.pdfx);
    return { kind: 'X', pdfx: v, ...x, objStreams: x.version >= 5, bits16: x.version >= 5, jpx: x.version >= 5, intent: 'cmyk', files: false, layers: v === '4' };
  }
  const part = +(o.part || 2), conformance = String(o.conformance || 'B').toUpperCase(), intent = o.intent === 'cmyk' ? 'cmyk' : 'srgb';
  const old = part === 1;
  return { kind: 'A', part, conformance, label: `PDF/A-${part}${conformance.toLowerCase()}`, version: old ? 4 : 7, objStreams: !old, alpha: !old, bits16: !old, jpx: !old,
    intent, rgb: intent === 'cmyk' ? 'no' : 'ok', cmyk: intent === 'cmyk', files: part === 3 ? 'any' : part === 2 ? 'pdfa' : false, layers: !old };
}

/* ----- TrueType: read a font, and cut it down to some glyphs keeping their ids ----- */
function pdfaTtf(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), tag = (o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  const n = v.getUint16(4), tables = {};
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; tables[tag(o)] = { off: v.getUint32(o + 8), len: v.getUint32(o + 12) }; }
  for (const t of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap']) if (!tables[t]) throw new Error('Not a TrueType font (no ' + t + ')');
  const head = tables.head.off, hhea = tables.hhea.off;
  const f = { bytes, tables, view: v, upem: v.getUint16(head + 18), bbox: [v.getInt16(head + 36), v.getInt16(head + 38), v.getInt16(head + 40), v.getInt16(head + 42)],
    locFmt: v.getInt16(head + 50), macStyle: v.getUint16(head + 44), ascent: v.getInt16(hhea + 4), descent: v.getInt16(hhea + 6),
    nhm: v.getUint16(hhea + 34), numGlyphs: v.getUint16(tables.maxp.off + 4) };
  f.adv = (g) => v.getUint16(tables.hmtx.off + 4 * Math.min(g, f.nhm - 1));
  f.loc = (g) => (f.locFmt ? v.getUint32(tables.loca.off + 4 * g) : v.getUint16(tables.loca.off + 2 * g) * 2);
  const post = tables.post && tables.post.off;
  f.italicAngle = post ? v.getInt32(post + 4) / 65536 : 0; f.fixed = post ? v.getUint32(post + 12) !== 0 : false;
  const os2 = tables['OS/2'] && tables['OS/2'].off;
  f.weight = os2 ? v.getUint16(os2 + 4) : 400;
  f.capHeight = os2 && v.getUint16(os2) >= 2 ? v.getInt16(os2 + 88) : f.ascent; f.xHeight = os2 && v.getUint16(os2) >= 2 ? v.getInt16(os2 + 86) : Math.round(f.ascent / 2);
  // cmap: Unicode -> glyph (Windows Unicode BMP or full; else Unicode platform)
  const cm = tables.cmap.off, map = new Map(); let best = null;
  for (let i = 0, nt = v.getUint16(cm + 2); i < nt; i++) {
    const pid = v.getUint16(cm + 4 + i * 8), eid = v.getUint16(cm + 6 + i * 8), o = cm + v.getUint32(cm + 8 + i * 8), fmt = v.getUint16(o);
    const rank = pid === 3 && eid === 10 && fmt === 12 ? 3 : pid === 3 && eid === 1 && fmt === 4 ? 2 : pid === 0 && (fmt === 4 || fmt === 12) ? 1 : 0;
    if (rank && (!best || rank > best[0])) best = [rank, o, fmt];
  }
  if (best && best[2] === 4) {
    const o = best[1], seg = v.getUint16(o + 6) / 2, ends = o + 14, starts = ends + seg * 2 + 2, deltas = starts + seg * 2, ranges = deltas + seg * 2;
    for (let s = 0; s < seg; s++) {
      const e = v.getUint16(ends + s * 2), st = v.getUint16(starts + s * 2), d = v.getInt16(deltas + s * 2), ro = v.getUint16(ranges + s * 2);
      for (let c = st; c <= e && c !== 0xFFFF; c++) {
        let g; if (!ro) g = (c + d) & 0xFFFF; else { const a = ranges + s * 2 + ro + (c - st) * 2; g = a + 1 < bytes.length ? v.getUint16(a) : 0; if (g) g = (g + d) & 0xFFFF; }
        if (g) map.set(c, g);
      }
    }
  } else if (best && best[2] === 12) {
    const o = best[1];
    for (let i = 0, ng = v.getUint32(o + 12); i < ng; i++) { const a = o + 16 + i * 12, s0 = v.getUint32(a), e = v.getUint32(a + 4), g0 = v.getUint32(a + 8); for (let c = s0; c <= e && c - s0 < 0x10000; c++) map.set(c, g0 + c - s0); }
  }
  f.cmap = map; f.gid = (u) => map.get(u) || 0;
  return f;
}
// codes (optional): a symbolic font's own code -> Unicode list ([256]). The cmap is then one (3,0) Windows Symbol
// table mapping 0xF000 + code to the glyph, which is what a symbolic TrueType font with no Encoding (PDF/A-1, 6.3.7)
// is read through.
function pdfaTtfSubset(f, unicodes, codes = null) {
  const { bytes, view: v, tables } = f;
  const gids = new Set([0]), pairs = [];
  if (codes) codes.forEach((u, c) => { const g = u == null ? 0 : f.gid(u); if (g) { gids.add(g); pairs.push([0xF000 + c, g]); } });
  else for (const u of [...new Set(unicodes)].sort((a, b) => a - b)) { const g = f.gid(u); if (g && u < 0xFFFF) { gids.add(g); pairs.push([u, g]); } }
  // composite glyphs need their parts
  const stack = [...gids];
  while (stack.length) {
    const g = stack.pop(), a = tables.glyf.off + f.loc(g), b = tables.glyf.off + f.loc(g + 1);
    if (b - a < 10 || v.getInt16(a) >= 0) continue;
    let p = a + 10, flags;
    do { flags = v.getUint16(p); const c = v.getUint16(p + 2); if (!gids.has(c)) { gids.add(c); stack.push(c); } p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0); } while (flags & 0x20);
  }
  const glyf = [], loca = new Uint8Array((f.numGlyphs + 1) * 4), lv = new DataView(loca.buffer); let len = 0;
  for (let g = 0; g < f.numGlyphs; g++) {
    lv.setUint32(g * 4, len);
    if (!gids.has(g)) continue;
    const a = tables.glyf.off + f.loc(g), b = tables.glyf.off + f.loc(g + 1);
    if (b > a) { let part = bytes.subarray(a, b); if (part.length % 4) { const q = new Uint8Array(part.length + 4 - part.length % 4); q.set(part); part = q; } glyf.push(part); len += part.length; }
  }
  lv.setUint32(f.numGlyphs * 4, len);
  const glyfBytes = new Uint8Array(len); { let o = 0; for (const p of glyf) { glyfBytes.set(p, o); o += p.length; } }
  // cmap: one Windows Unicode (3,1) format 4 table
  const segs = [];
  for (const [u, g] of pairs) { const s = segs[segs.length - 1]; if (s && u === s[1] + 1 && g === s[3] + (u - s[0])) s[1] = u; else segs.push([u, u, 0, g]); }
  segs.push([0xFFFF, 0xFFFF, 0, 1]);
  const sc = segs.length, cl = 16 + sc * 8, cmap = new Uint8Array(12 + cl), cv = new DataView(cmap.buffer);
  cv.setUint16(2, 1); cv.setUint16(4, 3); cv.setUint16(6, codes ? 0 : 1); cv.setUint32(8, 12);
  const o4 = 12, es = Math.floor(Math.log2(sc)), sr = 2 * 2 ** es;
  cv.setUint16(o4, 4); cv.setUint16(o4 + 2, cl); cv.setUint16(o4 + 6, sc * 2); cv.setUint16(o4 + 8, sr); cv.setUint16(o4 + 10, es); cv.setUint16(o4 + 12, sc * 2 - sr);
  segs.forEach(([s, e, , g], i) => { cv.setUint16(o4 + 14 + i * 2, e); cv.setUint16(o4 + 16 + sc * 2 + i * 2, s); cv.setUint16(o4 + 16 + sc * 4 + i * 2, (g - s) & 0xFFFF); });
  const copy = (t) => bytes.slice(tables[t].off, tables[t].off + tables[t].len);
  const head = copy('head'); new DataView(head.buffer).setInt16(50, 1); new DataView(head.buffer).setUint32(8, 0);
  const post = new Uint8Array(32); if (tables.post) post.set(bytes.subarray(tables.post.off, tables.post.off + 16)); new DataView(post.buffer).setUint32(0, 0x00030000);
  const out = { head, hhea: copy('hhea'), maxp: copy('maxp'), hmtx: copy('hmtx'), loca, glyf: glyfBytes, cmap, post };
  for (const t of ['cvt ', 'fpgm', 'prep', 'OS/2']) if (tables[t]) out[t] = copy(t);
  const names = Object.keys(out).sort(), nt = names.length;
  let size = 12 + nt * 16; for (const t of names) size += Math.ceil(out[t].length / 4) * 4;
  const font = new Uint8Array(size), fv = new DataView(font.buffer);
  const es2 = Math.floor(Math.log2(nt)), sr2 = 16 * 2 ** es2;
  fv.setUint32(0, 0x00010000); fv.setUint16(4, nt); fv.setUint16(6, sr2); fv.setUint16(8, es2); fv.setUint16(10, nt * 16 - sr2);
  const sum = (b, o, l) => { let s = 0; for (let i = 0; i < l; i += 4) s = (s + ((b[o + i] << 24) | (b[o + i + 1] << 16) | (b[o + i + 2] << 8) | b[o + i + 3]) >>> 0) >>> 0; return s; };
  let off = 12 + nt * 16, headAt = 0;
  names.forEach((t, i) => {
    const d = out[t]; font.set(d, off);
    for (let k = 0; k < 4; k++) font[12 + i * 16 + k] = t.charCodeAt(k);
    fv.setUint32(12 + i * 16 + 4, sum(font, off, Math.ceil(d.length / 4) * 4)); fv.setUint32(12 + i * 16 + 8, off); fv.setUint32(12 + i * 16 + 12, d.length);
    if (t === 'head') headAt = off;
    off += Math.ceil(d.length / 4) * 4;
  });
  fv.setUint32(headAt + 8, (0xB1B0AFBA - sum(font, 0, font.length)) >>> 0);
  return font;
}

/* ----- encodings of simple fonts: code -> Unicode ----- */
// WinAnsi and MacRoman from the browser's own tables; the undefined WinAnsi codes are the bullet (ISO 32000-1, D.2).
const PDFA_ENC = (() => {
  const dec = (label) => { try { const t = new TextDecoder(label); return Array.from({ length: 256 }, (_, c) => (c < 32 ? null : t.decode(Uint8Array.of(c)).codePointAt(0))); } catch { return Array.from({ length: 256 }, (_, c) => (c >= 32 && c < 127 ? c : null)); } };
  const win = dec('windows-1252'); for (const c of [127, 129, 141, 143, 144, 157]) win[c] = 0x2022; win[160] = 0x20; win[173] = 0x2D;
  const mac = dec('macintosh'); mac[127] = null;
  const std = Array.from({ length: 256 }, (_, c) => (c >= 32 && c < 127 ? c : null)); std[39] = 0x2019; std[96] = 0x2018;
  const hi = '161 a1 162 a2 163 a3 164 2044 165 a5 166 192 167 a7 168 a4 169 27 170 201c 171 ab 172 2039 173 203a 174 fb01 175 fb02 177 2013 178 2020 179 2021 180 b7 182 b6 183 2022 184 201a 185 201e 186 201d 187 bb 188 2026 189 2030 191 bf 193 60 194 b4 195 2c6 196 2dc 197 af 198 2d8 199 2d9 200 a8 202 2da 203 b8 205 2dd 206 2db 207 2c7 208 2014 225 c6 227 aa 232 141 233 d8 234 152 235 ba 241 e6 245 131 248 142 249 f8 250 153 251 df'.split(' ');
  for (let i = 0; i < hi.length; i += 2) std[+hi[i]] = parseInt(hi[i + 1], 16);
  return { WinAnsiEncoding: win, MacRomanEncoding: mac, StandardEncoding: std };
})();
// Glyph names (the Adobe Glyph List's Latin part) -> Unicode, for /Differences.
const PDFA_AGL = (() => {
  const m = new Map();
  const ascii = 'space exclam quotedbl numbersign dollar percent ampersand quotesingle parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore grave a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde'.split(' ');
  ascii.forEach((n, i) => m.set(n, 32 + i));
  const latin = 'exclamdown cent sterling currency yen brokenbar section dieresis copyright ordfeminine guillemotleft logicalnot hyphen registered macron degree plusminus twosuperior threesuperior acute mu paragraph periodcentered cedilla onesuperior ordmasculine guillemotright onequarter onehalf threequarters questiondown Agrave Aacute Acircumflex Atilde Adieresis Aring AE Ccedilla Egrave Eacute Ecircumflex Edieresis Igrave Iacute Icircumflex Idieresis Eth Ntilde Ograve Oacute Ocircumflex Otilde Odieresis multiply Oslash Ugrave Uacute Ucircumflex Udieresis Yacute Thorn germandbls agrave aacute acircumflex atilde adieresis aring ae ccedilla egrave eacute ecircumflex edieresis igrave iacute icircumflex idieresis eth ntilde ograve oacute ocircumflex otilde odieresis divide oslash ugrave uacute ucircumflex udieresis yacute thorn ydieresis'.split(' ');
  latin.forEach((n, i) => { if (!m.has(n)) m.set(n, 0xA1 + i); });
  const more = 'Euro 20ac quotesinglbase 201a florin 192 quotedblbase 201e ellipsis 2026 dagger 2020 daggerdbl 2021 circumflex 2c6 perthousand 2030 Scaron 160 guilsinglleft 2039 OE 152 Zcaron 17d quoteleft 2018 quoteright 2019 quotedblleft 201c quotedblright 201d bullet 2022 endash 2013 emdash 2014 tilde 2dc trademark 2122 scaron 161 guilsinglright 203a oe 153 zcaron 17e Ydieresis 178 fraction 2044 fi fb01 fl fb02 dotlessi 131 Lslash 141 lslash 142 ring 2da breve 2d8 dotaccent 2d9 hungarumlaut 2dd ogonek 2db caron 2c7 minus 2212 nbspace a0 sfthyphen ad notequal 2260 infinity 221e lessequal 2264 greaterequal 2265 partialdiff 2202 summation 2211 product 220f pi 3c0 integral 222b Omega 2126 radical 221a approxequal 2248 Delta 2206 lozenge 25ca mu1 b5 middot b7 Ohm 2126 increment 2206'.split(' ');
  for (let i = 0; i < more.length; i += 2) m.set(more[i], parseInt(more[i + 1], 16));
  return m;
})();
function pdfaGlyphUnicode(name) {
  if (PDFA_AGL.has(name)) return PDFA_AGL.get(name);
  let r = /^uni([0-9A-F]{4})$/.exec(name); if (r) return parseInt(r[1], 16);
  r = /^u([0-9A-F]{4,6})$/.exec(name); if (r) return parseInt(r[1], 16);
  const base = name.split('.')[0]; if (base !== name && base) return pdfaGlyphUnicode(base);
  return null;
}
// What each code of a simple font stands for: { uni: [256], unknown: [names] }. `builtin` is the encoding used when
// the font names none (StandardEncoding for Latin text fonts).
function pdfaFontUnicodes(L, font) {
  const enc = font.lookup(L.PDFName.of('Encoding')), unknown = [];
  let base = 'StandardEncoding', diffs = null;
  if (enc instanceof L.PDFName) base = enc.decodeText();
  else if (enc instanceof L.PDFDict) { const b = enc.lookup(L.PDFName.of('BaseEncoding')); if (b instanceof L.PDFName) base = b.decodeText(); diffs = enc.lookup(L.PDFName.of('Differences')); }
  const uni = (PDFA_ENC[base] || PDFA_ENC.StandardEncoding).slice();
  if (diffs instanceof L.PDFArray) {
    let code = 0;
    for (const x of diffs.asArray()) {
      const o = font.context ? font.context.lookup(x) : x;
      if (o instanceof L.PDFNumber) code = o.asNumber();
      else if (o instanceof L.PDFName) { if (code < 256) { const u = pdfaGlyphUnicode(o.decodeText()); uni[code] = u; if (u == null && o.decodeText() !== '.notdef') unknown.push(o.decodeText()); } code++; }
    }
  }
  return { uni, unknown, base: PDFA_ENC[base] ? base : 'StandardEncoding', named: enc instanceof L.PDFName && (base === 'WinAnsiEncoding' || base === 'MacRomanEncoding') };
}
// How a simple font turns codes into glyphs, as a string: two font dictionaries that share one font program must
// agree on it, or a validator reading the program through one of them finds the other's widths wrong.
function pdfaEncodingSig(L, font) {
  const N = L.PDFName.of, look = (o) => (font.context ? font.context.lookup(o) : o), enc = font.lookup(N('Encoding'));
  const fd = font.lookup(N('FontDescriptor')), fl = fd instanceof L.PDFDict ? fd.lookup(N('Flags')) : null;
  const sym = fl instanceof L.PDFNumber && fl.asNumber() & 4 ? 'S' : 'N';
  if (enc instanceof L.PDFName) return `${sym}:${enc.decodeText()}`;
  if (!(enc instanceof L.PDFDict)) return enc ? `${sym}:?` : `${sym}:-`;
  const b = enc.lookup(N('BaseEncoding')), d = enc.lookup(N('Differences'));
  const diffs = d instanceof L.PDFArray ? d.asArray().map((x) => { const o = look(x); return o instanceof L.PDFNumber ? o.asNumber() : o instanceof L.PDFName ? '/' + o.decodeText() : '?'; }).join(' ') : '';
  return `${sym}:${b instanceof L.PDFName ? b.decodeText() : ''}[${diffs}]`;
}
// Embedded programs of simple fonts that font dictionaries with different encodings share:
// [{ program, key, groups: [[[font, info]...], ...] }], one group per encoding (the first keeps the program).
function pdfaSharedPrograms(L, fonts) {
  const { PDFDict, PDFStream } = L, N = L.PDFName.of, by = new Map();
  for (const [f, w] of fonts) {
    const sub = pdfaName(L, f.get(N('Subtype'))); if (!/^(Type1|MMType1|TrueType)$/.test(sub || '')) continue;
    const fd = f.lookup(N('FontDescriptor')); if (!(fd instanceof PDFDict)) continue;
    const k = ['FontFile2', 'FontFile', 'FontFile3'].find((x) => fd.lookup(N(x)) instanceof PDFStream); if (!k) continue;
    const prog = fd.lookup(N(k));
    if (!by.has(prog)) by.set(prog, { key: k, sigs: new Map() });
    const sigs = by.get(prog).sigs, sig = pdfaEncodingSig(L, f);
    if (!sigs.has(sig)) sigs.set(sig, []); sigs.get(sig).push([f, w]);
  }
  return [...by].filter(([, v]) => v.sigs.size > 1).map(([program, v]) => ({ program, key: v.key, groups: [...v.sigs.values()] }));
}
// The Latin glyphs every replacement font carries (any code a simple font with these encodings can reach).
const PDFA_LATIN = (() => { const s = new Set(); for (const t of Object.values(PDFA_ENC)) for (const u of t) if (u != null) s.add(u); for (const u of PDFA_AGL.values()) s.add(u); return [...s]; })();
const pdfaUnicodeToName = (() => { let m = null; return (u) => { if (!m) { m = new Map(); for (const [n, c] of PDFA_AGL) if (!m.has(c)) m.set(c, n); m.set(0x20, 'space'); m.set(0x2D, 'hyphen'); } return m.get(u) || 'uni' + u.toString(16).toUpperCase().padStart(4, '0'); }; })();
function pdfaToUnicodeCMap(uni) {
  const rows = []; uni.forEach((u, c) => { if (u != null && u > 0 && u !== 0xFEFF && u !== 0xFFFE) rows.push(`<${c.toString(16).padStart(2, '0').toUpperCase()}> <${(u > 0xFFFF ? String.fromCodePoint(u).split('').map((x) => x.charCodeAt(0).toString(16).padStart(4, '0')).join('') : u.toString(16).padStart(4, '0')).toUpperCase()}>`); });
  let body = ''; for (let i = 0; i < rows.length; i += 100) { const part = rows.slice(i, i + 100); body += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

// A ToUnicode CMap's mappings: Map(code -> text). bfchar and both forms of bfrange.
function pdfaCMapRead(text) {
  const m = new Map(), hex = (h) => { h = h.replace(/\s+/g, ''); if (h.length <= 2) return h ? String.fromCharCode(parseInt(h, 16)) : ''; let t = ''; for (let i = 0; i + 4 <= h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return t; };
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const r of blk[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>/g)) m.set(parseInt(r[1].replace(/\s+/g, ''), 16), hex(r[2]));
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const r of blk[1].matchAll(/<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(?:<([0-9A-Fa-f\s]*)>|\[([^\]]*)\])/g)) {
      const a = parseInt(r[1].replace(/\s+/g, ''), 16), b = parseInt(r[2].replace(/\s+/g, ''), 16);
      if (b - a > 0xFFFF || b < a) continue;
      if (r[4] != null) { const list = [...r[4].matchAll(/<([0-9A-Fa-f\s]*)>/g)].map((x) => hex(x[1])); for (let c = a; c <= b && c - a < list.length; c++) m.set(c, list[c - a]); continue; }
      const t = hex(r[3]); if (!t) continue;
      for (let c = a; c <= b; c++) m.set(c, t.slice(0, -1) + String.fromCharCode(t.charCodeAt(t.length - 1) + (c - a)));
    }
  }
  return m;
}
// A ToUnicode mapping PDF/A accepts: present, and not U+0000, U+FEFF or U+FFFE (ISO 19005-2, 6.2.11.7.2). An empty
// one (<0005> <>, which pdf-lib writes for a glyph whose text another glyph carries, as in Arabic joining) is
// accepted, as veraPDF accepts it.
const pdfaGoodText = (t) => typeof t === 'string' && !/[\u0000\uFEFF\uFFFE]/.test(t);
// What each glyph of a TrueType/OpenType program stands for: Map(gid -> text). From the cmap, then from the GSUB
// substitutions that make glyphs the cmap doesn't reach: ligatures (f + t -> "ft"), single and alternate forms.
function pdfaGlyphTexts(f) {
  const t = new Map();
  for (const [u, g] of f.cmap) if (!t.has(g) || u < t.get(g).codePointAt(0)) t.set(g, String.fromCodePoint(u));
  const G = f.tables.GSUB; if (!G) return t;
  const v = f.view, n = f.bytes.length, u16 = (o) => (o + 2 <= n ? v.getUint16(o) : 0);
  const cover = (o) => {
    const out = []; const fmt = u16(o);
    if (fmt === 1) for (let i = 0, c = u16(o + 2); i < c; i++) out.push(u16(o + 4 + i * 2));
    else if (fmt === 2) for (let i = 0, c = u16(o + 2); i < c; i++) { const a = o + 4 + i * 6, s0 = u16(a), e = u16(a + 2); for (let g = s0; g <= e && out.length < 65536; g++) out.push(g); }
    return out;
  };
  const singles = [], ligs = [];
  try {
    const ll = G.off + u16(G.off + 8);
    for (let i = 0, lc = u16(ll); i < lc; i++) {
      const lo = ll + u16(ll + 2 + i * 2); let type = u16(lo);
      for (let k = 0, sc = u16(lo + 4); k < sc; k++) {
        let so = lo + u16(lo + 6 + k * 2), st = type;
        if (type === 7) { st = u16(so + 2); so += v.getUint32(so + 4); }
        const fmt = u16(so), cov = cover(so + u16(so + 2));
        if (st === 1 && fmt === 1) { const d = v.getInt16(so + 4); for (const g of cov) singles.push([g, (g + d) & 0xFFFF]); }
        else if (st === 1 && fmt === 2) cov.forEach((g, j) => { if (j < u16(so + 4)) singles.push([g, u16(so + 6 + j * 2)]); });
        else if (st === 3 && fmt === 1) cov.forEach((g, j) => { if (j >= u16(so + 4)) return; const a = so + u16(so + 6 + j * 2); for (let q = 0, c = u16(a); q < c; q++) singles.push([g, u16(a + 2 + q * 2)]); });
        else if (st === 4 && fmt === 1) cov.forEach((g, j) => {
          if (j >= u16(so + 4)) return; const ls = so + u16(so + 6 + j * 2);
          for (let q = 0, c = u16(ls); q < c; q++) { const lg = ls + u16(ls + 2 + q * 2), cc = u16(lg + 2), comps = [g]; for (let r = 1; r < cc; r++) comps.push(u16(lg + 4 + (r - 1) * 2)); ligs.push([u16(lg), comps]); }
        });
      }
    }
  } catch { return t; }
  for (let pass = 0; pass < 4; pass++) {
    let more = false;
    for (const [a, b] of singles) if (t.has(a) && !t.has(b)) { t.set(b, t.get(a)); more = true; }
    for (const [g, comps] of ligs) if (!t.has(g) && comps.every((c) => t.has(c))) { t.set(g, comps.map((c) => t.get(c)).join('')); more = true; }
    if (!more) break;
  }
  return t;
}
// A Type 0 font's two-byte codes (Identity-H/V, or an embedded CMap): the CIDs a set of shown strings uses, or null
// when its encoding is not one this reads.
function pdfaCidsShown(L, f, strings) {
  const e = f.lookup(L.PDFName.of('Encoding')), nm = pdfaName(L, e);
  if (!(e instanceof L.PDFStream) && !/^Identity-[HV]$/.test(nm || '')) return null;
  const cids = new Set();
  for (const s of strings || []) for (let i = 0; i + 1 < s.length; i += 2) cids.add((s.charCodeAt(i) << 8) | s.charCodeAt(i + 1));
  return cids;
}
// PDF/A-2u, 3u: a CID TrueType font gets a Unicode mapping for every glyph it shows, from its own program, keeping
// the mappings it had. Returns 'fixed' (mappings added), 'ok' (nothing missing) or 'unmapped' (none could be found).
function pdfaCidUnicode(L, out, f, strings) {
  const { PDFName, PDFDict, PDFArray, PDFStream } = L, N = PDFName.of, look = (o) => out.context.lookup(o);
  const cids = pdfaCidsShown(L, f, strings); if (!cids || !cids.size) return 'ok';
  const tu = f.lookup(N('ToUnicode')), had = tu instanceof PDFStream ? pdfaCMapRead(pdfaLatin1(pdfaStreamBytes(L, tu) || new Uint8Array())) : new Map();
  const missing = [...cids].filter((c) => !pdfaGoodText(had.get(c)));
  if (!missing.length) return 'ok';
  const ds = f.lookup(N('DescendantFonts')), cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null;
  if (!(cid instanceof PDFDict) || pdfaName(L, cid.get(N('Subtype'))) !== 'CIDFontType2') return 'unmapped';
  const fd = cid.lookup(N('FontDescriptor')), ff = fd instanceof PDFDict ? fd.lookup(N('FontFile2')) : null; if (!(ff instanceof PDFStream)) return 'unmapped';
  let prog; try { prog = pdfaTtf(pdfaStreamBytes(L, ff)); } catch { return 'unmapped'; }
  const m = cid.lookup(N('CIDToGIDMap')), mb = m instanceof PDFStream ? pdfaStreamBytes(L, m) : null;
  const gid = (c) => (mb ? (c * 2 + 1 < mb.length ? (mb[c * 2] << 8) | mb[c * 2 + 1] : 0) : c);
  const texts = pdfaGlyphTexts(prog);
  let left = 0;
  for (const c of missing) { const t = texts.get(gid(c)); if (pdfaGoodText(t)) had.set(c, t); else left++; }
  if (left === missing.length) return 'unmapped';
  // every mapping, written again as bfchar rows (two-byte codes)
  const hex4 = (t) => [...t].map((ch) => { const cp = ch.codePointAt(0); return cp > 0xFFFF ? ch.split('').map((x) => x.charCodeAt(0).toString(16).padStart(4, '0')).join('') : cp.toString(16).padStart(4, '0'); }).join('').toUpperCase();
  const rows = [...had].filter(([, t]) => pdfaGoodText(t)).sort((a, b) => a[0] - b[0]).map(([c, t]) => `<${c.toString(16).padStart(4, '0').toUpperCase()}> <${hex4(t)}>`);
  let body = ''; for (let i = 0; i < rows.length; i += 100) { const part = rows.slice(i, i + 100); body += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
  f.set(N('ToUnicode'), out.context.register(out.context.flateStream(pdfaBytes(cmap))));
  return 'fixed'; // any still unmapped are reported by the check
}
// The strings each font shows anywhere (pages and comment appearances): Map(font -> Set).
function pdfaShownText(seen) {
  const all = new Map();
  for (const r of [...seen.pages, ...seen.annots.map((x) => x.rec)]) for (const [f, set] of r.text) { let s = all.get(f); if (!s) all.set(f, (s = new Set())); for (const x of set) s.add(x); }
  return all;
}

/* ----- the replacement fonts ----- */
const PDFA_FONT_FILES = {
  arimo: ['https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo@0.4.3/400Regular/Arimo_400Regular.ttf', 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo@0.4.3/700Bold/Arimo_700Bold.ttf',
    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo@0.4.3/400Regular_Italic/Arimo_400Regular_Italic.ttf', 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/arimo@0.4.3/700Bold_Italic/Arimo_700Bold_Italic.ttf'],
  tinos: ['https://cdn.jsdelivr.net/npm/@expo-google-fonts/tinos@0.4.2/400Regular/Tinos_400Regular.ttf', 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/tinos@0.4.2/700Bold/Tinos_700Bold.ttf',
    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/tinos@0.4.2/400Regular_Italic/Tinos_400Regular_Italic.ttf', 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/tinos@0.4.2/700Bold_Italic/Tinos_700Bold_Italic.ttf'],
  cousine: ['https://cdn.jsdelivr.net/npm/@expo-google-fonts/cousine@0.4.3/400Regular/Cousine_400Regular.ttf', 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/cousine@0.4.3/700Bold/Cousine_700Bold.ttf',
    'https://cdn.jsdelivr.net/npm/@expo-google-fonts/cousine@0.4.3/400Regular_Italic/Cousine_400Regular_Italic.ttf', 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/cousine@0.4.3/700Bold_Italic/Cousine_700Bold_Italic.ttf'],
};
const PDFA_FAMILY_NAME = { arimo: 'Arimo', tinos: 'Tinos', cousine: 'Cousine' };
const pdfaFontLoads = new Map();
function pdfaFontFile(fam, style) {
  const url = PDFA_FONT_FILES[fam][style];
  if (!pdfaFontLoads.has(url)) pdfaFontLoads.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error('font ' + r.status); return r.arrayBuffer(); }).then((b) => pdfaTtf(new Uint8Array(b))).catch((e) => { pdfaFontLoads.delete(url); throw e; }));
  return pdfaFontLoads.get(url);
}
// Which embedded font stands in for a font that isn't embedded: [family, style 0-3] or null (Symbol, dingbats…).
function pdfaSubstitute(L, font) {
  let name = (pdfaName(L, font.get(L.PDFName.of('BaseFont'))) || '').replace(/^[A-Z]{6}\+/, '');
  const fd = font.lookup(L.PDFName.of('FontDescriptor')), num = (k) => { const v = fd instanceof L.PDFDict ? fd.lookup(L.PDFName.of(k)) : null; return v instanceof L.PDFNumber ? v.asNumber() : 0; };
  const flags = num('Flags');
  if (/symbol|dingbat|wingding|webding|marlett|zapf/i.test(name)) return null;
  let fam = /courier|mono|consol|cousine|typewriter|lucida ?console/i.test(name) ? 'cousine'
    : /times|tinos|georgia|garamond|roman|serif(?!.*sans)|minion|cambria|book ?antiqua|palatino|baskerville/i.test(name) && !/sans/i.test(name) ? 'tinos'
    : /helvetica|arial|arimo|swiss|helv|sans|verdana|tahoma|calibri|segoe|liberation ?sans|frutiger|univers|myriad/i.test(name) ? 'arimo' : null;
  if (!fam) {
    if (flags & 4 && !(flags & 32)) return null; // symbolic, no Latin text: no stand-in
    fam = flags & 1 ? 'cousine' : flags & 2 ? 'tinos' : 'arimo';
  }
  const bold = /bold|black|heavy|semibold|demi/i.test(name) || num('FontWeight') >= 600 || !!(flags & 0x40000);
  const italic = /italic|oblique|kursiv/i.test(name) || !!(flags & 64) || num('ItalicAngle') !== 0;
  return [fam, (bold ? 1 : 0) + (italic ? 2 : 0)];
}

/* ----- walking the file ----- */
// Every dictionary and stream that can be reached from the trailer, once: [{ obj, ref? }]
function pdfaReachable(L, out) {
  const { PDFRef, PDFDict, PDFArray, PDFStream } = L, seen = new Set(), refs = new Set(), list = [], stack = [out.context.trailerInfo.Root, out.context.trailerInfo.Info];
  list.refs = refs; // every live indirect object, whatever it is
  while (stack.length) {
    let o = stack.pop(), ref = null;
    if (o instanceof PDFRef) { if (seen.has(o.tag)) continue; seen.add(o.tag); refs.add(o.tag); ref = o; o = out.context.lookup(o); }
    if (!o || seen.has(o)) continue;
    if (o instanceof PDFStream) { seen.add(o); list.push({ obj: o, ref }); for (const [, v] of o.dict.entries()) stack.push(v); }
    else if (o instanceof PDFDict) { seen.add(o); list.push({ obj: o, ref }); for (const [, v] of o.entries()) stack.push(v); }
    else if (o instanceof PDFArray) { seen.add(o); for (const v of o.asArray()) stack.push(v); }
  }
  return list;
}
// Fonts used by the pages: their resources, form XObjects, patterns, soft masks, annotation appearances, Type 3 glyphs.
function pdfaPageFonts(L, out) {
  const { PDFDict, PDFStream, PDFArray } = L, N = L.PDFName.of, fonts = new Map(), seen = new Set();
  const look = (o) => out.context.lookup(o);
  const walkStream = (s, page) => { if (s instanceof PDFStream && !seen.has(s)) { seen.add(s); walkRes(s.dict.lookup(N('Resources')), page); } };
  const walkRes = (res, page) => {
    if (!(res instanceof PDFDict) || seen.has(res)) return; seen.add(res);
    const fd = res.lookup(N('Font'));
    if (fd instanceof PDFDict) for (const [k, v] of fd.entries()) { const f = look(v); if (f instanceof PDFDict) { if (!fonts.has(f)) fonts.set(f, { page, key: k.decodeText() }); if (pdfaName(L, f.get(N('Subtype'))) === 'Type3') walkRes(f.lookup(N('Resources')), page); } }
    for (const kind of ['XObject', 'Pattern']) { const d = res.lookup(N(kind)); if (d instanceof PDFDict) for (const [, v] of d.entries()) walkStream(look(v), page); }
    const gs = res.lookup(N('ExtGState'));
    if (gs instanceof PDFDict) for (const [, v] of gs.entries()) { const g = look(v); const sm = g instanceof PDFDict ? g.lookup(N('SMask')) : null; if (sm instanceof PDFDict) walkStream(sm.lookup(N('G')), page); }
  };
  const walkAp = (ap, page) => { if (!(ap instanceof PDFDict)) return; for (const k of ['N', 'R', 'D']) { const x = ap.lookup(N(k)); if (x instanceof PDFStream) walkStream(x, page); else if (x instanceof PDFDict) for (const [, v] of x.entries()) walkStream(look(v), page); } };
  out.getPages().forEach((p, i) => {
    try { walkRes(p.node.Resources(), i + 1); } catch {}
    const an = p.node.lookup(N('Annots'));
    if (an instanceof PDFArray) for (const r of an.asArray()) { const a = look(r); if (a instanceof PDFDict) walkAp(a.lookup(N('AP')), i + 1); }
  });
  return fonts;
}
const pdfaFlag = (L, a) => { const f = a.lookup(L.PDFName.of('F')); return f instanceof L.PDFNumber ? f.asNumber() : 0; };
const PDFA_BAD_ACTIONS = new Set(['JavaScript', 'Launch', 'Sound', 'Movie', 'ResetForm', 'ImportData', 'Hide', 'SetOCGState', 'Rendition', 'Trans', 'GoTo3DView', 'RichMediaExecute']);
const PDFA_OK_NAMED = new Set(['NextPage', 'PrevPage', 'FirstPage', 'LastPage']);
const PDFA_BAD_ANNOTS = new Set(['3D', 'Sound', 'Screen', 'Movie', 'RichMedia']);
const PDFA_KNOWN_ANNOTS = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Polygon', 'PolyLine', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Caret', 'Ink', 'Popup', 'FileAttachment', 'Widget', 'PrinterMark', 'TrapNet', 'Watermark', 'Redact']);
function pdfaBadAction(L, d) {
  if (!(d instanceof L.PDFDict)) return false;
  const s = pdfaName(L, d.get(L.PDFName.of('S'))); if (!s) return false;
  const type = pdfaName(L, d.get(L.PDFName.of('Type')));
  if (type && type !== 'Action') return false;
  if (PDFA_BAD_ACTIONS.has(s)) return true;
  if (s === 'Named') return !PDFA_OK_NAMED.has(pdfaName(L, d.get(L.PDFName.of('N'))));
  return false;
}

/* ----- what the pages draw with: colour spaces, transparency, 16-bit and JPEG 2000 pictures ----- */
// A record of what some content uses: { RGB, CMYK, Gray (device colours not remapped by a Default colour space),
// icc: Set(N), iccV4, cie, spot, alpha: Set(why), bits16, jpx }
const pdfaRec = () => ({ RGB: false, CMYK: false, Gray: false, icc: new Set(), iccV4: false, cie: false, spot: false, alpha: new Set(), bits16: false, jpx: false, text: new Map() });
const PDFA_INLINE_CS = { RGB: 'DeviceRGB', G: 'DeviceGray', CMYK: 'DeviceCMYK', I: 'Indexed' };
function pdfaUseCs(L, out, cs, res, rec, depth = 0) {
  const { PDFName, PDFArray, PDFDict, PDFStream } = L, N = PDFName.of, look = (o) => out.context.lookup(o);
  if (depth > 8) return;
  cs = look(cs);
  if (cs instanceof PDFName || typeof cs === 'string') {
    let n = typeof cs === 'string' ? cs : cs.decodeText(); n = PDFA_INLINE_CS[n] || n;
    const dev = { DeviceRGB: 'RGB', DeviceCMYK: 'CMYK', DeviceGray: 'Gray' }[n];
    const csd = res instanceof PDFDict ? res.lookup(N('ColorSpace')) : null;
    if (dev) { const def = csd instanceof PDFDict ? csd.get(N('Default' + dev)) : null; if (def && depth === 0) pdfaUseCs(L, out, def, null, rec, depth + 1); else rec[dev] = true; return; }
    if (n === 'Pattern' || n === 'Indexed') return;
    if (csd instanceof PDFDict && csd.get(N(n))) pdfaUseCs(L, out, csd.get(N(n)), res, rec, depth + 1);
    return;
  }
  if (!(cs instanceof PDFArray) || !cs.size()) return;
  const fam = pdfaName(L, look(cs.get(0)));
  if (fam === 'ICCBased') {
    const s = look(cs.get(1)); if (!(s instanceof PDFStream)) return;
    const nn = s.dict.lookup(N('N')); rec.icc.add(nn ? nn.asNumber() : 0);
    const b = pdfaStreamBytes(L, s); if (b && b.length > 8 && b[8] >= 4) rec.iccV4 = true;
  } else if (fam === 'Indexed' || fam === 'I') pdfaUseCs(L, out, cs.get(1), res, rec, depth + 1);
  else if (fam === 'Pattern') { if (cs.size() > 1) pdfaUseCs(L, out, cs.get(1), res, rec, depth + 1); }
  else if (fam === 'Separation' || fam === 'DeviceN') { rec.spot = true; const names = look(cs.get(1)); const all = names instanceof PDFArray ? names.asArray().map((x) => pdfaName(L, look(x))) : [pdfaName(L, names)]; if (!all.every((x) => x === 'None')) pdfaUseCs(L, out, cs.get(2), res, rec, depth + 1); }
  else if (fam === 'CalRGB' || fam === 'CalGray' || fam === 'Lab') rec.cie = true;
  else if (fam) pdfaUseCs(L, out, look(cs.get(0)), res, rec, depth + 1);
}
function pdfaUseGs(L, gs, rec) {
  if (!(gs instanceof L.PDFDict)) return;
  const N = L.PDFName.of, num = (k) => { const x = gs.lookup(N(k)); return x instanceof L.PDFNumber ? x.asNumber() : 1; };
  if (num('CA') < 1 || num('ca') < 1) rec.alpha.add('see-through drawing');
  const sm = gs.get(N('SMask')); if (sm && pdfaName(L, sm) !== 'None') rec.alpha.add('soft mask');
  const bm = gs.lookup(N('BM')), bmn = bm instanceof L.PDFArray ? pdfaName(L, gs.context.lookup(bm.get(0))) : pdfaName(L, bm);
  if (bmn && !PDFA_TRANSPARENT_BM.has(bmn)) rec.alpha.add('blend mode');
}
function pdfaUseImage(L, out, s, res, rec) {
  const N = L.PDFName.of, d = s.dict, look = (o) => out.context.lookup(o);
  if (d.lookup(N('ImageMask')) !== L.PDFBool.True) {
    const cs = d.get(N('ColorSpace'));
    if (cs) pdfaUseCs(L, out, cs, res, rec);
    const bpc = d.lookup(N('BitsPerComponent')); if (bpc instanceof L.PDFNumber && bpc.asNumber() > 8) rec.bits16 = true;
  }
  if (pdfaFilters(L, s).includes('JPXDecode')) rec.jpx = true;
  if (look(d.get(N('SMask'))) instanceof L.PDFStream) rec.alpha.add('picture with see-through parts');
  const sid = d.lookup(N('SMaskInData')); if (sid instanceof L.PDFNumber && sid.asNumber() > 0) rec.alpha.add('picture with see-through parts');
}
// Scans a content stream (and what it draws: forms, patterns, shadings, pictures) into `rec`.
function pdfaScan(L, out, bytes, res, rec, seen, depth = 0) {
  if (!bytes || depth > 12) return;
  const { PDFDict, PDFStream, PDFName, PDFNumber } = L, N = PDFName.of, look = (o) => out.context.lookup(o);
  const sub = (kind, name) => { const d = res instanceof PDFDict ? res.lookup(N(kind)) : null; return d instanceof PDFDict ? look(d.get(N(name))) : null; };
  let toks; try { toks = tokenizeContent(pdfaLatin1(bytes)); } catch { return; }
  let ops = [], bi = null, font = null; const fontStack = [];
  // the strings each font shows (font dictionary -> Set of byte strings), for the Unicode checks
  const shown = (str) => { if (!(font instanceof PDFDict)) return; let set = rec.text.get(font); if (!set) rec.text.set(font, (set = new Set())); set.add(str); };
  const form = (s) => {
    if (!(s instanceof PDFStream) || seen.has(s)) return; seen.add(s);
    const g = s.dict.lookup(N('Group')); if (g instanceof PDFDict && pdfaName(L, g.get(N('S'))) === 'Transparency') rec.alpha.add('transparency group');
    const r = s.dict.lookup(N('Resources'));
    pdfaScan(L, out, pdfaStreamBytes(L, s), r instanceof PDFDict ? r : res, rec, seen, depth + 1);
  };
  const shading = (sh) => { if (!sh) return; const d = sh instanceof PDFStream ? sh.dict : sh; if (d instanceof PDFDict) pdfaUseCs(L, out, d.get(N('ColorSpace')), res, rec); };
  for (const t of toks) {
    if (bi) { if (t.t === 'op' && t.v === 'ID') { for (let i = 0; i + 1 < bi.length; i++) { const k = bi[i]; if (k.t !== 'name') continue; const v = bi[i + 1]; if ((k.v === 'CS' || k.v === 'ColorSpace') && v.t === 'name') pdfaUseCs(L, out, v.v, res, rec); if ((k.v === 'BPC' || k.v === 'BitsPerComponent') && v.t === 'num' && v.v > 8) rec.bits16 = true; } bi = null; } else bi.push(t); continue; }
    if (t.t !== 'op') { ops.push(t); continue; }
    const v = t.v, last = ops[ops.length - 1];
    if (v === 'BI') bi = [];
    else if (v === 'q') fontStack.push(font);
    else if (v === 'Q') { if (fontStack.length) font = fontStack.pop(); }
    else if (v === 'Tf') { const nm = ops.find((o) => o.t === 'name'); if (nm) font = sub('Font', nm.v); }
    else if (v === 'Tj' || v === "'" || v === '"' || v === 'TJ') { for (const o of ops) if (o.t === 'str') shown(o.v); }
    else if (v === 'rg' || v === 'RG') pdfaUseCs(L, out, 'DeviceRGB', res, rec);
    else if (v === 'k' || v === 'K') pdfaUseCs(L, out, 'DeviceCMYK', res, rec);
    else if (v === 'g' || v === 'G') pdfaUseCs(L, out, 'DeviceGray', res, rec);
    else if ((v === 'cs' || v === 'CS') && last && last.t === 'name') pdfaUseCs(L, out, last.v, res, rec);
    else if ((v === 'scn' || v === 'SCN') && last && last.t === 'name') {
      const pat = sub('Pattern', last.v); const pd = pat instanceof PDFStream ? pat.dict : pat;
      if (pd instanceof PDFDict) {
        const pt = pd.lookup(N('PatternType'));
        if (pt instanceof PDFNumber && pt.asNumber() === 2) { shading(look(pd.get(N('Shading')))); pdfaUseGs(L, look(pd.get(N('ExtGState'))), rec); }
        else if (pat instanceof PDFStream) form(pat);
      }
    } else if (v === 'sh' && last && last.t === 'name') shading(sub('Shading', last.v));
    else if (v === 'gs' && last && last.t === 'name') pdfaUseGs(L, sub('ExtGState', last.v), rec);
    else if (v === 'Do' && last && last.t === 'name') {
      const x = sub('XObject', last.v);
      if (x instanceof PDFStream) { const st = pdfaName(L, x.dict.get(N('Subtype'))); if (st === 'Image') pdfaUseImage(L, out, x, res, rec); else if (st === 'Form') form(x); }
    }
    ops = [];
  }
}
// What each page uses, its content and (separately) each annotation's appearance:
// { pages: [rec], annots: [{ page, a, sub, rec }] }
function pdfaInspect(L, out) {
  const { PDFDict, PDFArray, PDFStream, PDFName } = L, N = PDFName.of, look = (o) => out.context.lookup(o);
  const pages = [], annots = [];
  out.getPages().forEach((p, i) => {
    const rec = pdfaRec(), seen = new Set();
    let res = null; try { res = p.node.Resources(); } catch {}
    const g = p.node.lookup(N('Group')); if (g instanceof PDFDict && pdfaName(L, g.get(N('S'))) === 'Transparency') rec.alpha.add('transparency group');
    let c = null; try { c = p.node.Contents(); } catch {}
    const parts = c instanceof PDFArray ? c.asArray().map(look) : c ? [c] : [];
    const chunks = parts.filter((s) => s instanceof PDFStream).map((s) => pdfaStreamBytes(L, s)).filter(Boolean);
    if (chunks.length) { const all = new Uint8Array(chunks.reduce((t, b) => t + b.length + 1, 0)); let o = 0; for (const b of chunks) { all.set(b, o); o += b.length; all[o++] = 10; } pdfaScan(L, out, all, res, rec, seen); }
    pages.push(rec);
    const an = p.node.lookup(N('Annots'));
    if (an instanceof PDFArray) for (const r of an.asArray()) {
      const a = look(r); if (!(a instanceof PDFDict)) continue;
      const ar = pdfaRec(), sub = pdfaName(L, a.get(N('Subtype')));
      const ca = a.lookup(N('CA')); if (ca instanceof L.PDFNumber && ca.asNumber() < 1) ar.alpha.add('see-through comment');
      const ap = a.lookup(N('AP')), aseen = new Set();
      if (ap instanceof PDFDict) for (const k of ['N', 'R', 'D']) {
        const x = ap.lookup(N(k)); const list = x instanceof PDFStream ? [x] : x instanceof PDFDict ? [...x.entries()].map(([, v]) => look(v)) : [];
        for (const s of list) if (s instanceof PDFStream && !aseen.has(s)) { aseen.add(s); const gg = s.dict.lookup(N('Group')); if (gg instanceof PDFDict && pdfaName(L, gg.get(N('S'))) === 'Transparency') ar.alpha.add('transparency group'); const rr = s.dict.lookup(N('Resources')); pdfaScan(L, out, pdfaStreamBytes(L, s), rr instanceof PDFDict ? rr : null, ar, aseen); }
      }
      annots.push({ page: i + 1, a, ref: r, sub, rec: ar });
    }
  });
  return { pages, annots };
}
// JavaScript and the actions PDF/A and PDF/X don't allow: { js: count, actions: Set(names), auto: bool }
function pdfaScripts(L, out) {
  const N = L.PDFName.of, r = { js: 0, actions: new Set(), auto: false };
  const nm = out.catalog.lookup(N('Names')); if (nm instanceof L.PDFDict && nm.get(N('JavaScript'))) r.js++;
  for (const { obj } of pdfaReachable(L, out)) {
    const d = obj instanceof L.PDFStream ? obj.dict : obj;
    if (d.get(N('AA'))) r.auto = true;
    const s = pdfaName(L, d.get(N('S'))), type = pdfaName(L, d.get(N('Type')));
    if (s === 'JavaScript' && (!type || type === 'Action')) r.js++;
    else if (pdfaBadAction(L, d)) r.actions.add(s === 'Named' ? 'menu' : s);
  }
  r.any = !!(r.js || r.actions.size || r.auto);
  return r;
}
// "JavaScript (2 scripts), Launch actions, automatic actions"
function pdfaScriptsText(r) {
  const parts = [];
  if (r.js) parts.push(`JavaScript (${pdfaPlural(r.js, 'script')})`);
  for (const a of r.actions) parts.push(a === 'menu' ? 'menu actions' : `${a} actions`);
  if (r.auto) parts.push('actions that run by themselves');
  return parts.join(', ');
}
// What the kind can't take, in plain words: [{ code, page?, text }]. Nothing here is changed by the conversion.
const PDFA_A1_ANNOTS = new Set(['Text', 'Link', 'FreeText', 'Line', 'Square', 'Circle', 'Highlight', 'Underline', 'Squiggly', 'StrikeOut', 'Stamp', 'Ink', 'Popup', 'Widget', 'TrapNet', 'PrinterMark']);
const PDFA_REDRAWN = new Set(['Text', 'Square', 'Circle', 'Line', 'Ink', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly']);
function pdfaBlockers(L, out, P, seen = pdfaInspect(L, out)) {
  const N = L.PDFName.of, probs = [], once = new Set();
  const add = (code, page, text) => { if (once.has(code)) return; once.add(code); probs.push({ code, page, text }); };
  const nk = P.kind === 'X' ? 'PDF/X' : 'PDF/A';
  const better = { alpha: P.kind === 'X' ? 'PDF/X-4' : 'PDF/A-2b', old: P.kind === 'X' ? 'PDF/X-4' : 'PDF/A-2b' };
  seen.pages.forEach((r, i) => {
    const n = i + 1;
    if (P.kind === 'A' && P.intent === 'srgb' && r.CMYK) add('cmyk', n, `Page ${n} uses CMYK colours, which screen (sRGB) colours don't cover. Choose print colours (CMYK) instead.`);
    if (P.kind === 'A' && P.intent === 'cmyk' && r.RGB) add('rgb', n, `Page ${n} uses RGB colours, which print (CMYK) colours don't cover. Choose screen colours (sRGB) instead.`);
    if (P.kind === 'X' && P.rgb === 'no' && (r.RGB || r.icc.size || r.cie)) add('rgb', n, `Page ${n} uses RGB or calibrated colours. PDF/X-1a takes CMYK and grey only: use PDF/X-3 or PDF/X-4.`);
    if (!P.alpha && r.alpha.size) add('alpha', n, `Page ${n} has see-through objects (transparency: ${[...r.alpha][0]}). ${P.label} can't keep them: use ${better.alpha}.`);
    if (!P.bits16 && r.bits16) add('bits16', n, `Page ${n} has a picture with 16 bits per colour. ${P.label} takes 8 bits at most (it is based on PDF 1.4): use ${better.old}.`);
    if (!P.jpx && r.jpx) add('jpx', n, `Page ${n} has a JPEG 2000 picture, which ${P.label} doesn't allow: use ${better.old}.`);
    if (P.version <= 4 && r.iccV4) add('iccv4', n, `Page ${n} uses an ICC version 4 colour profile, which ${P.label} doesn't allow: use ${better.old}.`);
  });
  for (const x of seen.annots) {
    const r = x.rec, redraw = PDFA_REDRAWN.has(x.sub);
    if (P.kind === 'A' && P.part === 1 && !PDFA_A1_ANNOTS.has(x.sub) && !PDFA_BAD_ANNOTS.has(x.sub) && x.sub !== 'FileAttachment') add('annot-' + x.sub, x.page, `Page ${x.page} has a ${(CM_SUBTYPES_A[x.sub] || x.sub).toLowerCase()} comment, which PDF/A-1b can't keep: use PDF/A-2b.`);
    if (redraw) continue;
    if (!P.alpha && r.alpha.size) add('annot-alpha', x.page, `A comment on page ${x.page} is see-through. ${P.label} can't keep that: use ${better.alpha}.`);
    if ((P.kind === 'A' && P.intent === 'cmyk' || P.rgb === 'no') && (r.RGB || (P.kind === 'X' && (r.icc.size || r.cie)))) add('annot-rgb', x.page, `A comment on page ${x.page} is drawn in RGB colours, which ${P.kind === 'X' ? P.label : 'print (CMYK) colours'} can't take.`);
    if (P.kind === 'A' && P.intent === 'srgb' && r.CMYK) add('annot-cmyk', x.page, `A comment on page ${x.page} is drawn in CMYK colours, which screen (sRGB) colours don't cover.`);
  }
  const files = pdfaEmbeddedFiles(L, out);
  if (files.length && !P.files) add('files', null, P.kind === 'X' ? `${nk} files can't keep attachments (${files.map((f) => f.name).slice(0, 3).join(', ')}). Remove them first, or use PDF/A-3b.` : `PDF/A-1b can't keep attachments (${files.map((f) => f.name).slice(0, 3).join(', ')}): use PDF/A-3b.`);
  if (!P.layers && out.catalog.get(N('OCProperties'))) add('layers', null, `${P.label} can't keep layers (optional content): use ${better.old}.`);
  return probs;
}
const CM_SUBTYPES_A = { Polygon: 'Polygon', PolyLine: 'Polyline', Caret: 'Caret', Redact: 'Redaction', Watermark: 'Watermark', Screen: 'Screen' };

/* ----- appearances for annotations that have none ----- */
// o.cmyk: colours in CMYK (a simple conversion, for appearances only); o.opaque: no transparency (a highlight is then a
// bar under its text, so the words stay readable).
const pdfaToCmyk = (c) => { const k = 1 - Math.max(c[0], c[1], c[2]); return k >= 1 ? [0, 0, 0, 1] : [(1 - c[0] - k) / (1 - k), (1 - c[1] - k) / (1 - k), (1 - c[2] - k) / (1 - k), k]; };
function pdfaAppearance(L, out, a, o = {}) {
  const N = L.PDFName.of, sub = pdfaName(L, a.get(N('Subtype'))), rect = a.lookup(N('Rect'));
  const r = rect instanceof L.PDFArray ? rect.asArray().map((x) => (out.context.lookup(x) instanceof L.PDFNumber ? out.context.lookup(x).asNumber() : 0)) : [0, 0, 0, 0];
  const [x1, y1, x2, y2] = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  const nums = (k) => { const v = a.lookup(N(k)); return v instanceof L.PDFArray ? v.asArray().map((x) => { const n = out.context.lookup(x); return n instanceof L.PDFNumber ? n.asNumber() : 0; }) : null; };
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  const paint = (v, stroke) => (v && v.length === 3 ? (o.cmyk ? `${pdfaToCmyk(v).map(f).join(' ')} ${stroke ? 'K' : 'k'}` : `${v.map(f).join(' ')} ${stroke ? 'RG' : 'rg'}`) : v && v.length === 1 ? `${f(v[0])} ${stroke ? 'G' : 'g'}` : v && v.length === 4 ? `${v.map(f).join(' ')} ${stroke ? 'K' : 'k'}` : stroke ? '0 G' : '0 g');
  const c = nums('C'), col = (stroke) => paint(c, stroke);
  const bs = a.lookup(N('BS')), bw = bs instanceof L.PDFDict && bs.lookup(N('W')) instanceof L.PDFNumber ? bs.lookup(N('W')).asNumber() : 1;
  let ops = '';
  if (sub === 'Text') {
    const w = x2 - x1, h = y2 - y1, k = Math.min(w, h) / 20;
    ops = `q ${paint(c && c.length === 3 ? c : [1, 0.83, 0.23], false)} ${paint([0.35, 0.3, 0.1], true)} ${f(k)} w ${f(x1 + k)} ${f(y1 + 4 * k)} ${f(w - 2 * k)} ${f(h - 5 * k)} re B ${f(x1 + 4 * k)} ${f(y1 + 4 * k)} m ${f(x1 + 4 * k)} ${f(y1 + k)} l ${f(x1 + 8 * k)} ${f(y1 + 4 * k)} l f`;
    for (let i = 0; i < 3; i++) ops += ` ${f(x1 + 4 * k)} ${f(y2 - (5 + i * 4) * k)} m ${f(x2 - 4 * k)} ${f(y2 - (5 + i * 4) * k)} l S`;
    ops += ' Q';
  } else if (sub === 'Square' || sub === 'Circle') {
    const ic = nums('IC'), fill = ic && ic.length === 3 ? `${paint(ic, false)} ` : '';
    const ix = x1 + bw / 2, iy = y1 + bw / 2, iw = x2 - x1 - bw, ih = y2 - y1 - bw;
    if (sub === 'Square') ops = `q ${col(true)} ${fill}${f(bw)} w ${f(ix)} ${f(iy)} ${f(iw)} ${f(ih)} re ${fill ? 'B' : 'S'} Q`;
    else { const cx = ix + iw / 2, cy = iy + ih / 2, rx = iw / 2, ry = ih / 2, m = 0.5523; ops = `q ${col(true)} ${fill}${f(bw)} w ${f(cx + rx)} ${f(cy)} m ${f(cx + rx)} ${f(cy + ry * m)} ${f(cx + rx * m)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c ${f(cx - rx * m)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * m)} ${f(cx - rx)} ${f(cy)} c ${f(cx - rx)} ${f(cy - ry * m)} ${f(cx - rx * m)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c ${f(cx + rx * m)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * m)} ${f(cx + rx)} ${f(cy)} c ${fill ? 'B' : 'S'} Q`; }
  } else if (sub === 'Line') {
    const l = nums('L'); if (l && l.length === 4) ops = `q ${col(true)} ${f(bw)} w ${f(l[0])} ${f(l[1])} m ${f(l[2])} ${f(l[3])} l S Q`;
  } else if (sub === 'Ink') {
    const ink = a.lookup(N('InkList')); ops = `q ${col(true)} ${f(bw)} w 1 J 1 j`;
    if (ink instanceof L.PDFArray) for (const s of ink.asArray()) { const pts = out.context.lookup(s); if (!(pts instanceof L.PDFArray)) continue; const v = pts.asArray().map((x) => { const n = out.context.lookup(x); return n instanceof L.PDFNumber ? n.asNumber() : 0; }); for (let i = 0; i + 1 < v.length; i += 2) ops += ` ${f(v[i])} ${f(v[i + 1])} ${i ? 'l' : 'm'}`; ops += ' S'; }
    ops += ' Q';
  } else if (/^(Highlight|Underline|StrikeOut|Squiggly)$/.test(sub)) {
    const q = nums('QuadPoints') || [];
    ops = sub === 'Highlight' ? (o.opaque ? `q ${col(false)}` : `q /PdfaGs gs ${col(false)}`) : `q ${col(true)} 1 w`;
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      const lx = Math.min(...xs), hx = Math.max(...xs), ly = Math.min(...ys), hy = Math.max(...ys);
      if (sub === 'Highlight') ops += o.opaque ? ` ${f(lx)} ${f(ly)} ${f(hx - lx)} ${f(Math.max(1, (hy - ly) * 0.14))} re f` : ` ${f(lx)} ${f(ly)} ${f(hx - lx)} ${f(hy - ly)} re f`;
      else { const y = sub === 'StrikeOut' ? (ly + hy) / 2 : ly + (hy - ly) * 0.08; ops += ` ${f(lx)} ${f(y)} m ${f(hx)} ${f(y)} l S`; }
    }
    ops += ' Q';
  }
  const dict = { Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2], Resources: {} };
  if (sub === 'Highlight' && !o.opaque) dict.Resources = { ExtGState: { PdfaGs: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 0.4 } } };
  return out.context.register(out.context.flateStream(pdfaBytes(ops), dict));
}

/* ----- PDF/A-1: font subsets list the glyphs they hold ----- */
// Type 1 subsets: /CharSet from the glyph names in the font program; CID TrueType subsets: /CIDSet from the glyphs in
// the font (CIDToGIDMap Identity or a map). Returns true when one was added.
function pdfaT1Names(b, len1) {
  // the eexec part: decrypt (r = 55665), then the /CharStrings entries "/name len RD"
  let r = 55665; const n = b.length - len1; const plain = new Uint8Array(Math.max(0, n));
  let start = len1; while (start < b.length && /\s/.test(String.fromCharCode(b[start]))) start++;
  // a hexadecimal eexec section is decoded first
  let enc = b.subarray(start);
  if (enc.length > 4 && /^[0-9A-Fa-f]{4}$/.test(String.fromCharCode(...enc.subarray(0, 4)))) { const h = pdfaLatin1(enc).replace(/[^0-9A-Fa-f]/g, ''); enc = new Uint8Array(h.length >> 1); for (let i = 0; i < enc.length; i++) enc[i] = parseInt(h.substr(i * 2, 2), 16); }
  let k = 0; for (const c of enc) { plain[k++] = c ^ (r >> 8); r = ((c + r) * 52845 + 22719) & 0xFFFF; }
  const text = pdfaLatin1(plain.subarray(4, k)), at = text.indexOf('/CharStrings'); if (at < 0) return null;
  const names = new Set(), re = /\/([^\s\/\[\]{}()<>]+)\s+(\d+)\s+(RD|-\|)\s/g; re.lastIndex = at;
  let m; while ((m = re.exec(text))) { names.add(m[1]); re.lastIndex = m.index + m[0].length + +m[2]; }
  return names;
}
function pdfaSubsetLists(L, out, f) {
  const { PDFName, PDFDict, PDFArray, PDFStream, PDFNumber } = L, N = PDFName.of, look = (o) => out.context.lookup(o);
  const sub = pdfaName(L, f.get(N('Subtype')));
  if (sub === 'Type1' || sub === 'MMType1') {
    const fd = f.lookup(N('FontDescriptor')); if (!(fd instanceof PDFDict) || fd.get(N('CharSet'))) return false;
    const subset = /^[A-Z]{6}\+/.test(pdfaName(L, f.get(N('BaseFont'))) || ''); if (!subset) return false;
    const ff = fd.lookup(N('FontFile')); if (!(ff instanceof PDFStream)) return false;
    const b = pdfaStreamBytes(L, ff), l1 = ff.dict.lookup(N('Length1')); if (!b || !(l1 instanceof PDFNumber)) return false;
    const names = pdfaT1Names(b, l1.asNumber()); if (!names || !names.size) return false;
    fd.set(N('CharSet'), L.PDFString.of([...names].filter((x) => x !== '.notdef').map((x) => '/' + x).join('')));
    return true;
  }
  if (sub !== 'Type0') return false;
  const ds = f.lookup(N('DescendantFonts')), cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null;
  if (!(cid instanceof PDFDict) || pdfaName(L, cid.get(N('Subtype'))) !== 'CIDFontType2') return false;
  const fd = cid.lookup(N('FontDescriptor')); if (!(fd instanceof PDFDict) || fd.get(N('CIDSet'))) return false;
  const ff = fd.lookup(N('FontFile2')); if (!(ff instanceof PDFStream)) return false;
  // the glyph count, from the maxp table (font subsets made for CID fonts often have no cmap)
  const t = (() => { const b = pdfaStreamBytes(L, ff); if (!b || b.length < 12) return null; const v = new DataView(b.buffer, b.byteOffset, b.byteLength); for (let i = 0, n = v.getUint16(4); i < n && 12 + i * 16 + 16 <= b.length; i++) { const o = 12 + i * 16; if (String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]) === 'maxp') { const at = v.getUint32(o + 8); return at + 6 <= b.length ? { numGlyphs: v.getUint16(at + 4) } : null; } } return null; })();
  if (!t) return false;
  const map = cid.lookup(N('CIDToGIDMap')), present = [];
  if (map instanceof PDFStream) { const m = pdfaStreamBytes(L, map); if (!m) return false; for (let c = 0; c * 2 + 1 < m.length; c++) { const g = (m[c * 2] << 8) | m[c * 2 + 1]; if ((g || !c) && g < t.numGlyphs) present.push(c); } }
  else for (let g = 0; g < t.numGlyphs; g++) present.push(g);
  const max = present.length ? present[present.length - 1] : 0, bits = new Uint8Array((max >> 3) + 1);
  for (const c of present) bits[c >> 3] |= 0x80 >> (c & 7);
  fd.set(N('CIDSet'), out.context.register(out.context.flateStream(bits)));
  return true;
}

/* ----- the conversion ----- */
const pdfaFilters = (L, s) => { const f = s.dict.lookup(L.PDFName.of('Filter')); return f instanceof L.PDFName ? [f.decodeText()] : f instanceof L.PDFArray ? f.asArray().map((x) => pdfaName(L, s.dict.context.lookup(x)) || '') : []; };
const PDFA_DECODABLE = new Set(['FlateDecode', 'LZWDecode', 'ASCII85Decode', 'ASCIIHexDecode', 'RunLengthDecode']);
const PDFA_TRANSPARENT_BM = new Set(['Normal', 'Compatible']);
// Is the file a PDF/A file? (an attachment that may stay in a PDF/A-2 file)
const pdfaClaimsPdfa = (bytes) => { const s = pdfaLatin1(bytes.subarray(0, Math.min(bytes.length, 4 << 20))); return /^%PDF-/.test(s) && /pdfaid:part\s*(=\s*["']|>)\s*[123]/.test(s); };
// The embedded files: [{ spec (file specification dict), stream, name, where }]
function pdfaEmbeddedFiles(L, out) {
  const N = L.PDFName.of, list = [], seen = new Set();
  const add = (spec, where) => {
    if (!(spec instanceof L.PDFDict) || seen.has(spec)) return; seen.add(spec);
    const ef = spec.lookup(N('EF')); if (!(ef instanceof L.PDFDict)) return;
    const st = ef.lookup(N('F')) || ef.lookup(N('UF')); if (!(st instanceof L.PDFStream)) return;
    list.push({ spec, stream: st, name: pdfaText(L, spec, 'UF') || pdfaText(L, spec, 'F') || 'attachment', where });
  };
  const walkTree = (node, depth) => {
    if (!(node instanceof L.PDFDict) || depth > 20) return;
    const names = node.lookup(N('Names'));
    if (names instanceof L.PDFArray) for (let i = 1; i < names.size(); i += 2) add(names.lookup(i), 'doc');
    const kids = node.lookup(N('Kids')); if (kids instanceof L.PDFArray) for (const k of kids.asArray()) walkTree(out.context.lookup(k), depth + 1);
  };
  const nm = out.catalog.lookup(N('Names'));
  if (nm instanceof L.PDFDict) walkTree(nm.lookup(N('EmbeddedFiles')), 0);
  out.getPages().forEach((p, i) => { const an = p.node.lookup(N('Annots')); if (an instanceof L.PDFArray) for (const r of an.asArray()) { const a = out.context.lookup(r); if (a instanceof L.PDFDict && pdfaName(L, a.get(N('Subtype'))) === 'FileAttachment') add(a.lookup(N('FS')), i + 1); } });
  return list;
}
const PDFA_MIME = { pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', xml: 'application/xml', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', html: 'text/html', htm: 'text/html', zip: 'application/zip', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', doc: 'application/msword', xls: 'application/vnd.ms-excel', md: 'text/markdown', rtf: 'application/rtf', svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav', tif: 'image/tiff', tiff: 'image/tiff' };

async function pdfaConvert(bytes, opts = {}) {
  const P = pdfaProfile(opts), part = P.part || 0, conformance = P.conformance || 'B', isX = P.kind === 'X';
  const L = await loadPdfLib(), { PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFNumber, PDFRef, PDFHexString, PDFString } = L, N = PDFName.of;
  const out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (out.isEncrypted) { const e = new Error(`${isX ? 'PDF/X' : 'PDF/A'} files can't have a password. Remove it to continue.`); e.code = 'encrypted'; throw e; }
  const ctx = out.context, look = (o) => ctx.lookup(o), fixes = new Set(), fix = (t) => fixes.add(t);
  const cat = out.catalog, pages = out.getPages();
  // Attachments: PDF/A-2 takes only PDF/A attachments; PDF/A-3 takes any, described (AFRelationship, MIME type).
  const files = pdfaEmbeddedFiles(L, out);
  if (P.files === 'pdfa') {
    const bad = files.filter((f) => { const b = pdfaStreamBytes(L, f.stream); return !b || !pdfaClaimsPdfa(b); });
    if (bad.length) return { blocked: 'attachments', names: bad.map((f) => f.name), fixes: [] };
  }
  // Scripts: removed, or (scripts: 'refuse') reported so the person can choose.
  if (opts.scripts === 'refuse') { const sc = pdfaScripts(L, out); if (sc.any) return { blocked: 'scripts', scripts: { js: sc.js, actions: [...sc.actions], auto: sc.auto }, text: pdfaScriptsText(sc), fixes: [] }; }
  // What can't be made to conform without changing how pages look: refused, with the reasons.
  const seen = pdfaInspect(L, out);
  const problems = pdfaBlockers(L, out, P, seen);
  if (problems.length) return { blocked: 'profile', problems, label: P.label, fixes: [] };
  if (P.files === 'any' && files.length) {
    let af = cat.lookup(N('AF')); if (!(af instanceof PDFArray)) { af = ctx.obj([]); cat.set(N('AF'), af); }
    const inAf = new Set(af.asArray().map((x) => look(x)));
    for (const f of files) {
      if (!f.spec.get(N('AFRelationship'))) f.spec.set(N('AFRelationship'), N('Unspecified'));
      if (!f.spec.get(N('F'))) f.spec.set(N('F'), PDFString.of(f.name.replace(/[^\x20-\x7e]/g, '_')));
      if (!f.spec.get(N('UF'))) f.spec.set(N('UF'), PDFHexString.fromText(f.name));
      if (!f.stream.dict.get(N('Subtype'))) f.stream.dict.set(N('Subtype'), N(PDFA_MIME[(f.name.split('.').pop() || '').toLowerCase()] || 'application/octet-stream'));
      let pm = f.stream.dict.lookup(N('Params')); if (!(pm instanceof PDFDict)) { pm = ctx.obj({}); f.stream.dict.set(N('Params'), pm); }
      if (!pm.get(N('ModDate'))) pm.set(N('ModDate'), PDFString.fromDate(new Date()));
      if (f.where === 'doc' && !inAf.has(f.spec)) { let ref = null; for (const [r, o] of ctx.enumerateIndirectObjects()) if (o === f.spec) { ref = r; break; } af.push(ref || f.spec); }
    }
    fix('Described the attachments for PDF/A-3');
  }
  // Scripts and actions PDF/A and PDF/X don't allow; additional actions anywhere.
  const names = cat.lookup(N('Names'));
  if (names instanceof PDFDict) {
    if (names.get(N('JavaScript'))) { names.delete(N('JavaScript')); fix('Removed JavaScript'); }
    if (names.get(N('AlternatePresentations'))) { names.delete(N('AlternatePresentations')); fix('Removed slide shows (alternate presentations)'); }
  }
  for (const { obj } of pdfaReachable(L, out)) {
    const d = obj instanceof PDFStream ? obj.dict : obj;
    for (const [k, v] of [...d.entries()]) {
      const key = k.decodeText();
      if (key === 'AA') { d.delete(k); fix('Removed automatic actions'); continue; }
      const r = look(v);
      if (r instanceof PDFDict && pdfaBadAction(L, r) && key !== 'Parent' && key !== 'P') {
        const s = pdfaName(L, r.get(N('S')));
        // a chain of actions (/Next): keep what follows a forbidden one
        const next = r.lookup(N('Next'));
        if ((key === 'A' || key === 'OpenAction' || key === 'Next') && next instanceof PDFDict && !pdfaBadAction(L, next)) d.set(k, r.get(N('Next'))); else d.delete(k);
        fix(s === 'JavaScript' ? 'Removed JavaScript' : `Removed ${s} actions`);
      } else if (r instanceof PDFArray && key === 'Next') {
        for (let i = r.size() - 1; i >= 0; i--) if (pdfaBadAction(L, look(r.get(i)))) { r.remove(i); fix('Removed actions PDF/A doesn\'t allow'); }
      }
    }
    if (obj instanceof PDFStream) {
      // external data, LZW
      for (const k of ['F', 'FFilter', 'FDecodeParms']) if (obj.dict.get(N(k))) { obj.dict.delete(N(k)); fix('Removed links to data outside the file'); }
      const fl = pdfaFilters(L, obj);
      if (fl.includes('LZWDecode') && obj instanceof PDFRawStream) {
        const last = fl.lastIndexOf('LZWDecode');
        if (fl.slice(0, last + 1).every((x) => PDFA_DECODABLE.has(x))) {
          const dp = obj.dict.lookup(N('DecodeParms')), dps = dp instanceof PDFArray ? dp.asArray().map(look) : fl.map(() => dp);
          const tmp = ctx.obj({ Filter: fl.slice(0, last + 1) }); if (dp) tmp.set(N('DecodeParms'), ctx.obj(dps.slice(0, last + 1).map((x) => x || null)));
          try {
            const raw = L.decodePDFRawStream({ dict: tmp, contents: obj.contents }).decode();
            const lzwParms = dps[last] instanceof PDFDict ? dps[last] : null;
            const rest = fl.slice(last + 1), restParms = dps.slice(last + 1);
            const z = ctx.flateStream(raw).contents;
            obj.updateContents(z);
            const newParms = [lzwParms ? (() => { const c = lzwParms.clone(ctx); c.delete(N('EarlyChange')); return c; })() : null, ...restParms];
            obj.dict.set(N('Filter'), rest.length ? ctx.obj(['FlateDecode', ...rest]) : N('FlateDecode'));
            if (newParms.some(Boolean)) obj.dict.set(N('DecodeParms'), rest.length ? ctx.obj(newParms.map((x) => x || null)) : newParms[0]); else obj.dict.delete(N('DecodeParms'));
            fix('Re-packed LZW data as Flate');
          } catch {}
        }
      }
      const st = pdfaName(L, obj.dict.get(N('Subtype')));
      if (st === 'Image') {
        if (obj.dict.lookup(N('Interpolate')) === L.PDFBool.True) { obj.dict.set(N('Interpolate'), L.PDFBool.False); fix('Turned off image smoothing flags'); }
        for (const k of ['Alternates', 'OPI']) if (obj.dict.get(N(k))) obj.dict.delete(N(k));
      } else if (st === 'Form') { for (const k of ['OPI', 'Ref', 'PS']) if (obj.dict.get(N(k))) obj.dict.delete(N(k)); if (pdfaName(L, obj.dict.get(N('Subtype2'))) === 'PS') obj.dict.delete(N('Subtype2')); }
    } else {
      // graphics states: no transfer functions or halftone origins, a known rendering intent
      if (d.get(N('TR'))) { d.delete(N('TR')); fix('Removed transfer functions'); }
      const tr2 = d.get(N('TR2')); if (tr2 && pdfaName(L, tr2) !== 'Default') { d.set(N('TR2'), N('Default')); fix('Removed transfer functions'); }
      if (d.get(N('HTP'))) d.delete(N('HTP'));
      const ri = d.get(N('RI')); if (ri && !/^(RelativeColorimetric|AbsoluteColorimetric|Perceptual|Saturation)$/.test(pdfaName(L, ri) || '')) d.set(N('RI'), N('RelativeColorimetric'));
      if (d.get(N('PresSteps'))) d.delete(N('PresSteps'));
    }
  }
  // Forms: no XFA, appearances drawn (not left to the reader).
  const acro = cat.lookup(N('AcroForm'));
  if (acro instanceof PDFDict) {
    if (acro.get(N('XFA'))) { acro.delete(N('XFA')); fix('Removed the XFA form (the PDF form stays)'); }
    // (pdf-lib writes the font it draws them with on flush: then it is there to be replaced below)
    if (acro.lookup(N('NeedAppearances')) === L.PDFBool.True) { try { out.getForm().updateFieldAppearances(); if (out.flush) await out.flush(); } catch {} fix('Drew the form fields'); }
    acro.delete(N('NeedAppearances'));
  }
  // Annotations. The appearances to draw again: none yet, or see-through / RGB where the kind doesn't allow it.
  const recOf = new Map(seen.annots.map((x) => [x.a, x.rec]));
  const noRgb = P.rgb === 'no';
  const mustRedraw = (a, sub) => {
    const r = recOf.get(a); if (!r || !PDFA_REDRAWN.has(sub)) return false;
    return (!P.alpha && r.alpha.size > 0) || (noRgb && (r.RGB || (isX && (r.icc.size > 0 || r.cie))));
  };
  const trimOf = (p) => { const b = p.node.lookup(N('TrimBox')) || p.node.lookup(N('ArtBox')) || p.node.lookup(N('CropBox')) || p.node.lookup(N('MediaBox')); return b instanceof PDFArray ? b.asArray().map((x) => look(x).asNumber()) : [0, 0, 612, 792]; };
  pages.forEach((p, i) => {
    const an = p.node.lookup(N('Annots')); if (!(an instanceof PDFArray)) return;
    const bleed = isX ? (() => { const b = p.node.lookup(N('BleedBox')); return b instanceof PDFArray ? b.asArray().map((x) => look(x).asNumber()) : trimOf(p); })() : null;
    for (let k = an.size() - 1; k >= 0; k--) {
      const a = look(an.get(k)); if (!(a instanceof PDFDict)) continue;
      const sub = pdfaName(L, a.get(N('Subtype')));
      if (PDFA_BAD_ANNOTS.has(sub) || !PDFA_KNOWN_ANNOTS.has(sub)) { an.remove(k); fix(`Removed ${sub === '3D' ? '3D' : 'media'} content ${isX ? 'PDF/X' : 'PDF/A'} can't keep`); continue; }
      let fl = pdfaFlag(L, a);
      if (!isX) {
        if (sub !== 'Widget' && sub !== 'Popup' && fl & (1 | 2 | 32)) { an.remove(k); fix('Removed hidden comments'); continue; }
        const nf = ((fl | 4) & ~(1 | 2 | 32 | 256)) | (sub === 'Text' ? 8 | 16 : 0); // a note's icon doesn't zoom or turn
        if (nf !== fl) { a.set(N('F'), PDFNumber.of(nf)); fix('Set comments and fields to print'); }
      } else if (sub !== 'TrapNet' && sub !== 'PrinterMark' && fl & 4) {
        // PDF/X: what prints is the page; comments and links inside the printed area are kept, set not to print.
        const r = a.lookup(N('Rect')), v = r instanceof PDFArray ? r.asArray().map((x) => look(x).asNumber()) : null;
        if (!v || !(Math.max(v[0], v[2]) < bleed[0] || Math.min(v[0], v[2]) > bleed[2] || Math.max(v[1], v[3]) < bleed[1] || Math.min(v[1], v[3]) > bleed[3])) { a.set(N('F'), PDFNumber.of(fl & ~4)); fix('Kept comments, set not to print (PDF/X prints the page only)'); }
      }
      if (!P.alpha) { const ca = a.lookup(N('CA')); if (ca instanceof PDFNumber && ca.asNumber() < 1) { a.delete(N('CA')); fix('Made see-through comments solid'); } for (const kk of ['BM', 'ca']) if (a.get(N(kk))) a.delete(N(kk)); }
      if (P.kind === 'A' && part === 1 && P.intent === 'cmyk' && (a.get(N('C')) || a.get(N('IC')))) { a.delete(N('C')); a.delete(N('IC')); fix('Took out comment colour hints (PDF/A-1 with CMYK colours)'); }
      let ap = a.lookup(N('AP'));
      const nApp = ap instanceof PDFDict ? ap.get(N('N')) : null;
      const redraw = nApp && mustRedraw(a, sub);
      if (!(ap instanceof PDFDict) || !nApp || redraw) {
        if (sub === 'Popup' && !(ap instanceof PDFDict)) continue; // a popup needs no appearance
        const ref = pdfaAppearance(L, out, a, { cmyk: noRgb || (P.kind === 'A' && P.intent === 'cmyk'), opaque: !P.alpha });
        if (!(ap instanceof PDFDict)) { ap = ctx.obj({}); a.set(N('AP'), ap); }
        ap.set(N('N'), ref); fix(redraw ? (P.alpha ? 'Drew comments again in CMYK' : `Drew comments again without transparency (${P.label} doesn't allow it)`) : 'Drew comments that had no appearance');
      }
      if (ap instanceof PDFDict) for (const x of ['R', 'D']) if (ap.get(N(x))) ap.delete(N(x));
    }
  });
  // Optional content: every configuration named, no automatic state changes.
  const ocp = cat.lookup(N('OCProperties'));
  if (ocp instanceof PDFDict) {
    const cfgs = [ocp.lookup(N('D'))]; const more = ocp.lookup(N('Configs')); if (more instanceof PDFArray) cfgs.push(...more.asArray().map(look));
    cfgs.forEach((c, i) => { if (!(c instanceof PDFDict)) return; if (!c.get(N('Name'))) c.set(N('Name'), PDFHexString.fromText(i ? `Layers ${i}` : 'Layers')); if (c.get(N('AS'))) c.delete(N('AS')); });
  }
  // Transparency (where allowed): pages that use it get a transparency group in the output intent's colour space.
  const blendCs = P.intent === 'cmyk' ? 'DeviceCMYK' : 'DeviceRGB';
  if (P.alpha) {
    pages.forEach((p, i) => {
      const t = seen.pages[i].alpha.size > 0 || seen.annots.some((x) => x.page === i + 1 && x.rec.alpha.size > 0 && !mustRedraw(x.a, x.sub));
      const g = p.node.lookup(N('Group'));
      if (g instanceof PDFDict) { if (!g.get(N('CS'))) { g.set(N('CS'), N(blendCs)); fix('Gave transparent pages a colour space'); } }
      else if (t) { p.node.set(N('Group'), ctx.obj({ Type: 'Group', S: 'Transparency', CS: blendCs })); fix('Gave transparent pages a colour space'); }
    });
  }
  // PDF/X-3 and X-4: device RGB colours are defined as sRGB (DefaultRGB), wherever content draws with them.
  if (isX && P.rgb === 'default' && (seen.pages.some((r) => r.RGB) || seen.annots.some((x) => x.rec.RGB))) {
    const srgb = ctx.obj([N('ICCBased'), pdfaIccRef(L, out, 'srgb')]), done = new Set();
    const addDefault = (holder, key = 'Resources') => {
      let res = holder.lookup(N(key)); if (!(res instanceof PDFDict)) { res = ctx.obj({}); holder.set(N(key), res); }
      if (done.has(res)) return res; done.add(res);
      let cs = res.lookup(N('ColorSpace')); if (!(cs instanceof PDFDict)) { cs = ctx.obj({}); res.set(N('ColorSpace'), cs); }
      if (!cs.get(N('DefaultRGB'))) cs.set(N('DefaultRGB'), srgb);
      const xo = res.lookup(N('XObject'));
      if (xo instanceof PDFDict) for (const [, v] of xo.entries()) { const s = look(v); if (s instanceof PDFStream && pdfaName(L, s.dict.get(N('Subtype'))) === 'Form' && s.dict.get(N('Resources'))) addDefault(s.dict); }
      const pat = res.lookup(N('Pattern'));
      if (pat instanceof PDFDict) for (const [, v] of pat.entries()) { const s = look(v); if (s instanceof PDFStream && s.dict.get(N('Resources'))) addDefault(s.dict); }
      return res;
    };
    for (const p of pages) { let res = null; try { res = p.node.Resources(); } catch {} if (res && !p.node.get(N('Resources'))) p.node.set(N('Resources'), res); addDefault(p.node); }
    for (const x of seen.annots) { const ap = x.a.lookup(N('AP')); if (!(ap instanceof PDFDict)) continue; for (const k of ['N', 'R', 'D']) { const s = ap.lookup(N(k)); const list = s instanceof PDFStream ? [s] : s instanceof PDFDict ? [...s.entries()].map(([, v]) => look(v)) : []; for (const st of list) if (st instanceof PDFStream) addDefault(st.dict); } }
    fix('Defined RGB colours as sRGB');
  }
  // Fonts: every font embedded. Ones that weren't get a metric-compatible stand-in, keeping their resource names.
  const fonts = pdfaPageFonts(L, out);
  const acroDr = acro instanceof PDFDict ? acro.lookup(N('DR')) : null, drFonts = acroDr instanceof PDFDict ? acroDr.lookup(N('Font')) : null;
  if (drFonts instanceof PDFDict) for (const [k, v] of drFonts.entries()) { const f = look(v); if (f instanceof PDFDict && !fonts.has(f)) fonts.set(f, { page: 0, key: k.decodeText(), dr: true }); }
  const descriptors = new Map();
  const embedded = (f) => {
    const sub = pdfaName(L, f.get(N('Subtype')));
    if (sub === 'Type3') return true;
    let fd = f.lookup(N('FontDescriptor'));
    if (sub === 'Type0') { const ds = f.lookup(N('DescendantFonts')); const cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null; fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null; }
    return fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.get(N(k)));
  };
  const unicodeFix = P.kind === 'A' && conformance === 'U';
  const shownText = unicodeFix ? pdfaShownText(seen) : new Map();
  for (const [f] of fonts) {
    const sub = pdfaName(L, f.get(N('Subtype')));
    if (embedded(f)) {
      // PDF/A-2u, 3u: CID fonts get a mapping for every glyph shown that has none, from the font program.
      if (unicodeFix && sub === 'Type0' && pdfaCidUnicode(L, out, f, shownText.get(f)) === 'fixed') fix('Added text mappings (ToUnicode) to fonts');
      // PDF/A-2u, 3u: simple fonts get a ToUnicode map from their encoding when every code can be named.
      if (unicodeFix && sub !== 'Type0' && sub !== 'Type3' && !f.get(N('ToUnicode'))) {
        const { uni, unknown } = pdfaFontUnicodes(L, f);
        if (!unknown.length && f.get(N('Encoding'))) { f.set(N('ToUnicode'), ctx.register(ctx.flateStream(pdfaBytes(pdfaToUnicodeCMap(uni))))); fix('Added text mappings (ToUnicode) to fonts'); }
      }
      // PDF/A-1: font subsets list what they hold (CharSet for Type 1, CIDSet for CID fonts).
      if (P.kind === 'A' && part === 1 && pdfaSubsetLists(L, out, f)) fix('Listed the glyphs of font subsets (PDF/A-1)');
      continue;
    }
    if (sub === 'Type0' || !/^(Type1|MMType1|TrueType)$/.test(sub || '')) continue; // reported by the check
    const pick = pdfaSubstitute(L, f); if (!pick) continue;
    const [fam, style] = pick;
    const { uni, named } = pdfaFontUnicodes(L, f);
    // One program and descriptor per family, style and encoding: fonts that read codes differently never share one.
    const key = fam + style + ':' + (named ? f.lookup(N('Encoding')).decodeText() : uni.map((u) => (u == null ? '' : u.toString(36))).join(','));
    let ttf; try { ttf = await pdfaFontFile(fam, style); } catch (e) { console.warn('PDF/A: could not load a font', e); continue; }
    const psName = PDFA_FAMILY_NAME[fam] + ['-Regular', '-Bold', '-Italic', '-BoldItalic'][style];
    const was = (pdfaName(L, f.get(N('BaseFont'))) || '').replace(/^[A-Z]{6}\+/, '');
    const differs = !named && uni.some((u, c) => u != null && u !== PDFA_ENC.WinAnsiEncoding[c]);
    // PDF/A-1 (6.3.7) lets a non-symbolic TrueType font name only WinAnsi or MacRoman, with no Differences. A font
    // whose codes mean other characters (a form's PDFDocEncoding, say) becomes a symbolic font instead: no
    // Encoding, and a font program whose (3,0) cmap maps each code to its glyph.
    const symbolic = differs && P.kind === 'A' && part === 1;
    if (!descriptors.has(key)) {
      const prog = symbolic ? pdfaTtfSubset(ttf, null, uni) : pdfaTtfSubset(ttf, PDFA_LATIN);
      const program = ctx.register(ctx.flateStream(prog, { Length1: prog.length }));
      const tag = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
      const k = 1000 / ttf.upem, flags = (symbolic ? 4 : 32) | (fam === 'tinos' ? 2 : 0) | (fam === 'cousine' ? 1 : 0) | (style & 2 ? 64 : 0) | (style & 1 ? 0x40000 : 0);
      const name = `${tag}+${psName}`;
      descriptors.set(key, { name, symbolic, ref: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: name, Flags: flags, FontBBox: ttf.bbox.map((x) => Math.round(x * k)), ItalicAngle: ttf.italicAngle, Ascent: Math.round(ttf.ascent * k), Descent: Math.round(ttf.descent * k), CapHeight: Math.round(ttf.capHeight * k), XHeight: Math.round(ttf.xHeight * k), StemV: style & 1 ? 140 : 80, FontFile2: program })) });
    }
    const desc = descriptors.get(key);
    if (symbolic) {
      f.delete(N('Encoding'));
    } else if (!named) {
      // Encoding: WinAnsi plus the codes that differ from it, named from the Adobe Glyph List.
      const diffs = []; let last = -2;
      uni.forEach((u, c) => { if (u == null || u === PDFA_ENC.WinAnsiEncoding[c]) return; if (c !== last + 1) diffs.push(c); diffs.push(N(pdfaUnicodeToName(u))); last = c; });
      f.set(N('Encoding'), diffs.length ? ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: diffs.map((x) => (typeof x === 'number' ? PDFNumber.of(x) : x)) }) : N('WinAnsiEncoding'));
    }
    const enc = named || desc.symbolic ? uni : uni.map((u, c) => (u == null ? PDFA_ENC.WinAnsiEncoding[c] : u));
    let first = enc.findIndex((u) => u != null); if (first < 0) first = 32;
    let lastC = 255; while (lastC > first && enc[lastC] == null) lastC--;
    const widths = []; for (let c = first; c <= lastC; c++) widths.push(Math.round(ttf.adv(enc[c] == null ? 0 : ttf.gid(enc[c])) * 1000 / ttf.upem));
    f.set(N('Subtype'), N('TrueType')); f.set(N('BaseFont'), N(desc.name)); f.set(N('FirstChar'), PDFNumber.of(first)); f.set(N('LastChar'), PDFNumber.of(lastC));
    f.set(N('Widths'), ctx.obj(widths)); f.set(N('FontDescriptor'), desc.ref);
    if (!f.get(N('ToUnicode'))) f.set(N('ToUnicode'), ctx.register(ctx.flateStream(pdfaBytes(pdfaToUnicodeCMap(enc)))));
    fix(`Embedded ${psName.replace(/-Regular$/, '')} in place of ${was || 'a font that was not embedded'}`);
  }
  // Embedded programs shared by font dictionaries with different encodings: each encoding gets its own copy of the
  // program and descriptor, so every font's widths can be checked against the program it reads.
  for (const { program, key: ffKey, groups } of pdfaSharedPrograms(L, fonts)) {
    for (const group of groups.slice(1)) {
      const copy = ctx.register(program.clone(ctx)), fdCopies = new Map();
      for (const [f] of group) {
        const fd = f.lookup(N('FontDescriptor'));
        if (!fdCopies.has(fd)) { const c = fd.clone(ctx); c.set(N(ffKey), copy); fdCopies.set(fd, ctx.register(c)); }
        f.set(N('FontDescriptor'), fdCopies.get(fd));
      }
    }
    fix('Gave each font that reads a shared font program in its own way a copy of it');
  }
  // PDF/X: the page's trimmed size is given (TrimBox), inside the bleed and the media box.
  if (isX) {
    for (const p of pages) {
      const box = (k) => { const b = p.node.lookup(N(k)); return b instanceof PDFArray && b.size() === 4 ? b.asArray().map((x) => look(x).asNumber()) : null; };
      const norm = (b) => [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])];
      const clip = (b, o) => [Math.max(b[0], o[0]), Math.max(b[1], o[1]), Math.min(b[2], o[2]), Math.min(b[3], o[3])];
      const media = norm(box('MediaBox') || [0, 0, 612, 792]);
      let bleed = box('BleedBox'); if (bleed) { const c = clip(norm(bleed), media); if (c.join() !== norm(bleed).join()) { p.node.set(N('BleedBox'), ctx.obj(c)); fix('Kept the bleed inside the page'); } bleed = c; }
      if (!box('TrimBox') && !box('ArtBox')) { const t = clip(norm(box('CropBox') || media), bleed || media); p.node.set(N('TrimBox'), ctx.obj(t)); fix('Gave each page its trimmed size (TrimBox)'); }
      else if (box('TrimBox')) { const t0 = norm(box('TrimBox')), t = clip(t0, bleed || media); if (t.join() !== t0.join()) { p.node.set(N('TrimBox'), ctx.obj(t)); fix('Kept the trimmed size inside the page'); } }
    }
  }
  // Identity, output intent, metadata.
  out.context.header = L.PDFHeader.forVersion(1, P.version);
  if (!(look(ctx.trailerInfo.ID) instanceof PDFArray)) { const id = PDFHexString.of(Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')); ctx.trailerInfo.ID = ctx.obj([id, id]); }
  const S = isX ? 'GTS_PDFX' : 'GTS_PDFA1';
  // Other output intents stay only when they name no profile: PDF/A wants every profile given to be the same one.
  const intents = cat.lookup(N('OutputIntents')), keep = intents instanceof PDFArray ? intents.asArray().filter((x) => { const o = look(x); return o instanceof PDFDict && pdfaName(L, o.get(N('S'))) !== S && !o.get(N('DestOutputProfile')); }) : [];
  const oi = P.intent === 'cmyk'
    ? { Type: 'OutputIntent', S, OutputConditionIdentifier: PDFString.of(PDFA_CMYK_COND.id), OutputCondition: PDFString.of(PDFA_CMYK_COND.info), RegistryName: PDFString.of(PDFA_CMYK_COND.registry), Info: PDFString.of(PDFA_CMYK_COND.info), DestOutputProfile: pdfaIccRef(L, out, 'cmyk') }
    : { Type: 'OutputIntent', S, OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: pdfaIccRef(L, out, 'srgb') };
  cat.set(N('OutputIntents'), ctx.obj([ctx.register(ctx.obj(oi)), ...keep]));
  const info = out.getInfoDict();
  for (const k of ['CreationDate', 'ModDate']) { const v = pdfaText(L, info, k), d = v ? pdfaParseDate(v) : null; if (d) info.set(N(k), PDFString.fromDate(d)); else if (v != null) info.delete(N(k)); }
  if (!pdfaText(L, info, 'ModDate')) info.set(N('ModDate'), PDFString.fromDate(new Date()));
  if (!pdfaText(L, info, 'CreationDate')) info.set(N('CreationDate'), PDFString.fromDate(new Date()));
  for (const [k, v] of [...info.entries()]) if (!(look(v) instanceof PDFString || look(v) instanceof PDFHexString || look(v) instanceof PDFName)) info.delete(k);
  const xmpBefore = pdfaReadXmp(pdfaXmpOf(L, out));
  if (isX) {
    // PDF/X: the version in the Info dictionary (and the XMP), trapping stated, a title.
    info.set(N('GTS_PDFXVersion'), PDFString.of(P.gts));
    if (info.get(N('GTS_PDFXConformance'))) info.delete(N('GTS_PDFXConformance'));
    const tr = pdfaText(L, info, 'Trapped'); if (tr !== 'True' && tr !== 'False') { info.set(N('Trapped'), N('False')); fix('Said the file is not trapped'); }
    if (!pdfaText(L, info, 'Title')) info.set(N('Title'), PDFHexString.fromText(opts.name || 'Untitled'));
    const props = [{ ns: 'http://ns.adobe.com/pdfx/1.3/', prefix: 'pdfx', name: 'GTS_PDFXVersion', value: P.gts }];
    if (P.pdfx === '4') props.push({ ns: 'http://www.npes.org/pdfx/ns/id/', prefix: 'pdfxid', name: 'GTS_PDFXVersion', value: P.gts });
    pdfaWriteXmp(L, out, { props: [...props, ...(opts.props || [])], dropNs: [PDFA_NS.pdfaid, ...props.map((x) => x.ns)], version: P.pdfx === '4' });
  } else {
    pdfaWriteXmp(L, out, { pdfa: { part, conformance }, pdfua: part >= 2 && xmpBefore.props['pdfuaid:part'] ? { part: xmpBefore.props['pdfuaid:part'] } : null, extensions: opts.extensions, props: opts.props });
    if (xmpBefore.foreign.some((x, k) => !PDFA_PREDEFINED.has(xmpBefore.foreignNs[k]))) fix('Removed metadata PDF/A doesn\'t know');
  }
  if (cat.get(N('Perms'))) { const pm = cat.lookup(N('Perms')); if (pm instanceof PDFDict) for (const k of pm.keys()) if (!/^(DocMDP|UR3)$/.test(k.decodeText())) pm.delete(k); }
  if (cat.get(N('Requirements'))) cat.delete(N('Requirements'));
  // What nothing refers to any more (a removed script, an old font) is not written.
  const live = pdfaReachable(L, out).refs;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!live.has(ref.tag)) ctx.delete(ref);
  // PDF 1.4 kinds: no object streams (a PDF 1.5 feature).
  return { bytes: await out.save({ useObjectStreams: P.objStreams }), fixes: [...fixes], label: P.label };
}
// The same file, no longer claiming to be PDF/A (Save anyway).
async function pdfaDropClaim(bytes) {
  const L = await loadPdfLib(), out = await L.PDFDocument.load(bytes, { updateMetadata: false });
  pdfaWriteXmp(L, out, {});
  return out.save({ useObjectStreams: true });
}

/* ----- the built-in check ----- */
function pdfaIccInfo(b) {
  if (!b || b.length < 132) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), s = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  return { size: v.getUint32(0), version: b[8], cls: s(12), space: s(16), pcs: s(20), magic: s(36), tags: v.getUint32(128) };
}
async function pdfaCheck(bytes, opts) {
  const L = await loadPdfLib(), { PDFName, PDFDict, PDFArray, PDFStream, PDFNumber } = L, N = PDFName.of;
  const problems = [], passed = [], ruleNames = [];
  let failedRule = null;
  const rule = (id, fn) => { ruleNames.push(id); const before = problems.length; failedRule = id; try { fn(); } catch (e) { problems.push({ rule: id, severity: 'error', fix: 'manual', text: `Could not check: ${e.message || e}` }); } if (problems.length === before) passed.push(id); };
  const bad = (text, o = {}) => problems.push({ rule: failedRule, severity: o.severity || 'error', ...(o.page ? { page: o.page } : {}), fix: o.fix || 'auto', text });
  const head = pdfaLatin1(bytes.subarray(0, 64));
  let out;
  try { out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); }
  catch (e) { const r = [{ rule: 'parse', severity: 'error', fix: 'manual', text: `The file could not be read: ${e.message || e}` }]; r.passed = []; r.checks = 1; return r; }
  const ctx = out.context, look = (o) => ctx.lookup(o), cat = out.catalog;
  const xmpText = pdfaXmpOf(L, out), xmp = pdfaReadXmp(xmpText);
  const part = +((opts && opts.part) || xmp.props['pdfaid:part'] || 2), conf = String((opts && opts.conformance) || xmp.props['pdfaid:conformance'] || 'B').toUpperCase();
  rule('header', () => { if (!/^%PDF-1\.[0-7]/.test(head)) bad('The file header is not %PDF-1.0 to %PDF-1.7.', { fix: 'auto' }); });
  rule('binary-comment', () => { const m = /^%PDF-\d\.\d\r?\n?%([^\r\n]{4})/.exec(head); if (!m || [...m[1]].some((c) => c.charCodeAt(0) < 128)) bad('The header has no binary comment.'); });
  rule('trailer-id', () => { const id = look(ctx.trailerInfo.ID); if (!(id instanceof PDFArray) || id.size() !== 2) bad('The file has no ID in its trailer.'); });
  rule('no-encryption', () => { if (ctx.trailerInfo.Encrypt || out.isEncrypted) bad('The file is encrypted (it has a password or restrictions).', { fix: 'manual' }); });
  rule('xmp', () => {
    const s = cat.lookup(N('Metadata'));
    if (!(s instanceof PDFStream)) { bad('The file has no XMP metadata.'); return; }
    if (s.dict.get(N('Filter'))) bad('The XMP metadata is compressed.');
    if (!xmp.ok) bad('The XMP metadata could not be read.');
    else if (!/<\?xpacket begin=/.test(xmpText) || !/<\?xpacket end=/.test(xmpText)) bad('The XMP metadata has no packet header.', { severity: 'warning' });
  });
  rule('pdfaid', () => {
    if (String(xmp.props['pdfaid:part'] || '') !== String(part)) bad(`The XMP metadata doesn't say it is PDF/A-${part}.`);
    else if (String(xmp.props['pdfaid:conformance'] || '').toUpperCase() !== conf) bad(`The XMP metadata doesn't give the conformance level ${conf}.`);
  });
  rule('xmp-sync', () => {
    if (!xmp.ok) { bad('Document properties are not in the XMP metadata.'); return; }
    const info = look(ctx.trailerInfo.Info);
    const pairs = [['Title', 'dc:title', 'title'], ['Author', 'dc:creator', 'author'], ['Subject', 'dc:description', 'subject'], ['Keywords', 'pdf:Keywords', 'keywords'], ['Creator', 'xmp:CreatorTool', 'creator tool'], ['Producer', 'pdf:Producer', 'producer'], ['CreationDate', 'xmp:CreateDate', 'creation date'], ['ModDate', 'xmp:ModifyDate', 'modification date']];
    for (const [k, x, label] of pairs) {
      const iv = info instanceof PDFDict ? pdfaText(L, info, k) : undefined; if (iv == null) continue;
      const xv = xmp.props[x];
      if (/Date$/.test(k)) { const a = pdfaParseDate(iv), b = pdfaParseXmpDate(xv); if (!a || !b || Math.abs(a - b) >= 1000) bad(`The ${label} differs between the document properties and the XMP metadata.`); }
      else if (k === 'Author') { const l = xmp.props['dc:creator#list'] || []; if (l.length !== 1 || l[0] !== iv) bad('The author differs between the document properties and the XMP metadata.'); }
      else if (xv !== iv) bad(`The ${label} differs between the document properties and the XMP metadata.`);
    }
  });
  rule('xmp-trapped', () => { if (xmp.props['pdf:Trapped'] != null && !(xmp.declared.has(PDFA_NS.pdf) && /<pdfaProperty:name>\s*Trapped\s*</.test(xmp.extensionXml))) bad('The XMP metadata has pdf:Trapped, which PDF/A doesn\'t know without an extension schema.'); });
  rule('xmp-schemas', () => { const odd = new Set(xmp.foreignNs.filter((ns) => !PDFA_PREDEFINED.has(ns) && !xmp.declared.has(ns))); if (odd.size) bad(`The XMP metadata uses schemas PDF/A doesn't know: ${[...odd].join(', ')}.`); });
  rule('output-intent', () => {
    const oi = cat.lookup(N('OutputIntents')); const list = oi instanceof PDFArray ? oi.asArray().map(look).filter((o) => o instanceof PDFDict && pdfaName(L, o.get(N('S'))) === 'GTS_PDFA1') : [];
    if (!list.length) { bad('No OutputIntent: the file doesn\'t say which colour space its colours are in.'); return; }
    const profs = new Set(list.map((o) => String(o.get(N('DestOutputProfile')))));
    if (profs.size > 1) bad('The file has more than one PDF/A output profile.');
    const s = list[0].lookup(N('DestOutputProfile'));
    if (!(s instanceof PDFStream)) { bad('The OutputIntent has no colour profile.'); return; }
    const icc = pdfaIccInfo(pdfaStreamBytes(L, s));
    if (!icc || icc.magic !== 'acsp') { bad('The OutputIntent\'s colour profile is not a valid ICC profile.'); return; }
    if (![2, 4].includes(icc.version)) bad('The colour profile is not ICC version 2 or 4.');
    if (!['mntr', 'prtr'].includes(icc.cls)) bad('The colour profile is not for a screen or a printer.');
    const nn = s.dict.lookup(N('N')), want = { 'RGB ': 3, CMYK: 4, 'GRAY': 1 }[icc.space];
    if (!want) bad('The colour profile is not RGB, CMYK or grey.'); else if (!(nn instanceof PDFNumber) || nn.asNumber() !== want) bad('The colour profile\'s number of colours is wrong.');
    if (!pdfaText(L, list[0], 'OutputConditionIdentifier')) bad('The OutputIntent has no condition identifier.');
  });
  const fonts = pdfaPageFonts(L, out);
  rule('fonts-embedded', () => {
    for (const [f, w] of fonts) {
      const sub = pdfaName(L, f.get(N('Subtype'))); if (sub === 'Type3') continue;
      let fd = f.lookup(N('FontDescriptor'));
      if (sub === 'Type0') { const ds = f.lookup(N('DescendantFonts')); const cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null; fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null; }
      const ok = fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.lookup(N(k)) instanceof PDFStream);
      if (!ok) { const name = (pdfaName(L, f.get(N('BaseFont'))) || w.key).replace(/^[A-Z]{6}\+/, ''); bad(`Font ${name} is not embedded${w.page ? ` on page ${w.page}` : ''}.`, { page: w.page || undefined, fix: pdfaSubstitute(L, f) ? 'auto' : 'manual' }); }
    }
  });
  rule('font-sharing', () => {
    const all = new Map(fonts), af = cat.lookup(N('AcroForm')), dr = af instanceof PDFDict ? af.lookup(N('DR')) : null, drf = dr instanceof PDFDict ? dr.lookup(N('Font')) : null;
    if (drf instanceof PDFDict) for (const [k, v] of drf.entries()) { const f = look(v); if (f instanceof PDFDict && !all.has(f)) all.set(f, { page: 0, key: k.decodeText() }); }
    for (const { groups } of pdfaSharedPrograms(L, all)) {
      const [f, w] = groups[0][0], name = (pdfaName(L, f.get(N('BaseFont'))) || w.key).replace(/^[A-Z]{6}\+/, '');
      bad(`Font ${name} shares one font program between ${groups.length} different encodings, so its widths can't all match.`, { page: w.page || undefined });
    }
  });
  rule('font-widths', () => {
    for (const [f, w] of fonts) {
      if (pdfaName(L, f.get(N('Subtype'))) !== 'TrueType') continue;
      const fd = f.lookup(N('FontDescriptor')), ff = fd instanceof PDFDict ? fd.lookup(N('FontFile2')) : null; if (!(ff instanceof PDFStream)) continue;
      const fc = f.lookup(N('FirstChar')), ws = f.lookup(N('Widths')); if (!(fc instanceof PDFNumber) || !(ws instanceof PDFArray)) { bad(`Font ${pdfaName(L, f.get(N('BaseFont')))} has no glyph widths.`, { page: w.page }); continue; }
      let t; try { t = pdfaTtf(pdfaStreamBytes(L, ff)); } catch { continue; }
      const flags = fd.lookup(N('Flags')), symbolic = flags instanceof PDFNumber && flags.asNumber() & 4 && !(flags.asNumber() & 32);
      if (symbolic) continue;
      const { uni } = pdfaFontUnicodes(L, f), first = fc.asNumber();
      for (let c = 32; c < 127; c++) {
        const i = c - first; if (i < 0 || i >= ws.size() || uni[c] == null) continue;
        const g = t.gid(uni[c]); if (!g) continue;
        const pw = look(ws.get(i)), fw = t.adv(g) * 1000 / t.upem;
        if (pw instanceof PDFNumber && Math.abs(pw.asNumber() - fw) > 1) { bad(`Font ${pdfaName(L, f.get(N('BaseFont')))}: its widths don't match the embedded font.`, { page: w.page, fix: 'manual' }); break; }
      }
    }
  });
  if (conf === 'U') rule('tounicode', () => {
    const shownText = pdfaShownText(pdfaInspect(L, out));
    for (const [f, w] of fonts) {
      const sub = pdfaName(L, f.get(N('Subtype')));
      const name = () => (pdfaName(L, f.get(N('BaseFont'))) || w.key).replace(/^[A-Z]{6}\+/, '');
      const tu = f.lookup(N('ToUnicode'));
      if (tu instanceof PDFStream && shownText.get(f)) {
        // every glyph the pages show has a usable mapping (ISO 19005-2, 6.2.11.7.2)
        const map = pdfaCMapRead(pdfaLatin1(pdfaStreamBytes(L, tu) || new Uint8Array()));
        let codes;
        if (sub === 'Type0') codes = pdfaCidsShown(L, f, shownText.get(f));
        else { codes = new Set(); for (const s of shownText.get(f)) for (const ch of s) codes.add(ch.charCodeAt(0)); }
        const uni = sub !== 'Type0' && sub !== 'Type3' ? pdfaFontUnicodes(L, f).uni : null;
        const bad1 = codes ? [...codes].filter((c) => !pdfaGoodText(map.get(c)) && !(uni && uni[c] != null && !map.has(c))) : [];
        if (bad1.length) bad(`Font ${name()} shows ${bad1.length === 1 ? 'a glyph' : bad1.length + ' glyphs'} with no Unicode mapping (code ${bad1.slice(0, 3).map((c) => c.toString(16).toUpperCase().padStart(sub === 'Type0' ? 4 : 2, '0')).join(', ')}), so that text can't be searched or copied reliably.`, { page: w.page, fix: 'manual' });
      }
      if (f.get(N('ToUnicode'))) continue;
      if (sub !== 'Type0' && sub !== 'Type3') { const { unknown } = pdfaFontUnicodes(L, f); const enc = f.get(N('Encoding')); if (enc && !unknown.length) continue; }
      if (sub === 'Type0') { const e = pdfaName(L, f.get(N('Encoding'))); if (e && /^Uni|UCS2/.test(e)) continue; }
      bad(`Font ${(pdfaName(L, f.get(N('BaseFont'))) || w.key).replace(/^[A-Z]{6}\+/, '')} has no Unicode mapping, so its text can't be searched or copied reliably.`, { page: w.page, fix: 'manual' });
    }
  });
  const all = pdfaReachable(L, out);
  rule('no-javascript', () => {
    const nm = cat.lookup(N('Names')); if (nm instanceof PDFDict && nm.get(N('JavaScript'))) bad('The file has JavaScript.');
    for (const { obj } of all) { const d = obj instanceof PDFStream ? obj.dict : obj; if (pdfaName(L, d.get(N('S'))) === 'JavaScript' && (!d.get(N('Type')) || pdfaName(L, d.get(N('Type'))) === 'Action')) { bad('The file has JavaScript.'); break; } }
  });
  rule('actions', () => {
    let aa = false, act = new Set();
    for (const { obj } of all) { const d = obj instanceof PDFStream ? obj.dict : obj; if (d.get(N('AA'))) aa = true; if (pdfaBadAction(L, d) && pdfaName(L, d.get(N('S'))) !== 'JavaScript') act.add(pdfaName(L, d.get(N('S')))); }
    if (aa) bad('The file has automatic actions (AA).'); for (const s of act) bad(`The file has ${s} actions.`);
  });
  rule('annotations', () => {
    out.getPages().forEach((p, i) => {
      const an = p.node.lookup(N('Annots')); if (!(an instanceof PDFArray)) return;
      for (const r of an.asArray()) {
        const a = look(r); if (!(a instanceof PDFDict)) continue;
        const sub = pdfaName(L, a.get(N('Subtype'))), fl = pdfaFlag(L, a);
        if (PDFA_BAD_ANNOTS.has(sub) || !PDFA_KNOWN_ANNOTS.has(sub)) { bad(`Page ${i + 1} has ${sub} content PDF/A can't keep.`, { page: i + 1 }); continue; }
        if (sub !== 'Popup' && (!(fl & 4) || fl & (1 | 2 | 32 | 256))) bad(`A ${sub === 'Widget' ? 'form field' : 'comment'} on page ${i + 1} is not set to print, or is hidden.`, { page: i + 1 });
        const ap = a.lookup(N('AP'));
        if (sub !== 'Popup' && !(ap instanceof PDFDict && ap.get(N('N')))) bad(`A ${sub === 'Widget' ? 'form field' : 'comment'} on page ${i + 1} has no appearance.`, { page: i + 1 });
        else if (ap instanceof PDFDict && (ap.get(N('R')) || ap.get(N('D')))) bad(`A ${sub === 'Widget' ? 'form field' : 'comment'} on page ${i + 1} has rollover or pressed appearances.`, { page: i + 1 });
      }
    });
  });
  rule('forms', () => { const a = cat.lookup(N('AcroForm')); if (a instanceof PDFDict) { if (a.lookup(N('NeedAppearances')) === L.PDFBool.True) bad('The form asks the reader to draw its fields.'); if (a.get(N('XFA'))) bad('The file has an XFA form.'); } });
  rule('no-lzw', () => { for (const { obj } of all) if (obj instanceof PDFStream && pdfaFilters(L, obj).includes('LZWDecode')) { bad('The file has LZW-compressed data.'); break; } });
  rule('no-external-streams', () => { for (const { obj } of all) if (obj instanceof PDFStream && (obj.dict.get(N('F')) || obj.dict.get(N('FFilter')))) { bad('The file refers to data outside it.'); break; } });
  rule('embedded-files', () => {
    for (const f of pdfaEmbeddedFiles(L, out)) {
      if (part === 2) { const b = pdfaStreamBytes(L, f.stream); if (!b || !pdfaClaimsPdfa(b)) bad(`The attachment ${f.name} is not a PDF/A file. PDF/A-3b allows it.`, { fix: 'manual' }); }
      else if (part === 3 && (!f.spec.get(N('AFRelationship')) || !f.stream.dict.get(N('Subtype')))) bad(`The attachment ${f.name} doesn't say what it is (relationship and file type).`);
      else if (part === 1) bad('PDF/A-1 doesn\'t allow attachments.', { fix: 'manual' });
    }
  });
  rule('images', () => { for (const { obj } of all) if (obj instanceof PDFStream && pdfaName(L, obj.dict.get(N('Subtype'))) === 'Image' && (obj.dict.lookup(N('Interpolate')) === L.PDFBool.True || obj.dict.get(N('Alternates')) || obj.dict.get(N('OPI')))) { bad('A picture asks for smoothing or alternates.'); break; } });
  rule('graphics-state', () => { for (const { obj } of all) { if (obj instanceof PDFStream) continue; if (obj.get(N('HTP')) || (obj.get(N('TR')) && (pdfaName(L, obj.get(N('Type'))) === 'ExtGState' || obj.get(N('ca')) || obj.get(N('CA')))) || (obj.get(N('TR2')) && pdfaName(L, obj.get(N('TR2'))) !== 'Default')) { bad('The file uses transfer functions or halftone settings.'); break; } } });
  const seen = pdfaInspect(L, out);
  rule('colour', () => {
    const oi = cat.lookup(N('OutputIntents')); const icc = oi instanceof PDFArray && oi.size() ? (() => { const o = look(oi.get(0)); const s = o instanceof PDFDict ? o.lookup(N('DestOutputProfile')) : null; return s instanceof PDFStream ? pdfaIccInfo(pdfaStreamBytes(L, s)) : null; })() : null;
    const space = icc ? icc.space : 'RGB ';
    let n = 0;
    const look2 = (r, where, page) => {
      if (n > 2) return;
      if (space !== 'CMYK' && r.CMYK) { n++; bad(`${where} uses CMYK colour, which an RGB output intent doesn't cover.`, { page, fix: 'manual' }); }
      else if (space === 'CMYK' && r.RGB) { n++; bad(`${where} uses RGB colour, which a CMYK output intent doesn't cover.`, { page, fix: 'manual' }); }
      else if (space === 'GRAY' && (r.RGB || r.CMYK)) { n++; bad(`${where} uses colour, which a grey output intent doesn't cover.`, { page, fix: 'manual' }); }
    };
    seen.pages.forEach((r, i) => look2(r, `Page ${i + 1}`, i + 1));
    seen.annots.forEach((x) => look2(x.rec, `A comment on page ${x.page}`, x.page));
  });
  if (part === 1) {
    rule('pdf14', () => {
      if (/\/Type\s*\/ObjStm\b/.test(pdfaLatin1(bytes.subarray(0, Math.min(bytes.length, 64 << 20))))) bad('The file uses object streams, which PDF/A-1 doesn\'t allow.');
      if (/startxref\s+(\d+)/.test(pdfaLatin1(bytes.subarray(Math.max(0, bytes.length - 1024))))) { const at = +/startxref\s+(\d+)/.exec(pdfaLatin1(bytes.subarray(Math.max(0, bytes.length - 1024))))[1]; if (!/^\s*xref/.test(pdfaLatin1(bytes.subarray(at, at + 16)))) bad('The file uses a cross-reference stream, which PDF/A-1 doesn\'t allow.'); }
    });
    rule('transparency', () => {
      seen.pages.forEach((r, i) => { if (r.alpha.size) bad(`Page ${i + 1} has see-through objects (${[...r.alpha][0]}), which PDF/A-1 doesn't allow.`, { page: i + 1, fix: 'manual' }); if (r.bits16) bad(`Page ${i + 1} has a 16-bit picture, which PDF/A-1 doesn't allow.`, { page: i + 1, fix: 'manual' }); if (r.jpx) bad(`Page ${i + 1} has a JPEG 2000 picture, which PDF/A-1 doesn't allow.`, { page: i + 1, fix: 'manual' }); });
      seen.annots.forEach((x) => { if (x.rec.alpha.size) bad(`A comment on page ${x.page} is see-through, which PDF/A-1 doesn't allow.`, { page: x.page }); });
    });
    rule('font-subsets', () => {
      for (const [f, w] of fonts) {
        const sub = pdfaName(L, f.get(N('Subtype'))), base = pdfaName(L, f.get(N('BaseFont'))) || '';
        if ((sub === 'Type1' || sub === 'MMType1') && /^[A-Z]{6}\+/.test(base)) { const fd = f.lookup(N('FontDescriptor')); if (fd instanceof PDFDict && fd.get(N('FontFile')) && !fd.get(N('CharSet'))) bad(`Font ${base.slice(7)} doesn't list its glyphs (CharSet).`, { page: w.page }); }
        if (sub === 'Type0') { const ds = f.lookup(N('DescendantFonts')); const cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null; const fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null; const nm = fd instanceof PDFDict ? pdfaName(L, fd.get(N('FontName'))) || '' : ''; if (/^[A-Z]{6}\+/.test(nm) && !fd.get(N('CIDSet'))) bad(`Font ${nm.slice(7)} doesn't list its glyphs (CIDSet).`, { page: w.page }); }
      }
    });
    // 6.3.7: a non-symbolic TrueType font names WinAnsi or MacRoman with no Differences; a symbolic one has no
    // Encoding and its program one cmap table.
    rule('truetype-encoding', () => {
      for (const [f, w] of fonts) {
        if (pdfaName(L, f.get(N('Subtype'))) !== 'TrueType') continue;
        const fd = f.lookup(N('FontDescriptor')), fl = fd instanceof PDFDict ? fd.lookup(N('Flags')) : null, name = (pdfaName(L, f.get(N('BaseFont'))) || w.key).replace(/^[A-Z]{6}\+/, '');
        const symbolic = fl instanceof PDFNumber && !!(fl.asNumber() & 4), enc = f.lookup(N('Encoding'));
        if (!symbolic) {
          const base = enc instanceof PDFDict ? pdfaName(L, enc.get(N('BaseEncoding'))) : pdfaName(L, enc);
          if (!/^(WinAnsi|MacRoman)Encoding$/.test(base || '') || (enc instanceof PDFDict && enc.get(N('Differences')))) bad(`Font ${name}: a TrueType font in PDF/A-1 must use WinAnsi or MacRoman encoding, with no changes to it.`, { page: w.page, fix: 'manual' });
        } else {
          if (enc) bad(`Font ${name}: a symbolic TrueType font in PDF/A-1 can't name an encoding.`, { page: w.page, fix: 'manual' });
          const ff = fd instanceof PDFDict ? fd.lookup(N('FontFile2')) : null, b = ff instanceof PDFStream ? pdfaStreamBytes(L, ff) : null;
          if (b) { try { const t = pdfaTtf(b), n = t.view.getUint16(t.tables.cmap.off + 2); if (n !== 1) bad(`Font ${name}: a symbolic TrueType font in PDF/A-1 must have exactly one cmap table (it has ${n}).`, { page: w.page, fix: 'manual' }); } catch {} }
        }
      }
    });
    rule('no-layers', () => { if (cat.get(N('OCProperties'))) bad('The file has layers (optional content), which PDF/A-1 doesn\'t allow.', { fix: 'manual' }); });
  }
  rule('optional-content', () => { const ocp = cat.lookup(N('OCProperties')); if (!(ocp instanceof PDFDict)) return; const cfg = [ocp.lookup(N('D'))]; const more = ocp.lookup(N('Configs')); if (more instanceof PDFArray) cfg.push(...more.asArray().map(look)); if (cfg.some((c) => c instanceof PDFDict && (!c.get(N('Name')) || c.get(N('AS'))))) bad('A layer configuration has no name, or changes layers automatically.'); });
  problems.passed = passed; problems.checks = ruleNames.length;
  return problems;
}
const pdfaPlural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// "12 checks passed. 1 problem: font Wingdings is not embedded on page 3."
function pdfaSummary(r) {
  const errs = r.filter((x) => x.severity === 'error');
  const head = `${pdfaPlural(r.passed.length, 'check')} passed.`;
  if (!errs.length) return head;
  return `${head} ${pdfaPlural(errs.length, 'problem')}: ${errs.slice(0, 1).map((x) => x.text.replace(/^./, (c) => c.toLowerCase()).replace(/\.$/, '')).join('')}${errs.length > 1 ? `, and ${pdfaPlural(errs.length - 1, 'other')}` : ''}.`;
}

/* ----- Save as PDF/A… (and Save as PDF/X…, 85-pdfx.js) ----- */
const PDFA_LEVELS = [['1b', 'PDF/A-1b', 'For systems that ask for PDF/A-1. No see-through objects.'], ['2b', 'PDF/A-2b', 'For most documents. Keeps how every page looks.'], ['2u', 'PDF/A-2u', 'Also makes sure all text can be searched and copied.'],
  ['3b', 'PDF/A-3b', 'Like PDF/A-2b, and keeps attachments of any kind.'], ['3u', 'PDF/A-3u', 'Like PDF/A-3b, and all text can be searched and copied.']];
const PDFA_INTENTS = [['srgb', 'Screen colours (sRGB)'], ['cmyk', 'Print colours (CMYK, coated FOGRA39)']];
let pdfaBusy = false;
// The colours a document's pages use, to choose the output intent: 'cmyk' when there is CMYK and no RGB.
async function pdfaGuessIntent(bytes) {
  try {
    const L = await loadPdfLib(), d = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const s = pdfaInspect(L, d); const rgb = s.pages.some((r) => r.RGB || [...r.icc].includes(3)), cmyk = s.pages.some((r) => r.CMYK || [...r.icc].includes(4));
    return cmyk && !rgb ? 'cmyk' : 'srgb';
  } catch { return 'srgb'; }
}
const pdfaDlg = (dlg) => { dlg.classList.add('pdfa-dlg'); dlg.addEventListener('close', () => dlg.classList.remove('pdfa-dlg'), { once: true }); };
// Makes, checks and saves the copy: opts = { part, conformance, intent } or { pdfx }. Refusals are shown in a dialog
// and save nothing.
async function pdfaExport(opts) {
  if (!has() || pdfaBusy) return;
  pdfaBusy = true;
  const isX = !!opts.pdfx, kind = isX ? 'PDF/X' : 'PDF/A';
  try {
    let P = pdfaProfile(opts);
    if (typeof diSaving === 'function') diSaving(); // a producer or date typed in Document properties is used by this save
    const bytes = await buildPdf(); if (!bytes) return;
    const L = await loadPdfLib();
    let enc = false; try { enc = (await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).isEncrypted; } catch {}
    if (enc) { await dialog(`Save as ${kind}`, `<p>${kind} files can't have a password. Remove it to continue.</p>`, [{ label: 'OK', primary: true }]); return; }
    toast(`Making the ${kind} file…`);
    let o = { ...opts, scripts: 'refuse', name: doc.name };
    let res = await pdfaConvert(bytes, o);
    for (let guard = 0; res.blocked && guard < 4; guard++) {
      if (res.blocked === 'attachments') {
        const a = await dialog('Attachments', `<p>PDF/A-2 only keeps attachments that are PDF/A files too. ${esc(res.names.slice(0, 3).join(', '))}${res.names.length > 3 ? ' and others' : ''} ${res.names.length === 1 ? 'is' : 'are'} not. PDF/A-3b keeps them.</p>`, [{ label: 'Cancel' }, { label: 'Use PDF/A-3b', value: '3b', primary: true }]);
        if (a !== '3b') return;
        o = { ...o, part: 3, conformance: o.conformance === 'U' ? 'U' : 'B' };
      } else if (res.blocked === 'scripts') {
        const a = await dialog('Scripts and actions', `<p>${kind} files can't run scripts or actions. This PDF has ${esc(res.text)}.</p><p>Remove them to make the ${P.label} copy? Your document stays as it is.</p>`, [{ label: 'Cancel' }, { label: 'Remove and save', value: 'remove', primary: true }], pdfaDlg);
        if (a !== 'remove') return;
        o = { ...o, scripts: 'remove' };
      } else if (res.blocked === 'profile') {
        const only = res.problems.every((x) => x.code === 'cmyk');
        const body = `<p class="pdfa-sum">This PDF can't be saved as ${esc(res.label)}. Nothing was saved.</p>
          <ul class="pdfa-probs">${res.problems.slice(0, 12).map((x) => `<li>${ic('circle-alert')}<span>${esc(x.text)}</span></li>`).join('')}</ul>`;
        const btns = only && !isX ? [{ label: 'Cancel' }, { label: 'Use print colours', value: 'cmyk', primary: true }] : [{ label: 'OK', primary: true }];
        const a = await dialog(`Can't save as ${res.label}`, body, btns, pdfaDlg);
        if (a !== 'cmyk') return;
        o = { ...o, intent: 'cmyk' };
      } else return;
      P = pdfaProfile(o);
      res = await pdfaConvert(bytes, o);
    }
    if (res.blocked) return;
    const check = isX ? await pdfxCheck(res.bytes, { pdfx: P.pdfx }) : await pdfaCheck(res.bytes, { part: P.part, conformance: P.conformance });
    const errs = check.filter((x) => x.severity === 'error');
    let out = res.bytes, name = `${doc.name} (${kind.replace('/', '-')}).pdf`;
    if (errs.length) {
      const body = `<p class="pdfa-sum">${esc(pdfaSummary(check))}</p>
        <ul class="pdfa-probs">${errs.slice(0, 12).map((x) => `<li>${ic('circle-alert')}<span>${esc(x.text)}</span></li>`).join('')}${errs.length > 12 ? `<li><span>…and ${errs.length - 12} more</span></li>` : ''}</ul>
        <p class="pdfa-note">This is a built-in check, not a certified validator.</p>`;
      const a = await dialog(`Not ${P.label} yet`, body, [{ label: 'Cancel' }, { label: `Save anyway (not ${kind})`, value: 'anyway' }], pdfaDlg);
      if (a !== 'anyway') return;
      out = isX ? await pdfxDropClaim(res.bytes) : await pdfaDropClaim(res.bytes); name = `${doc.name} (${isX ? 'print' : 'archive'}).pdf`;
    }
    const saved = await saveFile(out, name, 'application/pdf');
    window.__lastPdfa = { bytes: out, check, fixes: res.fixes, part: P.part, conformance: P.conformance, pdfx: P.pdfx, intent: P.intent };
    if (saved && !errs.length) toast(`Saved as ${P.label}. ${pdfaPlural(check.passed.length, 'built-in check')} passed.`);
  } catch (e) { console.error(e); toast(`Could not save as ${kind}: ${e.message || e}`); }
  finally { pdfaBusy = false; }
}
async function pdfaSave(level, intent) {
  if (!has() || pdfaBusy) return;
  if (!level) {
    const guess = await pdfaGuessIntent(doc.sources[doc.pages.length ? doc.pages[0].src : 0]);
    const body = `<p class="pdfa-intro">An archival copy that opens the same way for years: fonts are embedded, colours are defined, and scripts are removed.</p>
      <div class="pdfa-levels" role="radiogroup" aria-label="Kind of PDF/A">${PDFA_LEVELS.map(([v, t, d]) => `<label class="pdfa-level"><input type="radio" name="pdfaLevel" value="${v}"${v === '2b' ? ' checked' : ''}><span><b>${t}</b><small>${esc(d)}</small></span></label>`).join('')}</div>
      <label class="field pdfa-intent"><span>Colours</span><select name="pdfaIntent">${PDFA_INTENTS.map(([v, t]) => `<option value="${v}"${v === guess ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`;
    let pick = '2b', pickIntent = guess;
    const a = await dialog('Save as PDF/A', body, [{ label: 'Cancel' }, { label: 'Save', value: 'ok', primary: true }], (dlg) => { pdfaDlg(dlg); $$('[name="pdfaLevel"]', dlg).forEach((i) => i.addEventListener('change', () => { pick = i.value; })); $('[name="pdfaIntent"]', dlg).addEventListener('change', (e) => { pickIntent = e.target.value; }); });
    if (a !== 'ok') return;
    level = pick; intent = pickIntent;
  }
  return pdfaExport({ part: +level[0], conformance: level[1].toUpperCase(), intent: intent || 'srgb' });
}

cmd('savePdfa', { label: 'Save as PDF/A…', rlabel: 'Save as PDF/A', icon: 'archive', enabled: has, run: () => pdfaSave() });
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('saveCopy') : -1; if (i >= 0) fm[1].splice(i + 1, 0, 'savePdfa'); else menuAdd('File', ['savePdfa']); }
ribbonAdd('export', 'Archive', ['savePdfa'], 'Export');
const pdfaInspectBytes = async (bytes) => { const L = await loadPdfLib(), d = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }); const r = pdfaInspect(L, d); const plain = (x) => ({ ...x, icc: [...x.icc], alpha: [...x.alpha] }); return { pages: r.pages.map(plain), annots: r.annots.map((x) => ({ page: x.page, sub: x.sub, rec: plain(x.rec) })) }; };
Object.assign(TEST_HOOKS, { pdfaCheck, pdfaConvert, pdfaSrgbIcc: () => Array.from(pdfaSrgbIcc()), pdfaSave, pdfaExport, pdfaIsBusy: () => pdfaBusy, pdfaSummary, pdfaInspect: (b) => pdfaInspectBytes(new Uint8Array(b)), pdfaCmykIcc: () => Array.from(pdfaCmykZ()), pdfaLast: () => window.__lastPdfa && { bytes: Array.from(window.__lastPdfa.bytes), check: [...window.__lastPdfa.check], fixes: window.__lastPdfa.fixes } });

addStyle(`
.pdfa-dlg { width: min(520px, calc(100vw - 32px)); }
.pdfa-intro { margin: 0 0 10px; color: var(--ink-2); font-size: 13px; }
.pdfa-levels { display: grid; gap: 6px; }
.pdfa-level { display: flex; gap: 10px; align-items: flex-start; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; cursor: pointer; }
.pdfa-level:has(input:checked) { border-color: var(--accent, #2448C9); }
.pdfa-level input { margin-top: 3px; }
.pdfa-level span { display: grid; gap: 2px; }
.pdfa-level b { font-weight: 600; color: var(--ink); font-size: 14px; }
.pdfa-level small { color: var(--ink-3); font-size: 12px; }
.pdfa-sum { margin: 0 0 8px; color: var(--ink); }
.pdfa-probs { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow: auto; border: 1px solid var(--line); border-radius: 8px; font-size: 13px; }
.pdfa-probs li { display: flex; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--line); color: var(--ink); }
.pdfa-probs li:last-child { border-bottom: 0; }
.pdfa-probs svg { width: 16px; height: 16px; flex: none; color: var(--danger, #c92a2a); margin-top: 1px; }
.pdfa-note { font-size: 12px; color: var(--ink-3); margin: 8px 0 0; }
.pdfa-intent { margin: 10px 0 0; }
`);
