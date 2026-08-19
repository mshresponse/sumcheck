# Sumcheck v1.7.0 — Language Cycle Work Order (Spanish, Portuguese, French)

**For:** the coding agent
**Owner decisions:** ship OCR + lexicon support for **Spanish, Portuguese, French** alongside English, all bundled in the package (the no-network promise means nothing is ever downloaded later). German/Italian deferred. Locale-aware number handling for the arithmetic validators is in scope; it is the substance of this cycle, not a rider.

**Ground rules carry over:** fixture-first, DEVLOG completion notes per task, both gates green per task, full corpus re-score on conversion-touching tasks with all five metrics at baseline, marker invariant (markers == misses) throughout. Nothing touches the Chrome Web Store; `dist/sumcheck-1.6.0.zip` is the pending-release artifact and must not be rebuilt or overwritten at any point in this cycle — L0 exists to make that structurally impossible.

## L0 — Version bump FIRST, to protect the pending artifact

Bump both manifests to **1.7.0-dev** before any other change. Lesson from the last cycle: the packaging gate rebuilds `dist/sumcheck-<version>.zip` on every run, which silently overwrote the 1.5.0 artifact. With the bump first, every mid-cycle package lands in `sumcheck-1.7.0-dev.zip` and `sumcheck-1.6.0.zip` stays pristine for its eventual upload. The final task renames to 1.7.0 proper. If `-dev` in the version string trips any gate assertion, fix the assertion, not the version.

## L1 — OCR language support

- Vendor `spa`, `por`, `fra` tessdata_fast models via `fetch-vendor.mjs` (pinned URLs + hashes, same as `eng`). Record each file's exact size in the DEVLOG.
- UI: a document-language selector in options and on the conversion surface — `English (default) / Español / Português / Français`. Explicit selection only in this cycle; do NOT build auto-detection (a wrong auto-guess silently degrades OCR, which violates the never-silently-wrong principle — if detection is ever added it must be a suggestion, not a decision).
- The selected language routes to the OCR engine per conversion. Existing English behavior byte-identical when English is selected — assert that with a fixture, since it is the regression that matters most.
- Accented characters must survive the full pipeline: OCR → HTML → sanitize → emitters → front matter. One fixture per language: a synthetic scanned page with accents/diacritics (ñ, ç, ã, é, œ) in headings, table cells, and amounts.

## L2 — Lexicons for the prose validator

- Frequency-trimmed word lists for es/pt/fr, same shape as English (main list + frequency-ordered common list), same suggest-never-rewrite contract, sourced from permissively licensed lists (record license + provenance in THIRD_PARTY_NOTICES.md).
- The lexicon used follows the selected document language. Trim targets: comparable coverage to the English pair; record raw and zipped sizes.
- Fixture per language: a misread that produces a non-word (the "inchided" class) gets flagged with a suggestion; a correctly read accented word does NOT get flagged. The false-positive direction is the one that erodes trust — assert it explicitly.

## L3 — Locale-aware numbers for the arithmetic validators (the heart of the cycle)

The sum check, currency-symbol check, and headline check currently assume `$1,234.56`. Real documents in these languages use, variously: `1.234,56 €` (ES/PT-EU), `1 234,56 €` (FR, space-grouped), `R$ 1.234,56` (BR), `$1,234.56` (MX and much of LatAm), symbol before or after, with or without a space.

- **Detect the convention per document, not per language.** A Mexican estimate in Spanish uses US-style numbers; language is evidence, not proof. Detection evidence: which pattern the document's amounts consistently match. On ambiguity (a document whose amounts parse validly both ways), the validators must DECLINE to flag rather than guess — a wrong "sums don't match" flag on a correct document is the failure mode that kills credibility. Count and report declined documents in the scorer output.
- Currency-symbol check generalizes from `$` to the document's detected sigil set (`$`, `€`, `R$`, `£`) including position (before/after).
- Fixtures: a synthetic estimate per convention (EU-comma, FR-space, BR, US) where (a) sums that match are not flagged, (b) a planted mismatch IS flagged, (c) an amount missing its symbol is flagged. Plus one deliberately ambiguous document asserting the decline path.
- Date formats: where dates are parsed or normalized anywhere in the pipeline, DD/MM orderings must not be mangled; if dates are currently passed through untouched, state that in the note and add nothing.
- Full corpus re-score: the 50 US-format GFEs must be entirely unmoved — US detection must be rock solid before any other convention matters.

## L4 — UI localization

- `_locales/es`, `_locales/pt`, `_locales/fr` message files covering all current messages (115 at last count; no empty messages, verify-extension count assertions updated). Translate faithfully; where a term is load-bearing ("value not recovered", the review-marker language), keep the translation literal rather than idiomatic and flag any you are unsure of in the DEVLOG for owner review.
- Store-listing translations are NOT in scope (owner decision later).

## L5 — Size report, gates, release

- Measured size table in the DEVLOG: package zip before/after, per-language breakdown (model + lexicon + messages), unpacked size. This replaces the reviewer's 13–15 MB estimate with facts.
- Version → **1.7.0** (drop `-dev`) in both manifests. CHANGELOG entry.
- Full gates: `npm run check`, `npm test`, `verify-extension` against the packaged 1.7.0 zip, full corpus re-score, marker invariant, lexicon 50/50 on English.
- `dist/sumcheck-1.7.0.zip` built. Confirm `dist/sumcheck-1.6.0.zip` is byte-identical to its state at cycle start (record its SHA-256 in the L0 note and re-verify here).
- Nothing uploaded to the Web Store.

Order: L0 → L1 → L2 → L3 → L4 → L5. Stop and report after L3 — it is the conversion-touching risk center of the cycle; L4/L5 proceed after review.
