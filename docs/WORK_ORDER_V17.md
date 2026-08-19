# Sumcheck v1.7.0 — Conversion-Quality Cycle Work Order (the Winter '27 findings)

**For:** the coding agent
**Owner decision:** this cycle runs BEFORE the language cycle (which is now `WORK_ORDER_V18.md`). Scope is the defect ledger from the Winter '27 bench — issues #9–#14 — plus the two mechanisms the independent PyMuPDF pipeline proved out (embedded-outline headings, link annotations). If the bench addendum task has not yet been run (third column in `winter27-comparison.md`, outline/link issues filed), run it first — its findings are inputs here.

**Ground rules carry over:** fixture-first, DEVLOG completion notes per task, both gates green per task, full corpus re-score on conversion-touching tasks with all five metrics at baseline, marker invariant throughout. Nothing touches the Chrome Web Store.

**The acceptance measure for this cycle is the Winter '27 document itself.** The bench recorded the before-counts; Q9 re-runs the same document and reports the after-counts side by side. Targets are stated per task. The GFE corpus staying flat is the other half of every target.

## Q0 — Version bump FIRST

Bump both manifests to **1.7.0-dev** before any other change, and record `dist/sumcheck-1.6.0.zip`'s SHA-256 in the DEVLOG note. Same lesson as last cycle: the packaging gate rebuilds `dist/sumcheck-<version>.zip` on every run, and 1.6.0 is the pending-release artifact — it must be byte-identical at cycle end.

## Q1 — Embedded outline as the heading authority (root-cause item)

Born-digital PDFs frequently carry their heading tree in the file; the Winter '27 PDF has a 1,968-entry outline, and the independent pipeline's 1,990 clean headings came from it. Sumcheck ignores it and re-derives headings from glyph sizes — which is where the 713 bullets-as-headings and the doubled titles came from.

- When a PDF carries an outline: outline entries become the headings, level from outline depth (capped at h6), matched to their page positions. Font-size inference remains active only for text the outline does not claim — and any size-inferred heading between outline anchors gets demoted to bold text if it conflicts with the outline's structure.
- When a PDF has no outline (check the Net Zero guide and the GFE corpus; record which have one): current behavior, untouched.
- Fixture: a small PDF with an outline whose entries disagree with font-size inference (an oversized non-heading line, an undersized real heading). RED must show the current size-based misread.
- Target on Winter '27: heading count moves from 2,674-with-713-junk toward the outline's ~1,990, and the #10/#11 counts (Q2/Q3) drop to near zero on this document via this mechanism alone.

## Q2 — Bullets emitted as headings (#10), for PDFs without outlines

The measured cause: a 19.2 pt decorative `•` glyph joined to 12.8 pt text carries the assembled line over the h2 size ratio, and the heading branch runs before the list-marker branch.

- Fix the general mechanism, not the glyph: compute the heading size ratio from the line's text glyphs excluding leading list-marker/decorative glyphs, and/or run the list-marker test before the heading test. State which and why.
- Fixture from the bench's one-page extract: the oversized-bullet line must become a list item, RED first.
- Target: Winter '27 bullets-as-h2 713 → 0 with list items 320 → ~1,033; corpus headline metric unmoved.

## Q3 — Headings containing their own text twice (#11)

`### August 2026August 2026` where the PDF draws the text once. Reproduces on a one-page extract. Diagnose the duplication (two text runs? extraction overlap?) and write the cause into the DEVLOG before fixing. The fix must not deduplicate legitimately repeated words ("had had", "Sales Sales Cloud" style names) — assert that in the fixture.

- Target: 86 → 0 on Winter '27; zero corpus movement.

## Q4 — Stacked multi-line column headers (#9)

The three-line column headers ("Enabled for / users", etc.) currently emit as a header plus junk data rows — 2 correct of 209 against Docling's 95/109 and the PyMuPDF pipeline's clean `Enabled for<br>users` assembly. The reference implementations prove the fix is structural: the fragments' positions already distinguish header lines from data rows.

- Assemble consecutive header-band lines above the first data row into one header row, cells joined with `<br>` (the same in-cell break T1 established). The T1 grid work already collects fragments with positions — build on it.
- Fixture from issue #9's captured example: RED shows the junk rows, GREEN shows one header row and no data-row loss.
- Target on Winter '27: correct header assembly 2/209 → parity with the ~95% reference; row bodies stay intact (they are already correct — do not regress them).

**Stop and report after Q4 for review before continuing.**

## Q5 — Page-boundary table continuation (#13)

No tool stitches continuations today; ours also truncates straddling row labels. With Q4 in place, a repeated header row on the next page becomes a reliable continuation signal.

- When a table ends a page and the next page opens with a table whose (Q4-assembled) header matches, merge: drop the repeated header, append the rows, and stitch a row label split across the boundary.
- Scope honestly: header-match continuations only. A continuation with NO repeated header is out of scope — note it as a residual, do not heuristically join tables that merely touch a page break.
- Fixtures: the existing field-details.pdf pages extended with a matching-header continuation (RED: two tables; GREEN: one), plus a non-matching adjacent table asserting NO merge.
- Target on Winter '27: the 33 single-boundary tables report how many merged; corpus table metrics unmoved (single-page GFEs give the merge nothing to act on).

## Q6 — Images: never silent (#12)

335 images on 131 pages currently produce nothing and no indication — silence is the one thing this product promised never to do.

- Required: where the PDF adapter encounters a rendered image it does not emit, produce a visible marker in the output (`<!-- SUMCHECK: image on page N not converted -->` next to a short visible placeholder line) and a count in the result notes ("N images not converted").
- Required: the settings panel's `imageMode` copy must tell the truth — if embed/extract/link have no effect for PDFs, say "not yet supported for PDF" beside the control (localized).
- Full image extraction for PDFs is OUT of scope this cycle; leave issue #12 open with a note narrowing it to extraction, or file a successor issue.
- De-duplicate honestly: decorative/repeated objects (logos on every page) should be counted once per page but must not produce 335 identical placeholder lines that bury the content — group repeats, and say in the note how.

## Q7 — Link annotations

The Winter '27 PDF carries link annotations (the independent pipeline preserved 1,179). Extract PDF link annotations whose rectangles overlap emitted text and wrap that text as a markdown link. External (http/https/mailto) links only; internal document links are out of scope (note as residual).

- Fixture: a small PDF with two external links and one internal link — externals emitted as links, internal left as plain text.
- Target on Winter '27: link count reported alongside the reference's 1,179; corpus unmoved (GFEs carry none — assert that stays true).

## Q8 — Harness end-to-end check made document-agnostic (#14)

The check currently requires a `$nn.nn` amount, a fossil of the billing corpus. Replace with assertions any real conversion satisfies (front matter present, nonzero body, structural element present when input has one), and keep a corpus-specific currency assertion only in corpus-specific cases. Same lesson as the hardcoded `$151.00`.

## Q9 — Re-bench, gates, release

- Re-run the Winter '27 document on the built 1.7.0 and produce the before/after table against every target above (headings, bullets, doubles, header assembly, merges, image markers, links, wall-clock, size/token line). Append it to `winter27-comparison.md` and summarize in the DEVLOG.
- Re-run the Net Zero guide: its chrome/table/heading numbers must not regress (T2's 99.6%/100% and T3's 892 headings are the baseline).
- Full corpus re-score, marker invariant, lexicon 50/50.
- Version → **1.7.0**; CHANGELOG; `npm run check`; `npm test`; `verify-extension` against the packaged zip → `dist/sumcheck-1.7.0.zip`.
- Verify `dist/sumcheck-1.6.0.zip` SHA-256 matches Q0's record. Nothing uploaded to the Web Store.
- Close #9–#14 and the outline/link issues from commits.

Order: Q0 → Q1 → Q2 → Q3 → Q4 → **checkpoint** → Q5 → Q6 → Q7 → Q8 → Q9. If any corpus metric moves at any point, stop and report immediately.
