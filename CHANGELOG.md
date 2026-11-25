# Changelog

Versions follow [Semantic Versioning](https://semver.org). Every platform shares one version number.

## 2.1.0 — on the App Store for iPhone and iPad

The version number moves to 2.1 to line up with the other Cowdrey apps. On iPhone and iPad, Cowdrey.PDF is now on the App Store: https://apps.apple.com/app/id6834950576 (TestFlight stays open for early versions). Everything else is as in 1.1.0 below.

## 1.1.0 — closer to Acrobat Pro, still on your device

Cowdrey.PDF 1.1 fills most of the gaps against Acrobat Pro, and comes to Android (in testing). Everything still runs on your device; the only things that ever go online are a font download you agree to, OCR language data you choose, a timestamp server you set yourself (it gets a fingerprint of the signature, not the document), and revocation checks you ask for (the certificate's servers get its serial number and its issuer's fingerprints, never the document).

- **Edit text in any language:** text typed anywhere (Edit PDF, Add text, text boxes, watermarks, headers and footers, Bates numbers) is saved as typed in embedded Noto fonts, not as "?". Chinese, Japanese, Korean, Hindi and Thai ask once for a font download and keep it on the device. Text inside forms can be edited and leaves the file; a partly changed kerned line keeps its spacing. Limits: right-to-left text (Arabic, Hebrew) can't be saved yet, and letters no font has (most emoji) are left off the page but kept as the line's text for copying. Embedded fonts now draw every letter in other PDF apps too (fontkit's TrueType subsets lost most letters after the first odd-length glyph), and saving Hindi no longer fails.
- **Page design:** new fields for file name, title and author, odd or even pages, a different first page, and saved presets.
- **OCR:** scans are cleaned before reading (straightened, contrast, specks removed), sideways and upside-down pages are turned upright, up to three languages at once (other languages download once), uncertain words are listed under **Check words** to correct, the scan can be replaced with a straightened, cleaned image, pages that already have text get no duplicates, and OCR can run when a scanned PDF opens.
- **Pictures:** moving, resizing, turning or flipping a picture no longer re-encodes it; real crop (or crop by hiding); **Enhance picture** (brightness, contrast, saturation, sharpen, straighten, levels, greyscale, black and white, remove specks, resample); **Export all pictures**. Deleted and replaced pictures leave the file.
- **Attachments and media:** attach a file to a spot on a page; rename, describe, remove or set the relationship of attached files; attachments are kept when PDFs are combined. Insert video or audio (some apps show only its poster); video and sound in a PDF play in place, from the file itself. Portfolios list their files to open or save.
- **Stamps:** picture stamps, an "Approved by … on …" stamp, and a library of your own stamps.
- **Forms designer:** edit the PDF's own fields as well as new ones; appearance, options, actions, number/date/percent formats, range checks and totals that work as you fill in (custom scripts are written for other apps, not run here); tab order; align, distribute, match size, duplicate, copy to pages, snap to grid; Prepare for signing; a picture in a signature field; export and import form data (XFDF, FDF) and comments (XFDF).
- **Certificate signing (PAdES):** import a .p12/.pfx or make a signing ID on the device; sign in a field or a box you draw; optional RFC 3161 timestamp; certify or lock fields. Signed PDFs are checked when they open (changes added after signing are found, including through extra xref sections), with a **Signatures** panel and per-certificate trust. Signing IDs with RSA, ECDSA P-256/P-384 or Ed25519 keys. The panel walks the certificate chain (from the signature and the roots you trust) and shows each certificate's issuer and expiry, the timestamp's details (the token can be saved), and revocation from OCSP or the CRL when you ask (revoked after the timestamp is a warning only, and a timestamp counts only when you trust its timestamp authority; old or replayed OCSP answers are refused). A certificate in the chain that was not valid at the time of signing makes the signature invalid; damage to the signed content, to the signature itself, or a file cut short are each named. Saving and signing again keep signatures valid when only form values or comments changed (they are added as an incremental update), and warn before a save would break them. Limits: no root list is built in, and password-protected PDFs can't be signed.
- **Redaction:** also removes hidden text and tags (ActualText, Alt, the structure tree), drawings and shadings under the box (shapes crossing it are cut along it) and letters partly under it, and offers to remove the redacted words from bookmarks, comments, form values and properties.
- **Security:** printing, changes and copying choices, AES-256 or AES-128, saved settings. A PDF its author limited is followed (this can be turned off) until you enter its permissions password.
- **PDF/A, PDF/X and metadata:** **Save as PDF/A** (1b, 2b, 2u, 3b, 3u) replaces fonts that weren't embedded with metric-compatible Arimo, Tinos and Cousine, with screen (sRGB) or print (CMYK, FOGRA39) colours; PDF/A-1b gets the glyph lists its font subsets need and draws highlights without transparency. **Save as PDF/X** (X-1a, X-3, X-4) for coated paper, with the FOGRA39 profile built in (CC0, works offline): fonts embedded, TrimBox set, trapping stated; colours are not converted. What a kind can't keep (the wrong colour space, transparency, 16-bit or JPEG 2000 pictures, attachments, layers) is refused with the reason and nothing is saved. Each runs a built-in check (not a certified validator). Document properties edits creator, producer, dates, keywords, language, custom properties, page numbers (i, ii, iii then 1, 2, 3), the XMP packet as text and how the PDF opens; the XMP metadata stays in step instead of being removed.
- **Compare with another PDF** (File menu, Export tab): side by side, scrolled together, with added, removed and changed text, formatting and pictures; step through with [ and ]; save a compare report.
- **Insight** (Export tab): extract tables to CSV or Excel, summarize from the document's own sentences, and ask the document for the passages that best answer a question. Nothing is generated or sent anywhere; a browser's own on-device model is offered only where it already exists.
- **Accessibility:** tags kept through page deletes, moves and merges, and added for new text, pictures and comments; Add tags automatically, Alt text, Reading order, an Accessibility check with fixes, Save as PDF/UA; bookmarks from headings, with colours, bold/italic and zoom kept and editable.
- **Actions** (File > Actions…, Export tab): run the same steps on many PDFs, with Bates numbers carrying on across files and a .csv log; results as a .zip, in a folder (nothing is replaced) or next to the originals on the Mac.
- **Optimize** (Protect tab) replaces Compress: pictures made smaller at a chosen dpi, scans kept black and white, identical pictures and fonts merged, streams packed tighter, unused resources removed, never a bigger file; the clean-up you choose (scripts, metadata, tags) is always done.
- **Android app (in testing):** Cowdrey.PDF now runs on Android phones and tablets (Android 8 and newer), with everything above. It opens PDFs from Android's Open with and Share; Save PDF opens Android's save dialog, and saving again updates that file; Split saves into a folder you pick; it prints the PDF itself, reads aloud with Android's voices, follows the phone's dark mode and keeps clear of the keyboard and system bars. Pictures for a new PDF come from Android's photo picker, HEIC photos included. OCR in English works offline. Timestamps and revocation checks are sent by Android itself, so they reach timestamp, OCSP and CRL servers that a web view can't (including plain-http OCSP and CRL servers, with the app's cleartext traffic still off). The app is not on Google Play yet: each build is tested on two emulators (Android 15, and Android 16 with 2 GB of memory) and the APK is attached to the build; see `docs/android.md`.
- **New icon and App Store pictures:** a new app icon in the Cowdrey family style, on every platform (with a themed icon on Android 13 and newer), and new App Store screenshots for iPhone, iPad and Mac, made from the app itself by one generator (`tests/app-store-screens.mjs`).
- **Tests:** `tests/conformance/pkg3.mjs` exports PDF/A and PDF/X files through the app and checks each with veraPDF or an ISO 15930 rule check; `tests/conformance/pkg4.mjs` signs and checks PDFs against a local timestamp server, OCSP responder and CRLs, and cross-checks with pdfsig, pyHanko and openssl. Both run on every push.

## 1.0.0 — Cowdrey.PDF 1.0

**Cowdrey.PDF 1.0.** Everything since 0.1 in one release: a full PDF viewer and editor, free, on your device, with nothing uploaded.

- **Edit text and pictures in place:** click a line and retype it in its own font, size and colour; reflow paragraphs; find and replace. Add, move, resize, rotate, crop and replace pictures. The old content is taken out of the saved file for good.
- **Sign and fill forms:** a handwritten signature kept on your device for next time; fill text fields, checkboxes, radio buttons and lists, make your own fields, recognize a form, flatten it.
- **Annotate:** highlight, underline, strikethrough, pen, shapes, notes, text boxes, callouts, stamps, with a Comments panel for replies and status.
- **Organise pages:** insert, extract, split, combine, crop, rotate, reorder, duplicate and delete, in an Organize grid; watermark, header and footer, Bates numbering.
- **OCR** for scanned pages, on the device and offline in the apps.
- **Protect:** redact text, areas and search results; passwords and permissions; remove hidden information; **compress** (never makes a file bigger).
- **Share** a PDF from the share sheet, and Cowdrey.PDF itself from the title bar.
- **Native apps:** for Mac (signed with a Developer ID and notarized by Apple), and for iPhone and iPad (on TestFlight at https://testflight.apple.com/join/tr4eD534 while the App Store version is in review). The Mac App Store version is coming. And on the web at bradcowdrey.com/cowdrey-pdf/app.
- **Free and on-device:** no account, no upload, open source under the MIT License.

From 1.0 on, versions follow Semantic Versioning strictly, as Cowdrey.MD has since 2.0: major.minor.patch, where a patch fixes things, a minor version adds features, and a major version is a big change.

## 0.3.2

- **Share app:** a button in the title bar (and Share Cowdrey.PDF… in Help) to pass Cowdrey.PDF on: the share sheet, or a link or a message to copy.
- **Share in the ⋯ menu** on a phone: Share… for the PDF, and Share Cowdrey.PDF… with Help.
- **Share a PDF from the web app** where the browser supports it.
- **Mac app:** signed with a Developer ID and notarized by Apple, so it opens like any other app.
- **iPhone and iPad:** on TestFlight at https://testflight.apple.com/join/tr4eD534.

## 0.3.1

- **Redaction:** the box always covers the whole word, and applying it no longer takes a letter off the text next to it on PDFs that use the standard fonts.
- **OCR:** Cyrillic and Greek text recognized on a scan copies as words, not letters with spaces between them.
- **Highlight and Redact text:** a highlight is never added to the next selection when the computer is busy.
- **Add text** keeps its place among your changes; a newly opened PDF always starts on page 1 in the page box.

## 0.3.0

**A full PDF editor.** Cowdrey.PDF now covers most of what PDFelement does, still free and on your device. A ribbon (Home, Edit, Comment, Pages, Forms, Protect, Export) holds every tool.

- **Edit PDF:** the caret goes where you click; double-click a word, triple-click a line. Paragraph mode reflows whole paragraphs. A format bar sets font, size, colour, bold, italic, underline, alignment and line spacing. Edits keep the line's own font, weight, spacing and place in the reading order, centred titles stay centred, and the old words are taken out of the saved file for good. Find and replace, and Replace all.
- **Pictures:** add, move, resize, rotate, flip, crop, replace, save as PNG, delete. **Links:** add, change, delete.
- **Comment:** highlight, underline, strikethrough, squiggly, area highlight, pen, shapes, clouds, lines and arrows, notes, text boxes, callouts, typewriter, stamps and a handwritten signature. Select text to get a mark-up bar. A Comments panel with replies, status, filters, sorting, hide, export and import.
- **Pages:** insert, replace, extract, split, combine, crop, rotate, reorder, duplicate, delete (with Undo), blank pages, and an Organize grid. Watermark, background, header & footer and Bates numbering, with a live preview, that can be changed or removed later.
- **Forms:** 8 kinds of field, field properties, recognize form, fill in, clear and flatten.
- **Protect:** redact text, areas and search results (with a review list); passwords and permissions; remove hidden information; compress (never makes a file bigger).
- **More:** OCR for scanned pages (on the device, offline in the apps), bookmarks, document properties, attachments, page labels, Read aloud and Read mode, new PDFs from pictures or the clipboard, export to pictures and text.
- **View:** hand tool, Fit page, Fit width, Actual size, two-page and single-page layouts, pinch and Ctrl+wheel zoom, right-click menus everywhere.
- **Keyboard and access:** every editor and tool works from the keyboard (Tab through a page's text in Edit PDF, Enter to edit), ribbon groups are toolbars, dialogs start on their first field, screen readers hear page moves and deletes, forced colours are supported.
- **Phones and the apps:** 44px touch targets, a two-row format bar, Android Back closes what's open, the Mac menu greys out what doesn't apply, Cmd/Ctrl+W closes a document.
- 293 end-to-end tests, run on real-world PDFs.

## 0.2.0

**Edit what's already in a PDF.** The new Edit PDF tool (Mark up tab) changes the PDF's own content:

- **Text:** click a line and type. It keeps the line's own font, size and colour, on the colour that was behind it. Saving takes the old words out of the file (search and copy find only the new ones) and writes the new line with the PDF's own font; a letter the embedded font doesn't have uses the closest standard font. Words in another font on the same line (a bold word, a link) are left as they are.
- **Pictures:** click to select, drag to move, drag the corner to resize (rotated pictures keep their angle), Delete to remove.
- **Comments from other apps:** double-click to change a note's words, Delete to remove one (its words go from the file too).
- **Erase area:** drag over anything to clear it.
- Works on PDFs from Word, Chrome and pdf-lib, on scanned PDFs with OCR text, on PDFs with only an owner password (their restrictions are kept), and with undo, Documents and Save like every other change.
- Comments without a look of their own now show pdf.js's icons. 30 end-to-end tests.

## 0.1.4

- **Try a sample PDF:** a two-page guide, made on the spot, to try every tool without a file of your own (also Help > Open the sample PDF).
- The web app now lives at bradcowdrey.com/cowdrey-pdf/app, with a product page at bradcowdrey.com/cowdrey-pdf. GitHub Pages shows this repo's landing page.

## 0.1.3

- **Mac menu bar:** File, Edit, View, Mark up, Pages and Help are back (0.1.2 sent the menu in a form the Mac refused).
- Dialogs wait their turn, so an update notice or a menu choice during a password question can't lose it and stall later opens.
- Quitting holds the app before anything else, so the "Save changes?" question always appears, and a second Cmd+Q waits for the answer.
- Keeping a PDF's password keeps what it allowed (printing, copying, changes), with the restrictions still enforced. The password question only counts protected files whose pages are still in the document.

## 0.1.2

Everything in the Mac, iPhone and Android apps that only worked in a browser now works in the apps too.

- **Print** opens the system print dialog in the Mac app and on iPhone, iPad and Android.
- **Export image, Export text and Extract pages** save through a Save dialog on the Mac and the share sheet on phones (they did nothing before).
- **Share…** (File menu and Export) sends the PDF by Mail, Messages, AirDrop and the rest.
- **Password-protected PDFs:** saving asks whether to keep the password, and the result opens correctly either way (before, saving one could damage it). Passwords are never stored, as the prompt says; a protected PDF asks again when reopened.
- **Opening files is dependable:** a file opened from Finder, Files or Open with always wins over last time's document; opening several at once keeps every one in Documents; a cancelled or broken file in a drop no longer adds the rest to the wrong PDF.
- **Saving is safe:** if another app changed the file since you opened it, Save asks before replacing it. Save a copy no longer marks the document as saved. Save As keeps the new file linked.
- **Quitting** with changes not saved to the file asks first.
- **Mac menu bar:** Edit > Undo and Redo undo your PDF edits, checkmarks stay current, and Check for Updates works.
- Links (About, Terms) open in the browser. Android "Open with" shows the file's real name.
- Uses @cantoo/pdf-lib (MIT), pdf-lib with password support, for saving. 21 end-to-end tests.

## 0.1.1

- **Mac:** opening a PDF works. The Mac app's copy of the PDF reader was linked in a way the app refused to load, so nothing opened. The iPhone and Android apps had the same fault and are fixed too.
- If a PDF can't be opened, the app now says so instead of doing nothing.
- The app uses the maroon of the icon and bradcowdrey.com in place of blue, in light and dark mode.
- A new test opens a PDF in the exact copy the apps ship, with the network off.

## 0.1.0

First build of the web app: read, find, mark up (highlight, draw, box, text, notes, signature, pictures), fill forms, page tools (rotate, move, duplicate, insert, merge, delete, extract), save to PDF, export images and text, and a library of PDFs kept on this device. Dark mode first. 12 end-to-end tests.
