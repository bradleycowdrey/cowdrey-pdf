# Colour profiles shipped with the app

`FOGRA39L_coated.icc`: the CMYK printing condition used by Save as PDF/X and by PDF/A with print (CMYK) colours.

- What: "FOGRA39L Coated", an ICC v2.2 output profile (CMYK to Lab) made with ArgyllCMS from FOGRA's FOGRA39L
  characterization data for ISO 12647-2:2004 sheet-fed offset on coated paper (the printing condition of "Coated
  FOGRA39" / ISO Coated v2).
- From: the colord project (Richard Hughes), `data/profiles/FOGRA39L_coated.icc`, as shipped in Ubuntu 24.04's
  `colord-data` 1.4.7-1build2 (`/usr/share/color/icc/colord/FOGRA39L_coated.icc`).
  SHA-256 `3ff7ca2a650ad47a8d2a929eb23ef162ccf979d013ade56e441c1f55156a261f`.
- Licence: CC0 1.0 (public domain dedication). colord's copyright file: "Files: data/profiles/* — Copyright: © 2012
  Richard Hughes — License: CC0-1.0". The profile's own copyright tag reads "This profile is free of known copyright
  restrictions".

The app carries it inside index.html: `src/features/84-pdfa-icc.js` is made from this file by
`python3 src/icc/make-js.py` (the profile deflated, as base64: the same bytes go into a PDF as its FlateDecode stream),
so the web app, the desktop and the mobile apps all have it offline.

The sRGB profile is not a file: `pdfaSrgbIcc()` in `src/features/84-pdfa.js` makes it in code.
