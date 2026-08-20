# Changelog

## 1.7.1

One defect, three symptoms, and the measurements that found it was not the defect
anyone expected.

### Tables keep their headers

A long table in a reference manual is broken up by full-width group rows —
`General Enhancements`, `Platform Services` — sitting between the column header
and the rows they group. Those rows are one cell wide, and a one-cell row used to
**end the table**. The header was severed from its own data, and a header stack
read on its own resolves five columns into three with the labels packed into the
first.

A group row is now absorbed into the table it belongs to, on conditions measured
rather than guessed: not bold, the same size as the table body, and a real row
following it. Every one of the 116 group rows in the benchmark document is
non-bold and body-sized; a heading between two tables is neither, which is what
keeps two unrelated tables from being fused.

On the 1,010-page benchmark: **206 tables become 122**, tables carrying a fully
correct header go from **21 to 59**, and the continuation-merge introduced in
1.7.0 now fires 8 times instead of 3 — not because that rule changed, but
because headers finally match.

### Known trade in this release

Where prose correctly becomes a table row, **any link on that text is lost** —
table cells have never carried link targets. On the benchmark this costs 554 of
3,612 links. No visible text is lost; the 61 words that changed are repeated
column headers that a merged table no longer prints twice. The gap is
pre-existing and newly visible, and it is tracked separately.

### Still open

Header assembly reaches 48% of tables against the reference implementation's
87%. The remaining cases need column clustering to treat each line's own
fragments as definitionally distinct rather than pooling every row into one pass
— a different algorithm, not a tuning. The clustering tolerance was tested at
half its value: it removes every remaining stranded header and costs twelve
correct ones, so it stays as it was.

Corpus scores are unchanged for the fifth release running, and this time that was
the point: a change to table detection is the most dangerous thing that can be
done to a corpus of scanned forms. All 50 documents convert byte-identically —
249 table rows before and after, zero words changed.

## 1.7.0

A conversion-quality cycle scoped entirely from one benchmark: the Salesforce
Winter '27 release notes, 1,010 pages, typeset by a different engine from
anything the converter had been tuned against. Seven defect classes came out of
it; six are closed here.

### Headings now come from the document, not from guesswork

**A PDF's embedded outline is the heading authority when it has one** (#15).
Born-digital PDFs usually state their heading tree outright — the Winter '27 file
lists 1,968 entries — and re-deriving it from type size is guesswork against data
already in the file. Font-size inference remains the fallback, and it is still
what every scanned document uses.

**A bullet no longer makes a heading** (#10). A line's size was the largest glyph
on it, so a bullet drawn at 19.2 pt in front of 12.8 pt text carried the whole
line over the heading threshold. 713 list items were headings; now they are list
items.

**Headings no longer print their own text twice** (#11). Where a PDF fakes a bold
weight by printing the same glyphs twice a fraction of a point apart, we now
collapse the second impression instead of reading `August 2026August 2026`.

Between them: 2,630 headings became 2,011, and the 1,033 that went were the ones
the document never claimed.

### Tables

**A column header wrapped across several lines is one header row** (#9). Every
table that used to open with a header plus two rows of nonsense now emits one
header row.

**A table continued on the next page is joined to it** (#13), when the reprinted
header matches. Proximity alone is never enough — two tables that merely touch a
page break stay two tables.

### Nothing disappears silently

**Images are declared** (#12). 161 images across 131 pages of the benchmark
produced no output and no indication at all; each page carrying one now says so,
in the document and in the result notes. Extraction itself is still not built,
and the Images setting now admits that instead of offering four choices that do
nothing for PDFs.

### Also

- the end-to-end verification check no longer requires the converted document to
  quote a dollar amount, which had made it fail on any document that is not an
  invoice (#14)
- PDF link annotations were already extracted — 99.5% of them — and the contract
  is now pinned: external links yes, internal jumps and `javascript:` never

Corpus scores are unchanged for the fourth release running: 50/50 grand totals,
49/49 line-item codes, 52/52 amounts on their code's row, 49/50 documents with a
real table, 44/50 headline figures, marker invariant holding at 6 = 6.

## 1.6.0

The first post-launch cycle, and it is about conversion quality: the seven-issue
ledger filed after 1.5.0 shipped, closed in order.

### Structure that used to be lost

**Key-value structure inside a table cell survives** (#1, #4). A reference table
whose Details column holds its own definition list — a label on one line, its
value indented beneath — used to flatten to one run of words, so `Type` and
`string` ended up adjacent to `Properties` and its list with nothing to say
which belonged to which. The indent was in the source all along and was being
discarded when rows were assembled. Pairs now survive as pairs in all four
outputs.

**Running heads and printed page numbers are actually stripped** (#2). Measured
on a 1,349-page reference guide, the old pass caught 0.3% of running heads and
0.0% of folios. Both misses were structural: a page number normalizes to a
single character and was dropped before it could be counted, and a head's key
included the half that names the page's subject, so every page produced a
different key. Heads are now matched on their stable opening at a fixed height;
folios are matched on their sequence, because folios never repeat and no
repetition test can ever see them. Same document: 99.6% and 100%.

**A display-size title that wrapped is one heading again** (#6). `Net Zero Cloud
Developer` / `Guide` was two sibling headings; it is one, and when it matches the
document's own metadata title it is recognized as the cover title rather than
duplicated.

### Numbers you can see

**Size and token savings, per conversion and per batch** (#3). The result panel
shows source size, output size, percent change and an estimated token count —
`7.3 MB → 1.7 MB as .md · 77% smaller · ~437k tokens (estimated)`. The estimate
is characters over four and is labelled as an estimate everywhere it appears.
The JSON output carries the same figures as data, alongside the name of the
estimator that produced them.

**Copy diagnostic info** (#7). One button in the result panel puts version,
browser, format and page counts, OCR figures, flag counts by type and any
non-default setting on the clipboard — and nothing else. No file name, no title,
no converted text, no validator message. It is available on failed conversions
too, where the error message is the one string that could quote the document, so
the block records that the conversion failed and nothing about why.

**Wall-clock in the audit runner** (#5). Per document and across a corpus, with
seconds per page. The Docling benchmark could not compare speeds because our own
number had never been measured; it has been now.

### Under the hood

- source size is measured before conversion begins — pdf.js transfers the input
  buffer to its worker and detaches it, which made every PDF report zero
- three new fixtures: nested cell structure, page chrome, a split display title,
  and a document built so a diagnostic block's *absence* of content is provable
- 45 automated cases and 51 packaged-extension checks

Corpus scores are unchanged across the whole cycle: 50/50 grand totals, 49/49
line-item codes, 52/52 amounts on their code's row, 49/50 documents with a real
table, 44/50 headline figures, and the marker invariant holding at 6 = 6.

## 1.5.0

**MDForge is now Sumcheck.** The old name collided with a Windows app making the
same pitch, a dental platform holding mdforge.com, a PyPI package and an arXiv
project — four separate collisions, one of them a direct competitor for the same
search terms. "Sumcheck" has none, and it names the thing that actually makes
this converter different: it checks the sums. The code is also relicensed to
Apache 2.0 and the repository is public.

### What changes for you

The review markers written into converted documents move with the product:

```diff
- <!-- MDFORGE: "inchided" is not a recognised word — it may be "included" -->
+ <!-- SUMCHECK: "inchided" is not a recognised word — it may be "included" -->
```

If you grep converted files for `MDFORGE:`, update the pattern. The `generator:`
line in YAML front matter now reads `Sumcheck` too. Nothing else about the output
changed — the full 50-document corpus was re-scored under the new prefix and
every metric is identical: grand totals 50/50, line-item codes 49/49, each amount
on its code's row 52/52, `#Error` preserved 50/50, tables 49/50 with zero silent
fallbacks, headline figure 44/50, and the marker invariant still holds at 6
markers for 6 documents actually missing a value.

### A new mark

Σ in a rounded accent square with a green check badge — adds it up, and checks
it. The icons are rendered once at 1024px from the real glyph and downscaled by
repeated halving, rather than drawn separately at each size; the 128 carries the
full mark in exactly 96×96 of artwork inside 16px of padding, as the store spec
asks, and the 16 drops the badge and sets the sigma heavier so it survives at
that size.

### Licensing

Sumcheck's own code is now Apache 2.0. The bundled third-party components were
already permissive and are unchanged; `THIRD_PARTY_NOTICES.md` lists all 13.

## 1.4.0

A ship-readiness cycle: the install is a third of its previous size, the store
packet exists, and the three things that would have embarrassed a first release
— a blocking password prompt, a queue that got quadratically slower, and an
English-only interface with no way to add a second language — are fixed. The
conversion metrics are unchanged, and that is the point: none of this was
allowed to cost accuracy.

All five scored metrics stayed at 100% through every change: grand totals 50/50,
line-item codes 49/49, each amount on its code's row 52/52, `#Error` preserved
50/50. Tables 49/50 with zero silent fallbacks. Headline figure 44/50.

### The install is 6.2 MB, down from 16.2 MB

The OCR language pack moved from `tessdata_best` to `tessdata_fast` — 12 MB to
1.9 MB — but only after the full 50-document corpus was re-scored on both and
every number held or improved. Flags at the confidence threshold went 189 → 183;
mean confidence 94.3 → 94.6.

The switch is not free and the release notes should say so. `fast` misreads
`included` as `inchided` on every document in the corpus, and reads `Tax ID:` as
`TaxID:` on eight. It also *fixes* a misreading `best` got wrong: `Cenvical` →
`Cervical`. Neither pack is error-free; they are wrong about different things,
and no extracted value — no amount, code, date or identifier — differs between
them.

### A new validator, because confidence is not correctness

Shipping `fast` was made conditional on catching what it gets confidently wrong.
OCR confidence catches *loud* failures; it does nothing about a language pack
that is perfectly sure of a word that is not a word.

The prose lexicon validator flags any non-word in OCR'd prose that sits within
two edits of a common English word, regardless of confidence:

```
<!-- MDFORGE: "inchided" is not a recognised word — it may be "included" -->
```

Silence on correct text was the hard part. The corpus is full of clinical
vocabulary — `appendicular`, `parotid`, `radiopharmaceutical`, `Cervical` — that
a naive dictionary flags immediately. Measured on all 50 documents: the one real
error caught 50/50, and **zero correct words flagged**, with the same corpus
converted by the other language pack producing no flags at all.

Two bundled word lists, 335 KB compressed: one to decide whether a token is a
word, one frequency-ordered to decide what it should have been. Both are needed —
`inchided` is exactly two edits from both `included` and `inclined`, and only
frequency picks the right one.

### Password-protected PDFs no longer stall a batch

`window.prompt()` blocks the page's entire event loop, so one locked PDF froze
every other file in a batch until somebody returned to the tab. It is replaced
by an in-page dialog: focus trapped, Enter submits, Escape skips, and the rest
of the queue keeps converting while it is open. Skipping now fails that one file
with a reason a person can act on instead of a worker error.

### Long batches render at a fraction of the cost

The queue rebuilt every row on every file's completion. Measured on a 200-file
batch: **40,600 rows constructed, now 200** — one per file — and the batch runs
38% faster end to end. Rebuilding also discarded scroll position and text
selection several times a second, which made a long batch actively unpleasant to
watch.

### Translatable

`_locales/` and `chrome.i18n` throughout: 111 messages covering the manifest,
both pages, the context menus and every generated string. English only for now;
the point is that a second language is a file rather than a refactor.

Deliberately *not* translated: anything that ships inside a converted document —
review markers, conversion warnings, front-matter keys, the `generator` line.
Two people converting the same scan should get the same file, whatever language
their browser is in.

### Smaller fixes

- The queue's row template interpolated a file's extension into `innerHTML`; a
  file named `report.<img …>` put markup into the page. Now set as text. Every
  remaining interpolation into markup in the app was audited and removed.
- `scripts/fetch-vendor.mjs` cached OCR language data by filename, so asking for
  a different quality silently kept the old pack while rewriting the manifest to
  claim otherwise. Now keyed by quality, and `npm run check` fails if the pack on
  disk disagrees with what the package claims to ship.
- `npm run score-export` reports value-not-recovered markers and prose flags as
  separate rows, and **asserts** that every document missing a value carries a
  marker — exiting non-zero when it does not.

### Verification

- `npm test` — 41 cases, up from 38.
- `npm run verify-extension` — 47 checks against a real unpacked install,
  including the password dialog driven by a real encrypted PDF, queue rendering,
  localisation, and **the packaged zip itself installing**. That last one exists
  because this cycle produced a build that passed every other gate and would
  have installed nowhere: `default_locale` was declared in the manifest and
  `_locales/` was left out of the zip.
- `store/` — listing copy, permission justifications, privacy disclosure and a
  submission checklist verified against the live Web Store documentation, plus
  three 1280×800 screenshots generated by the harness from a real conversion.

## 1.3.0

An OCR correctness cycle driven by a third audit of the same 50 scanned Good
Faith Estimates, plus the first time the extension has ever been loaded in
Chrome. Every number below is scored against the 50-document ground-truth set
with `npm run score-export`.

The five scored metrics were already at 100% in v1.2.0 and stayed there through
every change in this cycle — grand totals 50/50, line-item codes 49/49, each
amount on its code's row 52/52, `#Error` preserved 50/50.

### Tables now form on 49 of 50 documents, up from 3

v1.2.0 reconstructed a table on 3 of 50 real files despite the page geometry
being clean. Two causes, both in the run-building code:

- A wrapped cell was bounded by the **previous fragment's** right edge. Wrapped
  description text is ragged — on one document the four wrapped lines' right
  edges vary by 75 units — so a continuation one word longer than the line above
  ended the table. A fragment is now judged against the last real **row**, which
  is what defines the columns: it belongs to the row above when it starts under
  one of that row's cells and stops before the next one. Ragged right edges
  become normal; crossing a column boundary does not. Prose after the table is
  still excluded, because it starts at the page margin, left of every cell.
- Any column occupying under 60% of the rows was discarded. A form's service-date
  column is sparse by design — printed once, blank on the line items below.
  Dropping it made that row's two cells both fall into the description column,
  collapsing it to a single filled cell, which failed the "a row needs two
  columns" test and rejected the entire table. A column is now a position where
  at least two cells align.

The second bug also explains why the few documents that did produce a table
promoted their **first line item into the header row**: the run containing the
real header failed, the scan resumed below it, and the first surviving row was
treated as the header. Those documents now carry their real header —
`Service date · Service Description with Procedure Code · Quantity · Charge ·
Total` — and every row they had before.

### A rescue crop no longer corrupts values it already read

The pass that re-reads unread ink recognizes every pixel inside its crop,
including ink the first pass read correctly. On one document it returned
`$1,932.00` a second time as `$1.9` + `32.00` at identical coordinates, and both
were appended to the row, corrupting a money column that was already right.
Comparing text cannot catch this, because a misread does not equal what it
duplicates. Recovered words that sit on more than half their own area over an
already-read word are now discarded.

### Fewer false "value not recovered" markers

A gap region shorter than the page's own median word height is no longer
flagged. The gaps between right-aligned money columns were being reported as
unread ink — four 64×16 slivers carrying a twentieth of the ink of a region that
holds a genuinely unrecovered figure. They produced review markers on a document
whose every value was read correctly.

Markers now equal misses exactly: 6 documents, 6 markers, no document flagged
that is not missing something.

### No silent fallbacks

Every document now emits either a table or an explicit `table_fallback: N` line
in its front matter. Previously a document whose table was lost looked identical
to one that never had a table — the text reaches the output either way, and only
the first case needs checking. 49 tables, 1 fallback, 0 silent.

### The headline total, and spurious headings

Carried over from earlier in the same cycle: the prominent "Total Estimated
Costs" figure is now recovered on 44 of 50 documents, up from 1, by cropping and
re-reading the block that page-level layout analysis discards. Every recovered
figure is cross-checked against the totals stated elsewhere on the page. The 6
remaining misses are all short values and all carry a marker. Spurious deep
headings from table fragments went from 6 to 0 with no legitimate heading lost.

### Page-segmentation mode removed as an option

`tessedit_pageseg_mode` is accepted and discarded by tesseract.js 6.0.1, through
`setParameters` and through worker init alike — measured by hash comparison, with
byte-identical output either way. Shipping the setting would have been shipping a
control that does nothing. The question it was meant to answer was settled on the
CLI instead: over 50 page rasters, PSM 6 glues `Tax ID:` into `TaxID:` on every
one and reads no more line-item codes than PSM 3.

### The extension has now actually been loaded in Chrome

Every previous release was verified through a dev server serving the extension's
real CSP, which covers the conversion engine and the UI but cannot cover a
service worker, a context menu, `chrome.storage.session`, or a permission gate.
All of it now runs: **20 of 20 checks pass**, including one real scanned PDF
converted end to end through the app UI, which produced output byte-identical to
the audit pipeline's for the same file.

`scripts/verify-extension.mjs` runs the whole set against an unpacked install.
One path — capturing a page without `activeTab` — cannot be driven headlessly,
so it is asserted in the useful direction: the shipped manifest requests no host
permissions, and capture *must* be refused until the user invokes the extension
on the tab.

### Verification

- `npm test` — 38 cases, up from 29.
- A case that threw before registering used to abort the run and take every case
  after it with it, while the suite still printed `30/30 cases passed`. Cases now
  run isolated and a case that fails to register is reported as a failure.
- `npm run verify-extension` — 20 MV3 checks against a real unpacked install.

## 1.2.0

Driven by a second audit of the same 50 scanned billing forms, this time against
v1.1.0 output plus a 50-document ground-truth set. v1.1.0's numeric defects were
verified clean; everything here addresses what remained.

### Tables now form on real documents

v1.1.0 reconstructed tables in tests and **0 of 50 real files**. The cause was
wrapped cells. A long description wraps to a second visual line, which arrives
as a single fragment — and that fragment ended the run of table rows, so a
four-row invoice produced no table at all. It also explains why wrapped text was
printed *after* the numeric columns: with no table, the fragment was merged into
the following paragraph.

Two fixes, both found by tracing real line geometry:

- A lone fragment sitting close below a row and **indented into a column** is
  absorbed as that cell's continuation instead of terminating the table. It
  rejoins the cell it belongs to, so a description stays in the description
  column.
- The row-to-row gap is measured from the last line consumed rather than the
  last *row*. With a continuation in between, normal leading looked like a break
  in the table.

A line starting at the row's own left margin is explicitly *not* a continuation,
which keeps footer prose out of the last row.

### OCR rescue pass

Text inside a mid-grey callout box was being dropped whole — label and value
together — because the box binarizes to one dark mass. Measured: the first pass
returns neither line; a contrast-boosted pass returns both.

So pages are now read twice *when it matters*: if the first pass leaves ink
unaccounted for, those regions are re-read with local contrast boosted, and only
lines inside them are merged back. Clean pages pay nothing, and the pre-
processing that damages thin strokes never runs across a whole page.

### Confidence, recalibrated

- The flag threshold drops from 85 to **70**. Measured on real upscaled scans,
  correct words routinely land in the high 70s and low 80s; 85 flagged hundreds
  of correct words per batch, and a flag that fires constantly on correct data
  teaches people to ignore flags.
- `ocr_confidence_min` is now word-level, matching the population the flagged
  list is drawn from. Previously it reported a line average, so the summary
  disagreed with its own detail.
- The per-word `ocr_low_confidence` list is **opt-in** (`ocrDetail: 'full'`). It
  was ~30% of every converted file on a bulk run. The summary scalars stay
  always-on, which is what a pipeline actually gates on.

### Tooling

- `npm run score-export <dir-of-md> <groundtruth.json>` — scores an existing
  batch of converted Markdown against a ground-truth file. No PDFs, no browser:
  grand totals, line-item codes, whether each amount sits on its code's row,
  table presence, and preserved markers.
- The audit runner accepts ground-truth files in whatever shape they arrive —
  explicit rule sets, per-document field maps, or nested records — flattening
  leaf values into "this must appear in the conversion".
- Two new regressions: a wrapped-cell table, and a shaded callout.

### Fixed: OCR failed on every real scan

The rescue pass reassigned a `const`, throwing on any page with unread ink.
Every fixture happened to have none, so the whole branch was untested and the
error only appeared on real documents — where it fired on all 50, silently
falling back to no OCR at all. The regression fixture now includes a scrawl that
OCR cannot read, so that path is exercised.

### Verified against the real 50-document corpus

Scored with `npm run score-export` against a ground-truth set covering all 50
documents:

| | v1.1.0 | v1.2.0 |
| --- | --- | --- |
| grand totals matched | 50/50 | **50/50** |
| all line-item codes found | 49/49 | **49/49** |
| each amount on its code's row | 52/52 | **52/52** |
| `#Error` preserved verbatim | 50/50 | **50/50** |
| documents emitting a real table | 0/50 | **3/50** |

The three are the multi-line-item documents where attribution is actually at
risk. GFE (49), the ten-line PET estimate, now yields `78815 → $1,932.00` and
`A9595 → 9 × $597.71 = $5,379.39` as separate correctly-attributed rows, with
the wrapped descriptor inside its own cell rather than after the numeric
columns.

The remaining 47 are single-line-item documents whose one charge cannot be
misattributed, and one further multi-item document (47) whose wrapped descriptor
still breaks its run.

## 1.1.0

Driven by a 50-file audit of scanned medical billing forms (121 defects, 44/50
files with at least one hard data error) and two independent reviews. The theme:
**OCR will get things wrong, so it must be wrong visibly.**

### OCR accuracy

- **Render resolution is now chosen from measurement, not intuition.** Scored
  against ground truth on a 96 dpi form (`test/harness.js`, "96 dpi billing
  form"): native 5/14 fields correct, 1.5× 12/14, 2× **14/14**, 3.1× 14/14.
  `ocrResolution: 'auto'` detects a scan's own resolution and renders at a whole
  multiple of it, targeting ≥200 dpi. v1.0.0 rendered at 1.5×, which recovers
  most of a page but drops shaded headline figures and corrupts URLs — the two
  defects most reported from the field.
- Pages are converted to **grayscale** before OCR: no accuracy change, ~1.6×
  faster, and it removes JPEG chroma fringing from thin strokes.
- **No pre-processing by default.** Tesseract's own binarization is tuned for
  text; a threshold or contrast pass beforehand is a second, cruder pass that
  eats thin strokes — the `$`→`3` failure mode. A local-contrast option remains
  for photographed pages with uneven lighting (`ocrPreprocess: 'contrast'`).
- Ships **`tessdata_best`** instead of `tessdata_fast`, which loses accuracy on
  small type. Package grew 5.8 MB → 16.2 MB; revert with
  `scripts/fetch-vendor.mjs --quality fast`.
- Tesseract is now told the true resolution (`user_defined_dpi`) and asked to
  keep column spacing (`preserve_interword_spaces`).

### Structure

- **Tables are reconstructed on scanned pages.** OCR now returns per-word
  bounding boxes, so scans run through the same column-clustering the text-layer
  path uses. Each charge stays on its procedure code's row. Previously a
  services table flattened into a run-on paragraph, which made multi-line-item
  documents ambiguous.
- When rows are clearly columnar but will not resolve into a clean grid, output
  falls back to an **aligned preformatted block** rather than a paragraph, so
  the row/column relationship survives.
- Heading inference, list detection and running-header removal now apply to
  scanned pages too, from the same geometry.

### Verification (all new)

- **Confidence is surfaced instead of discarded**: `ocr_confidence_mean`,
  `ocr_confidence_min`, `ocr_flagged_fields`, and an `ocr_low_confidence` list
  of the worst-scoring words with page numbers.
- **Currency-sigil validator** — a bare amount in a column whose siblings carry
  `$`. Catches the confident-but-wrong case that confidence gating misses:
  `340.00` scores in the 90s because it is a perfectly good number.
- **Arithmetic reconciliation** — line items that do not sum to their total row.
- **Unreadable-region detection** — the page's ink is compared against
  recognized word boxes; an inked region that produced no text attaches a
  `value not recovered` marker to the nearest label. This is the answer to
  silent omission, the only defect class invisible to a reader who never sees
  the original.
- Flags appear inline as `<!-- MDFORGE: … -->` comments in Markdown, a `⚠` with
  a tooltip in HTML, and a `review` array in JSON. **Nothing is ever silently
  rewritten** — on a price list, a converter that "corrects" figures is worse
  than one that is wrong loudly.

### Output

- **Every format is available on every converted file**, regardless of what is
  ticked in Settings — Markdown, HTML, plain text and JSON are generated on
  demand from the already-converted document.
- Explicit per-format download buttons (`.md` `.html` `.txt` `.json`) in the
  result header; Copy follows the tab you are viewing.
- Settings' format checkboxes now only control what "Download all (.zip)"
  writes, and are labelled "Files to save".
- Markdown escaping no longer breaks URLs inside links; a link whose text is its
  own address becomes an autolink.
- `producer` and `creator` carried into front matter.

### Batch UI

- **The working file is now distinct from the selected file.** The highlight
  used to be the selection, set when the first file finished and never moving —
  a 50-file batch looked frozen on file 1.
- Batch progress line with the live per-file label
  (`Converting 12 of 50 — invoice.pdf · OCR page 2 of 3 — 47%`), which stays
  visible when the working row is scrolled out of view.
- Archives are no longer counted as documents — a finished batch used to report
  "50 of 51" with the bar just short of full.
- The queue scrolls itself (not the page) to keep the working row visible, and
  updates in place instead of rebuilding every row.
- **Stop** button; queued files are marked skipped rather than silently dropped.
- OCR progress labels carry page context instead of a percentage restarting per
  page, and a finished row no longer reverts to "OCR 100%".
- Failed files show the full reason in the result panel instead of a truncated
  status.
- Source bytes are released after conversion so a large batch does not exhaust
  the tab.

### Testing and tooling

- `npm test` — 28 cases (was 26), including two new regressions:
  - **96 dpi billing form**: a shaded callout whose value is separated from its
    label, a 5-column × 3-row numeric table, a URL, and a semicolon inside a CPT
    descriptor. Asserts each charge stays bound to its code and that the
    headline figure survives or is explicitly marked.
  - **suspect invoice**: asserts the validators actually fire, name the likely
    cause, and leave correct values alone.
- `npm run audit -- <dir>` — converts a directory of real documents and reports
  confidence, flagged words, unreadable regions and validator findings per file,
  writing `audit-report.md` and `audit-results.json`. The corpus is served
  read-only from where it already lives; nothing is copied, which matters for
  documents containing personal data. Supports an expectations file for
  known-good values.
- README documents the accuracy measurements and adds usage guidance: convert
  for reading, keep the original for verifying; treat structure-is-data
  documents (invoices, quotes, lab results) as working copies.

### Notes on the reviews

- One review attributed the defects to a pre-OCR binarization step. There was no
  such step — v1.0.0 rendered the page and passed the canvas straight to
  Tesseract. The reproduction was still decisive: 1.5× resampling of a 96 dpi
  scan damages thin strokes the same way a hard threshold does.
- The same review recommended reading scans at native resolution. Measured, that
  is the **worst** option (5/14). Tesseract needs roughly 30 px of x-height; a
  96 dpi scan gives it about 6.
- The nondeterminism where 1 of 50 files kept its headline total needs no race
  to explain it: at 1.5× the shaded headline was marginal, and the file that
  survived has the widest headline in the batch.

## 1.0.0

Initial release. PDF (text layer and OCR), Word, Excel, PowerPoint,
OpenDocument, EPUB, images, web pages, email, MHTML, CSV/TSV, JSON/JSONL/YAML/
XML, notebooks, subtitles, RTF, Markdown and source files → Markdown, HTML,
plain text or structured JSON, entirely on-device.
