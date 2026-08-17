# MDForge — OCR Work Order (v1.2.0 → v1.3.0)

**For:** the coding agent (Claude Code / Codex)
**Scope:** OCR correctness only. UI/integration items from the product review are explicitly out of scope for this cycle.
**Basis:** `docs/` project-status review dated 2026-08-15 (§3 open problems, §7 pickup order), CHANGELOG 1.1.0–1.2.0, and a source-level review of `src/core/ocr.js`, `src/core/adapters/pdf.js`, `src/core/validate.js`.

---

## Ground rules (non-negotiable, from the project's own history)

1. **Never silently rewrite a value.** Validators and rescue passes flag; they do not correct. This invariant has been stated in three documents — keep it.
2. **A green `npm test` proves nothing by itself.** This project has twice shipped a branch that passed all synthetic fixtures and failed on all 50 real documents (the `const` reassignment in the rescue pass; the over-tight footer rule). Every task below ends with `npm run audit` + `npm run score-export` against the real 50-document corpus, and the score table goes in the task's completion note.
3. **No regressions on the five scored metrics.** Baseline to preserve: grand totals 50/50, line-item codes 49/49, amount-on-code's-row 52/52, `#Error` preserved 50/50, real tables ≥ 3/50. Any task that moves one of these down is not done, regardless of what it fixed.
4. **Every real-document failure you fix gets a fixture that reproduces it** before the fix lands, added to `test/harness.js`. Fixtures encode what you already thought of — that is exactly why each newly discovered failure mode must be encoded the moment it is discovered.

**Corpus location.** The real corpus lives in the **`mdforge-audit`** folder (a sibling of this repo, `~/mdforge-audit`). The 50 scanned GFE PDFs are packaged in the **zip archive(s)** in that folder; the ground-truth JSON is in the same folder. Before starting Task 1, locate both and report the exact paths you found. These documents contain personal data: never copy them outside `mdforge-audit` — if the zips must be unpacked to run the audit, unpack them in place, inside `mdforge-audit`, and the audit serves them read-only from there.

**Commands:**

```bash
npm test                                                  # 29 cases, headless Chrome
npm run audit -- <corpus-dir-in-mdforge-audit> --emit <out-dir>   # convert the real corpus
npm run score-export <out-dir> <groundtruth.json>         # score against ground truth
```

---

## Task 1 — Settle the confidence discrepancy (status §3.4) · **do this first**

**Problem.** The reviewer reports the same 8 tokens flagged in all 50 files at byte-identical scores, `Tax` at confidence 1; your own wrapper returns 96 for the same word. Neither side has explained the gap. A confidence layer reporting numbers nobody can explain undermines the entire verification story — this blocks everything downstream that gates on confidence.

**Do not start by assuming either side is wrong.** Build the instrumentation to make the numbers explain themselves:

1. Add a debug flag to the audit runner (e.g. `--dump-words`) that writes, per page, every word with `{text, confidence, bbox, source}` exactly as it leaves `toLines()` in `src/core/ocr.js` — i.e., post-wrapper, pre-adapter.
2. Run the 50-document corpus once with the extension's exact Tesseract configuration and once with a bare `createWorker(lang)` — **no** `user_defined_dpi`, **no** `preserve_interword_spaces` — and diff the confidences for the 8 reported tokens. `preserve_interword_spaces: '1'` is a known behavior-changing parameter; it is the most plausible configuration difference between "your run" and "the reviewer's run."
3. Check the identical-scores observation before treating it as a bug: the 8 tokens are almost certainly form boilerplate rendered from identical pixels in every file, and Tesseract is deterministic — byte-identical scores on byte-identical input is *expected*. What needs explaining is only the 1-vs-96 level, not the repetition.
4. Audit two specific code paths in `src/core/ocr.js` while you are in there:
   - `toLines()` maps `w.confidence ?? 0`. If the blocks-output word object shape ever differs from what this expects (a tesseract.js version where confidence lives elsewhere, or a `choices`-style field), every word silently becomes confidence 0/low without an error. Log a loud warning if a word object arrives without a numeric `confidence`.
   - The module-level `appliedDpi` cache in `applyParameters()` persists independently of the worker lifecycle. Confirm there is no sequence (worker recreated, same dpi requested) in which a fresh worker never receives `user_defined_dpi` / `preserve_interword_spaces` because the cache says they were already applied. If the sequence exists, key the cache to the worker instance.

**Acceptance.**
- A written explanation of the 1-vs-96 discrepancy, reproduced with the instrumentation — or a demonstration that it does not occur against the real corpus with the shipped configuration, with the dump attached.
- The flagged-word false-positive question re-measured at the current threshold (70) across all 50 files: report flags total, and how many flag words that are actually correct per ground truth.
- Any code fix that falls out (word-shape guard, `appliedDpi` keying) lands with a fixture.

---

## Task 2 — Kill spurious deep headings from table fragments (status §3.2)

**Problem.** 6 spurious headings across 5 files: wrapped table-cell fragments (`#### MATERIAL(S)`, `#### (EG, FOR FOLLICLES)`, `#### 08-14-2026 CT Angiography Coronary…`) promoted by the font-size heuristic. Small, self-contained, visible in every affected file.

**Implement the guard proposed in the status doc,** in the heading-inference path of `src/core/adapters/pdf.js`, applied only to OCR'd pages:

- No heading deeper than `##` on an OCR'd page (the `ocred` flag already exists on each page object).
- Reject heading candidates whose text has unmatched parentheses.
- Reject heading candidates that match code-descriptor / date-leading fragment shapes (starts with a date, or is an all-caps fragment ending mid-parenthetical). Keep the rejection rules as data (a list of predicates), not a chain of inline conditionals — this heuristic family is where the project has repeatedly grown fragile.

**Acceptance.**
- The 6 known spurious headings are gone across the corpus (`npm run audit`, grep the emitted Markdown for `^####` and `^###` on OCR'd files).
- No legitimate heading lost: the corpus's real headings (document titles, section heads) still emit — diff heading sets before/after across all 50 files and account for every change.
- A fixture reproducing at least two of the three quoted fragment shapes, asserting they emit as table/paragraph content, not headings.
- Scored metrics unchanged.

---

## Task 3 — Instrument, then fix, the shaded-callout miss (status §3.3)

**Problem.** 0/50 files recover the standalone `Total Estimated Costs: $X` from the grey `#d8d8d8` callout; 49/50 correctly carry a `value not recovered` marker instead. The rescue pass was built for exactly this and fires on real pages — but not on this box. v1.1.0 recovered it on one file; v1.2.0 recovers it on none.

**The status doc already names the question to answer first: is the callout region reaching the ink detector at all?** Work in this order:

1. Add debug output to the ink-coverage detector: per page, emit the flagged unread-ink regions as rectangles (a JSON sidecar per file under the audit `--emit` dir is enough; an overlay PNG is better if cheap).
2. Run the corpus. Branch on what you find:
   - **Region not flagged** → the ink detector is the bug. Likely cause: after grayscale conversion the `#d8d8d8` box reads as low-contrast "background" and its ink coverage doesn't clear the threshold, or the recognized words *around* the box cause the region to be counted as read. Fix the detector's threshold or region accounting — measured against this corpus, not synthetically.
   - **Region flagged but rescue returns nothing** → the contrast-boost re-read is insufficient for this box. Reproduce the isolated `#d8d8d8` case you already built, but with the *actual* crop from a corpus page, and tune the local-contrast pass against it.
   - **Rescue returns text but it is dropped in merge** → the merge-back filter (`only lines inside flagged regions`) is clipping it; check boundary conditions on the region/line intersection.
3. Only after the mechanism is identified, fix it — one branch, not three speculative changes at once.

**Acceptance.**
- The instrumentation output for all 50 files is kept (it is the regression baseline for this detector).
- Headline total recovered on a majority of the 50 files, **or** a documented finding of why it cannot be.
- **Marker invariant (restated 2026-08-15, owner-confirmed): markers == misses, exactly.** Every genuine miss carries a `value not recovered` marker, and no recovered page carries one. The earlier "must not drop below 49/50" floor encoded an assumption — that ~49 files are misses — which measurement disproved; holding it would manufacture 44 false alarms. Silence on a miss remains the only unacceptable outcome. Current state: 6 misses, 6 markers.
- The v1.1.0-vs-v1.2.0 regression (1 → 0 recoveries) is explained in the completion note.
- A fixture with a real-geometry shaded callout (crop from the corpus, not a synthetic box) asserting recovery or marker.
- §3.5 rider: while in this code, add the deliberate marker-placement test the status doc asks for — assert markers attach to the *unrecovered* value's position, not after a recovered one. It is currently believed fixed "as a side effect," which this project's history says to distrust.

---

## Task 4 — Rebuild table detection around column clustering (status §3.1) · **only after 1–3**

**Problem.** Tables form on 3/50 documents. The current detector is a chain of sequential-run thresholds (row pitch, wrapped-cell gap, column tolerance, misfit ratio) that took three attempts to tune and is acknowledged as the most fragile code in the project. Document (47) still fails on a wrapped descriptor; the 46 single-item documents emit neither a table nor the fallback note the reviewer's assertion 5 requires.

**Approach.** Replace sequential run-building with geometry clustering, as the status doc recommends:

1. Collect word boxes for the candidate region (both text-layer and OCR paths already produce per-word x/x2/top/bottom — see `toLines()`).
2. Cluster x-coordinates across *all* lines in the region into column bands (1-D clustering on box left/right edges; gutters are the gaps between bands). This makes column structure a property of the region, not of consecutive-row accumulation — a wrapped fragment cannot terminate what it never participates in.
3. Assign each line's words to bands; a line whose words occupy one band and sit within continuation distance of the previous row is a wrapped cell by construction.
4. Keep the existing conservative fallback: if the grid doesn't resolve cleanly, emit the aligned preformatted block. A wrong table is worse than no table — that principle stands.
5. **Close the assertion-5 gap:** any page where a charges-table region is detected but falls back must write an explicit note to front matter (e.g. `table_fallback: preformatted`), so "no table" is never silent.

**Acceptance.**
- Document (47) emits a correct table (its wrapped descriptor inside its own cell).
- Multi-item table count ≥ 4/50 with all previously-correct tables (GFE 49, the PET estimate, the third) still correct — row-for-row identical or better.
- Every one of the 50 files either emits a table for its charges region or carries the front-matter fallback note. 0 silent cases.
- All five scored metrics at or above baseline — this is the task with the highest regression risk against amount-on-row 52/52; run `score-export` after every meaningful change, not once at the end.
- The old detector's regression fixtures (wrapped-cell table, shaded callout, 96 dpi form) all pass against the new implementation before the old code is deleted.

---

## Task 5 — Load the extension in Chrome (status §4)

The MV3 wiring has never been exercised by a human or agent: service worker registration, popup's three entries, context menus (`page` / `selection` / `link` / `action`), the `chrome.storage.session` job handoff, and the optional-permission prompt on "Convert linked file." Load unpacked, run each path once, convert one real PDF end-to-end through the UI, and record pass/fail per path in the completion note. Any failure becomes its own task; do not batch fixes into Tasks 1–4.

---

## Deferred (tracked, not in this cycle)

- `M H` → `MH` name collapse (50/50, cosmetic, unchanged since v1.0.0) — revisit only if Task 1's instrumentation makes the segmentation cause obvious in passing.
- Stray `#` mid-line in (49) from v1.1.0 — re-check its presence during Task 3's corpus runs and note the result; fix only if still present.
- Product-review items (password modal, queue rendering, OffscreenCanvas, i18n, packaging size) — separate work order.

## Reporting format

Per task, the completion note contains: what was found (not just what was changed), the before/after score-export table, fixture names added, and any invariant you were tempted to break and didn't. If a task's acceptance criteria cannot be met, say so explicitly with the evidence — a documented dead end is a valid deliverable; a quietly weakened assertion is not.
