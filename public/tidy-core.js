(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Tidy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_CHARS = 1_000_000;
  const MAX_LINES = 5000;
  const MAX_COLS = 200;

  function stats(counts) {
    const n = counts.length;
    const mean = counts.reduce((a, b) => a + b, 0) / n;
    const variance = counts.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return { mean, cv: mean === 0 ? Infinity : Math.sqrt(variance) / mean };
  }


  function collapseWs(line) {
    const quotes = [];
    const masked = line.replace(/"(?:[^"]|"")*"/g, m => {
      quotes.push(m);
      return '\u0000' + (quotes.length - 1) + '\u0000';
    });
    return masked.replace(/ {2,}|\t+/g, '\t').replace(/\u0000(\d+)\u0000/g, (_, n) => quotes[+n]);
  }

  function sniff(lines, warnings) {
    const ORDER = [',', '\t', '|', 'ws', 'mix'];

    const repaired = lines.map(l => ((l.split('"').length - 1) % 2 === 1 ? l.replace(/"/g, '') : l));
    const cands = ORDER.map(d => ({
      d,
      counts: repaired.map(l =>
        tokenizeLine(d === 'ws' ? collapseWs(l) : l, d === 'ws' ? '\t' : d).fields.length
      ),
    }));
    let usable = cands.filter(c => c.counts.every(n => n >= 2));
    if (!usable.length) return null;
    for (const c of usable) c.s = stats(c.counts);

    if (lines.length < 3) {

      const unanimous = usable.find(c => c.counts.every(n => n === c.counts[0]));
      if (unanimous) return { delim: unanimous.d, warnings };
    }

    usable.sort((a, b) => a.s.cv - b.s.cv);
    const best = usable[0];
    if (best.s.cv > 0.5) {
      warnings.push({
        code: 'AMBIGUOUS_DELIMITER',
        message: "Couldn't confidently detect the column separator",
      });
      return { delim: 'ws', cv: best.s.cv, warnings };
    }
    return { delim: best.d, cv: best.s.cv, warnings };
  }

  function tokenizeLine(line, delim) {
    const fields = [];
    let field = '';
    let inQuotes = false;
    let unterminated = false;
    let justClosed = false;
    let quoted = 0;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQuotes) {
        if (c === '"') {
          if (line[i + 1] === '"') { field += '"'; i++; }
          else { inQuotes = false; justClosed = true; }
        } else {
          field += c;
        }
        continue;
      }

      let isBoundary;
      if (delim === 'mix') {
        isBoundary = c === ',' || c === '\t' ||
          (c === ' ' && (line[i + 1] === ' ' || line[i + 1] === '\t')) ||
          ((c === ' ' || c === '\t') && justClosed);
      } else {

        isBoundary = delim !== 'ws' && c === delim;
      }

      if (isBoundary) {
        fields.push(field.trim());
        field = '';
        justClosed = false;
        if (delim === 'mix' && (c === ' ' || c === '\t')) {
          while (i + 1 < line.length && (line[i + 1] === ' ' || line[i + 1] === '\t')) i++;
        }
      } else if (c === '"' && field.trim() === '') {

        inQuotes = true;
        field = '';
        quoted++;
      } else {
        field += c;
        justClosed = false;
      }
    }
    fields.push(inQuotes ? field : field.trim());
    if (inQuotes) unterminated = true;
    return { fields, unterminated, quoted };
  }

  function tokenizeLineWs(line) {
    return tokenizeLine(collapseWs(line), '\t');
  }

  function isSeparatorRow(fields) {
    return fields.length > 0 && fields.every(f => /^:?-{2,}:?$/.test(f.trim()));
  }

  function clean(input) {
    if (typeof input !== 'string' || input.trim() === '') {
      return { rows: [], hasHeader: false, delimiter: null, warnings: [] };
    }
    if (input.length > MAX_CHARS) {
      throw new Error('Input too large (' + input.length.toLocaleString() + ' chars). Limit is 1M characters.');
    }

    let lines = input.split(/\r\n|\r|\n/).map(l => l.replace(/[ \t]+$/, '')).filter(l => l.trim() !== '');
    if (lines.length > MAX_LINES) {
      throw new Error('Input too large (' + lines.length.toLocaleString() + ' lines). Limit is 5,000 lines.');
    }

    const warnings = [];
    const sniffed = sniff(lines, warnings);
    const delim = sniffed ? sniffed.delim : null;

    let rows = [];
    if (!delim) {
      rows = lines.map(l => [l]);
      return { rows, hasHeader: rows.length > 1 ? !rows[0].every(isNumericCell) : true, delimiter: null, warnings, meta: null };
    }

    let quotedFields = 0;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      if (delim === '|') {
        line = line.replace(/^\s*\|/, '').replace(/\|\s*$/, '');
      }
      const { fields, unterminated, quoted } = delim === 'ws' ? tokenizeLineWs(line) : tokenizeLine(line, delim);
      quotedFields += quoted;
      if (unterminated) {
        warnings.push({ code: 'UNTERMINATED_QUOTE', message: 'Row ' + (i + 1) + ': quote never closed — treated rest of row as one cell.', rowIndex: i });
      }
      if (isSeparatorRow(fields)) continue;
      rows.push(fields);
    }

    if (delim === '|') rows = rows.filter(r => r.length > 1 || r[0].trim() !== '');


    let padded = 0;
    let truncated = 0;
    if (rows.length > 1) {
      const freq = new Map();
      for (const r of rows) freq.set(r.length, (freq.get(r.length) || 0) + 1);
      let modal = 0, best = 0;
      for (const [len, n] of freq) if (n > best || (n === best && len > modal)) { modal = len; best = n; }
      rows.forEach((r, i) => {
        if (r.length < modal) {
          const had = r.length;
          while (r.length < modal) r.push('');
          padded += modal - had;
          warnings.push({ code: 'RAGGED_PADDED', message: 'Row ' + (i + 1) + ' had ' + had + ' fields, expected ' + modal + ' — padded with empty cells.', rowIndex: i });
        } else if (r.length > modal) {
          truncated += r.length - modal;
          warnings.push({ code: 'RAGGED_TRUNCATED', message: 'Row ' + (i + 1) + ' had ' + r.length + ' fields, expected ' + modal + ' — extras dropped.', rowIndex: i });
          rows[i] = r.slice(0, modal);
        }
      });
    }

    if (rows.length && rows[0].length > MAX_COLS) {
      throw new Error('Too many columns (limit ' + MAX_COLS + ').');
    }

    const hasHeader = !(rows.length >= 2 && rows[0].every(isNumericCell));
    const LABELS = { ',': 'comma', '\t': 'tabs', '|': 'pipes', ws: 'spaces', mix: 'mixed separators' };
    const meta = {
      delimiter: LABELS[delim] || delim,

      confidence: Math.max(55, Math.round(100 * (1 - Math.min(sniffed.cv, 0.45)))),
      rows: rows.length,
      columns: rows.length ? rows[0].length : 0,
      quotedFields,
      padded,
      truncated,
    };
    return { rows, hasHeader, delimiter: delim, warnings, meta };
  }

  function isNumericCell(v) {
    return v.trim() !== '' && !isNaN(Number(v.replace(/,/g, '')));
  }

  function columnWidths(rows) {
    const widths = [];
    for (const row of rows) row.forEach((cell, j) => {
      widths[j] = Math.max(widths[j] || 0, cell.length);
    });
    return widths;
  }

  function toMarkdown(rows) {
    if (!rows.length) return '';
    const widths = columnWidths(rows);
    const pad = (cell, w) => cell.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ') + ' '.repeat(Math.max(0, w - cell.length));
    const out = [];
    rows.forEach((row, i) => {
      out.push('| ' + widths.map((w, j) => pad(row[j] ?? '', w)).join(' | ') + ' |');
      if (i === 0) out.push('|' + widths.map(w => '-'.repeat(w + 2)).join('|') + '|');
    });
    return out.join('\n');
  }

  function needsCsvQuoting(cell) {
    return /[",\n\r]/.test(cell);
  }

  function csvCell(cell) {
    if (!needsCsvQuoting(cell)) return cell;
    return '"' + cell.replace(/"/g, '""') + '"';
  }

  function toCSV(rows) {
    return rows.map(r => r.map(csvCell).join(',')).join('\n');
  }

  function tsvCell(cell) {
    return cell.replace(/\t/g, '␉').replace(/[\r\n]+/g, ' ');
  }

  function toTSV(rows) {
    return rows.map(r => r.map(tsvCell).join('\t')).join('\n');
  }

  function headerKeys(rows, hasHeader) {
    if (!rows.length) return [];
    const raw = hasHeader
      ? rows[0].map((k, i) => (k.trim() === '' ? 'Column ' + (i + 1) : k.trim()))
      : rows[0].map((_, i) => 'Column ' + (i + 1));
    const seen = new Map();
    return raw.map(k => {
      const n = seen.get(k) || 0;
      seen.set(k, n + 1);
      return n === 0 ? k : k + '_' + (n + 1);
    });
  }

  function toJSON(rows, hasHeader) {
    const keys = headerKeys(rows, hasHeader);
    return JSON.stringify(
      rows.slice(hasHeader ? 1 : 0).map(r =>
        Object.fromEntries(keys.map((k, j) => [k, r[j] ?? '']))
      ),
      null,
      2
    );
  }

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];

  function dateParts(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return null;
    return { y: d.getFullYear(), m: MONTHS[d.getMonth()], day: d.getDate() };
  }

  function surnameInit(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    const sur = parts.pop();
    return `${sur}, ${parts.map(p => p[0].toUpperCase() + '.').join(' ')}`;
  }

  function toAPA(f) {
    const dt = dateParts(f.date);
    const when = !dt ? '(n.d.)' : `(${dt.y}, ${dt.m} ${dt.day})`;
    const head = f.author ? `${surnameInit(f.author)} ${when}` : when;
    return `${head}. ${f.title}. ${f.site}. ${f.url}`;
  }

  function toMLA(f) {
    const dt = dateParts(f.date);
    const when = dt ? `${dt.day} ${dt.m} ${dt.y}, ` : '';
    const head = f.author ? `${f.author}. ` : '';
    return `${head}"${f.title}." ${f.site}, ${when}${f.url}.`;
  }

  return { clean, toMarkdown, toCSV, toTSV, toJSON, toAPA, toMLA };
});
