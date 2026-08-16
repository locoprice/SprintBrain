#!/usr/bin/env node
// Keeps the inlined copies of the shared tooltip identical to the canonical
// file. Two surfaces cannot load extension/shared/tooltip.js at runtime:
//
//   app/public/mobile/index.html   single-file app by design
//   app/public/landing/index.html  separate Netlify site, rooted at landing/
//
// so each carries an inlined copy between markers. Run without arguments to
// write the copies, or with --check to assert they match (used as a gate, the
// same shape as scripts/check-version.js).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'tooltip.js');
const BEGIN = '<!-- SB_TOOLTIP:BEGIN (generated from extension/shared/tooltip.js by scripts/sync-tooltip.js, do not edit) -->';
const END = '<!-- SB_TOOLTIP:END -->';

const TARGETS = [
  path.join(ROOT, 'app', 'public', 'mobile', 'index.html'),
  path.join(ROOT, 'app', 'public', 'landing', 'index.html'),
];

function block(source) {
  return BEGIN + '\n<script>\n' + source.trimEnd() + '\n</script>\n' + END;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Windows checkouts (core.autocrlf=true) can materialize these files with
// CRLF even though the committed blob and every string built here are LF.
// Normalize on read so a fresh `git checkout` doesn't read as spurious drift;
// every write stays pure LF regardless of local line-ending state.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function apply(file, source, check) {
  let html = readText(file);
  const desired = block(source);
  const start = html.indexOf(BEGIN);
  const stop = html.indexOf(END);

  if (start !== -1 && stop !== -1) {
    const existing = html.slice(start, stop + END.length);
    if (existing === desired) return 'ok';
    if (check) return 'drift';
    html = html.slice(0, start) + desired + html.slice(stop + END.length);
  } else {
    if (check) return 'missing';
    const close = html.lastIndexOf('</body>');
    if (close === -1) throw new Error('no </body> in ' + rel(file));
    html = html.slice(0, close) + desired + '\n' + html.slice(close);
  }

  fs.writeFileSync(file, html);
  return 'written';
}

function main() {
  const check = process.argv.includes('--check');
  const source = readText(SOURCE);
  let failed = false;

  for (const file of TARGETS) {
    const result = apply(file, source, check);
    if (result === 'ok') {
      console.log('OK   ' + rel(file) + ' tooltip in sync');
    } else if (result === 'written') {
      console.log('SYNC ' + rel(file) + ' tooltip updated');
    } else {
      failed = true;
      const why = result === 'missing' ? 'has no tooltip block' : 'tooltip has drifted';
      console.error('X    ' + rel(file) + ' ' + why + ' -> run: node scripts/sync-tooltip.js');
    }
  }

  if (failed) process.exit(1);
}

main();
