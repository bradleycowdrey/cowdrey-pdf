# Cowdrey.PDF

A PDF viewer and editor by **Bradley Cowdrey** · [bradcowdrey.com](https://bradcowdrey.com)

Cowdrey.PDF is Cowdrey.MD's sibling for PDFs: read, mark up, sign, fill forms and rearrange pages, with nothing leaving your device. Like Cowdrey.MD it is one self-contained web page, wrapped as an app for Mac, iPhone, iPad and Android.

**Free. Forever.** Open source under the MIT License.

## What it does (0.1)

- **Read:** smooth scrolling pages, thumbnails, the PDF's outline, find with every match marked, zoom and fit width, dark mode for the app and an optional dark page.
- **Mark up:** highlight selected text, draw, boxes, text, sticky notes (saved as real PDF comments), signatures (kept on this device for next time) and pictures. Select a mark to move or delete it; undo and redo.
- **Forms:** fill text fields, checkboxes, radio buttons and lists; the values are saved in the PDF.
- **Pages:** rotate one or all, move, duplicate, insert blank, add other PDFs at the end, delete, extract a range as a new PDF; drag thumbnails to reorder.
- **Save:** Save PDF writes your changes into a PDF. With the pages unchanged, the original is kept (bookmarks, forms, links) and the mark-up is added; otherwise a new PDF is assembled. Export a page as an image, or all the text.
- **Library:** every PDF you open is kept on this device, with its mark-up, under Documents.

## Apps

The same app runs on the web and, wrapped with Tauri 2, as apps for Mac, iPhone, iPad and Android, built and signed by GitHub Actions (`.github/workflows`): a notarized Mac DMG with in-place updates, TestFlight builds for iPhone and iPad (with a public TestFlight link until the App Store release), and a signed Android APK. Each platform opens PDFs from its file manager (Finder, Files, Android's Open with). On the Mac, Save writes back to the same file; on iPhone, iPad and Android, Save PDF opens the share sheet (Save to Files, Drive, Mail, AirDrop).

## Built with

pdf.js 6.4.299 (Apache 2.0, its legacy build, so older iPhones and Android web views work too), pdf-lib 1.17.1 (MIT) and Lucide (ISC).

## Develop

```
(cd desktop && npm ci)
python3 build.py          # src/ -> index.html
node tests/sample.mjs     # makes tests/fixtures/sample.pdf
node tests/e2e.mjs        # 12 end-to-end tests in Chromium
```
