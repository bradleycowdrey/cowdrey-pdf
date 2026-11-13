# Feature modules

Each `*.js` file here is joined into `src/app.js` by `build.py`, in name order, where `/*FEATURES*/` stands
(after every core section, before "the apps" and "start"). A module is plain script in the app's scope: it can use
every core function and value (`doc`, `views`, `scale`, `marksOf`, `toView`, `toPdf`, `localPoint`, `snapshot`,
`changed`, `drawMarks`, `redrawPage`, `svgEl`, `cmd`, `run`, `C`, `S`, `toast`, `dialog`, `askText`, `saveFile`,
`loadPdfLib`, `pdfjs`, `pdfDocs`, `pageOf`, `layoutPages`, `pageOp`, `parseRange`, `buildPdf`, `contentMap`,
`setTool`, `uid`, `esc`, `ic`, `icons`, `$`, `$$` …). Keep names unique: prefix private ones with the module's name.

Plug in through:

- `cmd(id, { label, icon, key?, enabled?, pressed?, hidden?, run })` — a command (Lucide icon names).
- `ribbonAdd(tab, group, ids, before?)` — tabs: `home`, `edit`, `markup` (shown as Comment), `pages`, `forms`,
  `protect`, `export`. `menuAdd(menuTitle, ids)` — menus: File, Edit, View, Mark up, Pages, Help (others are made
  before Help).
- Tools: add `cmd('tool_x', { label, icon, enabled: has, pressed: () => app.dataset.tool === 'x', run: () => setTool('x') })`
  and `FEATURE.tools.x = { down(e, v), move?(e, v) }`. The marks layer takes pointer events for any tool other
  than select and highlight. Add cursor CSS with `addStyle()`.
- Marks: a mark is a plain JSON object in `marksOf(entry)` with a unique `id` and a `type`, in PDF coordinates
  (points, y up). Register `FEATURE.markTypes[type] = { draw(v, m, svg), save({ L, out, p, m, entry, ctx }),
  under?, move?(m, orig, dx, dy) }`. `draw` returns an SVG element (give it class `mk` to make it selectable and
  movable with the Select tool). `save` draws the mark into the pdf-lib page `p` of document `out` (`L` is the
  pdf-lib module). Make every change with `const before = snapshot(); …; changed(before)` so undo and saving work.
- `FEATURE.savePage.push(async ({ L, out, p, entry, n, entries, marks, ctx }) => …)` — per page, after its marks.
  `FEATURE.saveDoc.push(async ({ L, out, pages, entries, ctx }) => …)` — once, before the file is written.
  Document-wide settings (a watermark, headers and footers…) go in `docMarks()`, a list of `{ id, type, … }`
  objects stored, undone and restored with the marks (change them inside `snapshot()`/`changed()` too).
- `FEATURE.afterRender.push((v) => …)` after a page is drawn; `FEATURE.onDocShown.push((doc) => …)`.
- `TEST_HOOKS.name = fn` exposes `fn` to tests as `window.__cowdreyPdf.name`.

Tests: `tests/features/<module>.test.mjs` exporting `export default async (h) => { await h.test('…', async () => {…}) }`
with the helpers listed in `tests/e2e.mjs` (open, openPdf, eq, ok, savedOf, reopen, at, macApp…).
