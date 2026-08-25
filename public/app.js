'use strict';

const $ = s => document.querySelector(s);
const box = $('#input');
const out = $('#output');
const err = $('#error');

const FORMATS = {
  markdown: { render: rows => Tidy.toMarkdown(rows), ext: 'md' },
  csv: { render: Tidy.toCSV, ext: 'csv' },
  tsv: { render: Tidy.toTSV, ext: 'tsv' },
  json: { render: rows => Tidy.toJSON(rows, state.hasHeader), ext: 'json' },
};

let state = null;
let tables = [];
let fmt = 'preview';
let fields = null;
let citeStyle = 'apa';
let lastUrl = null;

const isUrl = text => !text.includes('\n') && (/^https?:\/\//i.test(text) || /^www\./i.test(text));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fail(msg) {
  out.hidden = true;
  $('#cite').hidden = true;
  err.textContent = msg;
  err.hidden = false;
  $('#cite-instead-btn').hidden = !lastUrl;
  $('#live').textContent = msg;
}

async function showResult(r) {
  err.hidden = true;
  $('#cite').hidden = true;

  // Transformation steps — the messy -> clean moment.
  const m = r.meta;
  const steps = [];
  if (m) {
    steps.push({ ok: m.confidence >= 80, text: `Detected ${m.delimiter} · ${plural(m.columns, 'column')} · ${m.confidence}% confidence` });
    steps.push({ ok: true, text: `${plural(m.rows, 'row')} parsed` });
    if (m.quotedFields) steps.push({ ok: true, text: `${plural(m.quotedFields, 'quoted field')} preserved` });
    if (m.padded) steps.push({ ok: false, text: `${plural(m.padded, 'empty cell')} padded` });
    if (m.truncated) steps.push({ ok: false, text: `${plural(m.truncated, 'extra cell')} dropped` });
  } else {
    steps.push({ ok: true, text: `${plural(r.rows.length, 'row')} extracted from page` });
  }
  for (const w of r.warnings) steps.push({ ok: false, text: w.message });

  const ol = $('#steps');
  ol.hidden = false;
  ol.replaceChildren();
  for (const [i, s] of steps.entries()) {
    const li = document.createElement('li');
    li.textContent = s.text;
    if (!s.ok) li.className = 'warn';
    li.style.animationDelay = `${i * 90}ms`;
    ol.append(li);
    await sleep(90);
  }

  const cols = r.rows[0].length;
  const conf = m && m.confidence != null ? ` <span class="conf">${m.confidence}% sure</span>` : '';
  $('#summary').innerHTML = `✓ Cleaned — ${plural(cols, 'column')} × ${plural(r.rows.length, 'row')}${conf}`;

  $('#warnings').replaceChildren(
    ...r.warnings.map(w => Object.assign(document.createElement('div'), { className: 'warning', textContent: `⚠ ${w.message}` }))
  );

  const picker = $('#table-picker');
  picker.hidden = tables.length < 2;
  if (tables.length > 1) {
    picker.replaceChildren(
      ...tables.map((t, i) => new Option(`${i + 1} of ${tables.length}: ${t.preview || '(empty)'}`, String(i)))
    );
    picker.value = '0';
  }
  out.hidden = false;
  $('#cite-instead-btn').hidden = !lastUrl;
  setFmt(fmt);
}

async function clean() {
  const text = box.value.trim();
  err.hidden = true;
  $('#cite-instead-btn').hidden = true;
  if (!text) return fail('Paste something first.');
  if (isUrl(text)) return fetchTable(text);
  lastUrl = null;
  try {
    const r = Tidy.clean(text);
    if (!r.rows.length) return fail('Nothing to clean — the input is empty.');
    tables = [];
    state = r;
    await showResult(r);
    $('#live').textContent = $('#summary').textContent;
  } catch (e) {
    fail(e.message);
  }
}

async function postApi(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

async function fetchTable(url) {
  const btn = $('#clean-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching…';
  lastUrl = /^www\./i.test(url) ? 'https://' + url : url;
  out.hidden = false;
  $('#steps').hidden = true;
  $('#skeleton').hidden = false;
  try {
    const data = await postApi('/api/fetch-table', { url: lastUrl });
    tables = data.tables;
    state = { rows: tables[0].rows, hasHeader: true, warnings: [], meta: null };
    $('#skeleton').hidden = true;
    await showResult(state);
    $('#live').textContent = `${$('#summary').textContent}${tables.length > 1 ? ` — ${plural(tables.length, 'table')} found, pick one below` : ''}`;
  } catch (e) {
    $('#skeleton').hidden = true;
    out.hidden = true;
    fail(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Clean it';
  }
}

// --- Rendering ---

function setFmt(f) {
  fmt = f;
  for (const t of $('#tabs').children) t.setAttribute('aria-pressed', String(t.dataset.fmt === f));
  const pre = $('#result');
  const tbl = $('#table-preview');
  if (f === 'preview') {
    pre.hidden = true;
    tbl.hidden = false;
    tbl.replaceChildren(previewTable(state.rows.slice(0, 300)));
  } else {
    tbl.hidden = true;
    pre.hidden = false;
    pre.textContent = FORMATS[f].render(state.rows);
  }
  $('#download-btn').querySelector('b').textContent = '.' + (f === 'preview' ? 'csv' : FORMATS[f].ext);
}

function previewTable(rows) {
  const table = document.createElement('table');
  table.className = 'table-preview';
  const [head, ...body] = rows;
  const thead = table.createTHead().insertRow();
  head.forEach(cell => {
    const th = document.createElement('th');
    th.textContent = cell || '';
    thead.append(th);
  });
  const tbody = table.createTBody();
  for (const row of body) {
    const tr = tbody.insertRow();
    row.forEach(cell => tr.insertCell().textContent = cell ?? '');
  }
  return table;
}

// --- Citations ---

function renderCitation() {
  $('#citation').textContent = (citeStyle === 'apa' ? Tidy.toAPA : Tidy.toMLA)(fields);
}

async function fetchCitation() {
  const btn = $('#cite-instead-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching citation…';
  try {
    const data = await postApi('/api/cite', { url: lastUrl });
    fields = { ...data.fields, url: data.url };
    out.hidden = true;
    err.hidden = true;
    btn.hidden = true;
    $('#cite').hidden = false;
    renderCitation();
    renderBib();
    $('#live').textContent = 'Citation ready.';
  } catch (e) {
    fail(e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Cite this page instead →';
  }
}

// --- Bibliography ---

const BIB_KEY = 'tidy-bib';
const normUrl = u => u.replace(/#.*$/, '').replace(/\/$/, '');

function loadBib() {
  try { return JSON.parse(localStorage.getItem(BIB_KEY)) || []; } catch { return []; }
}

function saveBib(list) {
  localStorage.setItem(BIB_KEY, JSON.stringify(list));
}

function renderBib() {
  const list = loadBib();
  $('#export-bib-btn').hidden = list.length < 2;
  const h2 = Object.assign(document.createElement('h2'), { textContent: `Bibliography (${list.length})` });
  const items = list.map((entry, i) => {
    const row = document.createElement('div');
    row.className = 'bib-item';
    row.append(
      Object.assign(document.createElement('span'), { textContent: Tidy.toAPA(entry.fields) }),
      Object.assign(document.createElement('button'), { textContent: '×', 'aria-label': 'Remove', onclick: () => { saveBib(loadBib().filter((_, j) => j !== i)); renderBib(); } })
    );
    return row;
  });
  $('#bib').replaceChildren(h2, ...items);
}

function copyText(text) {
  // Clipboard API needs a secure context; fall back to execCommand over plain http.
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = Object.assign(document.createElement('textarea'), { value: text, className: 'sr-only' });
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

function flashCopied(btn) {
  btn.classList.add('copied');
  setTimeout(() => btn.classList.remove('copied'), 1500);
}

// --- Wiring ---

$('#clean-btn').addEventListener('click', clean);
box.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') clean();
});

document.querySelectorAll('[data-example]').forEach(b =>
  b.addEventListener('click', () => {
    box.value = b.dataset.example;
    clean();
  })
);

$('#table-picker').addEventListener('change', e => {
  state = { rows: tables[+e.target.value].rows, hasHeader: true, warnings: [], meta: null };
  setFmt(fmt);
});

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-fmt]');
  if (b && state) setFmt(b.dataset.fmt);
});

document.querySelectorAll('.copyas-btn[data-copyfmt]').forEach(b =>
  b.addEventListener('click', () => {
    copyText(FORMATS[b.dataset.copyfmt].render(state.rows)).then(() => flashCopied(b));
  })
);

$('#style-tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-style]');
  if (!b || b.dataset.style === citeStyle) return;
  citeStyle = b.dataset.style;
  for (const t of $('#style-tabs').children) t.setAttribute('aria-pressed', String(t === b));
  renderCitation();
});

$('#copy-btn')?.addEventListener('click', () => copyText($('#result').textContent).then(() => flashCopied($('#copy-btn'))));
$('#cite-copy-btn').addEventListener('click', () => copyText($('#citation').textContent).then(() => flashCopied($('#cite-copy-btn'))));

$('#download-btn').addEventListener('click', () => {
  const f = fmt === 'preview' ? FORMATS.csv : FORMATS[fmt];
  const blob = new Blob([f.render(state.rows)], { type: 'text/plain' });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: `tidy.${f.ext}`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
});

$('#cite-instead-btn').addEventListener('click', fetchCitation);

$('#add-bib-btn').addEventListener('click', () => {
  const list = loadBib().filter(e => normUrl(e.url) !== normUrl(fields.url));
  list.push({ fields, url: fields.url, addedAt: Date.now() });
  saveBib(list);
  renderBib();
  const btn = $('#add-bib-btn');
  btn.textContent = 'Added ✓';
  setTimeout(() => { btn.textContent = '+ Add to bibliography'; }, 1500);
});

$('#export-bib-btn').addEventListener('click', () =>
  copyText(loadBib().map(e => Tidy.toAPA(e.fields)).sort((a, b) => a.localeCompare(b)).join('\n\n'))
    .then(() => flashCopied($('#export-bib-btn')))
);

// Drag-and-drop files into the paste area
const wrap = $('.paste-wrap');
['dragenter', 'dragover'].forEach(ev =>
  wrap.addEventListener(ev, e => { e.preventDefault(); wrap.classList.add('dragging'); $('#drop-hint').hidden = false; })
);
wrap.addEventListener('dragleave', e => {
  if (!wrap.contains(e.relatedTarget)) { wrap.classList.remove('dragging'); $('#drop-hint').hidden = true; }
});
wrap.addEventListener('drop', async e => {
  e.preventDefault();
  wrap.classList.remove('dragging');
  $('#drop-hint').hidden = true;
  const file = e.dataTransfer.files[0];
  if (file) {
    box.value = await file.text();
    clean();
  }
});

// Keyboard shortcuts: number keys switch output tabs when not typing
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') return; // handled on textarea
  if (e.target === box || e.metaKey || e.ctrlKey || e.altKey) return;
  const tabs = [...$('#tabs').children];
  const n = parseInt(e.key, 10);
  if (state && n >= 1 && n <= tabs.length) setFmt(tabs[n - 1].dataset.fmt);
});

// Theme
const THEME_KEY = 'tidy-theme';
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(THEME_KEY, t);
}
applyTheme(localStorage.getItem(THEME_KEY) ||
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
$('#theme-btn').addEventListener('click', () =>
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

renderBib();
