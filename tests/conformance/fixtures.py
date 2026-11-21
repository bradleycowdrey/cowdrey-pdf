#!/usr/bin/env python3
"""Font and picture files for the package 3 conformance fixtures (tests/conformance/pkg3.mjs runs this).

python3 -I tests/conformance/fixtures.py <out dir> <cff font> <arabic ttf> <emoji ttf>

Writes into <out dir>:
  type1.pfa, type1.json   a real Type 1 font program (cleartext + eexec section + trailer), made from the outlines of
                          a CFF font (pdf.js's FoxitSerif, BSD licence) and cut down to the glyphs the fixtures use.
                          type1.json: font name, bbox, widths by glyph name, the three segment lengths.
  arabic-emoji.ttf        one TrueType font: Noto Sans Arabic + Noto Emoji (monochrome outlines), both SIL OFL 1.1,
                          cut down to the fixture text and merged (emoji scaled to the same units per em).
  emoji.ttf               Noto Emoji cut down to the fixture emoji (for the Chinese + emoji fixture).
  photo.jpg               an RGB JPEG; gray.jpg a grey JPEG.
  scan-NN.jpg             50 grey "scanned" pages (200 dpi, A4), for the scale check.
Everything is deterministic (no clock, fixed seeds), so the same inputs give the same files.
"""
import io, json, os, random, sys

from fontTools.cffLib import CFFFontSet
from fontTools.pens.recordingPen import RecordingPen
from fontTools.ttLib import TTFont
from fontTools import subset as ftsubset
from fontTools.ttLib.scaleUpem import scale_upem
from PIL import Image, ImageDraw

TYPE1_TEXT = 'Archive copy, Type 1 text: 2026 PDF/A-1b and PDF/X proof.'
TYPE1_EXTRA = 'Form XObject'  # drawn by the Form XObject fixture
ARABIC = 'مرحبا بالعالم'
EMOJI = '😀🌍📄✅'


# ---------------------------------------------------------------- Type 1
def t1num(v):
    v = int(round(v))
    if -107 <= v <= 107:
        return bytes([v + 139])
    if 108 <= v <= 1131:
        v -= 108
        return bytes([(v >> 8) + 247, v & 255])
    if -1131 <= v <= -108:
        v = -v - 108
        return bytes([(v >> 8) + 251, v & 255])
    return bytes([255]) + (v & 0xFFFFFFFF).to_bytes(4, 'big')


def t1op(*ops):
    return bytes(ops)


def encrypt(plain, r):
    out = bytearray()
    for p in plain:
        c = p ^ (r >> 8)
        r = ((c + r) * 52845 + 22719) & 0xFFFF
        out.append(c)
    return bytes(out)


def charstring(width, rec):
    """Type 1 charstring from recorded (cubic) outlines."""
    cs = bytearray(t1num(0) + t1num(width) + t1op(13))  # hsbw
    x = y = 0.0
    open_ = False
    for op, pts in rec.value:
        if op == 'moveTo':
            (px, py), = pts
            if open_:
                cs += t1op(9)
            cs += t1num(px - x) + t1num(py - y) + t1op(21)
            x, y = round(px), round(py); open_ = True
        elif op == 'lineTo':
            (px, py), = pts
            cs += t1num(px - x) + t1num(py - y) + t1op(5)
            x, y = round(px), round(py)
        elif op == 'curveTo':
            (ax, ay), (bx, by), (cx, cy) = pts
            ax, ay, bx, by, cx, cy = map(round, (ax, ay, bx, by, cx, cy))
            cs += t1num(ax - x) + t1num(ay - y) + t1num(bx - ax) + t1num(by - ay) + t1num(cx - bx) + t1num(cy - by) + t1op(8)
            x, y = cx, cy
        elif op == 'qCurveTo':
            raise ValueError('quadratic outlines in a CFF font')
        elif op in ('closePath', 'endPath'):
            if open_:
                cs += t1op(9); open_ = False
    if open_:
        cs += t1op(9)
    cs += t1op(14)  # endchar
    return bytes(cs)


def make_type1(cff_path, out_dir):
    cff = CFFFontSet(); cff.decompile(io.BytesIO(open(cff_path, 'rb').read()), None)
    top = cff[cff.fontNames[0]]
    gs = top.CharStrings
    std = {chr(c): n for c, n in [(32, 'space')]}
    names = {'.notdef', 'space'}
    agl = {',': 'comma', '.': 'period', ':': 'colon', '/': 'slash', '-': 'hyphen', '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
           '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine'}
    for ch in TYPE1_TEXT + TYPE1_EXTRA:
        names.add(std.get(ch) or agl.get(ch) or ch)
    missing = [n for n in names if n not in gs]
    if missing:
        raise SystemExit('Type 1 source lacks glyphs: %s' % missing)
    private = top.Private
    widths, entries = {}, []
    for n in sorted(names, key=lambda k: (k != '.notdef', k)):
        c = gs[n]
        rec = RecordingPen(); c.draw(rec)
        w = c.width if c.width is not None else private.defaultWidthX
        widths[n] = int(round(w))
        cs = encrypt(b'\0\0\0\0' + charstring(w, rec), 4330)
        entries.append(b'/%s %d RD ' % (n.encode(), len(cs)) + cs + b' ND\n')
    bbox = [int(round(v)) for v in top.FontBBox]
    name = 'CowdreyFixtureSerif'
    clear = ('%%!PS-AdobeFont-1.0: %s 001.000\n' % name +
             '11 dict begin\n/FontInfo 4 dict dup begin /FullName (%s) readonly def /FamilyName (CowdreyFixtureSerif) readonly def '
             '/ItalicAngle 0 def /isFixedPitch false def end readonly def\n' % name +
             '/FontName /%s def\n/Encoding StandardEncoding def\n/PaintType 0 def\n/FontType 1 def\n' % name +
             '/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n/FontBBox {%d %d %d %d} readonly def\n' % tuple(bbox) +
             'currentdict end\ncurrentfile eexec\n').encode('latin1')
    subrs = [t1num(3) + t1num(0) + bytes([12, 16, 12, 17, 12, 17, 12, 33, 11]), t1num(0) + t1num(1) + bytes([12, 16, 11]),
             t1num(0) + t1num(2) + bytes([12, 16, 11]), bytes([11])]
    priv = bytearray(b'dup /Private 8 dict dup begin\n/RD{string currentfile exch readstring pop}executeonly def\n'
                     b'/ND{noaccess def}executeonly def\n/NP{noaccess put}executeonly def\n/BlueValues [] def\n'
                     b'/MinFeature{16 16} def\n/password 5839 def\n/lenIV 4 def\n/Subrs 4 array\n')
    for i, s in enumerate(subrs):
        e = encrypt(b'\0\0\0\0' + s, 4330)
        priv += b'dup %d %d RD ' % (i, len(e)) + e + b' NP\n'
    priv += b'ND\n2 index /CharStrings %d dict dup begin\n' % len(entries)
    for e in entries:
        priv += e
    priv += b'end\nend\nreadonly put\nnoaccess put\ndup /FontName get exch definefont pop\nmark currentfile closefile\n'
    binary = encrypt(b'\0\0\0\0' + bytes(priv), 55665)
    trailer = (('0' * 64 + '\n') * 8 + 'cleartomark\n').encode('latin1')
    open(os.path.join(out_dir, 'type1.pfa'), 'wb').write(clear + binary + trailer)
    json.dump({'name': name, 'bbox': bbox, 'widths': widths, 'length1': len(clear), 'length2': len(binary), 'length3': len(trailer),
               'text': TYPE1_TEXT}, open(os.path.join(out_dir, 'type1.json'), 'w'), indent=1)


# ---------------------------------------------------------------- TrueType: Arabic + emoji in one font
def cut(path, text, keep_layout=True):
    f = TTFont(path)
    opts = ftsubset.Options(); opts.layout_features = ['*'] if keep_layout else []; opts.name_IDs = ['*']; opts.notdef_outline = True
    opts.glyph_names = True; opts.drop_tables += ['DSIG']
    s = ftsubset.Subsetter(opts); s.populate(text=text); s.subset(f)
    return f


def make_arabic_emoji(ar_path, em_path, out_dir):
    ar = cut(ar_path, ARABIC + ' ')
    em = cut(em_path, EMOJI + ' ', keep_layout=False)
    if em['head'].unitsPerEm != ar['head'].unitsPerEm:
        scale_upem(em, ar['head'].unitsPerEm)
    for f in (ar, em):
        for t in ('GPOS', 'GSUB', 'GDEF') if f is em else ():
            if t in f: del f[t]
    # Merge by hand (fontTools.merge wants matching tables): the emoji glyphs go into the Arabic font, renamed.
    order = ar.getGlyphOrder()[:]
    glyf, hmtx = ar['glyf'], ar['hmtx']
    rename = {g: 'em_' + g for g in em.getGlyphOrder() if g != '.notdef'}
    for g, new in rename.items():
        gl = em['glyf'][g]
        if gl.isComposite():
            for c in gl.components:
                c.glyphName = rename.get(c.glyphName, c.glyphName)
        glyf.glyphs[new] = gl
        hmtx.metrics[new] = em['hmtx'][g]
        order.append(new)
    ar.setGlyphOrder(order)
    glyf.glyphOrder = order
    emc = em.getBestCmap()
    for t in ar['cmap'].tables:
        if t.isUnicode():
            if t.format == 4:
                continue
            for u, g in emc.items():
                if g in rename: t.cmap[u] = rename[g]
    from fontTools.ttLib.tables._c_m_a_p import cmap_format_12
    if not any(t.format == 12 for t in ar['cmap'].tables):
        t12 = cmap_format_12(12); t12.platformID, t12.platEncID, t12.language = 3, 10, 0
        t12.cmap = dict(ar.getBestCmap()); t12.cmap.update({u: rename[g] for u, g in emc.items() if g in rename})
        ar['cmap'].tables.append(t12)
    for t in ar['cmap'].tables:  # BMP emoji (U+2705) in the format 4 table too
        if t.format == 4 and t.isUnicode():
            t.cmap.update({u: rename[g] for u, g in emc.items() if g in rename and u < 0x10000})
    ar['maxp'].numGlyphs = len(order)
    ar['name'].setName('Cowdrey Fixture Arabic Emoji', 1, 3, 1, 0x409)
    ar['name'].setName('CowdreyFixtureArabicEmoji', 6, 3, 1, 0x409)
    if 'post' in ar: ar['post'].formatType = 3.0
    ar.save(os.path.join(out_dir, 'arabic-emoji.ttf'))
    chk = TTFont(os.path.join(out_dir, 'arabic-emoji.ttf')).getBestCmap()
    for ch in ARABIC + EMOJI:
        if ord(ch) not in chk and ch != ' ': raise SystemExit('merged font lacks U+%04X' % ord(ch))
    em2 = cut(em_path, EMOJI + ' ', keep_layout=False)
    em2.save(os.path.join(out_dir, 'emoji.ttf'))


# ---------------------------------------------------------------- pictures
def make_pictures(out_dir):
    w, h = 320, 200
    im = Image.new('RGB', (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = (int(255 * x / w), int(255 * y / h), 160)
    ImageDraw.Draw(im).ellipse((110, 50, 210, 150), fill=(250, 220, 40))
    im.save(os.path.join(out_dir, 'photo.jpg'), quality=85)
    im.convert('L').save(os.path.join(out_dir, 'gray.jpg'), quality=85)
    rnd = random.Random(3)
    W, H = 1654, 2339  # A4 at 200 dpi
    for n in range(50):
        page = Image.new('L', (W, H), 246)
        d = ImageDraw.Draw(page)
        d.text((160, 140), 'Scanned page %d' % (n + 1), fill=20)
        y = 260
        while y < H - 200:
            x = 160
            while x < W - 300:
                ww = rnd.randint(30, 140)
                d.rectangle((x, y, x + ww, y + 14), fill=rnd.randint(20, 70))
                x += ww + rnd.randint(14, 26)
            y += 42
        for _ in range(4000):  # paper grain
            page.putpixel((rnd.randrange(W), rnd.randrange(H)), rnd.randint(200, 255))
        page.save(os.path.join(out_dir, 'scan-%02d.jpg' % (n + 1)), quality=70)


if __name__ == '__main__':
    out, cff, ar, em = sys.argv[1:5]
    os.makedirs(out, exist_ok=True)
    make_type1(cff, out)
    make_arabic_emoji(ar, em, out)
    make_pictures(out)
    json.dump({'arabic': ARABIC, 'emoji': EMOJI, 'type1': TYPE1_TEXT}, open(os.path.join(out, 'texts.json'), 'w'), ensure_ascii=False)
    print('fixtures ready in', out)
