#!/usr/bin/env node
// Keeps the inlined copy of the shared snippet grouping rule identical to the
// canonical file. The mobile companion is a single-file app by design, so it
// cannot load extension/shared/snippet-stats.js at runtime and carries an
// inlined copy between markers instead.
//
// Why this exists: mobile used to hand-roll its own grouping key. It merged
// rows across owners, stripped a trailing language code that was not the row's
// own language ("wait" shed an "IT" it never had and merged with "WA"), and
// let a lang_group_id collide with a base trigger of the same spelling. Eight
// groups on real data collapsed two different people's snippets into one card,
// which rendered one snippet's title over another snippet's folder. One rule,
// one file, no second implementation to drift.
//
// Run without arguments to write the copy, or with --check to assert it
// matches (used as a gate, the same shape as scripts/sync-tooltip.js).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'snippet-stats.js');
const BEGIN = '<!-- SB_SNIPPET_STATS:BEGIN (generated from extension/shared/snippet-stats.js by scripts/sync-snippet-stats.js, do not edit) -->';
const END = '<!-- SB_SNIPPET_STATS:END -->';

const TARGETS = [
  path.join(ROOT, 'app', 'public', 'mobile', 'index.html'),
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
    // Ahead of the app's own script, not before </body> like the tooltip: the
    // app calls SBSnippetStats while it renders, so the rule has to be defined
    // by the time that script runs.
    const anchor = html.indexOf('<script>');
    if (anchor === -1) throw new Error('no <script> in ' + rel(file));
    html = html.slice(0, anchor) + desired + '\n' + html.slice(anchor);
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
      console.log('OK   ' + rel(file) + ' snippet-stats in sync');
    } else if (result === 'written') {
      console.log('SYNC ' + rel(file) + ' snippet-stats updated');
    } else {
      failed = true;
      const why = result === 'missing' ? 'has no snippet-stats block' : 'snippet-stats has drifted';
      console.error('X    ' + rel(file) + ' ' + why + ' -> run: node scripts/sync-snippet-stats.js');
    }
  }

  if (failed) process.exit(1);
}

main();
