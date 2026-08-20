# Sumcheck v1.7.1 — Column Clustering Work Order (the one that missed)

**For:** the coding agent
**Owner decision:** this single-defect cycle runs next; the language cycle (`WORK_ORDER_V18.md`) waits. Scope is the column-clustering root cause identified in the Q5/Q9 notes — the one defect behind the only missed target of the v1.7.0 cycle. It owns, per the measurements already in the DEVLOG: the 66 same-page header/data splits (column counts 2-vs-3, 2-vs-5, 2-vs-6 either side of the split), most of the 30 page-split table pairs whose headers differ only because one side's grid collapsed, and the straddling row-label truncation (3/8 recovered). One cause, three symptoms — fix the cause once.

**Ground rules carry over:** fixture-first, characterization before fix, DEVLOG notes per task, both gates green per task, full corpus re-score with all five metrics at baseline, marker invariant throughout. Nothing touches the Chrome Web Store; `dist/sumcheck-1.6.0.zip` AND `dist/sumcheck-1.7.0.zip` are pending artifacts — record both SHA-256s in C0 and re-verify at the end.

## C0 — Version bump first

Both manifests to the dev form of **1.7.1** (the dotted-integer scheme used last cycle), SHA-256 of both pending zips recorded. Same reasoning as Q0/L0.

## C1 — Characterize the collapse before touching it

The Q5 note shows the *result* (five columns become three, header text packed into the first); this task establishes the *mechanism*. On a sample drawn from the 66 (state the sampling), instrument the clustering and answer:

- What input defeats it — header fragments whose x-positions straddle column gaps? Too few rows in the cluster window? The stack's decreasing left edges (the Q4 signature) polluting the column histogram?
- Why does the same table's *data* resolve correctly when the header is excluded — i.e., is the fix "cluster columns from data rows first, then assign header fragments to the resolved columns by x-overlap," or something else the measurement points to?
- The reference implementation assembled these same headers correctly from the same positional data — if useful, compare its column assignments on two or three of the 66 (its output is in the enclave) to confirm the information is present in the file.

Write the mechanism into the DEVLOG with counts before any fix, per the standing rule.

## C2 — The fix, fixture-first

- Extend `stacked-header.pdf` (or add a sibling fixture) to reproduce the same-page split: a header stack whose fragment positions defeat the current clustering, above data rows that resolve to a different column count. RED must show today's two-table split with the packed header.
- Direction the measurements are expected to support (confirm, don't assume): resolve columns from data-row evidence, then map header-stack fragments onto those columns by x-overlap — headers describe columns; they should never get a vote in *defining* them. If C1 points elsewhere, follow C1 and say why.
- Guardrails, asserted in fixtures: a genuine two-column table followed by a genuine three-column table on the same page must NOT be unified; the Q4 fold and Q5 merge behaviors must be unchanged on their existing fixtures; single-line-header tables untouched.

## C3 — Reap the downstream wins, measured separately

With clustering fixed, re-measure each symptom on the Winter '27 document and report each in its own row — these were the point:

| symptom | before | target |
| --- | ---: | --- |
| same-page header/data splits | 66 | **0** |
| tables with fully correct header | 21/209 | **~95% parity with the reference** (the original Q4 target) |
| page-split pairs merged by Q5's rule | 3/33 | most of the 30 now-eligible pairs merge, with the count reported |
| straddling row labels recovered | 3/8 | improved; report the number and what still blocks the rest |

The Q5 merge rule itself must not change — the new merges must come from headers that now genuinely match. If any pair still declines, say why (that list is the next residual).

## C4 — Re-bench, gates, release

- Winter '27 and Net Zero full re-runs: the v1.7.0 scoreboard columns reproduced with a 1.7.1 column added; word-level diffs for both documents with any lost words itemized (the Q5 standard: dropped repeated headers are acceptable, data words are not).
- Full corpus re-score, marker invariant, lexicon 50/50 — the GFE tables are the regression surface for a clustering change; this is the cycle's highest-risk gate, treat a single moved count as a stop-and-report.
- Version → **1.7.1**; CHANGELOG; full gates; `npm run package` → `dist/sumcheck-1.7.1.zip`; both older zips byte-identical to C0's record.
- Close the column-clustering issue from the commit; update `winter27-comparison.md` with the new header-assembly column.
- **Nothing uploaded to the Chrome Web Store.** When the pending 1.5.0 review resolves, the owner ships the newest packaged version at that moment.

Order: C0 → C1 → C2 → C3 → C4. Stop and report after C2 (the fix itself) before reaping C3 — the guardrail fixtures and the corpus are the review gate. If any corpus metric moves at any point, stop immediately.
