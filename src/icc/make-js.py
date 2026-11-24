#!/usr/bin/env python3
"""Writes src/features/84-pdfa-icc.js from src/icc/FOGRA39L_coated.icc (see src/icc/README.md)."""
from pathlib import Path
import base64, hashlib, zlib

here = Path(__file__).parent
icc = (here / 'FOGRA39L_coated.icc').read_bytes()
z = zlib.compress(icc, 9)
b64 = base64.b64encode(z).decode()
lines = [b64[i:i + 160] for i in range(0, len(b64), 160)]
js = ('/* ---------------- CMYK printing condition (src/features/84-pdfa-icc.js) ----------------\n'
      '   Made by src/icc/make-js.py from src/icc/FOGRA39L_coated.icc: colord\'s "FOGRA39L Coated" ICC v2 output profile\n'
      '   (CC0 1.0, see src/icc/README.md), deflated, as base64. Do not edit by hand. */\n'
      'const PDFA_FOGRA39 = { size: %d, sha256: \'%s\', z: \'\'\n' % (len(icc), hashlib.sha256(icc).hexdigest()) +
      ''.join("  + '%s'\n" % l for l in lines) + '};\n')
(here.parent / 'features/84-pdfa-icc.js').write_text(js)
print('src/features/84-pdfa-icc.js written (%d bytes of profile, %d deflated)' % (len(icc), len(z)))
