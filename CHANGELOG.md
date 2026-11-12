# Changelog

Versions follow [Semantic Versioning](https://semver.org). Every platform shares one version number.

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
