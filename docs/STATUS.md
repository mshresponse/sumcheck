# Sumcheck — where the project stands

**Version 1.6.0 · 19 August 2026 · written for whoever picks this up next**

> **Renamed 17 August 2026: MDForge → Sumcheck.** "MDForge" collided with a
> same-pitch Windows app, a dental platform on mdforge.com, a PyPI package and
> an arXiv project. "Sumcheck" has no product collisions and names the
> differentiator: the converter that checks the sums. Earlier entries in
> `DEVLOG.md`, `CHANGELOG.md` and the archived work orders keep the old name —
> they are the historical record, and rewriting it would falsify it. The review
> markers written into converted documents moved with the product:
> `<!-- MDFORGE: … -->` is now `<!-- SUMCHECK: … -->`.

Sumcheck is a Chrome MV3 extension that converts documents to Markdown, HTML,
plain text or structured JSON entirely on the user's machine. It makes no
network requests at runtime, which is both its privacy story and the reason it
can touch medical records at all.

This document is the honest state of it: what works, what is verified against
real documents, and what is still wrong. For release notes see
[`CHANGELOG.md`](../CHANGELOG.md); for the commercial licensing analysis see
[`LICENSING.md`](LICENSING.md).

---

## 1. What was built

**Inputs.** PDF (text layer *and* scanned, via OCR), Word, Excel, PowerPoint,
OpenDocument text/sheets/slides, EPUB, images, saved web pages and `.mhtml`,
email, CSV/TSV, JSON/JSONL/YAML/XML, Jupyter notebooks, subtitles, RTF, Markdown
and ~20 source-code extensions. A dropped `.zip` is expanded and its members
queued.

**Outputs.** Markdown (GFM or CommonMark, optional YAML front matter), a
self-contained styled HTML file, plain text, and a block-structured JSON
document that carries each block's text *and* its Markdown with page numbers
attached — the shape a RAG or search pipeline wants.

**Architecture.** `bytes → detect → adapter → HTML → sanitize → structure repair
→ image policy → emitters`. Every adapter's only job is to produce HTML, so
adding an input format means one file in `src/core/adapters/` and one line in the
registry. All dependencies are permissive-licensed and vendored locally; MV3
forbids remote code.

**Verification layer.** OCR confidence scalars, a currency-symbol validator, line
item vs total arithmetic reconciliation, and ink-coverage detection that marks
regions where the page had content OCR could not read. Nothing is ever silently
rewritten.

---

## 2. Where it stands, measured

Scored with `npm run score-export` against a 50-document ground-truth set for a
corpus of scanned medical Good Faith Estimates (96 dpi, no text layer):

| | v1.0.0 | v1.1.0 | v1.2.0 | v1.3.0 | v1.6.0 |
| --- | --- | --- | --- | --- | --- |
| grand totals matched | — | 50/50 | 50/50 | 50/50 | **50/50** |
| all line-item codes found | — | 49/49 | 49/49 | 49/49 | **49/49** |
| each amount on its code's row | — | 52/52 | 52/52 | 52/52 | **52/52** |
| `#Error` string preserved | — | 50/50 | 50/50 | 50/50 | **50/50** |
| documents emitting a real table | 0/50 | 0/50 | 3/50 | 49/50 | **49/50** |
| headline total recovered | — | 1/50 | 1/50 | 44/50 | **44/50** |
| documents with no table and no note | — | 50/50 | 47/50 | 0/50 | **0/50** |
| review markers vs actual misses | — | — | — | 6 = 6 | **6 = 6** |
| independent audit defects | 121 | 0 data errors | 0 data errors | 0 data errors | 0 data errors |

1.4.0 and 1.5.0 were ship-readiness and rename cycles and changed no conversion
behaviour, so they carry v1.3.0's column. 1.6.0 changed three conversion paths
and moved nothing here — deliberately: the corpus is single-page scanned forms,
and each of those changes was written to decline on that shape.

Conversion wall-clock, first recorded in 1.6.0 on this machine:

| corpus | pages | wall-clock | per page |
| --- | ---: | ---: | ---: |
| Net Zero Cloud guide (text layer) | 1,349 | 3.1 s | 2.3 ms |
| Good Faith Estimates (scanned, OCR) | 50 | 39.4 s | 0.79 s |

The factor of ~340 between them is OCR. Any single pages-per-second figure for
this converter is a statement about the corpus, not about the converter.

The numeric defect class that started this — `$` read as `3`, inflating a price
~8.5×; `14835` read as `44835`; invalid CPT codes — is gone, verified across 50
real documents. Root cause was resolution: v1.0.0 upscaled a 96 dpi scan by 1.5×,
which smears one-pixel strokes. Measured against ground truth:

| render scale | fields correct |
| --- | --- |
| native 96 dpi | 5/14 |
| 1.5× (v1.0.0) | 12/14 |
| **2× (current)** | **14/14** |

45 automated cases pass (`npm test`), covering every adapter plus regressions for
a 96 dpi billing form, a shaded callout, a wrapped-cell table, a real corpus page,
the rescue pass re-reading ink it had already read, nested key-value structure
inside a table cell, running heads and printed folios, a wrapped display title,
and a diagnostic block proved to contain nothing of the document. A further 51
checks run the packaged extension in Chrome (`npm run verify-extension`).

---

## 3. Open problems

### 3.1 Tables — RESOLVED in the v1.3.0 cycle

**Superseded. See `DEVLOG.md` → Task 4.** 3/50 → **49/50**, with the one
exception documented rather than forced: GFE (46) is a zero-charge research scan
with no line item, so its money columns appear exactly once and nothing can align
to them. It emits `table_fallback: 1`. Zero documents are silent.

The two causes were a wrapped-cell test bounded by the previous fragment's right
edge, and a 60%-occupancy rule that discarded the sparse service-date column and
collapsed the row that used it. The second also explains why the few documents
that did table promoted their first line item into the header row.

### 3.2 Spurious deep headings — RESOLVED in the v1.3.0 cycle

**Superseded. See `DEVLOG.md` → Task 2.** 6 across 5 files → **0**, with no
legitimate heading lost.

### 3.3 The headline total — RESOLVED in the v1.3.0 cycle

**Superseded. See `DEVLOG.md` → Task 3 for the evidence.** The original text
here would send a reader chasing a theory that has since been disproven, so the
corrections are recorded in its place:

- **It is not a shaded callout.** The region is large, crisp black text on
  near-white paper (levels 247–251 against 0). The `#d8d8d8` contrast theory came
  from a synthetic experiment and does not describe this corpus.
- **The cause was page-level layout analysis**, not pixels. Tesseract discarded
  that block before recognizing anything in it; the same pixels cropped out of
  the page read correctly.
- **There was no v1.1.0 → v1.2.0 regression.** Both builds recovered exactly one
  file. The reported "1 → 0" came from a measurement that counted the table's
  total row as a headline.
- **Now 44/50 recovered** (43 by a crop-based rescue), 6 misses, all 6 marked.
  Every recovered figure is cross-checked against the totals stated elsewhere on
  the page — 43/43 match ground truth exactly, 0 mismatches flagged.
- The 6 remaining misses are all *short* values (`$50.00`, `$40.00`, `$0.00`):
  region flagged, crop attempted, nothing returned. GFE (46)'s `$0.00` is a real
  printed value (owner ruling) and counts as a genuine miss, not a special case.

Marker invariant, owner-confirmed: **markers == misses, exactly** — every miss
carries one, no recovered page does.

### 3.4 The confidence discrepancy — EXPLAINED, on narrower grounds than first claimed

**Superseded. See `DEVLOG.md` → Task 1 for the controlled-variable table, and
Task 4 for the correction below.**

The `Tax = 1` vs `96` gap is **a tokenization difference**, not a plumbing bug.

Corrected 2026-08-15: this section previously read "on identical pixels, PSM
alone moves `Tax` from 24 to 60." Task 4 established by hash comparison that
`tessedit_pageseg_mode` is accepted and discarded by tesseract.js 6.0.1 — so
nothing in this pipeline can have varied PSM, and that sentence cannot be true
as written. **The 24 → 60 swing is OPEN: real numbers, unexplained variable.**
It is not load-bearing here; the closure rests on the tokenization evidence
alone, which is sufficient on its own:

- The reviewer's "96" is not a measurement of `Tax`. CLI tesseract 5.5.3 emits
  **`TaxID:` as a single token at 66.8** — it never produces `Tax` as a word on
  this page. The ~96 in that region belongs to `provider` (96.4).
- Where both engines emit the same token, the native CLI scores 8–25 points
  higher, and is not uniformly better: it reads `included` as `inchided`.
- The repetition across files is expected, not a bug: those tokens are
  boilerplate at pixel-identical positions and the engine is deterministic.

Flag rate re-measured at threshold 70: **266 flags across 12,881 words (2.1%)**,
10 distinct tokens; **correct 212 · incorrect 51 · unverifiable 3** after raster
verification of `Cenvical` (a genuine misread) and `04-3642199` (read correctly).

### 3.5 Marker placement — RESOLVED in the v1.3.0 cycle

v1.1.0 landed 50 of 52 `not recovered` markers immediately after values that had
been recovered correctly. Markers now equal misses exactly — 6 documents, 6
markers, owner-confirmed invariant. See `DEVLOG.md` → Task 3 and Task 4; the
last false marker (four sub-line-height slivers between money columns) went in
Task 4.

### 3.6 Smaller known defects

- `PATIENT DETAILS: M H` collapses to `MH` in **50/50** files. Cosmetic, an OCR
  word-segmentation artifact, unchanged since v1.0.0.
- A stray `#` appeared mid-line in (49) in v1.1.0 (`Total Estimated Costs: # $7,311.39`).
  Not re-checked in v1.2.0.

---

## 4. Not verified at all

- **Any input format not in the corpus.** The 45 automated cases cover every
  adapter, but only PDFs have been tested against real third-party documents.
- **Capturing a page without `activeTab`.** Chrome grants `activeTab` only on a
  real toolbar or context-menu click, which no headless driver can synthesise.
  `verify-extension` asserts the denial instead, and proves the logic behind the
  gate against a throwaway build carrying an explicit host permission. The grant
  itself is Chrome's to enforce and has not been observed.

Resolved in v1.3.0: the extension had never been loaded in Chrome. It has now —
20 of 20 MV3 checks pass, including one real scanned PDF converted end to end
through the app UI, byte-identical to the audit pipeline's output for the same
file. Rerun with `npm run verify-extension -- <a.pdf>`.

## 5. The lesson worth keeping

v1.2.0's rescue pass reassigned a `const`. Every fixture happened to have zero
unread-ink regions, so the branch never executed in 29 passing tests. On real
scans it runs on every page: **OCR failed on all 50 documents**, silently, with
the suite green.

Fixtures encode what you already thought of. This project has twice had a rule
that passed a synthetic test and broke every real document — the other being a
footer drawn unrealistically tight under a table, which argued for a table rule
that produced zero tables on the corpus. Re-run `npm run audit` against real
documents before believing a green test run.

---

## 6. Commands

```bash
npm run build      # fetch vendored dependencies, draw icons, generate notices
npm test           # 38 conversion cases in headless Chrome
npm run dev        # server on :8931 with the extension's real CSP
npm run check      # pre-publish validation
npm run package    # dist/mdforge-<version>.zip
npm run verify-extension -- <a.pdf>   # 20 MV3 checks against an unpacked install

npm run audit -- <dir-of-pdfs> --emit <out-dir>        # convert a real corpus
npm run score-export <dir-of-md> <groundtruth.json>    # score against expectations
```

The audit serves a corpus read-only from where it already lives and copies
nothing, which matters for documents containing personal data.

---

## 7. What is actually left

Refreshed 2026-08-15, after Tasks 1–4 of the v1.3.0 cycle. Items 1–4 of the
previous list are **done** — see `DEVLOG.md` for each: the confidence gap is
explained (token segmentation; see §3.4), the spurious headings are gone (6 → 0,
no legitimate heading lost), the headline total went 1/50 → 44/50 with every
remaining miss marked, and table detection went 3/50 → 49/50 with zero silent
cases and all five scored metrics held at 100%.

**Open:**

1. **Task 5 — load the extension in Chrome.** The MV3 wiring has still never
   been exercised: service worker registration, the popup's three entries,
   context menus, the `chrome.storage.session` handoff, and the optional
   permission prompt on "Convert linked file".
2. **The 6 short-value crop misses** — GFE (37) (38) (39) (40) (41) (46), all
   `$50.00`/`$40.00`/`$0.00`. Region flagged, crop attempted, nothing returned.
   Characterized, unfixed; all 6 correctly marked. (46)'s `$0.00` is a real
   printed value (owner ruling), not a special case.
3. **GFE (46) emits `table_fallback: 1` rather than a table.** A zero-charge
   research scan with no line item: one total row, so its money columns appear
   exactly once and nothing can align to them. Documented, not forced.

**Deferred by the work order, tracked but not in this cycle:**

- `M H` → `MH` name collapse (50/50, cosmetic, unchanged since v1.0.0).
- Stray `#` mid-line in (49) from v1.1.0 — re-check during a corpus run.
- Product-review items (password modal, queue rendering, OffscreenCanvas, i18n,
  packaging size) — separate work order.
- `tessdata_best` shows no measured benefit over standard on this corpus and
  costs ~11 MB; packaging decision, owner's call.
- Crop-rescue padding constants are template-tuned against this corpus's
  geometry; prefer deriving them if the code is revisited.
- Page-segmentation mode is not settable in tesseract.js 6.0.1 (measured, see
  DEVLOG Task 4). If the engine is ever upgraded, PSM 3 remains the right mode
  on CLI evidence.


