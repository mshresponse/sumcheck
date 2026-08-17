# MDForge — Ship-Readiness Work Order (v1.3.0 → v1.4.0)

**For:** the coding agent
**Goal:** a Chrome Web Store–submittable build. Conversion correctness is proven (see `DEVLOG.md`, v1.3.0 cycle); this cycle captures that value by fixing the ship blockers and cutting the install to consumer size.
**Owner decisions already made:** focus is ship-readiness; tessdata switches to `fast` **only if** the full corpus re-score holds (Task 1).

---

## Ground rules (carried over from the v1.3.0 work order, amended)

1. **Never silently rewrite a value.** Unchanged.
2. **Two green gates now, not one.** Every task ends with `npm test` AND `node scripts/verify-extension.mjs <corpus-pdf>` (the 20-check MV3 harness) green. Tasks that touch conversion (Task 1 only, in this cycle) additionally re-run `npm run audit` + `npm run score-export` on the 50-document corpus.
3. **Baseline to preserve** — the v1.3.0 exit numbers: grand totals 50/50 · codes 49/49 · amount-on-row 52/52 · `#Error` 50/50 · tables 49/50 (zero silent) · headline 44/50 · markers == misses (6/6) · verify-extension 20/20.
4. **Fixture-first** for every behavior change. UI behavior fixtures go in the harness or `verify-extension.mjs`, whichever can actually exercise them.
5. **DEVLOG discipline continues**: full completion note per task, appended verbatim, corrections appended never edited.

Deferred and NOT in this cycle: the 6 short-value crop misses, the open 24→60 canvas color-management probe, the M-H name collapse, Obsidian/templates/extractor features. Do not drift into them.

---

## Task 1 — tessdata_fast, verified

Switch the shipped pack to `tessdata_fast` (`scripts/fetch-vendor.mjs --quality fast`), then re-run the **entire** measurement suite on the 50-document corpus: the five scored metrics, headline recovery, marker count, table count, flag count at threshold 70.

- **Every number at or above the v1.3.0 baseline** → `fast` ships. Record the before/after table and the new zip size (expect ~17 MB → ~6 MB).
- **Any number drops** → revert to `best`, record which metric moved and by how much, and the decision is closed the other way. The owner's instruction is explicitly conditional — do not ship a regression to hit a size target.
- Either way: report final `dist/` zip size, and check `vendor/` for any other dead weight the package includes but never loads (pdfjs cmaps/fonts are used — verify rather than assume).

## Task 1b — Prose lexicon validator (owner condition on the `fast` decision)

The owner ships `fast` on the condition that confidently-wrong **non-words** get surfaced, not just low-confidence ones. Add a validator in the existing family (suggest, never rewrite):

- For OCR'd prose tokens — alphabetic, ≥4 chars, mixed-case, no digits — a token absent from a bundled English wordlist that sits within edit distance 2 of a common word gets the standard marker: `"inchided" may be "included"`. Runs regardless of confidence, so a 95-confidence `inchided` is still caught.
- Wordlist ships in the package (no network). Budget: ≤400 KB compressed — do not give back the Task 1 size win. State the final size.
- **False-positive discipline is the whole task.** This corpus is full of correct clinical vocabulary (`Cervical`, `PAROTID`, CPT descriptors) that a naive dictionary flags. Exclusions: all-caps tokens, code/descriptor lines, table cells already covered by the value validators, tokens with digits. Acceptance: on the 50-document corpus, the new validator flags `inchided` (50/50) and flags **zero** correct words — measure and report, and if clinical terms leak through the exclusions, tighten the trigger (require an edit-distance-≤2 common-word neighbor) rather than growing a whitelist.
- Fixtures: a high-confidence non-word is flagged with its suggestion; `Cervical` and an all-caps descriptor are not.
- Record the boundary in README's "when to trust" section: real-word substitutions remain undetectable by any automated check; the flag layer narrows the risk, it does not eliminate it.
- **Wordlist licensing is a gate, not an afterthought.** The source list must be permissively licensed (SCOWL-class permissive, MIT/BSD/Apache, or public domain). Hunspell dictionaries are frequently LGPL/MPL — copyleft, which `docs/LICENSING.md` promises this codebase does not contain; do not use them. Record the chosen source and its license in `vendor/VERSIONS.json` and `THIRD_PARTY_NOTICES.md` via the existing `make-notices` flow, same as any vendored library, and note it in `LICENSING.md`.
- Conversion-touching: full corpus re-score, same baseline as Task 1.

## Task 2 — Replace `window.prompt()` for PDF passwords

An inline modal in the app page (`src/app/`), replacing the `requestPassword` hook's `window.prompt` call.

- Batch behavior: a password-protected file must NOT stall the queue. Prompt once when the file is reached; "Skip" marks it failed-with-reason and the batch continues; wrong password re-prompts once per the existing retry hook.
- Keyboard accessible (focus trap, Enter submits, Esc skips), and it must work when the app tab is not focused (no reliance on `alert`-class APIs).
- Fixture: an encrypted PDF in `test/fixtures/`; harness case asserting correct password converts, skip marks failed and the next file still converts.

## Task 3 — Queue rendering at batch scale

`renderQueue()` rebuilds every row and re-attaches per-row listeners on each item completion — O(n²) DOM churn on the 50-file batches the pipeline is tuned for.

- One delegated click listener on `#queue`; rows appended once and patched in place (`updateQueueRow` already exists — make it the only path).
- Measure, don't assert: a synthetic 200-item batch, DOM operations or elapsed render time before/after, in the completion note.
- No visual behavior change: selection, working-row highlight, auto-scroll, batch label all identical. The harness's end-to-end case must still pass untouched.

## Task 4 — i18n scaffolding

`_locales/en/messages.json` + `chrome.i18n` for the manifest name/description and all user-facing strings in `popup.html`, `app.html`, and the JS-generated strings (toasts, errors, labels). English only this cycle — the point is that adding a locale later is a file, not a refactor.

- `npm run check` gains a rule: no hardcoded user-facing string regressions (a simple grep-based check on the HTML is fine; document its limits).
- Warning/marker strings that ship inside converted documents (`MDFORGE:` comments, `value not recovered`) are product output, not UI — they stay English and are explicitly excluded. List the exclusions in the note.

## Task 5 — Store submission packet

Everything the Web Store listing needs, generated into `store/`:

- Listing copy: name, 132-char summary, full description (source: README's "what it converts" and the privacy story — no superlatives, the "zero network requests, verifiable by inspection" claim is the headline).
- Permission justifications, one per manifest permission (README's table is the source; the store asks for these verbatim).
- Privacy disclosure: "no data collected" — confirm it against the current Web Store data-disclosure form categories, and cite the `npm run check` no-remote-loads enforcement.
- Screenshots: 1280×800, captured via the verify-extension harness driving a real conversion (the corpus is synthetic per the owner, so screenshots of it are fine). At minimum: drop zone, a mid-batch queue, a result with the review markers visible — the verification story is the differentiator, show it.
- A `store/CHECKLIST.md`: every current Web Store submission requirement, checked or explicitly N/A, verified against the current developer-console requirements (search the current docs — requirements change; do not work from memory).
- Final: version 1.4.0, CHANGELOG entry, `npm run check`, `npm run package`, and confirm the throwaway test-extension directory and `store/` sources are excluded from the zip.

---

## Order and gating

Task 1 first (it's the only conversion-touching task — get its corpus verdict locked before UI work). Tasks 2–4 in any order. Task 5 last, on a build containing everything else. Same authorization flow as last cycle: completion note in the DEVLOG per task, reviewer reads the repo directly.
