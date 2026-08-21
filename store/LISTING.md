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

> **This field is package-sourced and CANNOT be edited in the dashboard.** It is
> `appDescription` in `_locales/en/messages.json`, reached by `manifest.json`'s
> `description: "__MSG_appDescription__"`. Changing it requires a new zip.
>
> That is what the second Keyword Spam rejection ("Yellow Argon") was about. The
> first rejection was fixed in the dashboard's Description field, which left this
> one shipping untouched — and it is the string the reviewer quoted.

```
Convert documents to clean Markdown, entirely on your device — and see what the conversion was unsure about. No uploads, ever.
```

126 characters, shipped in `dist/sumcheck-1.7.2.zip`. **No format enumeration.**
Two rejections establish the rule: a comma-run of format names reads as keyword
stuffing regardless of how accurate each name is.

---

## Description

> **Two surfaces, one rule. Do not re-add file-format enumerations to either.**
>
> The listing's copy lives in two places and both were rejected for Keyword Spam
> before this was understood:
>
> 1. **The dashboard's Description field** — editable by the owner. Softened after
>    the first rejection.
> 2. **The package's `appDescription`** in `_locales/en/messages.json`, reached by
>    `manifest.json`'s `description: "__MSG_appDescription__"`. **Not editable in
>    the dashboard.** It survived the first correction untouched and was the string
>    the second rejection quoted. Changing it needs a new zip.
>
> A comma-run of format names reads as keyword stuffing regardless of how accurate
> each name is. The precise list belongs in the README, the product UI and
> sumcheck.app — surfaces that are not subject to store copy review.
>
> **Owner's decision of record: submit lean, then iterate.** Any future expansion
> of this description happens from a *live* listing, where a rejected edit costs an
> edit rather than taking the extension down.
>
> The text below is the authoritative submitted copy, pasted unmodified into the
> dashboard by the owner and confirmed verbatim. Reconcile against the dashboard,
> never against memory.

```
Sumcheck turns documents into Markdown without sending them anywhere.

Everything happens inside your browser. The extension makes zero network
requests at runtime — no uploads, no accounts, no per-page API charges, no
telemetry. That is not a promise about a server's behaviour; it is a property
of the code, and you can check it: the package contains no network calls, and
Chrome's own extension platform blocks remotely hosted code.

WHAT IT HANDLES

Drop in a PDF — born-digital or scanned; scans are read with on-device OCR.
Office documents, ebooks, saved web pages, images of documents and common
data files convert the same way, and so does the browser tab you are looking
at, or just the text you have highlighted. Drop a .zip and it converts what
is inside. The full list of supported formats lives at sumcheck.app.

WHAT YOU GET

Clean Markdown, ready for your notes, your repo, or your pipeline. The same
conversion can instead produce a self-contained HTML file, plain text, or
structured JSON that keeps each block's text and its page number — the shape
a search or RAG pipeline wants.

IT TELLS YOU WHAT IT IS UNSURE ABOUT

Most converters hand you text and leave you to trust it. Scanned documents are
where that gets expensive: a "$" misread as a "3" turns $40.00 into 340.00, and
the result looks perfectly reasonable.

Sumcheck checks its own work and marks what it cannot vouch for:

- Currency columns where one amount lost its "$"
- Line items that do not add up to the stated total
- A prominent total that matches nothing else on the page
- Words that are not words — a confidently misread "included" as "inchided"
- Regions of a page that carried content OCR could not read at all

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

https://sumcheck.app  ·  https://github.com/mshresponse/sumcheck

Third-party components are all permissively licensed and listed in the package.
```

## Homepage and privacy policy

| dashboard field | value |
| --- | --- |
| Homepage URL | `https://sumcheck.app` |
| Privacy policy URL | `https://sumcheck.app/privacy/` |

Both are served by GitHub Pages from `docs/` in the public repository. The
submission was filed with the earlier `mshresponse.github.io` URLs, which now
301 to these, so the submitted links still resolve.

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

`store/promo-440x280.png` — submitted with the listing.
