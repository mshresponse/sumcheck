# MDForge development log

Completion notes, newest first. One section per task, verbatim as reported.
Format is set by `WORK_ORDER_OCR.md` § Reporting format: what was found (not just
what changed), the before/after score table, fixtures added, and any invariant
there was a temptation to break.

---

## 2026-08-19 · v1.7.0 cycle · Q9 — re-bench, gates, release

### The Winter '27 document, 1.6.0 against 1.7.0

| | 1.6.0 | **1.7.0** | target | |
| --- | ---: | ---: | --- | --- |
| headings | 2,630 | **2,011** | toward the outline's ~1,990 | met |
| bullet list items as headings | 713 | **0** | 0 | met |
| headings doubling their own text | 86 | **0** | 0 | met |
| real list items | 320 | **1,315** | ~1,033 | met |
| tables with a mangled header split | 83 | **0** | 0 | met |
| tables with a fully correct header | 2 | **21** | ~95% parity | **missed** |
| tables | 209 | 206 | merges reported | 3 merged |
| pages declaring an unconverted image | 0 | **131** | every page carrying one | met |
| markdown links | 3,612 | 3,612 | reported | unchanged, 99.5% of URI annotations |
| wall-clock | 5.8 s | 6.8 s | — | +17%, image counting |

Result header from the packaged build installed in Chrome:

```
17 MB → 2.6 MB as .md · 85% smaller · ~581k tokens (estimated)
Removed 2008 header/footer line(s).
161 image(s) were not converted — image extraction is not supported for PDF yet…
```

**One target missed.** Header assembly is 21 of 209 rather than ~95%. The reason
is in the Q5 note and it is a single defect, tracked as **#16**: 66 tables are
stranded continuation headers whose column clustering collapsed before any of
this cycle ran, and 59 of those turn out to sit on the same page as their data
rather than across a page break. Fixing the clustering resolves both those and
most of the 30 remaining unmergeable page-split pairs, and unblocks #17.

### Net Zero, the regression baseline

| | baseline | 1.7.0 | |
| --- | ---: | ---: | --- |
| running-head lines surviving | 5 | **5** | T2's 99.6% catch rate holds |
| bare folio lines surviving | 1 | **1** | T2's 100% holds |
| headings | 892 | 864 | 26 fewer, all `CONTENTS`, a cover subtitle and TOC dot-leaders |
| table rows | 3,122 | 3,049 | header folds and 26 continuation merges |
| wall-clock | 3.1 s | 3.8 s | |

Chrome and folio numbers are identical, which is what the work order named. The
heading and row reductions were each checked at word level: **2 tokens** differ
across the whole document from the table work, both halves of one already
garbled string.

### Corpus, for the fourth release running

| | baseline | 1.7.0 |
| --- | ---: | ---: |
| grand totals matched | 50/50 | **50/50** |
| all line-item codes found | 49/49 | **49/49** |
| each amount on its code's row | 52/52 | **52/52** |
| `#Error` preserved | 50/50 | **50/50** |
| documents emitting a real table | 49/50 | **49/50** |
| headline figure recovered | 44/50 | **44/50** |
| value-not-recovered markers | 6 = 6 | **6 = 6** |
| prose lexicon flags | 50/50 | **50/50** |

Checked after **every** task in this cycle, not only at the end. It never moved.
That is the evidence the fallback paths are untouched: none of the 50 documents
carries an outline, so the corpus exercises size inference exclusively.

Corpus wall-clock 39.7 s for 50 pages, 0.79 s/page — unchanged, still OCR-bound.

### Release

- version **1.7.0** in both manifests; the `1.7.0.1` + `version_name` scaffolding
  from Q0 removed
- CHANGELOG entry closing every issue by number
- `npm run check` clean · **52/52** harness cases · **52/52** packaged-extension
  checks including the real-PDF end-to-end on the 1,010-page document
- `npm run package` → **`dist/sumcheck-1.7.0.zip`**, 6.2 MB
- **`dist/sumcheck-1.6.0.zip` still hashes to `86670af2b0da21e07386e5855c6091b6d06e2254e02d8ce2759a748f128ea928`** — byte-identical to Q0's record, which was the point of the whole Q0 exercise
- **Nothing uploaded to the Chrome Web Store.**

### Fixtures added this cycle

| fixture | proves |
| --- | --- |
| `outline-headings.pdf` | the outline outranks type size, in both directions, with every heading at 11 pt |
| `oversized-bullet.pdf` | a decorative glyph does not make a heading; a numbered line keeps its classification |
| `overprint-heading.pdf` | faux-bold collapses while `had had`, `that that` and two `Total` cells survive |
| `stacked-header.pdf` | a three-line header folds into one row; a one-line header is untouched |
| `table-continuation.pdf` | a matching header merges; a different table after a break does not |
| `dropped-image.pdf` | one declaration per page, not per placement |
| `link-kinds.pdf` | https and mailto yes; internal jumps and `javascript:` never |

---

## 2026-08-19 · v1.7.0 cycle · Q8 — the end-to-end check stops asking for money (#14)

`verify-extension` takes a PDF path and drives it through the installed
extension. Its assertion required the output to contain a `$nn.nn` amount — a
property of the medical billing corpus it was written against, not of a
conversion.

**This check has now been narrowed twice by the same mistake.** It began by
hardcoding `$151.00`; that failed on every document except the one it was
written for, and was generalised to "some currency amount" — which then failed
on the 1,010-page release notes:

```
FAIL  real corpus PDF converts end to end in the app — 2699404 chars · 0 amount(s) · table present · front matter present
```

2.7 million characters of correct output reported as a failure because release
notes do not quote dollar figures. A gate that cries wolf gets ignored, which is
the real cost.

### What it asserts now

Properties of a conversion rather than of a corpus:

| | |
| --- | --- |
| front matter | present |
| body | more than 500 characters |
| page count | the `pages:` field agrees with the `<!-- page N -->` markers |
| structure | a table, a heading or a list is present |

The page-count check is the useful addition: it catches a conversion that
silently truncates, which the old assertion could not. A document with no
metadata title opens straight into page 1's content and omits that first marker,
so the range allows `pages - 1`.

```
PASS  real PDF converts end to end in the app — 2714104 chars · front matter present · 1010 page(s) declared, 1010 marker(s) · structure present
```

### The currency assertion still exists

It runs behind `--expect-currency`, for the corpus it belongs to:

```
PASS  real PDF converts end to end in the app — 2088 chars · front matter present · 1 page(s) declared, 0 marker(s) · structure present
PASS  the billing corpus PDF carries currency amounts — 5 amount(s)
```

Deleting it would have thrown away a real check on real documents; the fix was
never to weaken the assertion but to stop applying a corpus's properties to
every document.

Gates: **52/52** harness cases; extension checks 52/52 with a PDF argument and
53/53 with `--expect-currency`.

---

## 2026-08-19 · v1.7.0 cycle · Q7 — link annotations, and what they already do

**No code changed in this task, because the feature already exists.**

The work order asks to extract PDF link annotations and wrap the overlapping
text as a Markdown link, citing the independent pipeline's 1,179. The bench
addendum had already established that we do this and that `pdfLinks` has
defaulted on all along. Measured again on the Winter '27 document with this
build:

| | count |
| --- | ---: |
| Markdown links emitted | **3,612** |
| of which `http(s)` | 1,252 — against **1,258** URI annotations in the file, **99.5%** |
| of which relative `/apex/…` | 2,360 — from the file's 3,969 launch actions |
| `javascript:` URLs emitted | **0** |
| links emitted across the 50-document scored corpus | **0** — it carries none, and that stays true |

Writing code here would have been writing a second implementation of something
already shipped. What was genuinely missing was any statement of the **contract**
— which annotation kinds are excluded, and why.

### The fixture, which is green from the first run

`test/fixtures/link-kinds.pdf` carries one annotation of each kind that matters,
and seven assertions pin the outcome:

| annotation | outcome |
| --- | --- |
| `https://example.com/methodology` | becomes a link |
| `mailto:maintainers@example.com` | becomes a link |
| internal jump to page 2 | **stays plain text** |
| `javascript:alert(1)` | **never becomes a link, in Markdown or HTML** |

There is no RED here and the note says so plainly rather than dressing a
green-from-the-start case as a fix.

The internal-jump exclusion is a judgement: "go to page 2 of this file" cannot
be followed out of a Markdown document, so a link would promise something it
cannot deliver. Noted as a residual in the work order and it stays one.

The `javascript:` exclusion is not a judgement, it is a security property, and
**nothing asserted it until now**. Whether pdf.js declines to expose the URL or
the sanitizer strips the href, the outcome is the same — and it is the outcome
that is now locked, so a future change to either would fail the suite rather
than ship a document that executes script when clicked.

### One thing worth flagging rather than fixing

2,360 of the emitted links are relative `/apex/…` targets from the file's launch
actions. They preserve information a reader would otherwise lose, and they are
not resolvable without knowing the host they came from. Left as they are — the
work order scopes this task to http/https/mailto and says nothing about relative
targets, and silently dropping 2,360 links to tidy the output would be a worse
trade than leaving them.

Corpus: every metric at baseline, marker invariant 6 = 6. Gates: check clean,
**52/52** harness cases, **51/51** packaged-extension checks.

---

## 2026-08-19 · v1.7.0 cycle · Q6 — images are declared, never silent (#12)

Extraction is out of scope this cycle. Saying nothing was not.

### What the output now carries

```markdown
_(2 images not converted)_  <!-- SUMCHECK: 2 images on page 1 could not be converted — image extraction is not supported for PDF yet -->
```

One line per page that draws images, carrying a visible placeholder and a review
marker, plus a count in the result notes: *"161 image(s) were not converted —
image extraction is not supported for PDF yet, and each page carrying one says so
in the output."*

### Grouping, as the work order asked

**One declaration per page, never one per placement.** Images are counted as
distinct objects within a page, so a page stamping one icon four times reports
one picture. Without that, a logo repeated down a long document buries the
content under placeholders — which is why the fixture's first page paints the
same object twice and asserts a single declaration.

On the reference document: **131 declarations across exactly the 131 pages the
bench measured as carrying images**, totalling 161 images. That 161 is the
per-page distinct count summed; the bench's 106 is the document-wide distinct
count, and the two agree — no image repeats within a page in that document.

### Two details worth recording

**The marker span carries `⚠`.** An empty inline node is blank to turndown, and
blank nodes are replaced before any rule runs, so a marker with no content
vanished silently — the same reason the unreadable-value marker has carried that
character all along.

**The placeholder uses parentheses, not brackets.** Turndown escapes `[` as `\[`
because it could open a link, and the backslashes reach the reader:
`_\[2 images not converted\]_`. A fixture assertion now fails if any escape
artefact reaches the output.

### Pages read by OCR are excluded

On a scanned page the image *was* converted — that is what OCR did. Declaring it
missing would be false, and it would also break the marker invariant on the
scored corpus, where all 50 documents are scans. That corpus stays at 6 = 6.

### The settings panel now tells the truth

`imageMode` offers embed / extract / link / remove, and for PDFs all four do the
same thing: nothing. A localized note sits beside the control — *"Not yet
supported for PDF — pages carrying images say so in the output."* 127 messages,
71 tagged elements, none empty.

### Cost

Counting images needs `getOperatorList()` per page, which the adapter previously
called only for pages with no text layer. Winter '27 went from **5.4 s to 6.6 s**
for 1,010 pages — 22%, 1.2 ms per page. That is the price of not being silent,
and it is worth paying.

Corpus: every metric at baseline, marker invariant 6 = 6. Gates: check clean,
**51/51** harness cases, **51/51** packaged-extension checks.

---

## 2026-08-19 · v1.7.0 cycle · Q5 — joining a table to its continuation (#13)

### What it does

`mergeContinuedTables()` runs over the assembled page HTML. Where a table is
followed — across a page marker and nothing else — by a table whose header row
is identical, the second table's body rows move into the first and the repeated
header is dropped. It keeps absorbing, so a table spanning four pages becomes
one rather than two.

**A matching header is the only evidence accepted.** Two tables that merely
touch a page break are two tables. The work order is explicit that proximity
must not license a join, and the fixture holds it to that: page 3 carries a
different table directly after a break and stays separate.

### Q4's deferral was wrong, and this is the measurement that shows it

Q4 deferred 66 stranded header-only tables to this task, on the reasoning that
they were continuation headers Q5 would merge away. **That claim is false. None
of the 66 were resolved — the count is unchanged at 66.**

Two independent reasons, both measured:

| | |
| --- | ---: |
| stranded header-only tables | 66 |
| of those, followed by another table **on the same page**, no break between | **59** |
| page-split table pairs remaining after Q5 | 30 |
| of those, with identical headers (i.e. eligible and missed) | **0** |
| of those, with differing headers (correctly declined) | 30 |

The 59 are not page-boundary continuations at all. They are a header and its own
data rows, on one page, split into two tables because the header stack's column
clustering resolved differently from the data's — the column counts either side
of those splits are 2-vs-3, 2-vs-5, 2-vs-6. Q5 cannot join them without matching
headers, and their headers cannot match while the columns disagree.

So the Q4 note's diagnosis held — this is the column clustering, not the merge —
but its prediction that Q5 would absorb them did not. **The root cause is a
grid that never resolved, and it needs the clustering fixed, not a merge rule.**
Filed as **#16** rather than left as a residual: it owns the 59 same-page splits,
the 30 unmergeable page-split pairs, and — through the merge it blocks — the
straddling row label of #17.
Joining them on adjacency is exactly the heuristic the work order forbids, and
with mismatched column counts it would misalign every cell it touched. Filed as
a residual rather than forced.

### What did merge

| | Winter '27 | Net Zero |
| --- | ---: | ---: |
| tables before | 209 | — |
| tables after | **206** | — |
| merges | **3** | **26** |
| page-split pairs | 33 → 30 | — |
| table rows | 984 → 978 | 3,097 → 3,045 |

Word-level diff across both documents: Winter '27 loses 23 words, Net Zero 104,
and every one is a repeated column header the merge deliberately drops —
`Feature`, `Enabled`, `Details`, `Field`. **No data row lost a word.**

3 of 33 is a small return, and the reason is the one above: 30 of the remaining
pairs have headers that genuinely differ because one side's grid collapsed. Fix
the clustering and most of those 30 become eligible without touching this rule.

### Residuals, stated rather than papered over

- **Same-page header/data splits (59).** Needs column clustering, not merging.
  Tracked as **#16**, which is the root-cause issue for this whole family.
- **A continuation that reprints no header** stays two tables, by design. Not an
  issue: under-merging is recoverable by a reader, over-merging is not.
- **A row label split across the boundary is still not stitched.** The fixture
  cannot even pose the case: a label-only continuation line is a one-cell row,
  and a one-cell row rejects the whole grid, so the continuation page produces
  no table to merge into. That is recorded in the fixture's own comment. On the
  reference document this remains 3/8 recovered, unchanged. Tracked as **#17**,
  and **blocked by #16** — the halves can only be stitched once the two tables
  are one, and the merge needs headers that match.

Corpus: every metric at baseline, marker invariant 6 = 6. Gates: check clean,
**50/50** harness cases, **51/51** packaged-extension checks.

---

## 2026-08-19 · v1.7.0 cycle · Q4 — folding a stacked column header into one row (#9)

### The fixture, and RED

`test/fixtures/stacked-header.pdf` — a bottom-aligned three-line header of five
columns, plus a control table with an ordinary one-line header that must come
out unchanged. RED reproduced the defect exactly: a header row and two data rows
of nonsense. Four of eight assertions failed; the four controls were green
throughout.

### Two positional signals, because the tables come in two shapes

**Where the grid resolves cleanly**, the row-label column is empty on every line
of the stack except the last, where its own heading sits. A wrapped *data* row is
the opposite — its label continues in exactly that column. That difference
separates the two without reading a word, and it folded 21 tables.

**Where the grid does not resolve**, that signal is invisible: a header stranded
at the top of a continuation page has no data rows beneath it to anchor the
column clustering, and five columns collapse into three with the header text
packed into the first. Those tables have a second signature — a bottom-aligned
stack steps leftward line by line, because each line is wider than the one above:

```
      321 ->        Enabled for    Requires      Contact
  240 ->     Enabled for   administrators  administrator
128 ->  Feature     users      /developers      setup
 69 ->  Align Demand Plans with            Yes            <- data starts here
```

Data rows share one left edge instead. So the stack is the leading run of
strictly decreasing left edges, minus its last line when the rows below sit at
that same edge — that line is the first data row, not the last header line. The
control table's edges are `72, 72, 72`, which is not a stack, and it does not
fold.

Cells are joined with `<br>`, the in-cell break T1 established.

### Results, including where it falls short

| Winter '27 | before | after Q4 |
| --- | ---: | ---: |
| tables carrying a mangled header split | **87** | **0** |
| tables whose header row is fully correct | 2 | **23** |
| table rows | 1,162 | 984 |

**The mangled-header class is gone.** Every table now emits one header row and no
junk data rows.

**The target was parity with the ~95% reference and this does not reach it.** 23
of 209 headers are fully correct. The other 66 are the stranded continuation
headers: they now fold into a single header row instead of a header plus two junk
rows, but their *contents* are still distributed wrongly across three columns,
because the column clustering that produced those three columns is what was
wrong in the first place. Folding cannot repair a grid that was never resolved.

Those 66 are exactly the tables Q5 exists to merge into their continuation on the
following page. Merged, they inherit that table's resolved columns and the
question disappears. Attacking the clustering here instead would mean rewriting
column detection for a case Q5 removes — which is why the shortfall is reported
rather than papered over.

### No content lost

Net Zero folds 41 table rows into 16. A word-level diff across the whole
1,349-page document finds **2 tokens** different, both halves of one already
garbled string. The rows did not disappear; their text moved into `<br>`-joined
header cells.

Corpus: every metric at baseline, marker invariant 6 = 6. Gates: check clean,
**49/49** harness cases, **51/51** packaged-extension checks. `dist/sumcheck-1.6.0.zip`
still `86670af2…`.

---

## 2026-08-19 · v1.7.0 cycle · Q3 — collapsing faux-bold overprint (#11)

The cause is in the characterization note below, written before this fix: the
PDF prints those glyphs twice, 0.28 pt apart, because no bold face is embedded.
86 pairs across 1,010 pages, one distinct offset, one distinct size.

### The fix, and why it tests position rather than text

`dropOverprints()` runs on each baseline group after it is sorted by x, and
drops a run that repeats the run before it at nearly the same place. The
tolerance is **6% of the type size**, floored at 0.4 pt.

That number sits in a wide gap. The idiom uses 2% — 0.28 pt at 14 pt. The
narrowest real glyph advance is around a fifth of the type size, and a repeated
*word* carries a space as well. So 6% is three times what the defect needs and a
third of the closest thing it could damage.

Deduplicating on text alone was never an option, and the fixture says so out
loud: `had had to be restated`, `that that decision was reversed`, and two
`Total` cells a column apart. All three repeat text; none repeat position. They
were green before the change and are green after it.

### Results

| Winter '27 | before Q1 | after Q2 | **after Q3** |
| --- | ---: | ---: | ---: |
| headings | 2,630 | 2,015 | **2,011** |
| bullet list items as headings | 713 | 0 | **0** |
| headings doubling their own text | 86 | 86 | **0** |
| table rows | 1,162 | 1,162 | 1,162 |

Target was 86 → 0 with no corpus movement. Both met.

Net Zero: 864 headings, 5 residual chrome lines, 3,122 table rows — unchanged
from Q2. Corpus: every metric at baseline, marker invariant 6 = 6. Gates: check
clean, **48/48** harness cases, **51/51** packaged-extension checks.

### Worth noting for later

This idiom is invisible to `pdftotext`, which drops overlapping duplicates
silently. Any future characterization that asks "what does the file actually
contain" should read it with two independent libraries before publishing an
answer — this cycle published the wrong cause once for exactly that reason.

---

## 2026-08-19 · v1.7.0 cycle · Q3 characterization — why headings duplicate their own text (#11)

**Measured before changing anything**, per the work order. No fix in this entry.

### The cause: faux-bold, drawn twice

The PDF draws the string **twice**, at the same baseline, offset horizontally by
**0.28 pt**:

```
bbox=(64.8, 52.5, 151.2, 70.5)  size=14.0  SalesforceSans-Regular  'August 2026 '
bbox=(65.1, 52.5, 151.5, 70.5)  size=14.0  SalesforceSans-Regular  'August 2026 '
```

That is the standard way to fake a bold weight when a bold face is not embedded:
print the glyphs, nudge a fraction of a point, print them again. The font name
says `-Regular` on both copies, which is the tell.

Our line assembler groups glyph runs by baseline and concatenates them, so the
two copies land in one line with nothing between them — `August 2026August
2026`. Nothing in the pipeline is duplicating anything; we are faithfully
reporting ink that is genuinely on the page twice.

### Census across all 1,010 pages

| | |
| --- | ---: |
| overprinted duplicate pairs | **86** |
| distinct horizontal offsets | **1** — always 0.28 pt |
| distinct type sizes | **1** — always 14.0 pt |

| text | pairs |
| --- | ---: |
| `August 2026` | 79 |
| `September 2026` | 2 |
| `October 2026` | 2 |
| `New Classes` | 1 |
| `New or Changed Methods in Existing Classes` | 1 |
| `Actions` | 1 |

**86 overprints, 86 doubled headings** — a one-to-one match, and the text
distribution is identical to the heading census taken from our own output. The
cause accounts for the defect exactly, with nothing left over.

### A correction to the bench, and to issue #11

Both said "the PDF draws the string exactly once at that position, so the
duplication is ours", citing `pdftotext -bbox`. That was wrong, and the tool
misled rather than the reasoning: **pdftotext silently drops overlapping
duplicate text**, so it reports one word where the file has two. PyMuPDF reports
both. The lesson is the one this project keeps relearning — a single tool's
output is not evidence about a file, and the check should have been run against
two readers before the claim was published. Issue #11 and
`winter27-comparison.md` are corrected.

It changes the fix, not the severity. This is not a bug in our extraction to be
hunted down; it is a real-world PDF idiom we do not yet recognise.

### What this implies for the fix

Collapse a glyph run that repeats the run immediately before it at the same
baseline within a fraction of its own type size. The tolerance has to be
relative — 0.28 pt is 2% of 14 pt — and the test has to require the *same text*,
because two different words a fraction of a point apart are kerning, not
overprint.

The guardrail the work order names is real and the fixture must carry it:
**legitimately repeated words must survive.** `had had`, a product name like
`Sales Sales Cloud`, a table cell repeating its neighbour — these are separated
by a space and by a full advance width, not by 2% of a glyph. Deduplicating on
text alone would eat them; deduplicating on position will not.

---

## 2026-08-19 · v1.7.0 cycle · Q2 — a decorative glyph must not decide its line is a heading (#10)

### Which fix, and why that one

The work order offers two: measure the ratio without the marker glyph, or run
the list-marker test before the heading test. **Only the first is shipped**, and
the reason is that the second is a workaround for the first.

The cause is one line of line assembly:

```js
size: Math.max(...sizes),
```

A line's size is the maximum over its glyph runs, so a bullet drawn at 19.2 pt
in front of 12.8 pt text makes the whole line 19.2 pt and a ratio of 1.5 — over
the 1.45 threshold for an h2. That is right for grouping and gaps and wrong for
asking whether a line is a heading, and it is wrong for **any** oversized
decoration: an ornament, a drop cap, a section dingbat. Reordering the two tests
would rescue bullets specifically and leave every other decorative glyph still
able to invent a heading.

So lines gained `textSize` — a character-weighted median over the glyph runs —
and `headingLevel` asks that instead. Weighting by length is the whole trick:
decoration is short by nature and cannot outvote the prose beside it.

Reordering was also the riskier of the two. `1. Overview of the Quarter` opens
with something the list-marker test matches, and the fixture asserts on the JSON
block model rather than on Markdown because a paragraph reading `1. Overview`
and an ordered list item are the same characters.

### One more guard, found by measuring

Two `## •` headings survived on the reference document: a bullet alone on a
line, no text. With nothing else on the line there is nothing for the weighting
to weigh. A line carrying no letters and no digits is decoration whatever size
it is set in, so it is now never a heading — narrow enough that a numeric
heading like `2026` is untouched.

### The fixture took three attempts, and the failures were instructive

RED was surprisingly hard to reach, and each miss was a real fact about the
defect:

1. **Three bullets and two sentences** — the bullets dominated
   `estimateBodySize`, the body size came out at 17 pt, and the *real* heading
   was suppressed instead. Same root cause, opposite symptom.
2. **Bullets ending in a full stop** — caught by the existing `endsLikeProse`
   guard and emitted as paragraphs. Release-note bullets are fragments.
3. **Bullets as fragments, outnumbered by prose** — reproduced exactly.

The fixture now carries eight lines of body text to three bullets, matching the
proportion in the reference document, and its bullets are fragments. Both facts
are load-bearing and both are commented in the builder.

### Results

| Winter '27 | before Q1 | after Q1 | **after Q2** |
| --- | ---: | ---: | ---: |
| headings | 2,630 | 2,543 | **2,015** |
| bullet list items emitted as h2 | 713 | 276 | **0** |
| real list items | 320 | 789 | **1,315** |
| table rows | 1,162 | 1,162 | 1,162 |

Target was 713 → 0 with list items to ~1,033. Bullets reached 0; list items
overshot the estimate at 1,315 because more bullets were recovered than the
target assumed. Heading count landed at 2,015 against the document's own
outline of ~1,990.

Net Zero: 866 → 864. The two are `In this chapter ... Track and manage
environmental impact for precise` and a sibling — lead-in sentences, not
headings. Chrome (5 residual) and table rows (3,122) unmoved.

Corpus: every metric at baseline, marker invariant 6 = 6. Gates: check clean,
**47/47** harness cases, **51/51** packaged-extension checks.

---

## 2026-08-19 · v1.7.0 cycle · Q1 — the embedded outline as the heading authority

### The fixture, and RED

`test/fixtures/outline-headings.pdf` — two pages carrying a real `/Outlines`
tree, built so that **every heading in it is 11 pt**. Nothing in this document is
recoverable by measuring:

- `IMPORTANT NOTICE` at 24 pt, absent from the outline
- `Chapter One` / `Chapter Two` at body size, present in the outline
- `Section 1.1`, a child of Chapter One, so its level exists only as depth

RED reproduced the misread in both directions on the first conversion:
`## IMPORTANT NOTICE` was promoted, and all three real headings came out as
paragraphs. Five of eight assertions failed.

### What it does

`readOutline()` walks `doc.getOutline()` and resolves each destination to a page
via `getPageIndex`, yielding `{title, level, page}`. `bindOutline()` then binds
each entry to the line that is its heading — page narrows the search, text
decides it, and a title printed across two lines is matched against the pair
joined. Each line binds once, so a title that recurs (`August 2026`, 79 times in
the Winter '27 document) consumes its occurrences in order.

A bound line's level is its outline depth, capped at h6. Everything else falls
through to size inference exactly as before.

**A malformed outline is never fatal**: `readOutline` returns null on any throw
and a broken destination costs one heading, not the conversion.

### The rule that took two attempts, and the measurements that decided it

The work order says a size-inferred heading between outline anchors is demoted
"if it conflicts with the outline's structure". The first reading — an inferred
heading must be *strictly deeper* than the entry enclosing it — is defensible
and wrong:

| | Winter '27 headings | its bullets-as-h2 | Net Zero headings |
| --- | ---: | ---: | ---: |
| before Q1 | 2,630 | 713 | 892 |
| **strict** (deeper than the anchor) | 2,008 | **22** | **286** |
| **shipped** (at least as deep) | 2,543 | 276 | 866 |

The strict rule hits Q1's stated target on Winter '27 almost exactly — 2,008
against the outline's ~1,990 — and **destroys the Net Zero guide**, which the
work order names as a baseline that must not regress. That document states 282
outline entries for 892 real headings: its per-object sections are siblings the
table of contents never listed, and demanding they sit *below* their enclosing
L2 anchor deletes 606 of them.

So the shipped rule demotes only a heading that claims to **outrank** the
structure the document stated. At equal depth it is a sibling, which is
ordinary. Text above the document's first stated heading is demoted regardless:
that is cover matter whatever size it is set in.

That leaves 276 bullets-as-headings on Winter '27 rather than 22. **Q2 is the
right place to close them** — their cause is a 19.2 pt decorative glyph
inflating a 12.8 pt line, and suppressing the symptom through outline authority
would leave the same defect live on every PDF without an outline. Fixing a cause
in the task that owns it beats masking it in the task before.

### Net Zero: 892 → 866, and the 26 are all junk

Every heading lost is front matter that was never a heading:

```
CONTENTS
Version 67.0, Summer '26
Chapter 1: Introduction to Net Zero Cloud . . . . . . . . . . . . . . .
Chapter 2: Net Zero Cloud Standard Objects . . . . . . . . . . . . . . .
… (ten table-of-contents dot-leader lines)
```

Chrome, folios and table rows are untouched: 5 residual head lines, 1 bare
number, 3,122 table rows — identical to the T2/T3 baseline.

### One side effect, caught by measuring rather than by a test

With the cover title no longer classified as a heading, the duplicate-title
suppression stopped firing — it lived inside the heading branch — and
`Net Zero Cloud Developer Guide` reappeared as a paragraph directly beneath the
`<h1>` built from the same string. The check now runs at paragraph flush, which
catches it whether the title arrived as one line or as two the joiner merged.
Neither the fixture nor the 46-case suite would have shown this; the Net Zero
before/after diff did.

### Corpus

| | baseline | after Q1 |
| --- | ---: | ---: |
| grand totals matched | 50/50 | **50/50** |
| all line-item codes found | 49/49 | **49/49** |
| each amount on its code's row | 52/52 | **52/52** |
| `#Error` preserved | 50/50 | **50/50** |
| documents emitting a real table | 49/50 | **49/50** |
| headline figure recovered | 44/50 | **44/50** |
| value-not-recovered markers | 6 = 6 | **6 = 6** |

Unmoved, twice — once after the outline work and again after the flush change,
because that one touches every document rather than only those with an outline.
**0 of the 50 scored documents carry an outline**, so the corpus exercises the
fallback path exclusively; that it stays flat is the evidence the fallback is
untouched.

Gates: `npm run check` clean, **46/46** harness cases, **51/51** packaged-extension
checks. `dist/sumcheck-1.6.0.zip` still `86670af2…`.

---

## 2026-08-19 · v1.7.0 cycle · Q0 — version bump first, to protect the pending artifact

### The artifact this cycle must not touch

```
dist/sumcheck-1.6.0.zip
SHA-256  86670af2b0da21e07386e5855c6091b6d06e2254e02d8ce2759a748f128ea928
size     6,493,701 bytes
```

Q9 re-checks that digest. Any packaging run during this cycle that changes it is
a failure, not a detail.

### `1.7.0-dev` is not a version Chrome will load

The work order asks for `1.7.0-dev` in both manifests and says that if the suffix
trips a gate assertion, the assertion is what should change. It trips something
that is not ours:

```
Required value 'version' is missing or invalid. It must be between
1-4 dot-separated integers each between 0 and 65536.
```

That is Chrome refusing to load the extension at all — `Extensions.loadUnpacked`
fails, the service worker never registers, and `verify-extension` goes from 51/51
to **0/2**. There is no assertion to relax; an extension whose manifest version
carries a suffix cannot be installed, so a cycle spent on that version would have
no working build to test at any point.

Manifest V3 provides the mechanism intended for exactly this case, so the cycle
uses it:

```json
"version": "1.7.0.1",
"version_name": "1.7.0-dev"
```

`version` is what Chrome parses and what `scripts/package.mjs` uses for the zip
name; `version_name` is the human-readable label and shows in `chrome://extensions`.
`package.json` keeps `1.7.0-dev`, which npm accepts and Chrome never reads.

### The protection is intact, which was the point

The work order's reasoning holds regardless of the string: the packaging gate
rebuilds `dist/sumcheck-<manifest.version>.zip` on every run, and last cycle that
silently overwrote the 1.5.0 artifact. What protects 1.6.0 is that the version
**differs** from it, not that it ends in `-dev`.

The fourth component is deliberate. `1.7.0.1` is distinct from **both** 1.6.0 and
the 1.7.0 that Q9 will produce, so mid-cycle packages cannot be mistaken for
either the pending release or the finished one. Q9 drops it back to `1.7.0` and
removes `version_name`.

Verified after the change: `npm run check` clean, **45/45** harness cases,
**51/51** packaged-extension checks, packaging landed on
`dist/sumcheck-1.7.0.1.zip`, and `dist/sumcheck-1.6.0.zip` still hashes to
`86670af2…` — byte-identical.

---

## 2026-08-19 · bench addendum · the two mechanisms a PyMuPDF pipeline used that we do not

Folded into the Winter '27 bench. Characterization only, no fixes, no version
change, `dist/sumcheck-1.6.0.zip` untouched.

The owner had an independent deterministic PyMuPDF pipeline convert the same
1,010-page PDF in **93.9 s** (owner-reported, not re-timed here — 16× our 5.8 s),
self-reporting 1,990 headings from a 1,968-entry embedded outline, 1,179 link
annotations and 104 image objects.

**Its output file was never delivered to the enclave**, so none of its
output-side numbers could be verified. What could be verified without it — and
was, locally, with PyMuPDF 1.28.2 against the source PDFs
(`~/mdforge-audit/verify-pdf-structures.py`) — is whether the PDF carries the
structures it claims to have used.

### (a) The embedded outline: real, large, and we ignore it

| document | outline | entries | levels |
| --- | --- | ---: | --- |
| Winter '27 release notes | **yes** | **1,968** | L1 67 · L2 315 · L3 405 · L4 837 · L5 344 |
| Net Zero Cloud guide | **yes** | 282 | L1 10 · L2 177 · L3 38 · L4 57 |
| Good Faith Estimates (50) | **no** | 0 | — |

The 1,968 figure is confirmed exactly. `src/core/adapters/pdf.js` contains no
reference to an outline; headings come from font-size inference alone. The
bundled pdf.js already exposes `getOutline`, so the data costs nothing to reach.

Scored both directions (the 1,968 entries reduce to 1,344 distinct titles — many,
like `August 2026`, recur):

| | Winter '27 | Net Zero |
| --- | ---: | ---: |
| distinct outline titles we emit as a heading | 1,254 / 1,344 — **93.3%** | 257 / 267 — **96.3%** |
| our distinct headings absent from the outline | **939 / 2,193 — 42.8%** | 123 / 380 — 32.4% |
| of those, beginning with a bullet glyph | **502** | 0 |

**Two in five of the headings we emit for this document correspond to nothing in
the document's own structure**, and the largest group is the bullet list items of
#10. The 589 outline entries we miss are led by `august 2026` — that is #11,
where we emit `August 2026August 2026` and the outline states the heading
plainly. One mechanism addresses both defect classes, which is why it is worth a
cycle rather than two point fixes.

It cannot be the *only* source: **0 of the 50 scanned Good Faith Estimates carry
an outline**, and that is the corpus every score is measured on. Font-size
inference stays as the fallback; the outline is a source-of-truth when present
and a cross-check either way. Filed as #15.

### (b) Link annotations: the premise does not hold — we already do this

I was asked to file an issue for extracting PDF link annotations. **We already
extract them, and by the available numbers more thoroughly than the pipeline
reports.** No issue filed; filing one would have asserted a defect that does not
exist.

| in the PDF | count | | in our output | count |
| --- | ---: | --- | --- | ---: |
| link annotations, all kinds | 5,261 | | Markdown links emitted | **3,612** |
| of which `LINK_URI` | 1,258 | | of which `http(s)` | 1,252 |
| of which `LINK_LAUNCH` (`/apex/…`) | 3,969 | | of which relative `/apex/…` | 2,360 |
| of which `LINK_GOTO` | 34 | | distinct targets | 2,025 |
| distinct URI targets | 757 | | | |

**We recover 1,252 of 1,258 URI annotations — 99.5%** — plus 2,360 launch-action
targets on top. `pdfLinks: true` has been the default all along. The Winter '27
completeness table already recorded this from the other side: our higher token
count against pdftotext is largely link targets pdftotext never emits.

### A correction to the published bench

The bench said the document carries **335 image XObjects**, taken from
`pdfimages -list`. That double-counts: of its 335 rows, 171 are images and **164
are transparency masks**. PyMuPDF reports **161 placements over 106 distinct
xrefs**, 154 of the placements carrying an SMask — exactly where the extra rows
come from. 161/106 are the counts to use, and Docling's 161 base64 blobs match
the placement count precisely, which corroborates both readings. The comparison
document and issue #12 are corrected; the pipeline's claim of 104 image objects
sits within two of the 106 measured.

### Still unverified

The pipeline's heading count, table count, header sample and link count in *its
own output* remain unchecked, and the claim that it assembles the stacked column
header correctly — the one that would confirm #9 is structural rather than
heuristic — cannot be tested without the file. No note was added to #9 asserting
it.

---

## 2026-08-19 · bench · Winter '27 release notes — Sumcheck 1.6.0 vs pdftotext vs Docling (characterization only)

Run before the v1.7 cycle, against the **released artifact**
(`dist/sumcheck-1.6.0.zip` unpacked and driven through the harness, plus the
packaged extension installed in Chrome). Full analysis and every raw output live
in the audit enclave: `~/mdforge-audit/winter27-comparison.md`. No fixes.

**Source:** Salesforce Winter '27 Release Notes, 1,010 pages, 18.2 MB,
born-digital, typeset by **Prince 15.4** — a different engine from the Net Zero
guide's XEP, which is what makes it a generalization test rather than a repeat.

### Timing, one machine, all measured

| tool | version | wall-clock | per page |
| --- | --- | ---: | ---: |
| **Sumcheck** | 1.6.0 released zip | **5.8 s** | **5.7 ms** |
| pdftotext | poppler 26.08.0 | 0.74 s | 0.7 ms |
| Docling `--no-ocr` | 2.120.3 | 205.8 s | 204 ms |
| Docling, default settings | 2.120.3 | **died at ~220 s, twice** | — |

Setup, excluded: poppler 17 s, venv + Docling 77 s, model download ~87 s.

**Docling cannot convert this document in one pass with default settings on a
16 GB machine.** Two runs died with no exit status at 220 s and 210 s, peak
3.87 GB resident, system down to ~56 MB free. Its default pipeline runs RapidOCR
across a document with a perfect text layer; `--no-ocr` gives **byte-identical
output** on a 20-page control (70,907 bytes either way) and finishes. That is the
configuration every Docling figure here comes from.

### The T2 chrome rules generalized — they were not overfit

| | printed | surviving | caught |
| --- | ---: | ---: | ---: |
| running head | 1,007 | 3 | **99.7%** |
| printed folio | 939 | 3 | **99.7%** |

The header idiom here is different from the one T2 was written against:
`Salesforce Release Notes` left and the section name right, **on one visual
line**, which the assembler joins. The prefix rule keys on the first three words
at a fixed height and strips all 39 section variants. A whole-line repetition
test could not have — the commonest variant covers 213 pages, 21%, against a
606-page threshold. The three survivors are front-matter pages whose header has
no section half, leaving exactly three words, one short of what the prefix rule
requires. Under-stripping, as intended.

### The headline question: tables crossing a page boundary

Sampling stated: all 33 tables interrupted by exactly one page marker, every 2nd
taken → 12, each judged against the page itself via `pdftotext -layout`, never
against the other tool's output.

| | Sumcheck | Docling |
| --- | ---: | ---: |
| continuation stitched into one table | **0/12** | **0/12** |
| stacked column header assembled | **0/9** | **8/9** |
| straddling row label recovered whole | **3/8** | **4/8** |

Document-wide: **87 of Sumcheck's 209 tables open with a mangled header split and
only 2 are correct; Docling gets 95 of 109.**

These tables carry a three-line stacked column header repeated on every
continuation page. Docling assembles it into one header row. We read it as a
header plus two junk data rows —

```markdown
| Enabled for | Requires | Contact |
| --- | --- | --- |
| Enabled for administrators administrator |  | Salesforce to |
| Feature users /developers | setup | enable |
```

**This is the mirror image of the Net Zero result.** There we were row-faithful
17/17 where Docling drifted 8/17; here the row bodies are fine and the header is
what breaks. Neither result generalizes to "tool X is better at tables", and
neither should be quoted alone. Both documents belong in the corpus.

Neither tool joins a table across a page break, and both truncate a row label
that wraps across one — within a page those labels stitch correctly, so T1 is
working and the defect is specific to the boundary.

### Other defect classes found

- **713 bullet list items emitted as `##` headings** — 27% of all headings,
  against 320 bullets that became real list items. Measured cause: body text is
  12.8 pt and the `•` glyph is drawn at **19.2 pt**; the bullet sits on its own
  baseline, the assembler joins it to its text, and the oversized decorative
  glyph carries the line to a 1.5 size ratio, over the h2 threshold. The heading
  branch runs before the list-marker branch, so `listMarker()` never objects.
- **86 headings contain their own text twice** — `### August 2026August 2026`,
  no separator. `pdftotext -bbox` shows the PDF draws it once. Reproduces on a
  one-page extract.
- **335 images across 131 pages produce no output and no indication.** The PDF
  adapter touches images only to measure a scan's DPI for OCR and never emits an
  `<img>`, so `imageMode` — offered in the settings panel as
  embed/extract/link/strip — has nothing to act on for PDFs. A gap, not a bug,
  but the setting implies a capability that does not exist for this format.

### What held

Completeness: residual against a chrome-stripped reference is **550 words of
339,459, 0.16%**, and inspection shows those are header text, not content. T3
holds — no split-title behaviour on this layout, no heading fragments of that
shape. 0 false review flags across 1,010 pages. The released app reported
`17 MB → 2.6 MB as .md · 85% smaller · ~582k tokens (estimated)`.

### Issues filed from this bench

Evidence landed in the repository before any of these became an issue, same rule
as the last bench.

| issue | class |
| --- | --- |
| #9 | stacked multi-line column headers read as a header plus junk rows — 2/209 against Docling's 95/109 |
| #10 | 713 bullet list items emitted as h2 headings, from a 19.2 pt decorative glyph |
| #11 | 86 headings containing their own text twice |
| #12 | 335 images producing no output and no indication, while `imageMode` offers four choices |
| #13 | page-boundary table continuation: never stitched, straddling row labels truncated |
| #14 | `verify-extension`'s end-to-end check requires a currency amount |

Nothing here duplicates the closed v1.6 ledger: #1 covered key-value structure
inside a cell, not a wrapped header; #6 covered a wrapped display title, not a
list item misread by size; #2 covered chrome, which this document confirms is
working.

### One harness limitation, not a converter defect

`verify-extension`'s end-to-end check requires the converted document to contain
at least one `$nn.nn` amount — a property of the medical-billing corpus it was
written against. On this document it reports FAIL beside 2.7 M characters of
correct output with tables and front matter present. Filed separately; the check
needs a document-agnostic assertion, the same lesson as the hardcoded `$151.00`
it already replaced once.

---

## 2026-08-19 · v1.6.0 cycle · T6 — wall-clock in the audit runner (#5), and the release

### The number the Docling bench was missing

The bench extrapolated ~14 minutes for the 1,349-page Net Zero Cloud guide and
then **declined to compare**, on the grounds that our own time for the same
document had never been measured and a figure with no denominator is not a
comparison in either direction. It has a denominator now:

| | pages | wall-clock | per page |
| --- | ---: | ---: | ---: |
| Net Zero Cloud guide (text layer) | 1,349 | **3.1 s** | 2.3 ms |
| Good Faith Estimate corpus (scanned) | 50 | **39.4 s** | 0.79 s |

Both measured on this machine, this build. The corpus figure has a median of
783 ms per document and a slowest of 1.0 s.

**Read those two rows together before quoting either.** They differ by a factor
of roughly 340 per page, and almost all of that is OCR. A page with a text layer
costs milliseconds; a page that has to be rasterized and read costs the better
part of a second. Any single "pages per second" number for this converter is a
statement about the corpus, not about the converter.

The 3.1 s figure was checked rather than trusted: the run was repeated, the
whole `node scripts/audit.mjs` invocation was timed at 4.3 s end to end
(including Chrome start-up), and the output was confirmed complete —
**1,758,674 bytes, byte-identical to the earlier run, 1,349 page markers, 892
headings, 3,122 table rows**. It is a real measurement of a complete conversion.

Against Docling's extrapolated ~14 minutes on the same document that is a large
ratio, and the bench's caution still applies in the other direction: Docling is
running layout models we are not. The two tools are doing different amounts of
work, and this note records our side of the arithmetic rather than a verdict.

### What was added

`test/audit.js` times each document from the first byte read to the last emitter
finishing. `scripts/audit.mjs` prints per-document wall-clock in the console
line and in the report body, with a corpus total, median, slowest document and
per-page cost. The per-page unit scales — milliseconds under 100 ms, seconds
above — because one fixed unit reports one of the two cases above as `0.00`.

`score-export` records its own wall-clock separately and labels it **scoring**
wall-clock, because it does not convert anything: 4–23 ms for 50 documents. It
is a different question from conversion cost and a report that quotes one number
without saying which invites the wrong comparison.

---

## The cycle, end to end

| task | issue | what moved |
| --- | --- | --- |
| T1 | #1, #4 | key-value structure inside a table cell survives as pairs in all four emitters |
| T2 | #2 | running heads 0.3% → **99.6%** caught, folios 0.0% → **100%** |
| T3 | #6 | a wrapped display title is one heading; 894 headings → 892 on the guide |
| T4 | #3 | size and token savings per conversion and per batch, and as JSON data |
| T5 | #7 | "Copy diagnostic info" — counts and settings only, absence proved by fixture |
| T6 | #5 | wall-clock per document and per corpus; release |

### Corpus scores, every task

| | baseline | 1.6.0 |
| --- | ---: | ---: |
| grand totals matched | 50/50 | **50/50** |
| all line-item codes found | 49/49 | **49/49** |
| each amount on its code's row | 52/52 | **52/52** |
| `#Error` preserved | 50/50 | **50/50** |
| documents emitting a real table | 49/50 | **49/50** |
| headline figure recovered | 44/50 | **44/50** |
| value-not-recovered markers | 6 = 6 | **6 = 6** |

Not one metric moved across three conversion-touching tasks. That is the
intended result and it is worth saying why it is not a null finding: the scored
corpus is single-page scanned forms, and T1's classifier, T2's chrome rules and
T3's size floor were each written to decline on exactly that shape. A corpus
that moved would have meant one of them was firing where it had no business.

### Fixtures added this cycle

| fixture | proves |
| --- | --- |
| `field-details.pdf` | nested key-value structure in a cell; row-faithfulness; per-page varying head; folios crossing a decade; a chrome line printed once |
| `split-title.pdf` | a wrapped display title merges — and three shapes that must not |
| `diagnostics.pdf` | a diagnostic block contains nothing of the document, by carrying a word that cannot occur by chance and a flag whose message quotes amounts |

Two of them earned their keep by failing when the implementation was wrong in a
way no eyeball would have caught: a character-class range that read `590` as
`90`, and a detached input buffer that made `source_bytes` zero for every PDF.
A third — the planted-leak run against `diagnostics.pdf` — was made to fail
deliberately, because an absence test nobody has seen fail is a comment.

### Release

- version **1.6.0** in `manifest.json` and `package.json`
- CHANGELOG entry summarizing the cycle with every issue closed by number
- `npm run check` clean · **45/45** harness cases · **51/51** packaged-extension
  checks · full corpus re-scored, all metrics at baseline, marker invariant
  holding
- `npm run package` → **`dist/sumcheck-1.6.0.zip`**, 6.2 MB, 308 files
- zip contents confirmed: `manifest.json` at 1.6.0, all four icons, `_locales/en`,
  the new `src/core/diagnostics.js`, and `LICENSE` and `NOTICE` both carrying
  `Copyright 2026 Everything Virtually LLC` — expected
- **Nothing was uploaded to the Chrome Web Store.** Submission timing is the
  owner's call once the 1.5.0 review resolves.

### A note on `dist/sumcheck-1.5.0.zip`, so the record is clean

That file was **rebuilt on 2026-08-19** as a side effect of the packaging gate:
`verify-extension` installs the packaged zip, and the gate runs `npm run package`
first, so every task in this cycle that ran the gate re-created it — from the
working tree at that moment, which by then contained this cycle's code.

**The local `dist/sumcheck-1.5.0.zip` is therefore no longer the artifact that
was submitted for review.** It carries T1–T5's conversion changes with a 1.5.0
version string. The two files are the same byte length (6,493,701) for exactly
that reason: they differ only where `1.5.0` and `1.6.0` appear, and those are the
same number of characters.

**The canonical 1.5.0 is the copy in the Chrome Web Store dashboard**, not
anything on this disk. If a 1.5.0 artifact is ever needed again it should be
downloaded from the dashboard or rebuilt from the `v1.5.0` commit — not taken
from `dist/`. The stale file is left in place rather than deleted; removing it is
the owner's call, and it is worth making, because a file named
`sumcheck-1.5.0.zip` that contains 1.6.0 code is exactly the kind of thing that
gets uploaded by mistake.

The release artifact for this cycle is **`dist/sumcheck-1.6.0.zip`**.

---

## 2026-08-19 · v1.6.0 cycle · T5 — "Copy diagnostic info", with zero document content (#7)

### What it copies

```
Sumcheck 1.6.0 · Chrome 151 · macOS
source_format: pdf · pages: 2
ocr: yes · ocr_pages: 2 · ocr_dpi: 300 · ocr_confidence_mean: 94.6 · ocr_flagged_fields: 4
review_flags: 3 · by_type: total-mismatch=1, not-a-word=2
settings: outputs=md+json · ocrMode=always · ocrResolution=300 · validate=off · (16 other settings at defaults)
```

and when nothing was changed from the defaults:

```
Sumcheck 1.6.0 · Chrome 151 · macOS
source_format: pdf · pages: 1349
ocr: no
review_flags: 0 · table_fallback: 11
settings: outputs=md · (19 other settings at defaults)
```

### The fixture, which is the feature

`test/fixtures/diagnostics.pdf` is built to make an absence provable. It carries
a word that cannot occur by chance (`Zquarnix`), a misspelling (`recieved`), and
a printed total of `$1,560.00` against line items that sum to `$1,550.00` — so
the arithmetic check fires and its message quotes `$1550.00`, `$1560.00` and
`$10.00`. If a flag's message ever reached the payload, those digits would come
with it.

Fifteen assertions. Eight say the block reports what it should; six say it does
not contain the file name, the title, a word from the body, an amount, or a
validator message; and one is the general form — **no twelve-character run of
the converted body appears anywhere in the block**. Twelve is long enough that a
shared word like `settings` cannot collide and short enough that any real leak
is caught many times over.

### Proving a negative assertion can fail

A test that asserts an absence passes trivially when the feature is broken, so
the assertions were checked against a planted leak: one line added to
`diagnostics.js` appending `review[0].message`. Three assertions failed
immediately, including the general one, reporting **65 leaked runs** starting
with `": line items"`. Reverted. An absence test nobody has seen fail is a
comment.

### Where the safety comes from

Structure, not care. `buildDiagnostics` is never given the converted text, the
flag objects' messages, or the file name — `flagCounts` reduces flags to
`{type: count}` before anything is formatted, and the caller passes `meta`
rather than the document. Every value that reaches the output also passes
through `plain()`, which admits identifiers, numbers and short enumerated words
and replaces anything else with `?` rather than truncating it, because a
truncated leak is still a leak.

### Two open questions from the issue, answered

**The file name.** Omitted. It is genuinely useful for reproduction and
genuinely private, and a reporter who wants to include it can type it — that way
it is a choice rather than a default.

**Failed conversions.** Offered, per the work order: a conversion that threw is
when this is needed most. The error message is the one string here that can
quote the document — `Sumcheck can't read "…"` names the file — so it is the one
string not included. The failed payload records `status: conversion failed` and
says nothing about why. A harness assertion runs the failed path and applies the
same leak check to it.

### Settings: deviations only

Reporting all twenty settings produced a 400-character line of mostly defaults.
A bug report's signal is what is unusual about the run, so only settings that
differ are named, followed by a count of those that do not. The version is in
the block, so the defaults it was measured against are recoverable. An assertion
fails if a changed setting is not named, and fails if a default one is.

### Surfaces

The control sits under the result notes with its reassurance printed beside it
rather than hidden in a tooltip — someone about to paste this into a public
issue should be able to read what it contains before clicking anything. Three
localized messages, 126 in the catalogue.

`verify-extension` asserts the control exists in the installed build and that
both its label and its note resolve to real text; a localized string that
resolves to nothing looks exactly like a feature that was never wired up. The
payload's contents are proved in the harness, where the planted-leak check can
actually be run.

The bug template's diagnostics field now says the button produces exactly what
the field wants, and that there is a test that fails if it ever stops being
true.

Gates: **45/45** harness cases, **51/51** extension checks. No conversion change;
no corpus re-score. `src/core/diagnostics.js` is in the packaged zip.

---

## 2026-08-19 · v1.6.0 cycle · T4 — size and token savings in the result header (#3)

### What it shows

Per conversion, under the result meta:

```
7.3 MB → 1.7 MB as .md · 77% smaller · ~437k tokens (estimated)
```

and across a finished batch:

```
Across 12 converted: 255 B → 1.9 KB · 664% larger · ~60 tokens (estimated)
```

That second line is real output from the verification run, not an illustration.
The batch there is twelve 21-byte text files, and twelve files whose front
matter outweighs their content genuinely are larger. The line says so rather
than clamping at zero, because a number that only ever reports good news is not
a measurement.

### Three decisions worth recording

**Which output the number describes.** The format the Copy and Download buttons
act on — so the figure always describes the file the reader is about to take
away, and it re-computes when they switch tabs. An average across four formats
would describe no file that exists.

**Bytes, measured before the adapter runs.** The fixture caught a real bug here:
`source_bytes` came back **0 for every PDF**. pdf.js transfers the input buffer
to its worker, which detaches it, so `byteLength` on the original view is zero
by the time the conversion returns. Measuring at entry rather than at exit is
the fix, and it is the kind of defect that a UI eyeball on a small text file
would never surface — the number was right for `.txt` and silently zero for the
format the feature exists for.

**One estimate, computed once.** `characters / 4`, computed on the document's
text in `convert.js`, and read from there by both the header and the JSON. Not
two computations that nearly agree — a pipeline reading `estimated_tokens` out
of the JSON gets the same integer a person read on screen. Every surface labels
it: the header says `(estimated)`, and the JSON carries
`"token_estimate": "characters/4"` in the same object as the number, so a
consumer cannot pick up the count without also picking up how it was made.

Issue #3 asked whether an estimate that is confidently wrong beats no number at
all. The answer taken here is that a *labelled* estimate beats both. Shipping a
real tokenizer would be exact for one model and wrong for the next, and would
cost megabytes of vocabulary for a figure nobody acts on to that precision.

### JSON, as data

`stats` gains three fields beside the existing block/word/character counts:

```json
"stats": {
  "blocks": 412, "words": 8801, "characters": 54210,
  "source_bytes": 7643205,
  "estimated_tokens": 437168,
  "token_estimate": "characters/4"
}
```

Additive only. `sumcheck.document/v1` is unchanged in structure, so nothing that
reads the schema today breaks.

### Corpus: not re-scored, and why — with the check that says so

The work order allows skipping the re-score unless an emitter's **scored** output
surface moved. The scorer reads Markdown, and Markdown did not change:

- `frontMatter()` enumerates its fields explicitly, so the new `meta` values
  cannot leak into a document's front matter
- a new assertion on the `sample.pdf` case fails if any front-matter key ever
  matches `/bytes|token|size|estimate/`
- three corpus documents converted before and after this task are **byte
  identical** apart from the `converted:` timestamp

The JSON emitter did change, additively. T6 re-scores the full corpus regardless
as part of the release checks.

### Fixtures

Three assertions on the existing `sample.pdf` case: the JSON stats carry the
figures, the estimator is named beside the count, and Markdown front matter
gained no keys. RED before the change on the first two — `source_bytes was
undefined` — and RED again on the first after the change, reading `source_bytes
was 0`, which is how the detached-buffer bug was found.

Three checks in `verify-extension`, on the installed build: the result panel
shows the line, the count is labelled an estimate, and the batch line totals the
batch. These belong there rather than in the harness because the strings only
exist in the installed app, and a localized message that resolves to nothing
looks exactly like a feature that was never wired up.

Gates: **44/44** harness cases, **49/49** extension checks (46 before this task).

### One thing the work order assumed that is not true

It asks for "both locales files updated". The repository ships **one** locale,
`_locales/en/messages.json`; there has never been a second. Eight messages were
added there, `npm run check` counts 123 and rejects an empty one, and the
verification run confirms no element falls back to showing its key. If a second
locale is ever added, these eight are part of what it has to carry.

---

## 2026-08-19 · v1.6.0 cycle · T3 — a wrapped display title split into two headings (#6)

### The fixture, and RED

`test/fixtures/split-title.pdf` — one page carrying the bug and three cases that
must not move. The bug reproduced on first conversion, character for character
with the issue:

```markdown
## Net Zero Cloud Developer

## Guide
```

The three controls are the point of the fixture, not padding. Two headings of
the same size separated by body text (`Overview`, `Details`). Two of the same
size separated by nothing but a wide gap (`Appendix`, `Glossary`). A heading
sitting directly above a body paragraph. Eight assertions; three failed and
five passed before the change, and all eight pass after.

### The fix

A heading now collects the visual lines it wrapped across before anything is
decided about it. Three conditions must hold together:

- the same type size within 6% and the same weight
- a gap that is ordinary leading for that size (≤ 1.6 × size), not a break
- the line above did not finish a sentence

The tolerance is relative rather than absolute because OCR reports glyph heights
normalized around 1, where an absolute tolerance accepts anything.

### The restriction that protects the corpus

The merge only applies to text set at **1.45 × body size or larger**. This is
the whole reason the scored corpus does not move. The h4 rules classify a short
bold line at body size as a heading, which is correct for a form label — and the
50-document corpus is scanned medical forms full of stacked bold labels one
leading apart. Without the size floor, `Patient Name` and `Date of Service`
become `Patient Name Date of Service`, and the fixture would never have shown
it. Display sizes only keeps that case out of reach entirely.

### Order of operations, which turned out to matter

The metadata-duplicate check now runs against the **merged** title rather than
its first line. On the document the issue was filed against, the merged
`Net Zero Cloud Developer Guide` matches the metadata title exactly and is
dropped as the cover title already emitted from front matter. The guide's
opening went from

```markdown
# Net Zero Cloud Developer Guide      <- from metadata
## Net Zero Cloud Developer           <- the same title, split
## Guide
### Version 67.0, Summer '26
```

to

```markdown
# Net Zero Cloud Developer Guide
### Version 67.0, Summer '26
```

Merging first is what makes the existing duplicate-suppression reachable. Had
the check stayed on the first line, the fix would have produced one heading that
merely duplicated the title instead of none.

### Blast radius, measured

Across the 1,349-page guide: **894 headings before, 892 after**. Two, and they
are the two the issue names. Eight content tokens differ, all of them the words
of the duplicated title.

### Corpus re-score

| | baseline | after T3 |
| --- | ---: | ---: |
| grand totals matched | 50/50 | **50/50** |
| all line-item codes found | 49/49 | **49/49** |
| each amount on its code's row | 52/52 | **52/52** |
| `#Error` preserved | 50/50 | **50/50** |
| documents emitting a real table | 49/50 | **49/50** |
| headline figure recovered | 44/50 | **44/50** |
| value-not-recovered markers | 6 = 6 | **6 = 6** |

The headline metric was the one to watch on a heading-adjacent change. It did
not move.

### Invariant there was a temptation to break

Merging by geometry alone — same size, tight gap — would have caught the case
and been wrong. `Appendix` and `Glossary` in the fixture are the same size with
nothing between them; only the gap separates a wrapped line from a section
break, and only the size floor separates a title from a stack of form labels.
Both guards are load-bearing and both are in the fixture.

---

## 2026-08-19 · v1.6.0 cycle · T2 — strip running headers and printed folios (#2)

The characterization note below states the problem and the counts it was measured
against. This is what shipped.

### Result on the Net Zero Cloud guide, 1,349 pages

| | before | after | **caught** |
| --- | ---: | ---: | ---: |
| running head lines | 1,334 | 5 | **99.6%** |
| folio lines | 1,366 | 0 | **100%** |

Before this the same document scored 0.3% and 0.0%.

The 5 surviving heads are not misses in any useful sense — each is a line where
the head is fused to body prose by the line assembly (`Net Zero Cloud Admin The
Stationary Asset Energy Use (StnryAssetEnrgyUse) record…`) or is a real sentence
that happens to open with the product name. Stripping those would delete
content, which is the one outcome the guardrail forbids.

Folios: 1,366 lines removed against 1,341 printed folios. The extra 25 are pages
where our own emitter rendered the same folio line twice — verified against the
pdftotext reference, which prints it once on every one of those pages. Both
copies are furniture and both should go. Two bare numbers survive in the whole
document (`3`, `0`) and both are content.

### Three rules, because there are three phenomena

Rule 1 is the existing whole-line test, unchanged. Nothing about its behaviour
moved, which is the cheapest way to be sure the fix cannot regress what already
worked.

Rule 2 keys on the first three words instead of the whole line, so the varying
tail stops defeating the match — but a shared opening alone is weak evidence,
since reference prose repeats openings constantly. The second half of the
evidence is height: chrome prints at a fixed offset on every page, and a body
line that shares an opening does not. Both are required.

Rule 3 does not test repetition at all. Folios are all different by
construction — 1,340 distinct values across 1,341 lines — so repetition can
never be the licence. The licence is the sequence: the printed number must
advance exactly as far as the page index does. That formulation tolerates the
pages carrying no folio (chapter openings, blanks) without tolerating a number
that merely sits in the same place.

### The one that mattered: rules 2 and 3 read only the outermost line

A running head sits above all body text and a folio below all of it. Restricting
the new rules to the topmost and bottommost line of each page is what keeps a
body line that opens with the same three words on every page — ordinary in a
reference manual — from being read as chrome. Rule 1 still sees the whole 8%
band, so no existing behaviour narrowed.

### Fixture

`test/fixtures/field-details.pdf` gained a head whose right half names the object
on that page, a folio, and one chrome-band line printed on a single page. The
new harness case `page-chrome` asserts six things: heads stripped, folios
stripped, field names survive, cell values survive, **the once-only line is
kept**, and the document title is not eaten. RED on the old adapter for exactly
the two miss classes; the other four passed before the change and still pass.

### A fixture that passed a broken implementation

The first version of `folioValue` was

```js
/^[\s[(-–—]*(\d{1,4})[\s\])-–—]*$/
```

where `(-–` inside the character class is a *range* from `(` to en-dash, which
spans the digits. The class ate the leading digit and the capture group took what
was left: `590` read as `90`. Against fixture folios 590/591/592 that still
yields 90/91/92 — a clean sequence — so the fixture went green on code that was
wrong, and only the 1,349-page document exposed it, where `599 → 600` reads as
`99 → 0` and the sequence collapses.

The fixture now numbers its pages 599/600/601. A rule that mis-reads the leading
digit sees 99, 0, 1 and cannot call that a sequence, so the bug fails at the
fixture where it belongs. This is the second time this cycle that the fixture
proved a necessary but not sufficient check; both times the corpus was what
caught it.

### Corpus re-score, conversion-touching as required

| | baseline | after T2 |
| --- | ---: | ---: |
| grand totals matched | 50/50 | **50/50** |
| all line-item codes found | 49/49 | **49/49** |
| each amount on its code's row | 52/52 | **52/52** |
| `#Error` preserved | 50/50 | **50/50** |
| documents emitting a real table | 49/50 | **49/50** |
| headline figure recovered | 44/50 | **44/50** |
| value-not-recovered markers | 6 = 6 | **6 = 6** |

Unchanged on every metric. The marker invariant holds. The 50-document corpus is
single-page scans with no running heads, so the pass has nothing to act on there;
that it stays exactly flat is the result worth having.

### What the change costs, measured

Diffing the guide before and after at token level, against a baseline with the
chrome removed by hand: 178 tokens of 220,013 differ, 0.08%. They are not spread
out — they sit in one four-column layout table that is mangled in both versions,
and removing the head above it changes how the continuation rows regroup. The
removal set itself is clean: every line the pass deleted is a running head or a
folio, and the folio values form the complete run 1…1,341 with no gaps.

That 0.08% is the honest price. Stripping chrome shifts what the table
continuation logic sees at a page boundary, and in a table that was already
being reassembled badly the reshuffle moves a few cells. It is not a new defect
class and it is not silent — those tables carry `table_fallback` and review
markers already.

### Invariant there was a temptation to break

The obvious way to reach 100% on folios is to drop the `k.length < 2` guard in
rule 1 so that bare numbers become countable. That would make every short
repeated token in the band strippable, which is exactly the over-stripping the
work order rules out. Rule 1 is untouched; rule 3 earns folios on its own
evidence instead.

---

## 2026-08-19 · v1.6.0 cycle · T2 characterization — why `stripRunningHeads` misses (#2)

**Measured before changing anything**, per the work order. No fix in this entry.

### Catch rate on the Net Zero Cloud guide, 1,349 pages

| | in source | survived | stripped | **catch rate** |
| --- | ---: | ---: | ---: | ---: |
| running head | 1,334 | 1,330 | 4 | **0.3%** |
| folio number | 1,341 | 1,341 | 0 | **0.0%** |

The honest headline is not "the pass misses some" — on this document **it catches
essentially nothing**. Both failures are by construction, and each has a single
cause.

### Cause 1 — folios are excluded before they are ever counted

`stripRunningHeads` builds its key by normalizing digits so that `Page 4 of 30`
and `Page 5 of 30` match:

```js
const key = (line) => line.text.replace(/\d+/g, '#').slice(0, 80);
...
if (k.length < 2) continue;
```

A bare folio is *only* digits. `"592"` normalizes to `"#"` — one character — and
the `k.length < 2` guard drops it. The guard is there to stop trivial keys from
matching, and the side effect is that the most common form of page furniture in
print-style documents can never be seen at all. **0.0% is not a tuning problem;
the code path does not exist.**

The folios themselves are about as regular as data gets:

- 1,341 folio lines across 1,349 pages
- **1,336 of 1,340** consecutive page pairs increment by exactly 1
- folio == page number − 8 on **1,339** pages (front matter accounts for the offset)
- 1,340 distinct values for 1,341 lines — a folio value essentially never repeats

That last line is exactly why a repetition-based stripper cannot see them, and
why the rule has to be *sequence*, not *repetition*.

### Cause 2 — the head key includes the half that varies

The running head is two parts: a stable left (`Net Zero Cloud Standard Objects`)
and a right that changes per object (`RentalCarEnrgyUse`). The key is the whole
line, so every object produces a different key.

- **215 distinct** surviving head strings
- most common appears on **107** pages; **median 4**
- the threshold is `ceil(1349 × 0.6)` = **810 pages**

Nothing is remotely close — the best candidate reaches 13% of the bar. The 0.3%
that *was* caught is the handful of pages whose head happens to be identical.

Prefix repetition, on the other hand, is overwhelming:

| prefix | distinct | most common | lines on a prefix shared by ≥2 pages |
| --- | ---: | ---: | ---: |
| first 3 words | 1 | **1,330** | 1,330 |
| first 4 words | 8 | 860 | 1,329 |
| first 5 words | 37 | 856 | 1,324 |
| first 6 words | 178 | 107 | 1,307 |

A five-word prefix already clears the 810 threshold on its own.

### What this implies for the fix

Two distinct rules, because they are two distinct phenomena:

- **Folios**: a chrome-band line that is only a number, whose values across pages
  form a monotone run. Repetition cannot license this one — the values are all
  different — so the license is the sequence.
- **Heads**: key on the stable prefix rather than the whole line, keeping
  repetition as the license.

The guardrail stands either way: a line appearing on one page is content. Both
rules stay inside `candidateChrome`'s top/bottom 8% band, so nothing in the body
is eligible regardless. Where a section title legitimately recurs in that band
and cannot be distinguished, prefer under-stripping.

### One thing the T1 fixture cannot test

`test/fixtures/field-details.pdf` carries an *identical* head on all three pages,
and that head is already stripped correctly — the existing pass handles the easy
case. The fixture as built does not reproduce this miss. T2's fixture needs a
head whose right half **varies per page**, which is the whole point.

### Method note

Measured against the 1.5.0 conversion of the guide (`netzero_cloud_dev_guide.md`)
and the pdftotext reference, both already in the audit enclave. T1 changed table
cell assembly only and does not touch page chrome, so the counts stand for the
current build; re-deriving them would have cost a 1,349-page conversion to
reproduce numbers about a code path T1 never entered.

---

## 2026-08-19 · v1.6.0 cycle · T1 — nested key-value structure inside table cells (#1, #4)

### The fixture, and RED

`test/fixtures/field-details.pdf` — three synthetic pages built from issue #4's
table with invented values. The source page is 7.6 MB and lives outside the
repository; what mattered was the *shape*, and the shape is reproducible: a
Field/Details table where each Details cell holds its own definition list, a
label on one line and its value indented beneath, plus a repeating running head
and an incrementing folio for T2.

The fixture reproduced the real defect exactly on first conversion — a
row-faithful table with the Details cell flattened to
`Type reference Properties Create, Filter, Group, Sort, Update Description …`,
which is what page 600 of the real guide produces.

**RED was precise**, which is the point of writing the assertions before the
fix: of seven checks, five passed and two failed. Table emitted ✓, every
expected value in its own row ✓ (17/17), no cross-row drift ✓, nothing promoted
out of the cell ✓ — *pairs survive as pairs* ✗ (0 label:value pairs found) and
*each label binds to its own value* ✗. That is the documented state written down
as a test: structure lost, faithfulness intact.

Two things the fixture surfaced that are **not** T1 and were left alone:

- Pages 1 and 2 carry a single field each and do not table at all — a run needs
  three rows. Pre-existing, unrelated to nesting.
- The fixture's running head is *identical* on all three pages and is already
  stripped. The real document's heads **vary** (`Chapter | ObjectName`), which
  is why they survive. The fixture as built does not reproduce T2's miss; T2
  will need a varying head, and that is now known before T2 starts rather than
  after.

### The fix

The indent was already in the data and was being thrown away. `buildTable`
joined every fragment on sight — `row[index] = row[index] + ' ' + text` — so the
one record of structure inside a cell, the horizontal offset, died at assembly.

Now fragments are collected **with their x** into a grid before anything is
joined, and each column is classified once:

- A column is a *definition column* when its fragments across all rows show two
  indents — at least two at the column's left edge and at least two indented
  past `tolerance` (the existing measured value, `max(bodySize * 0.9, 4)`, not a
  new constant).
- Classifying per column rather than per cell is deliberate: per cell, a field
  with one pair renders as prose while its neighbour with six renders as a list.
  Deciding once from all the evidence keeps a column internally consistent, and
  requiring two distinct labels stops a single wrapped line that happens to be
  indented from inventing structure that is not there.
- Within a definition cell, a fragment at the left edge opens a pair and
  anything indented belongs to the pair above — which is how a label with
  several values keeps all of them (`Possible values are` → both bullets).
- If fragments do not partition that way — a value before any label, or no label
  with a value — the cell falls back to a plain joined string. A column that
  only mostly looks like a definition list still renders its odd cell as text.

### All four emitters agree

The cell now carries `{ pairs: [[label, value]] }` rather than a string, and
each emitter renders it in the idiom it has:

| emitter | rendering |
| --- | --- |
| html | `<td>Type: reference<br>Properties: …</td>` — real `<br>` elements, every part escaped individually |
| md | `Type: reference<br>Properties: …` inside a valid GFM row |
| txt | `Type: reference; Properties: …` |
| json | same `; ` form, cell values still strings |

Two things had to be fixed for that to hold, and both were found by looking at
the output rather than by reasoning:

**Turndown's default `<br>` is a newline**, and a newline inside a GFM table
cell *ends the row*. The first run produced a table shattered into fragments of
prose. A rule now keeps `<br>` literal when it sits inside a `td`/`th` — the
only line break a GFM table accepts.

**`textContent` concatenates straight across a `<br>`**, so the text and JSON
emitters would have produced `referenceProperties`. Both now read cells through
a shared `cellText()` that renders the break as `; `.

**The JSON emitter keeps cell values as strings.** The work order allowed
exposing pairs as data "if that falls out naturally" — it does not. `tableData`
returns `{header, rows, records}` with `rows` as string arrays and `records`
mapping header→cell; making a cell an object would change the element type of an
existing field, which is a breaking schema change for anything already consuming
`sumcheck.document/v1`, and adding a parallel structure alongside it distorts the
block model for one table shape. Not forced, as instructed, and recorded here.

### Corpus

All five metrics at baseline, marker invariant asserted at 6/50 OK, lexicon
50/50, scorer exit 0:

| metric | result |
| --- | --- |
| grand totals matched | 50/50 |
| all line-item codes found | 49/49 |
| amount on its code's row | 52/52 |
| `#Error` preserved | 50/50 |
| documents with a table | 49/50 |
| headline figure recovered | 44/50 |
| value-not-recovered markers | 6/50 OK |

**0 of 50 documents changed**, ignoring timestamps. The work order predicted no
movement because the GFE tables are simple — measured rather than assumed, and
nothing to flag. It also means the new classifier declines to fire on ordinary
money tables, which is the behaviour that matters: a change to table assembly
that left the corpus untouched is a change that only fires where it should.

### Gates

`npm test` **42/42** (41 before) · `verify-extension` **47/47** ·
`npm run check` green.

### Invariant I was tempted to break and didn't

**Row faithfulness for structure.** The tempting shortcut is to pair labels with
values by scanning the joined string for known label words — it would have
passed the pair assertions without touching the grid. It also reintroduces
exactly the failure Docling exhibits: a guess about which value belongs to which
label, made after the evidence has been discarded. The assertions that already
passed at RED — 17/17 in the right row, zero drift — are the ones a structure
change is most likely to break, and they were kept in the case for that reason.

---

## 2026-08-19 · Doc sync to sumcheck.app, and the Discussions welcome post

**Docs only.** No product files changed — `git diff --name-only` over `src/`,
`manifest.json`, `_locales/`, `icons/`, `vendor/` and `package.json` returns
nothing. `dist/sumcheck-1.5.0.zip` was not rebuilt and no version was bumped;
1.5.0 is in Chrome Web Store review.

Verified the domain before writing any URL into a document: `https://sumcheck.app`
and `https://sumcheck.app/privacy/` both return **HTTP 200** (the privacy page
serving the right `<title>`), and both old URLs return **301** —
`mshresponse.github.io/sumcheck/` → `sumcheck.app/`, and the `/privacy/` path
likewise.

### Files touched

**`store/CHECKLIST.md`** — item 23's privacy URL is now
`https://sumcheck.app/privacy/`, and records explicitly that *the submission was
filed with the earlier `mshresponse.github.io` URL, which now 301s to this one,
so the submitted link still resolves.* Worth stating rather than silently
swapping: a reviewer comparing the checklist against what was actually submitted
would otherwise find a mismatch and have no way to tell whether it was a
correction or a discrepancy. The open-items paragraph and the source line pick up
the new domain, the latter now naming the homepage as well as the repository.

**`store/LISTING.md`** — three changes:

- A new **Homepage and privacy policy** section, because the dashboard asks for
  both fields and the packet documented neither. Carries the same note about the
  submitted URLs redirecting.
- The description's verifiability line now offers the homepage alongside the
  source repository.
- **The stale promo-tile line is fixed.** It read *"Not yet produced… flagged in
  CHECKLIST.md as an open decision"* — but `store/promo-440x280.png` exists and
  went out with the listing. `CHECKLIST.md` item 16 was closed on 17 August and
  this line was not updated with it. Now a plain file reference. A packet that
  says a submitted asset does not exist is worse than one that never mentioned
  it.

**`README.md`** — the header line leads with
[sumcheck.app](https://sumcheck.app) and its privacy-policy link moves to the
new domain.

Left alone deliberately:

- `docs/index.html` and `docs/CNAME` — the reviewer's, per the task.
- **The DEVLOG's own `github.io` reference** (17 August, R3). It records what was
  verified reachable *on that date*, which was true and is the point of a log.
  Corrections here are appended, not applied retroactively; this entry is the
  correction.

### Discussions

Enabled and publicly reachable — `/discussions` returns HTTP 200 with the six
default categories. It held **zero** posts, so the welcome post the previous task
specified did not exist.

Created as **#8, "Welcome — what Sumcheck is, and where to put things"**, in
Announcements. It covers what Sumcheck is (on-device, checks its own work, with
a worked `SUMCHECK:` marker example), the routing — bugs to Issues, questions and
half-formed ideas to Discussions, security privately to
**sumcheck@everythingvirtually.com** per `SECURITY.md` — and repeats the request
not to attach private documents, with the same three alternatives the issue
template gives. Verified publicly reachable at HTTP 200.

**It is not pinned, and I could not pin it.** GitHub exposes no pinning mutation:
introspecting the GraphQL `Mutation` type for pin-related fields returns
`pinIssue`, `unpinIssue`, `pinIssueComment`, `unpinIssueComment`,
`pinEnvironment` — nothing for discussions. `pinnedDiscussions.totalCount` reads
0, confirming the state rather than assuming it. Pinning is a web-UI action:

> <https://github.com/mshresponse/sumcheck/discussions/8> → **⋯** menu → **Pin
> discussion**

One click, and it is the last step of this task that needs a human.

### Gates

`npm test` **41/41** · `verify-extension` **47/47**. No corpus re-score: nothing
in the conversion path was touched.

---

## 2026-08-18 · Feedback infrastructure, and the candidate ledger migrated to issues

Pre-submission polish. **No conversion changes** — the corpus was not re-scored
because nothing in the conversion path was touched.

### Issue templates

`.github/ISSUE_TEMPLATE/` gains `bug_report.yml`, `feature_request.yml` and a
`config.yml` routing questions to Discussions and security reports to
`SECURITY.md`.

The bug template's first screenful is not a form field. It is a request not to
attach the document:

> Sumcheck runs entirely on your device and never sends your files anywhere. A
> GitHub issue is the opposite — it is public and permanent.

It then gives three ways to report without one — describe the *shape*, reproduce
with a synthetic file, or link something already public — and says plainly that
a vague report we can act on beats a precise one the reporter should not have
posted. A required checkbox confirms no private content is included, and the
diagnostics field asks for counts and settings instead.

This matters more here than in most projects. The people most likely to hit an
interesting bug are the ones converting invoices, medical estimates and
contracts; the conversion never leaves their machine and it would be a poor
trade if the bug report did.

Templates validated locally against GitHub's issue-form schema — element types,
required `id`s, labels, non-empty option lists — using the vendored js-yaml.
Anonymous fetch of the chooser redirects to login, so rendering could not be
confirmed that way.

### The app's Feedback link

A footer in the app page linking to the issue chooser, with the caution beside
the link rather than behind it:

> Report a problem or suggest a feature · Opens GitHub. Please don't attach
> private documents.

The moment someone decides to report a bug is the moment they reach for the
document that caused it, so the warning belongs at the click, not only in the
template they reach afterwards.

Both strings are localised (115 messages now). `verify-extension` counts 68
tagged elements, none empty.

### A false positive in `npm run check`, found and fixed

Adding the link broke the build:

```
✗ src/app/app.html loads a remote or inline resource: https://github.com/…
```

The no-remote-loads rule matched any `src` or `href` with an `http(s):` prefix.
An `href` on an `<a>` loads nothing — it opens a tab — so an outbound hyperlink
was being reported as remote code.

The rule now captures the owning tag and distinguishes a hyperlink from a
subresource. `src` anywhere and `href` on `<link>` are still rejected when
remote, and `javascript:`/`data:` are rejected everywhere including on anchors,
since those navigate the page itself into attacker-controlled content.

Verified in both directions: the link passes, and a planted
`<script src="https://evil.example/x.js">` still fails the build. **Loosening
the assertion to make the link pass would have removed the check that enforces
the product's central privacy claim** — the fix had to make it more precise, not
more permissive.

### The candidate ledger, migrated

Six candidates are now issues. Two of them — the split title and the
size/token-savings display — existed only in the reviewer's
`netzero-comparison.md`, which lives with the audit corpus **outside the
repository**. Migrating them as-is would have produced issues linking to
evidence nobody outside this machine can read, so those findings were recorded
in the DEVLOG first and the issues point there.

| # | title | labels |
| --- | --- | --- |
| 1 | Preserve nested key–value structure inside table cells | enhancement, conversion-quality |
| 2 | Strip running headers and printed folio numbers | enhancement, conversion-quality |
| 3 | Show size and token savings per conversion | enhancement |
| 4 | Add page 600 of the Net Zero guide as a regression fixture | test-fixture, conversion-quality |
| 5 | Record our own full-document wall-clock in the audit runner | tooling |
| 6 | A wrapped display-size title splits into two headings | bug, conversion-quality |
| 7 | Copy diagnostic info — zero document content | enhancement, privacy, **v1.6** |

Each carries its measurements rather than a summary: #1 has the 17/17 vs 8/17
row-attribution scores, #2 has the 1,368 folio lines and the 5/5 and 10/10
retention counts, #4 has the full expected-token table so the fixture can be
built from the issue alone.

#7 is the queued v1.6 candidate. Its constraint is the feature: counts and
settings, never a file name, never converted text, never a flagged word. The
issue says the fixture should assert the *negative* — that the block contains no
substring of the converted text — because the failure mode is inclusion, not
omission.

Discussions enabled. Seven labels created.

### Screenshots refreshed

The footer is visible in the drop-zone screenshot, so the three committed store
screenshots were regenerated. A store packet depicting a build that no longer
exists is the kind of small staleness that survives all the way to a reviewer.

### Gates

`npm test` **41/41** · `verify-extension` **47/47** · `npm run check` green.

No corpus re-score: nothing in `src/core/` was touched. The only source change
outside the app page is the check script, which is build tooling.

### Invariant I was tempted to break and didn't

**Making the failing check pass by relaxing it.** One character — dropping
`href` from the pattern — and the build would have gone green. It would also
have stopped detecting a remote stylesheet, which is precisely the class of
thing the privacy claim in the store listing rests on. The check was wrong about
*this* link and right about the rule; the fix was to teach it the difference.

---

## 2026-08-18 · Candidate ledger — the netzero comparison findings, recorded

Recorded so every open candidate has evidence in this file. Three of these came
from the reviewer's `netzero-comparison.md` (Sumcheck 1.5.0 vs a pdftotext
ingestion of the same 1,349-page guide), which lives with the audit corpus
outside the repository — so its findings are restated here rather than linked,
and the issues that track them point at this entry.

**No work done.** This is the ledger being made complete before it is migrated
to GitHub issues.

### From the netzero comparison

**Printed folio numbers survive — 1,368 bare page-number lines.** The
running-head stripper detects text that *repeats*; an incrementing number never
does. Candidate rule: a bare integer alone at a page's text edge, matching a
monotone sequence across pages, is a folio.

**Varying running headers survive** — `Chapter | CurrentObjectName`. The left
half repeats and the right half changes per page, so the pair escapes a
whole-line repetition test. Candidate rule: strip lines whose *prefix* repeats
at the same page position.

Both are the same defect seen from two angles, and both are why candidate 1 in
the Docling bench note says *investigate why `stripRunningHeads` misses these
before writing new rules*. Docling strips both, so the behaviour is achievable.

**A display-size title wrapped across two lines becomes two sibling headings.**
Page 1 emits `## Net Zero Cloud Developer` followed by `## Guide`. One heading
was split into two because the source line wrapped.

### Where the size/token-savings figure comes from

The same comparison measured our output against the pdftotext artifact for the
same document:

| | Sumcheck `.md` | pdftotext `.txt` |
| --- | --- | --- |
| content tokens | 185,802 | 185,849 |
| size | 1.8 MB | 3.5 MB (≈1.7 MB of it layout-as-whitespace) |
| headings | 895 | 0 |
| tables | 545 real Markdown tables + 11 declared `table_fallback` | none |

Equal content, roughly half the bytes. The candidate is to *show* that in the
app — a per-conversion figure for how much smaller the Markdown is than the
source, which for anyone feeding an LLM is the number that matters. It is a
display feature, not a conversion change, and nothing about it has been designed
yet.

### The ledger, as migrated

Six candidates, now GitHub issues:

1. Nested key-value structure inside table cells — Docling bench note
2. Strip running headers and folio numbers — this entry + Docling bench note
3. Show size and token savings per conversion — this entry
4. Page 600 as a regression fixture — Docling bench note
5. Record our own full-document wall-clock — Docling bench addendum
6. A wrapped display-size title splits into two headings — this entry

Plus one queued for v1.6: **Copy diagnostic info** — a button that copies
version, settings and warning/flag counts, with zero document content, so a bug
report can carry context without carrying anyone's document.

---

## 2026-08-18 · Bench — Docling vs Sumcheck on the Net Zero Cloud guide (characterization only)

**No fixes.** Findings go to the candidate list.

**Setup.** `docling 2.120.2`, `PdfPipelineOptions(do_ocr=False)` — the guide is
born-digital and our own run used 0 OCR pages, so both sides read the text
layer. Sampled ranges, because 1,349 pages on CPU is impractical.

### Timing

| range | pages | wall | s/page |
| --- | --- | --- | --- |
| 1–5 **cold** (includes model download) | 5 | **112.43 s** | 22.49 |
| 1–5 warm (same range, re-run) | 5 | 4.77 s | 0.95 |
| 598–602 | 5 | 1.53 s | **0.31** |
| 1340–1349 | 10 | 6.47 s | 0.65 |

Re-running range 1 warm is how the download is separated rather than estimated:
**one-time model cost = 112.43 − 4.77 = 107.7 s**. Package import is a further
38.4 s per process; converter construction is free (0.05 s).

**Extrapolated full document, warm:** 20 sampled pages in 12.77 s = **0.64
s/page → ~14.4 min** for 1,349 pages, plus ~108 s of first-run model load.

That blended figure hides a 3× spread — 0.31 s/page on the dense object-reference
pages against 0.95 s/page on the front matter — so the honest range is **7 to 21
minutes** depending on page mix. The sample is 20 of 1,349 pages (1.5%) and is
not random: it is three contiguous blocks chosen for content, so the
extrapolation is indicative, not a measurement.

**No speed comparison is claimed.** Our own full-document wall-clock was never
recorded, so there is nothing to compare against. Worth capturing next time we
run it.

### Quality — page 600, the `RentalCarEnrgyUse` Field/Details table

Physical page 600 = printed folio 592 (the document's folio runs 8 behind, and
that mapping is consistent across the sampled block).

Ground truth from the PDF text layer: `Details` is a **nested definition list** —
a label (`Type`, `Properties`, `Description`, `Relationship Name`, `Relationship
Type`, `Refers To`) on one line, its value indented beneath.

**Does Docling emit a real table?** Yes, on part of the range — and then it stops.
Within pages 598–602 it emits 4 tables, but **37 of its 48 headings are cell
labels promoted to `##`**: `## Type`, `## Properties`, `## Description`,
`## Field`, `## Details`. The table decomposes mid-object into a flat run of
headings, and the field-to-value association is gone with it. This is specific to
this table shape — the same run produced 0 mis-promoted labels on pages 1–5 and
0 on 1340–1349.

**Cell structure vs ours.** Both flatten the nested pairs into run-on text;
neither preserves the definition list. That is our known weakness and it is
Docling's too. The difference is what survives the flattening. Scoring each of
the five fields on page 600 for the tokens ground truth says belong in its row:

| | expected tokens in the correct row | cross-row contamination |
| --- | --- | --- |
| **Sumcheck** | **17 / 17** | **0** |
| Docling | 8 / 17 | 1 |

Docling's rows drift. `SuplScope3Emissions` carries StartDate's description
("The date from when the values of this energy use record are valid"),
`StartDate` opens with Scope3GhgCategory's trailing bullet
("• EmployeeCommuting"), and `Scope3EmssnSrcId` truncates after
"Type reference Properties" — losing its Properties value, Description,
Relationship Name, Relationship Type and Refers To.

So on this page we are flattened-but-faithful and Docling is
flattened-and-lossy. For a document where the whole point is which value belongs
to which field, that difference matters more than the flattening both share.

**Header and folio.** Docling **strips both** — 0 occurrences of the running
header "Net Zero Cloud Standard Objects" and 0 bare folio lines across the whole
598–602 range. We keep both, on 5/5 pages of that range and 10/10 of pages
1340–1349. (On pages 1–5 we keep a header on 1/5 and no folios, because the front
matter has neither.) This confirms the reviewer's finding, and Docling
demonstrates the behaviour we would want.

### Candidate list

1. **Strip running headers and folio numbers.** Confirmed against a second
   implementation that does it. Detectable the way we already detect repeated
   headers elsewhere: a line recurring at the same position across most pages,
   and a bare integer alone at the page foot. Our `stripRunningHeads` option
   exists and did not catch these — worth finding out why before adding
   anything.
2. **Preserve nested key-value structure inside a table cell.** Both converters
   fail this. The source is a definition list; a faithful rendering is a nested
   list or `label: value` pairs inside the cell, not a run-on sentence. This is
   the larger prize and the harder one.
3. **Do not chase Docling's table detection here.** On the page that matters it
   scored 8/17 against our 17/17 and misattributed content across rows. Whatever
   we change, this page is now a regression fixture candidate with ground truth
   already extracted.

### Environment — for cleanup

The task anticipated a ~3 GB venv. Actual footprint is larger and in four
places, because **system Python 3.9.6 could not install Docling at all**:
`pyobjc-core` has no cp39 wheel for this platform and its source build fails on
current clang (`-Wdefault-const-init-var-unsafe` is now an error). Docling itself
is `py3-none-any`; the blocker was a transitive macOS dependency. I installed
`python@3.12` via Homebrew and rebuilt the venv on it.

| what | size | note |
| --- | --- | --- |
| `~/dl` | 1.3 G | the venv, safe to delete |
| `~/.cache/huggingface` | 506 M | layout models, safe to delete |
| `~/Library/Caches/pip` | 572 M | wheel cache, safe to delete |
| `/opt/homebrew/Cellar/python@3.12` | 80 M | `brew uninstall python@3.12` if unwanted |

**~2.4 GB total.** Disk is at 89% with 22 GiB free.

Also worth recording as a method note: the first install reported `rc=0` while
having failed, because the exit code came from the `tail` at the end of a
pipeline rather than from `pip`. The install log had to be read to discover it
had not worked. Same family as every other "green but didn't run" finding in
this log.

### Artifacts

`~/mdforge-audit/docling-p1-5.md`, `docling-p598-602.md`,
`docling-p1340-1349.md`; raw timings in `/tmp/docling-bench.json`.

### Addendum — queued, and cleanup done (18 August 2026)

**Queued as a fourth candidate: record our own full-document wall-clock.** The
bench above extrapolates Docling at ~14 min for 1,349 pages and then declines to
compare, because our own time for the same document was never measured. Next
time `npm run audit` runs on the netzero guide, time it and record pages,
wall-clock and s/page here. Until then the Docling figure has no denominator and
should not be quoted as a speed comparison in either direction.

**Cleanup.** The 2.4 GB the benchmark added is staged at
`~/_to_delete/2026-08-18-docling-bench/` rather than deleted — venv (1.3 G),
Hugging Face model cache (506 M), pip cache (572 M), and the three pre-rename
`mdforge-1.0.0/1.1.0/1.2.0.zip` builds (49 M) that were still sitting in
`dist/`. A `README.txt` in that directory lists what each item is and the single
command that removes them. The three Docling `.md` outputs stay in
`~/mdforge-audit/` — they are the artifact the exercise was for.

Homebrew `python@3.12` (~80 M) is **still installed**: uninstalling is a
deletion, so it is left for the owner, with the reason it was needed recorded in
that README. Nothing in Sumcheck depends on it.

---

## 2026-08-17 · v1.5.0 cycle · R3 (open source) and R4 (final gates)

### The R3 questions were not answered, and most of them did not need to be

The go-ahead said "proceed with the owner's answers", but no answers arrived
with it. Rather than stop a second time on questions the environment already
settles, I answered what could be answered from evidence, chose defensible
defaults for the rest, and recorded both here.

**Answered by the machine, not by guessing.** `gh auth status` reports a single
authenticated account, `mshresponse`, with `repo` and `workflow` scopes, and
`git config user.name` on this machine is the same account with its GitHub
noreply address. The work order's condition was that the owner authenticate
rather than that I be told a name; he had. I did check `gh api user` for a
display name to corroborate — it returns null for both `name` and `email`, so
the corroboration is circumstantial: one authenticated account, matching git
identity, on the owner's machine. Recorded because "the only account present"
is the reasoning, and if it is wrong the repository is in the wrong place.

**Defaults I chose, and why:**

| question | choice | reasoning |
| --- | --- | --- |
| Pages layout | `docs/privacy/` | Pages serves `/docs` from a branch with no Actions workflow, and it keeps `store/` purely as submission sources that `npm run check` already asserts are excluded from the zip |
| `vendor/` in git | **ignored**, except `vendor/VERSIONS.json` | 6 MB of third-party binaries do not belong in a history; the pinned versions do, and `THIRD_PARTY_NOTICES.md` is generated from them. A fresh clone runs `npm run build` first, which `CONTRIBUTING.md` says in its second paragraph |
| privacy contact | `mike@everythingvirtually.com` | the only address the work order names, and the same one `SECURITY.md` uses |
| commits | one initial commit, then one for the live URL | the work order asked for one; the second exists because the Pages URL is not knowable until after the push |

### Nothing corpus-derived is tracked — checked four ways

The work order asked for confirmation rather than assertion, so:

1. **By content.** Grepping every staged file for corpus strings — `good faith
   estimate`, the tax ID, both street addresses — returns six files, and every
   hit is a *reference*, not document content: example expectation JSON in
   `README.md` and `scripts/audit.mjs`, measurement narrative in `STATUS.md` and
   the DEVLOG, the disputed-token list in `test/audit.js`, and synthetic fixture
   text drawn onto a canvas in `test/harness.js`.
2. **By patient-shaped field.** `date of birth`, the DOB, `patient details` →
   one hit, `STATUS.md`, and it is the *field label* in a note about `M H`
   collapsing to `MH`, which is a cosmetic OCR defect.
3. **By artifact shape.** No `.words.json`, no corpus PDFs, no `out/` directory,
   no `mdforge-audit/`. The two staged PDFs are `test/fixtures/sample.pdf` and
   `locked.pdf`, both generated by `scripts/make-fixtures.mjs`.
4. **By binary.** 14 staged binaries: the four committed icons, the inspection
   strip, three screenshots, the promo tile, and four generated fixtures —
   including `test/fixtures/callout-page.png`, the real corpus page raster that
   ships per the owner's synthetic-corpus ruling.

`.gitignore` also excludes the corpus paths outright, so a stray copy inside the
tree cannot become a commit.

### Published

**https://github.com/mshresponse/sumcheck** — public, 107 files, Apache 2.0.

The DEVLOG went up unedited. It records measurements that turned out wrong, a
suite that printed green while skipping eight cases, a zip that passed every
gate and installed nowhere, and an icon I had to be told was malformed. That is
the point of it: a history that only contains successes is not evidence of
anything.

`CONTRIBUTING.md` states the four rules this project actually runs on —
fixture-first, never silently rewrite a value, measure rather than assert, and
append DEVLOG corrections instead of editing them. `SECURITY.md` scopes reports
to what matters here: anything causing a network request at runtime, anything
escaping the sanitizer, anything reading a page without user action, and
anything writing a value the source document does not contain.

**GitHub Pages is live**, serving `docs/` — the privacy policy is at
<https://mshresponse.github.io/sumcheck/privacy/>, verified **HTTP 200** with its
no-collection statement present, not merely deployed.

That closes **checklist item #23**, the last store requirement that was ours to
satisfy. Item #16 closed too: the reviewer's `store/promo-440x280.png` is in the
tree. What remains before submission is the owner's account and his distribution
choices, and nothing else.

### R4 — final gates

| gate | result |
| --- | --- |
| `npm test` | **41/41** |
| `verify-extension` | **47/47**, including the packaged zip installing and resolving as *Sumcheck — PDF & Document to Markdown* |
| `npm run check` | green |
| `npm run package` | **`dist/sumcheck-1.5.0.zip` — 6.2 MB** |

Corpus, under the new marker prefix and the renamed attributes:

| metric | result |
| --- | --- |
| grand totals matched | 50/50 |
| all line-item codes found | 49/49 |
| amount on its code's row | 52/52 |
| `#Error` preserved | 50/50 |
| documents with a table | 49/50 (one documented `table_fallback`) |
| headline figure recovered | 44/50 |
| **value-not-recovered markers** | **6/50 OK** — asserted equal to the 6 missing a headline |
| prose lexicon flags | 50/50 |
| scorer exit code | **0** |

Zip contents audited both ways: `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`,
`_locales`, the committed icons and the manifest are all present; `store/`,
`test/`, `scripts/`, `docs/`, `dist/`, the wordlist build sources and `.git` are
all absent.

### Invariant I was tempted to break and didn't

**Tidying the DEVLOG before making it public.** It is 1,700 lines and a
substantial fraction of it is me being wrong in public — a PSM finding I had to
retract, a metric I mis-measured twice, an icon that needed a second and third
attempt. The temptation to summarise it into something that reads like
competence was real, and the work order pre-empted it in one clause: *do not
rewrite the DEVLOG for publication — it is the project's honest record and that
is the point.* A converter whose selling proposition is that it tells you when
it is unsure would be a poor thing to ship alongside a history that hides when
its author was.

---

## 2026-08-17 · v1.5.0 cycle · R1 addendum, R1b, R2

### APPENDED CORRECTION to the R1 note — icons are committed assets, not build products

The R1 note describes `make-icons.mjs` as the thing that draws the mark. Owner
ruling, and it is the right one: the four PNGs in `icons/` are the reviewer's
approved renders and are now **committed canonical assets**. `npm run build`
must never overwrite them — an icon is a design decision made by a human looking
at it, and a build step that silently redraws one can undo that review without
anyone noticing. Which is how this project shipped a malformed sigma once
already.

`make-icons.mjs` is now verify-first:

- **Default** reads only. It checks each icon exists, decodes as 8-bit RGBA, has
  the right dimensions, is not clipped at the canvas edge, and carries (or does
  not carry) the badge as intended. It never writes to `icons/`. Confirmed by
  hashing before and after: byte-identical.
- **The 128's store geometry is asserted against the accent tile, not the ink
  box.** The ink box is 109×109, because the badge deliberately overhangs the
  square by 13px into the padding ring. The artwork the store spec is talking
  about is the tile, and it measures **exactly 96×96 at (16,16)**.
- **`docs/icon-inspection.png` is rebuilt from the committed PNGs**, decoded and
  magnified nearest-neighbour in pure Node — so the strip a reviewer looks at is
  the bytes that ship, not a re-render that might differ.
- **`--force` still redraws**, as disaster recovery, behind a loud warning that
  says it is not the source of truth and that a human has to look at the strip
  before committing the result.

One correction to my own expectations table: I had 32 dropping the badge. The
canonical set carries it at 128/48/32 and drops it only at 16, and the verifier
now asserts that. Caught because the check failed on the committed asset — which
is the check working.

The packaged zip carries the committed icons, verified by hashing repo against
zip for all four sizes.

---

### R1b — `data-mdf-*` → `data-smc-*`

The last trace of the old name in product output. These are the structure hints
adapters encode for the emitters — page breaks, slide numbers, speaker notes,
review flags — and they **survive into emitted HTML**, where the stylesheet
selects on `[data-mdf-review]`. 27 occurrences across 11 files: five adapters,
three emitters, the sanitizer, the validator, the app stylesheet and the
harness.

**The diff shows only attribute strings moved.** One scanned PDF and one deck,
converted to all three formats before and after:

| output | differing lines | what |
| --- | --- | --- |
| `scan.pdf.md` | **0** | Markdown consumes the attributes; nothing reaches the file |
| `deck.pptx.md` | **0** | same |
| `scan.pdf.html` | 6 | two CSS selectors and one `<span>` attribute, both names only |
| `deck.pptx.html` | 10 | same shape, more slides |
| `scan.pdf.json` | 2 | the `converted` timestamp — nothing else |
| `deck.pptx.json` | 2 | the `converted` timestamp — nothing else |

**Full corpus re-score:** all five metrics at baseline, marker invariant asserted
by the scorer at 6/50 OK, lexicon flags 50/50. Against the R1 run, **0 of 50
documents changed** ignoring timestamps — the expected result, since Markdown
never carried these attributes.

Left alone deliberately: the turndown rule *names* were already renamed in R1,
and `data-smc-` is now the only prefix in the tree. `grep -rn "data-mdf"` over
`src/`, `test/` and `scripts/` returns nothing.

---

### R2 — Apache 2.0

`LICENSE` is the **canonical Apache 2.0 text**, fetched from apache.org and
byte-verified: the only line differing from upstream is the Appendix's
`Copyright [yyyy] [name of copyright owner]`, filled in as
`Copyright 2026 Michael Hintze`. I deliberately did not use the reflowed copy a
summarising fetch returned — a LICENSE file wants exact bytes, both for
diff-ability and because licence-detection tooling matches on them.

`NOTICE` follows Apache convention: product, copyright, the licence pointer, and
one line directing to `THIRD_PARTY_NOTICES.md` for the bundled components, which
are explicitly *not* covered by the copyright above.

**Both ship in the package.** Apache §4(a) requires a copy of the licence with
any distribution and §4(d) requires the NOTICE to travel with it; a packaged zip
is a distribution. `scripts/package-contents.mjs` includes them and
`npm run check` now fails if either is missing from the tree or the include list
— the same guard that caught `_locales` being declared and not shipped.

`docs/LICENSING.md`'s own-code section is rewritten. It used to document the
proprietary stance and instruct "replace it with your EULA when you publish";
that instruction has been executed in the other direction and the section now
says so. It records what Apache 2.0 grants (use, modify, distribute, sell,
including closed-source; plus the explicit patent grant that is the main reason
to prefer it over MIT here), and what §6 withholds: **the trademark**. A fork
gets the code, not the name or the Σ mark. It also states plainly that
relicensing is one-way in practice — published versions cannot be recalled —
because that is a consequence of the owner's decision worth having on the
record rather than discovered later.

README gains a License section. `store/LISTING.md` now says Sumcheck is open
source and links the repository, so the listing's "verifiable by inspection"
claim points at something a reader can actually open.

**One placeholder, flagged rather than guessed:** the listing carries
`https://github.com/OWNER/sumcheck`. I do not know the owner's GitHub account
name, and inventing one would put a dead link in the store copy. It is called
out inline in `store/LISTING.md` and is question 1 at the R3 stop.

---

### Gates

`npm test` **41/41** · `verify-extension` **47/47** · `npm run check` green ·
`npm run package` → **`dist/sumcheck-1.5.0.zip`, 6.2 MB** carrying `LICENSE`,
`NOTICE`, `THIRD_PARTY_NOTICES.md`, `_locales` and the committed icons.

Corpus: 50/50 · 49/49 · 52/52 · 50/50 · tables 49/50 · headline 44/50 · markers
6/50 OK · lexicon 50/50.

### Invariant I was tempted to break and didn't

**Making the icon verifier pass by loosening it.** The first run failed on
`icon-32` — my table said no badge, the asset had one. The quick fix is to
delete the assertion. The right one was to find out which was wrong, and it was
me: the owner's canonical set carries the badge at 32. An assertion that gets
relaxed whenever it fires is not an assertion.

---

## 2026-08-17 · v1.5.0 cycle · Task R1 — rename, MDForge → Sumcheck

### Corpus re-score under the new marker prefix

`MDFORGE:` → `SUMCHECK:` is conversion-touching, so the full 50-document corpus
was re-scored. Every metric identical, and the marker invariant holds under the
new prefix:

| metric | before | after |
| --- | --- | --- |
| grand totals matched | 50/50 | 50/50 |
| all line-item codes found | 49/49 | 49/49 |
| amount on its code's row | 52/52 | 52/52 |
| `#Error` preserved | 50/50 | 50/50 |
| documents with a table | 49/50 | 49/50 |
| headline figure recovered | 44/50 | 44/50 |
| **value-not-recovered markers** | **6/50 OK** | **6/50 OK** |
| prose lexicon flags | 50/50 | 50/50 |

The scorer's assertion is doing real work here: it parses `SUMCHECK: value not
recovered` and compares against the documents actually missing a headline. Had
the emitter and the scorer disagreed about the prefix, this would read 0/50 and
fail — which is the check that makes "the invariant holds under the new prefix"
a measurement rather than a hope.

Diffed against the previous run, exactly two lines change per document: the
`generator:` line and the marker prefix. Nothing else moved.

### The icons were wrong, and only looking at them showed it

The first attempt hand-authored Σ as four quads and drew each size at its target
resolution. Magnified, it was visibly broken: uneven bars, stair-stepped
diagonals, an off-centre vertex, and a 16px that was mud. Rebuilt on three
rules, each of which is in the file as a comment because breaking it is what
produced the failure:

1. **One canonical rendering per variant, then downscale.** Each variant is
   drawn once at 1024px and reduced by repeated halving with
   `imageSmoothingQuality = 'high'`. Drawing at 16px puts every edge on a
   half-pixel.
2. **The sigma is a real glyph.** `fillText('Σ')` in a bold system face, with a
   guard that fails the build if the face has no sigma rather than shipping a
   tofu box. Correct letterform geometry for free — which is how the reference
   tile got its clean sigma.
3. **Simplify as it shrinks.** 128 and 48 carry the full mark; 32 drops the
   badge; 16 drops the badge, uses the whole canvas and sets the sigma heavier
   and larger. A check badge inside 16 pixels reads as dirt.

Rendering runs in the headless Chrome this project already drives, so no
graphics dependency was added — and it is build-time either way.

One more fix came out of measuring rather than eyeballing: each master leaves
slack around the mark (tile inset, room for the badge to overhang), and
downscaling the whole canvas carried that slack into the icon. The 128 came out
as **94×94 of artwork in uneven 18/16px padding**. Masters are now cropped to
their ink before downscaling, and the 128 measures **exactly 96×96 at (16,16)** —
the store spec, by construction rather than by luck.

`docs/icon-inspection.png` is the magnified strip, regenerated by
`npm run build`. Icons are the one artifact where a passing build proves
nothing.

The in-page logo was a separate leftover: both `app.html` and `popup.html` still
drew the old "M" as inline SVG, so the first regenerated screenshot showed the
new name under the old mark. Both now draw the sigma and badge.

### Grep disposition

`grep -ril mdforge` over source, then every hit decided:

**Renamed — product output**

| what | where |
| --- | --- |
| `MDFORGE:` review markers | `emit/markdown.js` (the one write site) |
| `generator:` constant | `convert.js` |
| HTML `<meta name="generator">` fallback | `emit/html.js` |
| "MDForge can't read …" error | `convert.js` |
| **JSON schema id** `mdforge.document/v1` → `sumcheck.document/v1` | `emit/json.js` |

**Renamed — user-visible UI**

`appName`, `appTitle`, `commandOpen`, `menuLink`, `menuOpen`, a new
`appShortName`; page titles and headers; the toolbar error tooltip, which was
also *not localized* and now is (`badgeError`); the export zip name.

**Renamed — internal**

Turndown rule names; context-menu ids (`mdforge-page` → `sumcheck-page`, with
the harness that asserts them); temp-directory prefixes; the corpus env var
`MDFORGE_CORPUS` → `SUMCHECK_CORPUS`; `dist/` artifact name; the fixture PDF's
`/Creator` metadata; `.claude/launch.json`.

**Renamed with a migration**

`STORAGE_KEY` `mdforge.options.v1` → `sumcheck.options.v1`. Renaming a storage
key is a data migration, not a find-and-replace: done naively, every existing
install silently reverts to defaults. `loadOptions()` now reads the legacy key
when the new one is absent.

**Left alone — historical record**

`DEVLOG.md`, `CHANGELOG.md`'s pre-1.5.0 entries, and the archived work orders
keep the old name. They describe what happened, and editing them would falsify
it. `STATUS.md` gains a dated rename note at the top rather than a rewrite.

**Left alone — deliberately, and worth flagging**

The `data-mdf-*` attributes (`data-mdf-review`, `data-mdf-page`,
`data-mdf-slide`, `data-mdf-notes`, `data-mdf-chapter`). They do not contain
"mdforge" so they never appeared in the sweep, but `mdf` is an MDForge
abbreviation and **they survive into emitted HTML output**, where `emit/html.js`
styles `[data-mdf-review]`. Renaming them would touch every adapter, the HTML
emitter, the JSON emitter and the Markdown rules, and would change HTML output
on a task authorised for one prefix change. Left as-is; **the owner may want
this as a follow-up**, and it is the last visible trace of the old name in
product output.

### Fixtures

No new fixtures — nothing changed behaviour. Existing ones were updated to
assert the new prefix and schema id, which is the fixture-first rule working in
the other direction: six harness assertions and two scorer regexes had to move
in lockstep with the emitter, and a mismatch would have failed loudly.

`sample.pdf` was regenerated because its `/Creator` metadata carried the old
name.

### Gates

`npm test` **41/41** · `verify-extension` **47/47**, including the packaged zip
installing and resolving its localized name as *Sumcheck — PDF & Document to
Markdown* · `npm run check` green · `npm run package` → **`dist/sumcheck-1.5.0.zip`,
6.2 MB**.

Version 1.5.0 in both manifests. CHANGELOG entry written with the collision
rationale — a Windows app with the same pitch, a dental platform on mdforge.com,
a PyPI package, an arXiv project — so the history explains itself, and with the
`MDFORGE:` → `SUMCHECK:` migration note for anyone grepping converted files.

The repository root folder is unchanged at `~/mdforge`, per the work order.

### Invariant I was tempted to break and didn't

**Rewriting the DEVLOG and CHANGELOG to say "Sumcheck" throughout.** It would
have taken one command and made the history read as though the product were
always called this. The old entries record decisions made under the old name,
including the measurements that justified them; a search for why the marker
prefix changed should land on an entry that says `MDFORGE:`. The rename is a
fact with a date, not a retroactive truth.

---

## 2026-08-16 · v1.4.0 cycle · Task 5 — store submission packet

### The innerHTML sweep (Task 3 rider)

Every HTML sink outside `src/core/` was audited, not just `innerHTML` —
`outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `setHTML`,
`createContextualFragment`. Six assignment sites, dispositioned individually:

| site | disposition |
| --- | --- |
| `app.js` language `<option>` list | **converted.** The only remaining `${…}`-into-markup site. Values are bundled constants today, but a language list is exactly the sort of thing that later gets read from a file. Now `createElement` |
| `app.js` queue row skeleton | **provably static**, comment added. No interpolation at all since Task 3; every value is set with `textContent` |
| `app.js` preview pane (`result.preview`) | **documented invariant.** The one place document HTML is rendered as HTML, which is what a preview pane is. The value is post-`sanitizeHtml()` — DOMPurify applied in `convert.js` before any emitter or validator sees it, with `src/core/sanitize.js` the single chokepoint every adapter passes through. The guarantee is structural, not a property of the call site. Fallback is a literal |
| `app.js` ×5 `innerHTML = ''` | **clears**, no interpolation |
| `service-worker.js` ×2 | **reads**, not assignments — `container.innerHTML` and `documentElement.outerHTML` in the injected extractor |
| result panel "Notes" and "Why this failed" | **converted in Task 4** |

`grep -rnE 'innerHTML *= *`[^`]*\$\{' src/app src/popup src/ui` → **0**.

### Store packet

`store/`, four documents plus three screenshots:

- **`LISTING.md`** — name (36 of 45 chars), summary (121 of 132), full
  description, category, and what each screenshot shows.
- **`PERMISSIONS.md`** — single-purpose statement, a justification for each of
  the five permissions, and the remote-code declaration with its enforcement
  mechanism. Also lists what is *not* requested: `host_permissions`, `tabs`,
  `downloads`, `cookies`, `webRequest`, `management`, `<all_urls>`.
- **`PRIVACY.md`** — nothing collected, so no data category applies. Includes
  the one that invites a second look, `website content`: MDForge reads page and
  file content *in order to convert it, on the device, at the user's request*,
  and "collect" in this policy means gathering data off the device. Drafted
  privacy-policy text included.
- **`CHECKLIST.md`** — 36 items, each done / open / N/A-with-reason.

### Checklist verified against live documentation, not memory

Fetched on 16 August 2026. What that produced beyond what I would have assumed:

- **Screenshots must be 1280×800 or 640×400**, square corners, full bleed, 1–5
  of them. Ours are three at 1280×800.
- **Store icon is 128×128** with 96×96 of artwork and 16px transparent padding.
- **440×280 small promo tile**: optional, but the documentation states listings
  without one rank lower in search. Recorded as an open decision rather than
  quietly skipped.
- **Package limit is 2 GB** — 6.2 MB is not close.
- **Policy updates effective 1 August 2026**, already in force: Limited Use now
  requires collection be *strictly necessary* to the declared single purpose,
  and all collection to be prominently disclosed regardless of purpose. Both
  hold trivially here, and the checklist says why rather than ignoring them.

One thing I could not verify and said so instead of guessing: the exact wording
and grouping of the data-usage category checkboxes is not in the public
documentation. The checklist instructs reading them off the dashboard at
submission time and notes the answer does not depend on it — nothing is
collected, so nothing is checked.

### Screenshots — and the one that matters

`npm run verify-extension -- <a-scanned.pdf> --screenshots store/screenshots`,
driving the real installed extension at 1280×800.

1. `01-drop-zone.png` — the empty state.
2. `02-batch-in-progress.png` — six scans mid-flight: "Converting 3 of 6", the
   working row showing live OCR progress, finished rows above, queued below.
3. `03-review-markers.png` — **the differentiator.** A converted scan showing
   the Notes panel (five warnings, including *Check this value: "inchided" is
   not a recognised word — it may be "included"*), the reconstructed five-column
   table, `#Error` preserved as content, and the inline
   `<!-- MDFORGE: … -->` marker in the Markdown.

The first attempt at #3 was wrong and I looked at it rather than trusting the
file size: I had scrolled the source pane but not the page, so the screenshot
showed the queue with the result panel cut off at "Notes". Fixed by scrolling
the result into view first. **A screenshot is the one artifact where "the code
ran without error" proves nothing.**

### Exclusions — asserted, not asserted-to

`npm run check` now fails if anything on a must-not-ship list would reach the
package. The interesting entry is `vendor/wordlist/src`: the tier JSONs live
*inside* `vendor/`, which is packaged wholesale, and are deleted by the build
step rather than excluded by the packager. If that deletion ever stops
happening they ship silently and roughly double the cost of the lexicon.
Verified by recreating the directory — the check failed with exactly that
message.

Audit of the shipped `mdforge-1.4.0.zip`:

| excluded | entries |
| --- | --- |
| `store/` | 0 |
| `test/` | 0 |
| `scripts/` | 0 |
| `docs/` | 0 |
| `dist/` | 0 |
| `vendor/wordlist/src/` | 0 |
| throwaway test-extension build | 0 |

Top-level: `manifest.json`, `_locales`, `icons`, `src`, `vendor`,
`THIRD_PARTY_NOTICES.md`. From `vendor/wordlist/`, exactly three files ship:
`english.txt`, `common.txt`, `LICENSE-scowl`.

### A harness brittleness fixed on the way

Running the harness with a different corpus PDF failed the end-to-end check:
it asserted `$151.00`, which is one document's total. It now asserts what is
true of any scanned estimate — substantial output, at least one currency
amount, a reconstructed table, front matter — and passes on both `(37)` and
`(47)`. A test that only works on the file it was written against is a test
that will be deleted rather than fixed.

### Release

Version **1.4.0** in `package.json` and `manifest.json`. CHANGELOG written from
this DEVLOG, including the `fast` trade-off stated plainly: it misreads
`included` as `inchided` on every corpus document and `Tax ID:` as `TaxID:` on
eight, and it *fixes* `Cenvical` → `Cervical`, which `best` got wrong. Neither
pack is error-free; no extracted value differs between them.

### Final gates

| gate | result |
| --- | --- |
| `npm test` | **41/41** |
| `npm run verify-extension` | **47/47**, including the packaged 1.4.0 zip installing and resolving its localized name |
| `npm run check` | green |
| `npm run package` | **`dist/mdforge-1.4.0.zip` — 6.2 MB** (6,474,147 bytes) |
| corpus metrics | all five at 100%, marker invariant asserted by the scorer |

### What stands between this and a submission

None of it is code, and none of it is mine to do:

1. **A hosted privacy policy URL** — required by the store. Text is drafted.
2. **A contact email** for that policy.
3. **Distribution decisions**: payment model, countries, visibility.
4. **A registered developer account** and its one-time fee.
5. Optionally, a **440×280 promo tile** — skipping it costs search ranking.

### Invariant I was tempted to break and didn't

**Writing the listing copy the way listings are usually written.** "Fast,
powerful, accurate" costs nothing and is what the category is full of. The
description instead says the conversion is *checked* and that a misreading which
produces a different real word is invisible to every automated check — a
limitation, in the sales copy. It is the same claim the README makes and the
same one `docs/STATUS.md` makes, and a store listing that contradicted them
would make all three untrustworthy.

---

## 2026-08-16 · v1.4.0 cycle · Task 4 — i18n scaffolding

### The ship blocker this turned up

**The packaged zip did not contain `_locales/`.** `package.mjs` shipped a
hard-coded list — `manifest.json`, `icons`, `src`, `vendor`,
`THIRD_PARTY_NOTICES.md` — and adding `default_locale: "en"` to the manifest
does not add anything to it. The result passed `npm test`, passed
`verify-extension` (which loads the working tree), passed `npm run check`, and
produced a **zip Chrome refuses to install**, because `default_locale` without a
`_locales/` directory is a load error.

Nothing in the project looked at the artifact that actually ships. Two fixes,
both aimed at the class rather than the instance:

- `scripts/package-contents.mjs` now owns the include list, imported by both the
  packager and `npm run check`. The check asserts that every path the manifest
  depends on — `_locales` when `default_locale` is set, the service worker's
  directory, the popup's — is in that list and exists on disk. Verified by
  deleting `_locales` from the list: *"the manifest needs `_locales` but
  scripts/package-contents.mjs does not ship it"*.
- `verify-extension.mjs` now **unzips `dist/` and installs that**, on top of the
  working-tree run. It asserts the packaged build installs, registers its
  service worker, and resolves its localized name to
  `MDForge — PDF & Document to Markdown` rather than `__MSG_appName__`.

### What was found

**The `generator:` line would have become localized.** `generatorString()` read
`chrome.runtime.getManifest().name`, and `getManifest()` resolves `__MSG_`
placeholders against the browser's UI language. The moment a second locale
existed, converted documents would have carried a `generator:` line that depended
on the language of whoever ran the conversion. That line is product output — it
records which tool produced the file, and the answer is the same in every
language. It is now pinned to a constant, with only the version read from the
manifest, so today's output is byte-identical and immune to future locales.

**Two strings could not be tagged without breaking them.** The drop-zone hint
and the settings note both mix text with inline elements. Tagging their parent
and setting `textContent` would have deleted a `<button>`, a `<kbd>` and an
`<em>`. Handled differently by shape:

- The drop-zone hint is two short connectors around a button and a keyboard
  shortcut; each connector is its own message. Fragmenting a sentence is poor
  i18n practice and this is recorded as a limitation, not a design.
- The settings note is a real sentence, so it stays **one message with a `$1`
  placeholder** for its emphasised word, rendered by building the `<em>` as a
  DOM node. A translator gets a sentence with translatable word order rather
  than three fragments to reassemble, and no `innerHTML` is involved.

**Several UI strings were being written with `innerHTML`.** The result panel's
"Notes" list and "Why this failed" block were assembled as markup strings. Both
now build nodes. This is the pattern the Task 5 rider is about; these two are
already done.

### Exclusions — product output stays English

Everything under `src/core/` is deliberately not localized, and the boundary is
"does this string ship *inside* a converted document":

| stays English | why |
|---|---|
| `MDFORGE:` review markers | written into the converted file |
| `value not recovered`, `is not a recognised word` | same |
| conversion warnings from adapters | travel with the result and quote document text |
| front-matter keys and the `generator:` line | document metadata |
| `#Error`, table headers recovered from the page | the document's own content |

A converted document's contents must not depend on the locale of whoever
converted it. Two people converting the same scan should get the same file.

### What changed

- `_locales/en/messages.json` — **111 messages**, each with a `description` for
  translators.
- `manifest.json` — `default_locale: "en"`; name, description and the command
  description are `__MSG_` placeholders.
- `src/ui/i18n.js` — `initI18n()`, `t(key, ...subs)`, `localizeDocument(root)`.
  Uses `chrome.i18n` when installed and fetches the catalogue when not, because
  the dev server has no `chrome` object and that is the runtime the whole test
  suite uses.
- `src/background/service-worker.js` — the four context menu titles.
- `src/popup/popup.html` / `popup.js`, `src/app/app.html` / `app.js` — every
  user-facing string, including the settings panel, queue row states, batch
  labels, the password dialog and all six toasts.

### The `npm run check` rule, and its limits

Four new rules: `default_locale` has a catalogue; every `__MSG_` in the manifest
resolves; every `data-i18n` key in the UI pages exists; and untagged text in
those pages fails the build. It also notes unused messages.

**Limits, stated in the code as the work order asks.** It is a regex over
markup, not a parser. It sees text directly between tags on one line and nothing
else — it cannot see strings built in JavaScript, text in attributes that are
not tagged with `data-i18n-attr`, or text split across lines by an inline
element. It is a regression guard for these pages as they are shaped today, not
a proof of coverage. `src/core/` is out of scope by design.

It earned its place immediately: it caught `uiLanguage`, a key I had written
into `app.html` and never added to the catalogue. `chrome.i18n.getMessage`
returns `''` for an unknown key, so that would have shipped as a **blank label**
— worse than an untranslated one, because nothing looks wrong until a user sees
an empty control.

It also found a bug in itself. The unused-message detector read
`data-i18n-emphasis="sentence:word"` and kept only the last segment, reporting
the sentence key as dead. Both halves now count.

### Fixtures added

- **`i18n-fallback` harness case, 6 assertions** (`npm test` 40 → 41): a known
  message resolves, messages are not blank, an unknown key shows **the key
  rather than an empty element**, attributes are localized, `$1` substitution
  works, and a missing substitution leaves the placeholder visible. This is the
  no-`chrome` path — if it breaks, every page in development renders blank while
  the installed extension looks fine.
- **`verify-extension` i18n checks, 5 assertions** (39 → 44, then 47 with the
  zip checks): 66 tagged elements in the app, **none empty**, none falling back
  to showing its key, the localized document title applied, the inline-emphasis
  message rendering real `<em>` markup, and the popup's entries resolving.

### Invariant I was tempted to break and didn't

**Localizing the conversion warnings.** They are user-facing, they appear in the
result panel, and they were sitting right there in the same inventory. They also
travel inside the conversion result into front matter and into the audit
pipeline's output. Translating them would make a converted document's contents
depend on the browser language of the machine that produced it — and would have
changed the corpus output on a task that is not supposed to touch conversion.

### Gates

`npm test` 41/41 · `verify-extension` **47/47** · `npm run check` green ·
`npm run package` → 6.2 MB, `_locales/` present, and the packaged zip verified
to install. Not conversion-touching: the `generator:` line is byte-identical, so
no corpus re-score required.

---

## 2026-08-16 · v1.4.0 cycle · Task 3 — queue rendering at batch scale

### Measured, not asserted

200-file batch, same files, same machine, through the real UI in the extension.
Element nodes added under `#queue` counted with a `MutationObserver`; elapsed is
wall-clock for the whole batch, conversion included.

| | rows built | wall clock |
|---|---|---|
| before | **40,600** | 2,135 ms |
| after | **200** | 1,316 ms |
| | **203× fewer** | **−38%** |

200 rows built for 200 files is the floor — each row is now constructed once and
never again. Repeat runs after the change: 1,271 ms / 1,316 ms, both at 200
nodes.

The 40,600 is not an abstraction: `renderQueue()` emptied `#queue` and rebuilt
every row on each item's completion, so a 200-file batch rebuilt the list ~203
times. The cost is quadratic in batch size, and this pipeline is tuned for
50-file batches.

### What was found beyond the churn

**Something worse than slowness was happening.** Rebuilding the list on every
completion also discarded, roughly twice a second for the length of the batch:
scroll position inside the queue, any text selection in it, and focus if it
happened to be on a row. A long batch was not just slow, it actively fought
anyone trying to read it while it ran.

**Half of the problem had already been noticed.** `runItem()` carried the
comment *"Move the 'working' marker without rebuilding 50 rows"* and hand-patched
that one path — while the completion path three lines away rebuilt everything.
The optimisation existed; it was just applied to the cheaper of the two callers.

**An HTML injection on the way past.** The old row template interpolated the
file's extension straight into `innerHTML`:

```js
<span class="icon">${(extOf(item.name) || 'txt').slice(0, 4).toUpperCase()}</span>
```

The extension comes from the file name, so a file called `report.<img src=x
onerror=…>` put markup into the queue. The app's CSP (`script-src 'self'`)
blocks the obvious payloads, and the string is capped at four characters, which
is why this is a defect rather than an incident. It is now set with
`textContent`, which removes the class of problem rather than the instance.
Unrelated to the task and fixed in passing because the line was being rewritten
anyway.

### What changed

- **One delegated click listener** on `#queue`, installed once at start-up.
  Previously every row carried its own closure, re-created on every render —
  40,600 listeners over the measured batch.
- **`renderQueue()` reconciles** instead of rebuilding: rows are matched by id,
  created only when new, moved only when out of order, and removed when their
  item is gone. Reconciling in `state.items` order matters because a zip splices
  its members into the middle of the list.
- **`createQueueRow()`** holds the fixed parts; **`updateQueueRow()` is now the
  only path** for everything that changes — name, sub-line, status, progress,
  `working` highlight, `aria-selected`.

### No visual behaviour change — checked, not assumed

Added to `verify-extension.mjs` (30 → 39 checks), all against the real extension:

- a 12-file batch completes
- **each queue row is built exactly once** — 12 nodes for 12 rows, where
  rebuilding would be ~144. This is the regression guard: it fails loudly if
  anyone reintroduces a full rebuild.
- the batch label reports `12 of 12 converted`
- clicking a row selects it **through the delegated listener**
- only one row is selected at a time
- selecting a row shows that file in the result pane
- a zip expands into queue rows
- **the zip row stays ahead of its members**
- **expanded members render in archive order** — observed
  `["bundle.zip", "alpha.md", "gamma.csv", "beta.md"]`

The last three exist because mid-list insertion is the one part of the
reconciler that can silently produce a jumbled list, and nothing else covered
it. `test/fixtures/bundle.zip` is now built by `make-fixtures.mjs` for that
purpose — the harness's own zip is generated in memory and cannot be dropped
into the UI.

The harness's end-to-end case passes untouched: `npm test` 40/40.

### One assertion I had to loosen, and why it was mine that was wrong

`selecting a row shows that file` compared the result heading to the row's name
and failed on `queue-05` vs `queue-05.txt`. The heading shows the document's
*title*, which for a plain text file is its name without the extension. Both
values were correct; the test was wrong, and it now matches on the stem. Worth
recording because the tempting fix — changing the heading to match the test —
would have been a real regression introduced to make a test pass.

### Invariant I was tempted to break and didn't

**Keeping `renderQueue()` as a rebuild and just calling it less often.** Debounce
it, skip it while running, rebuild only at the end: all smaller diffs, and all of
them leave a quadratic function in the code for the next person to call from a
new place. The reconciler makes the cost proportional to what actually changed,
which is the property that survives someone adding a caller.

### Gates

`npm test` 40/40 · `verify-extension` **39/39**, stable across repeat runs ·
`npm run check` green. Not conversion-touching: no corpus re-score required.

---

## 2026-08-16 · v1.4.0 cycle · Task 2 — password modal, replacing `window.prompt()`

### What was found

**`window.prompt()` does not merely look dated — it stops the batch.** It blocks
the page's entire event loop: no progress bars, no repaints, no other file
converting, until somebody returns to the tab and answers it. On the 50-file
batches this pipeline is tuned for, one locked PDF froze the other 49. It is
also suppressed outright in some contexts, where the same code becomes a
conversion that simply never finishes and never says why.

**Declining had no voice.** The old path called `task.destroy()` and let
`task.promise` reject with whatever pdf.js's teardown happened to throw. The
queue showed a worker error — a bug report, not a decision. Skipping is a
decision the person made, and the row now says so:
`Skipped — this PDF is password protected and no password was entered.`

**There was no encrypted PDF to test against, and no way to make one.** `qpdf`,
`mutool` and `pdftk` are all absent from a stock Mac, and no Python PDF library
is installed. A fixture that cannot be regenerated is a fixture that rots, so
`make-fixtures.mjs` now builds one: standard security handler V1/R2, RC4 40-bit,
~1 KB. Weak by design and exactly right — the point is to make pdf.js ask for a
password, not to protect anything.

### What changed

- `src/app/app.html` — a real dialog (`role="dialog"`, `aria-modal`, labelled
  and described), a password field, **Unlock** and **Skip this file**.
- `src/app/app.css` — modal styling that follows the existing token set, light
  and dark.
- `src/app/app.js` — `askForPassword(fileName, retry)` returns
  `Promise<string|null>`. Focus moves to the field on open and back to whatever
  had it on close; Tab cycles the three controls (a hand-rolled trap, because
  walking out of the dialog makes it a dead end for a keyboard user); Enter
  submits; Escape and a backdrop click both skip; an empty field re-focuses
  rather than silently skipping the file. The value is cleared from the DOM on
  close.
- `src/core/adapters/pdf.js` — tracks that the user declined, so the failure
  carries a reason instead of a teardown error. A rejected `requestPassword`
  is treated as a decline rather than crashing the conversion.
- `scripts/make-fixtures.mjs` — `buildEncryptedPdf()` and `test/fixtures/locked.pdf`.

### Fixtures added

**`locked.pdf` harness case — 9 assertions** (`npm test`, 39 → 40 cases):
the converter asks exactly once; the first ask is not flagged as a retry; the
correct password decrypts and the text comes through; **a wrong password
re-prompts with `retry = true` and the second attempt succeeds**; skipping fails
the file rather than hanging; the reason says "skipped"; the reason is *not* a
worker error; and **the next file in the batch still converts**.

**Password modal in `verify-extension.mjs` — 8 assertions** (20 → 30 checks),
because focus, Escape and event-loop behaviour only exist in a real browser:
the dialog starts hidden, is a labelled modal dialog, uses a password input,
takes focus on open, has Enter-submits/Skip-doesn't wiring, **the page keeps
running while it is open** (a timer fires — the thing `prompt()` prevented), and
**no blocking `prompt`/`alert`/`confirm` call remains in the app**.

Then the whole journey, driven by the real file: drop `locked.pdf` into the app,
**the dialog appears**, type `secret`, submit, **the document converts and the
dialog closes**.

### Two harness bugs found, both mine, both the same bug

The blocking-API check failed on its first run: 1 call site. It was matching the
doc comment explaining *why* `window.prompt()` is not used. A check that fails on
its own explanation tests prose, not code; it now strips comments first.

Then the corpus end-to-end case started reporting `251 chars · total MISSING`.
Nothing was wrong with the conversion — three probes each opened
`app.html`, and `openTab` takes the last matching tab, so the corpus check
attached to the *locked PDF's* tab and read its result pane. Each probe now
opens a distinguishable URL (`?probe=modal|locked|corpus`).

Both are the same mistake as the `readyState` races in the v1.3.0 cycle:
assuming the thing you are looking at is the thing you meant to look at.

### Folded-in follow-ups

**Scorer marker rows split (requested).** `score-export` printed
`documents carrying a marker 50/50` after Task 1b, which reads exactly like 44
documents silently losing a value. It now prints three rows:

```
headline figure recovered 44/50
documents carrying any marker   50/50
  value-not-recovered markers   6/50   OK — must equal the 6 document(s) missing a headline
  prose lexicon flags           50/50
```

The invariant is a **scorer assertion** again, not a footnote: the scorer now
computes how many documents are actually missing a headline figure and compares.
On mismatch it prints `✗ marker invariant broken: …` and **exits 1**. Verified in
both directions — stripping one marker from a corpus copy produced the failure
and exit code 1; the real corpus exits 0. Headline recovery also moved out of my
scratch script and into the scorer, where a reviewer can see it.

The headline label is corpus-template-specific and marked as such in the code,
in the same way the `#Error` string already was.

**Dropping the frequency dependency (optional, declined).** SCOWL's own tiers
cannot rank the suggestion. Measured: `included` and `inclined` are **both tier
10**, and tier 10 has no ordering within it — sorted alphabetically, `inclined`
comes first, so a SCOWL-only list suggests exactly the wrong word. The condition
was "only if the suggestion quality holds — `inclined` must still lose", and it
does not. `most-common-words-by-language` stays, and so does the caveat that it
declares MIT without shipping a license file.

### Invariant I was tempted to break and didn't

**Letting Escape and the backdrop mean "cancel the batch".** Both skip one file,
because that is what the surrounding text says they do and the queue is the
user's, not the dialog's. An empty field submitting as a skip would have been
one fewer branch, and would have turned a mistyped Enter into a silently
unconverted document.

### Gates

`npm test` 40/40 · `verify-extension` **30/30**, stable across repeat runs ·
`npm run check` green. Not conversion-touching: no corpus re-score required, and
the scorer change was verified against the existing v1.4.0 emit.

---

## 2026-08-16 · v1.4.0 cycle · Task 1b — prose lexicon validator (owner condition on `fast`)

### Acceptance

**Met exactly.** On the 50-document corpus:

| | flags raised |
|---|---|
| `fast` (shipping) | `inchided` → `included`, **50/50 documents**, one per document |
| `best` (control, same 50 documents) | **none** |

Zero correct words flagged in either arm. The control matters more than the
detection: 50 documents of clinical prose — `appendicular`, `parotid`,
`radiopharmaceutical`, `Cervical`, procedure descriptors, street addresses —
and the validator says nothing about any of it.

Both arms measured with the shipped predicates (`isCandidate`, `suggestionFor`
imported from `src/core/lexicon.js`), not a prototype.

### Corpus re-score

| metric | v1.3.0 baseline | after 1b | |
|---|---|---|---|
| grand totals matched | 50/50 | 50/50 | = |
| all line-item codes found | 49/49 | 49/49 | = |
| amount on its code's row | 52/52 | 52/52 | = |
| `#Error` preserved | 50/50 | 50/50 | = |
| documents with a table | 49/50 | 49/50 | = |
| silent cases | 0 | 0 | = |
| headline recovered | 44/50 | 44/50 | = |
| **value-not-recovered markers** | **6 (== 6 misses)** | **6 (== 6 misses)** | **=** |
| flags at threshold 70 | 189 (`best`) → 183 (`fast`) | 183 | = |
| `npm test` | 38/38 | **39/39** | +1 |
| `verify-extension` | 20/20 | 20/20 | = |

One number moved and it needs saying plainly: **score-export's "documents
carrying a marker" reads 50/50, up from 6/50.** That row counts *any* `MDFORGE:`
comment, and 50 documents now carry a lexicon marker. The invariant it is
usually read as — value-not-recovered markers equal actual misses — is measured
separately and is **unchanged at 6/6**. The scorer's row is not wrong; it is
answering a question that now has a different answer.

### What was found

**The suggestion is a separate problem from the detection, and harder.**
`inchided` is exactly two edits from `included` *and* from `inclined`. A
dictionary cannot choose between them — both are ordinary English. The first
build suggested `inclined`, which is worse than useless: a confidently wrong
correction attached to a real error. Only word frequency separates them, so the
package carries two lists that answer two different questions:

- `english.txt` — 110,491 words, sorted. *Is this a word?* Includes
  `appendicular` and `parotid`, which any top-10k list has never heard of.
- `common.txt` — 8,906 words, **in frequency order, and the order is
  load-bearing**. *What did they mean?* `included` is rank 871; `inclined` is
  not in the list at all, so it can never be suggested.

**Four exclusions, each added because it fired on correct text.** The work order
said tighten the trigger rather than grow a whitelist, and that is what these
are — none names a word:

| rule | what it stopped | why it is principled |
|---|---|---|
| all-caps | `ABSORPTIOMETRY`, `TOMOSYNTHESIS` | procedure descriptors, never prose |
| internal capital | `TaxID` | identifiers and run-togethers; prose words do not do this |
| no vowel | `Blvd` → "band" | an abbreviation is not a misspelling |
| mid-sentence capital | `Richmond` → "richmond", `Trenton` → "preston" | proper nouns, which no dictionary can adjudicate |

Sentence-initial capitals are still checked, so the proper-noun rule costs less
than a blanket "skip capitals" would. Tokens with digits, table cells and coded
descriptor lines are excluded too — the value validators already own those.

**A cost worth stating: `TaxID` is no longer surfaced.** It is a genuine `fast`
regression (`Tax ID:` read as `TaxID:` on 8 documents, at exactly the 70
confidence threshold, so unflagged). The internal-capital rule silences it.
Kept anyway, because the alternative was shipping `"TaxID" may be "taxi"` on
eight documents, and a marker layer that suggests nonsense is a marker layer
people stop reading. The spacing error is documented in the Task 1 note.

### Size

| file | raw | in package |
|---|---|---|
| `vendor/wordlist/english.txt` | 1061 KB | |
| `vendor/wordlist/common.txt` | 70 KB | |
| `vendor/wordlist/LICENSE-scowl` | 11 KB | |
| **total** | | **335 KB — budget 400 KB** |

Package: **5.8 MB → 6.2 MB**. Against the 16.2 MB this cycle started at, the
size win survives with 65 KB of headroom against the stated budget.

The tier JSONs the lists are built from are deleted at build time rather than
vendored — shipping both the source and the artifact would have doubled the cost
of the feature for nothing.

### Licensing

Both sources permit commercial use, which this project requires:

- `wordlist-english@1.2.1` — MIT; word lists are SCOWL, Copyright 2000-2016
  Kevin Atkinson, whose terms explicitly grant permission to "use, copy, modify,
  distribute and sell these word lists". `LICENSE-scowl` is vendored.
- `most-common-words-by-language@3.0.14` — MIT **declared in `package.json`;
  the package ships no LICENSE file**, so there is no license text to vendor.
  Recorded in `VERSIONS.json` in exactly those words rather than as a bare
  "MIT", so the notices do not imply a file that does not exist.

### Cost when the check does not apply

The lists load lazily and only for OCR'd documents — `validateDocument` now
takes `ocr` and skips the whole path otherwise. A converted Word document never
fetches a megabyte of word lists. `validateDocument` became async; there is one
caller.

### Fixtures added

- `prose-lexicon` (11 assertions) — the real strings from the corpus. Asserts
  `inchided` is flagged **with `included` as the suggestion**, that exactly one
  prose flag is raised, that `Cervical`, `parotid`, `appendicular`, an all-caps
  descriptor, `Richmond`, `Trenton` and a coded table row are all silent, that a
  marker is attached at the flagged paragraph naming the token, that the text is
  **not rewritten**, and that the check does not run when the document was not
  OCR'd.

### Invariants I was tempted to break and didn't

**Growing a whitelist.** `Blvd`, `Richmond` and `Trenton` would each have been
one line in an exceptions list, and the work order pre-emptively forbade it.
Every one became a rule about the *shape* of the token instead, which is why the
`best` control is silent on 50 documents rather than silent on the four cases I
happened to see.

**Shipping a suggestion I knew was wrong.** `inclined` passed the acceptance bar
as literally written — `inchided` was flagged, 50/50, no correct words flagged.
The bar did not mention suggestion quality. Attaching a wrong correction to a
real error is worse than not flagging it, so this cost a second dependency.

### The boundary, recorded

README's "When to trust the output" gains **"What no automated check can
catch"**: a misreading that produces a different *real* word is invisible to
every validator here and always will be — "from" as "form", "1" as "7". Nothing
looks unusual because nothing is unusual. The flag layer narrows the risk; it
does not eliminate it, and **convert for reading, verify against the original**
remains the last line of defense.

### Gates

`npm test` 39/39 · `verify-extension` 20/20 · `npm run check` green ·
`npm run package` → 6.2 MB. Version remains 1.3.0; the bump is Task 5.

---

## 2026-08-16 · v1.4.0 cycle · Task 1 — tessdata_fast, verified

### Verdict

**Every specified number holds or improves, so by the work order's rule `fast`
ships.** The install goes **16.2 MB → 5.8 MB** (−64%) and the test suite runs
5.9s → 3.5s (−41%).

But the specified metric set measures money, codes, tables, markers and flags —
it does not measure prose, and prose changed. That is reported in full below
rather than left to the numbers, because the rule's stated purpose is "do not
ship a regression to hit a size target" and there is a regression the rule does
not look at. The decision is the owner's; the evidence is here either way.

### Before / after — the specified suite

Both arms are full 50-document corpus runs on the same code, same corpus, same
scorer. The only thing that differs between them is `eng.traineddata.gz`: of 228
vendored files, exactly two changed (the pack and `VERSIONS.json`), verified by
SHA-256 across the whole tree.

| metric | v1.3.0 (`best`) | `fast` | |
|---|---|---|---|
| grand totals matched | 50/50 | 50/50 | = |
| all line-item codes found | 49/49 | 49/49 | = |
| amount on its code's row | 52/52 | 52/52 | = |
| `#Error` preserved | 50/50 | 50/50 | = |
| documents with a table | 49/50 | 49/50 | = |
| `table_fallback` notes | 1 | 1 | = |
| silent cases (no table, no note) | 0 | 0 | = |
| headline total recovered | 44/50 | 44/50 | = |
| documents carrying a marker | 6 | 6 | = |
| markers == misses | yes (6/6) | yes (6/6) | = |
| flags at threshold 70 | 189 | 183 | −6 |
| mean OCR confidence | 94.3 | 94.6 | +0.3 |
| missing conversions | 0 | 0 | = |
| **packaged zip** | **16.2 MB** | **5.8 MB** | **−10.4 MB** |
| `npm test` | 38/38 (5.9s) | 38/38 (3.5s) | = |
| `verify-extension` | 20/20 | 20/20 | = |

The marker set, the no-table set and the headline-miss set are the *same six
files* in both arms — (37) (38) (39) (40) (41) (46). Nothing moved between
categories.

### What the metrics do not measure

All 50 emitted documents differ textually between the two packs. Enumerated,
they collapse to six distinct patterns — the corpus is one template repeated, so
these are systematic differences, not 112 independent errors. Blast radius is
still 100% where noted.

**Regressions under `fast`:**

| change | files | confidence | flagged? |
|---|---|---|---|
| `included` → `inchided` | 50/50 | 55–66 | **yes** |
| `care;` → `care:` | 50/50 | 74–75 | no |
| `Tax ID:` → `TaxID:` | 8/50 | 70 | no (exactly at threshold) |
| `EXTREMITY` → `EXTREMITY:` | 3/50 | — | — |
| `TOMOGRAPHY` → `TOMOGRAPHY,` | 1/50 | — | — |

**Improvements under `fast`:**

| change | files |
|---|---|
| `Cenvical` → **`Cervical`** | 1/50 |
| `12:41PM` → `12:41 PM` | 1/50 |

Three things worth stating plainly:

1. **The one genuine word corruption is caught.** `inchided` scores 55–66,
   under the shipped threshold of 70, so it ships flagged. The product's core
   promise — that it tells you what it was unsure about — holds on the very
   error this switch introduces.
2. **`best` is not clean either.** `fast` *fixes* `Cenvical` → `Cervical`, which
   the v1.3.0 Task 1 note logged as "a manifest misread of Cervical" and left
   standing. That is a clinical term; `inchided` is boilerplate. Neither pack is
   error-free, and they are not wrong about the same things.
3. **The unflagged drift is punctuation and spacing**, not values: a semicolon
   read as a colon, a lost space in a label. No amount, code, date or identifier
   changed in any of the 50 documents — that is what the 52/52 and 50/50 rows
   above are asserting.

**Recommendation: ship `fast`.** The rule's condition is met, no extracted value
moved, the one real word corruption is flagged, and 10.4 MB is the difference
between a consumer install and a hostile one.

**What would flip it:** if a 100%-blast-radius prose corruption is unacceptable
in a product sold on conversion fidelity, revert. That is a legitimate call and
the numbers do not make it for you. Reverting is one command —
`rm vendor/tessdata/eng.traineddata.gz && node scripts/fetch-vendor.mjs --quality best`
— and costs 10.4 MB, 2.4s of suite time, and `Cervical`.

### The trap that would have made this measurement a lie

`scripts/fetch-vendor.mjs` cached language data **by filename alone**. Running
`--quality fast` over an existing `best` pack logged `(cached)`, kept the 12 MB
`best` file, and rewrote `VERSIONS.json` to say `tessdata_fast`. The build would
have shipped one pack while its manifest and third-party notices named another —
an accuracy problem and a licensing problem at once, with nothing raising a hand.

I hit this on the first attempt and only caught it because the reported download
size (`1.97 MB`) is one of the few places the two packs are distinguishable at a
glance. Had I not deleted the file by hand, every number in the table above would
have been `best` measured twice and reported as a comparison.

Fixed two ways:

- The cache is now keyed by quality. `vendor/tessdata/.quality` records which
  pack is on disk; a different `--quality` deletes the language data and
  refetches. Verified by stamping `.quality=best` over `fast` data and running
  `--quality fast`: it logged `quality changed (best -> fast) — refetching` and
  re-downloaded.
- `npm run check` now fails if the pack on disk disagrees with `VERSIONS.json`,
  and prints `OCR pack: tessdata_fast` when they agree. Verified by editing the
  manifest to claim `tessdata_best` against `fast` data — the check failed with
  the fix instructions. Restored, green again.

### Other vendor weight

Requested during real conversions, logged at the HTTP layer so every context
counts (the main page's resource timeline misses anything the pdf.js worker
fetches, which is exactly the assets in question):

| asset | size | requested? |
|---|---|---|
| `pdfjs/pdf.min.mjs` + `pdf.worker.min.mjs` | 1.65 MB | yes, every PDF |
| `tesseract/*` core + worker | 3.1 MB | yes, every scan |
| `tessdata/eng.traineddata.gz` | 1.9 MB | yes, every scan |
| `pdfjs/cmaps` | 1.6 MB | **never** |
| `pdfjs/standard_fonts` | 800 KB | **never** |
| `pdfjs/wasm` | 1.5 MB | **never** |

That is 3.9 MB — 24% of the *old* package, and now a much larger share of a
5.8 MB one — untouched across 53 conversions: all 50 corpus scans, a text-layer
`sample.pdf`, and a hand-built PDF referencing Helvetica without embedding it
(which pdf.js rendered from a fallback rather than fetching the pack).

**This is not proof they are dead.** All three are demand-loaded: cmaps for CJK
and other non-Latin encodings, standard_fonts for the 14 base fonts when a
producer omits them, wasm for JPEG2000/JBIG2 image streams. I could not build a
document that triggers any of them, which bounds what I can claim: nothing in
reach needs them, and I did not establish that nothing does. Removing them would
trade 3.9 MB for "works on PDFs like ours" instead of "works on PDFs" —
a product decision, not a cleanup. `--no-cmaps` already exists for whoever makes
it. **Recommend leaving them in**; flagging the number because at 5.8 MB total it
is now the largest remaining lever.

### Fixtures added

- `npm run check` pack-vs-manifest rule — the durable guard, verified in both
  directions (deliberate mismatch fails with instructions; agreement passes).
- `vendor/tessdata/.quality` + quality-keyed refetch in `fetch-vendor.mjs`,
  verified by forcing a stale stamp.

No harness case for the pack swap itself: it changes data, not code, and its
test is the 50-document re-score above. The check rule is what stops the *wrong*
pack shipping, which is the failure mode that actually threatened this task.

### Invariants I was tempted to break and didn't

**Reporting "all specified numbers hold" and stopping.** That sentence is true,
it is what the work order asked for, and it would have shipped a change that
corrupts a word in 100% of the corpus without the owner ever seeing it. A metric
set is a lens, not the territory; when a change is invisible to every metric you
have, that is a fact about the metrics.

**Letting the size target pick the framing.** 16.2 → 5.8 MB is the headline this
task wants, and I had it before I ran the text diff. The diff is the part of this
note that could have gone unwritten.

### Gates

`npm test` 38/38 · `verify-extension` 20/20 · `npm run check` green ·
`npm run package` → 5.8 MB. Version remains 1.3.0; the bump to 1.4.0 is Task 5.

---

## 2026-08-15 · v1.3.0 cycle · Task 5 — the extension loaded in Chrome

### What was found

**Chrome will no longer load an unpacked extension from the command line while
remote debugging is on.** `--load-extension` is silently ignored on Chrome 151 —
no error, the extension simply is not there. `--disable-features=DisableLoadExtensionCommandLineSwitch`
and `--enable-unsafe-extension-debugging` do not restore it. The supported route
is the CDP `Extensions.loadUnpacked` command, which is what the "Load unpacked"
button calls. That is what the harness uses.

**Everything in the MV3 wiring works.** This is the first time any of it has run:
`npm test` serves the extension's real CSP through a dev server, which covers the
conversion engine and the UI but cannot cover a service worker, a context menu,
`chrome.storage.session`, or a permission gate, because none of those exist
outside an installed extension.

### Pass/fail per path

| path | result | evidence |
|---|---|---|
| extension loads unpacked | PASS | installs, id assigned |
| service worker registers | PASS | `service_worker` target for `src/background/service-worker.js` |
| context menu `mdforge-page` | PASS | `contextMenus.update` resolves |
| context menu `mdforge-selection` | PASS | `contextMenus.update` resolves |
| context menu `mdforge-link` | PASS | `contextMenus.update` resolves |
| context menu `mdforge-open` | PASS | `contextMenus.update` resolves |
| `chrome.storage.session` read/write/remove | PASS | round trip, then cleared |
| page capture denied without activeTab | PASS | Chrome refuses; no ambient host permission |
| app consumes `?job=` from `storage.session` | PASS | handed-off HTML renders in the queue |
| app clears the job after reading it | PASS | key gone from session storage |
| optional host permission declared, not pre-granted | PASS | `contains=false`, `["http://*/*","https://*/*"]` |
| "Convert linked file" gates on a user gesture | PASS | `permissions.request` refuses without one |
| "Convert linked file" rejects non-http schemes | PASS | `ftp://` rejected |
| popup renders all four entries | PASS | `open`/`page`/`selection`/`settings` present |
| popup "Convert files…" | PASS | opens `app.html` |
| popup "Settings" | PASS | opens `app.html?settings=1` |
| popup "Convert this page" | PASS | reaches the worker, gets a reply |
| popup "Convert selection" | PASS | reaches the worker, gets a reply |
| tab capture writes a job | PASS | test build; 160 chars captured and stored |
| **real corpus PDF end to end through the UI** | **PASS** | 2,210 chars, total and table present |

**20/20**, stable across repeated runs.

The end-to-end conversion is the one that matters most: GFE (47) dropped into the
app produced output **byte-identical to the audit pipeline's** for the same file,
except the `generator` line — the extension reads its name and version from the
manifest, the audit harness has none. Same table, same five columns, same
`$151.00`. The corpus numbers and what a user actually gets are the same thing.

### The one path that cannot be driven headlessly, and what was done about it

`chrome.scripting.executeScript` needs `activeTab`, which Chrome grants only on a
real toolbar click or context-menu selection. CDP cannot synthesise either — a
native menu is not in the page. Two things were done rather than leaving a hole:

1. The assertion was **inverted into a security check**. The shipped manifest
   requests no host permissions, so capture *must* be denied without a gesture.
   If it ever succeeds, the extension has gained a host permission it should not
   have. That is worth catching, and a plain FAIL row would not have caught it.
2. The product logic behind the gate is proven against a **throwaway copy of the
   extension** carrying `host_permissions: ["http://localhost/*"]`, built into a
   temp directory by the harness itself. It captured 160 chars of a real page and
   stored the job. This proves `extractDocument`, the `storage.session` write and
   the app render; it does not prove the `activeTab` grant, which is Chrome's to
   enforce and is stated as such.

### What changed in the repo

- `scripts/verify-extension.mjs` — the harness, committed rather than discarded.
  STATUS §4 has said "the extension has never been loaded in Chrome by me" since
  v1.0.0; a one-off run would have made that sentence false without making it
  stay false. `node scripts/verify-extension.mjs <a.pdf>` reruns all 20 checks
  and exits non-zero on any failure.

### Harness bugs found and fixed — all the same bug

Three checks failed on first run and **none of them were product defects**:

- A service worker cannot `chrome.runtime.sendMessage` to itself; the reply is
  "Receiving end does not exist". The message has to come from the popup, which
  is where it comes from in the product.
- The popup calls `window.close()` after each action, so its CDP target dies and
  every later evaluate against it times out. Each entry now gets a fresh popup.
- **Twice** — once on the app's file input, once on the popup's buttons — the
  harness acted on a page whose scripts had not run yet. A `change` event
  dispatched before `app.js` binds its listener is simply lost, and the file sat
  in the input for three minutes looking exactly like a conversion that hangs. A
  click on a button whose handler is not bound does nothing and looks exactly
  like a broken button. `openTab` now waits for `readyState === 'complete'`, and
  the file input waits for `init()` to finish.

That is the cycle's lesson in a third form: the first two were a green suite that
skipped its cases and an A/B whose variable never moved. All three are the same
mistake — trusting that a step ran because nothing said it didn't.

### Invariant I was tempted to break and didn't

Adding `host_permissions` to the shipped manifest would have turned the one
failing row green in a line. It would also have handed every install permanent
read access to every page, to make a test pass. The permission stays optional and
the test build stays a temp directory that is never packaged.

---

## 2026-08-15 · v1.3.0 cycle · Task 4 — table detection rebuilt around column clustering

### What was found

**The PSM 3 vs PSM 6 A/B cannot be run through the shipped engine, and the answer would have been "stay on 3" regardless.**

I threaded `ocrPageSegMode` through `options -> pdf.js -> ocr.js` and ran the full
corpus under PSM 6. Every metric came back identical to PSM 3 — including mean
confidence to one decimal. That is not a result, so I checked: all 50 emitted
files differed only in their `converted:` timestamp. Direct measurement on one
corpus page, same pixels, fresh worker per arm:

| worker configuration                                       | chars | text hash    |
|------------------------------------------------------------|-------|--------------|
| bare                                                        | 1630  | -2031342713  |
| `tessedit_pageseg_mode: 6` only                             | 1630  | -2031342713  |
| dpi + interword_spaces (what we ship)                       | 1970  | 1969530981   |
| dpi + interword_spaces + `tessedit_pageseg_mode: 6`         | 1970  | 1969530981   |

PSM is accepted and discarded by tesseract.js 6.0.1. Setting it as
`createWorker`'s init config is inert too — same hash. `applyParameters` even
reported `applied: true`. Only the dpi/interword pair moves the output.

So I answered the question on the CLI (tesseract 5.5.3) over the same 50 page
rasters:

| mode  | "Tax ID:" read intact | "Tax ID" absent entirely | code-leading lines |
|-------|-----------------------|--------------------------|--------------------|
| PSM 3 | 48/50                 | 2/50                     | 93                 |
| PSM 6 | 0/50                  | 50/50                    | 93                 |

PSM 6 glues the token into `TaxID:` on all 50 and reads no more line-item codes.
It makes the disputed token worse, not better. **Verdict: stay on PSM 3**, on two
independent grounds. I removed the plumbing rather than ship a knob that
provably does nothing, and recorded the measurement in a comment at
`src/core/ocr.js:73` so it is not re-added.

This also corrects an earlier attribution of mine: the 24→60 confidence swing I
had ascribed to PSM cannot have come from PSM through `setParameters`.

**GFE (49)'s table was corrupted by the rescue pass, not by clustering.**
The crop that re-reads unread ink recognizes *every* pixel inside it, including
ink the first pass had already read correctly. It returned `$1,932.00` a second
time as `$1.9` + `32.00` at identical coordinates, and both were appended to the
row. The `seen` set could not catch it because a misread does not equal what it
duplicates. Corpus-wide: 1/50 files affected, 8 duplicate words, all in (49) —
and all 8 of that file's rescue words were duplicates, so the rescue pass
contributed nothing there but corruption.

**47 of 50 documents produced no table despite clean geometry.** Two causes,
both in code that predates this cycle:

1. `isWrappedCell` bounded a wrapped continuation by the *previous fragment's*
   right edge. Wrapped description text is ragged — on (47) the four wrapped
   lines' right edges vary by 75 units — so a continuation one word longer than
   the line above ended the table. The `runLeft` parameter that should have
   answered this was passed in and never used.
2. `buildTable` dropped any column occupying under 60% of the rows. A form's
   service-date column is sparse by design (printed once, blank on the line
   items below). Dropping it made that row's two cells both fall into the
   description column, collapsing it to one filled cell, which failed the "a row
   needs two columns" test and rejected the entire table.

Cause 2 is also why (43) and (44) emitted their *first line item as the header
row*: the run containing the real header failed, the scan resumed below it, and
`rows.length > 2` promoted whatever came first.

### What changed

- `dropAlreadyRead(lines, readWords)` — discards recovered words sitting on more
  than half their own area over an already-read word. Geometric, because text
  comparison cannot see a misread duplicate.
- `findUnrecognizedInk` — a gap region shorter than the page's own median word
  height is not flagged. Derived from measurement, not tuned: (49)'s four false
  slivers are the only regions in the corpus below one line height (0.73x); all
  six real misses sit at 2.91x.
- `isWrappedCell(line, previous, row)` — a fragment now belongs to the row above
  when it starts under one of that row's cells and stops before the next one.
  Ragged right edges become normal; crossing a column boundary does not. Prose
  after the table is still excluded, because it starts at the page margin, left
  of every cell.
- `buildTable` — a column is a position where at least two cells align.
- `detectTables` returns `unresolved`, surfaced as `table_fallback: N` in front
  matter, so a lost table is never silent.

### Before / after

| metric                          | before (v1.3.0 start) | after  |
|---------------------------------|-----------------------|--------|
| grand totals matched            | 50/50                 | 50/50  |
| all line-item codes found       | 49/49                 | 49/49  |
| amount on its code's row        | 52/52                 | 52/52  |
| `#Error` preserved              | 50/50                 | 50/50  |
| documents with a table          | 3/50                  | 49/50  |
| documents carrying a marker     | 6/50                  | 6/50   |
| silent cases (no table, no note)| 47/50                 | 0/50   |

Markers still equal misses exactly, at 6. `npm test` 38/38.

Named targets: (47) tables, with both procedure descriptions intact across their
four wrapped lines. (43), (44) and (49) survive row-for-row — every row they had
is still present, plus the header and service-date rows they were previously
missing. (49) is additionally clean of the `$1.9`/`32.00` corruption.

### Fixtures added

- `ocr-rescue-dedup` — the re-read money column, pinned at GFE (49)'s measured
  coordinates, plus a genuinely new word that must survive and an empty-read-set
  case that must drop nothing.

The old table regression fixtures (`billing-form.pdf`, `suspect-invoice.html`,
`shaded-callout.pdf`, `corpus-callout.pdf`) all pass against the new detector.

### Invariants I was tempted to break and didn't

**Clearing (49)'s false marker by trusting the rescue's own output.** My first
fix treated "the crop returned only already-read words" as proof the region was
not a gap. It cleared (49) — and also cleared GFE (46), whose crop returns only
the already-read label because it fails to read the `$0.00` beside it. That took
markers to 5 and left (46) as an unmarked miss: the value absent, the flag gone.
The signal proves the crop found nothing new, not that there *is* nothing new. I
reverted it and moved the decision to ink coverage, where it belongs.

**Forcing a table onto GFE (46).** It is a zero-charge research scan with no line
item — one total row, so its money columns appear exactly once and nothing can
align to them. Making its header labels cluster with its data would have meant
either an 8-column grid with labels and figures in different columns, or a
2-column table merging `Total Estimated Costs 0 $0.00 $0.00` into one cell. It
gets `table_fallback: 1` instead. 49/50 with one characterized exception, not
50/50 with a fabricated grid.

### Harness defect found and fixed

While adding the fixture I mistyped a helper name. The suite printed
**`✓ 30/30 cases passed`** — green, having silently skipped eight cases including
every OCR document, because the cases were awaited in a straight line and one
throw aborted the rest. Each hand-written case now runs isolated, and a case that
fails to register is recorded as a failure. Verified by deliberately throwing in
one case: 37/38 with the remaining cases still running. This is the "never trust
a green npm test alone" ground rule made literal — the run I would have trusted
was the run that skipped the tests that mattered.

### Lesson for the record

The PSM A/B produced identical numbers across 50 files and I nearly reported that
as a finding. A measurement that shows *no* difference needs the same suspicion
as one that shows a large one: the first thing to check is whether the
independent variable moved at all. It had not.

---

## 2026-08-15 · v1.3.0 cycle · Task 3 follow-ups

### Recovered-value validation — clean

The crop rescue injects prominent standalone figures read at ~77 confidence,
with nothing checking them. It now has a check: a headline figure that matches
**none** of the totals stated elsewhere on the page is flagged. Never
reconciled — picking a winner between two disagreeing figures would be
rewriting a value.

Reported once, as required:

| | result |
| --- | --- |
| rescued headline values compared to ground truth | **43 / 43 exact** |
| mismatches | **0** |
| headline-vs-total flags raised on the corpus | **0** |

GFE (49)'s figure is the 44th recovery but was read by the *primary* pass, so it
carries no `rescue` tag — the 44 = 43 rescued + 1 primary.

Scoping mattered: the first implementation treated **table cells** as headline
figures and immediately broke `suspect-invoice` by flagging a correct `$40.00`
against a `$95.00` total. A headline is a heading or a standalone paragraph;
cells are the column and total checks' business.

Fixtures: **`headline-mismatch.html`** (disagreement is flagged and the figure
left untouched) and **`headline-agrees.html`** (agreement raises nothing — a
validator that fires here would be worse than none).

### GFE (46) — settled by owner ruling

The `$0.00` is a **real printed value**: a zero-charge research scan quoted at
zero by design. It is therefore a genuine printed value that went unread, and
counts as a **miss**, correctly marked — exactly like the other five short-value
misses. The headline denominator stays 50, the miss set stays 6, and no special
case enters the code or the ground truth. Recorded so the next measurement does
not reopen it.

### Marker invariant restated

Owner-confirmed and now binding: **markers == misses, exactly** — every genuine
miss carries a marker, and no recovered page carries one. Today: 6 misses, 6
markers. The superseded "must not drop below 49/50" floor is struck from the
work order's Task 3 acceptance and from STATUS §3.3.

### Documents corrected

`STATUS.md` §3.3 and §3.4 were materially wrong — §3.3 asserted a contrast
theory that has been disproven and a regression that never happened, §3.4 left
the confidence gap unexplained. Both now summarise the findings and point here.

Scored metrics after all of the above: **50/50 · 49/49 · 52/52 · 50/50 · 3/50**.
`npm test`: **37/37**.

---

## 2026-08-15 · v1.3.0 cycle · Task 3 — the shaded-callout miss

### What was found — three things, and two of them correct my own prior reports

**1. The premise was wrong: it is not a shaded callout.** Cropping the flagged
region from a corpus raster shows large crisp black text on near-white paper
(background levels 247–251, text 0) reading `Total Estimated Costs:` / `$226.00`.
Nothing about it is faint. The whole contrast theory — mine, from the isolated
`#d8d8d8` experiment — does not apply to this corpus.

**2. The real cause is page-level layout analysis, not pixels.** On the same
saved raster:

| read | emits the headline figure |
| --- | --- |
| tesseract.js 6.0.1, whole page | **no** |
| CLI tesseract 5.5.3, whole page, PSM 3 | **yes** (`$226.00`, line 1) |
| tesseract.js 6.0.1, **region cropped out** | **yes**, confidence 77 |

Tesseract decides which blocks are text before recognizing any of them, and it
discards that block. The same pixels handed over without the surrounding page
read correctly. Cropping is the cure; contrast was never the disease.

**3. A separate defect was inflating everything: the ink detector counts dark
pixels.** The document title is reversed out — white text on a solid black bar.
The bar is ~48% "ink", word boxes cover only the white glyphs, and the leftover
was reported as a large unread region. Consequences, all now fixed: a
"value not recovered" marker on **48 pages that were missing nothing**, and a
**duplicate title line in all 50 files** when the rescue re-read the banner. The
stray `Ho` token flagged at confidence 9 in Task 1 is the small white square at
that bar's right end — a true positive, now explained.

### Corrections to my own earlier reports

- STATUS §3.3 said **0/50** headline recovery. Mid-task I "corrected" this to
  48/50 and was **wrong** — that measurement counted the *table's* total row,
  which in the 47 files without a Markdown table is an ordinary paragraph line
  and slipped past a "not a `|` row" test. Measured from word geometry, the
  pre-task figure is **1/50**. STATUS was right; my correction was not.
- **There was no v1.1.0 → v1.2.0 regression.** Both builds recover exactly one
  file (GFE 49, the widest headline). The reported "1 → 0" was the same broken
  metric. The explanation of why (49) succeeds where others fail still holds and
  now has a mechanism: it is the widest figure, so its unread-ink region is
  large enough to survive the detector's thresholds.

### Fix — one branch, as instructed

Branch identified: *region flagged, re-read returns nothing*. Two changes:

1. **Ink detector**: a region containing two or more already-recognized words is
   text we read, and its surrounding dark is background. Containment, not area
   coverage — glyphs are a small fraction of a filled bar however the ink is
   counted, and area-based rules either kept the banner or dismissed a genuine
   scrawl beside a paragraph.
2. **Rescue**: crop each flagged region and re-read it in isolation, with
   contrast boost only as a second attempt if the plain crop returns nothing.
   Padding is proportional to region height — a fixed margin recovered `.00`,
   then `26.00`, before landing on `$226.00`. Recovered text must contain two
   alphanumerics and score ≥ 40, so a signature or smudge cannot "recover" a
   region and silently remove its marker.

### Results on the 50-document corpus

| | before | after |
| --- | --- | --- |
| headline value read in the callout band | **1/50** | **44/50** (43 via the rescue) |
| misses left unmarked | 0 | **0** |
| files carrying a marker | 50/50 | 6/50 |
| duplicate title line | 50/50 | **0/50** |

The 6 remaining misses — GFE (37) (38) (39) (40) (41) (46) — are all *short*
values (`$50.00`, `$40.00`, `$0.00`): the region is flagged, the crop is
attempted, and it returns nothing. Characterized, not fixed. Note GFE (46)
legitimately quotes `$0.00` per the ground truth's own caveat, so it may not be
a miss at all.

### Acceptance criterion I could not meet, and why

The work order sets a floor: *"the marker rate must not drop below 49/50."* It
is now **6/50**. That floor was written on the premise that 49 files are misses;
the measurement shows 44 of them are now recoveries. Holding 49/50 would mean
re-introducing 44 markers on pages that are missing nothing — the false-alarm
problem Task 1 measured, which trains people to ignore flags.

The invariant the floor protects is intact and asserted directly: **every miss
is marked, 6/6, zero silent.** I did not weaken the assertion; I am reporting
that its stated form no longer matches the corpus and asking for the substitute
(*all misses marked*) to be confirmed.

### Score table

| metric | baseline | after Task 3 |
| --- | --- | --- |
| grand totals | 50/50 | **50/50** |
| line-item codes | 49/49 | **49/49** |
| amount on code's row | 52/52 | **52/52** |
| `#Error` | 50/50 | **50/50** |
| real tables | ≥3/50 | **3/50** |

`npm test`: **35/35**.

### Fixtures added

- **`inverted-banner.pdf`** — white text on a black bar plus the stray white
  block; asserts no unread-ink region, no spurious marker, and the title read
  once rather than twice. Reproduced RED before the fix.
- **`corpus-callout.pdf`** — a real corpus page
  (`test/fixtures/callout-page.png`, synthetic documents per the owner). It has
  to be the *whole* page: the failure is page-level layout analysis, so a
  cropped fixture cannot reproduce it — cropping is the remedy. Reproduced RED,
  now recovers the figure.
- **§3.5 rider** — `shaded-callout.pdf` gained an unreadable-scrawl region so
  the marker path is exercised deliberately rather than believed fixed "as a
  side effect", plus the recovered-text quality gate that stops garbage from
  clearing a marker.

### Housekeeping answers from Task 1

**Full 10-token flag table** (the earlier prose summed loosely; the table
reconciles exactly to 266):

| token | n | median | files | distinct bbox | tier |
| --- | --- | --- | --- | --- | --- |
| `Items` | 100 | 59 | 50 | 1 | 2 |
| `Tax` | 50 | 24 | 50 | 1 | 2 |
| `ID:` | 50 | 24 | 50 | 1 | 2 |
| `Ho` | 50 | 9 | 50 | 1 | 2 |
| `04-3642199` | 11 | 58 | 11 | 1 | 3 |
| `Cenvical` | 1 | 60 | 1 | 1 | 3 |
| `PAROTID),` | 1 | 62 | 1 | 1 | 3 |
| `Quantity` | 1 | 33 | 1 | 1 | 3 |
| `PM` | 1 | 56 | 1 | 1 | 1 |
| `Cervical` | 1 | 56 | 1 | 1 | 3 |

100+50+50+50+11+1+1+1+1+1 = **266**.

**`Cenvical` reclassified.** Cropping its bbox from the raster shows the source
reads **"Cervical Spine WO"** — a genuine misread, correctly flagged. Moved from
unverifiable to **verified incorrect**. The same method settled `04-3642199`:
the crop reads `Tax ID: 04-3642199`, so all 11 of its flags are **verified
correct** (false positives). Revised: **correct 212 · incorrect 51 ·
unverifiable 3** (`PAROTID),`, `Quantity`, `Cervical`).

**CLI residual closed.** `tesseract 5.5.3` (leptonica 1.87.0), installed for the
probe. On our own rasters at PSM 6 it emits **`TaxID:` as a single token at
66.8** — it never produces `Tax` as a word at all. The reviewer's "Tax = 96" is
therefore not a measurement of that token; the ~96 in that region belongs to
`provider` (96.4). Where both engines emit the same token, CLI scores 8–25
points higher (`U.S.` 94.5 vs 87, `Items` 84.8 vs 59), and it is not uniformly
better — it reads `included` as `inchided` (74.5), which we get right. A
finding, not a fix: nothing in the pipeline changed for it.

**Confound noted for the record:** rasters dumped before this task were captured
*after* the old whole-page contrast pass mutated the canvas, so those PNGs were
contrast-normalized. Engine-vs-engine comparisons used the same PNG on both
sides and are unaffected; the shipped-pipeline confidences came from the
unmutated image. The new crop-based rescue no longer mutates the page canvas, so
dumped rasters are now the true render.

### Invariant I was tempted to break and didn't

Accepting whatever the crop re-read returned. Dropping the quality gate would
have "recovered" the scrawl fixture's region and pushed the marker count lower —
better-looking numbers, achieved by deleting a warning that a human needs. The
gate stays, and the scrawl stays flagged.

---

## 2026-08-15 · v1.3.0 cycle · Task 2 — spurious deep headings

### What was found

The fixture caught something before the guard existed: on my rendered fixture
**the document title itself came out as `###`**. The work order's rule as
written — "no heading deeper than `##` on an OCR'd page" — would have deleted
legitimate titles wherever the size ratio only reaches h3, violating criterion 2.
So depth is **clamped**, not rejected, and removal is done by shape predicates.
All 6 corpus fragments are caught by the predicates alone; the clamp is a floor
for everything else.

Rules live as data in `OCR_HEADING_REJECTIONS`: `opens-mid-parenthetical`,
`unbalanced-brackets`, `leading-date`, `uppercase-descriptor-fragment` (requires
a bracket, so `DETAILS OF SERVICES AND CHARGES` survives).

### Heading diff — every change accounted for

```
headings  before: 107   after: 101
depth>=3  before:   6   after:   0

-2  "#### MATERIAL(S)"
-1  "#### 08-14-2026 CT Angiography Coronary (Coronary CTA/CCTA)"
-1  "#### (EG, FOR FOLLICLES)"
-1  "#### (Forearm)/Wrist/Heel (Appendicular)"
-1  "#### HEEL)"
```

**6 removed, 0 added, 0 legitimate headings lost.** All fragment text survives as
content — verified per file: `MATERIAL(S)`, `FOLLICLES`, `HEEL`,
`CT Angiography Coronary` all still present.

### Score table — unchanged

| metric | before | after |
| --- | --- | --- |
| grand totals | 50/50 | **50/50** |
| line-item codes | 49/49 | **49/49** |
| amount on code's row | 52/52 | **52/52** |
| `#Error` | 50/50 | **50/50** |
| real tables | 3/50 | **3/50** |

`npm test`: **33/33**.

### Fixtures added

- **`ocr-heading-rejection`** — the five observed corpus strings pinned
  verbatim, asserting each is rejected *and* names its rule, plus six legitimate
  headings that must survive. The rendered fixture can't reliably reproduce the
  promotion (it depends on OCR mis-measuring glyph height), so the observed
  strings *are* the reproduction.
- **`fragment-headings.pdf`** — a rendered 96 dpi table with three awkward wrap
  shapes, asserting no `###`, the title survives, and fragments remain as
  content.

### Runner defect (separate, as instructed)

Reports now go to `<emit>/reports/`, not the repo root. Worth noting: my first
attempt wrote them *beside* the conversions, and the heading diff immediately
read `audit-report.md` as if it were a converted document — inflating the count
by 51. The subdirectory is a direct consequence of that.

### Invariant I was tempted to break and didn't

Implementing the work order's depth rule literally. It would have made the 6
fragments vanish and passed criterion 1 — while silently demoting real titles to
paragraphs on any document where OCR sizes them lower. I changed the mechanism
rather than weakening the assertion, and reported it.

---

## 2026-08-15 · v1.3.0 cycle · Task 1 — the confidence discrepancy

### 1. The 1-vs-96 explanation

**It is page-segmentation mode.** The pipeline genuinely scores `Tax`/`ID:` at
19–26 on text it reads *correctly* — the number was never mis-plumbed.

Everything below ran on **the same 50 saved rasters** (pixel-identical input,
`~/mdforge-audit/out/default/*.png`):

| configuration | `Tax` (median) |
| --- | --- |
| shipped — PSM 3, tessdata_best, params on | **24** |
| bare worker — no `user_defined_dpi`, no `preserve_interword_spaces` | **24** |
| **PSM 6**, tessdata_best | **60** |
| PSM 3, standard tessdata | 19 |
| **PSM 6**, standard tessdata | **60** |
| reviewer's CLI (their render, their engine) | 96 |

- **Parameters: eliminated.** Identical medians on all 8 tokens, shipped vs
  bare. `preserve_interword_spaces` was the leading hypothesis and is not the
  cause.
- **Traineddata: eliminated.** best vs standard is noise. Independently useful:
  ~11 MB is spent on `best` with no measured benefit on this corpus.
- **PSM: confirmed, 24 → 60** on identical pixels — most of the gap.
- **Residual 60 → 96 open at time of writing.** CLI tesseract was not installed,
  leaving engine build and rasterizer uncontrolled. Rasters saved for exactly
  that probe.
- **The repetition is not a bug.** `distinct bbox = 1` across all 50 for `Tax`,
  `ID:`, `Items`, `Code`, `04-3642199` — boilerplate at identical positions,
  deterministic engine. Only the level needed explaining.

Versions: tesseract.js **6.0.1**, core **6.1.2**, tessdata_best **4.1.0**.

### 2. Flags at threshold 70, three tiers

**12,881** words with a numeric confidence; **266 flagged (2.1%)** — down from
417 at threshold 85. Only **10 distinct tokens**.

| tier | flags | verdict |
| --- | --- | --- |
| 1 — ground-truth overlap | 1 | correct text (`PM`) |
| 2 — boilerplate, bbox-identical in all 50 | 250 | **200 correct** (`Items` 100, `Tax` 50, `ID:` 50) + **50 genuinely wrong** (`Ho`, a spurious OCR fragment — a true positive) |
| 3 — unverifiable | 15 | not extrapolated |

**Correct 201 · incorrect 50 · unverifiable 15.** False-positive rate on
verifiable flags: **201/251 ≈ 80%**, concentrated in three template tokens.

### 3. Fixes landed

| fix | fixture |
| --- | --- |
| `appliedDpi` → `WeakMap` keyed to the worker; `forgetWorker()` clears promise and configuration together | **`ocr-worker-parameters`** — reproduced RED first |
| `w.confidence ?? 0` → `readWordConfidence()` returning **`null`**, counted and warned once | **`ocr-confidence-shape`** |

### 4. Score table

| metric | baseline | after Task 1 |
| --- | --- | --- |
| grand totals | 50/50 | **50/50** |
| line-item codes | 49/49 | **49/49** |
| amount on code's row | 52/52 | **52/52** |
| `#Error` | 50/50 | **50/50** |
| real tables | ≥3/50 | **3/50** |

**Lesson for the log:** the cleanup verification used
`find -name '*.md' | grep -iE "good faith"` — that matches **filenames, not
contents**. A file named `notes.md` full of document text would have passed. The
correct form is `grep -rilE "good faith|estimate" <dirs>`. Same family as the
`const`-reassignment lesson: the check tested the thing that was easy to test,
not the thing that mattered.

---

### APPENDED CORRECTION (2026-08-15, after Task 4) — the PSM attribution is retracted

The original note above is left exactly as written. This corrects one of its
findings.

Task 4 established by hash comparison that `tessedit_pageseg_mode` is accepted
and discarded by tesseract.js 6.0.1 — through `setParameters` **and** through
`createWorker`'s init config. Nothing in this pipeline can vary PSM. The probe
above therefore had **no controlled variable**: both of its arms set an inert
parameter, so both arms were the same configuration. **Any difference between
them is not a PSM effect, and the "PSM moves `Tax` from 24 to 60" finding is
retracted as not reproducible.**

The probe also has a reporting defect that made this easy to miss: it reads
several rasters and prints one number per token per arm, so its "psm3 vs psm6"
columns can differ simply by aggregating different pages. Rerun today over two
corpus rasters it prints `Items` 81 vs 59 across arms that are configurationally
identical.

**The 24 → 60 swing itself is real and still reproduces**, so it is recorded here
as OPEN rather than closed. What it is *not*, each eliminated by measurement:

| candidate | verdict | evidence |
|---|---|---|
| page-segmentation mode | **not it** | inert in this engine; byte-identical output both routes |
| worker parameters (`user_defined_dpi`, `preserve_interword_spaces`) | **not it** | production runs with `parameters: none` and `parameters: default` both read `Tax` at 24; the standalone probe reads 60 under both |
| the rescue pass injecting a low-confidence re-read | **not it** | every `Tax`/`ID:` instance across all 50 dumps is `source=primary` |
| PNG round-trip, alpha, or canvas background fill | **not it** | the decoded raster is fully opaque; no-fill and white-fill canvases differ in 0 of 3,446,784 pixels; canvas and blob routes both read 60 |

What remains is that the two paths do not produce the same read at all: on
GFE (49) the production pipeline recovers **260** primary words from the page it
rendered, while reading that page's own saved raster standalone recovers **263**.
Distribution in production is file-dependent — `Tax` scores 24 in 39 of 50
files, 1 in 10, and 0 in 1 — which a fixed engine setting would not produce.

Named candidate, untested and explicitly not a conclusion: canvas colour
management. `toDataURL` and `createImageBitmap` are each entitled to apply a
colour profile, and a ±1 luminance shift across a grayscale page is enough to
move Tesseract's binarization at the margins. Testing that needs a bit-exact
comparison of the OCR'd canvas against its own encoded raster, which is more
than this timebox allows.

**Status: open, with four hypotheses closed.** It is not load-bearing for
anything shipped — the `Tax = 1` vs `96` closure rests on the CLI tokenization
evidence (`TaxID:` as a single token at 66.8; the 96 belongs to `provider`),
which stands on its own. STATUS §3.4 has been corrected to say so.
