# Sumcheck v1.6.0 — Conversion-Quality Cycle Work Order

**For:** the coding agent
**Scope:** the seven-issue ledger filed on GitHub (#1–#7). This is the first post-launch cycle: 1.5.0 is live in (or just out of) Chrome Web Store review, so nothing here touches the store dashboard, and the version bump to **1.6.0** happens only in the final task. The refreshed store screenshots already committed (with the Feedback footer) ship with this release and close the screenshot/package drift.

**Ground rules carry over:** fixture-first for every behavior change (RED before the fix), DEVLOG completion notes appended verbatim per task, both gates green per task (`npm test` + `verify-extension`), full corpus re-score for any conversion-touching task with all five metrics at baseline or better, and the marker invariant (markers == misses, scorer-asserted) holds throughout. Reference the issue number in each commit message and close the issue from the commit.

Task order: T1 → T2 → T3 → T4 → T5 → T6. T1 and T2 are the heart of the cycle; do not start T4/T5 early to bank easy wins first.

---

## T1 — Nested key-value structure inside table cells (issues #1 + #4, one task)

The one real structural weakness the Docling benchmark surfaced. Issue #4 carries the full expected-token table for page 600 of the Net Zero Cloud guide — the fixture can be built from the issue alone, without the source PDF leaving the audit enclave.

- Build the regression fixture first, from issue #4's table, and watch it fail (RED). The fixture asserts row-faithfulness: every key-value pair lands in the row it came from — cross-row drift is the failure mode Docling exhibited (8/17) and we currently flatten (17/17 row-faithful but structure lost).
- Then the fix: when a table cell contains its own key-value structure, preserve it — the target output shape is the cell's pairs rendered as an inline sub-structure (e.g. `key: value` lines separated by `<br>` in GFM, or a nested list in the JSON emitter's block for that cell), never promoted out of the cell and never merged across rows.
- All four emitters (md/html/txt/json) must agree on the structure; the JSON emitter should expose the pairs as data, not a joined string, if that falls out naturally — do not force it if it distorts the block model, and say which way it went in the note.
- Full corpus re-score. The GFE corpus has simpler tables; expect no movement, and flag any.

## T2 — Strip running headers and printed folio numbers (issue #2)

Docling's stripping is the reference behavior. `stripRunningHeads` exists and misses; the task is first to characterize *why* — measure before changing.

- Instrument on the Net Zero document (or its committed fixture pages): what fraction of repeated heads/folios does the current pass catch, and what do the misses have in common (position tolerance, font-size variance, page-number patterns, first/last-page exceptions)?
- Write the characterization into the DEVLOG **before** the fix, with counts. Then fixture-first on the identified miss classes.
- Guardrail: stripping must never remove a line that appears once — repetition across pages is the license to strip. A heading that legitimately repeats (e.g. a section title that recurs) is the known hard case; if it cannot be distinguished reliably, prefer under-stripping and say so.
- Full corpus re-score; headline/table metrics must not regress.

## T3 — Wrapped display-size title splits into two headings (issue #6)

Bug, small and contained. Fixture reproducing the split-title from the issue, RED, then fix in the heading assembler. Corpus re-score (heading-adjacent, so the headline metric is the one to watch).

## T4 — Size and token savings in the result header (issue #3)

The owner's request from the Net Zero test, and a selling point for the RAG audience.

- Result header gains one line per conversion: original file size → output size, percent reduction, and an **estimated** token count for the output with the estimate clearly labeled as such (a chars/4 heuristic is acceptable; do not ship a tokenizer model for this). Batch view: totals across the batch.
- The JSON emitter's front matter carries the same numbers as data.
- No network, no new permissions. Localized strings (both locales files updated, no empty messages). UI-only + emitter-metadata task: no corpus re-score needed unless an emitter's scored output surface changed — state which in the note.

## T5 — "Copy diagnostic info" (issue #7)

The constraint is the feature: the copied payload contains **counts and settings only — never a filename, never converted text, never document content**. Issue #7 specifies the fixture asserts the negative: no substring of the converted text appears in the payload. Build that fixture first.

- Payload: extension version, Chrome major version, input format and page count, OCR on/off and applied DPI, confidence summary counts, validator flag counts by type, settings that affect conversion. Human-readable, pasteable into the bug template's diagnostics field.
- Button lives with the result notes and in the error state (a failed conversion is when it is needed most).
- Localized. The bug template's diagnostics field description should be updated to say the button produces exactly what the field wants.

## T6 — Wall-clock in the audit runner (issue #5), then release

- `score-export` and the audit runner record wall-clock per document and total; the DEVLOG note includes the current full-corpus timing as the first recorded baseline.
- Version → **1.6.0** in both manifests. CHANGELOG entry summarizing the cycle, issues closed by number.
- `npm run check`, `npm test`, `verify-extension` (packaged zip installed), full corpus re-score, `npm run package` → `dist/sumcheck-1.6.0.zip`. Confirm zip contents per the package-contents check (LICENSE and NOTICE now carry the Everything Virtually LLC line — expected).
- **Do not upload anything to the Chrome Web Store.** The owner decides submission timing after the 1.5.0 review resolves. Final DEVLOG note: per-task summary, score table, fixtures added, timing baseline.
