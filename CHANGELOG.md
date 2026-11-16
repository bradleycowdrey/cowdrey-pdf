# Changelog

Versions follow [Semantic Versioning](https://semver.org). Every platform shares one version number.

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
