'use strict';
const assert = require('assert');
const { clean, toMarkdown, toCSV, toTSV, toJSON, toAPA, toMLA } = require('./public/tidy-core.js');

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok - ' + name);
  } catch (e) {
    console.error('  FAIL - ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

// 1. Spec's own example: quoted commas survive, mixed separators detected
t('quoted comma stays one field', () => {
  const r = clean('Name, Age  Score\nJohn Smith,34   "9,5"\n"Doe, Jane" 29 8.7');
  assert.deepStrictEqual(r.rows[0], ['Name', 'Age', 'Score']);
  assert.deepStrictEqual(r.rows[1], ['John Smith', '34', '9,5']);
  assert.strictEqual(r.rows[2][0], 'Doe, Jane');
});

// 2. Escaped quotes
t('"" escape yields literal quote', () => {
  const r = clean('a,b\n"x,y",2\nc,d');
  assert.strictEqual(r.rows[1][0], 'x,y');
});

t('"a""b" inside quotes -> a"b', () => {
  const r = clean('h1,h2\n"a""b",1\n"c",2');
  assert.strictEqual(r.rows[1][0], 'a"b');
});

// 3. Unterminated quote: no crash, warning emitted
t('unterminated quote warns, keeps cell', () => {
  const r = clean('h1,h2\n"x,1\nc,2');
  assert.ok(r.warnings.some(w => w.code === 'UNTERMINATED_QUOTE'));
});

// 4. Tab beats comma when a stray sentence has commas (variance win)
t('tab-delimited wins over noisy commas', () => {
  const input = 'Name\tAge\tScore\nAlice\t30\t91\nBob had, a comma sentence\t25\t88\nCarol\t28\t95';
  const r = clean(input);
  assert.strictEqual(r.delimiter, '\t');
  assert.strictEqual(r.rows[2][0], 'Bob had, a comma sentence');
});

// 5. Pipe table with markdown separator row dropped
t('markdown pipe separator row dropped', () => {
  const r = clean('| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.strictEqual(r.rows.length, 3);
  assert.deepStrictEqual(r.rows[0], ['A', 'B']);
});

// 6. CRLF parses identically to LF
t('CRLF handled', () => {
  const lf = clean('a,b\nc,d');
  const crlf = clean('a,b\r\nc,d');
  assert.deepStrictEqual(lf.rows, crlf.rows);
});

// 7. All-numeric first row -> no header
t('numeric first row -> hasHeader false', () => {
  const r = clean('1,2\n3,4');
  assert.strictEqual(r.hasHeader, false);
  const j = JSON.parse(toJSON(r.rows, r.hasHeader));
  assert.deepStrictEqual(Object.keys(j[0]), ['Column 1', 'Column 2']);
});

// 8. Ragged short row padded + warning
t('short row padded with warning naming the row', () => {
  const r = clean('a,b,c\n1,2\nx,y,z');
  assert.deepStrictEqual(r.rows[1], ['1', '2', '']);
  const w = r.warnings.find(w => w.code === 'RAGGED_PADDED');
  assert.ok(w && w.message.includes('Row 2'));
});

// 9. Long outlier row truncated + warning (modal = majority length)
t('long outlier row truncated with warning', () => {
  const r = clean('a,b,c\n1,2,3\nx,y,z\n9,8,7,6,5');
  assert.strictEqual(r.rows[3].length, 3);
  assert.ok(r.warnings.some(w => w.code === 'RAGGED_TRUNCATED' && w.rowIndex === 3));
});

// 9b. Ambiguous tie (one short, one long): pad — never silently drop data
t('tie between lengths pads the shorter row', () => {
  const r = clean('a,b,c\n1,2,3,4');
  assert.deepStrictEqual(r.rows[0], ['a', 'b', 'c', '']);
  assert.ok(r.warnings.some(w => w.code === 'RAGGED_PADDED' && w.rowIndex === 0));
});

// 10. Whitespace-run fallback for PDF-style spacing
t('whitespace-run fallback works', () => {
  const r = clean('Name     Age    Score\nJohn     34     9.5\nJane     29     8.7');
  assert.strictEqual(r.delimiter, 'ws');
  assert.deepStrictEqual(r.rows[0], ['Name', 'Age', 'Score']);
});

// 11. Empty lines dropped; empty input safe
t('empty lines and empty input', () => {
  assert.deepStrictEqual(clean('a,b\n\n\nc,d').rows.length, 2);
  assert.deepStrictEqual(clean('').rows, []);
});

// 12. Round-trip: CSV out -> re-parse -> same rows
t('CSV round-trip preserves data', () => {
  const src = [['name', 'note'], ['Smith, John', 'said "hi"']];
  const csv = toCSV(src);
  const back = clean(csv).rows;
  assert.deepStrictEqual(back, src);
});

// 13. Markdown escaping: pipe in cell doesn't break table
t('markdown escapes pipes in cells', () => {
  const md = toMarkdown([['a|b'], ['c']]);
  assert.ok(md.includes('a\\|b'));
  assert.match(md.split('\n')[1], /^\|-+\|$/); // separator row intact
});

// 14. TSV neutralizes embedded tabs
t('tsv replaces embedded tab/newline', () => {
  const s = toTSV([['a\tb', 'c\nd']]);
  assert.strictEqual(s.split('\t').length, 2);
  assert.ok(!s.includes('c\nd'));
});

// 15. JSON dedupes duplicate headers
t('json dedupes duplicate keys', () => {
  const r = clean('name,name\n1,2\n3,4');
  const j = JSON.parse(toJSON(r.rows, true));
  assert.deepStrictEqual(Object.keys(j[0]), ['name', 'name_2']);
});

// 16. Oversize input throws a friendly error
t('oversize input rejected clearly', () => {
  assert.throws(() => clean('x'.repeat(1_000_001)), /too large/i);
});

// --- Citation formatters ---

const FIELDS = {
  title: 'A Study of Tables',
  author: 'Jane A Smith',
  date: '2024-06-13',
  site: 'Example Journal',
  url: 'https://example.com/a',
};

t('APA: full fields, initials + period after date', () => {
  assert.strictEqual(toAPA(FIELDS),
    'Smith, J. A. (2024, June 13). A Study of Tables. Example Journal. https://example.com/a');
});

t('MLA: full fields', () => {
  assert.strictEqual(toMLA(FIELDS),
    'Jane A Smith. "A Study of Tables." Example Journal, 13 June 2024, https://example.com/a.');
});

t('APA/MLA degrade on missing author and date', () => {
  const f = { ...FIELDS, author: null, date: null };
  assert.strictEqual(toAPA(f), '(n.d.). A Study of Tables. Example Journal. https://example.com/a');
  assert.strictEqual(toMLA(f), '"A Study of Tables." Example Journal, https://example.com/a.');
});

t('single-word author kept as-is; unparseable date passed through raw', () => {
  const f = { ...FIELDS, author: 'Opensignal', date: 'sometime ago' };
  assert.ok(toAPA(f).startsWith('Opensignal (n.d.).'));
});

// --- Diagnostics meta ---

t('meta: clean comma table is 100% confident, counts quoted fields', () => {
  const r = clean('name,note\n"Smith, John",hi\nx,y\n1,2');
  assert.strictEqual(r.meta.delimiter, 'comma');
  assert.strictEqual(r.meta.confidence, 100);
  assert.strictEqual(r.meta.quotedFields, 1);
  assert.strictEqual(r.meta.rows, 4); // header + 3 data rows
  assert.strictEqual(r.meta.columns, 2);
  assert.strictEqual(r.meta.padded, 0);
});

t('meta: ragged input reports padded cells and lower confidence', () => {
  const r = clean('a,b,c\n1,2\nx,y,z');
  assert.ok(r.meta.padded >= 1);
  assert.ok(r.meta.confidence < 100 && r.meta.confidence >= 55);
});

t('meta: ragged long row reports truncation', () => {
  const r = clean('a,b,c\n1,2,3\n9,8,7,6,5');
  assert.ok(r.meta.truncated >= 2);
});

console.log('\n' + passed + ' passed, exit=' + process.exitCode);
