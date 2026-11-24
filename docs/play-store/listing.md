# Cowdrey.PDF: Google Play listing (Android phones and tablets)

Ready to paste into Play Console (Grow, Store presence, Main store listing; and Policy, App content). Counts are
characters of the exact text in each block. Play's limits: app name 30, short description 80, full description 4000.

## App name (22/30)

```
Cowdrey.PDF PDF Editor
```

## Short description (72/80)

```
Edit, sign and fill in PDFs. Free, no account, nothing leaves your phone
```

## Full description (2669/4000)

```
Change the words in a PDF right where they are, in the PDF's own font. Tap a line and type.

Cowdrey.PDF is a full PDF editor that is free, needs no account and works entirely on your phone or tablet. Your files are never uploaded. Nothing is tracked.

Edit what's already there
- Tap a line and type: the edit keeps the line's own font, size and colour
- Text in any language is saved as typed, including Greek and Cyrillic
- Edit whole paragraphs that reflow as you type
- Find and replace
- The old words are removed from the saved file, not just covered up
- Add, move, resize, rotate, crop and replace pictures, and enhance scans

Comment and sign
- Highlight, underline and strike through with a finger
- Pen, shapes, notes, text boxes and stamps
- Draw or type your signature and place it on the page
- Certificate signatures: import a .p12 or .pfx file or make a signing ID on your phone, sign, and check signatures in PDFs you receive
- Comments are saved as real PDF comments that other apps can read

Organize pages
- Rearrange, rotate, duplicate and delete pages
- Insert, extract, split and combine PDFs
- Watermarks, headers and footers, and Bates numbers

Forms
- Fill in and clear forms
- Design your own: text fields, check boxes, lists, dates, totals and signature fields
- Export and import form data

Protect
- Redact text, areas and search results; redacted content is taken out of the file for good
- Add a password and choose what others may print, copy or change
- Make files smaller with Optimize

Archive, compare and more
- Save as PDF/A for long-term archiving, and as PDF/UA for accessibility
- Compare two versions of a PDF and see every change
- Pull tables out to CSV or Excel, summarize a document, or ask it a question, all on your phone
- OCR turns scanned pages into text you can search, copy and edit. English works offline; other languages download once
- Run the same steps on many PDFs at once with Actions
- Read aloud with your phone's own voice
- Print with Android's print service, or share with any app
- Dark mode, with dark pages too

Opens PDFs from anywhere
Open PDFs from Files, Drive, Gmail or any app with "Open with" or Share, and save where you choose: your phone, an SD card or a cloud drive.

Private by design
No account. No upload. No tracking. No ads. Every change happens on your phone, and your PDFs stay where you keep them.

Free and open source
Cowdrey.PDF is free, with no subscriptions, ads or locked features. The code is open source under the MIT License, so anyone can check what it does: github.com/bradleycowdrey/cowdrey-pdf

New to it? Open the sample PDF from the start screen and try every tool.
```

## What's new in 1.1.0 (294/500)

```
The first Cowdrey.PDF for Android: edit text in any language, sign with a certificate, design forms, redact, OCR, PDF/A, compare two PDFs, extract tables and run actions on many files. Save opens Android's save dialog, Print uses Android's print service, and Read aloud uses your phone's voice.
```

## Category and contact

- App category: Productivity
- Tags (pick up to five): PDF editor, Document editor, Office, Productivity, Business
- Website: `https://bradcowdrey.com/cowdrey-pdf`
- Privacy policy: `https://bradcowdrey.com/legal`
- Contact email: the address you use for app support

## Graphics

- App icon, 512 x 512 PNG: export `desktop/src-tauri/icons/android-source.png` at 512 px (Play adds the rounding).
- Feature graphic, 1024 x 500: the icon and "Edit, sign and fill in PDFs" on the app's dark background.
- Phone screenshots (2 to 8, 9:16): take them from the device test's screenshots on the `android-build-log` branch
  (dark mode, 1080 x 2400), for example the marked-up page, Edit PDF, a signed PDF, OCR and Compare.

## App content (Policy, App content)

| Question | Answer |
| --- | --- |
| Privacy policy | `https://bradcowdrey.com/legal` |
| Ads | No, the app contains no ads |
| App access | All functionality is available without special access (no login) |
| Content rating | Questionnaire: category "Utility, Productivity, Communication or Other"; answer No to every content question. Expected rating: Everyone / PEGI 3 |
| Target audience | 18 and over (the app suits everyone, but this avoids the families policy questions) |
| News app | No |
| COVID-19 contact tracing or status | No |
| Data safety | See below |
| Government app | No |
| Financial features | None |
| Health | None |

## Data safety

- Does your app collect or share any of the required user data types? **No.**
- The app has no accounts, no analytics and no ads, and sends no data to the developer or anyone else. PDFs, signatures,
  signing IDs and the Recent list stay on the device, in the app's own storage, until the person deletes them.
- Network use, all started by the person and none of it user data: an OCR language other than English, or a font for
  Chinese, Japanese, Korean, Hindi or Thai, downloaded once from jsDelivr when asked; a certificate timestamp, which
  sends only a SHA-256 fingerprint of the signature to the timestamp server the person sets; and, in the copy from
  GitHub only, a check of GitHub's latest release for an update. None of these is "collection" under Play's
  definitions, as nothing is sent to the developer and nothing identifies the person.
- Is all of the user data collected by your app encrypted in transit? Not applicable (none is collected).
- Do you provide a way for users to request that their data be deleted? Not applicable: there is no data off the
  device. Uninstalling the app, or clearing its storage, deletes everything.

## Permissions the app asks for

None at run time. The manifest has INTERNET (for the optional downloads above). Files are read and saved through
Android's own file picker and save dialog, so the app needs no storage permission.
