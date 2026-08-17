# Chrome Web Store listing copy

Paste-ready. Field names match the developer dashboard's **Store listing** tab.
Every claim here is verifiable from the repository — see `CHECKLIST.md` for how
each one is checked.

---

## Name (45 characters max)

```
Sumcheck — PDF & Document to Markdown
```

36 characters. Matches `manifest.json` via `__MSG_appName__`.

---

## Summary (132 characters max)

```
Convert PDFs, Office files and web pages to Markdown, HTML, text or JSON. Runs entirely on your device — no uploads, ever.
```

121 characters.

---

## Description

```
Sumcheck turns documents into Markdown without sending them anywhere.

Everything happens inside your browser. The extension makes zero network
requests at runtime — no uploads, no accounts, no per-page API charges, no
telemetry. That is not a promise about a server's behaviour; it is a property
of the code, and you can check it: the package contains no network calls, and
Chrome's own extension platform blocks remotely hosted code.

WHAT IT CONVERTS

• PDF — including scanned pages, read with on-device OCR
• Word, Excel, PowerPoint, and their OpenDocument equivalents
• EPUB, HTML, saved web pages and .mhtml, email (.eml)
• Images (PNG, JPEG, TIFF, WebP, BMP, GIF) via OCR
• CSV/TSV, JSON, JSONL, YAML, XML, Jupyter notebooks, subtitles, RTF
• The current browser tab, or just the text you have highlighted
• Drop a .zip and it converts what is inside

WHAT YOU GET

Markdown (GitHub-flavoured or CommonMark, with optional YAML front matter), a
self-contained HTML file, plain text, or structured JSON that keeps each block's
text, its Markdown and its page number — the shape a search or RAG pipeline
wants.

IT TELLS YOU WHAT IT IS UNSURE ABOUT

Most converters hand you text and leave you to trust it. Scanned documents are
where that gets expensive: a "$" misread as a "3" turns $40.00 into 340.00, and
the result looks perfectly reasonable.

Sumcheck checks its own work and marks what it cannot vouch for:

• Currency columns where one amount lost its "$"
• Line items that do not add up to the stated total
• A prominent total that matches nothing else on the page
• Words that are not words — a confidently misread "included" as "inchided"
• Regions of a page that carried content OCR could not read at all

Every flag is written where a reader will see it. Nothing is ever silently
rewritten: on a price list, a converter that quietly "corrects" a figure is
worse than one that is visibly unsure.

Each converted file also carries its own OCR confidence scores, the resolution
it was read at, and a list of the words the engine was least certain of.

FOR DOCUMENTS THAT MATTER

Convert for reading; keep the original for verifying. Sumcheck is built to make
that second step short rather than to pretend it is unnecessary — the flags tell
you which figures to check. A misreading that produces a different real word is
invisible to any automated check, and this one says so rather than claiming
otherwise.

OPEN ABOUT ITS LIMITS

The conversion quality is measured against a 50-document ground-truth set of
real scanned medical estimates, not asserted.

Sumcheck is open source under the Apache License 2.0. The "no network requests"
claim above is not a promise you have to take on trust — the source is public
and you can read it:

https://github.com/mshresponse/sumcheck

Third-party components are all permissively licensed and listed in the package.
```

---

## Category

`Productivity` → `Workflow & Planning`

## Language

English (United States)

---

## Store icon

`icons/icon-128.png` — 128×128 PNG, already in the package.

## Screenshots (1280×800, generated)

`npm run verify-extension -- <a-scanned.pdf> --screenshots store/screenshots`

| file | shows |
| --- | --- |
| `01-drop-zone.png` | the empty state — what the extension is |
| `02-batch-in-progress.png` | six scans converting, live per-file OCR progress |
| `03-review-markers.png` | a converted scan with its notes and inline review markers |

The third is the one that matters. It is the only screenshot in this category
that shows a converter admitting uncertainty.

## Small promo tile (440×280)

**Not yet produced.** Optional, but listings without one rank lower in search.
Flagged in `CHECKLIST.md` as an open decision rather than quietly skipped.
