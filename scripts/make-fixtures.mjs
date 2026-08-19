#!/usr/bin/env node
/**
 * Builds the test fixtures in test/fixtures/.
 *
 * The PDF, XLSX, PPTX and EPUB are assembled byte-by-byte so the suite has
 * known-good input with known-correct expected output; DOCX/RTF/ODT come from
 * macOS `textutil` when it is available.
 *
 *   node scripts/make-fixtures.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'test', 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), data);
  console.log(`  test/fixtures/${name}  ${(fs.statSync(path.join(OUT, name)).size / 1024).toFixed(1)} KB`);
};


/* --------------------------------------------------------- encrypted PDF */

/**
 * A password-protected PDF, so the password path has something real to run on.
 *
 * Built here rather than vendored because no encryption tool is guaranteed on
 * the machine (`qpdf`, `mutool` and `pdftk` are all absent on a stock Mac), and
 * a fixture nobody can regenerate is a fixture that rots.
 *
 * Standard security handler, V1/R2 (RC4, 40-bit). Weak by design and entirely
 * appropriate: the point is to make pdf.js ask for a password, not to protect
 * anything. Anything stronger would be more code for an identical test.
 */
const PDF_PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const md5 = (...parts) => createHash('md5').update(Buffer.concat(parts)).digest();

function rc4(key, data) {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]) & 0xff;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 0xff];
  }
  return out;
}

const padPassword = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PDF_PAD]).slice(0, 32);

function buildEncryptedPdf(userPassword, ownerPassword) {
  const id = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
  const permissions = -1; // every permission granted; the password is the point
  const pBuf = Buffer.alloc(4);
  pBuf.writeInt32LE(permissions, 0);

  const ownerEntry = rc4(md5(padPassword(ownerPassword)).slice(0, 5), padPassword(userPassword));
  const key = md5(padPassword(userPassword), ownerEntry, pBuf, id).slice(0, 5);
  const userEntry = rc4(key, PDF_PAD);

  /** Per-object key: the file key salted with the object and generation number. */
  const objectKey = (num, gen) =>
    md5(
      key,
      Buffer.from([num & 0xff, (num >> 8) & 0xff, (num >> 16) & 0xff, gen & 0xff, (gen >> 8) & 0xff])
    ).slice(0, Math.min(key.length + 5, 16));

  const content = Buffer.from(
    'BT /F1 20 Tf 60 700 Td (Locked document) Tj ET\n' +
      'BT /F1 12 Tf 60 660 Td (The password for this fixture is: secret) Tj ET\n' +
      'BT /F1 12 Tf 60 640 Td (If you can read this, the password path works.) Tj ET'
  );
  const encryptedContent = rc4(objectKey(5, 0), content);

  const hex = (b) => '<' + b.toString('hex') + '>';
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
        '/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>'
    ),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.concat([
      Buffer.from(`<< /Length ${encryptedContent.length} >>\nstream\n`),
      encryptedContent,
      Buffer.from('\nendstream'),
    ]),
    Buffer.from(
      `<< /Filter /Standard /V 1 /R 2 /O ${hex(ownerEntry)} /U ${hex(userEntry)} /P ${permissions} >>`
    ),
  ];

  const chunks = [Buffer.from('%PDF-1.4\n')];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const obj = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')]);
    chunks.push(obj);
    offset += obj.length;
  });

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 6 0 R ` +
    `/ID [${hex(id)} ${hex(id)}] >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref));

  return Buffer.concat(chunks);
}


/* ------------------------------------------------- field/details reference */

/**
 * A synthetic object-reference page in the shape that broke us.
 *
 * Modelled on page 600 of the Net Zero Cloud Developer Guide (issue #4), which
 * is 7.6 MB and lives outside the repository — this reproduces the *structure*
 * with invented values, per the fixture-first rule in CONTRIBUTING.
 *
 * The structure is the point. Each `Details` cell holds its own definition
 * list: a label on one line, its value indented beneath. We flatten that into
 * run-on text (issue #1). Three pages carry a repeating running head and an
 * incrementing folio, which is the other half of the fixture (issue #2) — a
 * folio never repeats, so a repetition-based stripper cannot see it.
 */
function buildFieldDetailsPdf() {
  const esc = (s) => s.replace(/([()\\])/g, '\\$1');
  const line = (font, size, x, y, text) =>
    `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj ET`;

  const FIELD_X = 60;      // column 1
  const LABEL_X = 210;     // column 2, the definition label
  const VALUE_X = 236;     // column 2, indented value — the signal that is lost
  const TOP = 700;
  const STEP = 15;

  /** One field's block: its name, then label/value pairs indented under it. */
  function block(name, pairs, startY) {
    const out = [line('F1', 10, FIELD_X, startY, name)];
    let y = startY;
    for (const [label, ...values] of pairs) {
      out.push(line('F1', 10, LABEL_X, y, label));
      for (const value of values) {
        y -= STEP;
        out.push(line('F1', 10, VALUE_X, y, value));
      }
      y -= STEP;
    }
    return { ops: out, endY: y };
  }

  function page(number, folio, headSuffix, blocks) {
    const ops = [
      // The head's left half repeats and its right half names the object on
      // this page. That pairing is what defeats a whole-line repetition test,
      // so the fixture has to carry it — an identical head is already stripped
      // and would prove nothing.
      line('F1', 9, FIELD_X, 742, `Standard Objects Reference ${headSuffix}`),
      line('F2', 10, FIELD_X, 720, 'Field'),
      line('F2', 10, LABEL_X, 720, 'Details'),
    ];
    let y = TOP;
    for (const [name, pairs] of blocks) {
      const built = block(name, pairs, y);
      ops.push(...built.ops);
      y = built.endY - STEP;
    }
    // 599-601 crosses a decade on purpose: a rule that mis-reads the
    // leading digit sees 99, 0, 1 and cannot call that a sequence.
    ops.push(line('F1', 9, 300, 46, String(folio)));
    // A chrome-band line that appears on exactly one page. Repetition is the
    // licence to strip; without it, this must survive.
    if (number === 2) ops.push(line('F1', 9, FIELD_X, 62, 'Draft for internal review only'));
    return ops.join('\n');
  }

  const pages = [
    page(1, 599, 'RentalCarCompanyName', [
      ['RentalCarCompanyName', [
        ['Type', 'string'],
        ['Properties', 'Create, Filter, Group, Nillable, Sort, Update'],
        ['Description', 'The name of the rental car company.'],
      ]],
    ]),
    page(2, 600, 'RentalCarEmssnFctr', [
      ['RentalCarEmssnFctrId', [
        ['Type', 'reference'],
        ['Properties', 'Create, Filter, Group, Nillable, Sort, Update'],
        ['Description', 'The reference data that contains the rental car emission factors.'],
        ['Relationship Name', 'RentalCarEmssnFctr'],
        ['Relationship Type', 'Lookup'],
        ['Refers To', 'RentalCarEmssnFctr'],
      ]],
    ]),
    // The page the regression is measured on — the five fields from issue #4.
    page(3, 601, 'Scope3EnrgyUse', [
      ['Scope3EmssnSrcId', [
        ['Type', 'reference'],
        ['Properties', 'Create, Filter, Group, Sort, Update'],
        ['Description', 'The scope 3 emission source for this energy use record.'],
        ['Relationship Name', 'Scope3EmssnSrc'],
        ['Relationship Type', 'Lookup'],
        ['Refers To', 'Scope3EmssnSrc'],
      ]],
      ['Scope3GhgCategory', [
        ['Type', 'picklist'],
        ['Properties', 'Create, Filter, Group, Nillable, Restricted picklist, Sort'],
        ['Description', 'Specifies the scope 3 GHG category for the energy use.'],
        ['Possible values are', '\x95 BusinessTravel', '\x95 EmployeeCommuting'],
      ]],
      ['StartDate', [
        ['Type', 'date'],
        ['Properties', 'Create, Filter, Group, Nillable, Sort, Update'],
        ['Description', 'The date from when the values of this record are valid.'],
      ]],
      ['SuplScope3Emissions', [
        ['Type', 'double'],
        ['Properties', 'Create, Filter, Nillable, Sort, Update'],
        ['Description', 'The supplemental scope 3 emissions value that is added.'],
      ]],
      ['SupplierId', [
        ['Type', 'reference'],
      ]],
    ]),
  ];

  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  add('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const content of pages) {
    const contentObj = objects.length + 2;
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${3 + pages.length * 2} 0 R /F2 ${4 + pages.length * 2} 0 R >> >> ` +
        `/Contents ${contentObj} 0 R >>`
    );
    add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  }
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add('<< /Title (Object Reference) /Creator (Sumcheck fixtures) >>');

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/* ------------------------------------------------------------------- PDF */

function buildPdf() {
  const esc = (s) => s.replace(/([()\\])/g, '\\$1');
  const line = (font, size, x, y, text) =>
    `BT /${font} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${esc(text)}) Tj ET`;

  const page1 = [
    line('F2', 24, 72, 730, 'Quarterly Field Report'),
    line('F1', 11, 72, 700, 'Prepared by the Operations team for internal distribution.'),
    line('F2', 16, 72, 660, 'Summary of Findings'),
    line('F1', 11, 72, 636, 'Throughput rose across every region during the quarter, with the'),
    line('F1', 11, 72, 622, 'largest gains recorded in the eastern corridor. Latency remained'),
    line('F1', 11, 72, 608, 'flat despite the additional load.'),
    // 0x95 is BULLET in WinAnsiEncoding; a literal U+2022 would be mangled by
    // the latin1 serialization below.
    line('F1', 11, 72, 578, '\x95 Eastern corridor exceeded its target by eleven percent.'),
    line('F1', 11, 72, 562, '\x95 Western corridor met target with no incidents.'),
    line('F1', 11, 72, 546, '\x95 Northern corridor remains under review.'),
    line('F2', 16, 72, 506, 'Regional Results'),
    // A grid-aligned block that should be reconstructed as a table.
    line('F2', 11, 72, 480, 'Region'),
    line('F2', 11, 220, 480, 'Volume'),
    line('F2', 11, 340, 480, 'Change'),
    line('F1', 11, 72, 462, 'East'),
    line('F1', 11, 220, 462, '18,420'),
    line('F1', 11, 340, 462, '+11%'),
    line('F1', 11, 72, 444, 'West'),
    line('F1', 11, 220, 444, '12,905'),
    line('F1', 11, 340, 444, '+2%'),
    line('F1', 11, 72, 426, 'North'),
    line('F1', 11, 220, 426, '7,310'),
    line('F1', 11, 340, 426, '-4%'),
    // Split into two runs so the link annotation covers only the URL — the
    // realistic case, and the one that proves link text is isolated correctly.
    line('F1', 11, 72, 386, 'Full methodology is published at '),
    line('F1', 11, 233, 386, 'example.com/methodology'),
    line('F1', 9, 72, 60, 'Field Report  |  Page 1 of 2'),
  ].join('\n');

  const page2 = [
    line('F2', 16, 72, 730, 'Recommendations'),
    line('F1', 11, 72, 706, 'Three changes are proposed for the coming quarter. Each has been'),
    line('F1', 11, 72, 692, 'costed and reviewed by the regional leads.'),
    line('F1', 11, 72, 662, '1. Extend the eastern corridor pilot by two months.'),
    line('F1', 11, 72, 646, '2. Retire the legacy routing table in the west.'),
    line('F1', 11, 72, 630, '3. Commission an audit of northern throughput.'),
    line('F2', 16, 72, 590, 'Risks'),
    line('F1', 11, 72, 566, 'The northern review may extend past the reporting window, which'),
    line('F1', 11, 72, 552, 'would delay consolidated figures by up to three weeks.'),
    line('F1', 9, 72, 60, 'Field Report  |  Page 2 of 2'),
  ].join('\n');

  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  const catalog = add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>');
  add(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 4 0 R /Annots [9 0 R] >>'
  );
  add(`<< /Length ${page1.length} >>\nstream\n${page1}\nendstream`);
  add(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R /F2 8 0 R >> >> /Contents 6 0 R >>'
  );
  add(`<< /Length ${page2.length} >>\nstream\n${page2}\nendstream`);
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  add(
    '<< /Type /Annot /Subtype /Link /Rect [233 383 350 397] /Border [0 0 0] /A << /S /URI /URI (https://example.com/methodology) >> >>'
  );
  const info = add(
    '<< /Title (Quarterly Field Report) /Author (Operations Team) /Creator (Sumcheck fixtures) /CreationDate (D:20260401120000Z) >>'
  );

  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/* ------------------------------------------------------- zip-based formats */

function zipDir(dir, outFile, { mimetypeFirst = false } = {}) {
  const abs = path.join(OUT, outFile);
  fs.rmSync(abs, { force: true });
  if (mimetypeFirst) {
    execFileSync('zip', ['-q', '-X', '-0', abs, 'mimetype'], { cwd: dir });
    execFileSync('zip', ['-q', '-X', '-r', abs, '.', '-x', 'mimetype'], { cwd: dir });
  } else {
    execFileSync('zip', ['-q', '-X', '-r', abs, '.'], { cwd: dir });
  }
}

function scratch(name) {
  const dir = path.join(OUT, '.build', name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const put = (dir, rel, content) => {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

const CONTENT_TYPES = (overrides) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
${overrides}
</Types>`;

function buildXlsx() {
  const dir = scratch('xlsx');
  put(dir, '[Content_Types].xml', CONTENT_TYPES(
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`
  ));
  put(dir, '_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  put(dir, 'xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="Revenue" sheetId="1" r:id="rId1"/>
<sheet name="Notes" sheetId="2" r:id="rId2"/>
</sheets>
</workbook>`);
  put(dir, 'xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);

  const strings = ['Quarter', 'Region', 'Revenue', 'Closed', 'Q1', 'East', 'West', 'Margin held at 42%.'];
  put(dir, 'xl/sharedStrings.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">
${strings.map((s) => `<si><t>${s}</t></si>`).join('')}
</sst>`);

  // style 1 = date (numFmtId 14), style 2 = percent (custom 164)
  put(dir, 'xl/styles.xml', `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>
<cellXfs count="3">
<xf numFmtId="0"/>
<xf numFmtId="14" applyNumberFormat="1"/>
<xf numFmtId="164" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`);

  put(dir, 'xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c></row>
<row r="2"><c r="A2" t="s"><v>4</v></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>18420.5</v></c><c r="D2" s="1"><v>45383</v></c></row>
<row r="3"><c r="A3" t="s"><v>4</v></c><c r="B3" t="s"><v>6</v></c><c r="C3"><v>12905</v></c><c r="D3" s="1"><v>45384</v></c></row>
<row r="4"><c r="A4" t="str"><v>Total</v></c><c r="C4"><v>31325.5</v></c><c r="D4" s="2"><v>0.421</v></c></row>
</sheetData>
</worksheet>`);
  put(dir, 'xl/worksheets/sheet2.xml', `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData><row r="1"><c r="A1" t="s"><v>7</v></c></row></sheetData>
</worksheet>`);

  zipDir(dir, 'sample.xlsx');
}

function buildPptx() {
  const dir = scratch('pptx');
  put(dir, '[Content_Types].xml', CONTENT_TYPES(
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/notesSlides/notesSlide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
  ));
  put(dir, '_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  put(dir, 'ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<p:sldIdLst><p:sldId id="256" r:id="rId1"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst>
</p:presentation>`);
  put(dir, 'ppt/_rels/presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`);

  const slide = (title, bullets, extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:txBody><a:bodyPr/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:txBody><a:bodyPr/>
${bullets
  .map(
    (b, i) =>
      `<a:p><a:pPr lvl="${b.startsWith('  ') ? 1 : 0}"/><a:r><a:rPr b="${i === 0 ? 1 : 0}"/><a:t>${b.trim()}</a:t></a:r></a:p>`
  )
  .join('')}
</p:txBody></p:sp>
${extra}
</p:spTree></p:cSld></p:sld>`;

  const table = `<p:graphicFrame><a:graphic><a:graphicData>
<a:tbl>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Metric</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>Value</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
<a:tr><a:tc><a:txBody><a:p><a:r><a:t>Uptime</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>99.98%</a:t></a:r></a:p></a:txBody></a:tc></a:tr>
</a:tbl>
</a:graphicData></a:graphic></p:graphicFrame>`;

  put(dir, 'ppt/slides/slide1.xml', slide('Platform Review', ['Headline numbers', '  Traffic up 18%', '  Errors down 40%']));
  put(dir, 'ppt/slides/slide2.xml', slide('Reliability', ['Service level held all quarter'], table));
  put(dir, 'ppt/slides/_rels/slide1.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`);
  put(dir, 'ppt/notesSlides/notesSlide1.xml', `<?xml version="1.0" encoding="UTF-8"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Remember to mention the migration window.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>`);

  zipDir(dir, 'sample.pptx');
}

function buildEpub() {
  const dir = scratch('epub');
  put(dir, 'mimetype', 'application/epub+zip');
  put(dir, 'META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  put(dir, 'OEBPS/content.opf', `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>The Small Book of Conversions</dc:title>
<dc:creator>A. Writer</dc:creator>
<dc:language>en</dc:language>
</metadata>
<manifest>
<item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`);
  put(dir, 'OEBPS/chapter1.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>
<h1>Chapter One</h1>
<p>It began, as these things do, with a <em>malformed</em> document.</p>
<p>The second paragraph explains nothing at all.</p>
</body></html>`);
  put(dir, 'OEBPS/chapter2.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Two</title></head><body>
<h1>Chapter Two</h1>
<ul><li>First point</li><li>Second point</li></ul>
</body></html>`);
  zipDir(dir, 'sample.epub', { mimetypeFirst: true });
}

/* --------------------------------------------------------------- textutil */

function buildWithTextutil() {
  const sourceHtml = `<html><head><title>Field Notes</title></head><body>
<h1>Field Notes</h1>
<p>A short document with <b>bold</b> and <i>italic</i> text.</p>
<h2>Observations</h2>
<ul><li>The first observation.</li><li>The second observation.</li></ul>
<p>Closing remark.</p>
</body></html>`;
  const src = path.join(OUT, '.build', 'source.html');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, sourceHtml);

  for (const format of ['docx', 'rtf', 'odt']) {
    try {
      execFileSync('textutil', ['-convert', format, '-output', path.join(OUT, `sample.${format}`), src], {
        stdio: 'ignore',
      });
      console.log(`  test/fixtures/sample.${format}`);
    } catch {
      console.warn(`  ! textutil could not produce .${format} — skipped`);
    }
  }
}

/* ------------------------------------------------------------------- main */

write('sample.pdf', buildPdf());
write('locked.pdf', buildEncryptedPdf('secret', 'owner-secret'));
write('field-details.pdf', buildFieldDetailsPdf());

/**
 * A zip on disk, so the UI can be driven with one. The harness builds its own
 * in memory for the conversion test; this exists because expansion splices
 * children into the middle of the queue, and that ordering is only observable
 * through the rendered list.
 */
{
  const dir = scratch('bundle');
  fs.writeFileSync(path.join(dir, 'alpha.md'), '# Alpha\n\nFirst member.\n');
  fs.writeFileSync(path.join(dir, 'beta.md'), '# Beta\n\nSecond member.\n');
  fs.writeFileSync(path.join(dir, 'gamma.csv'), 'a,b\n1,2\n');
  zipDir(dir, 'bundle.zip');
  console.log(`  test/fixtures/bundle.zip  ${(fs.statSync(path.join(OUT, 'bundle.zip')).size / 1024).toFixed(1)} KB`);
}
buildXlsx();
console.log('  test/fixtures/sample.xlsx');
buildPptx();
console.log('  test/fixtures/sample.pptx');
buildEpub();
console.log('  test/fixtures/sample.epub');
buildWithTextutil();

write(
  'sample.csv',
  'Region,Volume,Change\nEast,18420,+11%\nWest,"12,905",+2%\nNorth,7310,-4%\n'
);
write(
  'sample.md',
  '---\ntitle: Existing Front Matter\n---\n\n# Heading\n\nA paragraph with a [link](https://example.com) and `code`.\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
);
write(
  'sample.html',
  `<!doctype html><html><head><title>Article Title</title>
<meta name="author" content="Jane Reporter">
<meta name="description" content="A test article."></head>
<body><nav><a href="/">Home</a><a href="/about">About</a></nav>
<article><h1>Article Title</h1>
<p>The opening paragraph is long enough that Readability will treat this element as the main content of the page rather than discarding it as boilerplate chrome, which is what we want to verify here.</p>
<h2>A subheading</h2><p>More body text follows, with a <a href="/relative/link">relative link</a> and an <strong>emphasis</strong>.</p>
<table><tr><th>Key</th><th>Value</th></tr><tr><td>alpha</td><td>1</td></tr></table>
</article><footer>Copyright notice</footer></body></html>`
);
write(
  'sample.json',
  JSON.stringify(
    [
      { id: 1, name: 'East', volume: 18420 },
      { id: 2, name: 'West', volume: 12905 },
      { id: 3, name: 'North', volume: 7310 },
    ],
    null,
    2
  )
);
write(
  'sample.srt',
  '1\n00:00:01,000 --> 00:00:04,000\nWelcome back to the show.\n\n2\n00:00:04,200 --> 00:00:07,000\nToday we are talking about\nfile conversion.\n\n3\n00:01:02,000 --> 00:01:05,000\nThat is all for now.\n'
);
write(
  'sample.ipynb',
  JSON.stringify(
    {
      cells: [
        { cell_type: 'markdown', source: ['# Notebook\n', '\n', 'Some **markdown**.'] },
        {
          cell_type: 'code',
          source: ['print("hello")'],
          outputs: [{ output_type: 'stream', name: 'stdout', text: ['hello\n'] }],
        },
      ],
      metadata: { language_info: { name: 'python' } },
      nbformat: 4,
    },
    null,
    1
  )
);

fs.rmSync(path.join(OUT, '.build'), { recursive: true, force: true });
console.log('\n✓ fixtures ready');
