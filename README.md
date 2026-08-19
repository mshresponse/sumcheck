# Sumcheck

[sumcheck.app](https://sumcheck.app) · [Source](https://github.com/mshresponse/sumcheck) · [Privacy policy](https://sumcheck.app/privacy/) · Apache 2.0

A Chrome extension that turns documents into Markdown — and into HTML, plain
text, or structured JSON — **entirely on the user's machine**. No account, no
upload, no per-page API cost. The extension makes zero network requests at
runtime; `npm run check` enforces that, and MV3's CSP makes it impossible to
smuggle in remote code later.

That property is the product. Everything else is table stakes.

---

## What it converts

| From | Notes |
| --- | --- |
| **PDF** | Text layer *or* OCR. Infers headings from type size, rebuilds lists and grid-aligned tables, keeps hyperlinks (including links inside a sentence), strips repeated headers/footers, detects two-column layouts, handles password-protected files |
| **Word** `.docx .docm .dotx` | Semantic styles via mammoth, images inline |
| **Excel** `.xlsx .xlsm .xltx` | Every sheet, shared strings, date and percent formats decoded, cell hyperlinks |
| **PowerPoint** `.pptx .pptm .potx` | One section per slide, nested bullets, tables, pictures, speaker notes |
| **OpenDocument** `.odt .ods .odp` | Text, spreadsheets and presentations |
| **EPUB** | Spine order, chapter breaks, inline images, metadata |
| **Images** `.png .jpg .gif .bmp .webp .tif` | OCR, with headings recovered from glyph size |
| **Web pages** | The current tab, a selection, or a saved `.html`/`.mhtml`, with Readability stripping page furniture |
| **Email** `.eml` | Headers, best body part, attachment list, RFC 2047 + quoted-printable decoding |
| **Data** `.csv .tsv .json .jsonl .yaml .xml` | Uniform records become tables |
| **Notebooks** `.ipynb` | Markdown cells verbatim, code fenced by kernel language, outputs kept |
| **Subtitles** `.srt .vtt` | Merged back into a readable transcript with timestamps |
| **Text & code** `.md .txt .log .rtf` + 20 source extensions | Markdown passes through untouched |
| **`.zip`** | Expanded, and every convertible member queued |

Outputs, any combination at once:

- **`.md`** — GitHub Flavored or CommonMark, optional YAML front matter
- **`.html`** — one self-contained, styled, dark-mode-aware file
- **`.txt`** — plain text with tables aligned
- **`.json`** — a block-structured document (`sumcheck.document/v1`): every block
  typed, with its plain text *and* its Markdown, page numbers attached, and
  tables also emitted as records. This is the shape RAG pipelines and search
  indexers want, and it is the format that makes the extension worth paying for
  to a technical audience.

---

## Install for development

```bash
npm run build
```

That fetches every dependency into `vendor/` (~12 MB), draws the icons, and
generates the third-party notices. Then in Chrome: `chrome://extensions` →
enable **Developer mode** → **Load unpacked** → select this folder.

`npm run build` is the only step with network access. After it, the extension is
self-contained.

## Everyday commands

```bash
npm run dev       # static server on :8931 with the extension's real CSP
npm test          # headless Chrome runs test/harness.js — 26 conversion cases
npm run check     # pre-publish validation (missing files, remote loads, vendor)
npm run package   # dist/sumcheck-<version>.zip, ready for the Web Store
```

`npm run dev` also serves the UI at
<http://localhost:8931/src/app/app.html>, which is the fastest way to iterate on
conversion logic — no extension reload, and `chrome.*` degrades gracefully.

---

## How it works

```
bytes
  ↓  detect.js          magic bytes first, extension second, MIME last
  ↓  adapters/*.js      one file per input format  →  HTML
  ↓  sanitize.js        DOMPurify, because a converted file is untrusted input
  ↓  postprocess.js     recover headings/lists from direct-formatted documents
  ↓  convert.js         image policy: embed | extract | link | strip
  ↓  emit/*.js          markdown · html · text · json
```

Every adapter's only job is to produce HTML. Everything downstream is shared, so
**adding an input format means adding one file to `src/core/adapters/` and one
line to the registry in `src/core/convert.js`** — no changes to the emitters, the
UI, or the queue.

A few decisions worth knowing before you change things:

- **HTML as the intermediate representation.** It has headings, lists, tables,
  emphasis and links already, every adapter can target it, `DOMPurify` can
  sanitize it, and Turndown handles the Markdown translation. A bespoke document
  model would have been more code and less fidelity.
- **PDF structure is inferred, not read.** A PDF has positioned glyphs, not
  paragraphs. `adapters/pdf.js` clusters glyph runs into lines, lines into
  blocks, and applies size/indent/alignment heuristics. Table detection is
  deliberately conservative: a wrong table is worse than no table.
- **OCR renders with print intent.** pdf.js's display renderer is driven by
  `requestAnimationFrame`, which browsers suspend in background tabs — a long
  OCR job would stall the moment the user switched away.
- **The queue runs one file at a time.** OCR and rasterizing are CPU-bound;
  parallelism would only make the progress bar lie.
- **Structure repair.** Plenty of real `.docx`/`.rtf`/`.odt` files have no
  heading styles and no list numbering — just bold paragraphs and lines starting
  with "•". `postprocess.js` recovers the intent. This is the difference between
  usable and useless output on documents exported from Pages, Google Docs, or
  macOS `textutil`.

### When to trust the output

**Convert for reading; keep the original for verifying.** Sumcheck is excellent
for text-heavy documents consumed for their content — reports, letters,
articles, contracts being summarized. For documents where *structure is the
data* — invoices, price quotes, financial statements, lab results — treat the
conversion as a working copy and check figures against the source. A converted
file should never be the only copy of something you need to be correct about.

The output tells you which kind of document you got. Every OCR'd file carries:

```yaml
ocr: true
ocr_dpi: 192
ocr_confidence_mean: 95.6
ocr_confidence_min: 94
ocr_flagged_fields: 0
ocr_unreadable_regions: 0
needs_review: true          # only when a validator found something
review_flags: 2
ocr_low_confidence:         # the words the engine was least sure about
  - text: "44835"
    confidence: 61
    page: 1
```

and anything suspicious is marked inline where a reader will see it:

```markdown
| Imaging | 340.00 <!-- SUMCHECK: "340.00" may be "$40.00" with the "$" misread as "3" --> |
| Total   | $95.00 <!-- SUMCHECK: line items sum to $380.00 but the total row says $95.00 --> |
```

Validators run on every document, because OCR confidence only catches *loud*
failures — a "$" misread as "3" produces `340.00`, which scores in the 90s
because it is a perfectly good number:

- **Currency sigil check** — a bare amount in a column whose siblings carry "$".
- **Arithmetic reconciliation** — line items that do not sum to their total row.
- **Headline reconciliation** — a prominent total that matches no other figure
  on the page.
- **Prose lexicon** — a word that is not a word. Runs on OCR'd prose regardless
  of confidence, because a language pack can be perfectly confident about
  nonsense: `"inchided" is not a recognised word — it may be "included"`. It
  stays quiet on clinical vocabulary, procedure descriptors, proper nouns and
  abbreviations; measured on 50 real scanned estimates it flagged the one real
  error in all 50 and nothing else.

None of them ever rewrites a value. On a price list, a converter that silently
"corrects" figures is worse than one that is wrong loudly.

#### What no automated check can catch

Every check above finds things that are *visibly* wrong — a number that does not
add up, a word that is not a word. **A misreading that produces a different real
word is invisible to all of them**, and always will be: "from" read as "form",
"1" read as "7", "hip" read as "hip" on the wrong line. Nothing in the output
will look unusual, because nothing is unusual — the text is ordinary English and
the figures are ordinary figures.

The flag layer narrows the risk. It does not eliminate it, and no amount of
additional validation would. This is the reason the guidance at the top of this
section is not softened anywhere else in this document: **convert for reading,
verify against the original.** For a document where a wrong number has
consequences, a human comparing the conversion to the source is the last line of
defense, and it is not optional.

### OCR accuracy, measured

Resolution is the dominant factor on scans, and the intuitive answer is wrong.
Reading a 96 dpi billing form (the `96 dpi billing form` case in
`test/harness.js`), scored against ground truth:

| render scale | fields correct | confidence |
| --- | --- | --- |
| native 96 dpi, no resampling | 5/14 | 62 |
| 1.5× (144 dpi) | 12/14 | 94 |
| **2× (192 dpi)** | **14/14** | **95** |
| 3.1× (300 dpi) | 14/14 | 95 |

Tesseract wants roughly 30 px of x-height; a 96 dpi scan gives it about 6, so
it is guessing at glyph shapes. That is how a "$" loses its stroke and reads as
"3" — an ~8.5× price inflation that still looks like a valid figure. Note the
1.5× row: it recovers most of the page but still drops a headline figure in a
shaded box and corrupts a URL. Under-scaling fails quietly on the hardest
elements first, which is the worst way to fail.

So `ocrResolution: 'auto'` detects a scan's own resolution and renders at a
whole multiple of it, targeting at least 200 dpi. Pages are converted to
grayscale (no accuracy change, ~1.6× faster) and handed to Tesseract otherwise
untouched — its own binarization is tuned for text, and pre-processing is a
second, cruder pass that eats thin strokes.

Sumcheck ships `tessdata_best`, not `tessdata_fast`. Fast is the tempting
default and the wrong one for documents: it loses accuracy on small type, which
is exactly where a scanned invoice lives. Trade back with
`node scripts/fetch-vendor.mjs --quality fast` (saves ~11 MB, costs accuracy).

### Auditing a real corpus

```bash
npm run audit -- ~/path/to/documents
npm run audit -- ~/docs --expect expectations.json --out august
```

Converts every document in a directory and reports confidence, flagged words,
unreadable regions and validator findings per file, writing `audit-report.md`
and `audit-results.json`. The corpus is served read-only from where it already
lives — nothing is copied, which matters for documents containing personal
data. Supply expectations to assert known-good values:

```json
{
  "*": { "mustContain": ["14835 Southwest Fwy"],
         "mustNotMatch": ["\\|\\s*[\\d,]+\\.\\d{2}\\s*\\|"] },
  "file (49).pdf": { "mustContain": ["3310 Richmond Ave"] }
}
```

### OCR languages

English ships by default. To add more:

```bash
node scripts/fetch-vendor.mjs --langs eng,deu,fra,spa
```

Then add them to `BUNDLED_LANGUAGES` in `src/core/ocr.js` so they appear in the
settings dropdown. Each language costs roughly 1–4 MB of package size. Add
`--osd` if you want orientation detection for rotated scans (+4 MB).

### Testing

`test/harness.js` holds every conversion case. It runs two ways: `npm test`
drives it in headless Chrome and exits non-zero on failure, or open
<http://localhost:8931/test/harness.html> to see each case's checks, warnings and
full Markdown output side by side. Fixtures come from
`node scripts/make-fixtures.mjs` (checked in under `test/fixtures/`); the OCR and
scanned-PDF cases build their own images at runtime.

---

## Publishing

`npm run package` runs the pre-publish checks and writes `dist/sumcheck-<version>.zip`.

For the store listing, the permissions justify themselves:

| Permission | Why |
| --- | --- |
| `activeTab` + `scripting` | Read the current page only when the user clicks "Convert this page" |
| `contextMenus` | The right-click entries |
| `storage` | Remember settings; hand a captured page to the converter tab |
| `optional_host_permissions` | Requested per-site, only for "Convert linked file" |

There is no `host_permissions`, no `tabs`, no analytics, and no remote code.
The privacy answer is "no data is collected", and it is verifiable by inspection.

**Licensing for a commercial release: see [`docs/LICENSING.md`](docs/LICENSING.md).**
Short version: every dependency is MIT / Apache-2.0 / BSD / OFL, nothing is
copyleft, you may sell this, and your obligation is to ship
`THIRD_PARTY_NOTICES.md` (which `npm run package` already includes).

---

## Known limitations

Stated plainly, because they are the things a user will notice first:

- **PDF tables** are reconstructed from column alignment — including on scanned
  pages, from OCR word boxes. Tables with merged cells, or laid out with ruling
  lines and no consistent column positions, fall back to a preformatted block
  that preserves the spatial alignment rather than a run-on paragraph.
- **OCR gets things wrong.** The point of the confidence fields, the validators
  and the inline markers is that it should be wrong *visibly*. A converted
  billing document with `needs_review: true` is doing its job; one with clean
  output and no flags is worth spot-checking anyway.
- **Multi-column PDFs** are detected only for the two-column case. Three or more
  columns are read in single-column order.
- **Legacy Office files** (`.doc`, `.xls`, `.ppt` from Office 97–2003) are
  detected and rejected with an explanation rather than half-converted.
- **OCR quality** tracks scan quality. Below ~200 dpi results degrade quickly;
  the converter surfaces a low-confidence warning rather than pretending.
- **Equations** are not converted to LaTeX; they arrive as text or, in scans, as
  whatever OCR makes of them.
- **PDF figures** are not extracted as images — only page text is converted.
  Embedded images in `.docx`, `.pptx`, `.odt` and `.epub` *are* extracted.

## License

Sumcheck is licensed under the [Apache License 2.0](LICENSE). You may use,
modify, distribute and sell it, including in closed-source products, provided
you keep the copyright and licence notices and state what you changed.

Apache §6 does not grant trademark rights, and that is intentional: a fork gets
the code, not the name or the mark.

Bundled third-party components keep their own permissive licences — see
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and [`NOTICE`](NOTICE).
