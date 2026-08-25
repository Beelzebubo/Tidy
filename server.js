'use strict';

const express = require('express');
const cheerio = require('cheerio');
const dns = require('dns').promises;
const net = require('net');
const path = require('path');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

class UserError extends Error {}

function invalidUrl() {
  return new UserError("That doesn't look like a valid http(s) URL.");
}

function isPrivateIp(ip) {
  let v4 = ip;
  if (v4.toLowerCase().startsWith('::ffff:')) v4 = v4.slice(7);
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  const v6 = ip.toLowerCase();
  return v6 === '::1' || v6 === '::' ||
    /^f[cd]/.test(v6) ||
    v6.startsWith('fe80');
}

async function fetchPage(rawUrl, redirects = 0) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw invalidUrl();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw invalidUrl();

  const addrs = await dns.lookup(url.hostname, { all: true })
    .catch(() => { throw new UserError("Couldn't find that site."); });
  if (addrs.some(a => isPrivateIp(a.address))) throw invalidUrl();

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ac.signal,
      redirect: 'manual',
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new UserError(`Couldn't reach that page (timed out after ${TIMEOUT_MS / 1000}s).`);
    }
    throw new UserError("Couldn't reach that site — try pasting the table text directly instead.");
  } finally {
    clearTimeout(timer);
  }

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (!loc || redirects >= MAX_REDIRECTS) throw new UserError('Too many redirects.');
    return fetchPage(new URL(loc, url).href, redirects + 1);
  }
  if (!res.ok) {
    throw new UserError(res.status === 403 || res.status === 401
      ? 'This site blocks automated access — try pasting the table text directly instead.'
      : `That page returned an error (HTTP ${res.status}).`);
  }


  const len = Number(res.headers.get('content-length'));
  const type = res.headers.get('content-type') || '';
  if (!/html|xml|text/.test(type)) {
    throw new UserError("That URL isn't a web page, so there's nothing to extract.");
  }
  return { html: await res.text(), finalUrl: url.href };
}


function tableToRows($, table) {
  const grid = [];
  const occupy = (r, c, text) => {
    grid[r] = grid[r] || [];
    grid[r][c] = text;
  };
  $(table).find('tr').toArray().forEach((tr, ri) => {
    let ci = 0;
    grid[ri] = grid[ri] || [];

    while (grid[ri][ci] !== undefined) ci++;
    $(tr).find('td, th').toArray().forEach(cell => {
      const $cell = $(cell);
      const cs = Math.min(Number($cell.attr('colspan')) || 1, 50);
      const rs = Math.min(Number($cell.attr('rowspan')) || 1, 5000);
      const text = $cell.text().replace(/\s+/g, ' ').trim();

      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          occupy(ri + dr, ci + dc, text);
        }
      }
      ci += cs;
      while (grid[ri][ci] !== undefined) ci++;
    });
  });
  return grid
    .filter(r => r.some(c => c !== undefined))
    .map(r => r.map(c => c ?? ''));
}

function extractTables(html) {
  const $ = cheerio.load(html);
  let tables = $('table')
    .not('table table')
    .toArray()
    .map(table => tableToRows($, table))
    .map(rows => rows.filter(cells => cells.length && cells.some(c => c !== '')))
    .filter(rows => rows.length > 0)
    .map(rows => ({
      rows,
      preview: rows.slice(0, 2).map(r => r.join(' | ')).join(' ⏎ ').slice(0, 80),
    }));

  const multi = tables.filter(t => t.rows[0].length >= 2);
  if (multi.length) tables = multi;
  return tables.sort((a, b) => b.rows.length * b.rows[0].length - a.rows.length * a.rows[0].length);
}

let hits = [];
function limited() {
  const now = Date.now();
  hits = hits.filter(t => now - t < 60_000);
  if (hits.length >= 30) return true;
  hits.push(now);
  return false;
}

const app = express();
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/fetch-table', async (req, res) => {
  if (limited()) return res.status(429).json({ error: 'Too many requests — wait a minute and try again.' });
  const { url } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: "Paste a URL first." });
  try {
    const { html } = await fetchPage(url.trim());
    const tables = extractTables(html);
    if (!tables.length) {
      return res.status(404).json({
        error: "No <table> elements found on this page. Pages that build tables with JavaScript after load can't be extracted — try pasting the table text directly instead.",
      });
    }
    res.json({ tables });
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong on our end — try again.' });
  }
});

function metaContent($, sel) {
  const v = $(sel).attr('content');
  return v ? v.replace(/\s+/g, ' ').trim() || null : null;
}

function titleCase(host) {
  const labels = host.replace(/^www\./, '').split('.');

  let name = labels[0];
  if ((labels[0].length <= 3 || labels[0].includes('-')) && labels.length > 2) name = labels[1];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

app.post('/api/cite', async (req, res) => {
  if (limited()) return res.status(429).json({ error: 'Too many requests — wait a minute and try again.' });
  const { url } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'Paste a URL first.' });
  try {
    const { html, finalUrl } = await fetchPage(url.trim());
    const $ = cheerio.load(html);
    const title =
      metaContent($, 'meta[property="og:title"]') ||
      $('title').text().replace(/\s+/g, ' ').trim() ||
      $('h1').first().text().replace(/\s+/g, ' ').trim() || null;
    let author =
      metaContent($, 'meta[name="author"]') ||
      metaContent($, 'meta[property="article:author"]') ||
      $('.byline, [rel="author"], [itemprop="author"]').first().text().replace(/\s+/g, ' ').trim() ||
      null;
    if (author && /^https?:\/\//i.test(author)) author = null;
    const date =
      metaContent($, 'meta[property="article:published_time"]') ||
      metaContent($, 'meta[name="date"]') ||
      $('time[datetime]').first().attr('datetime') || null;
    const site = metaContent($, 'meta[property="og:site_name"]') || titleCase(new URL(finalUrl).hostname);
    if (!title) return res.status(404).json({ error: "Couldn't find a title on that page." });
    res.json({ fields: { title, author, date, site }, url: finalUrl });
  } catch (e) {
    if (e instanceof UserError) return res.status(400).json({ error: e.message });
    console.error(e);
    res.status(500).json({ error: 'Something went wrong on our end — try again.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tidy running at http://localhost:${PORT}`));
