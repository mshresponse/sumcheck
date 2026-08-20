# Sumcheck — Exam Harness & Research Loop Work Order (infrastructure, no product release)

**For:** the coding agent
**What this builds:** the governed experimentation infrastructure — a unified exam corpus with a sealed hold-out, a fenced two-tier grader, a determinism check, and a Karpathy-style keep-or-discard loop. No version bump; the only product-code change permitted in this order is H5's assignment, and only through the loop. `dist/sumcheck-1.7.1.zip` (and older) must be byte-identical at the end — record SHA-256s in H0.

**Terminology:** "tuning set" = documents the loop may see freely. "Sealed set" = documents graded once per round against pre-registered targets, never converted, inspected, or read during tuning. The sealing is the entire point; treat a sealed-set leak the way the project treats a corpus regression — stop and report.

All harness code lives in `~/mdforge-audit/exam/` — the enclave, NOT the repo. Nothing in this order is committed to the public repository except (if useful) a pointer in docs/STATUS.md that the harness exists.

## H0 — Corpus intake and the unified manifest

1. Inventory everything under `~/mdforge-audit/corpus-candidates/`: `generated/` (14 files), `format-smoke-set.zip` (unzip to `smoke/`, 10 files), `realworld/` (17 files incl. the MuleSoft pair), `SF pdfs/` (23 files, no manifest yet — build one: sha256, bytes, producer, pages, origin `owner-archive`). Plus the two reference documents already in the enclave (Winter '27, Net Zero) — enter them in the manifest flagged `reference: true`.
2. Three remaining collection items, same rules as the last collection task (record URL/provenance/sha256; verify not encrypted, pdftotext-parses):
   - **Two open-access medical journal PDFs** (e.g. from PubMed Central) — pick articles with tables; the value is the JATS-based journal typesetting pipeline, a generator family the corpus lacks.
   - **One synthetic/de-identified clinical-note sample document** — publicly published sample medical transcriptions only; nothing real, consistent with the project's PHI discipline.
   - **One 19th-century printed-book scan** from the Internet Archive (English, printed — not manuscript): old typefaces, long-s/ligatures, aged paper. This is deliberate edge-of-claims OCR stress.
   - Owner item, pending: a phone photograph of a printed Meridian page. Leave a manifest placeholder; do not block on it.
3. Merge every manifest into `exam/MANIFEST.csv` (superset columns; blanks where a tranche lacks a field). Assert: no duplicate sha256, every file opens, every PDF parses. Report counts by producer family and by format.

## H1 — Split and seal

1. `make_split.py` (in `corpus-candidates/generated/`) over the unified manifest. **Exclusions before the draw:** the two reference documents and the 50-GFE scored corpus are permanently tuning-side — they have published measurements and cannot be sealed; the format-smoke files are all tuning-side (they are pass/fail adapter checks, not tuning targets). Everything else — realworld, SF archive, generated PDFs, the new H0 items — enters the draw.
2. The owner supplies the seed (ask for one number; do not choose it yourself). Sealed fraction 0.4.
3. Seal mechanics: copy sealed files to `exam/sealed/`, `chmod -R a-w`, and write the DEVLOG pre-registration entry BEFORE any tuning: seed, sealed file list with sha256s, grader script hash (from H2), and the standing rule that only the round-grade step may read `exam/sealed/`.

## H2 — The grader, fenced

`exam/grade.mjs`, two tiers, deterministic, no network:

- **Tier A (loop-iteration gate, target < 90 s):** the 50-GFE corpus scored + byte-stability check (hard gate — any movement fails the experiment outright), plus a fast subset of ~6 tuning documents (builder picks a fixed, named subset: one XEP release note, one Prince guide, the census doc, one generated PDF, the MuleSoft pair) with structural counts.
- **Tier B (round grade, full sweep):** every document in the target set (tuning or sealed, per invocation), per-document metrics: headings, tables, fully-correct-header count, stranded header-only tables, merges, list items, links, images declared, review-flag count, wall-clock, output sha256. For known-truth documents (generated set, smoke set, MuleSoft pair) additionally grade against source: heading recall, table-cell accuracy on the availability matrix, totals intact, no invented text.
- **Composite score:** hard constraints first (corpus byte-stable; no data-word loss vs previous build on any tuning doc, repeated-header drops excepted per the Q5 standard); then a weighted objective over the structural metrics. Weights in one config block, documented.
- **The fence:** the grader and manifest live under `exam/`, outside the loop's editable surface. Record `grade.mjs`'s sha256 in the DEVLOG; the round-grade step re-checks it and refuses to run on a mismatch.

**Stop and report after H2** — the grader design gets reviewed before anything tunes against it.

## H3 — Determinism calibration

Run Tier B twice on the identical build over the tuning set. Every per-document output sha256 must match run-to-run. Any nondeterminism (timestamps in output, iteration-order dependence, OCR jitter) is a bug: fix the output or exclude the field from hashing, and record which. A grader that can't reproduce its own scores cannot referee a loop.

## H4 — The loop runner

`exam/loop.mjs`, modeled on the autoresearch shape: propose → apply → gate → score → keep-or-discard → journal.

- **Editable surface:** `src/core/adapters/pdf.js` and (if the builder prefers to extract constants first) one constants module. Nothing else — not the emitters, not the validators, not the scorer, never `exam/`.
- Each experiment: the proposing agent writes a change with a one-line hypothesis; build; Tier A gate (hard fail = auto-discard); Tier B over the tuning set; keep iff the composite improves and no hard constraint trips; append to `exam/journal.md`: hypothesis, diff summary, scores, decision. The journal is append-only and is the cycle's DEVLOG raw material.
- Budgets: max experiments per run and a wall-clock budget, both flags. A kept change becomes the new baseline; discarded changes revert cleanly (git worktree or stash — builder's choice, stated).
- The loop never touches `exam/sealed/`, never edits tests or fixtures, never edits the grader. Repo tests are not the gate here (Tier A is), but the final kept state must also pass `npm test` + `verify-extension` before H5's round grade.

## H5 — Pre-registration and the first assignment: line-first clustering

1. Pre-register in the DEVLOG before the run: the assignment (replace greedy pooled clustering with line-first column resolution — a line's own fragments are definitionally distinct; align lines afterwards), targets (fully-correct headers ≥ 85% on the Winter '27-class tuning documents, stranded header-only tables → 0, no regression in any other metric, corpus byte-stable), the seed, sealed hashes, grader hash.
2. Run the loop within budget. The final kept state must pass the full repo gates.
3. **Round grade: Tier B over `exam/sealed/`, once.** Report tuning-set results and sealed-set results side by side, per document. Pass = ship candidate for the next version; fail = the finding is overfit, and that finding is the deliverable — do not iterate against the sealed set to fix it.
4. DEVLOG note: journal summary (experiments run/kept/discarded), the score trajectory, sealed-set verdict, and both pending zips' SHA-256s unchanged.

Order: H0 → H1 → H2 → **checkpoint** → H3 → H4 → H5 (pre-registration pauses for the owner's seed at H1 and the reviewer's green light after H2). If the GFE corpus moves at any point, stop immediately and report.
