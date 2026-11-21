#!/usr/bin/env python3
"""A rule check for PDF/X-1a:2003, PDF/X-3:2003 and PDF/X-4 files, independent of the app's own code.

veraPDF validates PDF/A and PDF/UA, not PDF/X, and no free certified PDF/X validator is available here, so
tests/conformance/pkg3.mjs runs this instead. It checks the key requirements of ISO 15930-4 (X-1a:2003),
ISO 15930-6 (X-3:2003) and ISO 15930-7 (X-4) that can be checked by reading the file. It is not a certified
validator (it does not, for example, check every ICC profile tag or the colour of every overprint).

python3 -I tests/conformance/pdfx_check.py <1a|3|4> file.pdf  ->  JSON { "ok": bool, "failed": [...], "passed": [...] }
"""
import json, re, struct, sys

import pikepdf
from pikepdf import Name, Dictionary, Array, Stream

VERSION = {'1a': 'PDF/X-1a:2003', '3': 'PDF/X-3:2003', '4': 'PDF/X-4'}
MAX_PDF = {'1a': 4, '3': 4, '4': 6}
BAD_ACTIONS = {'/JavaScript', '/Launch', '/Sound', '/Movie', '/ResetForm', '/ImportData', '/Hide', '/SetOCGState', '/Rendition', '/Trans', '/GoTo3DView'}


def main(kind, path):
    failed, passed = [], []
    raw = open(path, 'rb').read()

    def rule(name, problems):
        (failed if problems else passed).append({'rule': name, 'problems': problems[:6]} if problems else name)

    pdf = pikepdf.open(path)
    m = re.match(rb'%PDF-1\.(\d)', raw)
    rule('ISO 15930 header: PDF version', [] if m and int(m.group(1)) <= MAX_PDF[kind] else ['header says %r, at most 1.%d allowed' % (raw[:8], MAX_PDF[kind])])
    rule('no encryption', ['the file is encrypted'] if '/Encrypt' in pdf.trailer else [])
    rule('trailer ID', [] if '/ID' in pdf.trailer and len(pdf.trailer.ID) == 2 else ['no /ID in the trailer'])
    if MAX_PDF[kind] <= 4:
        p = []
        if b'/ObjStm' in raw: p.append('object streams (PDF 1.5) used')
        sx = re.findall(rb'startxref\s+(\d+)', raw[-2048:])
        if sx and not raw[int(sx[-1]):int(sx[-1]) + 8].lstrip().startswith(b'xref'): p.append('cross-reference stream (PDF 1.5) used')
        rule('PDF 1.4 file structure (no object or xref streams)', p)
    info = pdf.trailer.get('/Info', Dictionary())
    txt = lambda k: str(info[k]) if k in info else None
    rule('Info /GTS_PDFXVersion', [] if txt('/GTS_PDFXVersion') == VERSION[kind] else ['GTS_PDFXVersion is %r, not %r' % (txt('/GTS_PDFXVersion'), VERSION[kind])])
    rule('Info /Trapped True or False', [] if str(info.get('/Trapped', '')) in ('/True', '/False') else ['Trapped is %r' % str(info.get('/Trapped'))])
    rule('Info /Title', [] if txt('/Title') else ['no Title'])
    rule('Info dates', [k + ' missing' for k in ('/CreationDate', '/ModDate') if not txt(k)])

    # output intent
    p, icc = [], None
    ois = [o for o in pdf.Root.get('/OutputIntents', Array()) if o.get('/S') == Name('/GTS_PDFX')]
    if len(ois) != 1: p.append('%d GTS_PDFX output intents' % len(ois))
    else:
        oi = ois[0]
        if not str(oi.get('/OutputConditionIdentifier', '')): p.append('no OutputConditionIdentifier')
        dp = oi.get('/DestOutputProfile')
        if not isinstance(dp, Stream): p.append('no DestOutputProfile')
        else:
            b = dp.read_bytes()
            icc = {'version': b[8], 'class': b[12:16], 'space': b[16:20], 'magic': b[36:40]}
            if icc['magic'] != b'acsp': p.append('DestOutputProfile is not an ICC profile')
            if icc['class'] != b'prtr': p.append('DestOutputProfile is not an output profile (%r)' % icc['class'])
            if kind == '1a' and icc['space'] != b'CMYK': p.append('X-1a needs a CMYK destination profile')
            if MAX_PDF[kind] <= 4 and icc['version'] > 2: p.append('ICC version %d profile in a PDF 1.4 kind' % icc['version'])
            n = {b'CMYK': 4, b'RGB ': 3, b'GRAY': 1}.get(icc['space'])
            if int(dp.get('/N', 0)) != n: p.append('DestOutputProfile /N is %s' % dp.get('/N'))
    rule('OutputIntent GTS_PDFX with DestOutputProfile', p)

    # boxes
    p = []
    for i, page in enumerate(pdf.pages):
        box = lambda k: [float(x) for x in page.obj[k]] if k in page.obj else None
        norm = lambda b: b and [min(b[0], b[2]), min(b[1], b[3]), max(b[0], b[2]), max(b[1], b[3])]
        inside = lambda a, b: a[0] >= b[0] - .01 and a[1] >= b[1] - .01 and a[2] <= b[2] + .01 and a[3] <= b[3] + .01
        media = norm(box('/MediaBox') or [float(x) for x in page.mediabox])
        trim, art, bleed = norm(box('/TrimBox')), norm(box('/ArtBox')), norm(box('/BleedBox'))
        if not trim and not art: p.append('page %d: no TrimBox or ArtBox' % (i + 1))
        if trim and art: p.append('page %d: both TrimBox and ArtBox' % (i + 1))
        if bleed and not inside(bleed, media): p.append('page %d: BleedBox outside MediaBox' % (i + 1))
        if (trim or art) and not inside(trim or art, bleed or media): p.append('page %d: TrimBox outside BleedBox/MediaBox' % (i + 1))
    rule('TrimBox / BleedBox / MediaBox', p)

    # content: fonts, colour, transparency, bit depth
    use = {'rgb': [], 'icc': [], 'cie': [], 'cmyk': [], 'alpha': [], 'bits16': [], 'jpx': [], 'fonts': [], 'tr': [], 'spot_alt': []}
    seen = set()

    def cs_use(cs, res, where, depth=0):
        if depth > 8 or cs is None: return
        if isinstance(cs, Name):
            n = {'/RGB': '/DeviceRGB', '/G': '/DeviceGray', '/CMYK': '/DeviceCMYK', '/I': '/Indexed'}.get(str(cs), str(cs))
            dev = {'/DeviceRGB': 'RGB', '/DeviceCMYK': 'CMYK', '/DeviceGray': 'Gray'}.get(n)
            csd = res.get('/ColorSpace') if res is not None else None
            if dev:
                if csd is not None and ('/Default' + dev) in csd and depth == 0: cs_use(csd['/Default' + dev], None, where, depth + 1)
                elif dev == 'RGB': use['rgb'].append(where)
                elif dev == 'CMYK': use['cmyk'].append(where)
                return
            if n in ('/Pattern', '/Indexed'): return
            if csd is not None and n in csd: cs_use(csd[n], res, where, depth + 1)
            return
        if isinstance(cs, Array) and len(cs):
            fam = str(cs[0])
            if fam == '/ICCBased': use['icc'].append(where)
            elif fam in ('/CalRGB', '/CalGray', '/Lab'): use['cie'].append(where)
            elif fam in ('/Indexed', '/I'): cs_use(cs[1], res, where, depth + 1)
            elif fam == '/Pattern' and len(cs) > 1: cs_use(cs[1], res, where, depth + 1)
            elif fam in ('/Separation', '/DeviceN'):
                alt = cs[2]
                if kind == '1a' and not (isinstance(alt, Name) and str(alt) in ('/DeviceCMYK', '/DeviceGray')): use['spot_alt'].append(where)
                cs_use(alt, res, where, depth + 1)

    def gs_use(g, where):
        if not isinstance(g, Dictionary): return
        if float(g.get('/CA', 1)) < 1 or float(g.get('/ca', 1)) < 1: use['alpha'].append(where + ' (CA/ca)')
        if '/SMask' in g and g.SMask != Name('/None'): use['alpha'].append(where + ' (SMask)')
        bm = g.get('/BM')
        if bm is not None:
            bmn = str(bm[0]) if isinstance(bm, Array) else str(bm)
            if bmn not in ('/Normal', '/Compatible'): use['alpha'].append(where + ' (blend mode)')
        if '/TR' in g or ('/TR2' in g and g.TR2 != Name('/Default')): use['tr'].append(where)

    def image(x, res, where):
        if not x.get('/ImageMask', False):
            cs_use(x.get('/ColorSpace'), res, where)
            if int(x.get('/BitsPerComponent', 8)) > 8: use['bits16'].append(where)
        f = x.get('/Filter')
        fl = [str(f)] if isinstance(f, Name) else [str(v) for v in f] if isinstance(f, Array) else []
        if '/JPXDecode' in fl: use['jpx'].append(where)
        if isinstance(x.get('/SMask'), Stream) or int(x.get('/SMaskInData', 0)) > 0: use['alpha'].append(where + ' (soft-masked image)')

    def fonts_of(res, where):
        if res is None or '/Font' not in res: return
        for k, f in res.Font.items():
            sub = str(f.get('/Subtype'))
            if sub == '/Type3':
                fonts_of(f.get('/Resources'), where); continue
            fd = f.get('/FontDescriptor')
            if sub == '/Type0': fd = f.DescendantFonts[0].get('/FontDescriptor')
            if fd is None or not any(k2 in fd for k2 in ('/FontFile', '/FontFile2', '/FontFile3')): use['fonts'].append('%s: %s' % (where, f.get('/BaseFont')))

    def scan(obj, res, where, depth=0):
        if depth > 12: return
        key = (obj.objgen, id(res)) if obj.objgen != (0, 0) else None
        if key in seen: return
        if key: seen.add(key)
        fonts_of(res, where)
        if res is not None and '/ExtGState' in res:
            for _, g in res.ExtGState.items(): pass
        try: ops = pikepdf.parse_content_stream(obj)
        except Exception as e: use['fonts'].append('%s: unreadable content (%s)' % (where, e)); return
        for operands, op in ops:
            o = str(op)
            if o in ('rg', 'RG'): cs_use(Name('/DeviceRGB'), res, where)
            elif o in ('k', 'K'): cs_use(Name('/DeviceCMYK'), res, where)
            elif o in ('cs', 'CS') and operands: cs_use(operands[0], res, where)
            elif o in ('scn', 'SCN') and operands and isinstance(operands[-1], Name) and res is not None and '/Pattern' in res and operands[-1] in res.Pattern:
                pat = res.Pattern[operands[-1]]
                if int(pat.get('/PatternType', 1)) == 2: cs_use(pat.Shading.get('/ColorSpace'), res, where); gs_use(pat.get('/ExtGState'), where)
                else: scan(pat, pat.get('/Resources', res), where + ' pattern', depth + 1)
            elif o == 'sh' and operands and res is not None and '/Shading' in res: cs_use(res.Shading[operands[0]].get('/ColorSpace'), res, where)
            elif o == 'gs' and operands and res is not None and '/ExtGState' in res: gs_use(res.ExtGState[operands[0]], where)
            elif o == 'Do' and operands and res is not None and '/XObject' in res and operands[0] in res.XObject:
                x = res.XObject[operands[0]]
                if x.get('/Subtype') == Name('/Image'): image(x, res, where)
                elif x.get('/Subtype') == Name('/Form'):
                    g = x.get('/Group')
                    if g is not None and g.get('/S') == Name('/Transparency'): use['alpha'].append(where + ' (transparency group)')
                    scan(x, x.get('/Resources', res), where + ' form', depth + 1)
            elif o == 'INLINE IMAGE':
                ii = operands[0]
                d = ii.obj if hasattr(ii, 'obj') else {}
                for k in ('/CS', '/ColorSpace'):
                    if k in d: cs_use(d[k], res, where)
                for k in ('/BPC', '/BitsPerComponent'):
                    if k in d and int(d[k]) > 8: use['bits16'].append(where)

    for i, page in enumerate(pdf.pages):
        res = page.obj.get('/Resources')
        if res is None:
            n = page.obj
            while '/Parent' in n and res is None: n = n.Parent; res = n.get('/Resources')
        g = page.obj.get('/Group')
        if g is not None and g.get('/S') == Name('/Transparency'): use['alpha'].append('page %d (transparency group)' % (i + 1))
        scan(page.obj, res, 'page %d' % (i + 1))
        for a in page.obj.get('/Annots', Array()):
            ap = a.get('/AP')
            if ap is None: continue
            if not (int(a.get('/F', 0)) & 4): continue  # a non-printing annotation is not part of the printed output
            for k in ('/N', '/R', '/D'):
                s = ap.get(k)
                for st in ([s] if isinstance(s, Stream) else list(s.values()) if isinstance(s, Dictionary) else []):
                    if isinstance(st, Stream): scan(st, st.get('/Resources'), 'page %d annotation' % (i + 1))

    rule('fonts embedded', use['fonts'])
    dest = icc['space'] if icc else b'CMYK'
    if kind == '1a':
        rule('X-1a: CMYK, grey and CMYK spot colours only (no RGB, ICCBased or CIE)', use['rgb'] + ['ICCBased: ' + w for w in use['icc']] + ['CIE: ' + w for w in use['cie']] + ['spot with non-CMYK alternate: ' + w for w in use['spot_alt']])
    else:
        rule('device RGB only where defined (DefaultRGB) or with an RGB output intent', [] if dest == b'RGB ' else ['device RGB: ' + w for w in use['rgb']])
    rule('device CMYK only with a CMYK output intent', [] if dest == b'CMYK' else ['device CMYK: ' + w for w in use['cmyk']])
    if kind in ('1a', '3'):
        rule('no transparency (soft masks, CA/ca < 1, blend modes, transparency groups)', use['alpha'])
        rule('no 16-bit images (PDF 1.4 base)', use['bits16'])
        rule('no JPEG 2000 (PDF 1.4 base)', use['jpx'])
    rule('no transfer functions', use['tr'])

    # annotations: none printing inside the page area, except TrapNet and PrinterMark
    p = []
    for i, page in enumerate(pdf.pages):
        b = page.obj.get('/BleedBox') or page.obj.get('/TrimBox') or page.obj.get('/MediaBox')
        bx = [float(x) for x in b]
        for a in page.obj.get('/Annots', Array()):
            sub = str(a.get('/Subtype'))
            if sub in ('/TrapNet', '/PrinterMark') or not (int(a.get('/F', 0)) & 4): continue
            r = [float(x) for x in a.get('/Rect', [0, 0, 0, 0])]
            if not (max(r[0], r[2]) < min(bx[0], bx[2]) or min(r[0], r[2]) > max(bx[0], bx[2]) or max(r[1], r[3]) < min(bx[1], bx[3]) or min(r[1], r[3]) > max(bx[1], bx[3])):
                p.append('page %d: printing %s annotation inside the page area' % (i + 1, sub))
    rule('annotations: none printing inside BleedBox/TrimBox', p)

    # actions and scripts
    p = []
    if '/Names' in pdf.Root and '/JavaScript' in pdf.Root.Names: p.append('document JavaScript')
    for obj in pdf.objects:
        if isinstance(obj, Dictionary) or isinstance(obj, Stream):
            d = obj.stream_dict if isinstance(obj, Stream) else obj
            s = d.get('/S')
            if s is not None and str(s) in BAD_ACTIONS and str(d.get('/Type', '/Action')) == '/Action': p.append('%s action' % s)
            if '/AA' in d: p.append('additional actions (AA)')
            if isinstance(obj, Stream) and ('/F' in d or '/FFilter' in d) and str(d.get('/Type', '')) != '/EmbeddedFile': p.append('external stream data')
    rule('no JavaScript, forbidden actions or external data', sorted(set(p)))
    ef = '/Names' in pdf.Root and '/EmbeddedFiles' in pdf.Root.Names
    rule('no embedded files', ['embedded files present'] if ef else [])

    # XMP (required by X-4; checked when present for the others)
    xmp = pdf.Root.get('/Metadata')
    x = xmp.read_bytes().decode('utf-8', 'replace') if isinstance(xmp, Stream) else ''
    if kind == '4':
        p = []
        if not x: p.append('no XMP metadata')
        else:
            if not re.search(r'pdfxid:GTS_PDFXVersion(>|=")\s*PDF/X-4', x): p.append('no pdfxid:GTS_PDFXVersion PDF/X-4')
            for k in ('xmp:CreateDate', 'xmp:ModifyDate', 'xmp:MetadataDate'):
                if '<' + k + '>' not in x and k + '="' not in x: p.append('no ' + k)
            if isinstance(xmp, Stream) and '/Filter' in xmp.stream_dict: p.append('XMP is compressed')
        rule('X-4: XMP with pdfxid:GTS_PDFXVersion and dates', p)
    print(json.dumps({'ok': not failed, 'version': VERSION[kind], 'failed': failed, 'passed': passed}))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
