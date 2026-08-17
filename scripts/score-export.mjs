#!/usr/bin/env node
/**
 * Score already-converted Markdown against a ground-truth file.
 *
 * This needs no PDFs and no browser: it answers "does this export satisfy the
 * expectation set" for a batch someone already ran, which is the fastest way to
 * check a release against a real corpus.
 *
 *   node scripts/score-export.mjs <dir-of-md> <groundtruth.json>
 *
 * Reports, per document and in total: grand total, item count, per-item
 * (code, amount) attribution, whether a real table was emitted, and whether
 * anything was dropped without a marker.
 */

import fs from 'node:fs';
import path from 'node:path';

const [dir, truthPath] = process.argv.slice(2);
if (!dir || !truthPath) {
  console.error('Usage: node scripts/score-export.mjs <dir-of-md> <groundtruth.json>');
  process.exit(1);
}

const truth = JSON.parse(fs.readFileSync(truthPath, 'utf8'));
const documents = truth.documents || truth;
const money = (n) => `$${Number(n).toFixed(2)}`;
/** Compare amounts without caring about thousands separators. */
const flat = (s) => s.replace(/,/g, '');
const hasMoney = (text, n) => flat(text).includes(money(n));

const totals = {
  docs: 0,
  missing: 0,
  totalOk: 0,
  totalChecked: 0,
  itemsOk: 0,
  itemsChecked: 0,
  attributionOk: 0,
  attributionChecked: 0,
  tables: 0,
  aligned: 0,
  markers: 0,
  notRecovered: 0,
  lexicon: 0,
  headlineOk: 0,
  headlineMiss: 0,
  errorString: 0,
  errorStringChecked: 0,
  visualDisagreements: [],
};

/** The headline figure's label in this corpus's template. See its use below. */
const HEADLINE_LABEL = /Total Estimated Costs:/;

const rows = [];

for (const [id, doc] of Object.entries(documents)) {
  if (id === '_meta') continue;
  const name = (doc.source_file || '').replace(/\.pdf$/i, '') + '.md';
  const file = path.join(dir, name);
  totals.docs++;
  if (!fs.existsSync(file)) {
    totals.missing++;
    rows.push({ id, name, missing: true });
    continue;
  }
  const md = fs.readFileSync(file, 'utf8');
  const body = md.replace(/^---[\s\S]*?\n---\n/, '');
  const gold = doc.verification === 'visually_confirmed';

  const hasTable = /^\|.*\|$/m.test(body);
  const hasAligned = /^```/m.test(body);
  if (hasTable) totals.tables++;
  if (!hasTable && hasAligned) totals.aligned++;
  if (/SUMCHECK:/.test(body)) totals.markers++;
  /**
   * Marker populations are counted apart, because they mean different things
   * and one of them carries an invariant.
   *
   * "value not recovered" says a figure is missing, and the rule is that the
   * count equals the number of documents actually missing one. Lexicon flags
   * say a word looks wrong, and there is no such rule — one per document is a
   * healthy result. Summed into a single row they read as a broken invariant:
   * this scorer printed 50/50 the day the lexicon validator landed, which
   * looks exactly like 44 documents silently losing a value.
   */
  if (/SUMCHECK: value not recovered/.test(body)) totals.notRecovered++;
  if (/is not a recognised word/.test(body)) totals.lexicon++;

  /**
   * Did the prominent figure beside its own label survive?
   *
   * This is the population the marker invariant is about, and it is not the
   * same question as "does the total appear anywhere" — the total also sits in
   * the table row, so a document can lose its headline and still pass every
   * money check. Detecting it needs the label, and the label is a property of
   * this corpus's template, in the same way `#Error` already is above. Point
   * HEADLINE_LABEL at whatever the next corpus calls it.
   */
  if (typeof doc.expect_total === 'number' && HEADLINE_LABEL.test(body)) {
    const lines = body.split('\n');
    const at = lines.findIndex((l) => HEADLINE_LABEL.test(l));
    const wanted = `$${doc.expect_total.toFixed(2)}`.replace(/,/g, '');
    const found =
      at >= 0 && lines.slice(at, at + 4).some((l) => l.replace(/,/g, '').includes(wanted));
    if (found) totals.headlineOk++;
    else totals.headlineMiss++;
  }

  const findings = [];

  // 1. grand total
  if (typeof doc.expect_total === 'number') {
    totals.totalChecked++;
    const ok = hasMoney(body, doc.expect_total);
    if (ok) totals.totalOk++;
    else findings.push(`total ${money(doc.expect_total)} not found`);
  }

  // 2. line-item count — count distinct expected codes present
  const items = doc.expect_items || [];
  if (items.length) {
    totals.itemsChecked++;
    const present = items.filter((i) => body.includes(String(i.code)));
    if (present.length === items.length) totals.itemsOk++;
    else {
      findings.push(
        `codes missing: ${items.filter((i) => !body.includes(String(i.code))).map((i) => i.code).join(', ')}`
      );
    }

    // 3. attribution — is each amount on the same line as its code?
    for (const item of items) {
      totals.attributionChecked++;
      const line = body
        .split('\n')
        .find((l) => l.includes(String(item.code)) && hasMoney(l, item.amount));
      if (line) totals.attributionOk++;
      else if (body.includes(String(item.code))) {
        findings.push(`${item.code} not on the same row as ${money(item.amount)}`);
      }
    }
  }

  // 4. the #Error marker is content, not noise
  if (doc.expect_error_string) {
    totals.errorStringChecked++;
    if (body.includes('#Error')) totals.errorString++;
    else findings.push('#Error string missing');
  }

  // 5. address
  if (doc.address && !body.includes(doc.address)) findings.push(`address "${doc.address}" not found`);

  if (findings.length && gold) totals.visualDisagreements.push({ name, findings });
  rows.push({ id, name, gold, hasTable, hasAligned, findings });
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : 'n/a');

console.log(`Scored ${totals.docs} documents from ${path.resolve(dir)}\n`);
for (const row of rows) {
  if (row.missing) {
    console.log(`✗ ${row.name} — no converted file`);
    continue;
  }
  const mark = row.findings.length ? '!' : '✓';
  const tag = row.gold ? ' [visually confirmed]' : '';
  console.log(`${mark} ${row.name}${tag}${row.hasTable ? ' · table' : row.hasAligned ? ' · aligned block' : ' · no table'}`);
  for (const f of row.findings) console.log(`    ${f}`);
}

console.log(`
── summary ──────────────────────────────────────────────
grand totals matched      ${totals.totalOk}/${totals.totalChecked}   ${pct(totals.totalOk, totals.totalChecked)}
all line-item codes found ${totals.itemsOk}/${totals.itemsChecked}   ${pct(totals.itemsOk, totals.itemsChecked)}
amount on its code's row  ${totals.attributionOk}/${totals.attributionChecked}   ${pct(totals.attributionOk, totals.attributionChecked)}
#Error preserved          ${totals.errorString}/${totals.errorStringChecked}
documents with a table    ${totals.tables}/${totals.docs}
documents with an aligned block ${totals.aligned}/${totals.docs}
headline figure recovered ${totals.headlineOk}/${totals.headlineOk + totals.headlineMiss}
documents carrying any marker   ${totals.markers}/${totals.docs}
  value-not-recovered markers   ${totals.notRecovered}/${totals.docs}   ${totals.notRecovered === totals.headlineMiss ? 'OK' : 'MISMATCH'} — must equal the ${totals.headlineMiss} document(s) missing a headline
  prose lexicon flags           ${totals.lexicon}/${totals.docs}
missing conversions       ${totals.missing}`);

if (totals.notRecovered !== totals.headlineMiss) {
  console.log(
    `\n✗ marker invariant broken: ${totals.notRecovered} value-not-recovered marker(s) ` +
      `against ${totals.headlineMiss} document(s) actually missing a headline figure. ` +
      `Every miss must carry one and no recovered document may.`
  );
  process.exitCode = 1;
}

if (totals.visualDisagreements.length) {
  console.log(`
⚠ disagreements on visually-confirmed documents (weight these heavily):`);
  for (const d of totals.visualDisagreements) {
    console.log(`  ${d.name}: ${d.findings.join('; ')}`);
  }
}
