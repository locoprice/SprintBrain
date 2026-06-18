#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../extension/manifest.json'), 'utf-8'));
const EXT_VERSION = `v${manifest.version}`;
const ROOT = path.resolve(__dirname, '../app/public/landing');
const PORT = 5174;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

function formatMonth(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

function getReleaseIso() {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const raw = execSync(
      'git log --pretty=format:"%s%x09%ad" --date=short --no-merges',
      { encoding: 'utf-8', cwd: repoRoot },
    ).trim();
    for (const line of raw.split('\n')) {
      const sep = line.lastIndexOf('\t');
      if (sep === -1) continue;
      const subject = line.slice(0, sep);
      const date = line.slice(sep + 1).trim();
      if (/[—\-–]\s*v\d+[\d.]*\s*$/.test(subject)) return date;
    }
  } catch {}
  return '';
}

const RELEASE_ISO   = getReleaseIso();
const RELEASE_DATE  = RELEASE_ISO ? formatDate(RELEASE_ISO) : '';
const RELEASE_MONTH = RELEASE_ISO ? formatMonth(RELEASE_ISO) : '';

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css',
  '.js':    'text/javascript',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.svg':   'image/svg+xml',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
  '.ico':   'image/x-icon',
};

function stamp(html) {
  return html
    .replace(/\{\{EXT_VERSION\}\}/g, EXT_VERSION)
    .replace(/\{\{RELEASE_DATE\}\}/g, RELEASE_DATE)
    .replace(/\{\{RELEASE_MONTH\}\}/g, RELEASE_MONTH);
}

http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const filePath = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  let content = fs.readFileSync(filePath);

  if (ext === '.html') content = stamp(content.toString('utf-8'));

  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
}).listen(PORT, () => {
  console.log(`Landing preview → http://localhost:${PORT}  (${EXT_VERSION}, ${RELEASE_DATE})`);
});
