/* ---------------- PDF/A (src/features/84-pdfa.js) ----------------
   File > Save as PDF/A… (and Export > Archive): an archival copy in PDF/A-2b (the default), PDF/A-2u or PDF/A-3b,
   made on this device, then checked by a built-in rule subset modelled on the veraPDF profiles for those parts.
   - pdfaWriteXmp(L, out, extra): writes the XMP packet from the Info dictionary (title, author, subject, keywords,
     creator tool, producer, dates, document and instance ids, language). 12-docinfo.js calls it on every save that
     keeps or edits metadata; extra = { pdfa: { part, conformance }, pdfua: { part }, extensions: [schema…],
     props: [{ ns, prefix, name, value }], keepClaims, strict } lets PDF/A and PDF/UA add their own schemas.
   - pdfaConvert(bytes, { part, conformance }) -> { bytes, fixes: [text], blocked? }: the conversion (used by the
     batch tools too). Fonts that were not embedded (the standard 14 that page design, Add text, stamps and form
     fields use) are replaced by metric-compatible embedded fonts: Arimo for Helvetica, Tinos for Times, Cousine for
     Courier (SIL Open Font License, from the pinned @expo-google-fonts packages; the desktop and mobile bundle
     vendors them with every other jsDelivr file). They are cut down here to the Latin glyphs a simple font can
     address, keeping glyph ids, so the font's own cmap and widths stay right (fontkit's subsetter drops the cmap,
     which a simple TrueType font needs, so it isn't used). Symbol, ZapfDingbats and fonts with no Latin substitute
     are reported, not replaced.
   - pdfaCheck(bytes, { part, conformance }?) -> [{ rule, severity, page?, fix?, text }] with .passed (rule names):
     a built-in check, not a certified validator.
   - The sRGB output intent profile (ICC v2, matrix/TRC with a 1024-point curve) is made in code, so no profile file
     needs a licence.
   PDF/X-4 is not offered: it needs a CMYK printing-condition profile (ISO Coated, GRACoL…) and no pinned package with
   a licence that allows shipping one in the app was found; a made-up CMYK profile would print the wrong colours. */

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
  const r = { ok: false, props: {}, foreign: [], foreignNs: [], declared: new Set(), extensionXml: '' };
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
      r.foreign.push(`<${a.prefix || 'ns'}:${a.localName} xmlns:${a.prefix || 'ns'}="${pdfaXml(a.namespaceURI)}">${pdfaXml(a.value)}</${a.prefix || 'ns'}:${a.localName}>`); r.foreignNs.push(a.namespaceURI);
    }
    for (const el of [...d.children]) {
      const p = prefixOf(el.namespaceURI), key = p ? `${p}:${el.localName}` : null;
      if (key && PDFA_MANAGED.has(key)) { r.props[key] = valueOf(el); if (key === 'dc:creator') r.props['dc:creator#list'] = listOf(el); continue; }
      if (el.namespaceURI === PDFA_NS.pdfaExtension) {
        r.extensionXml = new XMLSerializer().serializeToString(el);
        for (const u of el.getElementsByTagNameNS(PDFA_NS.pdfaSchema, 'namespaceURI')) r.declared.add(u.textContent.trim());
        continue;
      }
      r.foreign.push(new XMLSerializer().serializeToString(el)); r.foreignNs.push(el.namespaceURI);
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
  const el = (name, v) => (v == null || v === '' ? '' : `<${name}>${pdfaXml(v)}</${name}>`);
  const alt = (name, v) => (v == null ? '' : `<${name}><rdf:Alt><rdf:li xml:lang="x-default">${pdfaXml(v)}</rdf:li></rdf:Alt></${name}>`);
  const blocks = [];
  blocks.push(`<rdf:Description rdf:about="" xmlns:dc="${PDFA_NS.dc}">${el('dc:format', 'application/pdf')}${alt('dc:title', title)}${author != null ? `<dc:creator><rdf:Seq><rdf:li>${pdfaXml(author)}</rdf:li></rdf:Seq></dc:creator>` : ''}${alt('dc:description', subject)}${lang ? `<dc:language><rdf:Bag><rdf:li>${pdfaXml(lang)}</rdf:li></rdf:Bag></dc:language>` : ''}</rdf:Description>`);
  blocks.push(`<rdf:Description rdf:about="" xmlns:xmp="${PDFA_NS.xmp}">${el('xmp:CreatorTool', creator)}${el('xmp:CreateDate', created)}${el('xmp:ModifyDate', modified)}${el('xmp:MetadataDate', modified || pdfaIso(new Date()))}</rdf:Description>`);
  blocks.push(`<rdf:Description rdf:about="" xmlns:pdf="${PDFA_NS.pdf}">${el('pdf:Producer', producer)}${keywords != null ? `<pdf:Keywords>${pdfaXml(keywords)}</pdf:Keywords>` : ''}${/^(True|False|Unknown)$/.test(trapped || '') ? el('pdf:Trapped', trapped) : ''}</rdf:Description>`);
  blocks.push(`<rdf:Description rdf:about="" xmlns:xmpMM="${PDFA_NS.xmpMM}">${el('xmpMM:DocumentID', docId)}${el('xmpMM:InstanceID', 'uuid:' + pdfaUuid())}</rdf:Description>`);
  // Conformance claims: the ones asked for, or (keepClaims) the ones the file had.
  const pdfa = extra.pdfa || (extra.keepClaims && old.props['pdfaid:part'] ? { part: old.props['pdfaid:part'], conformance: old.props['pdfaid:conformance'] } : null);
  const pdfua = extra.pdfua || (extra.keepClaims && old.props['pdfuaid:part'] ? { part: old.props['pdfuaid:part'] } : null);
  if (pdfa) blocks.push(`<rdf:Description rdf:about="" xmlns:pdfaid="${PDFA_NS.pdfaid}">${el('pdfaid:part', String(pdfa.part))}${pdfa.conformance ? el('pdfaid:conformance', String(pdfa.conformance).toUpperCase()) : ''}</rdf:Description>`);
  if (pdfua) blocks.push(`<rdf:Description rdf:about="" xmlns:pdfuaid="${PDFA_NS.pdfuaid}">${el('pdfuaid:part', String(pdfua.part))}</rdf:Description>`);
  for (const p of extra.props || []) blocks.push(`<rdf:Description rdf:about="" xmlns:${p.prefix}="${pdfaXml(p.ns)}">${el(`${p.prefix}:${p.name}`, p.value)}</rdf:Description>`);
  // Properties the app doesn't manage: kept, except (strict, for PDF/A) those PDF/A doesn't know.
  const strict = !!(extra.strict || extra.pdfa);
  const kept = old.foreign.filter((x, k) => !strict || PDFA_PREDEFINED.has(old.foreignNs[k]));
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
function pdfaTtfSubset(f, unicodes) {
  const { bytes, view: v, tables } = f;
  const gids = new Set([0]), pairs = [];
  for (const u of [...new Set(unicodes)].sort((a, b) => a - b)) { const g = f.gid(u); if (g && u < 0xFFFF) { gids.add(g); pairs.push([u, g]); } }
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
  cv.setUint16(2, 1); cv.setUint16(4, 3); cv.setUint16(6, 1); cv.setUint32(8, 12);
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
// The Latin glyphs every replacement font carries (any code a simple font with these encodings can reach).
const PDFA_LATIN = (() => { const s = new Set(); for (const t of Object.values(PDFA_ENC)) for (const u of t) if (u != null) s.add(u); for (const u of PDFA_AGL.values()) s.add(u); return [...s]; })();
const pdfaUnicodeToName = (() => { let m = null; return (u) => { if (!m) { m = new Map(); for (const [n, c] of PDFA_AGL) if (!m.has(c)) m.set(c, n); m.set(0x20, 'space'); m.set(0x2D, 'hyphen'); } return m.get(u) || 'uni' + u.toString(16).toUpperCase().padStart(4, '0'); }; })();
function pdfaToUnicodeCMap(uni) {
  const rows = []; uni.forEach((u, c) => { if (u != null && u > 0 && u !== 0xFEFF && u !== 0xFFFE) rows.push(`<${c.toString(16).padStart(2, '0').toUpperCase()}> <${(u > 0xFFFF ? String.fromCodePoint(u).split('').map((x) => x.charCodeAt(0).toString(16).padStart(4, '0')).join('') : u.toString(16).padStart(4, '0')).toUpperCase()}>`); });
  let body = ''; for (let i = 0; i < rows.length; i += 100) { const part = rows.slice(i, i + 100); body += `${part.length} beginbfchar\n${part.join('\n')}\nendbfchar\n`; }
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
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

/* ----- appearances for annotations that have none ----- */
function pdfaAppearance(L, out, a) {
  const N = L.PDFName.of, sub = pdfaName(L, a.get(N('Subtype'))), rect = a.lookup(N('Rect'));
  const r = rect instanceof L.PDFArray ? rect.asArray().map((x) => (out.context.lookup(x) instanceof L.PDFNumber ? out.context.lookup(x).asNumber() : 0)) : [0, 0, 0, 0];
  const [x1, y1, x2, y2] = [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  const nums = (k) => { const v = a.lookup(N(k)); return v instanceof L.PDFArray ? v.asArray().map((x) => { const n = out.context.lookup(x); return n instanceof L.PDFNumber ? n.asNumber() : 0; }) : null; };
  const f = (n) => (Math.round(n * 1000) / 1000).toString();
  const c = nums('C'), col = (stroke) => (c && c.length === 3 ? `${c.map(f).join(' ')} ${stroke ? 'RG' : 'rg'}` : c && c.length === 1 ? `${f(c[0])} ${stroke ? 'G' : 'g'}` : c && c.length === 4 ? `${c.map(f).join(' ')} ${stroke ? 'K' : 'k'}` : stroke ? '0 G' : '0 g');
  const bs = a.lookup(N('BS')), bw = bs instanceof L.PDFDict && bs.lookup(N('W')) instanceof L.PDFNumber ? bs.lookup(N('W')).asNumber() : 1;
  let ops = '';
  if (sub === 'Text') {
    const w = x2 - x1, h = y2 - y1, k = Math.min(w, h) / 20;
    ops = `q ${c && c.length === 3 ? col(false) : '1 0.83 0.23 rg'} 0.35 0.3 0.1 RG ${f(k)} w ${f(x1 + k)} ${f(y1 + 4 * k)} ${f(w - 2 * k)} ${f(h - 5 * k)} re B ${f(x1 + 4 * k)} ${f(y1 + 4 * k)} m ${f(x1 + 4 * k)} ${f(y1 + k)} l ${f(x1 + 8 * k)} ${f(y1 + 4 * k)} l f`;
    for (let i = 0; i < 3; i++) ops += ` ${f(x1 + 4 * k)} ${f(y2 - (5 + i * 4) * k)} m ${f(x2 - 4 * k)} ${f(y2 - (5 + i * 4) * k)} l S`;
    ops += ' Q';
  } else if (sub === 'Square' || sub === 'Circle') {
    const ic = nums('IC'), fill = ic && ic.length === 3 ? `${ic.map(f).join(' ')} rg ` : '';
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
    ops = sub === 'Highlight' ? `q /PdfaGs gs ${col(false)}` : `q ${col(true)} 1 w`;
    for (let i = 0; i + 7 < q.length; i += 8) {
      const xs = [q[i], q[i + 2], q[i + 4], q[i + 6]], ys = [q[i + 1], q[i + 3], q[i + 5], q[i + 7]];
      const lx = Math.min(...xs), hx = Math.max(...xs), ly = Math.min(...ys), hy = Math.max(...ys);
      if (sub === 'Highlight') ops += ` ${f(lx)} ${f(ly)} ${f(hx - lx)} ${f(hy - ly)} re f`;
      else { const y = sub === 'StrikeOut' ? (ly + hy) / 2 : ly + (hy - ly) * 0.08; ops += ` ${f(lx)} ${f(y)} m ${f(hx)} ${f(y)} l S`; }
    }
    ops += ' Q';
  }
  const dict = { Type: 'XObject', Subtype: 'Form', BBox: [x1, y1, x2, y2], Resources: {} };
  if (sub === 'Highlight') dict.Resources = { ExtGState: { PdfaGs: { Type: 'ExtGState', BM: 'Multiply', CA: 1, ca: 0.4 } } };
  return out.context.register(out.context.flateStream(pdfaBytes(ops), dict));
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
  const part = +(opts.part || 2), conformance = String(opts.conformance || 'B').toUpperCase();
  const L = await loadPdfLib(), { PDFName, PDFDict, PDFArray, PDFStream, PDFRawStream, PDFNumber, PDFRef, PDFHexString, PDFString } = L, N = PDFName.of;
  const out = await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (out.isEncrypted) { const e = new Error("PDF/A files can't have a password. Remove it to continue."); e.code = 'encrypted'; throw e; }
  const ctx = out.context, look = (o) => ctx.lookup(o), fixes = new Set(), fix = (t) => fixes.add(t);
  const cat = out.catalog, pages = out.getPages();
  // Attachments: PDF/A-2 takes only PDF/A attachments; PDF/A-3 takes any, described (AFRelationship, MIME type).
  const files = pdfaEmbeddedFiles(L, out);
  if (part === 2) {
    const bad = files.filter((f) => { const b = pdfaStreamBytes(L, f.stream); return !b || !pdfaClaimsPdfa(b); });
    if (bad.length) return { blocked: 'attachments', names: bad.map((f) => f.name), fixes: [] };
  }
  if (part === 3 && files.length) {
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
  // Scripts and actions PDF/A doesn't allow; additional actions anywhere.
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
  // Annotations: printed, shown, with a normal appearance only; ones PDF/A forbids removed.
  pages.forEach((p, i) => {
    const an = p.node.lookup(N('Annots')); if (!(an instanceof PDFArray)) return;
    for (let k = an.size() - 1; k >= 0; k--) {
      const a = look(an.get(k)); if (!(a instanceof PDFDict)) continue;
      const sub = pdfaName(L, a.get(N('Subtype')));
      if (PDFA_BAD_ANNOTS.has(sub) || !PDFA_KNOWN_ANNOTS.has(sub)) { an.remove(k); fix(`Removed ${sub === '3D' ? '3D' : 'media'} content PDF/A can't keep`); continue; }
      let fl = pdfaFlag(L, a);
      if (sub !== 'Widget' && sub !== 'Popup' && fl & (1 | 2 | 32)) { an.remove(k); fix('Removed hidden comments'); continue; }
      const nf = ((fl | 4) & ~(1 | 2 | 32 | 256)) | (sub === 'Text' ? 8 | 16 : 0); // a note's icon doesn't zoom or turn
      if (nf !== fl) { a.set(N('F'), PDFNumber.of(nf)); fix('Set comments and fields to print'); }
      let ap = a.lookup(N('AP'));
      const nApp = ap instanceof PDFDict ? ap.get(N('N')) : null;
      if (!(ap instanceof PDFDict) || !nApp) {
        const ref = pdfaAppearance(L, out, a);
        if (!(ap instanceof PDFDict)) { ap = ctx.obj({}); a.set(N('AP'), ap); }
        ap.set(N('N'), ref); fix('Drew comments that had no appearance');
      }
      for (const x of ['R', 'D']) if (ap.get(N(x))) ap.delete(N(x));
    }
  });
  // Optional content: every configuration named, no automatic state changes.
  const ocp = cat.lookup(N('OCProperties'));
  if (ocp instanceof PDFDict) {
    const cfgs = [ocp.lookup(N('D'))]; const more = ocp.lookup(N('Configs')); if (more instanceof PDFArray) cfgs.push(...more.asArray().map(look));
    cfgs.forEach((c, i) => { if (!(c instanceof PDFDict)) return; if (!c.get(N('Name'))) c.set(N('Name'), PDFHexString.fromText(i ? `Layers ${i}` : 'Layers')); if (c.get(N('AS'))) c.delete(N('AS')); });
  }
  // Transparency: pages that use it get a transparency group in the output intent's colour space.
  const seenT = new Set();
  const usesT = (res, depth) => {
    if (!(res instanceof PDFDict) || depth > 8 || seenT.has(res)) return false; seenT.add(res);
    const gs = res.lookup(N('ExtGState'));
    if (gs instanceof PDFDict) for (const [, v] of gs.entries()) { const g = look(v); if (!(g instanceof PDFDict)) continue; const n = (k) => { const x = g.lookup(N(k)); return x instanceof PDFNumber ? x.asNumber() : 1; }; const sm = g.get(N('SMask')); const bm = pdfaName(L, look(g.get(N('BM')))); if (n('CA') < 1 || n('ca') < 1 || (sm && pdfaName(L, sm) !== 'None') || (bm && !PDFA_TRANSPARENT_BM.has(bm))) return true; }
    const xo = res.lookup(N('XObject'));
    if (xo instanceof PDFDict) for (const [, v] of xo.entries()) { const s = look(v); if (!(s instanceof PDFStream)) continue; if (s.dict.get(N('SMask')) || s.dict.get(N('SMaskInData'))) return true; if (pdfaName(L, s.dict.get(N('Subtype'))) === 'Form' && (s.dict.get(N('Group')) || usesT(s.dict.lookup(N('Resources')), depth + 1))) return true; }
    return false;
  };
  for (const p of pages) {
    let t = false; try { t = usesT(p.node.Resources(), 0); } catch {}
    const g = p.node.lookup(N('Group'));
    if (g instanceof PDFDict) { if (!g.get(N('CS'))) { g.set(N('CS'), N('DeviceRGB')); fix('Gave transparent pages a colour space'); } }
    else if (t) { p.node.set(N('Group'), ctx.obj({ Type: 'Group', S: 'Transparency', CS: 'DeviceRGB' })); fix('Gave transparent pages a colour space'); }
  }
  // Fonts: every font embedded. Ones that weren't get a metric-compatible stand-in, keeping their resource names.
  const fonts = pdfaPageFonts(L, out);
  const acroDr = acro instanceof PDFDict ? acro.lookup(N('DR')) : null, drFonts = acroDr instanceof PDFDict ? acroDr.lookup(N('Font')) : null;
  if (drFonts instanceof PDFDict) for (const [k, v] of drFonts.entries()) { const f = look(v); if (f instanceof PDFDict && !fonts.has(f)) fonts.set(f, { page: 0, key: k.decodeText(), dr: true }); }
  const descriptors = new Map(), programs = new Map();
  const embedded = (f) => {
    const sub = pdfaName(L, f.get(N('Subtype')));
    if (sub === 'Type3') return true;
    let fd = f.lookup(N('FontDescriptor'));
    if (sub === 'Type0') { const ds = f.lookup(N('DescendantFonts')); const cid = ds instanceof PDFArray && ds.size() ? look(ds.get(0)) : null; fd = cid instanceof PDFDict ? cid.lookup(N('FontDescriptor')) : null; }
    return fd instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fd.get(N(k)));
  };
  const unicodeFix = part === 2 && conformance === 'U' || part === 3 && conformance === 'U';
  for (const [f, where] of fonts) {
    const sub = pdfaName(L, f.get(N('Subtype')));
    if (embedded(f)) {
      // PDF/A-2u: simple fonts get a ToUnicode map from their encoding when every code can be named.
      if (unicodeFix && sub !== 'Type0' && sub !== 'Type3' && !f.get(N('ToUnicode'))) {
        const { uni, unknown } = pdfaFontUnicodes(L, f);
        if (!unknown.length && f.get(N('Encoding'))) { f.set(N('ToUnicode'), ctx.register(ctx.flateStream(pdfaBytes(pdfaToUnicodeCMap(uni))))); fix('Added text mappings (ToUnicode) to fonts'); }
      }
      continue;
    }
    if (sub === 'Type0' || !/^(Type1|MMType1|TrueType)$/.test(sub || '')) continue; // reported by the check
    const pick = pdfaSubstitute(L, f); if (!pick) continue;
    const [fam, style] = pick, key = fam + style;
    let ttf; try { ttf = await pdfaFontFile(fam, style); } catch (e) { console.warn('PDF/A: could not load a font', e); continue; }
    if (!programs.has(key)) { const sub = pdfaTtfSubset(ttf, PDFA_LATIN); programs.set(key, ctx.register(ctx.flateStream(sub, { Length1: sub.length }))); }
    const program = programs.get(key);
    const psName = PDFA_FAMILY_NAME[fam] + ['-Regular', '-Bold', '-Italic', '-BoldItalic'][style];
    if (!descriptors.has(key)) {
      const tag = Array.from({ length: 6 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
      const k = 1000 / ttf.upem, flags = 32 | (fam === 'tinos' ? 2 : 0) | (fam === 'cousine' ? 1 : 0) | (style & 2 ? 64 : 0) | (style & 1 ? 0x40000 : 0);
      const name = `${tag}+${psName}`;
      descriptors.set(key, { name, ref: ctx.register(ctx.obj({ Type: 'FontDescriptor', FontName: name, Flags: flags, FontBBox: ttf.bbox.map((x) => Math.round(x * k)), ItalicAngle: ttf.italicAngle, Ascent: Math.round(ttf.ascent * k), Descent: Math.round(ttf.descent * k), CapHeight: Math.round(ttf.capHeight * k), XHeight: Math.round(ttf.xHeight * k), StemV: style & 1 ? 140 : 80, FontFile2: program })) });
    }
    const desc = descriptors.get(key), was = (pdfaName(L, f.get(N('BaseFont'))) || '').replace(/^[A-Z]{6}\+/, '');
    const { uni, named } = pdfaFontUnicodes(L, f);
    if (!named) {
      // Encoding: WinAnsi plus the codes that differ from it, named from the Adobe Glyph List.
      const diffs = []; let last = -2;
      uni.forEach((u, c) => { if (u == null || u === PDFA_ENC.WinAnsiEncoding[c]) return; if (c !== last + 1) diffs.push(c); diffs.push(N(pdfaUnicodeToName(u))); last = c; });
      f.set(N('Encoding'), diffs.length ? ctx.obj({ Type: 'Encoding', BaseEncoding: 'WinAnsiEncoding', Differences: diffs.map((x) => (typeof x === 'number' ? PDFNumber.of(x) : x)) }) : N('WinAnsiEncoding'));
    }
    const enc = named ? uni : uni.map((u, c) => (u == null ? PDFA_ENC.WinAnsiEncoding[c] : u));
    let first = enc.findIndex((u) => u != null); if (first < 0) first = 32;
    let lastC = 255; while (lastC > first && enc[lastC] == null) lastC--;
    const widths = []; for (let c = first; c <= lastC; c++) widths.push(Math.round(ttf.adv(enc[c] == null ? 0 : ttf.gid(enc[c])) * 1000 / ttf.upem));
    f.set(N('Subtype'), N('TrueType')); f.set(N('BaseFont'), N(desc.name)); f.set(N('FirstChar'), PDFNumber.of(first)); f.set(N('LastChar'), PDFNumber.of(lastC));
    f.set(N('Widths'), ctx.obj(widths)); f.set(N('FontDescriptor'), desc.ref);
    if (!f.get(N('ToUnicode'))) f.set(N('ToUnicode'), ctx.register(ctx.flateStream(pdfaBytes(pdfaToUnicodeCMap(enc)))));
    fix(`Embedded ${psName.replace(/-Regular$/, '')} in place of ${was || 'a font that was not embedded'}`);
  }
  // Identity, output intent, metadata.
  out.context.header = L.PDFHeader.forVersion(1, 7);
  if (!(look(ctx.trailerInfo.ID) instanceof PDFArray)) { const id = PDFHexString.of(Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')); ctx.trailerInfo.ID = ctx.obj([id, id]); }
  const icc = ctx.register(ctx.flateStream(pdfaSrgbIcc(), { N: 3 }));
  const intents = cat.lookup(N('OutputIntents')), keep = intents instanceof PDFArray ? intents.asArray().filter((x) => { const o = look(x); return o instanceof PDFDict && pdfaName(L, o.get(N('S'))) !== 'GTS_PDFA1'; }) : [];
  cat.set(N('OutputIntents'), ctx.obj([ctx.register(ctx.obj({ Type: 'OutputIntent', S: 'GTS_PDFA1', OutputConditionIdentifier: PDFString.of('sRGB IEC61966-2.1'), Info: PDFString.of('sRGB IEC61966-2.1'), DestOutputProfile: icc })), ...keep]));
  const info = out.getInfoDict();
  for (const k of ['CreationDate', 'ModDate']) { const v = pdfaText(L, info, k), d = v ? pdfaParseDate(v) : null; if (d) info.set(N(k), PDFString.fromDate(d)); else if (v != null) info.delete(N(k)); }
  if (!pdfaText(L, info, 'ModDate')) info.set(N('ModDate'), PDFString.fromDate(new Date()));
  if (!pdfaText(L, info, 'CreationDate')) info.set(N('CreationDate'), PDFString.fromDate(new Date()));
  for (const [k, v] of [...info.entries()]) if (!(look(v) instanceof PDFString || look(v) instanceof PDFHexString || look(v) instanceof PDFName)) info.delete(k);
  const xmpBefore = pdfaReadXmp(pdfaXmpOf(L, out));
  pdfaWriteXmp(L, out, { pdfa: { part, conformance }, pdfua: xmpBefore.props['pdfuaid:part'] ? { part: xmpBefore.props['pdfuaid:part'] } : null, extensions: opts.extensions, props: opts.props });
  if (xmpBefore.foreign.some((x, k) => !PDFA_PREDEFINED.has(xmpBefore.foreignNs[k]))) fix('Removed metadata PDF/A doesn\'t know');
  if (cat.get(N('Perms'))) { const pm = cat.lookup(N('Perms')); if (pm instanceof PDFDict) for (const k of pm.keys()) if (!/^(DocMDP|UR3)$/.test(k.decodeText())) pm.delete(k); }
  if (cat.get(N('Requirements'))) cat.delete(N('Requirements'));
  // What nothing refers to any more (a removed script, an old font) is not written.
  const live = pdfaReachable(L, out).refs;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!live.has(ref.tag)) ctx.delete(ref);
  return { bytes: await out.save({ useObjectStreams: true }), fixes: [...fixes] };
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
    for (const [f, w] of fonts) {
      const sub = pdfaName(L, f.get(N('Subtype'))); if (f.get(N('ToUnicode'))) continue;
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
  rule('colour', () => {
    const oi = cat.lookup(N('OutputIntents')); const icc = oi instanceof PDFArray && oi.size() ? (() => { const o = look(oi.get(0)); const s = o instanceof PDFDict ? o.lookup(N('DestOutputProfile')) : null; return s instanceof PDFStream ? pdfaIccInfo(pdfaStreamBytes(L, s)) : null; })() : null;
    if (icc && icc.space === 'CMYK') return;
    let cmyk = 0;
    out.getPages().forEach((p, i) => {
      if (cmyk > 2) return;
      let res; try { res = p.node.Resources(); } catch { return; }
      const dc = res && res.lookup(N('ColorSpace')); if (dc instanceof PDFDict && dc.get(N('DefaultCMYK'))) return;
      const cs = res && res.lookup(N('ColorSpace')); const csCmyk = cs instanceof PDFDict && [...cs.entries()].some(([, v]) => pdfaName(L, look(v)) === 'DeviceCMYK');
      const xo = res && res.lookup(N('XObject')); const imgCmyk = xo instanceof PDFDict && [...xo.entries()].some(([, v]) => { const s = look(v); return s instanceof PDFStream && pdfaName(L, look(s.dict.get(N('ColorSpace')))) === 'DeviceCMYK'; });
      let ops = false;
      try { const c = p.node.Contents(); const parts = c instanceof PDFArray ? c.asArray().map(look) : [c]; for (const s of parts) { const b = s instanceof PDFStream ? pdfaStreamBytes(L, s) : null; if (b && /(^|[\s\]])-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+-?[\d.]+\s+[kK](?=[\s/[(<]|$)/.test(pdfaLatin1(b))) { ops = true; break; } } } catch {}
      if (csCmyk || imgCmyk || ops) { cmyk++; bad(`Page ${i + 1} uses CMYK colour, which an sRGB output intent doesn't cover.`, { page: i + 1, fix: 'manual' }); }
    });
  });
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

/* ----- Save as PDF/A… ----- */
const PDFA_LEVELS = [['2b', 'PDF/A-2b', 'For most documents. Keeps how every page looks.'], ['2u', 'PDF/A-2u', 'Also makes sure all text can be searched and copied.'], ['3b', 'PDF/A-3b', 'Like PDF/A-2b, and keeps attachments of any kind.']];
let pdfaBusy = false;
async function pdfaSave(level) {
  if (!has() || pdfaBusy) return;
  if (!level) {
    const body = `<p class="pdfa-intro">An archival copy that opens the same way for years: fonts are embedded, colours are defined, and scripts are removed.</p>
      <div class="pdfa-levels" role="radiogroup" aria-label="Kind of PDF/A">${PDFA_LEVELS.map(([v, t, d], k) => `<label class="pdfa-level"><input type="radio" name="pdfaLevel" value="${v}"${k ? '' : ' checked'}><span><b>${t}</b><small>${esc(d)}</small></span></label>`).join('')}</div>`;
    let pick = '2b';
    const a = await dialog('Save as PDF/A', body, [{ label: 'Cancel' }, { label: 'Save', value: 'ok', primary: true }], (dlg) => { dlg.classList.add('pdfa-dlg'); $$('[name="pdfaLevel"]', dlg).forEach((i) => i.addEventListener('change', () => { pick = i.value; })); dlg.addEventListener('close', () => dlg.classList.remove('pdfa-dlg'), { once: true }); });
    if (a !== 'ok') return;
    level = pick;
  }
  pdfaBusy = true;
  try {
    let part = +level[0], conformance = level[1].toUpperCase();
    const bytes = await buildPdf(); if (!bytes) return;
    const L = await loadPdfLib();
    let enc = false; try { enc = (await L.PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false })).isEncrypted; } catch {}
    if (enc) { await dialog('Save as PDF/A', '<p>PDF/A files can\'t have a password. Remove it to continue.</p>', [{ label: 'OK', primary: true }]); return; }
    toast('Making the PDF/A file…');
    let res = await pdfaConvert(bytes, { part, conformance });
    if (res.blocked === 'attachments') {
      const a = await dialog('Attachments', `<p>PDF/A-2 only keeps attachments that are PDF/A files too. ${esc(res.names.slice(0, 3).join(', '))}${res.names.length > 3 ? ' and others' : ''} ${res.names.length === 1 ? 'is' : 'are'} not. PDF/A-3b keeps them.</p>`, [{ label: 'Cancel' }, { label: 'Use PDF/A-3b', value: '3b', primary: true }]);
      if (a !== '3b') return;
      part = 3; conformance = 'B';
      res = await pdfaConvert(bytes, { part, conformance });
    }
    const check = await pdfaCheck(res.bytes, { part, conformance });
    const errs = check.filter((x) => x.severity === 'error');
    const label = `PDF/A-${part}${conformance.toLowerCase()}`;
    let out = res.bytes, name = `${doc.name} (PDF-A).pdf`;
    if (errs.length) {
      const body = `<p class="pdfa-sum">${esc(pdfaSummary(check))}</p>
        <ul class="pdfa-probs">${errs.slice(0, 12).map((x) => `<li>${ic('circle-alert')}<span>${esc(x.text)}</span></li>`).join('')}${errs.length > 12 ? `<li><span>…and ${errs.length - 12} more</span></li>` : ''}</ul>
        <p class="pdfa-note">This is a built-in check, not a certified validator.</p>`;
      const a = await dialog(`Not ${label} yet`, body, [{ label: 'Cancel' }, { label: 'Save anyway (not PDF/A)', value: 'anyway' }], (dlg) => { dlg.classList.add('pdfa-dlg'); dlg.addEventListener('close', () => dlg.classList.remove('pdfa-dlg'), { once: true }); });
      if (a !== 'anyway') return;
      out = await pdfaDropClaim(res.bytes); name = `${doc.name} (archive).pdf`;
    }
    const saved = await saveFile(out, name, 'application/pdf');
    window.__lastPdfa = { bytes: out, check, fixes: res.fixes, part, conformance };
    if (saved && !errs.length) toast(`Saved as ${label}. ${pdfaPlural(check.passed.length, 'built-in check')} passed.`);
  } catch (e) { console.error(e); toast(`Could not save as PDF/A: ${e.message || e}`); }
  finally { pdfaBusy = false; }
}

cmd('savePdfa', { label: 'Save as PDF/A…', rlabel: 'Save as PDF/A', icon: 'archive', enabled: has, run: () => pdfaSave() });
{ const fm = MENUS.find(([t]) => t === 'File'), i = fm ? fm[1].indexOf('saveCopy') : -1; if (i >= 0) fm[1].splice(i + 1, 0, 'savePdfa'); else menuAdd('File', ['savePdfa']); }
ribbonAdd('export', 'Archive', ['savePdfa'], 'Export');
Object.assign(TEST_HOOKS, { pdfaCheck, pdfaConvert, pdfaSrgbIcc: () => Array.from(pdfaSrgbIcc()), pdfaSave, pdfaSummary, pdfaLast: () => window.__lastPdfa && { bytes: Array.from(window.__lastPdfa.bytes), check: [...window.__lastPdfa.check], fixes: window.__lastPdfa.fixes } });

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
`);
