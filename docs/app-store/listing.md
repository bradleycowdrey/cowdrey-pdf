# Cowdrey.PDF: App Store listing (iPhone, iPad and Mac)

Made from [`listing.json`](listing.json) by `.github/scripts/app_store_listing_md.py`: change listing.json and run the script, never this file by hand. listing.json is what `.github/scripts/app_store_listing.py` sends to App Store Connect. All counts are characters, measured on the exact text in the block (no trailing newline). Keywords are also counted in bytes.

Version 2.1.0. Minimum OS: iOS 15.0 / iPadOS 15.0, macOS 11.0. No sign-in or demo account required.

# iPhone and iPad

## App name (22/30)

```
Cowdrey.PDF PDF Editor
```

Set in App Store Connect (App Information), not by the listing script.

## Subtitle (27/30)

```
Edit, sign and fill in PDFs
```

"Free" is left out of the subtitle: App Review can reject price words in the name or subtitle (guideline 2.3.7). The price is already shown on the product page, and the description says it is free.

## Promotional text (154/170)

```
Change the words in a PDF in its own font, sign it, fill in forms and black out private details. Free, no account, and your files never leave your device.
```

## Description (3085/4000)

```
Change the words in a PDF right where they are, in the PDF's own font. Tap a line and type.

Cowdrey.PDF is a full PDF editor that is free, needs no account and works entirely on your iPhone or iPad. Your files are never uploaded. Nothing is tracked.

Edit what's already there
- Tap a line and type: the edit keeps the line's own font, size and colour
- Edit whole paragraphs that reflow as you type
- Set font, size, colour, bold, italic, underline, alignment and line spacing
- Find and replace, including Replace all
- The old words are removed from the saved file, not just covered up
- Add, move, resize, rotate, flip, crop and replace pictures
- Add, change and delete links

Comment and sign
- Highlight, underline, strike through and squiggly underline
- Pen, shapes, clouds, lines and arrows
- Notes, text boxes, callouts and typewriter text
- Stamps such as Approved, Draft and Confidential
- Draw or type your signature and place it on the page
- A Comments panel with replies, status, filters and sorting
- Comments are saved as real PDF comments that other apps can read
- Sign with a certificate (PAdES), with an optional timestamp, and check the signatures in a PDF: the certificate chain, changes made after signing, and revocation when you ask

Organize pages
- Rearrange, rotate, duplicate and delete pages in a page grid
- Insert, replace, extract, split and combine PDFs
- Crop pages and add blank pages
- Add a watermark, background, header and footer, or Bates numbering, and change or remove them later

Forms
- Fill in and clear forms
- Make your own: text fields, check boxes, radio buttons, lists, buttons, dates and signature fields
- Recognize form finds the blank lines and boxes for you
- Flatten a finished form

Protect
- Redact text, areas and search results; redacted content is taken out of the file for good
- Add a password and set what others may print, copy or change
- Remove hidden information such as metadata and attachments
- Optimize a PDF to make it smaller, never bigger
- Save as PDF/A for archiving or PDF/X for print

And more
- OCR turns scanned pages into text you can search, copy and edit, in 27 languages, on your device
- Bookmarks you can add, rename, nest and reorder
- Attachments, document properties and page labels
- Read aloud with your device's own voices, and a distraction-free Read mode
- Make a new PDF from photos or the clipboard
- Compare two versions of a PDF side by side, with the changes marked
- Extract tables to CSV or Excel
- Run the same steps on many PDFs at once
- Export pages as pictures or the text as a text file
- Dark mode, with dark pages too
- Works with VoiceOver and a keyboard

Private by design
No account. No upload. No tracking. Every change happens on your device, and your PDFs stay where you keep them.

Free and open source
Cowdrey.PDF is free, with no subscriptions, ads or locked features. The code is open source under the MIT License, so anyone can check what it does: github.com/bradleycowdrey/cowdrey-pdf

New to it? Open the sample PDF from the start screen and try every tool.
```

## Keywords (100/100 bytes, 100 characters)

```
annotate,highlight,form,redact,merge,split,ocr,scan,signature,document,watermark,password,read,notes
```

No words from the name or subtitle (cowdrey, pdf, editor, edit, sign, fill, free), no spaces after commas, no plural repeats.

## Support URL (35)

```
https://bradcowdrey.com/cowdrey-pdf
```

## Marketing URL (35)

```
https://bradcowdrey.com/cowdrey-pdf
```

## Privacy policy URL (29)

```
https://bradcowdrey.com/legal
```

## Copyright (20)

```
2026 Bradley Cowdrey
```

## Category

- Primary: Productivity
- Secondary: Business

## What's New in 2.1.0 (722/4000)

```
Cowdrey.PDF 2.1, still entirely on your iPhone or iPad:
- Sign with a certificate (PAdES), with an optional timestamp, and check signatures: certificate chain, changes after signing, and revocation when you ask
- Save as PDF/A or PDF/X, and edit document properties and metadata
- Compare two PDFs side by side, with the changes marked
- Extract tables to CSV or Excel, and run the same steps on many PDFs
- Text in any language is saved in embedded fonts
- Better OCR: cleaner scans, pages turned upright, up to three languages at once
- A forms designer with formats, totals and tab order
- Optimize replaces Compress and makes files smaller, never bigger
- More thorough redaction, accessibility tags and a new app icon
```

## App Review notes (1803/4000)

```
No sign-in is needed. The app has no accounts, no in-app purchases and no server: all PDF processing happens on the device.

How to try it:
1. Launch the app and tap "Try a sample PDF" on the start screen (with a PDF open, it is also under Help > Open the sample PDF: the ? button on iPad, the ... More button on iPhone). This opens a two-page guide made on the device.
2. Use the ribbon tabs (Home, Edit, Comment, Pages, Forms, Protect, Export) to try the tools. For example, choose Edit > Edit PDF and tap a line of text to change it, or Comment > Highlight.
3. Save or share the result with the share sheet.

You can also open any PDF from the Files app.

Network use: the app does not send documents anywhere. It goes online only for these optional steps, each started by the user: OCR language data for languages other than English, fetched the first time a user picks that language in Recognize text (OCR) (English OCR works offline); a font for Chinese, Japanese, Korean, Hindi or Thai, downloaded once after asking, the first time such text is saved; when signing with a certificate, a request to the timestamp server the user enters, which receives only a SHA-256 fingerprint of the signature; and, when the user asks to check a signature's revocation, requests to the OCSP or CRL servers named in the signer's certificate (an OCSP server receives only the certificate's serial number and its issuer's fingerprints, never the document; a CRL is a plain download).

No accounts, login, user-generated content shared with others, paid content, in-app purchases, advertising, analytics or AI services. Bundled open-source libraries (pdf.js, pdf-lib, fontkit, Tesseract.js, Lucide) are used under their licenses (Apache 2.0, MIT). The app works the same in all regions; the interface is in English.
```

## Screenshots

iPhone 6.9-inch display, 1320 x 2868 (`APP_IPHONE_67`), in this order:

1. `iphone-01-edit-text.png`
2. `iphone-02-scans-to-text.png`
3. `iphone-03-fill-and-sign.png`
4. `iphone-04-comments.png`
5. `iphone-05-redact.png`
6. `iphone-06-organize-pages.png`

iPad 13-inch display, 2064 x 2752 (`APP_IPAD_PRO_3GEN_129`), in this order:

1. `ipad-01-edit-text.png`
2. `ipad-02-scans-to-text.png`
3. `ipad-03-fill-and-sign.png`
4. `ipad-04-comments.png`
5. `ipad-05-redact.png`
6. `ipad-06-organize-pages.png`

# Mac

The Mac App Store version of the same app (universal purchase): the same name, subtitle, URLs, copyright and categories as above, with this text and these screenshots.

## Promotional text (151/170)

```
Change the words in a PDF in its own font, sign it, fill in forms and black out private details. Free, no account, and your files never leave your Mac.
```

## Description (3161/4000)

```
Change the words in a PDF right where they are, in the PDF's own font. Click a line and type.

Cowdrey.PDF is a full PDF editor that is free, needs no account and works entirely on your Mac. Your files are never uploaded. Nothing is tracked.

Edit what's already there
- Click a line and type: the edit keeps the line's own font, size and colour
- Edit whole paragraphs that reflow as you type
- Set font, size, colour, bold, italic, underline, alignment and line spacing
- Find and replace, including Replace all
- The old words are removed from the saved file, not just covered up
- Add, move, resize, rotate, flip, crop and replace pictures
- Add, change and delete links

Comment and sign
- Highlight, underline, strike through and squiggly underline
- Pen, shapes, clouds, lines and arrows
- Notes, text boxes, callouts and typewriter text
- Stamps such as Approved, Draft and Confidential
- Draw or type your signature and place it on the page
- A Comments panel with replies, status, filters and sorting
- Comments are saved as real PDF comments that other apps can read
- Sign with a certificate (PAdES), with an optional timestamp, and check the signatures in a PDF: the certificate chain, changes made after signing, and revocation when you ask

Organize pages
- Rearrange, rotate, duplicate and delete pages in a page grid
- Insert, replace, extract, split and combine PDFs
- Crop pages and add blank pages
- Add a watermark, background, header and footer, or Bates numbering, and change or remove them later

Forms
- Fill in and clear forms
- Make your own: text fields, check boxes, radio buttons, lists, buttons, dates and signature fields
- Recognize form finds the blank lines and boxes for you
- Flatten a finished form

Protect
- Redact text, areas and search results; redacted content is taken out of the file for good
- Add a password and set what others may print, copy or change
- Remove hidden information such as metadata and attachments
- Optimize a PDF to make it smaller, never bigger
- Save as PDF/A for archiving or PDF/X for print

And more
- OCR turns scanned pages into text you can search, copy and edit, in 27 languages, on your Mac
- Bookmarks you can add, rename, nest and reorder
- Attachments, document properties and page labels
- Read aloud with your Mac's own voices, and a distraction-free Read mode
- Make a new PDF from pictures or the clipboard
- Compare two versions of a PDF side by side, with the changes marked
- Extract tables to CSV or Excel
- Run the same steps on many PDFs at once
- Export pages as pictures or the text as a text file
- Dark mode, with dark pages too
- Keyboard shortcuts and the Mac menu bar, and it works with VoiceOver
- Opens PDFs from Finder and saves back to the same file

Private by design
No account. No upload. No tracking. Every change happens on your Mac, and your PDFs stay where you keep them.

Free and open source
Cowdrey.PDF is free, with no subscriptions, ads or locked features. The code is open source under the MIT License, so anyone can check what it does: github.com/bradleycowdrey/cowdrey-pdf

New to it? Open the sample PDF from the start screen and try every tool.
```

## Keywords (100/100 bytes, 100 characters)

```
annotate,highlight,form,redact,merge,split,ocr,scan,signature,document,watermark,password,read,notes
```

No words from the name or subtitle (cowdrey, pdf, editor, edit, sign, fill, free), no spaces after commas, no plural repeats.

## What's New in 2.1.0 (711/4000)

```
Cowdrey.PDF 2.1, still entirely on your Mac:
- Sign with a certificate (PAdES), with an optional timestamp, and check signatures: certificate chain, changes after signing, and revocation when you ask
- Save as PDF/A or PDF/X, and edit document properties and metadata
- Compare two PDFs side by side, with the changes marked
- Extract tables to CSV or Excel, and run the same steps on many PDFs
- Text in any language is saved in embedded fonts
- Better OCR: cleaner scans, pages turned upright, up to three languages at once
- A forms designer with formats, totals and tab order
- Optimize replaces Compress and makes files smaller, never bigger
- More thorough redaction, accessibility tags and a new app icon
```

## App Review notes (2021/4000)

```
No sign-in is needed. The app has no accounts, no in-app purchases and no server: all PDF processing happens on the Mac.

How to try it:
1. Launch the app and click "Try a sample PDF" on the start screen (with a PDF open, it is also under Help > Open the sample PDF in the menu bar). This opens a two-page guide made on the Mac.
2. Use the ribbon tabs (Home, Edit, Comment, Pages, Forms, Protect, Export) to try the tools. For example, choose Edit > Edit PDF and click a line of text to change it, or select some words and choose Comment > Highlight.
3. Choose File > Save PDF to save back to the file, or File > Save a copy to choose a new place.

You can also open any PDF with File > Open or from Finder (Open With > Cowdrey.PDF).

Sandbox: the app reads and writes only files the user chooses in Open and Save panels or opens from Finder, and keeps security-scoped bookmarks so recent documents can be reopened. Network use: the app does not send documents anywhere. It goes online only for these optional steps, each started by the user: OCR language data for languages other than English, fetched the first time a user picks that language in Recognize text (OCR) (English OCR works offline); a font for Chinese, Japanese, Korean, Hindi or Thai, downloaded once after asking, the first time such text is saved; when signing with a certificate, a request to the timestamp server the user enters, which receives only a SHA-256 fingerprint of the signature; and, when the user asks to check a signature's revocation, requests to the OCSP or CRL servers named in the signer's certificate (an OCSP server receives only the certificate's serial number and its issuer's fingerprints, never the document; a CRL is a plain download).

No accounts, login, user-generated content shared with others, paid content, in-app purchases, advertising, analytics or AI services. Bundled open-source libraries (pdf.js, pdf-lib, fontkit, Tesseract.js, Lucide) are used under their licenses (Apache 2.0, MIT). The interface is in English.
```

## Screenshots

Mac, 2880 x 1800 (`APP_DESKTOP`), in this order:

1. `mac-01-fill-and-sign.png`
2. `mac-02-edit-text.png`
3. `mac-03-scans-to-text.png`
4. `mac-04-comments.png`
5. `mac-05-redact.png`
6. `mac-06-organize-pages.png`
