#!/usr/bin/env python3
"""Assemble the single-file app: src/template.html + fonts/ + pdf.js layer CSS + src/app.js -> index.html"""
from pathlib import Path
import base64
root = Path(__file__).parent
html = (root / 'src/template.html').read_text()
FACES = [  # family, file, weight, style
    ('Instrument Sans', 'instrument-sans-latin-wght-normal.woff2', '400 700', 'normal'),
    ('JetBrains Mono', 'jetbrains-mono-latin-wght-normal.woff2', '100 800', 'normal'),
]
html = html.replace('/*FONTS_CSS*/', '\n'.join(
    "@font-face { font-family: '%s'; src: url(data:font/woff2;base64,%s) format('woff2'); font-weight: %s; font-style: %s; font-display: swap; }"
    % (fam, base64.b64encode((root / 'fonts' / f).read_bytes()).decode(), w, st) for fam, f, w, st in FACES))

# The text layer (selection and search) and the form layer need pdf.js's own rules, taken from the pinned package.
css = (root / 'desktop/node_modules/pdfjs-dist/web/pdf_viewer.css').read_text()
def first_block(sel):
    j = css.index('\n' + sel + ' {'); k = css.index('{', j); depth = 0
    for p in range(k, len(css)):
        depth += {'{': 1, '}': -1}.get(css[p], 0)
        if depth == 0: return css[j + 1:p + 1]
html = html.replace('/*PDFJS_CSS*/', first_block('.textLayer') + '\n' + first_block('.annotationLayer'))
html = html.replace('/*APP_JS*/', (root / 'src/app.js').read_text())
# The app icon (made from desktop/src-tauri/icons/ios-source.png at 144 px), embedded for the title bar and About.
html = html.replace('__APP_ICON__', 'data:image/png;base64,' + base64.b64encode((root / 'desktop/src-tauri/icons/about-icon.png').read_bytes()).decode())
doc = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
       '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
       '<link rel="icon" href="data:,">\n</head>\n<body>\n' + html + '\n</body>\n</html>\n')
(root / 'index.html').write_text(doc)
print(f'index.html written ({len(doc)/1024:.0f} KB)')
