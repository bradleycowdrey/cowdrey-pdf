/* ---------------- certificate signatures: sign with a certificate, timestamps, checking signatures ----------------
   Protect → Certificate: "Sign with certificate…", "Signatures" and "Signing IDs…".

   Signing IDs are PKCS#12 files (.p12 or .pfx): imported, or made here (a self-signed certificate, RSA-2048 or
   ECDSA P-256, valid 5 years). They are kept in IndexedDB still encrypted with their password, which is never stored:
   it is asked for at each signing ("Remember until I close the app" keeps it in memory only).

   Signing writes a PAdES signature (ETSI.CAdES.detached, or adbe.pkcs7.detached) as an incremental update appended to
   the file: the bytes before it are left exactly as they were, so earlier signatures stay valid (a second signer). An
   unedited document is signed as it was opened; one with changes is saved first (buildPdf) and that is signed. The
   update is written by hand here: the signature dictionary with a fixed-width /ByteRange and a /Contents hole, the
   field's widget and appearance, the AcroForm (/SigFlags 3), the page's /Annots when the field is new, and an xref
   section of the same kind as the file's last one (a table, or a stream), with /Prev pointing at it.
   The CMS SignedData (detached; contentType, messageDigest, signingCertificateV2, and signingTime for PKCS#7) is made
   with pkijs and asn1js through WebCrypto. node-forge only reads and writes PKCS#12 files, because WebCrypto has none
   of their ciphers (RC2-40 and 3DES in older files).
   A timestamp (RFC 3161) is optional and off until a timestamp server is set: only a SHA-256 fingerprint of the
   signature value is sent. In the apps it goes through a native call (tsa_post), so the server needs no CORS.

   Opening a signed PDF checks every signature: what /ByteRange covers, the digest, the signer's signature, the
   certificate, the timestamp, and whether the file was changed after signing (and if those changes look allowed:
   comments, form filling, more signatures). Nothing is trusted unless you trust a certificate on this device (kept
   by its SHA-256 fingerprint). Revocation (CRL, OCSP) is not checked.

   Libraries are loaded on first use from pinned files (the apps carry copies, see desktop/build.mjs). pkijs and asn1js
   are ES modules with bare imports: they are fetched and linked here through blob URLs. pkijs's @noble/hashes and
   bytestreamjs imports are only used by its own PKCS#12 and certificate-transparency code, which is not used here:
   they are given small stand-ins. */
const SG_URLS = {
  pvutils: 'https://cdn.jsdelivr.net/npm/pvutils@1.2.0/build/utils.es.js',
  pvtsutils: 'https://cdn.jsdelivr.net/npm/pvtsutils@1.3.6/build/index.es.js',
  asn1js: 'https://cdn.jsdelivr.net/npm/asn1js@3.0.6/build/index.es.js',
  pkijs: 'https://cdn.jsdelivr.net/npm/pkijs@3.2.5/build/index.es.js',
  forge: 'https://cdn.jsdelivr.net/npm/node-forge@1.3.1/dist/forge.min.js',
};
const SG_OID = {
  data: '1.2.840.113549.1.7.1', signedData: '1.2.840.113549.1.7.2', contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4',
  signingTime: '1.2.840.113549.1.9.5', signingCertV2: '1.2.840.113549.1.9.16.2.47', tsToken: '1.2.840.113549.1.9.16.2.14', tstInfo: '1.2.840.113549.1.9.16.1.4',
  sha1: '1.3.14.3.2.26', sha256: '2.16.840.1.101.3.4.2.1', sha384: '2.16.840.1.101.3.4.2.2', sha512: '2.16.840.1.101.3.4.2.3',
  cn: '2.5.4.3', o: '2.5.4.10', ou: '2.5.4.11', c: '2.5.4.6', email: '1.2.840.113549.1.9.1',
};
const SG_HASH = { [SG_OID.sha1]: 'SHA-1', [SG_OID.sha256]: 'SHA-256', [SG_OID.sha384]: 'SHA-384', [SG_OID.sha512]: 'SHA-512' };
const SG_CADES = 'ETSI.CAdES.detached', SG_PKCS7 = 'adbe.pkcs7.detached';
const SG_STATUS = {
  trusted: ['Valid, signer trusted', 'shield-check', 'ok'], valid: ['Valid, signer not verified', 'shield-question', 'warn'],
  changed: ['Changed after signing', 'shield-alert', 'warn'], invalid: ['Invalid', 'shield-x', 'bad'],
};
class SgError extends Error {}
let sgLibs = null, sgForgeP = null;
const sgPasswords = new Map(); // signing ID -> password, for this session only ("Remember until I close the app")
let sgState = { sigs: [], bytes: null, checking: null }; // the signatures of the document shown
const sgPrefs = () => Object.assign({ tsa: '', subFilter: SG_CADES }, store.get('signing', {}));
const sgSetPrefs = (o) => store.set('signing', { ...sgPrefs(), ...o });

/* ---- libraries ---- */
function sgLoadLibs() {
  return sgLibs || (sgLibs = (async () => {
    const blob = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const no = 'const no = () => { throw new Error("Not available in Cowdrey.PDF"); };\n';
    const map = {
      '@noble/hashes/sha1': blob(no + 'export const sha1 = no;'),
      '@noble/hashes/sha256': blob(no + 'export const sha256 = no;'),
      '@noble/hashes/sha512': blob(no + 'export const sha512 = no, sha384 = no;'),
      bytestreamjs: blob('export {};'),
    };
    const link = (code, url) => {
      const out = code.replace(/(\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g, (w, a, q, spec) => map[spec] ? a + q + map[spec] + q : w);
      if (/\bfrom\s*['"](?!blob:)/.test(out)) throw new Error('Could not link ' + url);
      return out;
    };
    for (const k of ['pvutils', 'pvtsutils', 'asn1js', 'pkijs']) {
      const r = await fetch(SG_URLS[k]);
      if (!r.ok) throw new Error('Could not load ' + SG_URLS[k]);
      map[k] = blob(link(await r.text(), SG_URLS[k]));
    }
    const [asn1js, pkijs] = await Promise.all([import(map.asn1js), import(map.pkijs)]);
    return { asn1js, pkijs };
  })().catch((e) => { sgLibs = null; throw e; }));
}
function sgForge() {
  return sgForgeP || (sgForgeP = new Promise((res, rej) => {
    if (window.forge && window.forge.pkcs12) return res(window.forge);
    const s = document.createElement('script'); s.src = SG_URLS.forge; s.async = true;
    s.onload = () => window.forge ? res(window.forge) : rej(new Error('node-forge did not load'));
    s.onerror = () => { s.remove(); sgForgeP = null; rej(new Error('Could not load ' + SG_URLS.forge)); };
    document.head.appendChild(s);
  }));
}

/* ---- bytes ---- */
const sgEnc = new TextEncoder();
const sgLatin1 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return s; };
const sgFromLatin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
const sgHex = (u) => [...new Uint8Array(u)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sgUnhex = (h) => { h = h.replace(/[^0-9a-fA-F]/g, ''); if (h.length % 2) h += '0'; const u = new Uint8Array(h.length / 2); for (let i = 0; i < u.length; i++) u[i] = parseInt(h.substr(i * 2, 2), 16); return u; };
const sgEq = (a, b) => { a = new Uint8Array(a); b = new Uint8Array(b); if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const sgCat = (list) => { let n = 0; for (const p of list) n += p.length; const u = new Uint8Array(n); let o = 0; for (const p of list) { u.set(p, o); o += p.length; } return u; };
const sgDigest = async (alg, data) => new Uint8Array(await crypto.subtle.digest(alg, data));
const sgFp = async (der) => sgHex(await sgDigest('SHA-256', der)).toUpperCase();
// A PDF text string: UTF-16BE with its byte order mark, as hex (any language, nothing to escape).
const sgPdfText = (s) => { let h = 'FEFF'; for (const c of String(s)) { const n = c.codePointAt(0); if (n > 0xffff) { const v = n - 0x10000; h += (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 0x3ff)).toString(16).padStart(4, '0'); } else h += n.toString(16).padStart(4, '0'); } return '<' + h.toUpperCase() + '>'; };
// D:YYYYMMDDHHmmSS+HH'mm' in local time
function sgPdfDate(d) {
  const p = (n, k = 2) => String(Math.abs(n)).padStart(k, '0'), off = -d.getTimezoneOffset();
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}'${p(Math.abs(off) % 60)}'`;
}
function sgParsePdfDate(s) {
  const m = /D:(\d{4})(\d\d)?(\d\d)?(\d\d)?(\d\d)?(\d\d)?([Zz+-])?(\d\d)?'?(\d\d)?/.exec(s || ''); if (!m) return null;
  const [, y, mo = '01', da = '01', h = '00', mi = '00', se = '00', z, oh = '00', om = '00'] = m;
  let t = Date.UTC(+y, +mo - 1, +da, +h, +mi, +se);
  if (z === '+' || z === '-') t -= (z === '+' ? 1 : -1) * (+oh * 60 + +om) * 60000;
  else if (!z) t += new Date(t).getTimezoneOffset() * 60000; // no zone: local time
  return new Date(t);
}
const sgWhen = (d) => d ? d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

/* ---- reading a PDF's structure (enough for the trailer, xref sections and revisions) ---- */
// One PDF object from s at i: dict -> plain object (keys without the slash), array, number, '/Name', { ref: [n, g] },
// { hex }, { str } (raw, escapes kept), true/false/null.
function sgParse(s, i) {
  const DELIM = /[\s()<>\[\]{}\/%]/;
  const ws = () => { for (;;) { while (i < s.length && /[\x00\t\n\f\r ]/.test(s[i])) i++; if (s[i] === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; } else return; } };
  const token = () => { const j = i; while (i < s.length && !DELIM.test(s[i])) i++; return s.slice(j, i); };
  const name = () => token().replace(/#([0-9a-fA-F]{2})/g, (w, h) => String.fromCharCode(parseInt(h, 16))); // /T#79pe is /Type
  const value = (depth) => {
    if (depth > 60) throw new Error('Nested too deeply');
    ws(); const c = s[i];
    if (c === '<' && s[i + 1] === '<') {
      i += 2; const d = {};
      for (;;) { ws(); if (s[i] === '>' && s[i + 1] === '>') { i += 2; return d; } if (s[i] !== '/') throw new Error('Bad dictionary at ' + i); i++; const k = name(); d[k] = value(depth + 1); }
    }
    if (c === '<') { const j = s.indexOf('>', i); if (j < 0) throw new Error('Bad hex string'); const h = s.slice(i + 1, j); i = j + 1; return { hex: h.replace(/\s+/g, '') }; }
    if (c === '[') { i++; const a = []; for (;;) { ws(); if (s[i] === ']') { i++; return a; } if (i >= s.length) throw new Error('Bad array'); a.push(value(depth + 1)); } }
    if (c === '(') { let d = 0; const j = i; for (; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) { i++; break; } } return { str: s.slice(j + 1, i - 1) }; }
    if (c === '/') { i++; return '/' + name(); }
    const t = token(); if (!t) throw new Error('Bad object at ' + i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) {
      if (/^\d+$/.test(t)) { const m = /^\s+(\d+)\s+R(?=[\s()<>\[\]{}\/%]|$)/.exec(s.slice(i, i + 32)); if (m) { i += m[0].length; return { ref: [+t, +m[1]] }; } }
      return +t;
    }
    if (t === 'true') return true; if (t === 'false') return false; if (t === 'null') return null;
    return { kw: t };
  };
  const v = value(0);
  return [v, i];
}
const sgRefStr = (r) => r && r.ref ? `${r.ref[0]} ${r.ref[1]} R` : null;
async function sgInflate(u) {
  const ds = new DecompressionStream('deflate');
  const out = new Response(new Blob([u]).stream().pipeThrough(ds));
  return new Uint8Array(await out.arrayBuffer());
}
async function sgDeflate(u) {
  if (typeof CompressionStream === 'undefined') return null;
  const out = new Response(new Blob([u]).stream().pipeThrough(new CompressionStream('deflate')));
  return new Uint8Array(await out.arrayBuffer());
}
// PNG predictors (xref streams use them: Predictor 12, Columns n)
function sgUnpredict(u, cols, colors = 1, bpc = 8) {
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8)), row = Math.ceil(cols * colors * bpc / 8), out = new Uint8Array(Math.floor(u.length / (row + 1)) * row);
  let prev = new Uint8Array(row);
  for (let r = 0, o = 0; (r + 1) * (row + 1) <= u.length; r++) {
    const f = u[r * (row + 1)], cur = u.subarray(r * (row + 1) + 1, (r + 1) * (row + 1)), line = new Uint8Array(row);
    for (let k = 0; k < row; k++) {
      const a = k >= bpp ? line[k - bpp] : 0, b = prev[k], c = k >= bpp ? prev[k - bpp] : 0;
      let x = cur[k];
      if (f === 1) x += a; else if (f === 2) x += b; else if (f === 3) x += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); x += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[k] = x & 255;
    }
    out.set(line, o); o += row; prev = line;
  }
  return out;
}
// The cross-reference section at `off`: { type: 'table'|'stream', trailer, entries: [[num, gen, inUse, kind, a, b]] }
// (kind 0 free, 1 at offset a, 2 in object stream a at index b)
async function sgXrefAt(u, s, off) {
  let i = off; while (/\s/.test(s[i])) i++;
  if (s.startsWith('xref', i)) {
    const t = s.indexOf('trailer', i); if (t < 0) throw new Error('No trailer');
    const toks = s.slice(i + 4, t).trim().split(/\s+/).filter(Boolean), entries = [];
    for (let k = 0; k + 1 < toks.length;) {
      const start = +toks[k], count = +toks[k + 1]; k += 2;
      for (let j = 0; j < count && k + 2 < toks.length + 1; j++, k += 3) entries.push([start + j, +toks[k + 1], toks[k + 2] === 'n', toks[k + 2] === 'n' ? 1 : 0, +toks[k]]);
    }
    const [trailer] = sgParse(s, t + 7);
    return { type: 'table', trailer, entries, at: i };
  }
  const h = /^(\d+)\s+(\d+)\s+obj/.exec(s.slice(i, i + 40)); if (!h) throw new Error('No cross-reference section at ' + off);
  const [d, j] = sgParse(s, i + h[0].length);
  if (d.Type !== '/XRef') throw new Error('Not a cross-reference stream');
  let k = s.indexOf('stream', j) + 6; if (s[k] === '\r') k++; if (s[k] === '\n') k++;
  let len = typeof d.Length === 'number' ? d.Length : s.indexOf('endstream', k) - k;
  let data = u.subarray(k, k + len);
  const filters = [].concat(d.Filter || []), parms = [].concat(d.DecodeParms || [])[0] || {};
  if (filters.length > 1 || (filters[0] && filters[0] !== '/FlateDecode')) throw new Error('Unsupported xref stream filter');
  if (filters[0]) data = await sgInflate(data);
  if (parms && parms.Predictor >= 10) data = sgUnpredict(data, parms.Columns || 1, parms.Colors || 1, parms.BitsPerComponent || 8);
  const W = d.W, idx = d.Index || [0, d.Size], entries = [], rec = W[0] + W[1] + W[2];
  const num = (p, n) => { let v = 0; for (let q = 0; q < n; q++) v = v * 256 + data[p + q]; return v; };
  for (let a = 0, p = 0; a < idx.length; a += 2) for (let n = 0; n < idx[a + 1] && p + rec <= data.length; n++, p += rec) {
    const type = W[0] ? num(p, W[0]) : 1, f2 = num(p + W[0], W[1]), f3 = num(p + W[0] + W[1], W[2]);
    entries.push([idx[a] + n, type === 1 ? f3 : 0, type !== 0, type, f2, f3]);
  }
  return { type: 'stream', trailer: d, entries, at: i, num: +h[1] };
}
// The last startxref before `end` (the end of the whole file, or of a revision)
function sgStartXref(s, end = s.length) {
  const k = s.lastIndexOf('startxref', end); if (k < 0) throw new SgError('This file has no cross-reference table');
  const m = /startxref\s+(\d+)/.exec(s.slice(k, k + 40)); if (!m) throw new SgError('This file’s cross-reference table could not be read');
  return +m[1];
}
// What an incremental update needs from the file's last section.
async function sgTrailerInfo(u, s) {
  const prev = sgStartXref(s);
  const x = await sgXrefAt(u, s, prev);
  let size = x.trailer.Size || 0, t = x.trailer;
  // a linearized file: the first section's trailer chains to the main one with /Prev
  for (let hop = 0, p = t.Prev; typeof p === 'number' && hop < 32; hop++) {
    try { const y = await sgXrefAt(u, s, p); size = Math.max(size, y.trailer.Size || 0); if (!t.Root) t = { ...y.trailer, ...t }; p = y.trailer.Prev; } catch { break; }
  }
  return { prev, type: x.type, size, root: x.trailer.Root || t.Root, info: x.trailer.Info || t.Info, id: x.trailer.ID || t.ID, encrypt: x.trailer.Encrypt || t.Encrypt };
}

// A parsed dictionary (not a reference, string or keyword)
const sgIsDict = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && !Array.isArray(v.ref) && !(Object.keys(v).length === 1 && (typeof v.hex === 'string' || typeof v.str === 'string' || typeof v.kw === 'string'));
const sgRefNum = (x) => x && Array.isArray(x.ref) ? x.ref[0] : -1;
// A parsed string as text: UTF-16BE with a byte order mark, UTF-8 with one, else PDFDocEncoding (as Latin-1)
function sgPdfStr(v) {
  let b;
  if (v && typeof v.hex === 'string') b = sgUnhex(v.hex);
  else if (v && typeof v.str === 'string') {
    const t = v.str, o = [], E = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
    for (let i = 0; i < t.length; i++) {
      let c = t[i];
      if (c !== '\\') { if (c === '\r') { o.push(10); if (t[i + 1] === '\n') i++; } else o.push(t.charCodeAt(i) & 255); continue; }
      c = t[++i];
      if (c === undefined) break;
      if (c in E) o.push(E[c]);
      else if (/[0-7]/.test(c)) { let d = c; while (d.length < 3 && /[0-7]/.test(t[i + 1] || '')) d += t[++i]; o.push(parseInt(d, 8) & 255); }
      else if (c === '\r') { if (t[i + 1] === '\n') i++; } else if (c !== '\n') o.push(t.charCodeAt(i) & 255);
    }
    b = new Uint8Array(o);
  } else return null;
  if (b[0] === 0xfe && b[1] === 0xff) { let r = ''; for (let i = 2; i + 1 < b.length; i += 2) r += String.fromCharCode((b[i] << 8) | b[i + 1]); return r; }
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder().decode(b.subarray(3));
  return sgLatin1(b);
}
// A stream's data with its filters undone (FlateDecode and PNG predictors only)
async function sgDecode(d, data) {
  const filters = [].concat(d.Filter || []), parms = [].concat(d.DecodeParms || [])[0] || {};
  if (filters.length > 1 || (filters[0] && filters[0] !== '/FlateDecode')) throw new Error('Unsupported stream filter');
  if (filters[0]) data = await sgInflate(data);
  if (sgIsDict(parms) && parms.Predictor >= 10) data = sgUnpredict(data, parms.Columns || 1, parms.Colors || 1, parms.BitsPerComponent || 8);
  return data;
}
// The object at `off` ("n g obj … endobj"): { num, gen, v, stream (its raw data, or null), at, endAt }, or null when
// there is none. `len` resolves an indirect /Length.
async function sgObjAt(u, s, off, len) {
  const h = /^(\d+)[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+obj(?=[\s()<>\[\]{}\/%]|$)/.exec(s.slice(off, off + 48)); if (!h) return null;
  const [v, j] = sgParse(s, off + h[0].length);
  let stream = null, endAt = j;
  const m = /^[\x00\t\n\f\r ]*stream(\r\n|\n|\r)?/.exec(s.slice(j, j + 64));
  if (m && sgIsDict(v)) {
    const k = j + m[0].length;
    let n = Number.isInteger(v.Length) ? v.Length : Array.isArray(v.Length && v.Length.ref) && len ? await len(v.Length) : -1;
    if (!(n >= 0) || !/^[\x00\t\n\f\r ]*endstream/.test(s.slice(k + n, k + n + 64))) { const e = s.indexOf('endstream', k); n = (e < 0 ? s.length : e) - k; }
    stream = u.subarray(k, k + n); endAt = k + n;
  }
  const e = s.indexOf('endobj', endAt);
  return { num: +h[1], gen: +h[2], v, stream, at: off, endAt: e < 0 ? endAt : e + 6 };
}
// One revision as a PDF reader sees it: the objects that its cross-reference sections point at, newest first; in a
// hybrid file a table's /XRefStm comes before its /Prev (as in pdf.js). Offsets at or past `limit` are not part of it.
// { map: num -> entry, trailer, get(num) -> object or null (throws when the entry points at no such object) }
async function sgRevision(u, s, start, limit = u.length) {
  const map = new Map(), queue = [start], seen = new Set(), trailer = {};
  while (queue.length) {
    const off = queue.shift(); if (seen.has(off)) continue;
    if (seen.size > 500 || !(off >= 0 && off < limit)) throw new Error('Bad cross-reference chain');
    seen.add(off);
    const x = await sgXrefAt(u, s, off);
    for (const e of x.entries) if (!map.has(e[0])) map.set(e[0], e);
    for (const k of ['Root', 'Info', 'Encrypt', 'ID']) if (trailer[k] === undefined && x.trailer[k] !== undefined) trailer[k] = x.trailer[k];
    if (x.type === 'table' && Number.isInteger(x.trailer.XRefStm)) queue.push(x.trailer.XRefStm);
    if (Number.isInteger(x.trailer.Prev)) queue.push(x.trailer.Prev);
  }
  const cache = new Map(), stms = new Map();
  const lenOf = async (r) => { const o = await get(sgRefNum(r)); return o && Number.isInteger(o.v) ? o.v : -1; };
  const objStm = (n) => stms.get(n) || (stms.set(n, (async () => {
    const e = map.get(n); if (!e || e[3] !== 1 || e[4] >= limit) throw new Error('No object stream ' + n);
    const o = await sgObjAt(u, s, e[4], lenOf);
    if (!o || o.num !== n || !o.stream || !sgIsDict(o.v) || o.v.Type !== '/ObjStm') throw new Error('Bad object stream ' + n);
    return sgObjStmItems(o);
  })()), stms.get(n));
  function get(n) {
    if (cache.has(n)) return cache.get(n);
    const p = (async () => {
      const e = map.get(n); if (!e || !e[2]) return null;
      if (e[3] === 1) {
        if (e[4] >= limit) return null;
        const o = await sgObjAt(u, s, e[4], lenOf);
        if (!o || o.num !== n) throw new Error('Object ' + n + ' is not where the cross-reference table says');
        return o;
      }
      if (e[3] === 2) { const it = (await objStm(e[4]))[e[5]]; if (!it || it.num !== n) throw new Error('Object ' + n + ' is not in its object stream'); return it; }
      throw new Error('Bad cross-reference entry for ' + n);
    })();
    cache.set(n, p); return p;
  }
  return { map, trailer, get };
}
// The objects inside an object stream: [{ num, v, stream: null }]
async function sgObjStmItems(o) {
  const t = sgLatin1(await sgDecode(o.v, o.stream)), first = o.v.First, count = o.v.N;
  const head = t.slice(0, first).trim().split(/\s+/).map(Number), out = [];
  for (let k = 0; k < count && 2 * k + 1 < head.length; k++) {
    try { out.push({ num: head[2 * k], v: sgParse(t, first + head[2 * k + 1])[0], stream: null }); } catch { out.push(null); }
  }
  return out;
}

/* ---- the signing IDs and trusted certificates, kept in IndexedDB ---- */
let sgDbP = null;
function sgDb() {
  return sgDbP || (sgDbP = new Promise((res, rej) => {
    const r = indexedDB.open(KEY + '-signing', 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('ids')) d.createObjectStore('ids', { keyPath: 'id' }); if (!d.objectStoreNames.contains('trust')) d.createObjectStore('trust', { keyPath: 'fp' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => { sgDbP = null; rej(r.error); };
  }));
}
async function sgTx(name, mode, fn) {
  const d = await sgDb();
  return new Promise((res, rej) => { const t = d.transaction(name, mode), q = fn(t.objectStore(name)); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
}
const sgIdsAll = async () => ((await sgTx('ids', 'readonly', (s) => s.getAll())) || []).sort((a, b) => b.added - a.added);
const sgIdPut = (rec) => sgTx('ids', 'readwrite', (s) => s.put(rec));
const sgIdDel = (id) => sgTx('ids', 'readwrite', (s) => s.delete(id));
const sgTrustAll = async () => new Set(((await sgTx('trust', 'readonly', (s) => s.getAll())) || []).map((r) => r.fp));
const sgTrustPut = (fp, name) => sgTx('trust', 'readwrite', (s) => s.put({ fp, name, added: Date.now() }));
const sgTrustDel = (fp) => sgTx('trust', 'readwrite', (s) => s.delete(fp));

/* ---- certificates ---- */
function sgNameOf(rdn) {
  const o = {}, keys = { [SG_OID.cn]: 'cn', [SG_OID.o]: 'o', [SG_OID.ou]: 'ou', [SG_OID.c]: 'c', [SG_OID.email]: 'email' };
  for (const tv of rdn.typesAndValues) { const k = keys[tv.type]; if (k && !o[k]) o[k] = String(tv.value.valueBlock.value); }
  return o;
}
const sgNameText = (n) => [n.cn, n.ou, n.o, n.c].filter(Boolean).join(', ') || n.email || 'Unknown';
async function sgCertInfo(der) {
  const { pkijs } = await sgLoadLibs();
  der = new Uint8Array(der);
  const c = pkijs.Certificate.fromBER(der);
  const subject = sgNameOf(c.subject), issuer = sgNameOf(c.issuer);
  for (const e of c.extensions || []) {
    if (e.extnID === '2.5.29.17' && e.parsedValue && !subject.email) { const n = (e.parsedValue.altNames || []).find((a) => a.type === 1); if (n) subject.email = String(n.value); }
  }
  const alg = c.subjectPublicKeyInfo.algorithm.algorithmId;
  return {
    subject, issuer, name: subject.cn || subject.o || subject.email || 'Unknown', serial: sgHex(c.serialNumber.valueBlock.valueHexView).toUpperCase(),
    notBefore: c.notBefore.value, notAfter: c.notAfter.value, fp: await sgFp(der),
    selfSigned: sgEq(c.subject.toSchema().toBER(), c.issuer.toSchema().toBER()),
    key: alg === '1.2.840.10045.2.1' ? 'ECDSA' : alg === '1.2.840.113549.1.1.10' ? 'RSA-PSS' : 'RSA', cert: c, der,
  };
}

/* ---- PKCS#12 ---- */
const SG_CURVES = { '1.2.840.10045.3.1.7': ['P-256', 'SHA-256'], '1.3.132.0.34': ['P-384', 'SHA-384'], '1.3.132.0.35': ['P-521', 'SHA-512'] };
// Opens a signing ID: { key (CryptoKey), hash, chain: [der, …] (the signer first), info }
async function sgOpenP12(bytes, password) {
  const forge = await sgForge(), A = forge.asn1, P = forge.pki;
  let asn, p12;
  try { asn = A.fromDer(forge.util.createBuffer(sgLatin1(new Uint8Array(bytes))), false); }
  catch { throw new SgError('This file is not a signing ID (.p12 or .pfx).'); }
  try { p12 = forge.pkcs12.pkcs12FromAsn1(asn, false, password); }
  catch (e) { console.warn(e); throw new SgError(/password|MAC|decrypt|Too few bytes|Invalid/i.test(e.message || '') ? 'That password is not right for this signing ID.' : 'This signing ID could not be read: ' + (e.message || e)); }
  const bags = (t) => (p12.getBags({ bagType: t })[t] || []);
  const keys = [...bags(P.oids.pkcs8ShroudedKeyBag), ...bags(P.oids.keyBag)];
  const certs = bags(P.oids.certBag).map((b) => ({ b, der: sgFromLatin1(A.toDer(b.cert ? P.certificateToAsn1(b.cert) : b.asn1).getBytes()) }));
  if (!keys.length) throw new SgError('This file has no private key, so it can’t sign. Ask for the .p12 or .pfx that has your key.');
  if (!certs.length) throw new SgError('This file has no certificate.');
  const kid = (b) => ((b.attributes || {}).localKeyId || [])[0];
  let key = keys[0], leaf = null;
  // the certificate that goes with a key: the same localKeyId, or the same RSA modulus
  for (const k of keys) { const id = kid(k); const c = id && certs.find((x) => kid(x.b) === id); if (c) { key = k; leaf = c; break; } }
  if (!leaf && key.key) leaf = certs.find((x) => x.b.cert && x.b.cert.publicKey && x.b.cert.publicKey.n && x.b.cert.publicKey.n.equals(key.key.n));
  const infos = await Promise.all(certs.map((c) => sgCertInfo(c.der)));
  if (!leaf) { // the one no other certificate was issued by
    const k = infos.findIndex((x, n) => !infos.some((y, m) => m !== n && sgNameText(y.issuer) === sgNameText(x.subject) && !y.selfSigned) || infos.length === 1);
    leaf = certs[Math.max(0, k)];
  }
  const li = infos[certs.indexOf(leaf)];
  // the chain, signer first, then each issuer found in the file, then the rest
  const order = [certs.indexOf(leaf)];
  for (let cur = li; !cur.selfSigned;) {
    const n = infos.findIndex((x, m) => !order.includes(m) && sgNameText(x.subject) === sgNameText(cur.issuer)); if (n < 0) break; order.push(n); cur = infos[n];
  }
  infos.forEach((_, n) => { if (!order.includes(n)) order.push(n); });
  const keyDer = sgFromLatin1(A.toDer(key.key ? P.wrapRsaPrivateKey(P.privateKeyToAsn1(key.key)) : key.asn1).getBytes());
  const algOid = key.key ? '1.2.840.113549.1.1.1' : A.derToOid(key.asn1.value[1].value[0].value);
  let alg, hash = 'SHA-256';
  if (algOid === '1.2.840.113549.1.1.1') alg = { name: 'RSASSA-PKCS1-v1_5', hash };
  else if (algOid === '1.2.840.10045.2.1') {
    const curve = SG_CURVES[A.derToOid(key.asn1.value[1].value[1].value)];
    if (!curve) throw new SgError('This signing ID uses an elliptic curve Cowdrey.PDF can’t sign with.');
    hash = curve[1]; alg = { name: 'ECDSA', namedCurve: curve[0] };
  } else throw new SgError('This signing ID uses a kind of key Cowdrey.PDF can’t sign with.');
  let cryptoKey;
  try { cryptoKey = await crypto.subtle.importKey('pkcs8', keyDer, alg, false, ['sign']); }
  catch (e) { console.warn(e); throw new SgError('This device can’t use the key in this signing ID.'); }
  return { key: cryptoKey, hash, alg, chain: order.map((n) => certs[n].der), info: li, infos: order.map((n) => infos[n]) };
}
// A PKCS#12 file for a key and its certificate: the key encrypted with AES-256 (PBKDF2 with SHA-256), an HMAC-SHA-256
// MAC, as OpenSSL 3 writes them.
async function sgMakeP12(pkcs8, chain, password, friendly) {
  const forge = await sgForge(), A = forge.asn1, P = forge.pki, U = A.Class.UNIVERSAL, T = A.Type, CS = A.Class.CONTEXT_SPECIFIC;
  const oid = (o) => A.create(U, T.OID, false, A.oidToDer(o).getBytes());
  const seq = (v) => A.create(U, T.SEQUENCE, true, v), set = (v) => A.create(U, T.SET, true, v), oct = (b) => A.create(U, T.OCTETSTRING, false, b);
  const localKeyId = forge.md.sha1.create().update(sgLatin1(chain[0])).digest().getBytes();
  const attrs = set([seq([oid(P.oids.localKeyId), set([oct(localKeyId)])]), seq([oid(P.oids.friendlyName), set([A.create(U, T.BMPSTRING, false, friendly)])])]);
  const keyAsn = A.fromDer(forge.util.createBuffer(sgLatin1(pkcs8)));
  const enc = P.encryptPrivateKeyInfo(keyAsn, password, { algorithm: 'aes256', count: 20000, prfAlgorithm: 'sha256', saltSize: 16 });
  const keyBag = seq([oid(P.oids.pkcs8ShroudedKeyBag), A.create(CS, 0, true, [enc]), attrs]);
  const certBags = chain.map((der, n) => seq([oid(P.oids.certBag), A.create(CS, 0, true, [seq([oid(P.oids.x509Certificate), A.create(CS, 0, true, [oct(sgLatin1(der))])])]), ...(n ? [] : [attrs])]));
  const ci = (contents) => seq([oid(P.oids.data), A.create(CS, 0, true, [oct(A.toDer(seq(contents)).getBytes())])]);
  const safe = seq([ci(certBags), ci([keyBag])]), safeDer = A.toDer(safe).getBytes();
  const salt = forge.random.getBytesSync(16), count = 2048;
  const macKey = forge.pkcs12.generateKey(password, forge.util.createBuffer(salt), 3, count, 32, forge.md.sha256.create());
  const h = forge.hmac.create(); h.start('sha256', macKey); h.update(safeDer);
  const mac = seq([seq([seq([oid(P.oids.sha256), A.create(U, T.NULL, false, '')]), oct(h.digest().getBytes())]), oct(salt), A.create(U, T.INTEGER, false, A.integerToDer(count).getBytes())]);
  const pfx = seq([A.create(U, T.INTEGER, false, A.integerToDer(3).getBytes()), seq([oid(P.oids.data), A.create(CS, 0, true, [oct(safeDer)])]), mac]);
  return sgFromLatin1(A.toDer(pfx).getBytes());
}
// A new signing ID: a self-signed certificate for `name` (and email), valid 5 years.
async function sgCreateId({ name, email, kind, password }) {
  const { pkijs, asn1js } = await sgLoadLibs();
  const alg = kind === 'ec' ? { name: 'ECDSA', namedCurve: 'P-256' } : { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const keys = await crypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const cert = new pkijs.Certificate();
  cert.version = 2;
  const serial = crypto.getRandomValues(new Uint8Array(16)); serial[0] = (serial[0] & 0x3f) | 0x40;
  cert.serialNumber = new asn1js.Integer({ valueHex: serial });
  const rdn = () => {
    const n = new pkijs.RelativeDistinguishedNames();
    n.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: SG_OID.cn, value: new asn1js.Utf8String({ value: name }) }));
    if (email) n.typesAndValues.push(new pkijs.AttributeTypeAndValue({ type: SG_OID.email, value: new asn1js.IA5String({ value: email }) }));
    return n;
  };
  cert.subject = rdn(); cert.issuer = rdn();
  const now = new Date(); now.setSeconds(0, 0);
  cert.notBefore.value = new Date(now.getTime() - 60000);
  const end = new Date(now); end.setFullYear(end.getFullYear() + 5); cert.notAfter.value = end;
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  const spk = cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView;
  const ext = (extnID, critical, value) => new pkijs.Extension({ extnID, critical, extnValue: value.toBER(false) });
  cert.extensions = [
    ext('2.5.29.19', true, new pkijs.BasicConstraints({ cA: false }).toSchema()),
    ext('2.5.29.15', true, new asn1js.BitString({ valueHex: new Uint8Array([0xc0]).buffer, unusedBits: 6 })), // digitalSignature, nonRepudiation
    ext('2.5.29.37', false, new pkijs.ExtKeyUsage({ keyPurposes: ['1.3.6.1.5.5.7.3.4', '1.3.6.1.4.1.311.10.3.12'] }).toSchema()), // email protection, document signing
    ext('2.5.29.14', false, new asn1js.OctetString({ valueHex: (await sgDigest('SHA-1', spk)).buffer })),
    ...(email ? [ext('2.5.29.17', false, new pkijs.GeneralNames({ names: [new pkijs.GeneralName({ type: 1, value: email })] }).toSchema())] : []),
  ];
  await cert.sign(keys.privateKey, 'SHA-256');
  const der = new Uint8Array(cert.toSchema(true).toBER(false));
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const p12 = await sgMakeP12(pkcs8, [der], password, name);
  const id = await sgOpenP12(p12, password); // read back, as it will be at signing
  return sgIdRecord(p12, id, kind === 'ec' ? 'ECDSA P-256' : 'RSA 2048', true);
}
function sgIdRecord(p12, id, kind, made) {
  const i = id.info;
  return { id: uid(), p12, name: i.name, email: i.subject.email || '', subject: sgNameText(i.subject), issuer: sgNameText(i.issuer), notBefore: i.notBefore.getTime(), notAfter: i.notAfter.getTime(), fp: i.fp, kind: kind || i.key, made: !!made, selfSigned: i.selfSigned, added: Date.now() };
}

/* ---- the CMS signature ---- */
async function sgSigningCertV2(asn1js, pkijs, cert, der) {
  const hash = await sgDigest('SHA-256', der);
  const issuerSerial = new asn1js.Sequence({ value: [
    new asn1js.Sequence({ value: [new asn1js.Constructed({ idBlock: { tagClass: 3, tagNumber: 4 }, value: [cert.issuer.toSchema()] })] }),
    new asn1js.Integer({ valueHex: cert.serialNumber.valueBlock.valueHexView.slice().buffer }),
  ] });
  // SigningCertificateV2 { certs: [ESSCertIDv2 { hashAlgorithm (default SHA-256), certHash, issuerSerial }] }
  return new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.Sequence({ value: [new asn1js.OctetString({ valueHex: hash.buffer }), issuerSerial] })] })] });
}
// Returns the DER of a ContentInfo with the SignedData.
async function sgMakeCms({ id, content, subFilter, when, tsa }) {
  const { asn1js, pkijs } = await sgLoadLibs();
  const certs = id.chain.map((d) => pkijs.Certificate.fromBER(d)), leaf = certs[0];
  const digest = await sgDigest(id.hash, content);
  const attrs = [
    new pkijs.Attribute({ type: SG_OID.contentType, values: [new asn1js.ObjectIdentifier({ value: SG_OID.data })] }),
    new pkijs.Attribute({ type: SG_OID.messageDigest, values: [new asn1js.OctetString({ valueHex: digest.buffer })] }),
    new pkijs.Attribute({ type: SG_OID.signingCertV2, values: [await sgSigningCertV2(asn1js, pkijs, leaf, id.chain[0])] }),
  ];
  if (subFilter !== SG_CADES) attrs.push(new pkijs.Attribute({ type: SG_OID.signingTime, values: [new asn1js.UTCTime({ valueDate: when })] }));
  const sd = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: SG_OID.data }),
    signerInfos: [new pkijs.SignerInfo({ version: 1, sid: new pkijs.IssuerAndSerialNumber({ issuer: leaf.issuer, serialNumber: leaf.serialNumber }), signedAttrs: new pkijs.SignedAndUnsignedAttributes({ type: 0, attributes: attrs }) })],
    certificates: certs,
  });
  await sd.sign(id.key, 0, id.hash);
  let token = null;
  if (tsa) {
    const sigValue = sd.signerInfos[0].signature.valueBlock.valueHexView;
    token = await sgTimestamp(tsa, sigValue);
    sd.signerInfos[0].unsignedAttrs = new pkijs.SignedAndUnsignedAttributes({ type: 1, attributes: [new pkijs.Attribute({ type: SG_OID.tsToken, values: [token.schema] })] });
  }
  const der = new Uint8Array(new pkijs.ContentInfo({ contentType: SG_OID.signedData, content: sd.toSchema(true) }).toSchema().toBER(false));
  if (token) { // the token must survive being written again, byte for byte
    const back = await sgReadCms(der);
    const tk = back.si.unsignedAttrs && back.si.unsignedAttrs.attributes.find((a) => a.type === SG_OID.tsToken);
    const chk = tk && await sgCheckToken(tk.values[0], back.si.signature.valueBlock.valueHexView);
    if (!chk || !chk.ok) throw new SgError('The timestamp could not be added to the signature.');
  }
  return { der, token };
}
async function sgReadCms(der) {
  const { pkijs } = await sgLoadLibs();
  const ci = pkijs.ContentInfo.fromBER(der);
  if (ci.contentType !== SG_OID.signedData) throw new Error('Not a CMS SignedData');
  const sd = new pkijs.SignedData({ schema: ci.content });
  return { sd, si: sd.signerInfos[0] };
}

/* ---- RFC 3161 timestamps ---- */
async function sgTsaPost(url, body) {
  if (NATIVE && !ANDROID_APP) {
    try { return b64ToBytes(await NATIVE.core.invoke('tsa_post', { url, body: bytesToB64(body) })); }
    catch (e) { throw new SgError(`The timestamp server could not be reached (${e && e.message ? e.message : e}).`); }
  }
  let r;
  try { r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/timestamp-query' }, body, cache: 'no-store', credentials: 'omit' }); }
  catch { throw new SgError('The timestamp server could not be reached, or it blocks requests from web pages. Try again later, use another server, or sign in the app.'); }
  if (!r.ok) throw new SgError(`The timestamp server said no (error ${r.status}).`);
  return new Uint8Array(await r.arrayBuffer());
}
async function sgTimestamp(url, sigValue) {
  const { asn1js, pkijs } = await sgLoadLibs();
  const imprint = await sgDigest('SHA-256', sigValue);
  const nonce = crypto.getRandomValues(new Uint8Array(8)); nonce[0] = (nonce[0] & 0x3f) | 0x40;
  const req = new pkijs.TimeStampReq({
    version: 1,
    messageImprint: new pkijs.MessageImprint({ hashAlgorithm: new pkijs.AlgorithmIdentifier({ algorithmId: SG_OID.sha256 }), hashedMessage: new asn1js.OctetString({ valueHex: imprint.buffer }) }),
    nonce: new asn1js.Integer({ valueHex: nonce.buffer }), certReq: true,
  });
  const resp = await sgTsaPost(url, new Uint8Array(req.toSchema().toBER(false)));
  let tr;
  try { tr = pkijs.TimeStampResp.fromBER(resp); } catch { throw new SgError('The timestamp server’s answer could not be read.'); }
  if (tr.status.status !== 0 && tr.status.status !== 1) throw new SgError(`The timestamp server refused the request${tr.status.statusStrings && tr.status.statusStrings.length ? ': ' + tr.status.statusStrings.map((x) => x.valueBlock.value).join(' ') : '.'}`);
  if (!tr.timeStampToken) throw new SgError('The timestamp server sent no timestamp.');
  const schema = tr.timeStampToken.toSchema();
  const chk = await sgCheckToken(schema, sigValue);
  if (!chk.tst) throw new SgError('The timestamp could not be read.');
  if (!chk.imprintOk) throw new SgError('The timestamp is for something else (its fingerprint does not match).');
  const n = chk.tst.nonce ? chk.tst.nonce.valueBlock.valueHexView : null;
  if (!n || !sgEq(sgStrip0(n), sgStrip0(nonce))) throw new SgError('The timestamp server’s answer does not match the request (nonce).');
  if (!chk.ok) throw new SgError('The timestamp’s own signature is not valid.');
  return { schema, genTime: chk.genTime, tsa: chk.tsa };
}
const sgStrip0 = (u) => { u = new Uint8Array(u); let k = 0; while (k < u.length - 1 && u[k] === 0) k++; return u.subarray(k); };
// Checks a timestamp token (a ContentInfo schema) over `data` (the signature value it stamps)
async function sgCheckToken(schema, data) {
  const { pkijs } = await sgLoadLibs();
  const out = { ok: false, imprintOk: false, tst: null, genTime: null, tsa: '' };
  try {
    const ci = new pkijs.ContentInfo({ schema }), sd = new pkijs.SignedData({ schema: ci.content });
    const e = sd.encapContentInfo.eContent;
    const raw = e.idBlock.isConstructed ? sgCat(e.valueBlock.value.map((p) => new Uint8Array(p.valueBlock.valueHexView))) : e.valueBlock.valueHexView;
    const tst = pkijs.TSTInfo.fromBER(raw); out.tst = tst; out.genTime = tst.genTime;
    if (e.idBlock.isConstructed) { const { asn1js } = await sgLoadLibs(); sd.encapContentInfo.eContent = new asn1js.OctetString({ valueHex: raw.slice().buffer }); } // BER in pieces: pkijs reads TSTInfo from one piece only
    const alg = SG_HASH[tst.messageImprint.hashAlgorithm.algorithmId];
    out.imprintOk = !!alg && sgEq(await sgDigest(alg, data), tst.messageImprint.hashedMessage.valueBlock.valueHexView);
    const v = await sd.verify({ signer: 0, data: new Uint8Array(data).slice().buffer, extendedMode: true, checkChain: false });
    out.ok = !!v.signatureVerified && out.imprintOk;
    if (v.signerCertificate) { const n = sgNameOf(v.signerCertificate.subject); out.tsa = n.cn || n.o || ''; }
  } catch (e) { out.error = e && (e.message || e.toString()); }
  return out;
}

/* ---- the PDF's fields (with pdf-lib) ---- */
function sgFieldsOf(L, pdf) {
  const { PDFName, PDFRef, PDFDict, PDFArray } = L, N = (n) => PDFName.of(n), ctx = pdf.context, out = [];
  const pageN = new Map(), annotPage = new Map();
  pdf.getPages().forEach((p, n) => {
    pageN.set(p.ref.tag, n);
    const an = ctx.lookup(p.node.get(N('Annots')));
    if (an instanceof PDFArray) for (const r of an.asArray()) if (r instanceof PDFRef) annotPage.set(r.tag, n);
  });
  const acro = ctx.lookup(pdf.catalog.get(N('AcroForm')));
  const fields = acro instanceof PDFDict ? ctx.lookup(acro.get(N('Fields'))) : null;
  if (!(fields instanceof PDFArray)) return out;
  const text = (o) => { try { return o && o.decodeText ? o.decodeText() : null; } catch { return null; } };
  const seen = new Set();
  const walk = (ref, parent, ft, depth) => {
    const d = ctx.lookup(ref);
    if (!(d instanceof PDFDict) || depth > 30 || (ref instanceof PDFRef && seen.has(ref.tag))) return;
    if (ref instanceof PDFRef) seen.add(ref.tag);
    const t = text(d.get(N('T'))), name = t == null ? parent : parent ? parent + '.' + t : t;
    const myFt = d.get(N('FT')) ? String(d.get(N('FT'))) : ft;
    const kids = ctx.lookup(d.get(N('Kids')));
    const kidList = kids instanceof PDFArray ? kids.asArray() : [];
    if (kidList.some((k) => { const kd = ctx.lookup(k); return kd instanceof PDFDict && kd.get(N('T')); })) { for (const k of kidList) walk(k, name, myFt, depth + 1); return; }
    const widgets = kidList.length ? kidList.map((k) => ({ ref: k instanceof PDFRef ? k : null, dict: ctx.lookup(k) })).filter((w) => w.dict instanceof PDFDict) : [{ ref: ref instanceof PDFRef ? ref : null, dict: d }];
    for (const w of widgets) {
      const P = w.dict.get(N('P'));
      w.page = w.ref && annotPage.has(w.ref.tag) ? annotPage.get(w.ref.tag) : P instanceof PDFRef && pageN.has(P.tag) ? pageN.get(P.tag) : -1;
      const r = ctx.lookup(w.dict.get(N('Rect')));
      w.rect = r instanceof PDFArray ? r.asArray().map((x) => { const v = ctx.lookup(x); return v && v.asNumber ? v.asNumber() : 0; }) : [0, 0, 0, 0];
    }
    const v = d.get(N('V'));
    out.push({ name: name || '', ft: myFt, ref: ref instanceof PDFRef ? ref : null, dict: d, widgets, v, sig: v ? ctx.lookup(v) : null });
  };
  for (const r of fields.asArray()) walk(r, '', null, 0);
  return out;
}
// Empty signature fields in the file as opened (to sign in)
async function sgEmptyFields() {
  if (!doc) return [];
  try {
    const L = await loadPdfLib();
    const pdf = await L.PDFDocument.load(doc.sources[0], { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
    const gone = new Set(docMarks().filter((m) => m.type === 'ffmod' && m.del).map((m) => m.name));
    return sgFieldsOf(L, pdf).filter((f) => f.ft === '/Sig' && !f.v && !gone.has(f.name) && f.widgets.some((w) => w.page >= 0)).map((f) => ({ name: f.name, page: f.widgets[0].page, rect: f.widgets[0].rect }));
  } catch (e) { console.warn(e); return []; }
}

/* ---- the appearance ---- */
const SG_WIN = { 0x20ac: 128, 0x201a: 130, 0x192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x2c6: 136, 0x2030: 137, 0x160: 138, 0x2039: 139, 0x152: 140, 0x17d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x2dc: 152, 0x2122: 153, 0x161: 154, 0x203a: 155, 0x153: 156, 0x17e: 158, 0x178: 159 };
// A literal string in WinAnsiEncoding (Helvetica): letters it lacks become ?
function sgWinAnsi(s) {
  let o = '(';
  for (const ch of String(s)) {
    const c = ch.codePointAt(0), b = c < 128 ? c : c >= 160 && c <= 255 ? c : SG_WIN[c] || 63;
    if (b === 40 || b === 41 || b === 92) o += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) o += '\\' + b.toString(8).padStart(3, '0');
    else o += String.fromCharCode(b);
  }
  return o + ')';
}
let sgMeasureCtx = null;
const sgTextW = (s, size) => { sgMeasureCtx ||= document.createElement('canvas').getContext('2d'); sgMeasureCtx.font = `${size}px Helvetica, Arial, sans-serif`; return sgMeasureCtx.measureText(s).width; };
// The picture as RGB and alpha (for an image XObject and its soft mask)
async function sgImagePixels(dataUrl) {
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
  const w = Math.max(1, Math.min(1200, im.naturalWidth)), h = Math.max(1, Math.round(im.naturalHeight * w / im.naturalWidth));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(im, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data, rgb = new Uint8Array(w * h * 3), a = new Uint8Array(w * h);
  for (let i = 0, j = 0, k = 0; i < px.length; i += 4) { rgb[j++] = px[i]; rgb[j++] = px[i + 1]; rgb[j++] = px[i + 2]; a[k++] = px[i + 3]; }
  return { w, h, rgb, a };
}
// The typed name, drawn in a handwriting face
function sgTypedImage(name) {
  const c = document.createElement('canvas'); c.width = 900; c.height = 320;
  const g = c.getContext('2d'); let size = 150; const face = SIG_FONTS[0][1];
  g.font = `${size}px ${face}`; while (size > 30 && g.measureText(name).width > c.width - 60) { size -= 6; g.font = `${size}px ${face}`; }
  g.fillStyle = SIG_INKS[0][0]; g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(name, c.width / 2, c.height / 2);
  const t = trimCanvas(c); return t ? t.data : null;
}
/* ---- writing the incremental update ---- */
function sgObjBytes(obj) { const u = new Uint8Array(obj.sizeInBytes()); obj.copyBytesInto(u, 0); return u; }
const sgStream = (dict, data) => sgCat([sgEnc.encode(`<<${dict} /Length ${data.length}>>\nstream\n`), data, sgEnc.encode('\nendstream')]);
// Signs `base` (the bytes of a PDF): returns the signed file (base, then one incremental update).
//   target: { name } (an empty signature field) or { page, rect } (a new one: the page index in base, PDF points)
//   look: { image (a data: URL) | null, lines: [] }; o: { subFilter, reason, location, contact, certify (1-3), lock, tsa }
async function sgSignBytes(base, target, id, look, o = {}) {
  const L = await loadPdfLib(), { PDFName, PDFRef, PDFDict, PDFArray, PDFNumber, PDFHexString } = L, N = (n) => PDFName.of(n);
  base = new Uint8Array(base);
  const s = sgLatin1(base), tr = await sgTrailerInfo(base, s);
  if (tr.encrypt) throw new SgError('Remove the password before signing.');
  const pdf = await L.PDFDocument.load(base, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false });
  if (pdf.isEncrypted) throw new SgError('Remove the password before signing.');
  const ctx = pdf.context, root = pdf.context.trailerInfo.Root;
  let next = Math.max(tr.size, ctx.largestObjectNumber + 1);
  const alloc = () => PDFRef.of(next++, 0);
  const dirty = new Map(); // ref tag -> [ref, object]: objects of the file that change
  const touch = (ref, obj) => { if (ref instanceof PDFRef) dirty.set(ref.tag, [ref, obj || ctx.lookup(ref)]); };
  const catalog = ctx.lookup(root);
  // the form
  let acroRef = catalog.get(N('AcroForm')), acro;
  if (acroRef instanceof PDFRef) acro = ctx.lookup(acroRef);
  else { acro = acroRef instanceof PDFDict ? acroRef : ctx.obj({}); acroRef = alloc(); catalog.set(N('AcroForm'), acroRef); touch(root, catalog); }
  touch(acroRef, acro);
  let fieldsArr = acro.get(N('Fields')), fieldsRef = null;
  if (fieldsArr instanceof PDFRef) { fieldsRef = fieldsArr; fieldsArr = ctx.lookup(fieldsRef); }
  if (!(fieldsArr instanceof PDFArray)) { fieldsArr = ctx.obj([]); acro.set(N('Fields'), fieldsArr); }
  acro.set(N('SigFlags'), PDFNumber.of(3));
  const fields = sgFieldsOf(L, pdf), pages = pdf.getPages();
  const signed = fields.filter((f) => f.ft === '/Sig' && f.v);
  // the field and its widget
  let field, widget, page, rect;
  if (target.name != null) {
    const f = fields.find((x) => x.ft === '/Sig' && x.name === target.name);
    if (!f) throw new SgError(`The field “${target.name}” is not in the PDF any more.`);
    if (f.v) throw new SgError(`The field “${target.name}” is already signed.`);
    field = { ref: f.ref, dict: f.dict };
    const w = f.widgets.find((x) => x.page >= 0) || f.widgets[0];
    if (!f.ref || !w) throw new SgError('This signature field can’t be signed here.');
    widget = { ref: w.ref || f.ref, dict: w.dict }; page = Math.max(0, w.page); rect = w.rect;
  } else {
    page = target.page; rect = target.rect;
    if (!pages[page]) throw new SgError('That page is not in the PDF.');
    const names = new Set(fields.map((f) => f.name)); let k = 1; while (names.has('Signature' + k)) k++;
    const ref = alloc(), dict = ctx.obj({ FT: 'Sig', T: PDFHexString.fromText('Signature' + k), Type: 'Annot', Subtype: 'Widget', Rect: rect.map((x) => +x.toFixed(2)), F: 4, P: pages[page].ref });
    field = widget = { ref, dict, isNew: true };
    fieldsArr.push(ref);
    if (fieldsRef) touch(fieldsRef, fieldsArr);
    const p = pages[page], an = p.node.get(N('Annots'));
    if (an instanceof PDFRef) { const arr = ctx.lookup(an); arr.push(ref); touch(an, arr); }
    else { if (an instanceof PDFArray) an.push(ref); else p.node.set(N('Annots'), ctx.obj([ref])); touch(p.ref, p.node); }
  }
  const [x0, y0, x1, y1] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const rot = ((pages[page].getRotation().angle % 360) + 360) % 360;
  const sigRef = alloc(), apRef = alloc(), fontRef = alloc();
  field.dict.set(N('V'), sigRef);
  widget.dict.set(N('AP'), ctx.obj({ N: apRef }));
  widget.dict.set(N('F'), PDFNumber.of(4)); // printed, shown
  if (o.lock) field.dict.set(N('Lock'), ctx.obj({ Type: 'SigFieldLock', Action: 'All' }));
  const certify = o.certify && !signed.length ? o.certify : 0;
  if (certify) { catalog.set(N('Perms'), ctx.obj({ DocMDP: sigRef })); touch(root, catalog); }
  touch(field.ref, field.dict); if (widget.ref !== field.ref) touch(widget.ref, widget.dict);
  // the appearance: the picture, then "Digitally signed by …" (upright on a turned page)
  const [W, H] = rot % 180 ? [y1 - y0, x1 - x0] : [x1 - x0, y1 - y0];
  const matrix = { 0: '', 90: ' /Matrix [0 1 -1 0 0 0]', 180: ' /Matrix [-1 0 0 -1 0 0]', 270: ' /Matrix [0 -1 1 0 0 0]' }[rot] || '';
  const extra = []; let content = 'q\n', imgRes = '';
  let tx = 2, ty = 2, tw = W - 4, th = H - 4;
  if (look.image) {
    const px = await sgImagePixels(look.image);
    const side = W > H * 1.6;
    const aw = side ? W * .46 : W - 4, ah = side ? H - 4 : H * .55;
    const k = Math.min(aw / px.w, ah / px.h), iw = px.w * k, ih = px.h * k;
    const ix = 2 + (aw - iw) / 2, iy = side ? (H - ih) / 2 : H - 2 - ah + (ah - ih) / 2;
    const imRef = alloc(), smRef = alloc();
    const rgbZ = await sgDeflate(px.rgb), aZ = await sgDeflate(px.a);
    extra.push([smRef, sgStream(` /Type /XObject /Subtype /Image /Width ${px.w} /Height ${px.h} /ColorSpace /DeviceGray /BitsPerComponent 8${aZ ? ' /Filter /FlateDecode' : ''}`, aZ || px.a)]);
    extra.push([imRef, sgStream(` /Type /XObject /Subtype /Image /Width ${px.w} /Height ${px.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ${smRef.tag}${rgbZ ? ' /Filter /FlateDecode' : ''}`, rgbZ || px.rgb)]);
    imgRes = ` /XObject << /Im1 ${imRef.tag} >>`;
    content += `q ${iw.toFixed(3)} 0 0 ${ih.toFixed(3)} ${ix.toFixed(3)} ${iy.toFixed(3)} cm /Im1 Do Q\n`;
    if (side) { tx = W * .5; tw = W * .5 - 2; } else { th = H * .45 - 4; }
  }
  const lines = look.lines.filter(Boolean);
  let size = Math.min(10, th / (lines.length * 1.18));
  for (const l of lines) { const w1 = sgTextW(l, 1); if (w1 * size > tw) size = tw / w1; }
  size = Math.max(3, size);
  const lead = size * 1.18, top = ty + th - (th - lead * lines.length) / 2 - size * .82;
  content += `BT /F1 ${size.toFixed(2)} Tf ${lead.toFixed(2)} TL 0.12 0.12 0.14 rg ${tx.toFixed(2)} ${top.toFixed(2)} Td\n` + lines.map((l, k) => (k ? 'T* ' : '') + sgWinAnsi(l) + ' Tj').join('\n') + '\nET\nQ';
  const ap = sgStream(` /Type /XObject /Subtype /Form /BBox [0 0 ${W.toFixed(2)} ${H.toFixed(2)}]${matrix} /Resources << /Font << /F1 ${fontRef.tag} >>${imgRes} >>`, sgEnc.encode(content));
  if (rot && widget.dict) widget.dict.set(N('MK'), ctx.obj({ R: rot }));
  // the signature dictionary, with room for the signature
  const when = new Date();
  const chainLen = id.chain.reduce((n, d) => n + d.length, 0);
  let room = Math.max(16384, Math.ceil((chainLen + 4096 + (o.tsa ? 16384 : 0)) / 1024) * 1024);
  const ref = (o.subFilter === SG_PKCS7 ? SG_PKCS7 : SG_CADES);
  const refs = [];
  if (certify) refs.push(`<< /Type /SigRef /TransformMethod /DocMDP /TransformParams << /Type /TransformParams /P ${certify} /V /1.2 >> >>`);
  if (o.lock) refs.push('<< /Type /SigRef /TransformMethod /FieldMDP /TransformParams << /Type /TransformParams /Action /All /V /1.2 >> >>');
  const sigText = (contents) => `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /${ref}`
    + ` /ByteRange [0 ${'0'.repeat(10)} ${'0'.repeat(10)} ${'0'.repeat(10)}]`
    + ` /Contents <${contents}>`
    + ` /M (${sgPdfDate(when)}) /Name ${sgPdfText(id.info.name)}`
    + (o.reason ? ` /Reason ${sgPdfText(o.reason)}` : '') + (o.location ? ` /Location ${sgPdfText(o.location)}` : '') + (o.contact ? ` /ContactInfo ${sgPdfText(o.contact)}` : '')
    + (refs.length ? ` /Reference [${refs.join(' ')}]` : '')
    + ` /Prop_Build << /App << /Name /Cowdrey.PDF /REx (${VERSION}) >> /Filter << /Name /Adobe.PPKLite >> >> >>`;
  // the objects of the update, in number order
  const write = (sigBody) => {
    const objs = [...dirty.values()].map(([r, obj]) => [r, sgObjBytes(obj)]);
    objs.push([sigRef, sgEnc.encode(sigBody)], [apRef, ap], [fontRef, sgEnc.encode('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')], ...extra);
    if (acroRef && !dirty.has(acroRef.tag)) objs.push([acroRef, sgObjBytes(acro)]);
    objs.sort((a, b) => a[0].objectNumber - b[0].objectNumber);
    return sgAppend(base, tr, objs, root, next);
  };
  for (let tries = 0; ; tries++) {
    const { bytes, offsets } = write(sigText('0'.repeat(room * 2)));
    const at = offsets.get(sigRef.objectNumber), txt = sgLatin1(bytes.subarray(at, at + 400 + room * 2));
    const b = at + txt.indexOf('/Contents <') + 10, c = b + room * 2 + 2;
    const brAt = at + txt.indexOf('/ByteRange [');
    const brText = `/ByteRange [0 ${b} ${c} ${bytes.length - c}]`, brSpace = `/ByteRange [0 ${'0'.repeat(10)} ${'0'.repeat(10)} ${'0'.repeat(10)}]`.length;
    if (brText.length > brSpace) throw new SgError('This PDF is too large to sign.');
    bytes.set(sgEnc.encode(brText.padEnd(brSpace, ' ')), brAt);
    const content = sgCat([bytes.subarray(0, b), bytes.subarray(c)]);
    const { der } = await sgMakeCms({ id, content, subFilter: ref, when, tsa: o.tsa });
    if (der.length > room) { if (tries > 2) throw new SgError('The signature is too large.'); room = Math.ceil((der.length + 2048) / 1024) * 1024; continue; }
    bytes.set(sgEnc.encode(sgHex(der).toUpperCase().padEnd(room * 2, '0')), b + 1);
    return bytes;
  }
}
// The file, then the objects, a cross-reference section like the file's last one, and the trailer.
function sgAppend(base, tr, objs, root, size) {
  const parts = [base], offsets = new Map();
  let pos = base.length;
  const push = (u) => { if (typeof u === 'string') u = sgEnc.encode(u); parts.push(u); pos += u.length; };
  if (base[base.length - 1] !== 10 && base[base.length - 1] !== 13) push('\n');
  for (const [r, data] of objs) { offsets.set(r.objectNumber, pos); push(`${r.objectNumber} ${r.generationNumber} obj\n`); push(data); push('\nendobj\n'); }
  const newId = sgHex(crypto.getRandomValues(new Uint8Array(16))).toUpperCase();
  const id0 = tr.id && tr.id[0] && tr.id[0].hex != null ? tr.id[0].hex : tr.id && tr.id[0] && tr.id[0].str != null ? sgHex(sgFromLatin1(tr.id[0].str)) : newId;
  const common = `/Root ${root.tag}${tr.info && tr.info.ref ? ' /Info ' + sgRefStr(tr.info) : ''} /ID [<${id0}> <${newId}>] /Prev ${tr.prev}`;
  const xrefAt = pos;
  const groups = (list) => { const g = []; for (const n of list) { const last = g[g.length - 1]; if (last && last[0] + last[1] === n) last[1]++; else g.push([n, 1]); } return g; };
  if (tr.type === 'table') {
    const nums = [0, ...objs.map(([r]) => r.objectNumber)].sort((a, b) => a - b), gen = new Map(objs.map(([r]) => [r.objectNumber, r.generationNumber]));
    let t = 'xref\n';
    for (const [start, count] of groups(nums)) {
      t += `${start} ${count}\n`;
      for (let n = start; n < start + count; n++) t += n === 0 ? '0000000000 65535 f\r\n' : `${String(offsets.get(n)).padStart(10, '0')} ${String(gen.get(n)).padStart(5, '0')} n\r\n`;
    }
    push(t + `trailer\n<< /Size ${size} ${common} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  } else {
    const me = size, nums = [...objs.map(([r]) => r.objectNumber), me].sort((a, b) => a - b);
    const rows = new Uint8Array(nums.length * 7), gen = new Map(objs.map(([r]) => [r.objectNumber, r.generationNumber]));
    offsets.set(me, xrefAt);
    nums.forEach((n, k) => { const o = offsets.get(n), g = n === me ? 0 : gen.get(n); rows.set([1, (o >>> 24) & 255, (o >>> 16) & 255, (o >>> 8) & 255, o & 255, (g >> 8) & 255, g & 255], k * 7); });
    push(`${me} 0 obj\n`);
    push(sgStream(`/Type /XRef /Size ${me + 1} /W [1 4 2] /Index [${groups(nums).map((g) => g.join(' ')).join(' ')}] ${common}`, rows));
    push(`\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`);
  }
  return { bytes: sgCat(parts), offsets };
}

/* ---- checking signatures ---- */
const SG_ANNOTS = new Set(['/Text', '/Link', '/FreeText', '/Line', '/Square', '/Circle', '/Polygon', '/PolyLine', '/Highlight', '/Underline', '/Squiggly', '/StrikeOut', '/Stamp', '/Caret', '/Ink', '/Popup', '/FileAttachment', '/Sound', '/Redact']);
// Every signature in `bytes`: [{ status, name, when, … }]
async function sgVerifyAll(bytes, password) {
  const L = await loadPdfLib();
  bytes = new Uint8Array(bytes);
  const s = sgLatin1(bytes);
  if (!s.includes('/ByteRange')) return [];
  const pdf = await L.PDFDocument.load(bytes, { ...(password ? { password } : { ignoreEncryption: true }), updateMetadata: false, throwOnInvalidObject: false });
  const fields = sgFieldsOf(L, pdf).filter((f) => f.ft === '/Sig' && f.sig && f.sig.get);
  if (!fields.length) return [];
  await sgLoadLibs();
  const trust = await sgTrustAll().catch(() => new Set());
  // the file as a reader shows it now
  let now = null; try { now = await sgRevision(bytes, s, sgStartXref(s)); } catch (e) { console.warn(e); }
  const out = [];
  for (const f of fields) {
    try { out.push(await sgVerifyOne(L, pdf, bytes, s, f, now, trust)); }
    catch (e) { console.warn(e); out.push({ field: f.name, page: f.widgets[0] ? f.widgets[0].page : -1, rect: f.widgets[0] && f.widgets[0].rect, status: 'invalid', name: 'Unknown', notes: ['This signature could not be read: ' + (e.message || e)] }); }
  }
  // in the order they were made
  out.sort((a, b) => (a.end || 0) - (b.end || 0));
  out.forEach((x, k) => { x.n = k + 1; });
  return out;
}
async function sgVerifyOne(L, pdf, bytes, s, f, now, trust) {
  const { PDFName, PDFArray, PDFRef } = L, N = (n) => PDFName.of(n), ctx = pdf.context, V = f.sig;
  const w = f.widgets.find((x) => x.page >= 0) || f.widgets[0] || {};
  const r = { field: f.name, page: w.page ?? -1, rect: w.rect, notes: [], name: 'Unknown', status: 'invalid' };
  const br = ctx.lookup(V.get(N('ByteRange')));
  const range = br instanceof PDFArray ? br.asArray().map((x) => { const v = ctx.lookup(x); return v && v.asNumber ? v.asNumber() : NaN; }) : [];
  const [a, b, c, d] = range;
  if (range.length !== 4 || a !== 0 || !(b > 0) || !(c > b) || !(d >= 0) || c + d > bytes.length || s[b] !== '<' || s[c - 1] !== '>' || /[^0-9a-fA-F\s]/.test(s.slice(b + 1, c - 1))) {
    r.notes.push('What the signature covers is not set out properly, so it proves nothing about this file.'); return r;
  }
  const end = c + d; r.end = end;
  if (!/%%EOF\s*$/.test(s.slice(Math.max(0, end - 40), end))) { r.notes.push('The signature does not cover a whole version of the file.'); }
  // The signature's details (reason, date, certify) as signed: the dictionary in the signed revision that holds
  // these /Contents, not whatever a later update says.
  let rev = null; try { rev = await sgRevision(bytes, s, sgStartXref(s, end), end); } catch (e) { console.warn(e); }
  let sv = null;
  if (rev) {
    let best = -1; for (const e of rev.map.values()) if (e[2] && e[3] === 1 && e[4] < b && e[4] > best) best = e[4];
    try { const o = best >= 0 ? await sgObjAt(bytes, s, best) : null; if (o && sgIsDict(o.v) && o.endAt > c && rev.map.get(o.num)?.[4] === best) sv = o.v; } catch {}
    if (!sv || !Array.isArray(sv.ByteRange) || sv.ByteRange.join(' ') !== range.join(' ') || !sv.Contents || typeof sv.Contents.hex !== 'string' || sv.Contents.hex !== s.slice(b + 1, c - 1).replace(/\s+/g, '')) {
      r.notes.push('The signature’s details are not part of what it signed.'); return r;
    }
  } else {
    // this version of the file could not be read: the details from the signature dictionary as it is now
    sv = {}; for (const k of ['Reason', 'Location', 'ContactInfo', 'Name', 'M']) { const o = V.get(N(k)); if (o instanceof L.PDFHexString) sv[k] = { hex: o.asString() }; else if (o instanceof L.PDFString) sv[k] = { str: o.asString() }; }
    sv.SubFilter = String(V.get(N('SubFilter')) || '');
  }
  const txt = (k) => sgPdfStr(sv[k]);
  r.reason = txt('Reason'); r.location = txt('Location'); r.contact = txt('ContactInfo'); r.pdfName = txt('Name');
  r.claimed = sgParsePdfDate(txt('M'));
  r.subFilter = String(sv.SubFilter || '').replace(/^\//, '');
  if (rev) {
    const deref = async (x) => { if (sgRefNum(x) < 0) return x; try { const o = await rev.get(sgRefNum(x)); return o && o.v; } catch { return null; } };
    const refs = await deref(sv.Reference);
    for (const x of Array.isArray(refs) ? refs : []) {
      const dd = await deref(x);
      if (sgIsDict(dd) && dd.TransformMethod === '/DocMDP') { const p = await deref(dd.TransformParams); r.certify = sgIsDict(p) && Number.isInteger(p.P) ? p.P : 2; }
    }
  }
  const cmsBytes = sgUnhex(s.slice(b + 1, c - 1));
  const { sd, si } = await sgReadCms(cmsBytes);
  const content = sgCat([bytes.subarray(0, b), bytes.subarray(c, end)]);
  const hash = SG_HASH[si.digestAlgorithm.algorithmId];
  if (!hash) { r.notes.push('The signature uses a digest Cowdrey.PDF can’t check.'); return r; }
  // the signer
  let signer = null;
  try {
    const v = await sd.verify({ signer: 0, data: r.subFilter === 'adbe.pkcs7.sha1' ? undefined : content.slice().buffer, extendedMode: true, checkChain: false });
    r.sigOk = !!v.signatureVerified; signer = v.signerCertificate;
  } catch (e) { r.sigOk = false; signer = e && e.signerCertificate; if (e && e.message && !/digest/i.test(e.message)) r.verifyError = e.message; }
  if (!signer && sd.certificates) signer = sd.certificates[0];
  // the digest
  let md = null;
  const mda = si.signedAttrs && si.signedAttrs.attributes.find((x) => x.type === SG_OID.messageDigest);
  if (r.subFilter === 'adbe.pkcs7.sha1') {
    const e = sd.encapContentInfo.eContent; const inner = e ? e.valueBlock.valueHexView : null;
    r.digestOk = !!inner && sgEq(await sgDigest('SHA-1', content), inner);
  } else {
    md = await sgDigest(hash, content);
    r.digestOk = mda ? sgEq(md, mda.values[0].valueBlock.valueHexView) : r.sigOk;
  }
  if (signer) {
    const der = new Uint8Array(signer.toSchema(true).toBER(false));
    const info = await sgCertInfo(der);
    Object.assign(r, { name: info.name, cert: { subject: sgNameText(info.subject), issuer: sgNameText(info.issuer), email: info.subject.email || '', o: info.subject.o || '', serial: info.serial, notBefore: info.notBefore, notAfter: info.notAfter, fp: info.fp, selfSigned: info.selfSigned, key: info.key } });
    // trust: this certificate, or one that issued it (and whose signature on it checks out)
    r.trusted = trust.has(info.fp);
    if (!r.trusted && sd.certificates) {
      let cur = signer;
      for (let hop = 0; hop < 8 && !r.trusted; hop++) {
        const up = sd.certificates.find((x) => x.subject && sgEq(x.subject.toSchema().toBER(), cur.issuer.toSchema().toBER()) && x !== cur);
        if (!up) break;
        let ok = false; try { ok = await cur.verify(up); } catch {}
        if (!ok) break;
        if (trust.has(await sgFp(new Uint8Array(up.toSchema(true).toBER(false))))) r.trusted = true;
        if (sgEq(up.subject.toSchema().toBER(), up.issuer.toSchema().toBER())) break;
        cur = up;
      }
    }
  } else r.notes.push('The signer’s certificate is not in the signature.');
  // when: the timestamp, else the signing time in the signature, else the time the PDF gives
  const st = si.signedAttrs && si.signedAttrs.attributes.find((x) => x.type === SG_OID.signingTime);
  if (st) try { r.claimed = st.values[0].toDate(); } catch {}
  const tk = si.unsignedAttrs && si.unsignedAttrs.attributes.find((x) => x.type === SG_OID.tsToken);
  if (tk) {
    const chk = await sgCheckToken(tk.values[0], si.signature.valueBlock.valueHexView);
    r.ts = { ok: chk.ok, time: chk.genTime, tsa: chk.tsa };
    if (!chk.ok) r.notes.push('The timestamp does not check out.');
  }
  r.when = r.ts && r.ts.ok ? r.ts.time : r.claimed;
  if (r.cert && r.when && (r.when < r.cert.notBefore || r.when > r.cert.notAfter)) { r.certExpired = true; r.notes.push('The certificate was not valid at the time of signing.'); }
  // changes after this signature
  if (!/^\s*$/.test(s.slice(end))) r.changes = await sgLaterChanges(bytes, s, end, rev, now);
  // the verdict
  if (!r.digestOk) { r.status = 'invalid'; r.notes.unshift('The file was changed in the part this signature covers.'); }
  else if (!r.sigOk) { r.status = 'invalid'; r.notes.unshift('The signature does not match the signer’s certificate' + (r.verifyError ? ` (${r.verifyError})` : '') + '.'); }
  else if (r.changes && (r.changes.other || (r.certify === 1 && (r.changes.form || r.changes.comments || r.changes.sign)) || (r.certify === 2 && r.changes.comments))) r.status = 'changed';
  else if (r.changes && (r.changes.comments || r.changes.form)) r.status = 'changed';
  else r.status = r.trusted && !r.certExpired ? 'trusted' : 'valid';
  if (r.changes) {
    const what = [r.changes.form && 'form filled', r.changes.comments && 'comments added'].filter(Boolean);
    r.changeText = r.changes.other ? 'The file was changed after it was signed, in ways a signature does not allow.' : what.length ? `The file was changed after it was signed: ${what.join(', ')}.` : r.changes.sign ? 'Signed again after this signature.' : '';
    if (r.status === 'changed' && !r.changes.other && what.length) r.statusText = `${SG_STATUS.changed[0]} (${what.join(', ')})`;
    if (r.certify && r.status === 'changed') r.notes.push('The author certified this PDF and does not allow these changes.');
  }
  r.statusText ||= SG_STATUS[r.status][0];
  return r;
}
// What the updates after a signature changed: { comments, form, sign, other }, as far as can be told. `old` is the
// signed revision and `now` the whole file, both read the way a PDF reader reads them (sgRevision), so every object a
// reader would show is looked at: those its cross-reference sections point at (following /Prev and /XRefStm), and
// any other object written after the signature, in case a reader rebuilds the table by scanning the file.
async function sgLaterChanges(u, s, end, old, now) {
  const out = { comments: false, form: false, sign: false, other: false };
  if (!old || !now) { out.other = true; return out; }
  const isDict = sgIsDict, ref = sgRefNum;
  const getOld = async (n) => { try { return await old.get(n); } catch { return undefined; } };
  const getNow = async (n) => { try { return await now.get(n); } catch { return undefined; } };
  const root = ref(old.trailer.Root);
  if (root < 0 || ref(now.trailer.Root) !== root || (now.trailer.Encrypt && !old.trailer.Encrypt)) { out.other = true; return out; }
  // What drew the pages when signed: everything the page tree points at (contents, resources, boxes, …) except
  // annotations, which are classified on their own. Changing any of it changes what the pages show.
  let blind = false;
  const drawn = new Set(), tree = new Set();
  const reach = async (x, depth) => {
    if (x == null || typeof x !== 'object' || depth > 200) return;
    if (Array.isArray(x.ref)) {
      const n = x.ref[0]; if (drawn.has(n)) return; drawn.add(n);
      const o = await getOld(n); if (o === undefined) blind = true; else if (o) await reach(o.v, depth + 1);
      return;
    }
    if (Array.isArray(x)) { for (const y of x) await reach(y, depth + 1); return; }
    if (isDict(x)) for (const [k, y] of Object.entries(x)) if (k !== 'Parent' && k !== 'Annots' && k !== 'P') await reach(y, depth + 1);
  };
  const walk = async (x, depth) => {
    const n = ref(x); if (n < 0 || tree.has(n) || depth > 64) return; tree.add(n);
    const o = await getOld(n); if (o === undefined) { blind = true; return; }
    if (!o || !isDict(o.v)) return;
    for (const [k, y] of Object.entries(o.v)) {
      if (k === 'Kids') {
        let kids = y;
        if (ref(y) >= 0) { drawn.add(ref(y)); const a = await getOld(ref(y)); if (a === undefined) blind = true; kids = a && a.v; }
        for (const c of Array.isArray(kids) ? kids : []) await walk(c, depth + 1);
      } else if (k !== 'Parent' && k !== 'Annots') await reach(y, 0);
    }
  };
  const cat = await getOld(root);
  if (!cat || !isDict(cat.v)) { out.other = true; return out; }
  await walk(cat.v.Pages, 0);
  if (blind) { out.other = true; return out; }
  // Numbers the signed revision refers to without defining them: an object added under one of those later is as
  // good as a changed one.
  const oldRefs = new Set(); { const re = /(\d+)[\x00\t\n\f\r ]+\d+[\x00\t\n\f\r ]+R(?![A-Za-z0-9])/g; let m; const t = s.slice(0, end); while ((m = re.exec(t))) oldRefs.add(+m[1]); }
  // The objects to look at: num -> [the object now (null: removed)]
  const cand = new Map(), add = (n, o) => { if (!cand.has(n)) cand.set(n, []); cand.get(n).push(o); };
  const key = (e) => !e || !e[2] ? 'free' : e.slice(3).join(':');
  for (const n of new Set([...old.map.keys(), ...now.map.keys()])) {
    const a = old.map.get(n), b = now.map.get(n);
    if (key(a) === key(b) && !(b && b[2] && b[3] === 1 && b[4] >= end)) continue;
    if (n === 0) continue;
    if (!b || !b[2]) { add(n, null); continue; }
    const o = await getNow(n);
    if (!o) { out.other = true; continue; } // the table points at nothing: a reader would rebuild it by scanning the file
    add(n, o);
  }
  // Every object written after the signature, as a reader that scans the file would find it
  const re = /(\d+)[\x00\t\n\f\r ]+(\d+)[\x00\t\n\f\r ]+obj(?=[\s()<>\[\]{}\/%]|$)/g; re.lastIndex = end;
  for (let m; (m = re.exec(s));) {
    if (m.index > end && /[0-9A-Za-z.+-]/.test(s[m.index - 1])) continue;
    let o = null; try { o = await sgObjAt(u, s, m.index); } catch {}
    if (!o) continue;
    re.lastIndex = Math.max(re.lastIndex, o.endAt);
    const n = o.num, b = now.map.get(n), listed = b && b[2] && b[3] === 1 && b[4] === m.index;
    if (!listed) add(n, o);
    if (o.stream && isDict(o.v) && o.v.Type === '/ObjStm') {
      let items = []; try { items = await sgObjStmItems(o); } catch {}
      items.forEach((it, k) => { if (!it) return; const e = now.map.get(it.num); if (!(e && e[2] && e[3] === 2 && e[4] === n && e[5] === k)) add(it.num, it); });
    }
  }
  if (!cand.size) return out;
  const same = (a, b) => JSON.stringify(a.v) === JSON.stringify(b.v) && !a.stream === !b.stream && (!a.stream || sgEq(a.stream, b.stream));
  const sameBut = (a, b, skip) => { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!skip.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false; return true; };
  const isAnnot = (d) => isDict(d) && (d.Type === '/Annot' || SG_ANNOTS.has(d.Subtype) || d.Subtype === '/Widget');
  const isField = (d) => isDict(d) && (d.Subtype === '/Widget' || d.FT !== undefined || (d.T !== undefined && (d.Kids !== undefined || d.V !== undefined)));
  const inherit = async (get, d, k) => { for (let hop = 0; isDict(d) && hop < 32; hop++) { if (d[k] !== undefined) return d[k]; const p = ref(d.Parent); if (p < 0) return undefined; const o = await get(p); d = o && o.v; } return undefined; };
  const deref = async (get, x) => { if (ref(x) < 0) return x; const o = await get(ref(x)); return o ? o.v : undefined; };
  const catNow = await getNow(root);
  const acro = new Set([ref(cat.v.AcroForm), ref(catNow && isDict(catNow.v) ? catNow.v.AcroForm : null)].filter((n) => n >= 0));
  const info = new Set([ref(old.trailer.Info), ref(now.trailer.Info)].filter((n) => n >= 0));
  // An annotation list that changed: annotations it gained that are not new or changed themselves (those are
  // checked on their own), and annotations it lost (a field's widget taken away hides it)
  const gained = async (a, b) => {
    const was = new Set((Array.isArray(a) ? a : []).map(ref)), is = new Set((Array.isArray(b) ? b : []).map(ref));
    for (const n of was) if (n >= 0 && !is.has(n)) { const o = await getOld(n); if (o && isDict(o.v) && isField(o.v)) out.other = true; else out.comments = true; }
    for (const x of Array.isArray(b) ? b : []) {
      const n = ref(x); if (n < 0) { if (isDict(x)) out[isField(x) ? 'form' : 'comments'] = true; continue; }
      if (was.has(n) || cand.has(n)) continue;
      const o = await getNow(n); if (o && isDict(o.v) && isField(o.v)) out.form = true; else out.comments = true;
    }
  };
  for (const [num, list] of cand) for (const nw of list) {
    const ol = await getOld(num);
    if (ol === undefined) { out.other = true; continue; }
    if (!nw) { if (!ol) continue; if (!drawn.has(num) && isAnnot(ol.v) && ol.v.Subtype !== '/Widget') out.comments = true; else out.other = true; continue; }
    if (ol && same(ol, nw)) continue;
    if (drawn.has(num) || tree.has(num)) {
      // a page itself may only gain or lose annotations
      if (tree.has(num) && !drawn.has(num) && ol && isDict(ol.v) && isDict(nw.v) && ol.v.Type === '/Page' && nw.v.Type === '/Page' && !nw.stream && sameBut(ol.v, nw.v, ['Annots'])) {
        await gained(await deref(getOld, ol.v.Annots), await deref(getNow, nw.v.Annots)); continue;
      }
      out.other = true; continue;
    }
    const d = isDict(nw.v) ? nw.v : null, t = d ? d.Type || '' : '', isStream = !!nw.stream;
    if (ol) {
      // an object that becomes something else
      const od = isDict(ol.v) ? ol.v : null;
      if (!od !== !d || !ol.stream !== !isStream || (od && (od.Type || '') !== t && !(od.Type === undefined && t === '/Annot'))) { out.other = true; continue; }
    } else if (oldRefs.has(num) || num === root) { out.other = true; continue; }
    const od = ol && isDict(ol.v) ? ol.v : null;
    if (num === root) { if (!(d && !isStream && sameBut(od, d, ['AcroForm', 'DSS', 'Perms']))) out.other = true; continue; }
    if (isStream && (t === '/XRef' || t === '/ObjStm')) { if (ol) out.other = true; continue; } // what's inside is looked at one by one
    if (d && !isStream && (t === '/Sig' || t === '/DocTimeStamp')) { if (ol) out.other = true; continue; } // a signature's details may not change once signed
    if (d && !isStream && info.has(num)) continue; // the document's title, author and so on
    if (isStream && t === '/Metadata') continue;
    if (d && !isStream && isField(d)) {
      if ((await inherit(getNow, d, 'FT')) !== '/Sig') { out.form = true; continue; }
      if (od && (await inherit(getOld, od, 'V')) !== undefined) { out.other = true; continue; } // a field signed before
      const v = await inherit(getNow, d, 'V');
      if (v === undefined || v === null) { out.form = true; continue; } // an empty signature field
      const vn = ref(v), sd = vn >= 0 ? await getNow(vn) : null;
      if (vn >= 0 && (await getOld(vn)) === null && sd && isDict(sd.v) && !sd.stream && sd.v.ByteRange) out.sign = true; else out.other = true;
      continue;
    }
    if (d && !isStream && isAnnot(d)) { out.comments = true; continue; }
    if (d && !isStream && acro.has(num)) { if (od && !sameBut(od, d, ['Fields', 'SigFlags', 'DR', 'NeedAppearances', 'DA'])) out.other = true; continue; }
    if (!ol) continue; // a new object only matters where something old points at it, and that is looked at too
    if (Array.isArray(nw.v)) {
      // an annotation or field list kept as its own object
      let all = true;
      for (const x of nw.v) { const o = ref(x) >= 0 ? await getNow(ref(x)) : null; if (!(o && isDict(o.v) && (isAnnot(o.v) || isField(o.v)))) { all = false; break; } }
      if (all) { await gained(ol.v, nw.v); continue; }
      out.other = true; continue;
    }
    if (isStream && d && d.Subtype === '/Form') { out.comments = true; continue; } // an annotation's appearance, redrawn
    out.other = true;
  }
  return out;
}

/* ---- what the document has, and the bar ---- */
// Edits since it was opened: 'none', 'form' (only values typed into its own form fields) or 'other'
function sgEdits() {
  if (!doc) return 'none';
  const pd0 = pdfDocs.get(0);
  const same = !!pd0 && doc.pages.length === pd0.numPages && doc.pages.every((e, n) => e.src === 0 && e.i === n && !e.rot && !e.crop);
  if (!same || Object.values(doc.marks).some((l) => l && l.length)) return 'other';
  try { if (pd0.annotationStorage.size && pd0.annotationStorage.modifiedIds && pd0.annotationStorage.modifiedIds.ids && pd0.annotationStorage.modifiedIds.ids.size) return 'form'; } catch {}
  try { if (pd0.annotationStorage.serializable && pd0.annotationStorage.serializable.map && pd0.annotationStorage.serializable.map.size) return 'form'; } catch {}
  return 'none';
}
// The bytes to sign or save without breaking what was signed: the file as opened, or with the form values typed in
// added as an incremental update (pdf.js writes them so). null when the document has other changes.
async function sgKeepBytes() {
  const k = sgEdits(), src = doc.sources[0];
  if (k === 'none') return new Uint8Array(src);
  if (k !== 'form') return null;
  try {
    const out = new Uint8Array(await pdfDocs.get(0).saveDocument());
    if (out.length > src.length && sgEq(out.subarray(0, src.length), src)) return out;
  } catch (e) { console.warn(e); }
  return null;
}
addStyle(`
.sg-dock[hidden] { display: none; }
.sg-dock { position: sticky; top: 0; left: 0; z-index: 19; padding: 8px 12px 0; display: flex; justify-content: center; pointer-events: none; }
.sg-bar { pointer-events: auto; display: flex; align-items: center; gap: 10px; max-width: 760px; width: 100%; padding: 6px 8px 6px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: var(--ink); box-shadow: 0 2px 10px rgba(0,0,0,.12); font-size: 13.5px; }
.sg-bar > svg, .sg-ic svg { width: 18px; height: 18px; flex: none; }
.sg-bar .sg-msg { flex: 1; min-width: 0; }
.sg-bar .btn { height: 28px; padding: 0 12px; }
.sg-bar .icon-btn { width: 28px; height: 28px; }
.sg-ok { color: #2F9E44; } .sg-warn { color: #E67700; } .sg-bad { color: var(--danger); }
:root[data-theme="dark"] .sg-ok { color: #69DB7C; } :root[data-theme="dark"] .sg-warn { color: #FFC078; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .sg-ok { color: #69DB7C; } :root:not([data-theme="light"]) .sg-warn { color: #FFC078; } }
.sg-list { display: flex; flex-direction: column; gap: 10px; margin: 6px 0; }
.sg-item { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--chrome); }
.sg-head { display: flex; align-items: center; gap: 8px; color: var(--ink); font-weight: 600; }
.sg-sub { margin: 4px 0 0 26px; font-size: 13px; color: var(--ink-2); }
.sg-sub p { margin: 2px 0; }
.sg-item details { margin: 6px 0 0 26px; font-size: 12.5px; }
.sg-item details dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 10px; margin: 6px 0; }
.sg-item dt { color: var(--ink-3); } .sg-item dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.sg-acts { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0 26px; }
.sg-acts .btn { height: 28px; padding: 0 12px; font-size: 13px; }
.sg-note { font-size: 12.5px; color: var(--ink-3); }
.sg-ids { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
.sg-id { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; background: var(--chrome); }
.sg-id > div { flex: 1; min-width: 0; font-size: 13px; } .sg-id strong { color: var(--ink); }
.sg-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.sg-row .field { flex: 1 1 200px; }
.sg-check { display: flex; gap: 8px; align-items: center; margin: 6px 0; color: var(--ink); font-size: 13.5px; }
.field select { font: inherit; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 7px 8px; }
.sg-box { position: absolute; border: 2px dashed var(--accent); background: color-mix(in srgb, var(--accent) 10%, transparent); pointer-events: none; z-index: 6; }
.sg-flash { outline: 3px solid var(--accent); outline-offset: 2px; border-radius: 3px; transition: outline-color .6s; }
.app[data-tool="sgbox"] svg.marks { cursor: crosshair; }
@media print { .sg-dock { display: none !important; } }
`);
function sgDock() {
  let dock = $('#sgDock');
  if (!dock) { dock = document.createElement('div'); dock.className = 'sg-dock'; dock.id = 'sgDock'; dock.hidden = true; viewer.insertBefore(dock, pagesEl); }
  return dock;
}
function sgShowBar() {
  const dock = sgDock(), sigs = sgState.sigs;
  if (!doc || !sigs.length || sgState.barClosed) { dock.hidden = true; dock.innerHTML = ''; return; }
  const worst = sigs.some((x) => x.status === 'invalid') ? 'invalid' : sigs.some((x) => x.status === 'changed') ? 'changed' : sigs.every((x) => x.status === 'trusted') ? 'trusted' : 'valid';
  const names = [...new Set(sigs.map((x) => x.name))];
  const who = names.length > 2 ? `${names.slice(0, 2).map(esc).join(', ')} and ${names.length - 2} more` : names.map((n) => `<strong>${esc(n)}</strong>`).join(' and ');
  const problem = worst === 'invalid' ? ' A signature is not valid.' : worst === 'changed' ? ' It was changed after signing.' : '';
  dock.innerHTML = `<div class="sg-bar" role="status"><span class="sg-ic sg-${SG_STATUS[worst][2]}">${ic(SG_STATUS[worst][1])}</span><span class="sg-msg">This PDF is digitally signed by ${who}.${problem}</span><button type="button" class="btn" data-sg="view">View signatures</button><button type="button" class="icon-btn" data-sg="x" title="Close" aria-label="Close">${ic('x')}</button></div>`;
  dock.hidden = false; icons();
  $('[data-sg="view"]', dock).onclick = () => sgPanel();
  $('[data-sg="x"]', dock).onclick = () => { sgState.barClosed = true; sgShowBar(); };
}
async function sgCheckDoc(d) {
  sgState = { sigs: [], bytes: null, checking: null, doc: d };
  sgShowBar();
  const src = d && d.sources && d.sources[0];
  if (!src) return;
  // a quick look first: most PDFs have no signature, and then nothing is loaded
  let has = false; for (let i = 0; i + 10 < src.length && !has; i += 1 << 20) has = sgLatin1(src.subarray(i, Math.min(src.length, i + (1 << 20) + 16))).includes('/ByteRange');
  if (!has) return;
  const job = (async () => {
    try {
      const sigs = await sgVerifyAll(src, src.password);
      if (doc !== d) return;
      sgState.sigs = sigs; sgState.bytes = src; sgShowBar();
    } catch (e) { console.warn('Signatures could not be checked', e); }
  })();
  sgState.checking = job; await job; sgState.checking = null;
}
FEATURE.onDocShown.push((d) => { sgCheckDoc(d); });
FEATURE.onDocClosed.push(() => { sgState = { sigs: [] }; sgShowBar(); });

/* ---- the Signatures panel ---- */
function sgItemHtml(x) {
  const [label, icon, tone] = SG_STATUS[x.status];
  const c = x.cert, dt = (k, v) => v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
  const when = x.ts && x.ts.ok ? `Signed ${esc(sgWhen(x.ts.time))}` : x.when ? `Signed ${esc(sgWhen(x.when))} (the signer’s clock)` : '';
  return `<div class="sg-item" data-sg-n="${x.n}">
    <div class="sg-head"><span class="sg-ic sg-${tone}" title="${esc(label)}">${ic(icon)}</span><span>${esc(x.name)}</span></div>
    <div class="sg-sub"><p class="sg-status"><strong class="sg-${tone}">${esc(x.statusText || label)}</strong>${x.certify ? ' · Certified' : ''}</p>
      ${when ? `<p>${when}</p>` : ''}
      ${x.ts ? `<p>${x.ts.ok ? `Timestamp: ${esc(sgWhen(x.ts.time))}${x.ts.tsa ? ' by ' + esc(x.ts.tsa) : ''}` : 'The timestamp does not check out.'}</p>` : '<p>No timestamp</p>'}
      ${x.reason ? `<p>Reason: ${esc(x.reason)}</p>` : ''}${x.location ? `<p>Location: ${esc(x.location)}</p>` : ''}
      ${x.changeText ? `<p>${esc(x.changeText)}</p>` : ''}
      ${x.notes.map((n) => `<p>${esc(n)}</p>`).join('')}
      ${x.status === 'valid' && !x.certExpired ? '<p>The file has not changed since it was signed. Who signed it is not confirmed: trust this certificate only if you know it is theirs.</p>' : ''}</div>
    ${c ? `<details><summary>Certificate</summary><dl>${dt('Issued to', c.subject)}${dt('Email', c.email)}${dt('Issued by', c.selfSigned ? 'Self-signed (by the signer)' : c.issuer)}${dt('Valid', `${c.notBefore.toLocaleDateString()} to ${c.notAfter.toLocaleDateString()}`)}${dt('Serial number', c.serial)}${dt('Key', c.key)}${dt('SHA-256', c.fp.match(/.{2}/g).join(':'))}${dt('Format', x.subFilter)}${dt('Field', x.field)}</dl></details>` : ''}
    <div class="sg-acts">${c ? `<button type="button" class="btn" data-sg-trust="${x.n}">${x.trusted ? 'Stop trusting this certificate' : 'Trust this certificate on this device'}</button>` : ''}${x.page >= 0 ? `<button type="button" class="btn" data-sg-go="${x.n}">Go to field</button>` : ''}</div>
  </div>`;
}
async function sgPanel() {
  if (!doc) return;
  if (sgState.checking) await sgState.checking;
  const list = () => sgState.sigs.length ? `<div class="sg-list">${sgState.sigs.map(sgItemHtml).join('')}</div>` : '<p>This PDF has no digital signatures.</p>';
  const body = `<div id="sgPanelList">${list()}</div><p class="sg-note">Revocation is not checked: Cowdrey.PDF does not ask certificate authorities whether a certificate was withdrawn. No certificate is trusted until you trust it here.</p>`;
  await dialog('Signatures', body, [{ label: 'Close', primary: true }], (dlg) => {
    const wire = () => {
      icons();
      $$('[data-sg-trust]', dlg).forEach((b) => b.onclick = async () => {
        const x = sgState.sigs.find((y) => y.n === +b.dataset.sgTrust); if (!x || !x.cert) return;
        try { if (x.trusted) await sgTrustDel(x.cert.fp); else await sgTrustPut(x.cert.fp, x.name); } catch (e) { toast('Could not keep that on this device'); return; }
        sgState.sigs = await sgVerifyAll(sgState.bytes || doc.sources[0], doc.sources[0].password);
        $('#sgPanelList', dlg).innerHTML = list(); wire(); sgShowBar();
        toast(x.trusted ? 'This certificate is no longer trusted' : `${x.name}’s certificate is trusted on this device`);
      });
      $$('[data-sg-go]', dlg).forEach((b) => b.onclick = () => {
        const x = sgState.sigs.find((y) => y.n === +b.dataset.sgGo); $('[data-x]', dlg).click(); if (x) sgGoTo(x);
      });
    };
    wire();
  });
}
function sgGoTo(x) {
  const n = doc.pages.findIndex((e) => e.src === 0 && e.i === x.page); if (n < 0) return;
  goPage(n);
  setTimeout(() => {
    const v = views[n]; if (!v || !v.viewport || !x.rect) return;
    const [ax, ay] = toView(v, x.rect[0], x.rect[1]), [bx, by] = toView(v, x.rect[2], x.rect[3]);
    const el = document.createElement('div'); el.className = 'sg-box sg-flash';
    Object.assign(el.style, { left: Math.min(ax, bx) + 'px', top: Math.min(ay, by) + 'px', width: Math.abs(bx - ax) + 'px', height: Math.abs(by - ay) + 'px', borderStyle: 'solid' });
    v.el.appendChild(el); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => el.remove(), 2200);
  }, 350);
}

// Checks a dialog's fields before its main button closes it: `check` returns false to keep it open.
function sgGuard(dlg, check) {
  const body = $('.dlg-body', dlg); // replaced by the next dialog: the check goes with it
  const g = (e) => {
    if (!body.isConnected) { dlg.removeEventListener('click', g, true); return; }
    const b = e.target.closest && e.target.closest('.dlg-foot .btn.primary');
    if (b && !check()) { e.stopPropagation(); e.preventDefault(); }
  };
  dlg.addEventListener('click', g, true);
}
/* ---- the signing IDs dialog ---- */
const sgIdLine = (r) => `${esc(r.kind)} · valid to ${new Date(r.notAfter).toLocaleDateString()}${r.selfSigned ? ' · self-signed' : ` · issued by ${esc(r.issuer)}`}`;
async function sgIdsDialog() {
  const draw = async () => {
    const ids = await sgIdsAll().catch(() => []);
    return ids.length ? `<div class="sg-ids">${ids.map((r) => `<div class="sg-id" data-sg-id="${esc(r.id)}"><span class="sg-ic">${ic('id-card')}</span><div><strong>${esc(r.name)}</strong>${r.email ? ` &lt;${esc(r.email)}&gt;` : ''}<br><span class="sg-note">${esc(r.subject)}<br>${sgIdLine(r)}</span></div>
      <button type="button" class="icon-btn" data-sg-export="${esc(r.id)}" title="Save a copy (.p12)" aria-label="Save a copy of ${esc(r.name)}">${ic('download')}</button><button type="button" class="icon-btn" data-sg-del="${esc(r.id)}" title="Delete" aria-label="Delete ${esc(r.name)}">${ic('trash-2')}</button></div>`).join('')}</div>`
      : '<p>No signing IDs on this device yet. Import the .p12 or .pfx file your certificate came in, or create one here.</p>';
  };
  const p = sgPrefs();
  const body = `<div id="sgIdList">${await draw()}</div>
    <div class="sg-row"><button type="button" class="btn" id="sgImport">${ic('upload')}<span>Import .p12 or .pfx…</span></button><button type="button" class="btn" id="sgCreate">${ic('plus')}<span>Create a signing ID…</span></button><input type="file" id="sgFile" accept=".p12,.pfx,application/x-pkcs12" hidden></div>
    <p class="sg-note">The files stay on this device, still locked with their password. The password is never stored.</p>
    <label class="field"><span>Timestamp server (optional)</span><input id="sgTsa" type="url" placeholder="https://" value="${esc(p.tsa)}" autocomplete="off" spellcheck="false"></label>
    <p class="sg-note" id="sgTsaNote">Sends a fingerprint of the signature, not the document, to the timestamp server.</p>`;
  let todo = null;
  await dialog('Signing IDs', body, [{ label: 'Close', primary: true }], (dlg) => {
    const wire = () => {
      icons();
      $$('[data-sg-del]', dlg).forEach((b) => b.onclick = async () => {
        const id = b.dataset.sgDel; await sgIdDel(id); sgPasswords.delete(id);
        $('#sgIdList', dlg).innerHTML = await draw(); wire(); toast('Signing ID deleted from this device');
      });
      $$('[data-sg-export]', dlg).forEach((b) => b.onclick = async () => {
        const r = (await sgIdsAll()).find((x) => x.id === b.dataset.sgExport); if (!r) return;
        try { await saveFile(new Uint8Array(r.p12), safeName(r.name) + '.p12', 'application/x-pkcs12'); } catch (e) { toast('Could not save it: ' + (e.message || e)); }
      });
    };
    wire();
    $('#sgTsa', dlg).onchange = (e) => { sgSetPrefs({ tsa: e.target.value.trim() }); };
    $('#sgImport', dlg).onclick = () => $('#sgFile', dlg).click();
    $('#sgFile', dlg).onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; todo = { import: new Uint8Array(await f.arrayBuffer()), name: f.name }; $('[data-x]', dlg).click(); };
    $('#sgCreate', dlg).onclick = () => { todo = { create: true }; $('[data-x]', dlg).click(); };
  });
  const tsaIn = sgPrefs().tsa;
  if (tsaIn && !/^https?:\/\//i.test(tsaIn)) { sgSetPrefs({ tsa: '' }); toast('The timestamp server must be a web address (https://…)'); }
  if (todo && todo.import) { await sgImportId(todo.import, todo.name); return sgIdsDialog(); }
  if (todo && todo.create) { await sgCreateDialog(); return sgIdsDialog(); }
}
async function sgImportId(bytes, fileName) {
  for (let tries = 0; ; tries++) {
    const pw = await askText(tries ? 'That password did not open it' : 'Import signing ID', `Enter the password for ${fileName}. It is not stored.`, '', 'Import', true);
    if (pw == null) return null;
    try {
      const id = await sgOpenP12(bytes, pw);
      const rec = sgIdRecord(bytes, id);
      await sgIdPut(rec);
      toast(`Signing ID for ${rec.name} added`);
      return rec;
    } catch (e) {
      if (e instanceof SgError && /password/.test(e.message)) continue;
      await dialog('Import signing ID', `<p>${esc(e.message || String(e))}</p>`, [{ label: 'OK', primary: true }]); return null;
    }
  }
}
async function sgCreateDialog() {
  const body = `<p>A signing ID made here is self-signed: it proves a file has not changed since you signed it, and others can trust it once they know it is yours.</p>
    <label class="field"><span>Name</span><input id="sgcName" type="text" autocomplete="name" value="${esc(S.author || '')}"></label>
    <label class="field"><span>Email (optional)</span><input id="sgcEmail" type="email" autocomplete="email"></label>
    <label class="field"><span>Key</span><select id="sgcKind"><option value="rsa">RSA 2048 (works everywhere)</option><option value="ec">ECDSA P-256 (smaller)</option></select></label>
    <label class="field"><span>Password</span><input id="sgcPw" type="password" autocomplete="new-password"></label>
    <label class="field"><span>Type it again</span><input id="sgcPw2" type="password" autocomplete="new-password"></label>
    <p class="sg-note">The password locks the signing ID on this device and in copies you save. It is not stored: you type it when you sign. Valid 5 years.</p>`;
  let vals = null;
  const a = await dialog('Create a signing ID', body, [{ label: 'Cancel' }, { label: 'Create', value: 'go', primary: true }], (dlg) => sgGuard(dlg, () => {
    const v = { name: $('#sgcName', dlg).value.trim(), email: $('#sgcEmail', dlg).value.trim(), kind: $('#sgcKind', dlg).value, password: $('#sgcPw', dlg).value, password2: $('#sgcPw2', dlg).value };
    if (!v.name) { toast('Type your name first'); return false; }
    if (v.email && !/^[^@\s]+@[^@\s]+$/.test(v.email)) { toast('That email address does not look right'); return false; }
    if (v.password.length < 4) { toast('Choose a password of 4 letters or more'); return false; }
    if (v.password !== v.password2) { toast('The passwords are not the same'); return false; }
    vals = v; return true;
  }));
  if (a !== 'go' || !vals) return null;
  toast('Creating your signing ID…');
  try {
    const rec = await sgCreateId(vals);
    await sgIdPut(rec);
    toast(`Signing ID for ${rec.name} created`);
    return rec;
  } catch (e) { console.error(e); toast('Could not create the signing ID: ' + (e.message || e)); return null; }
}

/* ---- signing ---- */
let sgBoxWait = null; // { resolve } while a box is being drawn
FEATURE.tools.sgbox = {
  down(e, v) {
    e.preventDefault();
    const [x0, y0] = pagePoint(e, v), el = document.createElement('div'); el.className = 'sg-box'; v.el.appendChild(el);
    let x1 = x0, y1 = y0;
    const place = () => Object.assign(el.style, { left: Math.min(x0, x1) + 'px', top: Math.min(y0, y1) + 'px', width: Math.abs(x1 - x0) + 'px', height: Math.abs(y1 - y0) + 'px' });
    place();
    const move = (ev) => { [x1, y1] = pagePoint(ev, v); place(); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); el.remove();
      if (Math.abs(x1 - x0) < 30 || Math.abs(y1 - y0) < 14) { toast('Drag a larger box for the signature'); return; }
      const [a, b] = toPdf(v, x0, y0), [c, d] = toPdf(v, x1, y1);
      const w = sgBoxWait; sgBoxWait = null; setTool('select');
      if (w) w.resolve({ n: views.indexOf(v), rect: [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)] });
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  },
};
TOOL_HINTS.sgbox = 'Drag a box where the signature goes';
cmd('tool_sgbox', { label: 'Draw a signature box', icon: 'square-dashed-mouse-pointer', hidden: true, enabled: has, pressed: () => app.dataset.tool === 'sgbox', run: () => setTool('sgbox') });
new MutationObserver(() => { if (app.dataset.tool !== 'sgbox' && sgBoxWait) { const w = sgBoxWait; sgBoxWait = null; w.resolve(null); } }).observe(app, { attributes: true, attributeFilter: ['data-tool'] });
function sgDrawBox() {
  return new Promise((resolve) => { if (sgBoxWait) sgBoxWait.resolve(null); setTool('sgbox'); sgBoxWait = { resolve }; toast('Drag a box where the signature goes'); });
}
// The choices for where to sign: empty signature fields in the PDF, new ones made on the Forms tab, or a new box.
async function sgPlaces() {
  const out = (await sgEmptyFields()).map((f) => ({ key: 'f:' + f.name, label: `${f.name} (page ${(doc.pages.findIndex((e) => e.src === 0 && e.i === f.page) + 1) || f.page + 1})`, field: f.name }));
  for (const [k, l] of Object.entries(doc.marks)) {
    if (k === '__doc') continue;
    for (const m of l) if (m.type === 'ff' && m.kind === 'sig') { const n = doc.pages.findIndex((e) => pageKey(e) === k); out.push({ key: 'm:' + m.id, label: `${m.name} (new, page ${n + 1})`, mark: m }); }
  }
  out.push({ key: 'draw', label: 'Draw a signature box' });
  return out;
}
async function sgSign(pre = {}) {
  if (!doc) return;
  if (doc.sources[0].password) { toast('Remove the password before signing: Protect › Remove security, then save.'); return; }
  let ids = await sgIdsAll().catch(() => []);
  if (!ids.length) {
    const a = await dialog('Sign with a certificate', '<p>To sign with a certificate you need a signing ID: the .p12 or .pfx file your certificate came in, or one you create here.</p>', [{ label: 'Cancel' }, { label: 'Import .p12 or .pfx…', value: 'import' }, { label: 'Create a signing ID…', value: 'create', primary: true }]);
    if (a === 'create') await sgCreateDialog();
    else if (a === 'import') {
      const f = await new Promise((res) => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.p12,.pfx,application/x-pkcs12'; i.onchange = () => res(i.files[0] || null); i.click(); });
      if (f) await sgImportId(new Uint8Array(await f.arrayBuffer()), f.name);
    }
    ids = await sgIdsAll().catch(() => []);
    if (!ids.length) return;
  }
  if (sgState.checking) await sgState.checking;
  if (sgState.sigs.some((x) => x.certify === 1)) {
    const a = await dialog('This PDF allows no changes', '<p>Its author certified it with no changes allowed. Another signature counts as a change, so their certification will show as broken.</p>', [{ label: 'Cancel' }, { label: 'Sign anyway', value: 'go', primary: true }]);
    if (a !== 'go') return;
  }
  const places = await sgPlaces(), first = !sgState.sigs.length, prefs = sgPrefs();
  const looks = [...sigSaved().map((s, k) => ({ key: 's' + k, label: `Signature ${k + 1} (saved)`, image: s.data })), { key: 'typed', label: 'My name, typed' }, { key: 'text', label: 'Text only' }];
  let v = { id: pre.id || store.get('signingLast', null) || ids[0].id, place: pre.place || (places.find((p) => p.field === pre.field) || places[0]).key, look: looks[0].key, reason: '', location: '', contact: '', certify: '0', lock: false, ts: !!prefs.tsa, fmt: prefs.subFilter, remember: false };
  if (!ids.some((r) => r.id === v.id)) v.id = ids[0].id;
  for (;;) {
    const r = await sgSignDialog(ids, places, looks, v, first, prefs); if (!r) return;
    v = r;
    const rec = ids.find((x) => x.id === v.id);
    let id;
    try { id = await sgOpenP12(rec.p12, v.password); }
    catch (e) { toast(e.message || String(e)); if (e instanceof SgError && /password/.test(e.message)) { sgPasswords.delete(rec.id); v.password = ''; continue; } return; }
    if (v.remember) sgPasswords.set(rec.id, v.password); else sgPasswords.delete(rec.id);
    store.set('signingLast', rec.id); sgSetPrefs({ subFilter: v.fmt });
    if (Date.now() > rec.notAfter) { const a = await dialog('This certificate has expired', `<p>The certificate in ${esc(rec.name)}’s signing ID expired on ${new Date(rec.notAfter).toLocaleDateString()}. A signature made with it will show as not valid at the time of signing.</p>`, [{ label: 'Cancel' }, { label: 'Sign anyway', value: 'go', primary: true }]); if (a !== 'go') return; }
    const place = places.find((p) => p.key === v.place);
    let box = null;
    if (place.key === 'draw') { box = await sgDrawBox(); if (!box) return; }
    const look = looks.find((l) => l.key === v.look);
    return sgSignWith({ id, place, box, look, o: { subFilter: v.fmt, reason: v.reason.trim(), location: v.location.trim(), contact: v.contact.trim(), certify: first ? +v.certify : 0, lock: v.lock, tsa: v.ts && prefs.tsa ? prefs.tsa : '' } });
  }
}
function sgSignDialog(ids, places, looks, v, first, prefs) {
  const opt = (val, label, cur) => `<option value="${esc(val)}"${val === cur ? ' selected' : ''}>${esc(label)}</option>`;
  const remembered = sgPasswords.get(v.id);
  const tsHost = (() => { try { return new URL(prefs.tsa).host; } catch { return ''; } })();
  const body = `<label class="field"><span>Signing ID</span><select id="sgId">${ids.map((r) => opt(r.id, `${r.name}${r.email ? ' <' + r.email + '>' : ''} · ${r.selfSigned ? 'self-signed' : r.issuer}`, v.id)).join('')}</select></label>
    <div id="sgPwRow"${remembered ? ' hidden' : ''}><label class="field"><span>Password</span><input id="sgPw" type="password" autocomplete="current-password" value=""></label>
    <label class="sg-check"><input type="checkbox" id="sgRemember"${v.remember ? ' checked' : ''}> Remember until I close the app</label></div>
    <div class="sg-row"><label class="field"><span>Where</span><select id="sgPlace">${places.map((p) => opt(p.key, p.label, v.place)).join('')}</select></label>
    <label class="field"><span>Look</span><select id="sgLook">${looks.map((l) => opt(l.key, l.label, v.look)).join('')}</select></label></div>
    <details${v.reason || v.location || v.contact ? ' open' : ''}><summary>Reason, location and contact (optional)</summary>
      <label class="field"><span>Reason</span><input id="sgReason" type="text" value="${esc(v.reason)}" placeholder="For example: I approve this document"></label>
      <div class="sg-row"><label class="field"><span>Location</span><input id="sgLocation" type="text" value="${esc(v.location)}"></label><label class="field"><span>Contact</span><input id="sgContact" type="text" value="${esc(v.contact)}"></label></div></details>
    <details><summary>More options</summary>
      ${first ? `<label class="field"><span>Certify (first signature only)</span><select id="sgCertify">${opt('0', 'Don’t certify', v.certify)}${opt('1', 'Certify: no changes allowed', v.certify)}${opt('2', 'Certify: form filling and signing allowed', v.certify)}${opt('3', 'Certify: also comments allowed', v.certify)}</select></label>` : ''}
      <label class="sg-check"><input type="checkbox" id="sgLock"${v.lock ? ' checked' : ''}> Lock the fields after signing</label>
      <label class="field"><span>Format</span><select id="sgFmt">${opt(SG_CADES, 'PAdES (ETSI.CAdES.detached)', v.fmt)}${opt(SG_PKCS7, 'PKCS #7 (adbe.pkcs7.detached)', v.fmt)}</select></label></details>
    ${prefs.tsa ? `<label class="sg-check"><input type="checkbox" id="sgTs"${v.ts ? ' checked' : ''}> Add a timestamp from ${esc(tsHost || prefs.tsa)}</label><p class="sg-note">Sends a fingerprint of the signature, not the document, to the timestamp server.</p>` : '<p class="sg-note">No timestamp: the time comes from this device’s clock. A timestamp server can be set in Signing IDs.</p>'}
    <p class="sg-note">The signed PDF is saved as a new file, with the signature added after the original bytes.</p>`;
  let out = null;
  return dialog('Sign with certificate', body, [{ label: 'Cancel' }, { label: 'Sign', value: 'sign', primary: true }], (dlg) => {
    const idSel = $('#sgId', dlg);
    idSel.onchange = () => { $('#sgPwRow', dlg).hidden = sgPasswords.has(idSel.value); };
    sgGuard(dlg, () => {
      const val = (s) => { const el = $(s, dlg); return el ? el.value : ''; }, chk = (s) => { const el = $(s, dlg); return !!(el && el.checked); };
      const r = { ...v, id: idSel.value, place: val('#sgPlace'), look: val('#sgLook'), reason: val('#sgReason'), location: val('#sgLocation'), contact: val('#sgContact'), certify: val('#sgCertify') || '0', lock: chk('#sgLock'), fmt: val('#sgFmt') || SG_CADES, ts: chk('#sgTs'), remember: chk('#sgRemember') };
      r.password = sgPasswords.get(r.id) ?? val('#sgPw');
      if (sgPasswords.has(r.id)) r.remember = true;
      if (!r.password) { toast('Type the password for this signing ID'); $('#sgPw', dlg).focus(); return false; }
      out = r; return true;
    });
  }).then((a) => a === 'sign' ? out : null);
}
// Signs with an open signing ID and saves the signed PDF as a new file, then shows it.
async function sgSignWith({ id, place, box, look, o }) {
  let base = await sgKeepBytes(), target;
  const kept = !!base;
  if (place.mark || !base) {
    if (sgState.sigs.length) {
      const a = await dialog('Sign this version?', '<p>This PDF has changes, so it is saved again before signing, and the existing signatures will show as changed.</p>', [{ label: 'Cancel' }, { label: 'Sign anyway', value: 'go', primary: true }]);
      if (a !== 'go') return false;
    }
    base = await buildPdf(); if (!base) return false;
    base = new Uint8Array(base);
  }
  const usesBuilt = !kept || !!place.mark;
  if (place.field) target = { name: place.field };
  else if (place.mark) target = { name: place.mark.name };
  else if (box) target = { page: usesBuilt ? box.n : doc.pages[box.n].i, rect: box.rect };
  const lines = [`Digitally signed by ${id.info.name}`, `Date: ${sgPdfDate(new Date()).slice(2, 16).replace(/(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)/, '$1.$2.$3 $4:$5:$6')}`, o.reason && `Reason: ${o.reason}`, o.location && `Location: ${o.location}`];
  const image = look.image || (look.key === 'typed' ? sgTypedImage(id.info.name) : null);
  let signed;
  try {
    toast(o.tsa ? 'Signing and asking for a timestamp…' : 'Signing…');
    if (place.mark) { // a field made on the Forms tab is saved under its name, made unique
      const L = await loadPdfLib(), pdf = await L.PDFDocument.load(base, { ignoreEncryption: true, updateMetadata: false });
      const names = sgFieldsOf(L, pdf).filter((f) => f.ft === '/Sig' && !f.v).map((f) => f.name), clean = String(place.mark.name || '').trim().replace(/\./g, '_');
      target = { name: names.includes(place.mark.name) ? place.mark.name : names.includes(clean) ? clean : names.find((n) => n.startsWith(clean)) || clean };
    }
    signed = await sgSignBytes(base, target, id, { image, lines }, o);
  } catch (e) { console.error(e); await dialog('Could not sign', `<p>${esc(e.message || String(e))}</p>`, [{ label: 'OK', primary: true }]); return false; }
  window.__lastSigned = signed;
  const name = (/\(signed\)$/.test(doc.name) ? doc.name : doc.name + ' (signed)') + '.pdf';
  let where;
  try { where = await saveFile(signed, name, 'application/pdf'); } catch (e) { console.error(e); toast('Could not save the signed PDF: ' + (e.message || e)); return false; }
  if (!where) { toast('The signed PDF was not saved'); return false; }
  // the signed file is the document now
  const path = typeof where === 'string' ? where : undefined;
  await serial(async () => openBytes(signed, path ? path.split('/').pop() : name, path, path ? await fileTime(path) : 0));
  window.__lastSignedShown = signed.length;
  if (!MAC_APP) toast('Signed. The signed PDF is in your downloads.');
  return true;
}

/* ---- saving a signed PDF ---- */
FEATURE.beforeSave.push(async ({ copy }) => {
  if (sgState.checking) await sgState.checking;
  if (!doc || !sgState.sigs || !sgState.sigs.length || sgState.doc !== doc) return;
  const keep = await sgKeepBytes();
  if (keep) return { bytes: keep }; // the signatures stay valid (form values are added after them)
  const a = await dialog('This PDF is signed', `<p>Saving makes a new copy of the file and the existing signatures will show as changed. Save a copy instead?</p>`, [{ label: 'Cancel' }, { label: 'Save anyway', value: 'anyway' }, { label: 'Save a copy', value: 'copy', primary: true }]);
  if (!a) return false;
  return a === 'copy' && !copy ? { copy: true } : undefined;
});
// The forms package calls this when an empty signature field is clicked while filling in: true when handled here.
// The forms package passes `picture` (places the picture alone); it treats any answer but 'picture' as handled.
FEATURE.onSigField = async ({ field, picture }) => {
  const name = field && (field.name || field.fieldName || field.T);
  const a = await dialog('Sign this field', `<p>Sign${name ? ` “${esc(name)}”` : ''} with a certificate (a digital signature others can check), or place a picture of your signature only.</p>`, [{ label: 'Cancel' }, { label: 'Place signature picture only', value: 'picture' }, { label: 'Sign with certificate', value: 'cert', primary: true }]);
  if (a === 'cert') { await sgSign({ field: name }); return true; }
  if (a !== 'picture') return true;
  if (typeof picture === 'function') { await picture(); return true; }
  return false;
};

/* ---- commands ---- */
cmd('sgSign', { label: 'Sign with certificate…', rlabel: 'Sign with certificate', icon: 'pen-tool', enabled: has, run: () => sgSign() });
cmd('sgPanel', { label: 'Signatures', icon: 'badge-check', enabled: has, run: sgPanel });
cmd('sgIds', { label: 'Signing IDs…', icon: 'id-card', run: sgIdsDialog });
ribbonAdd('protect', 'Certificate', ['sgSign', 'sgPanel', 'sgIds']);
menuAdd('Protect', ['sign']);
menuAdd('Protect', ['sgSign', 'sgPanel', 'sgIds']);
TEST_HOOKS.sgLoadLibs = async () => { const l = await sgLoadLibs(); await sgForge(); return Object.keys(l.pkijs).length > 50 && !!l.asn1js.Sequence; };
TEST_HOOKS.sgSignatures = async () => { if (sgState.checking) await sgState.checking; return (sgState.sigs || []).map((x) => ({ n: x.n, status: x.status, statusText: x.statusText, name: x.name, when: x.when ? x.when.toISOString() : null, ts: x.ts ? { ok: x.ts.ok, time: x.ts.time && x.ts.time.toISOString(), tsa: x.ts.tsa } : null, digestOk: x.digestOk, sigOk: x.sigOk, trusted: !!x.trusted, changes: x.changes || null, field: x.field, page: x.page, reason: x.reason, subFilter: x.subFilter, certify: x.certify || 0, notes: x.notes, cert: x.cert ? { subject: x.cert.subject, fp: x.cert.fp, key: x.cert.key } : null })); };
TEST_HOOKS.sgVerify = async (u8) => (await sgVerifyAll(new Uint8Array(u8))).map((x) => ({ status: x.status, statusText: x.statusText, name: x.name, changes: x.changes || null, ts: !!x.ts }));
TEST_HOOKS.sgCreateId = async (o) => { const r = await sgCreateId(o); await sgIdPut(r); return { id: r.id, name: r.name, kind: r.kind, p12: Array.from(r.p12) }; };
TEST_HOOKS.sgImportId = async (u8, password) => { const id = await sgOpenP12(new Uint8Array(u8), password); const r = sgIdRecord(new Uint8Array(u8), id); await sgIdPut(r); return { id: r.id, name: r.name, chain: id.chain.length, hash: id.hash, alg: id.alg.name }; };
TEST_HOOKS.sgOpenP12 = async (u8, password) => { try { const id = await sgOpenP12(new Uint8Array(u8), password); return { name: id.info.name, chain: id.chain.length, alg: id.alg.name }; } catch (e) { return { error: e.message }; } };
TEST_HOOKS.sgIds = async () => (await sgIdsAll()).map((r) => ({ id: r.id, name: r.name, kind: r.kind }));
TEST_HOOKS.sgEdits = () => sgEdits();
TEST_HOOKS.sgHasSigFieldHook = () => typeof FEATURE.onSigField === 'function';
TEST_HOOKS.sgSignNow = async ({ id, password, field, page, rect, o = {}, look = 'text', mark }) => {
  const rec = (await sgIdsAll()).find((r) => r.id === id) || (await sgIdsAll())[0];
  const ident = await sgOpenP12(rec.p12, password);
  const m = mark && (await sgPlaces()).find((x) => x.mark);
  const place = m || (field ? { key: 'f:' + field, field } : { key: 'draw' });
  return sgSignWith({ id: ident, place, box: field ? null : { n: page || 0, rect }, look: { key: look }, o });
};
