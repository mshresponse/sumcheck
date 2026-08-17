# Sumcheck — Rename, Relicense & Open-Source Work Order (v1.4.0 → v1.5.0)

**For:** the coding agent
**Owner decisions, all final:** the product is renamed **MDForge → Sumcheck**; MDForge's own code is relicensed **proprietary → Apache 2.0**; the repository is **published as open source on GitHub**. Rationale on record: "MDForge" collides with a same-pitch Windows app, a dental platform holding mdforge.com, a PyPI package, and an arXiv project; "Sumcheck" has zero product collisions and names the differentiator — the converter that checks the sums.

**Ground rules carry over** from the prior work orders: fixture-first where behavior changes, DEVLOG completion notes appended verbatim, both green gates (`npm test` + `verify-extension`) per task, no regressions on the corpus metrics, packaged-zip verification per Task 4 of the ship cycle.

---

## Task R1 — Rename, everywhere the name lives

- `_locales/en/messages.json`: `appName` → `Sumcheck — PDF & Document to Markdown`, `short_name` → `Sumcheck`, and every message containing "MDForge".
- `generatorString()` constant → `Sumcheck` (this changes the `generator:` line in emitted front matter — expected, note it; the five scored metrics are unaffected but run score-export once to confirm).
- **Product-output markers stay recognizable but move to the new name**: `MDFORGE:` comment markers → `SUMCHECK:`. This IS conversion-touching — update the emitters, the scorer's marker parsing, `score-export`, the audit runner, and every fixture that asserts marker text, then run the full corpus re-score. The marker invariant (markers == misses, 6/6) must hold under the new prefix.
- `package.json` name → `sumcheck`; `dist/` artifact naming; README, CHANGELOG header note, docs/ (STATUS, LICENSING, work orders may keep historical mentions — add one line at the top of STATUS noting the rename and date).
- All UI strings, page `<title>`s, popup/app headers, dev-server titles.
- `verify-extension.mjs` expected-name assertions → the new localized name.
- Case sweep: `grep -ri "mdforge" --include="*.{js,mjs,json,html,css,md}"` and disposition every hit — rename, or justify as historical record (DEVLOG/CHANGELOG/old work orders are historical; leave them).
- **Do NOT rename the repository root folder on disk** (`~/mdforge`) — the owner's review tooling is bound to that path. The GitHub repository (Task R3) is named `sumcheck`; the local folder can be renamed later by the owner.
- **New mark**: the logo becomes Σ-in-rounded-square with a green check badge (see `store/tile.svg`, committed by the reviewer, for the reference rendering). Update `scripts/make-icons.mjs` to draw it at 16/32/48/128, keeping the existing accent palette. The 128px store icon needs 96×96 artwork with 16px transparent padding per store spec.
- Regenerate screenshots via the harness (they show the old name in the header).
- Version → **1.5.0** in both manifests. CHANGELOG entry: rename, relicense, open-sourcing — with the collision rationale in one paragraph so the history explains itself.

## Task R2 — Relicense to Apache 2.0

- Replace `LICENSE` with the verbatim Apache License 2.0 text; copyright line `Copyright 2026 Michael Hintze`.
- Add a `NOTICE` file per Apache convention: product name, copyright, one line pointing at `THIRD_PARTY_NOTICES.md`.
- Update `docs/LICENSING.md`'s own-code section: it currently documents the proprietary stance and "replace before publishing" — that instruction is now executed; describe the Apache 2.0 grant and note the trademark non-grant (§6) is deliberate: forks get the code, not the name.
- README gains a License section; the store listing's "permissively licensed" line now covers Sumcheck's own code too — update `store/LISTING.md` accordingly, and add the GitHub URL to the listing ("verifiable by inspection" now links to the actual source).
- `npm run package` must include `LICENSE` and `NOTICE` in the zip (update `package-contents.mjs`; the check will enforce it).

## Task R3 — Publish as open source

- `git init` if no repository exists; verify `.gitignore` excludes `vendor/`, `dist/`, audit artifacts (it does — confirm nothing PHI-shaped or corpus-derived is tracked; `test/fixtures/callout-page.png` is synthetic per owner ruling and ships).
- One initial commit with a clean message. Do not rewrite the DEVLOG for publication — it is the project's honest record and that is the point.
- Create the public GitHub repository **`sumcheck`** under the owner's account. **This needs the owner's GitHub authentication** (`gh auth login`) — stop and ask him to authenticate rather than working around it; do not create it under any other account.
- Push; enable **GitHub Pages** serving `store/privacy-policy/` (or copy it to `docs/privacy/` if Pages-from-subfolder is cleaner) so the privacy policy gets its required public URL. Record the final URL in `store/CHECKLIST.md` — that closes the last open checklist item that was blocking submission.
- Add minimal `CONTRIBUTING.md` (run `npm run build`, the two test gates, fixture-first rule, DEVLOG convention) and `SECURITY.md` (report privately to mike@everythingvirtually.com).
- Add the repo URL to README, the store listing, and the privacy page footer.

## Task R4 — Final gates on the renamed build

- `npm test`, `verify-extension` (new name asserted, packaged zip installed), `npm run check`, `npm run package` → `dist/sumcheck-1.5.0.zip`.
- Full corpus re-score under the new marker prefix: all five metrics at baseline, markers == misses asserted by the scorer, lexicon flags 50/50.
- Confirm the zip contains `LICENSE`, `NOTICE`, `_locales`, new icons — and none of the excluded sets.
- DEVLOG completion note per the reporting format, including the grep disposition list from R1.

Order: R1 → R2 → R3 → R4. R3's GitHub step will pause for owner authentication — batch every question you have for him into that single pause.
