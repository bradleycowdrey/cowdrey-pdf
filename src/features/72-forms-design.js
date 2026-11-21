/* ---------------- forms designer: Prepare form, as in other PDF apps (the Forms tab) ----------------
   Fields already in the PDF are changed through 'ffx' proxy marks, one for each widget, made the first time a widget
   is moved, resized, picked with others or given new settings (made quietly: making one changes nothing, and is not
   an undo step). While a widget has a proxy, the proxy is what shows (pdf.js's own control for it is hidden), and on
   saving the widget is rewritten in place with pdf-lib: /Rect, /MK, /BS, /DA, /Q, /Ff, /MaxLen, /Opt, /TU, /DV, /V,
   /AA and its look (/AP). A widget of a field with several (/Kids) moves on its own.
     ffx  { ref (pdf.js annotation id, "12R"), name (the field's name in the PDF), kind, x1, y1, x2, y2, rot, F, orig,
            origVal, val, daFont (the font its /DA names), ownFont (a font of the PDF's own), and the settings below }
   Settings, on new fields ('ff') and proxies alike:
     font Helv | TiRo | Cour, size, color, bc, bg (hex, '' none), bs S|D|B|I|U, bw, q 0|1|2, multi, max, comb, scroll,
     pw, nospell, opts, edit, sort, multisel, exp, style (check, circle, cross, diamond, square, star), dv,
     af { t: none|number|percent|date|time|special|custom, dec, sep, neg, cur, pre, df, tm, sp, js, ks }  format
     vl { t: none|range|custom, min, max, js }                                                          validate
     cl { t: none|simple|sfn|custom, op, fields, sfn, js }                                               calculate
     mu { t: none|reset|url|page|show|print|submit, url, page, field, hide, to, as }                      mouse up
     pic { data, w, h }  a signature field's picture (its look, not a digital signature)
     cp  copies of one new field on other pages (Copy to pages…) share it: one field, its widgets as /Kids
     cpOf  a copy of a field from the PDF: another widget of that field
   Document marks: 'fftab' { pages: { pageKey: { tabs: S|R|C, order: ['m:'+markId | 'w:'+annotId] } } } (tab order),
   'ffco' { order: ['m:'+markId | 'n:'+name] } (calculation order).
   Fill in runs formats and calculations made with the standard functions (AFNumber_*, AFPercent_*, AFDate_*,
   AFTime_*, AFSpecial_*, AFRange_Validate, AFSimple_Calculate and simplified field notation) with its own small
   evaluator: no script from the PDF is ever run here. */
const FFD_FONTS = [['Helv', 'Helvetica'], ['TiRo', 'Times'], ['Cour', 'Courier']];
const FFD_BASE = { Helv: 'Helvetica', TiRo: 'Times-Roman', Cour: 'Courier' };
// Check box and radio button styles: the ZapfDingbats character other apps use (/MK /CA), and how it looks here
const FFD_STYLES = { check: ['4', 'Check'], circle: ['l', 'Circle'], cross: ['8', 'Cross'], diamond: ['u', 'Diamond'], square: ['n', 'Square'], star: ['H', 'Star'] };
const FFD_BORDERS = [['S', 'Solid'], ['D', 'Dashed'], ['B', 'Beveled'], ['I', 'Inset'], ['U', 'Underline']];
const FFD_PDFJS_BORDER = { 1: 'S', 2: 'D', 3: 'B', 4: 'I', 5: 'U' };
const FFD_SEPS = [[0, '1,234.56'], [1, '1234.56'], [2, '1.234,56'], [3, '1234,56']];
const FFD_NEGS = [[0, '-1,234.01'], [1, '1,234.01 (red in other apps)'], [2, '(1,234.01)'], [3, '(1,234.01) (red in other apps)']];
const FFD_TIMES = ['HH:MM', 'h:MM tt', 'HH:MM:ss', 'h:MM:ss tt'];
const FFD_SPECIAL = ['Zip code', 'Zip code + 4', 'Phone number', 'Social Security number'];
const FFD_DATES = [...FF_DATE_FORMATS, 'm/d/yy', 'dd.mm.yyyy', 'mmmm d, yyyy'];
const FFD_OPS = [['SUM', 'Sum (+)'], ['PRD', 'Product (×)'], ['AVG', 'Average'], ['MIN', 'Minimum'], ['MAX', 'Maximum']];
const FFD_GRID = 4; // pt
let ffdSel = new Set();      // ids of the selected field marks, for the layout tools (the one last picked is selMark)
let ffdDrag = null;          // while a selected field is dragged: the others' places when the drag began
let ffdWidgetCache = null;   // { doc, list: [{ src, page, pd, a }] }: every widget of every source, as pdf.js reads them
const ffdKeys = ['kind', 'x1', 'y1', 'x2', 'y2', 'rot', 'size', 'font', 'color', 'bc', 'bg', 'bs', 'bw', 'q', 'multi', 'max', 'comb', 'scroll', 'pw', 'nospell', 'opts', 'edit', 'sort', 'multisel', 'exp', 'style', 'label', 'dv', 'af', 'vl', 'cl', 'mu', 'pic'];
const ffdOrigOf = (m) => JSON.stringify(ffdKeys.map((k) => m[k] ?? null));
const ffdDirty = (m) => m.type === 'ffx' && (ffdOrigOf(m) !== m.orig || JSON.stringify(m.val ?? null) !== m.origVal);
const ffdHex = (c0) => { const c = c0 && (c0.length != null ? [...c0] : Object.values(c0)); return c && c.length === 3 ? '#' + c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('').toUpperCase() : ''; };
const ffdRgb = (hex) => { const n = parseInt(String(hex || '#000000').slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const ffdNum = (n) => { const r = Math.round(n * 1000) / 1000; return Object.is(r, -0) ? '0' : String(r); };
const ffdFontKey = (name) => { const n = String(name || ''); return /^(TiRo|Times|TimesRoman|Times-Roman|TimesNewRoman)/i.test(n) ? 'TiRo' : /^(Cour|Courier)/i.test(n) ? 'Cour' : 'Helv'; };
const ffdFieldMarks = () => ffAllMarks().filter(ffIsField);
const ffdNameOf = (m) => (m.type === 'ffx' ? ffShown(m.name) : m.name);
const ffdKindOf = (a) => (a.fieldType === 'Tx' ? 'text' : a.fieldType === 'Ch' ? (a.combo ? 'combo' : 'list') : a.fieldType === 'Sig' ? 'sig' : a.checkBox ? 'check' : a.radioButton ? 'radio' : 'button');
const ffdEntryOf = (m) => doc.pages.find((e) => marksOf(e).includes(m));
const ffdViewOf = (m) => views.find((v) => marksOf(v.entry).includes(m));
// One field, several widgets: the marks for the same field (copies of a new field; widgets of a field from the PDF)
const ffdSiblings = (m) => ffdFieldMarks().filter((r) => r !== m && r.type === m.type && (m.type === 'ffx' ? r.name === m.name : (m.cp && r.cp === m.cp) || (m.kind === 'radio' && r.kind === 'radio' && r.name === m.name)));

/* ---- every widget in the document's sources (for fields on pages not drawn yet) ---- */
async function ffdWidgets() {
  if (ffdWidgetCache && ffdWidgetCache.doc === doc && ffdWidgetCache.n === pdfDocs.size) return ffdWidgetCache.list;
  const list = [];
  for (const [src, pd] of pdfDocs) for (let i = 0; i < pd.numPages; i++) {
    try { for (const a of await (await pd.getPage(i + 1)).getAnnotations({ intent: 'display' })) if (a.annotationType === pdfjs.AnnotationType.WIDGET && a.fieldName && a.rect) list.push({ src, page: i, pd, a }); } catch {}
  }
  ffdWidgetCache = { doc, n: pdfDocs.size, list };
  return list;
}
FEATURE.onDocShown.push(() => { ffdWidgetCache = null; ffdSel = new Set(); ffdWidgets().then(ffdReadInfo).catch(() => {}); });
const ffdWidgetsNow = () => (ffdWidgetCache && ffdWidgetCache.doc === doc ? ffdWidgetCache.list : []);
/* ---- what pdf.js does not say about a widget, read from the PDF itself (pdf-lib), for sources with signature
   fields, check boxes or radio buttons: whether its signature field is signed (/V), its style (/MK /CA) and the
   font its field settings (/DA) name ---- */
const ffdInfoCache = new WeakMap(); // source bytes: a promise of Map(annotation id ("12R") → { signed, ca, base })
const ffdInfoDone = new WeakMap();  // source bytes: that Map, once read
const ffdCaStyle = Object.fromEntries(Object.entries(FFD_STYLES).map(([k, [ch]]) => [ch, k]));
function ffdSrcInfo(src) {
  const bytes = doc && doc.sources[src]; if (!bytes) return Promise.resolve(new Map());
  let pr = ffdInfoCache.get(bytes);
  if (!pr) {
    pr = (async () => {
      const map = new Map();
      try {
        const L = await loadPdfLib(), { PDFName, PDFDict } = L, N = (k) => PDFName.of(k);
        const d = await L.PDFDocument.load(bytes, bytes.password ? { password: bytes.password, updateMetadata: false } : { ignoreEncryption: true, updateMetadata: false });
        const af = d.catalog.lookup(N('AcroForm')), dr = af instanceof PDFDict ? af.lookup(N('DR')) : null, drf = dr instanceof PDFDict ? dr.lookup(N('Font')) : null;
        const str = (x) => (x && x.decodeText ? x.decodeText() : null);
        for (const [ref, o] of d.context.enumerateIndirectObjects()) {
          if (!(o instanceof PDFDict) || String(o.get(N('Subtype'))) !== '/Widget') continue;
          let ft = null, v = null, da = str(o.lookup(N('DA'))), x = o;
          for (let n = 0; x instanceof PDFDict && n < 32; n++) { ft ??= x.get(N('FT')) || null; if (v == null && x.has(N('V'))) v = x.lookup(N('V')); da ??= str(x.lookup(N('DA'))); x = x.lookup(N('Parent')); }
          if (da == null && af instanceof PDFDict) da = str(af.lookup(N('DA')));
          const fn = da && /\/([^\s/]+)\s+[-\d.]+\s+Tf/.exec(da), fd = fn && drf instanceof PDFDict ? drf.lookup(N(fn[1])) : null;
          const base = fd instanceof PDFDict && fd.get(N('BaseFont')) ? String(fd.get(N('BaseFont'))).slice(1).replace(/^[A-Z]{6}\+/, '') : null;
          const mk = o.lookup(N('MK')), ca = mk instanceof PDFDict ? str(mk.lookup(N('CA'))) : null;
          map.set(`${ref.objectNumber}R${ref.generationNumber || ''}`, { signed: String(ft) === '/Sig' && v instanceof PDFDict, ca, base });
        }
      } catch (e) { console.warn('form fields', e); }
      ffdInfoDone.set(bytes, map);
      return map;
    })();
    ffdInfoCache.set(bytes, pr);
  }
  return pr;
}
// A font of the PDF's own (not Helvetica, Times or Courier) that a widget's field settings name
const ffdOwnOf = (info) => (info && info.base && !/^(Helvetica|Times|Courier)/.test(info.base) ? info.base : '');
// What is known of a widget now: null while its source is still being read
const ffdInfoNow = (src, id) => { const b = doc && doc.sources[src], m = b && ffdInfoDone.get(b); return m ? m.get(id) || {} : null; };
// Sources with signature fields, check boxes or radio buttons are read as soon as the document shows
function ffdReadInfo(list) {
  const srcs = new Set(list.filter((w) => w.a.fieldType === 'Sig' || w.a.checkBox || w.a.radioButton).map((w) => w.src));
  for (const src of srcs) ffdSrcInfo(src).then(() => views.forEach((v) => { if (v.rendered && v.entry.src === src && v.el.isConnected) ffdOverlay(v); }));
}

/* ---- formats, validation and calculations: the standard functions, read and written ---- */
const ffdStr = (s) => JSON.stringify(String(s ?? ''));
const ffdStrs = (src) => [...String(src || '').matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)].map((x) => { try { return JSON.parse('"' + (x[1] ?? x[2].replace(/"/g, '\\"')) + '"'); } catch { return x[1] ?? x[2]; } });
function ffdParseFormat(fjs, kjs) {
  const s = String(fjs || ''); let r;
  if (!s.trim() && !String(kjs || '').trim()) return { t: 'none' };
  if ((r = /AFNumber_Format\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*\d+\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,\s*(true|false)\s*\)/.exec(s))) return { t: 'number', dec: +r[1], sep: +r[2], neg: +r[3], cur: ffdStrs(r[4])[0] || '', pre: r[5] === 'true' };
  if ((r = /AFPercent_Format\(\s*(\d+)\s*,\s*(\d+)/.exec(s))) return { t: 'percent', dec: +r[1], sep: +r[2] };
  if ((r = /AFDate_FormatEx\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*\)/.exec(s))) return { t: 'date', df: ffdStrs(r[1])[0] };
  if ((r = /AFDate_Format\(\s*(\d+)\s*\)/.exec(s))) return { t: 'date', df: ['m/d', 'm/d/yy', 'mm/dd/yy', 'mm/yy', 'd-mmm', 'd-mmm-yy', 'dd-mmm-yy', 'yy-mm-dd', 'mmm-yy', 'mmmm-yy', 'mmm d, yyyy', 'mmmm d, yyyy', 'm/d/yy h:MM tt', 'm/d/yy HH:MM'][+r[1]] || 'mm/dd/yyyy' };
  if ((r = /AFTime_Format\(\s*(\d+)\s*\)/.exec(s))) return { t: 'time', tm: Math.min(3, +r[1]) };
  if ((r = /AFTime_FormatEx\(\s*("(?:[^"\\]|\\.)*")\s*\)/.exec(s))) { const k = FFD_TIMES.indexOf(ffdStrs(r[1])[0]); return k >= 0 ? { t: 'time', tm: k } : { t: 'custom', js: s, ks: kjs || '' }; }
  if ((r = /AFSpecial_Format\(\s*(\d+)\s*\)/.exec(s))) return { t: 'special', sp: Math.min(3, +r[1]) };
  return { t: 'custom', js: s, ks: String(kjs || '') };
}
function ffdFormatJs(af) {
  if (!af || af.t === 'none') return null;
  const dec = Math.max(0, Math.min(10, af.dec | 0)), sep = af.sep | 0;
  if (af.t === 'number') { const a = `${dec}, ${sep}, ${af.neg | 0}, 0, ${ffdStr(af.cur || '')}, ${af.pre ? 'true' : 'false'}`; return { F: `AFNumber_Format(${a});`, K: `AFNumber_Keystroke(${a});` }; }
  if (af.t === 'percent') return { F: `AFPercent_Format(${dec}, ${sep});`, K: `AFPercent_Keystroke(${dec}, ${sep});` };
  if (af.t === 'date') return { F: `AFDate_FormatEx(${ffdStr(af.df || FF_DATE_FORMATS[0])});`, K: `AFDate_KeystrokeEx(${ffdStr(af.df || FF_DATE_FORMATS[0])});` };
  if (af.t === 'time') return { F: `AFTime_Format(${af.tm | 0});`, K: `AFTime_Keystroke(${af.tm | 0});` };
  if (af.t === 'special') return { F: `AFSpecial_Format(${af.sp | 0});`, K: `AFSpecial_Keystroke(${af.sp | 0});` };
  if (af.t === 'custom') return { F: af.js || '', K: af.ks || '' };
  return null;
}
function ffdParseValidate(js) {
  const s = String(js || ''); let r;
  if (!s.trim()) return { t: 'none' };
  if ((r = /AFRange_Validate\(\s*(true|false)\s*,\s*(-?[\d.]+)\s*,\s*(true|false)\s*,\s*(-?[\d.]+)\s*\)/.exec(s))) return { t: 'range', min: r[1] === 'true' ? +r[2] : '', max: r[3] === 'true' ? +r[4] : '' };
  return { t: 'custom', js: s };
}
function ffdValidateJs(vl) {
  if (!vl || vl.t === 'none') return null;
  if (vl.t === 'range') { const a = vl.min !== '' && vl.min != null, b = vl.max !== '' && vl.max != null; return a || b ? `AFRange_Validate(${a}, ${a ? +vl.min : 0}, ${b}, ${b ? +vl.max : 0});` : null; }
  return vl.js || null;
}
function ffdParseCalc(js) {
  const s = String(js || ''); let r;
  if (!s.trim()) return { t: 'none' };
  if ((r = /\/\*\*\s*BVCALC\s+([\s\S]*?)\s+EVCALC\s*\*\*\//.exec(s))) return { t: 'sfn', sfn: r[1].trim() };
  // the fields as an array, or as one string of names with commas between ("A, B"), as other apps also write it
  if ((r = /AFSimple_Calculate\(\s*["'](\w+)["']\s*,\s*(?:new\s+Array\s*\(([^)]*)\)|\[([^\]]*)\]|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))\s*\)/.exec(s))) return { t: 'simple', op: r[1].toUpperCase(), fields: r[4] != null ? String(ffdStrs(r[4])[0] ?? '').split(',').map((x) => x.trim()).filter(Boolean) : ffdStrs(r[2] ?? r[3]) };
  return { t: 'custom', js: s };
}
function ffdCalcJs(cl) {
  if (!cl || cl.t === 'none') return null;
  if (cl.t === 'simple') return (cl.fields || []).length ? `AFSimple_Calculate(${ffdStr(cl.op || 'SUM')}, new Array (${cl.fields.map(ffdStr).join(', ')}));` : null;
  if (cl.t === 'sfn') { const tree = ffdSfnParse(cl.sfn || ''); return tree ? `/** BVCALC ${cl.sfn} EVCALC **/ event.value = ${ffdSfnJs(tree)};` : null; }
  return cl.js || null;
}
// Simplified field notation: + - * / ( ), numbers and field names (a backslash keeps a space or sign in a name).
function ffdSfnParse(src) {
  const toks = []; let k = 0; const s = String(src);
  while (k < s.length) {
    const c = s[k];
    if (/\s/.test(c)) { k++; continue; }
    if ('+-*/()'.includes(c)) { toks.push({ op: c }); k++; continue; }
    if (/[\d.]/.test(c)) { let j = k; while (j < s.length && /[\d.]/.test(s[j])) j++; toks.push({ n: +s.slice(k, j) }); k = j; continue; }
    let name = ''; while (k < s.length && !/[\s+\-*/()]/.test(s[k])) { if (s[k] === '\\' && k + 1 < s.length) { name += s[k + 1]; k += 2; } else name += s[k++]; }
    while (k < s.length && s[k] === '\\' && k + 1 < s.length) { name += s[k + 1]; k += 2; while (k < s.length && !/[\s+\-*/()]/.test(s[k])) name += s[k++]; }
    if (!name) return null; toks.push({ f: name });
  }
  let p = 0;
  const peek = () => toks[p], eat = (op) => (toks[p] && toks[p].op === op ? (p++, true) : false);
  const atom = () => {
    const t = toks[p++]; if (!t) throw 0;
    if (t.op === '(') { const e = sum(); if (!eat(')')) throw 0; return e; }
    if (t.op === '-') return { neg: atom() };
    if (t.op === '+') return atom();
    if (t.n != null && isFinite(t.n)) return { n: t.n };
    if (t.f) return { f: t.f };
    throw 0;
  };
  const prod = () => { let a = atom(); while (peek() && (peek().op === '*' || peek().op === '/')) { const op = toks[p++].op; a = { op, a, b: atom() }; } return a; };
  const sum = () => { let a = prod(); while (peek() && (peek().op === '+' || peek().op === '-')) { const op = toks[p++].op; a = { op, a, b: prod() }; } return a; };
  try { const e = sum(); return p === toks.length ? e : null; } catch { return null; }
}
const ffdSfnJs = (t) => (t.n != null ? String(t.n) : t.f ? `AFMakeNumber(getField(${ffdStr(t.f)}).value)` : t.neg ? `-(${ffdSfnJs(t.neg)})` : `(${ffdSfnJs(t.a)} ${t.op} ${ffdSfnJs(t.b)})`);
const ffdSfnEval = (t, val) => (t.n != null ? t.n : t.f ? val(t.f) : t.neg ? -ffdSfnEval(t.neg, val) : ((a, b) => (t.op === '+' ? a + b : t.op === '-' ? a - b : t.op === '*' ? a * b : b === 0 ? 0 : a / b))(ffdSfnEval(t.a, val), ffdSfnEval(t.b, val)));
const ffdSfnNames = (t, out = []) => { if (!t) return out; if (t.f) out.push(t.f); for (const k of ['a', 'b', 'neg']) if (t[k]) ffdSfnNames(t[k], out); return out; };
// A value as a number, the way the field's format writes it ("1.234,50" with a comma for decimals)
function ffdToNumber(v, af) {
  if (typeof v === 'number') return v;
  let s = String(v ?? '').trim(); if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/^[^\d(-]+/, ''));
  // a comma is the decimal point in a field formatted 1.234,56 (and the value as other apps keep it has a point)
  if (af && (af.sep === 2 || af.sep === 3) && s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, '');
  const m = /\d*\.?\d+(?:e[+-]?\d+)?/i.exec(s.replace(/\s/g, '')); if (!m) return NaN;
  return (neg ? -1 : 1) * parseFloat(m[0]) / (af && af.t === 'percent' && /%/.test(s) ? 100 : 1);
}
function ffdGroup(n, dec, sep) {
  const fixed = Math.abs(n).toFixed(dec), [int, frac] = fixed.split('.');
  const th = sep === 0 ? ',' : sep === 2 ? '.' : '', dp = sep >= 2 ? ',' : '.';
  return (th ? int.replace(/\B(?=(\d{3})+(?!\d))/g, th) : int) + (frac ? dp + frac : '');
}
function ffdFormat(v, af) {
  if (!af || v === '' || v == null) return v ?? '';
  if (af.t === 'number') {
    const n = ffdToNumber(v, af); if (!isFinite(n)) return String(v);
    let s = ffdGroup(n, af.dec | 0, af.sep | 0); if (af.cur) s = af.pre ? af.cur + s : s + af.cur;
    return n < 0 ? (af.neg >= 2 ? `(${s})` : af.neg === 1 ? s : '-' + s) : s;
  }
  if (af.t === 'percent') { const n = ffdToNumber(v, af); return isFinite(n) ? ffdGroup(n * 100, af.dec | 0, af.sep | 0) + '%' : String(v); }
  if (af.t === 'special') {
    const d = String(v).replace(/\D/g, '');
    if (af.sp === 0 && d.length === 5) return d;
    if (af.sp === 1 && d.length === 9) return d.slice(0, 5) + '-' + d.slice(5);
    if (af.sp === 2 && d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    if (af.sp === 2 && d.length === 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
    if (af.sp === 3 && d.length === 9) return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    return String(v);
  }
  if (af.t === 'time') {
    const m = /^\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*([ap]\.?m?\.?)?\s*$/i.exec(String(v)); if (!m) return String(v);
    let h = +m[1]; const mi = m[2] || '00', se = m[3] || '00', ap = m[4] ? m[4][0].toLowerCase() : null;
    if (ap === 'p' && h < 12) h += 12; if (ap === 'a' && h === 12) h = 0;
    const h12 = h % 12 || 12, tt = h < 12 ? 'am' : 'pm', tm = af.tm | 0;
    return tm === 0 ? `${String(h).padStart(2, '0')}:${mi}` : tm === 1 ? `${h12}:${mi} ${tt}` : tm === 2 ? `${String(h).padStart(2, '0')}:${mi}:${se}` : `${h12}:${mi}:${se} ${tt}`;
  }
  return String(v);
}
// The field's format (a date field's is its date format), as other apps run it
const ffdFormatOf = (m) => (m.kind === 'date' ? { t: 'date', df: m.fmt } : m.af && m.af.t !== 'none' ? m.af : null);
function ffdFormatter(m) {
  const af = ffdFormatOf(m);
  if (!af || !['number', 'percent', 'special', 'time'].includes(af.t)) return null;
  return (v) => ffdFormat(v, af);
}
// What the standard keystroke and validation scripts would refuse. A refused value is not kept, and the toast says why.
function ffdRefusal(m, val) {
  const af = ffdFormatOf(m), name = ffdNameOf(m), s = String(val ?? '').trim();
  if (!s) return null;
  if (af && (af.t === 'number' || af.t === 'percent') && !isFinite(ffdToNumber(s, af))) return `${name}: type a number`;
  if (af && af.t === 'special') { const d = s.replace(/\D/g, '').length, need = [[5], [9], [7, 10], [9]][af.sp | 0]; if (!need.includes(d)) return `${name}: type a ${FFD_SPECIAL[af.sp | 0].toLowerCase()}`; }
  if (af && af.t === 'time' && !/^\s*\d{1,2}(:\d{2}){0,2}\s*([ap]\.?m?\.?)?\s*$/i.test(s)) return `${name}: type a time`;
  const vl = m.vl;
  if (vl && vl.t === 'range') {
    const n = ffdToNumber(s, af), lo = vl.min !== '' && vl.min != null ? +vl.min : null, hi = vl.max !== '' && vl.max != null ? +vl.max : null;
    if (!isFinite(n) || (lo != null && n < lo) || (hi != null && n > hi)) return `${name}: the value must be ${lo != null && hi != null ? `from ${lo} to ${hi}` : lo != null ? `${lo} or more` : `${hi} or less`}`;
  }
  return null;
}
function ffdCheckValue(m, val) { const why = ffdRefusal(m, val); if (why) { toast(why); return false; } return true; }

/* ---- the values of every field, by name: new fields, proxies, and the PDF's own (in pdf.js's form storage) ---- */
function ffdPdfjsValue(pd, a) {
  const st = pd.annotationStorage.getValue(a.id, {}), v = st.value;
  if (a.checkBox) { const on = v !== undefined ? !!v : !!a.fieldValue && a.fieldValue !== 'Off' && a.fieldValue === a.exportValue; return on ? a.exportValue || 'Yes' : 'Off'; }
  if (a.radioButton) { const on = v !== undefined ? !!v : a.fieldValue === a.buttonValue; return on ? a.buttonValue : null; }
  const x = v !== undefined ? v : a.fieldValue;
  return Array.isArray(x) ? (x.length > 1 ? x : x[0] ?? '') : x ?? '';
}
const ffdShownVals = new WeakMap(); // a control of the PDF's own: { value, shown } as last set here
function ffdFields() {
  const out = new Map(), get = (n) => out.get(n) || out.set(n, { name: n, parts: [] }).get(n);
  const proxied = new Set(ffdFieldMarks().filter((m) => m.type === 'ffx').map((m) => m.ref)), gone = new Set();
  for (const e of doc.pages) for (const m of marksOf(e)) if (m.type === 'ae' && m.deleted) gone.add(m.ref);
  for (const m of ffdFieldMarks()) get(ffdNameOf(m)).parts.push({ m });
  for (const w of ffdWidgetsNow()) {
    const md = ffModOf(w.a.fieldName); if (md && md.del) continue;
    if (proxied.has(w.a.id) || gone.has(w.a.id)) continue;
    get(ffShown(w.a.fieldName)).parts.push({ w });
  }
  for (const f of out.values()) {
    const p0 = f.parts[0];
    f.kind = p0.m ? p0.m.kind : ffdKindOf(p0.w.a);
    const acts = (p) => (p.w && p.w.a.actions) || null;
    const a0 = f.parts.map(acts).find(Boolean), js = (k) => (a0 && a0.get ? a0.get(k) : a0 && a0[k]) || [];
    const mk = f.parts.find((p) => p.m);
    f.af = mk ? ffdFormatOf(mk.m) : a0 ? ffdParseFormat(js('Format').join('\n'), js('Keystroke').join('\n')) : null;
    f.cl = mk ? mk.m.cl : a0 ? ffdParseCalc(js('Calculate').join('\n')) : null;
    f.get = () => {
      if (f.kind === 'radio') { for (const p of f.parts) { if (p.m && p.m.val) return p.m.exp; if (p.w) { const v = ffdPdfjsValue(p.w.pd, p.w.a); if (v) return v; } } return 'Off'; }
      const p = f.parts[0];
      if (p.m) return f.kind === 'check' ? (p.m.val ? p.m.exp || 'Yes' : 'Off') : p.m.val ?? '';
      return ffdPdfjsValue(p.w.pd, p.w.a);
    };
    f.set = (val) => {
      const v = Array.isArray(val) ? val : String(val ?? '');
      for (const p of f.parts) {
        if (p.m) {
          if (f.kind === 'check') p.m.val = v === (p.m.exp || 'Yes') || (v !== 'Off' && v !== '' && !p.m.exp);
          else if (f.kind === 'radio') p.m.val = v === p.m.exp;
          else p.m.val = Array.isArray(v) ? v[0] ?? '' : v;
          continue;
        }
        const { pd, a } = p.w, st = pd.annotationStorage, fmt = f.af ? ffdFormat(v, f.af) : null;
        if (a.checkBox) st.setValue(a.id, { value: v === (a.exportValue || 'Yes') });
        else if (a.radioButton) st.setValue(a.id, { value: v === a.buttonValue });
        else if (a.fieldType === 'Ch') st.setValue(a.id, { value: Array.isArray(v) ? v : v ? [v] : [] });
        else st.setValue(a.id, { value: v, formattedValue: fmt != null ? fmt : v }); // (pdf.js shows the look's old text when there is none)
        for (const el of $$(`.annotationLayer [data-element-id="${CSS.escape(a.id)}"]`)) {
          if (el.type === 'checkbox' || el.type === 'radio') el.checked = a.checkBox ? v === (a.exportValue || 'Yes') : v === a.buttonValue;
          else if (el.tagName === 'SELECT') { for (const o of el.options) o.selected = Array.isArray(v) ? v.includes(o.value) : o.value === v; }
          else {
            // the value as typed while the control has the focus (Tab into a total), formatted once it loses it
            const shown = fmt != null ? fmt : v;
            ffdShownVals.set(el, { value: v, shown });
            el.value = document.activeElement === el ? v : shown;
          }
        }
      }
    };
  }
  return out;
}
// The order calculations run in: the Calculation order (if one was set), then every other calculated field
function ffdCalcOrder(F) {
  const co = docMarks().find((m) => m.type === 'ffco'), names = [];
  const byKey = (k) => { if (k.startsWith('m:')) { const f = ffFind(k.slice(2)); return f && ffIsField(f.m) ? ffdNameOf(f.m) : null; } return ffShown(k.slice(2)); };
  if (co) for (const k of co.order) { const n = byKey(k); if (n && F.has(n) && !names.includes(n)) names.push(n); }
  for (const [n, f] of F) if (f.cl && f.cl.t && f.cl.t !== 'none' && !names.includes(n)) names.push(n);
  return names;
}
// Runs every calculation (to a settled value: a total of totals works in either order). Returns whether one changed.
function ffdRecalc() {
  if (!doc) return false;
  const F = ffdFields(), order = ffdCalcOrder(F).filter((n) => { const c = F.get(n).cl; return c && (c.t === 'simple' || c.t === 'sfn'); });
  if (!order.length) return false;
  const num = (n) => { const f = F.get(n); if (!f) return 0; const v = f.get(); const x = ffdToNumber(Array.isArray(v) ? v[0] : v === 'Off' ? '' : v, f.af); return isFinite(x) ? x : 0; };
  let any = false;
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const n of order) {
      const f = F.get(n), c = f.cl; let r = null;
      if (c.t === 'simple') {
        const xs = (c.fields || []).filter((x) => F.has(x)).map(num);
        r = !xs.length ? 0 : c.op === 'PRD' ? xs.reduce((a, b) => a * b, 1) : c.op === 'AVG' ? xs.reduce((a, b) => a + b, 0) / xs.length : c.op === 'MIN' ? Math.min(...xs) : c.op === 'MAX' ? Math.max(...xs) : xs.reduce((a, b) => a + b, 0);
      } else { const t = ffdSfnParse(c.sfn || ''); if (t) r = ffdSfnEval(t, num); }
      if (r == null || !isFinite(r)) continue;
      const s = String(Math.round(r * 1e9) / 1e9);
      if (String(f.get()) !== s) { f.set(s); moved = any = true; }
    }
    if (!moved) break;
  }
  return any;
}
function ffdAfterFill() { ffdRecalc(); }
// The PDF's own fields (drawn by pdf.js): formats checked, totals worked out, as they are typed in
viewer.addEventListener('change', (e) => {
  const el = e.target; if (!doc || !el.closest || !el.closest('.annotationLayer')) return;
  setTimeout(() => {
    const id = el.dataset.elementId, w = ffdWidgetsNow().find((x) => x.a.id === id);
    if (w && w.a.fieldType === 'Tx') {
      const f = ffdFields().get(ffShown(w.a.fieldName)), m = { name: w.a.fieldName, type: 'pdf', kind: 'text', af: f && f.af, vl: null };
      const a0 = w.a.actions, vjs = a0 && (a0.get ? a0.get('Validate') : a0.Validate); if (vjs) m.vl = ffdParseValidate(vjs.join('\n'));
      const why = ffdRefusal({ ...m, name: ffShown(w.a.fieldName), type: 'x' }, el.value);
      if (why) { toast(why); el.value = ''; w.pd.annotationStorage.setValue(id, { value: '' }); }
      else if (m.af && f) { f.set(el.value); }
    }
    const before = snapshot();
    if (ffdRecalc()) { if (snapshot() !== before) changed(before); else setSaved(false); views.forEach((v) => v.rendered && drawMarks(v)); }
  }, 0);
}, true);
// A formatted field from the PDF shows the value as typed while it has the focus
viewer.addEventListener('focusin', (e) => {
  const el = e.target; if (!doc || !el.closest || !el.closest('.annotationLayer') || el.tagName !== 'INPUT' || el.type !== 'text') return;
  const w = ffdWidgetsNow().find((x) => x.a.id === el.dataset.elementId); if (!w) return;
  const st = w.pd.annotationStorage.getValue(w.a.id, {}); if (st.formattedValue != null && st.value != null && el.value === st.formattedValue) el.value = st.value;
}, true);

// …and the formatted value when it loses the focus (pdf.js would show the look it was drawn with), unless it was typed in
viewer.addEventListener('focusout', (e) => {
  const el = e.target, rec = ffdShownVals.get(el); if (!rec || !doc) return;
  const w = ffdWidgetsNow().find((x) => x.a.id === el.dataset.elementId); if (!w) return;
  const st = w.pd.annotationStorage.getValue(w.a.id, {});
  if (String(st.value ?? '') === String(rec.value)) el.value = rec.shown;
}, true);

/* ---- proxies: a field from the PDF, ready to change ---- */
function ffdProxyOf(entry, a) {
  const kind = ffdKindOf(a), pd = pdfDocs.get(entry.src), st = pd.annotationStorage.getValue(a.id, {});
  const da = a.defaultAppearanceData || {}, [x1, y1, x2, y2] = a.rect, ff = a.fieldFlags | 0;
  const acts = a.actions, js = (k) => ((acts && (acts.get ? acts.get(k) : acts[k])) || []).join('\n');
  const info = ffdInfoNow(entry.src, a.id) || {};
  const m = {
    id: uid(), type: 'ffx', ref: a.id, name: a.fieldName, kind, x1: Math.min(x1, x2), y1: Math.min(y1, y2), x2: Math.max(x1, x2), y2: Math.max(y1, y2), rot: ((a.rotation || 0) % 360 + 360) % 360,
    F: a.annotationFlags | 0, tip: a.alternativeText || '', req: !!a.required, ro: !!a.readOnly,
    size: da.fontSize || 0, font: ffdFontKey(info.base || da.fontName), daFont: da.fontName || '', ownFont: ffdOwnOf(info), color: ffdHex(da.fontColor) || '#000000',
    bc: a.borderColor ? ffdHex(a.borderColor) : '', bg: a.backgroundColor ? ffdHex(a.backgroundColor) : '',
    bs: (a.borderStyle && FFD_PDFJS_BORDER[a.borderStyle.style]) || 'S', bw: a.borderStyle ? a.borderStyle.width : 1, q: a.textAlignment || 0,
  };
  if (kind === 'text') Object.assign(m, { multi: !!(ff & (1 << 12)), pw: !!(ff & (1 << 13)), nospell: !!(ff & (1 << 22)), scroll: !(ff & (1 << 23)), comb: !!(ff & (1 << 24)), max: a.maxLen || 0, val: st.value !== undefined ? String(st.value) : String(a.fieldValue ?? ''), dv: a.defaultFieldValue != null ? String(a.defaultFieldValue) : '' });
  if (kind === 'combo' || kind === 'list') {
    const opts = (a.options || []).map((o) => o.displayValue ?? o.exportValue);
    const raw = st.value !== undefined ? st.value : a.fieldValue, v = Array.isArray(raw) ? raw[0] : raw;
    const o = (a.options || []).find((x) => x.exportValue === v || x.displayValue === v);
    Object.assign(m, { opts, val: o ? o.displayValue ?? o.exportValue : v ?? '', edit: !!(ff & (1 << 18)), sort: !!(ff & (1 << 19)), multisel: !!(ff & (1 << 21)), nospell: !!(ff & (1 << 22)) });
    const ex = (a.options || []).map((x) => x.exportValue); if (ex.some((x, k) => x !== opts[k])) m.optx = ex;
  }
  if (kind === 'check') Object.assign(m, { exp: a.exportValue || 'Yes', val: st.value !== undefined ? !!st.value : !!a.fieldValue && a.fieldValue !== 'Off' && a.fieldValue === a.exportValue, style: ffdCaStyle[info.ca] || 'check' });
  if (kind === 'radio') Object.assign(m, { exp: a.buttonValue, val: st.value !== undefined ? !!st.value : a.fieldValue === a.buttonValue, style: ffdCaStyle[info.ca] || 'circle' });
  if (kind === 'button') { m.label = a.buttonValue || ''; }
  if (kind === 'text' || kind === 'combo') { m.af = ffdParseFormat(js('Format'), js('Keystroke')); m.vl = ffdParseValidate(js('Validate')); m.cl = ffdParseCalc(js('Calculate')); }
  m.mu = a.resetForm ? { t: 'reset' } : a.url || a.unsafeUrl ? (/^mailto:/i.test(a.url || a.unsafeUrl) ? { t: 'url', url: a.url || a.unsafeUrl } : { t: 'url', url: a.url || a.unsafeUrl }) : a.action === 'Print' ? { t: 'print' } : { t: 'none' };
  m.orig = ffdOrigOf(m); m.origVal = JSON.stringify(m.val ?? null);
  return m;
}
// Makes proxies (quietly) for these widgets: { entry, a } pairs. Returns them (existing ones too).
function ffdProxies(list) {
  const out = [];
  for (const { entry, a } of list) {
    const l = marksOf(entry);
    let m = l.find((x) => x.type === 'ffx' && x.ref === a.id);
    if (!m) { m = ffdProxyOf(entry, a); l.push(m); }
    out.push(m);
  }
  return out;
}
// Every widget of a field, on every page it is on (pages used twice: once each)
async function ffdWidgetsOfField(name) {
  const all = await ffdWidgets(), out = [], seen = new Set();
  for (const entry of doc.pages) {
    const key = pageKey(entry); if (seen.has(key)) continue; seen.add(key);
    for (const w of all) if (w.src === entry.src && w.page === entry.i && w.a.fieldName === name) out.push({ entry, a: w.a });
  }
  const gone = new Set(); for (const e of doc.pages) for (const m of marksOf(e)) if (m.type === 'ae' && m.deleted) gone.add(m.ref);
  return out.filter((x) => !gone.has(x.a.id));
}
// pdf.js's own controls for widgets that have proxies are hidden; signature fields and buttons are drawn on the page
// itself, so pdf.js is told not to draw them ("noView") and the page is drawn again.
const ffdRerenderSoon = new Map();
// "noView" is for the screen only. pdf.js would write it into the saved file and rewrite the widget with it, and a
// signature field's value (its signature, /V) would be lost: it is left out of what pdf.js saves.
const ffdNoView = new WeakMap(); // pdf.js document: ids of the widgets told not to draw
function ffdGuardSave(pd) {
  if (ffdNoView.has(pd)) return ffdNoView.get(pd);
  const ids = new Set(); ffdNoView.set(pd, ids);
  const save = pd.saveDocument.bind(pd);
  pd.saveDocument = async (...args) => {
    const st = pd.annotationStorage, held = [];
    for (const id of ids) { const cur = st.getValue(id, null); if (cur && cur.noView) { held.push([id, cur]); const rest = { ...cur }; delete rest.noView; st.remove(id); if (Object.keys(rest).length) st.setValue(id, rest); } }
    try { return await save(...args); } finally { for (const [id, cur] of held) st.setValue(id, cur); }
  };
  return ids;
}
function ffdSync(v, proxied) {
  for (const sec of v.el.querySelectorAll('.annotationLayer [data-annotation-id]')) sec.classList.toggle('ffd-hidden', proxied.has(sec.dataset.annotationId));
  const st = pdfDocs.get(v.entry.src).annotationStorage; let again = false;
  for (const a of v.ffWidgets || []) {
    if (!(a.fieldType === 'Sig' || a.pushButton)) continue;
    const want = proxied.has(a.id), now = st.getValue(a.id, {}).noView;
    if (want && !now) { ffdGuardSave(pdfDocs.get(v.entry.src)).add(a.id); st.setValue(a.id, { noView: true }); again = true; }
    else if (!want && now) { const cur = st.getValue(a.id, {}); if (Object.keys(cur).length === 1) st.remove(a.id); else st.setValue(a.id, { noView: false }); again = true; }
  }
  ffdPanelSoon();
  if (again && !ffdRerenderSoon.has(v)) ffdRerenderSoon.set(v, setTimeout(() => { ffdRerenderSoon.delete(v); if (v.el.isConnected) rerenderView(v); }, 30));
  ffdOverlay(v);
}
FEATURE.markTypes.ffx = {
  label: 'Form field',
  draw: (v, m, svg) => ffDraw(v, m, svg),
  save({ p, m, entry, ctx }) { (ctx.ffxList || (ctx.ffxList = [])).push({ p, m, entry }); },
  move: (m, o, dx, dy) => ffdMoved(m, o, dx, dy),
  menu: ['ffProps', 'ffd_dup', 'ffd_copyPages'],
};
FEATURE.markTypes.ff.move = (m, o, dx, dy) => ffdMoved(m, o, dx, dy);
FEATURE.markTypes.ff.menu = ['ffProps', 'ffd_dup', 'ffd_copyPages'];
(FEATURE.markLabels ||= []).push((m) => (m.type === 'ffx' ? { label: 'Form field', text: ffShown(m.name) } : null));

/* ---- selection: several fields (Shift-click, or a box dragged round them) ---- */
const ffdSelected = () => {
  const ids = new Set(ffdSel); if (selMark) ids.add(selMark.id);
  return [...ids].map((id) => ffFind(id)).filter((f) => f && ffIsField(f.m)).map((f) => f.m);
};
const ffdSelHas = (id) => ffdSel.size > 1 && ffdSel.has(id);
const ffdSelCount = () => ffdSelected().length;
function ffdSetSel(ms, primary = ms[ms.length - 1]) {
  ffdSel = new Set(ms.map((m) => m.id));
  ffSelectX(null);
  const e = primary && ffdEntryOf(primary);
  selectMark(primary && e ? { key: pageKey(e), id: primary.id, entry: e } : null);
}
function ffdDecorate(v, m, g, x, y, w, h) {
  if (ffDesign() && ffdSelHas(m.id) && !(selMark && selMark.id === m.id)) g.appendChild(svgEl('rect', { class: 'ffd-msel ui-only', x: x - 2, y: y - 2, width: w + 4, height: h + 4, rx: 2 }));
}
// A drag of one selected field moves the others with it, by the same amount (on the 4 pt grid when Snap is on)
function ffdMoved(m, o, dx, dy) {
  if (!ffdDrag || ffdDrag.id !== m.id) return;
  if (S.ffdSnap) {
    const bx = Math.min(o.x1, o.x2), by = Math.min(o.y1, o.y2);
    dx = Math.round((bx + dx) / FFD_GRID) * FFD_GRID - bx; dy = Math.round((by + dy) / FFD_GRID) * FFD_GRID - by;
    m.x1 = o.x1 + dx; m.x2 = o.x2 + dx; m.y1 = o.y1 + dy; m.y2 = o.y2 + dy;
  }
  for (const [id, oo] of ffdDrag.origs) {
    if (id === m.id) continue; const f = ffFind(id); if (!f) continue;
    Object.assign(f.m, { x1: oo.x1 + dx, x2: oo.x2 + dx, y1: oo.y1 + dy, y2: oo.y2 + dy });
  }
  if (ffdDrag.origs.size > 1) views.forEach((vv) => { if (vv.rendered && marksOf(vv.entry).some((x) => ffdDrag.origs.has(x.id) && x.id !== m.id)) drawMarks(vv); });
}
function ffdBeginDrag(m) {
  const origs = new Map(); for (const s of ffdSelected()) origs.set(s.id, { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2 });
  origs.set(m.id, { x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2 });
  ffdDrag = { id: m.id, origs };
  const up = () => { window.removeEventListener('pointerup', up); setTimeout(() => { ffdDrag = null; }, 0); };
  window.addEventListener('pointerup', up);
}
// Pressing a field to drag it (any form tool): get ready to move the others with it
viewer.addEventListener('pointerdown', (e) => {
  if (!doc || !ffDesign() || e.button !== 0 || e.shiftKey) return;
  const g = e.target.closest && e.target.closest('.marks .ff-mk'); if (!g || e.target.closest('.ff-handle')) return;
  const f = ffFind(g.dataset.id); if (!f || !ffIsField(f.m)) return;
  if (!ffdSel.has(f.m.id)) ffdSel = new Set([f.m.id]);
  ffdBeginDrag(f.m);
}, true);
// Edit fields: Shift-click adds a field (or takes it out); a drag on the page selects every field it touches
function ffdEditDown(e, v) {
  if (e.target.closest && e.target.closest('.ff-handle')) return false;
  const hit = e.target.closest && e.target.closest('.ff-mk');
  if (hit) {
    const m = marksOf(v.entry).find((x) => x.id === hit.dataset.id); if (!m) return false;
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      const now = ffdSelected(), has = now.some((x) => x.id === m.id), list = has ? now.filter((x) => x.id !== m.id) : [...now, m];
      ffdSetSel(list, has ? list[list.length - 1] : m); return true;
    }
    if (ffdSel.has(m.id) && ffdSel.size > 1) { ffSelectX(null); selMark = { key: pageKey(v.entry), id: m.id, entry: v.entry }; drawMarks(v); refreshRibbon(); startMove(e, v, m); return true; }
    ffdSel = new Set([m.id]); return false;
  }
  if (e.shiftKey) return true;
  e.preventDefault();
  const [sx, sy] = localPoint(e, v); let box = null;
  const band = svgEl('rect', { class: 'ffd-band ui-only', x: sx, y: sy, width: 0, height: 0 });
  const move = (ev) => {
    const [px, py] = pagePoint(ev, v); box = [Math.min(sx, px), Math.min(sy, py), Math.abs(px - sx), Math.abs(py - sy)];
    const s = v.el.querySelector('svg.ffd-layer'); if (s && !band.isConnected) s.appendChild(band);
    Object.entries({ x: box[0], y: box[1], width: box[2], height: box[3] }).forEach(([k, n]) => band.setAttribute(k, n));
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); band.remove();
    if (!box || box[2] < 4 || box[3] < 4) { ffdSel = new Set(); ffSelectX(null); selectMark(null); return; }
    const [ax, ay] = toPdf(v, box[0], box[1]), [bx, by] = toPdf(v, box[0] + box[2], box[1] + box[3]);
    const r = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    const hits = (q) => q[0] < r[2] && q[2] > r[0] && q[1] < r[3] && q[3] > r[1];
    const gone = ffGone(v.entry), proxied = new Set(marksOf(v.entry).filter((m) => m.type === 'ffx').map((m) => m.ref));
    const fresh = (v.ffWidgets || []).filter((a) => !gone.has(a.id) && !proxied.has(a.id) && !(ffModOf(a.fieldName) || {}).del && hits(a.rect.length === 4 ? [Math.min(a.rect[0], a.rect[2]), Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[0], a.rect[2]), Math.max(a.rect[1], a.rect[3])] : [0, 0, 0, 0]));
    ffdProxies(fresh.map((a) => ({ entry: v.entry, a })));
    const list = marksOf(v.entry).filter((m) => ffIsField(m) && hits(ffBox(m)));
    ffdSetSel(list);
    if (list.length > 1) toast(`${list.length} fields selected`);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  return true;
}
// A field from the PDF (its outline): Shift-click adds it to the selection; a drag moves it
function ffdOutlineDown(e, v, ref, name) {
  const a = (v.ffWidgets || []).find((x) => x.id === ref); if (!a) return false;
  if (e.shiftKey || e.metaKey || e.ctrlKey) { const [m] = ffdProxies([{ entry: v.entry, a }]); const now = ffdSelected(); ffdSetSel([...now, m], m); return true; }
  const x0 = e.clientX, y0 = e.clientY;
  const move = (ev) => {
    if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
    done();
    const [m] = ffdProxies([{ entry: v.entry, a }]);
    ffSelectX(null); ffdSel = new Set([m.id]); selMark = { key: pageKey(v.entry), id: m.id, entry: v.entry };
    drawMarks(v); ffLayer(v); refreshRibbon();
    ffdBeginDrag(m); startMove(e, v, m);
    const fwd = new PointerEvent('pointermove', { clientX: ev.clientX, clientY: ev.clientY, bubbles: true }); window.dispatchEvent(fwd);
  };
  const done = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', done); };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', done);
  void name;
  return false;
}

// After undo and redo: the selection, proxies, the overlay and the Fields panel follow
const ffdRestore0 = restore;
restore = function (...args) {
  const r = ffdRestore0.apply(this, args);
  ffdSel = new Set([...ffdSel].filter((id) => { const f = ffFind(id); return f && ffIsField(f.m); }));
  views.forEach((v) => { if (v.rendered) ffLayer(v); });
  ffdPanelDraw();
  return r;
};

/* ---- layout tools ---- */
function ffdBoxes(ms) { return ms.map((m) => ({ m, b: ffBox(m) })); }
function ffdShift(m, dx, dy) { m.x1 += dx; m.x2 += dx; m.y1 += dy; m.y2 += dy; }
function ffdLayout(fn, what) {
  const ms = ffdSelected(); if (ms.length < 2) { toast('Select two or more fields first (Shift-click them)'); return; }
  const before = snapshot();
  fn(ffdBoxes(ms), ms);
  for (const m of ms) [m.x1, m.y1, m.x2, m.y2] = ffBox(m);
  views.forEach((v) => v.rendered && drawMarks(v)); changed(before, what);
}
const ffdAnchor = (bs) => { const p = selMark && bs.find((x) => x.m.id === selMark.id); return p || bs[0]; };
const FFD_ALIGN = {
  left: ['Align left', 'align-start-vertical', (bs) => { const x = Math.min(...bs.map((q) => q.b[0])); bs.forEach((q) => ffdShift(q.m, x - q.b[0], 0)); }],
  right: ['Align right', 'align-end-vertical', (bs) => { const x = Math.max(...bs.map((q) => q.b[2])); bs.forEach((q) => ffdShift(q.m, x - q.b[2], 0)); }],
  top: ['Align top', 'align-start-horizontal', (bs) => { const y = Math.max(...bs.map((q) => q.b[3])); bs.forEach((q) => ffdShift(q.m, 0, y - q.b[3])); }],
  bottom: ['Align bottom', 'align-end-horizontal', (bs) => { const y = Math.min(...bs.map((q) => q.b[1])); bs.forEach((q) => ffdShift(q.m, 0, y - q.b[1])); }],
  centerH: ['Centre left to right', 'align-center-vertical', (bs) => { const a = ffdAnchor(bs).b, c = (a[0] + a[2]) / 2; bs.forEach((q) => ffdShift(q.m, c - (q.b[0] + q.b[2]) / 2, 0)); }],
  centerV: ['Centre top to bottom', 'align-center-horizontal', (bs) => { const a = ffdAnchor(bs).b, c = (a[1] + a[3]) / 2; bs.forEach((q) => ffdShift(q.m, 0, c - (q.b[1] + q.b[3]) / 2)); }],
};
const FFD_DIST = {
  distH: ['Distribute left to right', 'align-horizontal-distribute-center', (bs) => { const s = [...bs].sort((p, q) => p.b[0] + p.b[2] - q.b[0] - q.b[2]), c0 = (s[0].b[0] + s[0].b[2]) / 2, c1 = (s[s.length - 1].b[0] + s[s.length - 1].b[2]) / 2; s.forEach((q, k) => ffdShift(q.m, c0 + (c1 - c0) * k / (s.length - 1) - (q.b[0] + q.b[2]) / 2, 0)); }],
  distV: ['Distribute top to bottom', 'align-vertical-distribute-center', (bs) => { const s = [...bs].sort((p, q) => q.b[1] + q.b[3] - p.b[1] - p.b[3]), c0 = (s[0].b[1] + s[0].b[3]) / 2, c1 = (s[s.length - 1].b[1] + s[s.length - 1].b[3]) / 2; s.forEach((q, k) => ffdShift(q.m, 0, c0 + (c1 - c0) * k / (s.length - 1) - (q.b[1] + q.b[3]) / 2)); }],
};
const FFD_MATCH = {
  matchW: ['Match width', 'move-horizontal', true, false], matchH: ['Match height', 'move-vertical', false, true], matchB: ['Match both', 'maximize', true, true],
};
for (const [k, [label, icon, fn]] of Object.entries({ ...FFD_ALIGN, ...FFD_DIST })) cmd('ffd_' + k, { label, icon, enabled: has, run: () => ffdLayout(fn, label) }); // without two fields picked it says how
for (const [k, [label, icon, w, h]] of Object.entries(FFD_MATCH)) cmd('ffd_' + k, { label, icon, enabled: has, run: () => ffdLayout((bs) => {
  const a = ffdAnchor(bs).b, W = a[2] - a[0], H = a[3] - a[1];
  for (const q of bs) { const [x0, , , y1] = q.b; if (w) { q.m.x1 = x0; q.m.x2 = x0 + W; } if (h) { q.m.y2 = y1; q.m.y1 = y1 - H; } } // the top-left corner stays
}, label) });
// A free name like this one: Name_2, Name_3…
function ffdFreshName(name) { const used = ffNames(); let n = 2; const base = String(name).replace(/_\d+$/, ''); while (used.has(`${base}_${n}`)) n++; return `${base}_${n}`; }
// A new field with the settings of this one (a field from the PDF gives its settings to a new field)
function ffdAsNew(m) {
  const o = JSON.parse(JSON.stringify(m)); o.id = uid(); o.type = 'ff';
  for (const k of ['ref', 'orig', 'origVal', 'F', 'optx', 'cp', 'cpOf', 'daFont', 'ownFont']) delete o[k];
  if (m.type === 'ffx') { const md = ffModOf(m.name) || {}; o.name = ffShown(m.name); o.tip = md.tip ?? m.tip; o.req = md.req ?? m.req; o.ro = md.ro ?? m.ro; }
  o.val ??= m.kind === 'check' || m.kind === 'radio' ? false : '';
  return o;
}
function ffdDuplicate() {
  const ms = ffdSelected(); if (!ms.length) return false;
  const before = snapshot(), made = [];
  for (const m of ms) {
    const e = ffdEntryOf(m); if (!e) continue;
    const n = ffdAsNew(m); n.name = m.kind === 'radio' ? ffdNameOf(m) : ffdFreshName(ffdNameOf(m));
    if (m.kind === 'radio') { const taken = new Set(ffdFieldMarks().filter((r) => r.kind === 'radio' && ffdNameOf(r) === n.name).map((r) => r.exp)); let k = 1; while (taken.has('Choice' + k)) k++; n.exp = 'Choice' + k; n.val = false; }
    ffdShift(n, 12, -12); marksOf(e).push(n); made.push(n);
  }
  changed(before, made.length === 1 ? 'Duplicate field' : 'Duplicate fields');
  ffdSetSel(made);
  toast(made.length === 1 ? 'Field duplicated' : `${made.length} fields duplicated`);
  return true;
}
// Copy to pages…: the field on each page chosen, in the same place: one field, a widget on each page
async function ffdCopyToPages() {
  const ms = ffdSelected(); if (!ms.length) { toast('Select a field first'); return; }
  const n0 = doc.pages.indexOf(ffdEntryOf(ms[0]));
  const s = await askText('Copy to pages', `Pages to put ${ms.length === 1 ? 'this field' : 'these fields'} on (like 1-3, 5). It is one field: what is typed in one shows in all.`, `1-${doc.pages.length}`, 'Copy');
  if (s == null) return;
  const pages = parseRange(String(s), doc.pages.length); if (!pages.length) { toast('No such pages'); return; }
  const before = snapshot(); let k = 0;
  for (const m of ms) {
    const e0 = ffdEntryOf(m); if (!e0) continue;
    if (m.type === 'ff' && m.kind !== 'radio') m.cp ||= uid();
    for (const n of pages) {
      const e = doc.pages[n]; if (!e || pageKey(e) === pageKey(e0)) continue;
      const c = ffdAsNew(m);
      if (m.type === 'ff') { c.name = m.name; if (m.kind !== 'radio') c.cp = m.cp; else { c.exp = m.exp; } }
      else { c.cpOf = m.name; c.name = ffShown(m.name); }
      marksOf(e).push(c); k++;
    }
  }
  if (!k) { toast('It is on those pages already'); return; }
  changed(before, 'Copy field to pages');
  views.forEach((v) => v.rendered && drawMarks(v));
  toast(`Copied to ${pages.filter((n) => n !== n0).length} page${pages.length === 2 ? '' : 's'}`);
}
// Place multiple fields: copies of the field in rows and columns, each with a name of its own
async function ffdPlaceGrid() {
  const ms = ffdSelected(); if (ms.length !== 1) { toast('Select one field first'); return; }
  const m = ms[0], e = ffdEntryOf(m), [X0, Y0, X1, Y1] = ffBox(m), W = X1 - X0, H = Y1 - Y0;
  const a = await dialog('Place multiple fields', `<div class="ff-props">${ffInp('ffdRows', 'Rows (down)', 3, 'type="number" min="1" max="50"')}${ffInp('ffdCols', 'Columns (across)', 1, 'type="number" min="1" max="20"')}${ffInp('ffdGapY', 'Space between rows (pt)', 6, 'type="number" min="0" max="200"')}${ffInp('ffdGapX', 'Space between columns (pt)', 6, 'type="number" min="0" max="200"')}</div><p class="ffd-note">The field stays where it is, top left; the copies are named after it.</p>`, [{ label: 'Cancel' }, { label: 'Place', value: 'place', primary: true }]);
  if (a !== 'place') return;
  const dlg = $('#dialog'), num = (id, lo, hi, d) => Math.max(lo, Math.min(hi, parseInt($(id, dlg).value, 10) || d));
  const rows = num('#ffdRows', 1, 50, 1), cols = num('#ffdCols', 1, 20, 1), gy = num('#ffdGapY', 0, 200, 0), gx = num('#ffdGapX', 0, 200, 0);
  if (rows * cols < 2) return;
  const before = snapshot(), made = [m];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (!r && !c) continue;
    const n = ffdAsNew(m); n.name = m.kind === 'radio' ? ffdNameOf(m) : ffdFreshName(ffdNameOf(m));
    if (m.kind === 'radio') { n.exp = `Choice${made.length + 1}`; n.val = false; }
    ffdShift(n, c * (W + gx), -r * (H + gy)); [n.x1, n.y1, n.x2, n.y2] = ffBox(n);
    marksOf(e).push(n); made.push(n);
  }
  changed(before, 'Place multiple fields'); ffdSetSel(made, m);
  toast(`${made.length - 1} fields placed`);
}
function ffdDeleteSelection() {
  const ms = ffdSelected(); if (!ms.length) return;
  const before = snapshot(), names = new Set();
  for (const m of ms) {
    if (m.type === 'ffx') { names.add(m.name); continue; }
    const e = ffdEntryOf(m); if (e) { const l = marksOf(e); l.splice(l.indexOf(m), 1); }
  }
  ffdSel = new Set(); selMark = null;
  (async () => {
    for (const n of names) await ffDeleteExisting(n, true);
    views.forEach((v) => v.rendered && drawMarks(v)); changed(before, ms.length === 1 ? 'Delete form field' : 'Delete fields');
    syncHiddenComments(); toast(ms.length === 1 ? 'Field deleted' : `${ms.length} fields deleted`);
  })();
}
function ffdNudge(key, big) {
  const ms = ffdSelected(); const d = big ? 10 : 1, v = selMark && views.find((x) => x.entry === selMark.entry);
  let [dx, dy] = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] }[key];
  if (v) { const [x0, y0] = toPdf(v, 0, 0), [x1, y1] = toPdf(v, dx * scale, dy * scale); [dx, dy] = [x1 - x0, y1 - y0]; }
  const before = snapshot(); for (const m of ms) ffdShift(m, dx, dy);
  views.forEach((vv) => vv.rendered && drawMarks(vv)); changed(before, 'Move fields');
}
// Keys while designing: Delete (a field from the PDF, or several), Ctrl/Cmd+D, arrows for several
window.addEventListener('keydown', (e) => {
  if (!doc || $('#dialog').open || !ffDesign()) return;
  const a = document.activeElement; if (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable) return;
  const ms = ffdSelected(), mod = isMac ? e.metaKey : e.ctrlKey;
  if (e.key === 'Escape') { ffdSel = new Set(); return; }
  if (!ms.length) return;
  const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
  if ((e.key === 'Delete' || e.key === 'Backspace') && (ms.length > 1 || ms[0].type === 'ffx')) { stop(); if (ms.length > 1) ffdDeleteSelection(); else ffDeleteExisting(ms[0].name); return; }
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd') { stop(); ffdDuplicate(); return; }
  if (/^Arrow/.test(e.key) && !e.altKey && !mod && ms.length > 1) { stop(); ffdNudge(e.key, e.shiftKey); }
}, true);

/* ---- properties: General, Appearance, Options, Actions, Format, Validate, Calculate ---- */
const FFD_SCRIPT_NOTE = '<p class="ffd-note ff-wide">Runs in apps that support form scripts. It is not run here.</p>';
const ffdWhen = (sel, vals, html) => `<div class="ffd-when ff-wide" data-when="${sel}=${vals}"><div class="ff-props">${html}</div></div>`;
const ffdColor = (id, label, value, none) => `<div class="field ffd-color"><span>${esc(label)}</span><span class="ffd-color-row"><input type="color" id="${id}" aria-label="${esc(label)}" value="${esc(value ? value.toLowerCase() : '#ffffff')}">${none ? `<label class="ff-chk"><input type="checkbox" id="${id}None"${!value ? ' checked' : ''}> ${esc(none)}</label>` : ''}</span></div>`;
function ffdActionHtml(t) {
  const mu = t.mu && t.mu.t !== 'none' ? t.mu : t.kind === 'button' ? { t: t.act === 'url' ? 'url' : t.act === 'reset' ? 'reset' : 'none', url: t.url } : { t: 'none' };
  const names = [...ffNames()].filter((n) => n !== ffdNameOf(t)).sort();
  return ffSel('ffAct', t.kind === 'button' ? 'When clicked' : 'When clicked (mouse up)', [['none', 'Nothing'], ['reset', 'Reset the form'], ['url', 'Open a link'], ['page', 'Go to a page'], ['show', 'Show or hide a field'], ['print', 'Print'], ['submit', 'Send the form by email']], mu.t)
    + ffdWhen('ffAct', 'url', ffInp('ffUrl', 'Link', mu.t === 'url' ? mu.url || '' : t.url || '', 'placeholder="https://"'))
    + ffdWhen('ffAct', 'page', ffInp('ffdPage', 'Page', mu.page || 1, `type="number" min="1" max="${doc.pages.length}"`))
    + ffdWhen('ffAct', 'show', ffSel('ffdField', 'Field', names.length ? names.map((n) => [n, n]) : [['', 'No other fields']], mu.field || names[0] || '') + ffSel('ffdHide', 'Do this', [['0', 'Show it'], ['1', 'Hide it']], mu.hide ? '1' : '0'))
    + ffdWhen('ffAct', 'submit', ffInp('ffdTo', 'Email address', mu.to || '', 'type="email" placeholder="name@example.com"') + ffSel('ffdAs', 'Send', [['FDF', 'The form data (FDF)'], ['PDF', 'The whole PDF']], mu.as || 'FDF') + '<p class="ffd-note ff-wide">This opens the mail app of the person filling in the form, with the form attached. Nothing is sent from here.</p>');
}
function ffdTabsFor(k) {
  const t = [['general', 'General'], ['look', 'Appearance']];
  if (['text', 'date', 'combo', 'list'].includes(k)) t.push(['options', 'Options']);
  if (k !== 'button') t.push(['actions', 'Actions']);
  if (k === 'text' || k === 'combo') t.push(['format', 'Format'], ['validate', 'Validate'], ['calc', 'Calculate']);
  return t;
}
function ffdPropsHtml(t, gen) {
  const k = t.kind, isX = t.type === 'ffx', sizes = [...new Set([...FF_SIZES, t.size || 0])].sort((a, b) => a - b).map((n) => [n, n ? ffdNum(n) + ' pt' : 'Auto']);
  const kinds = Object.entries(FF_KINDS).filter(([kk]) => kk !== 'radio').map(([kk, K]) => [kk, K.label]);
  const tabs = ffdTabsFor(k);
  let g = ffInp('ffName', k === 'radio' ? 'Group name' : 'Name', gen.name) + ffInp('ffTip', 'Tooltip', gen.tip, 'placeholder="Shown on hover"');
  if (k !== 'radio') g += ffSel('ffdKind', 'Type', kinds, k);
  if (k === 'text') g += ffInp('ffVal', isX ? 'Value' : 'Default value', t.val);
  if (k === 'date') g += ffSel('ffFmt', 'Date format', FFD_DATES.map((x) => [x, x]), t.fmt || FF_DATE_FORMATS[0]) + ffInp('ffVal', isX ? 'Value' : 'Default value', t.val, `placeholder="${esc(t.fmt || FF_DATE_FORMATS[0])}"`);
  if (k === 'combo' || k === 'list') g += `<label class="field ff-wide"><span>Options, one per line</span><textarea id="ffOpts" rows="4">${esc((t.opts || []).join('\n'))}</textarea></label>` + ffInp('ffVal', isX ? 'Choice' : 'Default choice', t.val, 'placeholder="None"');
  if (k === 'check' || k === 'radio') g += ffInp('ffExp', 'Export value', t.exp);
  if (k === 'button') g += ffInp('ffLabel', 'Label', t.label) + ffdActionHtml(t);
  if (k === 'text') g += ffInp('ffMax', 'Maximum characters', t.max || '', 'type="number" min="0" placeholder="No limit"');
  if (k !== 'check' && k !== 'radio' && k !== 'sig') g += ffSel('ffSize', 'Font size', sizes, t.size || 0);
  g += `<div class="ff-checks ff-wide">${k === 'text' ? ffChk('ffMulti', 'Multiple lines', t.multi) : ''}${k === 'check' ? ffChk('ffOn', 'Ticked to start with', t.val) : ''}${k === 'radio' ? ffChk('ffOn', 'Chosen to start with', t.val) : ''}${ffChk('ffReq', 'Required', gen.req)}${ffChk('ffRo', 'Read-only', gen.ro)}${k === 'sig' && t.pic ? ffChk('ffdNoPic', 'Remove the signature picture', false) : ''}</div>`;
  // Appearance
  let look = '';
  if (k !== 'check' && k !== 'radio' && k !== 'sig') look += ffSel('ffdFont', 'Font', FFD_FONTS, t.font || 'Helv');
  if (k !== 'sig') look += ffdColor('ffdColor', k === 'check' || k === 'radio' ? 'Mark colour' : 'Text colour', t.color || '#000000');
  look += ffdColor('ffdBc', 'Border colour', t.bc ?? (k === 'check' || k === 'radio' || k === 'button' ? '#000000' : FF_BORDER), 'No border') + ffdColor('ffdBg', 'Fill colour', t.bg || '', 'No fill');
  look += ffSel('ffdBs', 'Border style', FFD_BORDERS, t.bs || 'S') + ffSel('ffdBw', 'Border width', [[0, 'None'], [1, 'Thin'], [2, 'Medium'], [3, 'Thick'], ...([0, 1, 2, 3].includes(t.bw ?? 1) ? [] : [[t.bw, ffdNum(t.bw) + ' pt']])], t.bw ?? 1);
  if (['text', 'date', 'combo', 'list'].includes(k)) look += ffSel('ffdQ', 'Alignment', [[0, 'Left'], [1, 'Centre'], [2, 'Right']], t.q || 0);
  if (k === 'check' || k === 'radio') look += ffSel('ffdStyle', k === 'check' ? 'Check box style' : 'Button style', Object.entries(FFD_STYLES).map(([kk, [, l]]) => [kk, l]), t.style || (k === 'check' ? 'check' : 'circle'));
  if (isX && t.ownFont && k !== 'check' && k !== 'radio' && k !== 'sig') look += `<p class="ffd-note ff-wide">It uses a font of this PDF (${esc(t.ownFont)}). That font stays unless you pick another.</p>`;
  if (['text', 'date', 'combo', 'list'].includes(k) && typeof fontsEmbed !== 'function') look += '<p class="ffd-note ff-wide">These fonts show Western European letters. Other letters may not show in the saved field.</p>';
  // Options
  let opt = '';
  if (k === 'text' || k === 'date') opt = `<div class="ff-checks ff-wide">${ffChk('ffdComb', 'Comb: one box for each character (uses Maximum characters)', t.comb)}${ffChk('ffdScroll', 'Scroll long text', t.scroll ?? true)}${ffChk('ffdPw', 'Password: hide what is typed', t.pw)}${ffChk('ffdNoSpell', "Don't check spelling", t.nospell)}</div>` + (isX ? ffInp('ffdDv', 'Default value (Reset form goes back to it)', t.dv || '') : '');
  if (k === 'combo') opt = `<div class="ff-checks ff-wide">${ffChk('ffdEdit', 'Allow typing an answer of your own', t.edit)}${ffChk('ffdSort', 'Sort the options', t.sort)}${ffChk('ffdNoSpell', "Don't check spelling", t.nospell)}</div>`;
  if (k === 'list') opt = `<div class="ff-checks ff-wide">${ffChk('ffdMultiSel', 'Allow choosing more than one', t.multisel)}${ffChk('ffdSort', 'Sort the options', t.sort)}</div>`;
  // Format
  const af = t.af || { t: 'none' }, fmtTypes = [['none', 'None'], ['number', 'Number'], ['percent', 'Percentage'], ['date', 'Date'], ['time', 'Time'], ['special', 'Special'], ['custom', 'Custom script']];
  const fmt = ffSel('ffdFmtT', 'Format', fmtTypes, af.t)
    + ffdWhen('ffdFmtT', 'number|percent', ffSel('ffdDec', 'Decimal places', [0, 1, 2, 3, 4, 5, 6].map((n) => [n, String(n)]), af.dec ?? 2) + ffSel('ffdSep', 'Separator style', FFD_SEPS, af.sep ?? 0))
    + ffdWhen('ffdFmtT', 'number', ffSel('ffdNeg', 'Negative numbers', FFD_NEGS, af.neg ?? 0) + ffInp('ffdCur', 'Currency symbol', af.cur ?? '', 'placeholder="None, or $ € £…" maxlength="4"') + `<div class="ff-checks ff-wide">${ffChk('ffdPre', 'Symbol before the number', af.pre ?? true)}</div>`)
    + ffdWhen('ffdFmtT', 'date', ffSel('ffdDf', 'Date format', FFD_DATES.map((x) => [x, x]), af.df || FF_DATE_FORMATS[0]))
    + ffdWhen('ffdFmtT', 'time', ffSel('ffdTm', 'Time format', FFD_TIMES.map((x, n) => [n, x]), af.tm ?? 0))
    + ffdWhen('ffdFmtT', 'special', ffSel('ffdSp', 'Kind', FFD_SPECIAL.map((x, n) => [n, x]), af.sp ?? 0))
    + ffdWhen('ffdFmtT', 'custom', `<label class="field ff-wide"><span>Format script</span><textarea id="ffdFjs" rows="3" spellcheck="false">${esc(af.js || '')}</textarea></label><label class="field ff-wide"><span>Keystroke script</span><textarea id="ffdKjs" rows="3" spellcheck="false">${esc(af.ks || '')}</textarea></label>${FFD_SCRIPT_NOTE}`);
  const vl = t.vl || { t: 'none' };
  const val = ffSel('ffdVT', 'Check the value', [['none', 'No check'], ['range', 'A number in a range'], ['custom', 'Custom script']], vl.t)
    + ffdWhen('ffdVT', 'range', ffInp('ffdMin', 'From', vl.min ?? '', 'type="number" step="any" placeholder="No minimum"') + ffInp('ffdMax', 'To', vl.max ?? '', 'type="number" step="any" placeholder="No maximum"'))
    + ffdWhen('ffdVT', 'custom', `<label class="field ff-wide"><span>Validation script</span><textarea id="ffdVjs" rows="3" spellcheck="false">${esc(vl.js || '')}</textarea></label>${FFD_SCRIPT_NOTE}`);
  const cl = t.cl || { t: 'none' }, others = [...ffNames()].filter((n) => n !== gen.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const calc = ffSel('ffdCT', 'Value', [['none', 'Typed in'], ['simple', 'Worked out from other fields'], ['sfn', 'A formula (simplified field notation)'], ['custom', 'Custom script']], cl.t)
    + ffdWhen('ffdCT', 'simple', ffSel('ffdOp', 'The', FFD_OPS, cl.op || 'SUM') + `<div class="field ff-wide"><span>Of these fields</span><div class="ffd-picks">${others.map((n) => `<label class="ff-chk"><input type="checkbox" class="ffd-pick" value="${esc(n)}"${(cl.fields || []).includes(n) ? ' checked' : ''}> ${esc(n)}</label>`).join('') || '<span class="ffd-note">No other fields yet</span>'}</div></div>`)
    + ffdWhen('ffdCT', 'sfn', ffInp('ffdSfn', 'Formula', cl.sfn || '', 'placeholder="Price * Quantity" spellcheck="false"') + '<p class="ffd-note ff-wide">Field names with + − * / and brackets. A backslash keeps a space in a name: First\\ name.</p>')
    + ffdWhen('ffdCT', 'custom', `<label class="field ff-wide"><span>Calculation script</span><textarea id="ffdCjs" rows="3" spellcheck="false">${esc(cl.js || '')}</textarea></label>${FFD_SCRIPT_NOTE}`)
    + '<p class="ffd-note ff-wide">Totals are worked out as the form is filled in, here and in other apps. Calculation order (Forms tab) sets which runs first.</p>';
  const panels = { general: g, look, options: opt, actions: k === 'button' ? '' : ffdActionHtml(t), format: fmt, validate: val, calc };
  return `<div class="ffd-tabs seg" role="tablist" aria-label="Settings">${tabs.map(([id, l], n) => `<button type="button" role="tab" data-ffd-tab="${id}" aria-selected="${!n}" tabindex="${n ? -1 : 0}">${l}</button>`).join('')}</div>`
    + tabs.map(([id], n) => `<div class="ff-props ffd-panel" data-ffd-panel="${id}" role="tabpanel"${n ? ' hidden' : ''}>${panels[id]}</div>`).join('');
}
function ffdPropsSetup(dlg) {
  const tabs = $$('[data-ffd-tab]', dlg);
  const show = (id) => { tabs.forEach((b) => { const on = b.dataset.ffdTab === id; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }); $$('[data-ffd-panel]', dlg).forEach((p) => { p.hidden = p.dataset.ffdPanel !== id; }); };
  tabs.forEach((b) => { b.onclick = () => show(b.dataset.ffdTab); });
  const bar = $('.ffd-tabs', dlg); if (bar) bar.addEventListener('keydown', (e) => tabKeys(e, tabs, (b) => { show(b.dataset.ffdTab); b.focus(); }));
  const sync = () => $$('[data-when]', dlg).forEach((w) => { const [id, vals] = w.dataset.when.split('='), s = $('#' + id, dlg); w.hidden = !s || !vals.split('|').includes(s.value); });
  $$('select', dlg).forEach((s) => s.addEventListener('change', sync)); sync();
  for (const id of ['ffdBc', 'ffdBg']) { const c = $('#' + id, dlg), n = $('#' + id + 'None', dlg); if (c && n) c.addEventListener('input', () => { n.checked = false; }); }
  const fmt = $('#ffFmt', dlg); if (fmt) fmt.onchange = () => { $('#ffVal', dlg).placeholder = fmt.value; };
  setTimeout(() => { const n = $('#ffName', dlg); n.focus(); n.select(); }, 0);
}
// The dialog's settings, into t (a copy of the field)
function ffdRead(dlg, t) {
  const val = (id) => { const e = $('#' + id, dlg); return e ? e.value : undefined; }, on = (id) => { const e = $('#' + id, dlg); return e ? e.checked : undefined; };
  const k = t.kind;
  if (k === 'text') { t.multi = on('ffMulti'); t.max = Math.max(0, parseInt(val('ffMax'), 10) || 0); t.val = t.max ? val('ffVal').slice(0, t.max) : val('ffVal'); if (!t.multi) t.val = t.val.replace(/\n/g, ' '); }
  if (k === 'date') { t.fmt = val('ffFmt'); t.val = val('ffVal').trim(); }
  if (k === 'combo' || k === 'list') {
    const opts = [...new Set(val('ffOpts').split('\n').map((x) => x.trim()).filter(Boolean))];
    if (JSON.stringify(opts) !== JSON.stringify(t.opts || [])) delete t.optx;
    t.opts = opts;
    const d = val('ffVal').trim(); t.val = t.opts.includes(d) || (k === 'combo' && on('ffdEdit')) ? d : '';
    if (d && !t.val) toast(`${d} is not one of the options, so nothing is chosen to start with`);
  }
  if (k === 'check' || k === 'radio') { t.exp = ffClean(val('ffExp')) || (k === 'check' ? 'Yes' : t.exp); t.val = on('ffOn'); }
  if (k === 'button') t.label = val('ffLabel');
  if (val('ffSize') !== undefined) t.size = +val('ffSize') || 0;
  if (val('ffdFont') !== undefined) t.font = val('ffdFont');
  if (val('ffdColor') !== undefined) t.color = val('ffdColor').toUpperCase();
  t.bc = on('ffdBcNone') ? '' : val('ffdBc').toUpperCase(); t.bg = on('ffdBgNone') ? '' : val('ffdBg').toUpperCase();
  t.bs = val('ffdBs'); t.bw = +val('ffdBw');
  if (val('ffdQ') !== undefined) t.q = +val('ffdQ');
  if (val('ffdStyle') !== undefined) t.style = val('ffdStyle');
  if (on('ffdComb') !== undefined) { t.comb = on('ffdComb'); t.scroll = on('ffdScroll'); t.pw = on('ffdPw'); }
  if (on('ffdNoSpell') !== undefined) t.nospell = on('ffdNoSpell');
  if (on('ffdEdit') !== undefined) t.edit = on('ffdEdit');
  if (on('ffdSort') !== undefined) t.sort = on('ffdSort');
  if (on('ffdMultiSel') !== undefined) t.multisel = on('ffdMultiSel');
  if (val('ffdDv') !== undefined) t.dv = val('ffdDv');
  if (t.comb && !(t.max > 0)) { t.comb = false; toast('A comb needs a maximum number of characters (General)'); }
  if (on('ffdNoPic')) delete t.pic;
  const act = val('ffAct');
  if (act !== undefined) {
    let url = (val('ffUrl') || '').trim(); if (act === 'url' && url && !/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    const to = (val('ffdTo') || '').trim();
    t.mu = act === 'url' ? { t: 'url', url } : act === 'page' ? { t: 'page', page: Math.max(1, Math.min(doc.pages.length, parseInt(val('ffdPage'), 10) || 1)) } : act === 'show' ? { t: 'show', field: val('ffdField'), hide: val('ffdHide') === '1' } : act === 'submit' ? { t: 'submit', to, as: val('ffdAs') } : { t: act };
    if (act === 'submit' && !/^[^@\s]+@[^@\s]+$/.test(to)) toast('Add the email address the form is sent to');
    if (k === 'button') { t.act = act === 'url' || act === 'reset' ? act : 'none'; t.url = act === 'url' ? url : ''; }
  }
  const ft = val('ffdFmtT');
  if (ft !== undefined) {
    t.af = ft === 'number' ? { t: 'number', dec: +val('ffdDec'), sep: +val('ffdSep'), neg: +val('ffdNeg'), cur: val('ffdCur').trim(), pre: on('ffdPre') }
      : ft === 'percent' ? { t: 'percent', dec: +val('ffdDec'), sep: +val('ffdSep') } : ft === 'date' ? { t: 'date', df: val('ffdDf') }
        : ft === 'time' ? { t: 'time', tm: +val('ffdTm') } : ft === 'special' ? { t: 'special', sp: +val('ffdSp') }
          : ft === 'custom' ? { t: 'custom', js: val('ffdFjs'), ks: val('ffdKjs') } : { t: 'none' };
    const vt = val('ffdVT'), num = (s) => (String(s).trim() === '' ? '' : +s);
    t.vl = vt === 'range' ? { t: 'range', min: num(val('ffdMin')), max: num(val('ffdMax')) } : vt === 'custom' ? { t: 'custom', js: val('ffdVjs') } : { t: 'none' };
    const ct = val('ffdCT');
    t.cl = ct === 'simple' ? { t: 'simple', op: val('ffdOp'), fields: $$('.ffd-pick', dlg).filter((c) => c.checked).map((c) => c.value) }
      : ct === 'sfn' ? { t: 'sfn', sfn: val('ffdSfn').trim() } : ct === 'custom' ? { t: 'custom', js: val('ffdCjs') } : { t: 'none' };
    if (t.cl.t === 'sfn' && t.cl.sfn && !ffdSfnParse(t.cl.sfn)) toast('That formula could not be read: use field names, numbers and + − * / ( )');
  }
}
// Settings a field's widgets share (a widget keeps its own place, export value and picture)
const FFD_OWN = new Set(['id', 'type', 'ref', 'x1', 'y1', 'x2', 'y2', 'rot', 'orig', 'origVal', 'F', 'exp', 'val', 'pic', 'cp', 'cpOf', 'name']);
function ffdShare(from, to) {
  for (const k of Object.keys(from)) if (!FFD_OWN.has(k)) to[k] = JSON.parse(JSON.stringify(from[k]));
  for (const k of Object.keys(to)) if (!FFD_OWN.has(k) && !(k in from)) delete to[k];
  if (from.kind !== 'radio') to.val = from.val;
}
function ffdDefaults(t, k) {
  const was = t.kind; t.kind = k;
  if (k === 'text') { t.multi ??= false; t.max ??= 0; }
  if (k === 'date') t.fmt ||= FF_DATE_FORMATS[0];
  if ((k === 'combo' || k === 'list') && !(t.opts && t.opts.length)) t.opts = ['Option 1', 'Option 2', 'Option 3'];
  if (k === 'check') { t.exp ||= 'Yes'; if (was !== 'check') t.val = false; }
  if (k === 'button') { t.label ||= 'Button'; t.act ||= 'none'; t.url ||= ''; }
  if (k === 'sig') t.val = '';
  if (['text', 'date', 'combo', 'list'].includes(k) && typeof t.val !== 'string') t.val = '';
  if (!['text', 'combo'].includes(k)) { delete t.af; delete t.vl; delete t.cl; }
}
async function ffdProps(m, name) {
  let t, widgets = null;
  if (m) t = JSON.parse(JSON.stringify(m));
  else { widgets = await ffdWidgetsOfField(name); if (!widgets.length) return; t = ffdProxyOf(widgets[0].entry, widgets[0].a); }
  const isX = t.type === 'ffx', md = isX ? ffModOf(t.name) || {} : {};
  if (isX && !t.ownFont) { const e = m ? ffdEntryOf(m) : widgets[0].entry; if (e) t.ownFont = ffdOwnOf((await ffdSrcInfo(e.src)).get(t.ref)); }
  const gen = { name: isX ? ffShown(t.name) : t.name, tip: isX ? md.tip ?? t.tip : t.tip, req: isX ? md.req ?? t.req : t.req, ro: isX ? md.ro ?? t.ro : t.ro };
  const K = FF_KINDS[t.kind] || FF_KINDS.text;
  const a = await dialog(`${K.label} properties`, `<div class="ffd-props">${ffdPropsHtml(t, gen)}</div>`, [{ label: 'Delete field', value: 'delete', danger: true }, { label: 'Cancel' }, { label: 'Save', value: 'save', primary: true }], ffdPropsSetup);
  const dlg = $('#dialog');
  if (a === 'delete') {
    if (isX) return ffDeleteExisting(t.name);
    const before = snapshot();
    for (const x of [m, ...(m.cp ? ffdSiblings(m) : [])]) { const e = ffdEntryOf(x); if (e) marksOf(e).splice(marksOf(e).indexOf(x), 1); }
    selMark = null; ffdSel = new Set(); views.forEach((v) => v.rendered && drawMarks(v)); changed(before); toast('Field deleted'); return;
  }
  if (a !== 'save') return;
  const newKind = $('#ffdKind', dlg) ? $('#ffdKind', dlg).value : t.kind;
  const was = ffdOrigOf(t) + JSON.stringify(t.val ?? null);
  ffdRead(dlg, t);
  // A field from the PDF with a dotted name ("Addr.City") is a field in a parent: the part after the last dot is its
  // own name, and only that part can change (a name left as it was stays exactly as it was).
  const typed = $('#ffName', dlg).value.trim();
  let nm;
  if (isX) {
    const dot = gen.name.lastIndexOf('.'), pre = dot >= 0 ? gen.name.slice(0, dot + 1) : '';
    const own = !typed || typed === gen.name ? null : typed.startsWith(pre) ? typed.slice(pre.length) : typed.slice(typed.lastIndexOf('.') + 1);
    nm = own == null ? gen.name : pre + (ffClean(own) || gen.name.slice(pre.length));
  } else nm = ffClean(typed) || gen.name;
  const tip = $('#ffTip', dlg).value.trim(), req = $('#ffReq', dlg).checked, ro = $('#ffRo', dlg).checked;
  const before = snapshot();
  if (isX) {
    if (nm !== gen.name && ffNames().has(nm)) { toast(`A field is already called ${nm}`); nm = gen.name; }
    let mod = ffModOf(t.name); if (!mod) { mod = { id: uid(), type: 'ffmod', name: t.name }; docMarks().push(mod); }
    mod.newName = nm === t.name ? undefined : nm; mod.tip = tip; mod.req = req; mod.ro = ro;
    if (newKind !== t.kind) { await ffdRetype(t, newKind, before); return; }
    if (ffdOrigOf(t) + JSON.stringify(t.val ?? null) !== was) {
      // the settings go on every widget of the field (a proxy is made for each)
      const ps = ffdProxies(widgets || await ffdWidgetsOfField(t.name));
      if (m && !ps.includes(m)) ps.push(m);
      for (const p of ps) { ffdShare(t, p); if (p.ref === t.ref) { p.val = t.val; p.exp = t.exp; if (t.pic) p.pic = t.pic; else delete p.pic; } }
      if (t.kind === 'radio' && t.val) for (const p of ps) if (p.ref !== t.ref) p.val = false;
    }
    ffdRecalc();
    changed(before); views.forEach((v) => { if (v.rendered) { drawMarks(v); ffLayer(v); } });
    toast('Field updated'); return;
  }
  // a new field (and its copies on other pages)
  const group = m.cp ? [m, ...ffdSiblings(m)] : [m];
  if (nm !== m.name) {
    const used = new Set([...ffNames()].filter((n) => !group.some((x) => x.name === n)));
    const sameGroup = t.kind === 'radio' && ffMarks().some((r) => r.id !== m.id && r.kind === 'radio' && r.name === nm);
    if (used.has(nm) && !sameGroup) { let n = 2; while (used.has(`${nm} ${n}`)) n++; toast(`A field is already called ${nm}. This one is ${nm} ${n}.`); nm = `${nm} ${n}`; }
  }
  Object.assign(t, { name: nm, tip, req, ro });
  if (newKind !== t.kind) ffdDefaults(t, newKind);
  for (const k of Object.keys(m)) if (!(k in t)) delete m[k];
  Object.assign(m, t);
  if (m.kind === 'radio') { ffLastRadio = m.name; if (m.val) for (const r of ffMarks()) if (r !== m && r.kind === 'radio' && r.name === m.name) r.val = false; }
  for (const x of group) if (x !== m) { ffdShare(m, x); x.name = m.name; x.tip = tip; x.req = req; x.ro = ro; }
  ffdRecalc();
  views.forEach((v) => v.rendered && drawMarks(v)); changed(before);
  toast('Field updated');
}
// A field from the PDF made another kind: it is taken out, and a new field of that kind put in each of its places,
// with its name and value.
async function ffdRetype(t, kind, before) {
  const all = await ffdWidgetsOfField(t.name), shown = ffShown(t.name), md = ffModOf(t.name) || {}, made = [];
  const val = t.kind === 'check' || t.kind === 'radio' ? (t.val ? t.exp || 'Yes' : '') : t.val;
  await ffDeleteExisting(t.name, true);
  for (const { entry, a } of all) {
    const n = ffdAsNew(ffdProxyOf(entry, a));
    n.name = shown; n.tip = md.tip ?? n.tip; n.req = md.req ?? n.req; n.ro = md.ro ?? n.ro;
    ffdDefaults(n, kind);
    if (kind === 'text' || kind === 'date' || kind === 'combo' || kind === 'list') n.val = String(val || '');
    if ((kind === 'combo' || kind === 'list') && n.val && !n.opts.includes(n.val)) n.opts = [n.val, ...n.opts];
    if (kind === 'check') n.val = !!val;
    if (made.length && kind !== 'radio') n.cp = made[0].cp ||= uid();
    marksOf(entry).push(n); made.push(n);
  }
  changed(before, 'Change field type');
  views.forEach((v) => { if (v.rendered) { drawMarks(v); ffLayer(v); } });
  toast(`${shown} is now a ${FF_KINDS[kind].label.toLowerCase()}`);
}

/* ---- signature fields: sign one, or put a picture of a signature in it ---- */
// A signing feature (certificates) can take over with FEATURE.onSigField({ entry, field, picture }): it returns
// 'picture' (or calls picture()) for the picture alone.
async function ffdSignField(m, v, a) {
  const entry = m ? ffdEntryOf(m) : v && v.entry; if (!entry) return;
  const rect = m ? ffBox(m) : [Math.min(a.rect[0], a.rect[2]), Math.min(a.rect[1], a.rect[3]), Math.max(a.rect[0], a.rect[2]), Math.max(a.rect[1], a.rect[3])];
  const ref = m ? m.ref || null : a.id;
  // a field signed already (a digital signature in /V) is left as it is
  if (ref && (await ffdSrcInfo(entry.src)).get(ref)?.signed) { toast('This field is signed already.'); return; }
  const field = { name: m ? ffdNameOf(m) : ffShown(a.fieldName), rect, page: doc.pages.indexOf(entry), ref, markId: m ? m.id : null, kind: 'sig' };
  const picture = () => ffdSigPicture(m, entry, a);
  if (typeof FEATURE.onSigField === 'function') {
    const r = await FEATURE.onSigField({ entry, field, picture });
    if (r !== 'picture') return;
  }
  return picture();
}
// The Signature dialog (draw, type or a picture), with the picture kept for the field instead of placed by hand
async function ffdAskSignature() {
  const keep = sigUse; let got = null, tries = 0;
  sigUse = (sig) => { sigKeep(sig); got = sig; };
  const note = () => {
    const body = $('#dialog[open] .dlg-body'); if (body && $('#sigPad', body) && !$('.ffd-signote', body)) { body.insertAdjacentHTML('afterbegin', '<p class="ffd-signote">This adds the picture only. It is not a digital signature.</p>'); return; }
    if (tries++ < 100) requestAnimationFrame(note);
  };
  requestAnimationFrame(note);
  try { await signature(); } finally { sigUse = keep; }
  return got;
}
async function ffdSigPicture(m, entry, a) {
  const sig = await ffdAskSignature(); if (!sig) return;
  const before = snapshot();
  if (!m) [m] = ffdProxies([{ entry, a }]);
  m.pic = { data: sig.data, w: sig.w, h: sig.h };
  changed(before, 'Signature picture');
  views.forEach((v) => { if (v.rendered) { drawMarks(v); ffLayer(v); } });
  toast('Picture placed. It is not a digital signature.');
}

/* ---- the page overlay: signature fields to click (Fill in), tab numbers (designing), the selection box ---- */
function ffdOverlay(v) {
  let s = v.el.querySelector('svg.ffd-layer');
  if (!s) {
    s = svgEl('svg', { class: 'ffd-layer' }); v.el.appendChild(s);
    s.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.ffd-sighit'); if (!h) return;
      e.preventDefault(); e.stopPropagation();
      const a = (v.ffWidgets || []).find((x) => x.id === h.dataset.ref); if (a) ffdSignField(null, v, a);
    });
  }
  s.setAttribute('viewBox', `0 0 ${v.viewport.width} ${v.viewport.height}`);
  for (const el of [...s.children]) if (!el.classList.contains('ffd-band')) el.remove();
  if (!doc || ffFlat()) return;
  const gone = ffGone(v.entry), proxied = new Set(marksOf(v.entry).filter((m) => m.type === 'ffx').map((m) => m.ref));
  const box = (r) => { const p = [[r[0], r[1]], [r[2], r[3]]].map(([x, y]) => toView(v, x, y)); return [Math.min(p[0][0], p[1][0]), Math.min(p[0][1], p[1][1]), Math.abs(p[1][0] - p[0][0]), Math.abs(p[1][1] - p[0][1])]; };
  if (!ffDesign()) {
    for (const a of v.ffWidgets || []) {
      if (a.fieldType !== 'Sig' || gone.has(a.id) || proxied.has(a.id) || (ffModOf(a.fieldName) || {}).del) continue;
      // only an empty signature field can be clicked (not one signed already): known once the PDF has been read
      const info = ffdInfoNow(v.entry.src, a.id);
      if (!info) { ffdSrcInfo(v.entry.src).then(() => { if (v.el.isConnected) ffdOverlay(v); }); continue; }
      if (info.signed) continue;
      const [x, y, w, h] = box(a.rect), r = svgEl('rect', { class: 'ffd-sighit', x, y, width: w, height: h, rx: 2 });
      r.dataset.ref = a.id; const t = svgEl('title', {}); t.textContent = `Sign ${ffShown(a.fieldName)}`; r.appendChild(t);
      s.appendChild(r);
    }
    return;
  }
  if (!S.ffdNums) return;
  ffdTabOrder(v.entry).items.forEach((it, k) => {
    const [x, y] = box(it.box), g = svgEl('g', { class: 'ffd-num', transform: `translate(${x + 2} ${y + 2})` });
    g.appendChild(svgEl('rect', { x: 0, y: 0, width: String(k + 1).length * 7 + 8, height: 15, rx: 7.5 }));
    const t = svgEl('text', { x: 4, y: 11 }); t.textContent = k + 1; g.appendChild(t);
    s.appendChild(g);
  });
}

/* ---- tab order: the Fields panel ---- */
const ffdTabMark = () => docMarks().find((m) => m.type === 'fftab');
// The fields on a page: new ones, proxies and the PDF's own, each with a key that stays when it gets a proxy
function ffdPageFields(entry) {
  const gone = ffGone(entry), out = [], seen = new Set();
  const nb = (r) => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  const own = ffdWidgetsNow().filter((w) => w.src === entry.src && w.page === entry.i);
  const v = views.find((x) => x.entry === entry), list = own.length ? own.map((w) => w.a) : (v && v.ffWidgets) || [];
  const marks = marksOf(entry);
  for (const a of list) {
    if (gone.has(a.id) || (ffModOf(a.fieldName) || {}).del || seen.has(a.id)) continue; seen.add(a.id);
    const m = marks.find((x) => x.type === 'ffx' && x.ref === a.id);
    out.push({ key: 'w:' + a.id, name: m ? ffShown(m.name) : ffShown(a.fieldName), kind: m ? m.kind : ffdKindOf(a), box: m ? ffBox(m) : nb(a.rect), m });
  }
  for (const m of marks) if (m.type === 'ff') out.push({ key: 'm:' + m.id, name: m.name, kind: m.kind, box: ffBox(m), m });
  return out;
}
function ffdTabOrder(entry) {
  const items = ffdPageFields(entry), t = ffdTabMark(), conf = t && t.pages[pageKey(entry)];
  const tabs = conf ? conf.tabs : null;
  if (tabs === 'R' || tabs === 'C') {
    const top = (b) => -Math.round(b[3] / 6), left = (b) => Math.round(b[0] / 6);
    items.sort((p, q) => (tabs === 'R' ? top(p.box) - top(q.box) || left(p.box) - left(q.box) : left(p.box) - left(q.box) || top(p.box) - top(q.box)));
  } else if (conf && conf.order) {
    const at = (k) => { const n = conf.order.indexOf(k); return n < 0 ? 1e6 : n; };
    items.sort((p, q) => at(p.key) - at(q.key));
  }
  return { tabs, items };
}
function ffdSetTabs(entry, tabs, order) {
  const before = snapshot();
  let t = ffdTabMark(); if (!t) { t = { id: uid(), type: 'fftab', pages: {} }; docMarks().push(t); }
  const key = pageKey(entry), conf = t.pages[key] || (t.pages[key] = {});
  conf.tabs = tabs;
  if (order) conf.order = order;
  else { const o = ffdTabOrder(entry).items.map((x) => x.key); conf.order = o; }
  changed(before, 'Tab order');
  ffdPanelDraw(); views.forEach((v) => v.rendered && ffdOverlay(v));
}
function ffdPanelOpen(on = !$('#ffdPanel')) {
  let p = $('#ffdPanel');
  if (!on) { if (p) p.remove(); refreshRibbon(); return; }
  if (!p) {
    p = document.createElement('aside'); p.id = 'ffdPanel'; p.className = 'ffd-panel-side'; p.setAttribute('aria-label', 'Fields');
    document.body.appendChild(p);
    p.addEventListener('click', ffdPanelClick);
    p.addEventListener('change', (e) => {
      if (e.target.id === 'ffdNums') { S.ffdNums = e.target.checked; saveSettings(); views.forEach((v) => v.rendered && ffdOverlay(v)); refreshRibbon(); return; }
      const sel = e.target.closest('[data-tabs]'); if (!sel) return;
      const entry = doc.pages.find((x) => pageKey(x) === sel.dataset.tabs); if (!entry) return;
      const was = ffdTabOrder(entry).items.map((x) => x.key);
      if (sel.value === 'S') ffdSetTabs(entry, 'S', was);
      else { const t = ffdTabMark(), c = t && t.pages[pageKey(entry)]; if (c) c.order = null; ffdSetTabs(entry, sel.value); }
    });
    p.addEventListener('keydown', (e) => {
      const li = e.target.closest('li[data-k]'); if (!li || !e.altKey || !/^Arrow(Up|Down)$/.test(e.key)) return;
      e.preventDefault(); ffdPanelMove(li, e.key === 'ArrowUp' ? -1 : 1, true);
    });
    p.addEventListener('dragstart', (e) => { const li = e.target.closest('li[data-k]'); if (li) { e.dataTransfer.setData('text/plain', li.dataset.k); li.classList.add('dragging'); } });
    p.addEventListener('dragend', (e) => { const li = e.target.closest('li[data-k]'); if (li) li.classList.remove('dragging'); });
    p.addEventListener('dragover', (e) => { if (e.target.closest('li[data-k]')) e.preventDefault(); });
    p.addEventListener('drop', (e) => {
      const to = e.target.closest('li[data-k]'); if (!to) return; e.preventDefault();
      const k = e.dataTransfer.getData('text/plain'), ol = to.parentElement, from = $(`li[data-k="${CSS.escape(k)}"]`, ol); if (!from || from === to) return;
      const keys = [...ol.children].map((x) => x.dataset.k).filter((x) => x !== k), at = keys.indexOf(to.dataset.k);
      keys.splice(at + (from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING ? 1 : 0), 0, k);
      const entry = doc.pages.find((x) => pageKey(x) === ol.dataset.page); if (entry) ffdSetTabs(entry, 'S', keys);
    });
  }
  const r = viewer.getBoundingClientRect(); p.style.top = Math.max(0, r.top + 8) + 'px'; p.style.bottom = Math.max(8, innerHeight - r.bottom + 8) + 'px';
  ffdPanelDraw(); refreshRibbon();
}
function ffdPanelMove(li, d, focus) {
  const ol = li.parentElement, keys = [...ol.children].map((x) => x.dataset.k), k = keys.indexOf(li.dataset.k), n = k + d;
  if (n < 0 || n >= keys.length) return;
  [keys[k], keys[n]] = [keys[n], keys[k]];
  const entry = doc.pages.find((x) => pageKey(x) === ol.dataset.page); if (!entry) return;
  ffdSetTabs(entry, 'S', keys);
  if (focus) { const again = $(`#ffdPanel li[data-k="${CSS.escape(li.dataset.k)}"]`); if (again) again.focus(); }
  announce(`Moved to ${n + 1}`);
}
function ffdPanelClick(e) {
  if (e.target.closest('[data-ffd-close]')) { ffdPanelOpen(false); return; }
  const mv = e.target.closest('[data-mv]'); if (mv) { ffdPanelMove(mv.closest('li'), +mv.dataset.mv); return; }
  const li = e.target.closest('li[data-k]'); if (!li) return;
  const entry = doc.pages.find((x) => pageKey(x) === li.parentElement.dataset.page), n = doc.pages.indexOf(entry);
  if (n >= 0 && n !== current) goPage(n);
  const k = li.dataset.k, it = entry && ffdPageFields(entry).find((x) => x.key === k);
  if (!it || !ffDesign()) return;
  if (it.m) ffdSetSel([it.m]); else { selectMark(null); ffSelectX(it.name); }
}
function ffdPanelDraw() {
  const p = $('#ffdPanel'); if (!p) return;
  if (!doc) { p.remove(); return; }
  const seen = new Set(), pages = [];
  doc.pages.forEach((entry, n) => { const k = pageKey(entry); if (seen.has(k)) return; seen.add(k); const o = ffdTabOrder(entry); if (o.items.length) pages.push({ entry, n, ...o }); });
  const kindName = (k) => (FF_KINDS[k] || FF_KINDS.text).label;
  p.innerHTML = `<div class="ffd-ph"><b>Fields</b><button type="button" class="icon-btn" data-ffd-close aria-label="Close" title="Close">${ic('x')}</button></div>
    <label class="ff-chk ffd-pnum"><input type="checkbox" id="ffdNums"${S.ffdNums ? ' checked' : ''}> Show tab numbers</label>
    <p class="ffd-note">The order Tab moves through each page's fields. Drag a field, or press Alt and an arrow key.</p>
    ${pages.length ? pages.map(({ entry, n, tabs, items }) => `<section class="ffd-pg"><div class="ffd-pg-head"><span>Page ${n + 1}</span><select data-tabs="${esc(pageKey(entry))}" aria-label="Tab order on page ${n + 1}">${[['', 'As in the PDF'], ['S', 'As listed'], ['R', 'By rows'], ['C', 'By columns']].map(([v, l]) => `<option value="${v}"${(tabs || '') === v ? ' selected' : ''}>${l}</option>`).join('')}</select></div>
      <ol class="ffd-list" data-page="${esc(pageKey(entry))}">${items.map((it, k) => `<li draggable="true" tabindex="0" data-k="${esc(it.key)}" aria-label="${esc(`${k + 1}. ${it.name}, ${kindName(it.kind)}`)}"><span class="ffd-n">${k + 1}</span><span class="ffd-nm">${esc(it.name)}<small>${esc(kindName(it.kind))}</small></span><span class="ffd-mv"><button type="button" class="icon-btn" data-mv="-1" aria-label="Move up" title="Move up"${k ? '' : ' disabled'}>${ic('chevron-up')}</button><button type="button" class="icon-btn" data-mv="1" aria-label="Move down" title="Move down"${k < items.length - 1 ? '' : ' disabled'}>${ic('chevron-down')}</button></span></li>`).join('')}</ol></section>`).join('') : '<p class="empty-note">No fields yet. Add one with the tools on the Forms tab.</p>'}`;
  icons();
}
FEATURE.onDocShown.push(() => { ffdWidgets().then(() => ffdPanelDraw()).catch(() => {}); });
(FEATURE.onDocClosed ||= []).push(() => ffdPanelOpen(false));
(FEATURE.onTab ||= []).push((tab) => { if (tab !== 'forms') ffdPanelOpen(false); });
// The panel follows the fields as they change (and undo)
let ffdPanelTimer = 0;
const ffdPanelSoon = () => { if (!$('#ffdPanel')) return; clearTimeout(ffdPanelTimer); ffdPanelTimer = setTimeout(ffdPanelDraw, 120); };

/* ---- calculation order ---- */
async function ffdCalcOrderDlg() {
  const F = ffdFields(), names = ffdCalcOrder(F);
  if (!names.length) { toast('No field is worked out from others yet (Properties, Calculate)'); return; }
  const keyOf = (n) => { const f = F.get(n), p = f && f.parts.find((x) => x.m); return p ? (p.m.type === 'ff' ? 'm:' + p.m.id : 'n:' + p.m.name) : 'n:' + (f.parts[0].w ? f.parts[0].w.a.fieldName : n); };
  let order = names.map((n) => ({ n, k: keyOf(n) }));
  const draw = (dlg) => {
    $('#ffdCo', dlg).innerHTML = order.map((o, k) => `<li><span class="ffd-n">${k + 1}</span><span class="ffd-nm">${esc(o.n)}</span><span class="ffd-mv"><button type="button" class="icon-btn" data-co="${k}" data-d="-1" aria-label="Move ${esc(o.n)} up"${k ? '' : ' disabled'}>${ic('chevron-up')}</button><button type="button" class="icon-btn" data-co="${k}" data-d="1" aria-label="Move ${esc(o.n)} down"${k < order.length - 1 ? '' : ' disabled'}>${ic('chevron-down')}</button></span></li>`).join('');
    icons();
  };
  const a = await dialog('Calculation order', '<p>Fields worked out from others are worked out in this order. Put a field before the fields that use it.</p><ol class="ffd-list" id="ffdCo"></ol>', [{ label: 'Cancel' }, { label: 'Save', value: 'save', primary: true }], (dlg) => {
    draw(dlg);
    $('#ffdCo', dlg).addEventListener('click', (e) => { const b = e.target.closest('[data-co]'); if (!b) return; const k = +b.dataset.co, n = k + +b.dataset.d; [order[k], order[n]] = [order[n], order[k]]; draw(dlg); const again = $(`[data-co="${n}"][data-d="${b.dataset.d}"]`, dlg) || $(`[data-co="${n}"]`, dlg); if (again && !again.disabled) again.focus(); });
  });
  if (a !== 'save') return;
  const before = snapshot();
  let co = docMarks().find((m) => m.type === 'ffco'); if (!co) { co = { id: uid(), type: 'ffco', order: [] }; docMarks().push(co); }
  co.order = order.map((o) => o.k);
  ffdRecalc(); changed(before, 'Calculation order'); views.forEach((v) => v.rendered && drawMarks(v));
  toast('Calculation order saved');
}

/* ---- Prepare for signing: signature, initials and date fields for each signer ---- */
async function ffdPrepareSigning() {
  const a = await dialog('Prepare for signing', `<p>Adds a place to sign for each person, at the foot of this page. Move them where they belong afterwards.</p><div class="ff-props">${ffSel('ffdSigners', 'People signing', [1, 2, 3, 4].map((n) => [n, String(n)]), 1)}<div class="ff-checks ff-wide">${ffChk('ffdPsSig', 'Signature', true)}${ffChk('ffdPsIni', 'Initials', true)}${ffChk('ffdPsDate', 'Date', true)}</div></div>`, [{ label: 'Cancel' }, { label: 'Add fields', value: 'add', primary: true }]);
  if (a !== 'add') return;
  const dlg = $('#dialog'), n = +$('#ffdSigners', dlg).value, want = { sig: $('#ffdPsSig', dlg).checked, ini: $('#ffdPsIni', dlg).checked, date: $('#ffdPsDate', dlg).checked };
  if (!want.sig && !want.ini && !want.date) return;
  const v = views[current] || views.find((x) => x.entry === doc.pages[current]); if (!v) return;
  const before = snapshot(), entry = v.entry, [, , W] = v.page.view, rot = totalRot(v), made = [];
  const x0 = v.page.view[0] + 54, y0 = v.page.view[1] + 40;
  const add = (kind, x, y, w, h, name, tip) => {
    const m = ffNew(kind, v, x, y, x + w, y + h); m.name = ffNames().has(name) ? ffdFreshName(name) : name; m.tip = tip;
    marksOf(entry).push(m); made.push(m);
  };
  for (let k = n; k >= 1; k--) {
    const y = y0 + (n - k) * 62; let x = x0;
    if (want.sig) { add('sig', x, y, 190, 42, `Signer${k}_Signature`, `Signer ${k}: signature`); x += 200; }
    if (want.ini) { add('sig', x, y, 70, 42, `Signer${k}_Initials`, `Signer ${k}: initials`); x += 80; }
    if (want.date) { add('date', x, y + 10, Math.min(110, W - x - 20), 22, `Signer${k}_Date`, `Signer ${k}: date signed`); }
  }
  void rot;
  changed(before, 'Prepare for signing'); drawMarks(v); ffdSetSel(made);
  toast(`${made.length} fields added for ${n} ${n === 1 ? 'person' : 'people'}`);
}

/* ---- saving: the settings written into the PDF ---- */
const ffdNeedsSave = () => !!doc && docMarks().some((m) => m.type === 'fftab' || m.type === 'ffco');
const FFD_FF = { multi: 1 << 12, pw: 1 << 13, nospell: 1 << 22, noscroll: 1 << 23, comb: 1 << 24, edit: 1 << 18, sort: 1 << 19, multisel: 1 << 21 };
// The widget a proxy stands for on the saved page: by its object number (kept when the page is the opened file's), or
// else by its field's name and place (a page copied in from another PDF)
function ffdFindWidget(L, out, p, m) {
  const { PDFName, PDFArray, PDFDict, PDFRef } = L, c = out.context;
  const annots = p.node.lookup(PDFName.of('Annots')); if (!(annots instanceof PDFArray)) return null;
  const r = /^(\d+)R(\d*)$/.exec(String(m.ref || '')), num = r ? +r[1] : -1, gen = r && r[2] ? +r[2] : 0;
  for (const x of annots.asArray()) if (x instanceof PDFRef && x.objectNumber === num && x.generationNumber === gen) { const d = c.lookup(x); if (d instanceof PDFDict) return { ref: x, dict: d }; }
  let o = null; try { const a = JSON.parse(m.orig); o = [a[1], a[2], a[3], a[4]]; } catch {}
  for (const x of annots.asArray()) {
    const d = c.lookup(x); if (!(d instanceof PDFDict) || String(d.get(PDFName.of('Subtype'))) !== '/Widget') continue;
    const rect = d.lookup(PDFName.of('Rect')); if (!(rect instanceof PDFArray) || !o) continue;
    const q = rect.asArray().map((n) => n.asNumber()), b = [Math.min(q[0], q[2]), Math.min(q[1], q[3]), Math.max(q[0], q[2]), Math.max(q[1], q[3])];
    if (b.every((n, k) => Math.abs(n - o[k]) < .6) && ffdFullName(L, d) === m.name) return { ref: x instanceof PDFRef ? x : null, dict: d };
  }
  return null;
}
function ffdFullName(L, d) {
  const parts = []; let x = d;
  for (let n = 0; x && n < 32; n++) { const t = x.lookup(L.PDFName.of('T')); if (t && t.decodeText) parts.unshift(t.decodeText()); x = x.lookup(L.PDFName.of('Parent')); }
  return parts.join('.');
}
// The field a widget belongs to (itself, when the two are one dictionary)
function ffdTerminal(L, out, w) {
  const { PDFName, PDFRef, PDFDict } = L;
  if (w.dict.get(PDFName.of('T'))) return w;
  const pr = w.dict.get(PDFName.of('Parent')), pd = pr instanceof PDFRef ? out.context.lookup(pr) : null;
  return pd instanceof PDFDict ? { ref: pr, dict: pd } : w;
}
// The form's fonts, named as the field settings (/DA) name them
function ffdResources(L, out) {
  const { PDFName, PDFDict } = L, c = out.context, af = out.catalog.getOrCreateAcroForm().dict;
  let dr = af.lookup(PDFName.of('DR')); if (!(dr instanceof PDFDict)) { dr = c.obj({}); af.set(PDFName.of('DR'), dr); }
  let fonts = dr.lookup(PDFName.of('Font')); if (!(fonts instanceof PDFDict)) { fonts = c.obj({}); dr.set(PDFName.of('Font'), fonts); }
  for (const [k, base] of [...Object.entries(FFD_BASE), ['ZaDb', 'ZapfDingbats']]) if (!fonts.get(PDFName.of(k))) fonts.set(PDFName.of(k), c.register(c.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base, ...(k === 'ZaDb' ? {} : { Encoding: 'WinAnsiEncoding' }) })));
}
// (a field from the PDF whose font was not changed keeps the font its settings name, such as one the PDF has)
const ffdDA = (m) => { const [r, g, b] = ffdRgb(m.color || '#000000'); return `/${m.ownFont && m.daFont && /^[^\s/()<>[\]{}%]+$/.test(m.daFont) && !ffdFontChanged(m) ? m.daFont : FFD_BASE[m.font] ? m.font : 'Helv'} ${ffdNum(m.size || 0)} Tf ${r === g && g === b ? `${ffdNum(r)} g` : `${ffdNum(r)} ${ffdNum(g)} ${ffdNum(b)} rg`}`; };
function ffdAction(L, out, mu, pages) {
  const { PDFString, PDFHexString, PDFName } = L, c = out.context;
  if (!mu || mu.t === 'none') return null;
  if (mu.t === 'reset') return c.obj({ S: 'ResetForm' });
  if (mu.t === 'url' && mu.url) return c.obj({ S: 'URI', URI: PDFString.of(mu.url) });
  if (mu.t === 'page') { const p = pages && pages[Math.max(0, Math.min(pages.length - 1, (mu.page | 0) - 1))]; return p ? c.obj({ S: 'GoTo', D: [p.ref, PDFName.of('XYZ'), null, null, null] }) : null; }
  if (mu.t === 'show' && mu.field) return c.obj({ S: 'Hide', T: PDFHexString.fromText(mu.field), H: !!mu.hide });
  if (mu.t === 'print') return c.obj({ S: 'Named', N: 'Print' });
  if (mu.t === 'submit' && mu.to) return c.obj({ S: 'SubmitForm', F: { FS: 'URL', F: PDFString.of('mailto:' + mu.to) }, Flags: mu.as === 'PDF' ? 256 : 0 });
  return null;
}
// Writes the settings of m: on the field (fd) and on its widget (wd). `was` is what they were (null: a new field, so
// only the settings it has are written).
function ffdWrite(L, out, fd, wd, m, was, pages) {
  const { PDFName, PDFHexString, PDFString, PDFNumber, PDFArray, PDFDict } = L, c = out.context, N = (k) => PDFName.of(k);
  const chg = (k) => (was ? JSON.stringify(m[k] ?? null) !== JSON.stringify(was[k] ?? null) : m[k] !== undefined);
  const k = m.kind;
  // the field
  if (chg('font') || chg('size') || chg('color')) { fd.set(N('DA'), PDFString.of(ffdDA(m))); if (wd !== fd && wd.get(N('DA'))) wd.set(N('DA'), PDFString.of(ffdDA(m))); ffdResources(L, out); }
  if (['text', 'date', 'combo', 'list'].includes(k) && chg('q')) fd.set(N('Q'), PDFNumber.of(m.q | 0));
  let ff = 0; { const x = fd.lookup(N('Ff')); ff = x ? x.asNumber() : 0; }
  const bit = (b, on) => { ff = on ? ff | b : ff & ~b; };
  if (k === 'text' || k === 'date') {
    if (chg('multi')) bit(FFD_FF.multi, m.multi); if (chg('pw')) bit(FFD_FF.pw, m.pw); if (chg('nospell')) bit(FFD_FF.nospell, m.nospell);
    if (chg('scroll')) bit(FFD_FF.noscroll, m.scroll === false); if (chg('comb')) bit(FFD_FF.comb, m.comb);
    if (chg('max')) { if (m.max > 0) fd.set(N('MaxLen'), PDFNumber.of(m.max)); else fd.delete(N('MaxLen')); }
    if (chg('dv') && was) { if (m.dv) fd.set(N('DV'), PDFHexString.fromText(m.dv)); else fd.delete(N('DV')); }
  }
  if (k === 'combo' || k === 'list') {
    if (chg('edit')) bit(FFD_FF.edit, m.edit); if (chg('sort')) bit(FFD_FF.sort, m.sort); if (chg('multisel')) bit(FFD_FF.multisel, m.multisel); if (chg('nospell')) bit(FFD_FF.nospell, m.nospell);
    if (chg('opts') && was) fd.set(N('Opt'), c.obj((m.opts || []).map((o, n) => (m.optx && m.optx[n] != null && m.optx[n] !== o ? [PDFHexString.fromText(m.optx[n]), PDFHexString.fromText(o)] : PDFHexString.fromText(o)))));
  }
  if (ff !== ((fd.lookup(N('Ff')) || { asNumber: () => 0 }).asNumber())) fd.set(N('Ff'), PDFNumber.of(ff));
  // format, validation, calculation (/AA on the field; other events it has are kept)
  if (chg('af') || chg('vl') || chg('cl')) {
    let aa = fd.lookup(N('AA')); if (!(aa instanceof PDFDict)) aa = c.obj({});
    const js = (s) => c.obj({ S: 'JavaScript', JS: PDFString.of(s) });
    const put = (key, s) => { if (s) aa.set(N(key), js(s)); else aa.delete(N(key)); };
    if (chg('af')) { const f = ffdFormatJs(m.af); put('F', f && f.F); put('K', f && f.K); }
    if (chg('vl')) put('V', ffdValidateJs(m.vl));
    if (chg('cl')) put('C', ffdCalcJs(m.cl));
    if (aa.keys().length) fd.set(N('AA'), aa); else fd.delete(N('AA'));
  }
  // the widget
  if (was && (chg('x1') || chg('y1') || chg('x2') || chg('y2'))) { const [x1, y1, x2, y2] = ffBox(m); wd.set(N('Rect'), c.obj([x1, y1, x2, y2])); }
  if (chg('bg') || chg('bc') || chg('rot') || chg('style') || chg('label')) {
    let mk = wd.lookup(N('MK')); if (!(mk instanceof PDFDict)) { mk = c.obj({}); wd.set(N('MK'), mk); }
    if (chg('bg')) { if (m.bg) mk.set(N('BG'), c.obj(ffdRgb(m.bg))); else mk.delete(N('BG')); }
    if (chg('bc')) { if (m.bc) mk.set(N('BC'), c.obj(ffdRgb(m.bc))); else mk.delete(N('BC')); }
    if (was && chg('rot')) mk.set(N('R'), PDFNumber.of(m.rot || 0));
    if ((k === 'check' || k === 'radio') && chg('style') && m.style) mk.set(N('CA'), PDFString.of(FFD_STYLES[m.style][0]));
    if (k === 'button' && was && chg('label')) mk.set(N('CA'), PDFHexString.fromText(m.label || ''));
  }
  if (chg('bs') || chg('bw')) {
    const bs = c.obj({ W: m.bw ?? 1, S: m.bs || 'S', ...(m.bs === 'D' ? { D: [3] } : {}) });
    wd.set(N('BS'), bs); wd.delete(N('Border'));
  }
  if (chg('mu') || (k === 'button' && !was && m.act === 'other')) {
    const a = ffdAction(L, out, m.mu, pages);
    if (a) wd.set(N('A'), a); else if (was || (m.mu && m.mu.t === 'none')) wd.delete(N('A'));
  }
  void PDFArray;
}
// A value written into a field from the PDF
function ffdWriteValue(L, out, fd, widgets, m) {
  const { PDFName, PDFHexString, PDFDict } = L, N = (k) => PDFName.of(k);
  const onOf = (wd) => { const ap = wd.lookup(N('AP')), n = ap instanceof PDFDict ? ap.lookup(N('N')) : null; return n instanceof PDFDict ? n.keys().map((x) => x.decodeText()).find((x) => x !== 'Off') : null; };
  if (m.kind === 'check') { const on = m.val ? m.exp || 'Yes' : 'Off'; fd.set(N('V'), N(on)); for (const w of widgets) w.set(N('AS'), N(m.val && onOf(w) ? onOf(w) : 'Off')); }
  else if (m.kind === 'radio') { /* the group's value is set from all its widgets below */ }
  else if (m.kind === 'combo' || m.kind === 'list') { const n = (m.opts || []).indexOf(m.val), ex = m.optx && n >= 0 ? m.optx[n] : m.val; if (ex) fd.set(N('V'), PDFHexString.fromText(ex)); else fd.delete(N('V')); fd.delete(N('I')); }
  else if (m.kind === 'text' || m.kind === 'date') fd.set(N('V'), PDFHexString.fromText(String(m.val ?? '')));
}
async function ffdSaveExisting(L, out, form, list, pages, entries, ctx) {
  ctx.ffdPages = pages; ctx.ffdLooks = ctx.ffdLooks || [];
  const { PDFName, PDFNumber } = L, N = (k) => PDFName.of(k), groups = new Map();
  for (const { p, m } of list) {
    const w = ffdFindWidget(L, out, p, m); if (!w) continue;
    w.dict.set(N('F'), PDFNumber.of(m.F | 0)); // as it was (pdf.js was told not to draw it while it moved)
    if (!ffdDirty(m)) continue;
    const fld = ffdTerminal(L, out, w), key = fld.ref ? fld.ref.tag : uid();
    const g = groups.get(key) || groups.set(key, { fld, items: [] }).get(key); g.items.push({ m, w });
  }
  for (const { fld, items } of groups.values()) {
    // the field settings (/DA) as they were: put back when the font, size and colour were not changed
    const daOf = (d) => d.get(N('DA')) || null, da = { fd: daOf(fld.dict), wd: new Map(items.map(({ w }) => [w.dict, daOf(w.dict)])) };
    for (const { m, w } of items) {
      let was = {}; try { const a = JSON.parse(m.orig); ffdKeys.forEach((k, n) => { was[k] = a[n]; }); } catch { was = {}; }
      try { ffdWrite(L, out, fld.dict, w.dict, m, was, pages); } catch (e) { console.warn('form field', m.name, e); }
    }
    const m0 = items[0].m;
    try {
      if (m0.kind === 'radio') {
        const on = items.find((x) => x.m.val), all = ffdFieldMarks().filter((x) => x.type === 'ffx' && x.name === m0.name);
        if (items.some((x) => JSON.stringify(x.m.val ?? null) !== x.m.origVal)) {
          fld.dict.set(N('V'), N(on ? on.m.exp : 'Off'));
          for (const { m, w } of items) w.dict.set(N('AS'), N(m.val ? m.exp : 'Off'));
          void all;
        }
      } else if (items.some((x) => JSON.stringify(x.m.val ?? null) !== x.m.origVal)) ffdWriteValue(L, out, fld.dict, items.map((x) => x.w.dict), m0);
    } catch (e) { console.warn('form value', m0.name, e); }
    if (fld.ref) { try { form.markFieldAsDirty(fld.ref); } catch {} }
    const signed = fld.dict.lookup(N('V')) instanceof L.PDFDict && String(fld.dict.get(N('FT'))) === '/Sig';
    for (const { m, w } of items) ctx.ffdLooks.push({ m, wd: w.dict, fref: fld.ref, da: { fd: da.fd, wd: da.wd.get(w.dict) }, signed });
  }
}
// The settings of a field made here, once pdf-lib has made it
async function ffdApplyNew(L, out, form, m, f, ref, ctx) {
  const wref = ctx.ffRefs && ctx.ffRefs.get(m.id), wd = wref ? out.context.lookup(wref) : null; if (!wd) return;
  const fd = f ? f.acroField.dict : wd;
  ffdWrite(L, out, fd, wd, m, null, ctx.ffdPages);
  (ctx.ffdLooks = ctx.ffdLooks || []).push({ m, wd, fref: f ? f.ref : wref, isNew: true });
  if (f) { try { form.markFieldAsDirty(f.ref); } catch {} }
}
// Fields in Times or Courier, and text other than Western European, are drawn with their own font
async function ffdBeforeLooks(L, out, form, ctx) {
  const done = new Set(), fonts = {}, std = (base) => fonts[base] || (fonts[base] = out.embedFont(base));
  for (const { m, fref, isNew } of ctx.ffdLooks || []) {
    if (!fref || done.has(fref.tag) || !['text', 'date', 'combo', 'list', 'button'].includes(m.kind)) continue; done.add(fref.tag);
    const f = form.getFields().find((x) => x.ref === fref || (x.ref && x.ref.tag === fref.tag)); if (!f || !f.updateAppearances) continue;
    const text = [m.val, ...(m.opts || []), m.label].filter(Boolean).join(' '), wide = /[^\x20-\x7E\xA0-\xFF–—‘’“”•…€]/.test(text);
    let font = null;
    if (!isNew && !ffdFontChanged(m)) {
      // A field from the PDF moved, resized or given other settings, its font left as it was: drawn again in that font
      // when it is one every app has (Helvetica, Times, Courier) and the text fits it. Otherwise (a font of the PDF's
      // own, or letters those fonts lack) its look stays as it was and other apps draw it again (/NeedAppearances).
      const base = ffdOwnFont(L, out, f);
      if (base && !wide) { if (base !== 'Helvetica') font = await std(base); else continue; }
      else { try { form.markFieldAsClean(f.ref); } catch {} ffdNeedLooks(L, out); continue; }
    } else {
      if (wide && typeof fontsEmbed === 'function') { try { font = await fontsEmbed(out, { text, family: m.font === 'TiRo' ? 'serif' : m.font === 'Cour' ? 'mono' : 'sans' }); } catch (e) { console.warn('fonts', e); } }
      if (!font && wide && !isNew) { try { form.markFieldAsClean(f.ref); } catch {} ffdLookFailed(L, out, f); continue; } // its old look, not question marks
      if (!font && m.font && m.font !== 'Helv') font = await std(FFD_BASE[m.font]);
    }
    if (!font) continue;
    try { f.updateAppearances(font); } catch (e) { console.warn('field look', m.name, e); ffdLookFailed(L, out, f); }
  }
}
// Whether the field's font, size or text colour was changed here
const ffdChanged = (m, keys) => { let a = null; try { a = JSON.parse(m.orig); } catch {} return !Array.isArray(a) || keys.some((k) => JSON.stringify(m[k] ?? null) !== JSON.stringify(a[ffdKeys.indexOf(k)] ?? null)); };
const ffdLookChanged = (m) => ffdChanged(m, ['font', 'size', 'color']);
// Whether the font was changed here (a new field's is its own)
function ffdFontChanged(m) { return m.type !== 'ffx' || ffdChanged(m, ['font']); }
// The standard font (Helvetica, Times-Roman, Courier…) a field's settings (/DA) name, or null for any other font
function ffdOwnFont(L, out, f) {
  const { PDFName, PDFDict } = L, N = (k) => PDFName.of(k);
  let da = null; try { da = f.acroField.getDefaultAppearance(); } catch {}
  if (!da) { const x = out.catalog.getOrCreateAcroForm().dict.lookup(N('DA')); da = x && x.decodeText ? x.decodeText() : ''; }
  const name = (/\/([^\s/]+)\s+[-\d.]+\s+Tf/.exec(da || '') || [])[1]; if (!name) return 'Helvetica';
  const dr = out.catalog.getOrCreateAcroForm().dict.lookup(N('DR')), fonts = dr instanceof PDFDict ? dr.lookup(N('Font')) : null, fd = fonts instanceof PDFDict ? fonts.lookup(N(name)) : null;
  const stdOk = (b) => Object.values(L.StandardFonts).includes(b) && b !== 'Symbol' && b !== 'ZapfDingbats';
  if (!(fd instanceof PDFDict)) return FFD_BASE[name] || (stdOk(name) ? name : null);
  const fdesc = fd.lookup(N('FontDescriptor')), embedded = fdesc instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => fdesc.get(N(k)));
  const base = fd.get(N('BaseFont')) ? String(fd.get(N('BaseFont'))).slice(1) : '';
  return String(fd.get(N('Subtype'))) === '/Type1' && !embedded && stdOk(base) ? base : null;
}
// Other apps draw the form's fields again themselves
function ffdNeedLooks(L, out) { try { out.catalog.getOrCreateAcroForm().dict.set(L.PDFName.of('NeedAppearances'), L.PDFBool.True); } catch {} }
// A field whose look could not be made: other apps make it themselves
function ffdLookFailed(L, out) {
  ffdNeedLooks(L, out);
  if (!ffdLookFailed.told) { ffdLookFailed.told = true; setTimeout(() => { ffdLookFailed.told = false; toast('Some fields have letters these fonts cannot show. Other apps draw them in their own font.'); }, 0); }
}
// A look drawn by hand: a stream of operators in a box W × H
const ffdStream = (L, out, ops, W, H, res) => out.context.register(out.context.stream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, W, H], Matrix: [1, 0, 0, 1, 0, 0], ...(res ? { Resources: res } : {}) }));
function ffdWH(L, wd) { const r = wd.lookup(L.PDFName.of('Rect')).asArray().map((n) => n.asNumber()); return [Math.abs(r[2] - r[0]), Math.abs(r[3] - r[1])]; }
const ffdCol = (hex, op) => { const [r, g, b] = ffdRgb(hex); return `${ffdNum(r)} ${ffdNum(g)} ${ffdNum(b)} ${op}`; };
async function ffdAfterLooks(L, out, form, pages, entries, ctx) {
  const { PDFName, PDFDict, PDFArray, PDFRef } = L, c = out.context, N = (k) => PDFName.of(k);
  let zadb = null, fontsUsed = false;
  for (const { m, wd, fref, isNew, da: was, signed } of ctx.ffdLooks || []) {
    // pdf-lib names its own font in /DA when it draws a look: name the form's font again, so other apps that draw
    // the field themselves use the font and size chosen (or the field's own settings, when they were not changed)
    try {
      const fd = fref ? c.lookup(fref) : null;
      if (m.kind === 'sig') { /* no text */ } else if (!isNew && was && !ffdLookChanged(m)) {
        for (const [d, x] of fd === wd ? [[fd, was.fd]] : [[fd, was.fd], [wd, was.wd]]) if (d instanceof PDFDict) { if (x) d.set(N('DA'), x); else d.delete(N('DA')); }
      } else {
        const da = m.kind === 'check' || m.kind === 'radio' ? ffdDA({ ...m, font: 'ZaDb', size: 0 }).replace('/Helv', '/ZaDb') : ffdDA(m);
        for (const d of [fd, wd]) if (d instanceof PDFDict && d.get(N('DA'))) d.set(N('DA'), L.PDFString.of(da)); if (fd instanceof PDFDict && !fd.get(N('DA'))) fd.set(N('DA'), L.PDFString.of(da)); fontsUsed = true;
      }
    } catch (e) { console.warn('field DA', m.name, e); }
    try {
      // check box and radio button styles other than the usual tick and dot: the ZapfDingbats character
      if ((m.kind === 'check' || m.kind === 'radio') && m.style && m.style !== (m.kind === 'check' ? 'check' : 'circle') && !(m.rot % 180)) {
        zadb ||= await out.embedFont(L.StandardFonts.ZapfDingbats);
        const [W, H] = ffdWH(L, wd), bw = m.bw ?? 1, ch = FFD_STYLES[m.style][0], round = m.kind === 'radio';
        const ap = wd.lookup(N('AP')), nd = ap instanceof PDFDict ? ap.lookup(N('N')) : null;
        const on = (nd instanceof PDFDict && nd.keys().map((x) => x.decodeText()).find((x) => x !== 'Off')) || (ctx.ffExpOf && ctx.ffExpOf.get(m.id)) || m.exp || 'Yes';
        const k = .5523, rx = W / 2, ry = H / 2, ell = (a, b, cx, cy) => `${cx + a} ${cy} m ${cx + a} ${cy + b * k} ${cx + a * k} ${cy + b} ${cx} ${cy + b} c ${cx - a * k} ${cy + b} ${cx - a} ${cy + b * k} ${cx - a} ${cy} c ${cx - a} ${cy - b * k} ${cx - a * k} ${cy - b} ${cx} ${cy - b} c ${cx + a * k} ${cy - b} ${cx + a} ${cy - b * k} ${cx + a} ${cy} c`;
        const shape = round ? ell(rx - bw / 2, ry - bw / 2, rx, ry) : `${bw / 2} ${bw / 2} ${W - bw} ${H - bw} re`;
        const frame = (m.bg ? `${ffdCol(m.bg, 'rg')} ${shape} f ` : '') + (m.bc !== '' && bw ? `${ffdCol(m.bc || '#000000', 'RG')} ${bw} w ${shape} S ` : '');
        const size = Math.min(W, H) * .72, uni = { check: '✔', circle: '●', cross: '✘', diamond: '◆', square: '■', star: '★' }[m.style];
        let gw = size * .8; try { gw = zadb.widthOfTextAtSize(uni, size); } catch {}
        const mark = `q BT /ZaDb ${ffdNum(size)} Tf ${ffdCol(m.color || '#000000', 'rg')} ${ffdNum((W - gw) / 2)} ${ffdNum((H - size * .7) / 2)} Td (${ch}) Tj ET Q`;
        const res = c.obj({ Font: { ZaDb: zadb.ref } });
        const onRef = ffdStream(L, out, frame + mark, W, H, res), offRef = ffdStream(L, out, frame || ' ', W, H, null);
        wd.set(N('AP'), c.obj({ N: { [on]: onRef, Off: offRef } }));
        let mk = wd.lookup(N('MK')); if (!(mk instanceof PDFDict)) { mk = c.obj({}); wd.set(N('MK'), mk); } mk.set(N('CA'), L.PDFString.of(ch));
      }
      // a signature field's picture: its look (/AP /N), the field still unsigned
      if (m.kind === 'sig' && m.pic && !signed) { // (never over a digital signature)
        const [W, H] = ffdWH(L, wd), im = await out.embedPng(m.pic.data), s = Math.min(W / m.pic.w, H / m.pic.h) * .94, w = m.pic.w * s, h = m.pic.h * s;
        const res = c.obj({ XObject: { Im0: im.ref } });
        wd.set(N('AP'), c.obj({ N: ffdStream(L, out, `q ${ffdNum(w)} 0 0 ${ffdNum(h)} ${ffdNum((W - w) / 2)} ${ffdNum((H - h) / 2)} cm /Im0 Do Q`, W, H, res) }));
      }
    } catch (e) { console.warn('field look', m.name, e); }
  }
  if (fontsUsed) ffdResources(L, out);
  // tab order: each page's /Tabs, and its widgets in that order in /Annots
  const t = ffdTabMark();
  if (t) entries.forEach((entry, n) => {
    const conf = t.pages[pageKey(entry)], p = pages[n]; if (!conf || !p || !conf.tabs) return;
    p.node.set(N('Tabs'), N(conf.tabs));
    const annots = p.node.lookup(N('Annots')); if (!(annots instanceof PDFArray)) return;
    const want = [];
    const order = conf.tabs === 'S' && conf.order ? conf.order : ffdTabOrder(entry).items.map((x) => x.key);
    for (const k of order) {
      let r = null;
      if (k.startsWith('m:')) r = ctx.ffRefs && ctx.ffRefs.get(k.slice(2));
      else { const w = ffdFindWidget(L, out, p, { ref: k.slice(2), name: '', orig: '[]' }); r = w && w.ref; }
      if (r && !want.some((x) => x.tag === r.tag)) want.push(r);
    }
    const items = annots.asArray(), tags = new Set(want.map((r) => r.tag)), slots = [];
    items.forEach((x, i) => { if (x instanceof PDFRef && tags.has(x.tag)) slots.push(i); });
    const present = want.filter((r) => items.some((x) => x instanceof PDFRef && x.tag === r.tag));
    slots.forEach((i, j) => annots.set(i, present[j]));
  });
  // calculation order (/CO): the order set, then the PDF's own, then any other field with a calculation
  try {
    const afd = out.catalog.lookup(N('AcroForm')); if (!(afd instanceof PDFDict)) return;
    const calc = form.getFields().filter((f) => { const aa = f.acroField.dict.lookup(N('AA')); return aa instanceof PDFDict && aa.get(N('C')); }).map((f) => f.ref);
    const co = docMarks().find((x) => x.type === 'ffco'), order = [];
    const fieldOf = (r) => { const d = c.lookup(r); if (!(d instanceof PDFDict)) return null; if (d.get(N('T'))) return r; const pr = d.get(N('Parent')); return pr instanceof PDFRef ? pr : r; };
    if (co) for (const k of co.order) {
      const r = k.startsWith('m:') ? (ctx.ffRefs && ctx.ffRefs.get(k.slice(2)) ? fieldOf(ctx.ffRefs.get(k.slice(2))) : null) : (form.getFieldMaybe(ffShown(k.slice(2))) || {}).ref;
      if (r) order.push(r);
    }
    const old = afd.lookup(N('CO')); if (old instanceof PDFArray) for (const r of old.asArray()) if (r instanceof PDFRef) order.push(r);
    order.push(...calc);
    const seen = new Set(), list = order.filter((r) => r && calc.some((x) => x.tag === r.tag) && !seen.has(r.tag) && seen.add(r.tag));
    if (list.length) afd.set(N('CO'), c.obj(list)); else afd.delete(N('CO'));
  } catch (e) { console.warn('calculation order', e); }
}
// A field of the saved form, by its name now (a field from the PDF may have been renamed)
const ffdFieldNamed = (form, name) => form.getFieldMaybe(ffShown(name)) || form.getFieldMaybe(name) || null;

/* ---- form data and comments as files (XFDF, FDF): for review without a cloud service ---- */
const FFD_XFDF_NS = 'http://ns.adobe.com/xfdf/';
// Every field's value, by its full name ("Address.City"), as other apps export it: a check box's export value or Off
function ffdValues() {
  const out = new Map();
  for (const [n, f] of ffdFields()) { if (f.kind === 'button' || f.kind === 'sig') continue; let v = f.get(); if (f.kind === 'radio' && v == null) v = 'Off'; out.set(n, v); }
  return out;
}
function ffdXfdfFields(values) {
  // names with dots are nested <field> elements
  const root = { kids: new Map() };
  for (const [name, v] of values) { let node = root; for (const part of name.split('.')) { if (!node.kids.has(part)) node.kids.set(part, { kids: new Map() }); node = node.kids.get(part); } node.value = v; }
  const write = (node, depth) => [...node.kids].map(([k, n]) => `${'  '.repeat(depth)}<field name="${esc(k)}">${n.value !== undefined ? (Array.isArray(n.value) ? n.value : [n.value]).map((x) => `<value>${esc(x)}</value>`).join('') : ''}${n.kids.size ? '\n' + write(n, depth + 1) + '\n' + '  '.repeat(depth) : ''}</field>`).join('\n');
  return write(root, 1);
}
function ffdExportFieldsXml() {
  const values = ffdValues();
  return { n: values.size, xml: `<?xml version="1.0" encoding="UTF-8"?>\n<xfdf xmlns="${FFD_XFDF_NS}" xml:space="preserve">\n<?cowdrey-pages ${doc.pages.length}?>\n<fields>\n${ffdXfdfFields(values)}\n</fields>\n<f href="${esc(doc.name)}.pdf"/>\n</xfdf>\n` };
}
async function ffdExportFields() {
  const { n, xml } = ffdExportFieldsXml();
  if (!n) { toast('This PDF has no fields to export'); return; }
  ffdExportFields.last = xml;
  const done = await saveFile(xml, `${doc.name} form data.xfdf`, 'application/vnd.adobe.xfdf');
  if (done && !MAC_APP) toast(`${n} field value${n === 1 ? '' : 's'} exported`);
}
// Values from XFDF (<fields>) or FDF (/Fields): a Map of full name to value (a list for a list box)
function ffdParseXfdfFields(xml) {
  const d = new DOMParser().parseFromString(xml, 'application/xml');
  if (d.querySelector('parsererror') || !d.documentElement || d.documentElement.localName !== 'xfdf') return null;
  const out = new Map(), kids = (e, n) => [...e.children].filter((c) => c.localName === n);
  const walk = (e, prefix) => {
    for (const f of kids(e, 'field')) {
      const name = prefix + (f.getAttribute('name') || ''), vs = kids(f, 'value').map((v) => v.textContent), rich = kids(f, 'value-richtext');
      if (vs.length) out.set(name, vs.length > 1 ? vs : vs[0]); else if (rich.length) out.set(name, rich[0].textContent.trim());
      walk(f, name + '.');
    }
  };
  for (const fs of kids(d.documentElement, 'fields')) walk(fs, '');
  const pi = [...d.childNodes, ...d.documentElement.childNodes].find((x) => x.nodeType === 7 && x.target === 'cowdrey-pages');
  out.pages = pi ? parseInt(pi.data, 10) : null;
  return out;
}
// FDF is PDF syntax: read its strings, names, arrays and dictionaries, enough for /Fields [<< /T /V /Kids >>]
function ffdParseFdf(bytes) {
  const s = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  if (!/%FDF-/.test(s.slice(0, 1024))) return null;
  let k = s.indexOf('/Fields'); if (k < 0) return new Map();
  k += 7;
  const dec = (b) => { if (b.charCodeAt(0) === 0xFE && b.charCodeAt(1) === 0xFF) { let o = ''; for (let i = 2; i + 1 < b.length; i += 2) o += String.fromCharCode(b.charCodeAt(i) << 8 | b.charCodeAt(i + 1)); return o; } if (b.startsWith('\xEF\xBB\xBF')) { try { return new TextDecoder().decode(Uint8Array.from(b.slice(3), (c) => c.charCodeAt(0))); } catch {} } return b; };
  const ws = () => { while (k < s.length) { if (/\s/.test(s[k])) k++; else if (s[k] === '%') { while (k < s.length && s[k] !== '\n' && s[k] !== '\r') k++; } else break; } };
  const value = () => {
    ws(); const c = s[k];
    if (c === '(') {
      let depth = 1, o = ''; k++;
      while (k < s.length && depth) {
        const ch = s[k++];
        if (ch === '\\') { const n = s[k++]; if (/[0-7]/.test(n)) { let oct = n; while (oct.length < 3 && /[0-7]/.test(s[k])) oct += s[k++]; o += String.fromCharCode(parseInt(oct, 8)); } else if (n === '\r') { if (s[k] === '\n') k++; } else if (n !== '\n') o += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n] ?? n; }
        else if (ch === '(') { depth++; o += ch; } else if (ch === ')') { if (--depth) o += ch; } else o += ch;
      }
      return { str: dec(o) };
    }
    if (c === '<' && s[k + 1] === '<') {
      k += 2; const d = {};
      for (;;) { ws(); if (s[k] === '>' && s[k + 1] === '>') { k += 2; return { dict: d }; } if (s[k] !== '/') { k++; if (k >= s.length) return { dict: d }; continue; } const key = value().name; d[key] = value(); }
    }
    if (c === '<') { const e = s.indexOf('>', k); const hex = s.slice(k + 1, e).replace(/\s/g, ''); k = e + 1; let o = ''; for (let i = 0; i < hex.length; i += 2) o += String.fromCharCode(parseInt((hex.slice(i, i + 2) + '0').slice(0, 2), 16)); return { str: dec(o) }; }
    if (c === '[') { k++; const a = []; for (;;) { ws(); if (s[k] === ']' || k >= s.length) { k++; return { arr: a }; } a.push(value()); } }
    if (c === '/') { k++; let n = ''; while (k < s.length && !/[\s/[\]()<>{}%]/.test(s[k])) n += s[k++]; return { name: n.replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))) }; }
    let t = ''; while (k < s.length && !/[\s/[\]()<>{}%]/.test(s[k])) t += s[k++];
    if (/^\d+$/.test(t)) { const save = k; ws(); let g = ''; while (/\d/.test(s[k] || '')) g += s[k++]; ws(); if (g && s[k] === 'R') { k++; return { ref: t }; } k = save; }
    return { raw: t };
  };
  const fields = value(), out = new Map();
  const text = (v) => (v ? v.str ?? v.name ?? v.raw ?? '' : '');
  const walk = (arr, prefix) => {
    for (const it of (arr && arr.arr) || []) {
      const d = it.dict; if (!d) continue;
      const name = prefix + (d.T ? text(d.T) : '');
      if (d.V) out.set(name, d.V.arr ? d.V.arr.map(text) : text(d.V));
      if (d.Kids) walk(d.Kids, name + '.');
    }
  };
  walk(fields, '');
  out.pages = null;
  return out;
}
// Puts the values into the fields with those names. Returns how many fields took one (-1: not a form data file).
function ffdImportValues(values) {
  if (!values) return -1;
  const F = ffdFields(), before = snapshot();
  let n = 0;
  for (const [name, v] of values) { const f = F.get(name); if (!f) continue; f.set(f.kind === 'list' ? (Array.isArray(v) ? v : [v]) : Array.isArray(v) ? v[0] : v); n++; }
  ffdRecalc();
  if (snapshot() !== before) changed(before, 'Import form data'); else if (n) setSaved(false);
  for (const v of views) if (v.rendered) { drawMarks(v); rerenderView(v); }
  return n;
}
async function ffdImportFieldsFrom(text, name = '') {
  const values = /^\s*%FDF-/.test(text) ? ffdParseFdf(text) : ffdParseXfdfFields(text);
  if (!values) return -1;
  if (values.pages && values.pages !== doc.pages.length && !(await ffdPagesDiffer(values.pages, 'form data'))) return 0;
  void name;
  return ffdImportValues(values);
}
async function ffdPagesDiffer(n, what) {
  const a = await dialog('Different number of pages', `<p>This ${what} file was made from a PDF with ${n} page${n === 1 ? '' : 's'}; this one has ${doc.pages.length}. It may be for another PDF. Import it anyway?</p>`, [{ label: 'Cancel' }, { label: 'Import', value: 'go', primary: true }]);
  return a === 'go';
}
// Comments: the Comment tab's own XFDF export and import (the comments are its marks), with the page count checked
async function ffdExportComments() {
  if (typeof cmExportXfdf !== 'function') { toast('Comments can not be exported'); return; }
  await cmExportXfdf();
}
async function ffdImportCommentsFrom(text) {
  if (typeof cmImportXfdf !== 'function') return -1;
  const d = new DOMParser().parseFromString(text, 'application/xml');
  if (d.querySelector('parsererror') || !d.documentElement || d.documentElement.localName !== 'xfdf') return -1;
  const pages = [...d.querySelectorAll('[page]')].map((e) => +e.getAttribute('page')).filter((x) => x >= 0);
  const top = pages.length ? Math.max(...pages) + 1 : 0;
  if (top > doc.pages.length && !(await ffdPagesDiffer(top, 'comments'))) return 0;
  const n = await cmImportXfdf(text);
  // the same file may carry form data too
  const values = ffdParseXfdfFields(text); if (values && values.size) ffdImportValues(values);
  return n;
}
const ffdFileInput = (id, accept, fn) => {
  const inp = Object.assign(document.createElement('input'), { type: 'file', accept, hidden: true, id });
  document.body.appendChild(inp);
  inp.addEventListener('change', async () => { const f = inp.files[0]; inp.value = ''; if (!f || !doc) return; await fn(await f.text(), f.name); });
  return inp;
};
const ffdDataInput = ffdFileInput('ffdDataFile', '.xfdf,.fdf,.xml,application/vnd.adobe.xfdf,application/vnd.fdf', async (text, name) => {
  const n = await ffdImportFieldsFrom(text, name);
  toast(n < 0 ? `${name} is not a form data file (XFDF or FDF)` : n ? `${n} field${n === 1 ? '' : 's'} filled in` : 'No fields with those names');
});
const ffdCommentsInput = ffdFileInput('ffdCommentsFile', '.xfdf,.xml,application/vnd.adobe.xfdf', async (text, name) => {
  const n = await ffdImportCommentsFrom(text);
  toast(n < 0 ? `${name} is not a comments file (XFDF)` : n ? `${n} comment${n === 1 ? '' : 's'} imported` : 'No new comments to import');
});

/* ---- commands, ribbon, menu ---- */
const ffdInDesign = () => has() && ffDesign();
cmd('ffd_align', { label: 'Align', rlabel: 'Align', icon: 'align-start-vertical', enabled: has, menu: ['ffd_left', 'ffd_right', 'ffd_top', 'ffd_bottom', 'ffd_centerH', 'ffd_centerV'], run: () => ffdLayout(FFD_ALIGN.left[2], 'Align left') });
cmd('ffd_distribute', { label: 'Distribute', icon: 'align-vertical-distribute-center', enabled: has, menu: ['ffd_distV', 'ffd_distH'], run: () => ffdLayout(FFD_DIST.distV[2], 'Distribute') });
cmd('ffd_match', { label: 'Match size', icon: 'maximize', enabled: has, menu: ['ffd_matchW', 'ffd_matchH', 'ffd_matchB'], run: () => ffdLayout((bs) => { const a = ffdAnchor(bs).b; for (const q of bs) { const [x0, , , y1] = q.b; q.m.x1 = x0; q.m.x2 = x0 + a[2] - a[0]; q.m.y2 = y1; q.m.y1 = y1 - (a[3] - a[1]); } }, 'Match size') });
cmd('ffd_dup', { label: 'Duplicate', icon: 'copy-plus', enabled: () => has() && ffdSelCount() > 0, run: ffdDuplicate });
cmd('ffd_copyPages', { label: 'Copy to pages…', rlabel: 'Copy to pages', icon: 'files', enabled: () => has() && ffdSelCount() > 0 && doc.pages.length > 1, run: ffdCopyToPages });
cmd('ffd_grid', { label: 'Place multiple fields…', rlabel: 'Place multiple', icon: 'grid-3x3', enabled: () => has() && ffdSelCount() === 1, run: ffdPlaceGrid });
cmd('ffd_snap', { label: 'Snap to grid', icon: 'grid-2x2-check', enabled: has, pressed: () => !!S.ffdSnap, run: () => { S.ffdSnap = !S.ffdSnap; saveSettings(); refreshRibbon(); toast(S.ffdSnap ? 'Fields snap to a 4 pt grid as you drag them' : 'Snap to grid off'); } });
cmd('ffd_panel', { label: 'Fields and tab order', rlabel: 'Tab order', icon: 'list-ordered', enabled: has, menu: ['ffd_panel', 'ffd_nums'], pressed: () => !!$('#ffdPanel'), run: () => { if (!$('#ffdPanel') && !ffDesign()) setTool('ff_edit'); ffdWidgets().then(() => ffdPanelOpen()); } });
cmd('ffd_nums', { label: 'Show tab numbers', icon: 'hash', enabled: has, pressed: () => !!S.ffdNums, run: () => { S.ffdNums = !S.ffdNums; saveSettings(); if (S.ffdNums && !ffDesign()) setTool('ff_edit'); views.forEach((v) => v.rendered && ffdOverlay(v)); ffdPanelDraw(); refreshRibbon(); } });
cmd('ffd_calcOrder', { label: 'Calculation order…', rlabel: 'Calculation order', icon: 'list-checks', enabled: has, run: ffdCalcOrderDlg });
cmd('ffd_prepSign', { label: 'Prepare for signing…', rlabel: 'Prepare for signing', icon: 'pen-line', enabled: has, run: ffdPrepareSigning });
cmd('ffd_exportData', { label: 'Export form data…', icon: 'file-up', enabled: has, run: ffdExportFields });
cmd('ffd_importData', { label: 'Import form data…', icon: 'file-down', enabled: has, run: () => ffdDataInput.click() });
cmd('ffd_exportComments', { label: 'Export comments (XFDF)…', icon: 'message-square-share', enabled: has, run: ffdExportComments });
cmd('ffd_importComments', { label: 'Import comments…', icon: 'message-square-plus', enabled: has, run: () => ffdCommentsInput.click() });
cmd('ffd_data', { label: 'Form data', rlabel: 'Data', icon: 'file-input', enabled: has, menu: ['ffd_exportData', 'ffd_importData', 'ffd_exportComments', 'ffd_importComments'] });
void ffdInDesign;
ribbonAdd('forms', 'Fields', ['ffd_panel']);
ribbonAdd('forms', 'Layout', ['ffd_align', 'ffd_distribute', 'ffd_match', 'ffd_dup', 'ffd_copyPages', 'ffd_grid', 'ffd_snap'], 'Form', 'rows');
ribbonAdd('forms', 'Form', ['ffd_calcOrder', 'ffd_prepSign', 'ffd_data']);
menuAdd('Forms', ['ffd_panel', 'ffd_nums', 'ffd_calcOrder', 'ffd_prepSign']);
menuAdd('Forms', ['ffd_left', 'ffd_right', 'ffd_top', 'ffd_bottom', 'ffd_centerH', 'ffd_centerV', 'ffd_distH', 'ffd_distV', 'ffd_matchW', 'ffd_matchH', 'ffd_matchB', 'ffd_dup', 'ffd_copyPages', 'ffd_grid', 'ffd_snap']);
menuAdd('Forms', ['ffd_exportData', 'ffd_importData', 'ffd_exportComments', 'ffd_importComments']);
Object.assign(TEST_HOOKS, {
  ffdExportFields: () => ffdExportFieldsXml().xml,
  ffdImportFields: (text) => ffdImportFieldsFrom(text),
  ffdImportComments: (text) => ffdImportCommentsFrom(text),
  ffdValues: () => Object.fromEntries(ffdValues()),
  ffdSelect: (ids) => { const ms = ids.map((id) => ffFind(id)).filter(Boolean).map((f) => f.m); ffdSetSel(ms); return ms.length; },
  ffdSelected: () => ffdSelected().map((m) => m.id),
  ffdTabKeys: (n) => ffdTabOrder(doc.pages[n]).items.map((x) => [x.key, x.name]),
  ffdFields: () => [...ffdFields()].map(([n, f]) => [n, f.kind, f.get()]),
  ffdOnSig: (fn) => { FEATURE.onSigField = fn; },
  ffdAF: () => {
    const sfn = ffdCalcJs({ t: 'sfn', sfn: 'Price * Qty - Discount' }), range = ffdValidateJs({ t: 'range', min: 0, max: 100 });
    return {
      num: ffdFormat('-1234.5', { t: 'number', dec: 2, sep: 2, neg: 0, cur: ' €', pre: false }), paren: ffdFormat('-1234.5', { t: 'number', dec: 2, sep: 0, neg: 2, cur: '$', pre: true }),
      pct: ffdFormat('0.125', { t: 'percent', dec: 1, sep: 0 }), zip4: ffdFormat('123456789', { t: 'special', sp: 1 }), phone: ffdFormat('5551234567', { t: 'special', sp: 2 }), time: ffdFormat('14:05', { t: 'time', tm: 1 }),
      parsed: ['AFNumber_Format(2, 2, 0, 0, "€", false);', 'AFPercent_Format(1, 0);', 'AFSpecial_Format(3);', 'AFTime_Format(1);', 'AFDate_FormatEx("dd/mm/yyyy");'].map((x) => ffdParseFormat(x)),
      range: [range, ffdParseValidate(range)],
      sfn: [sfn, ffdParseCalc(sfn), ffdSfnEval(ffdSfnParse('Price * Qty - Discount'), (n) => ({ Price: 5, Qty: 4, Discount: 3 })[n])],
      simple: ffdParseCalc('AFSimple_Calculate("AVG", new Array ("a.b", "c"));'),
    };
  },
});

addStyle(`
.page .annotationLayer .ffd-hidden { display: none !important; }
.ffd-layer { position: absolute; inset: 0; z-index: 6; overflow: visible; pointer-events: none; width: 100%; height: 100%; }
.ffd-layer .ffd-sighit { fill: rgba(0, 54, 255, .10); stroke: #2448C9; stroke-width: 1; stroke-dasharray: 4 2; pointer-events: auto; cursor: pointer; }
.ffd-layer .ffd-sighit:hover { fill: rgba(0, 54, 255, .2); }
.app:not([data-tool="select"]) .ffd-layer .ffd-sighit { pointer-events: none; }
.ffd-layer .ffd-band { fill: rgba(174, 23, 71, .08); stroke: #AE1747; stroke-width: 1; stroke-dasharray: 4 2; }
.ffd-layer .ffd-num rect { fill: #2448C9; }
.ffd-layer .ffd-num text { fill: #fff; font: 700 10px/1 var(--font-ui); }
.marks .ffd-msel { fill: none; stroke: #AE1747; stroke-width: 1.5; stroke-dasharray: 3 2; pointer-events: none; }
.ff-fill-layer .ff-ctl-sig { cursor: pointer; color: #2448C9; font-family: var(--font-ui); text-align: left; padding: 0 6px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.ff-fill-layer .ff-ctl-sig img { max-width: 100%; max-height: 100%; }
.ffd-props .ffd-tabs { display: flex; flex-wrap: wrap; gap: 2px; margin: 0 0 8px; }
.ffd-props .ffd-tabs button { flex: 1 1 auto; font-size: 12px; padding: 6px 8px; }
.ffd-props .ffd-panel { min-height: 120px; align-content: start; }
.ffd-props .ffd-when[hidden], .ffd-props .ffd-panel[hidden] { display: none; }
.ffd-props .ffd-when > .ff-props { gap: 0 12px; }
.ffd-props textarea { font: 12px/1.4 ui-monospace, Menlo, Consolas, monospace; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 8px; padding: 6px 8px; resize: vertical; box-sizing: border-box; }
.ffd-props .ffd-color-row { display: flex; align-items: center; gap: 10px; min-height: 34px; }
.ffd-props .ffd-color-row input[type="color"] { width: 44px; height: 30px; padding: 0; border: 1px solid var(--line); border-radius: 6px; background: none; }
.ffd-picks { display: flex; flex-wrap: wrap; gap: 4px 14px; max-height: 120px; overflow: auto; padding: 4px 0; }
.ffd-note { font-size: 12px; color: var(--ink-3); margin: 4px 0; }
.ffd-signote { margin: 0 0 8px; padding: 6px 10px; border-radius: 8px; background: var(--accent-soft); color: var(--ink); font-size: 13px; }
.ffd-panel-side { position: fixed; right: 12px; width: 272px; max-width: calc(100vw - 32px); z-index: 30; overflow: auto; padding: 8px 10px 12px; box-sizing: border-box;
  background: var(--surface); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
.ffd-ph { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.ffd-pnum { margin: 2px 0 4px; font-size: 13px; }
.ffd-pg { margin-top: 10px; }
.ffd-pg-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 4px; }
.ffd-pg-head select { font: inherit; font-weight: 400; color: var(--ink); background: var(--chrome); border: 1px solid var(--line); border-radius: 7px; padding: 3px 6px; height: 28px; }
.ffd-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ffd-list li { display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 6px; border-radius: 8px; cursor: grab; }
.ffd-list li:hover, .ffd-list li:focus-visible { background: var(--hover); }
.ffd-list li.dragging { opacity: .5; }
.ffd-n { flex: none; min-width: 20px; height: 20px; border-radius: 10px; background: #2448C9; color: #fff; font: 700 11px/20px var(--font-ui); text-align: center; padding: 0 3px; box-sizing: border-box; }
.ffd-nm { flex: 1; min-width: 0; display: flex; flex-direction: column; font-size: 13px; overflow-wrap: anywhere; }
.ffd-nm small { font-size: 11px; color: var(--ink-3); }
.ffd-mv { display: flex; flex: none; }
.ffd-mv .icon-btn { width: 26px; height: 26px; }
.ffd-mv .icon-btn svg { width: 14px; height: 14px; }
#ffdCo { margin: 8px 0 0; }
@media (max-width: 520px) { .ffd-panel-side { left: 16px; right: 16px; width: auto; max-width: none; } }
`);
