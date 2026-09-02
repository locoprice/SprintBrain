#!/usr/bin/env node
// Keeps the inlined copy of the shared fill-form view model identical to the
// canonical file. Same shape as scripts/sync-tooltip.js and
// scripts/sync-snippet-stats.js: run without arguments to write the copy, or
// with --check to assert it matches (used as a gate).
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/fill-form.js at runtime
//
// The phone also cannot load extension/formula-engine.js, so it keeps its own
// parser and hands it to this module as window.SBFillFormEngine. That is the
// documented exception: the PARSING stays mirrored there (and is gated by the
// mobile field-config parity cases in check-snippets.js), while the DECISIONS
// about what a form is come from this one file, like every other surface.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'fill-form.js');
const BEGIN = '<!-- SB_FILL_FORM:BEGIN (generated from extension/shared/fill-form.js by scripts/sync-fill-form.js, do not edit) -->';
const END = '<!-- SB_FILL_FORM:END -->';

const TARGETS = [
  path.join(ROOT, 'app', 'public', 'mobile', 'index.html'),
];

function block(source) {
  return BEGIN + '\n<script>\n' + source.trimEnd() + '\n</script>\n' + END;
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Windows checkouts (core.autocrlf=true) can materialize these files with CRLF
// even though the committed blob and every string built here are LF. Normalize
// on read so a fresh `git checkout` doesn't read as spurious drift; every write
// stays pure LF regardless of local line-ending state.
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
    // Anchor on another block's END marker, never on the first <script> in the
    // file: that <script> is the one INSIDE the snippet-stats block, so
    // inserting there put this block between that block's BEGIN and END, and the
    // next snippet-stats sync silently swallowed it. Earliest marker wins, so the
    // module is defined ahead of the app's own script rather than after it at the
    // end of the document — the app calls SBFillForm while it renders.
    const PRIOR = ['<!-- SB_SNIPPET_STATS:END -->', '<!-- SB_TOOLTIP:END -->'];
    let at = -1;
    for (const marker of PRIOR) {
      const i = html.indexOf(marker);
      if (i !== -1 && (at === -1 || i + marker.length < at)) at = i + marker.length;
    }
    if (at === -1) {
      throw new Error(rel(file) + ' has none of the blocks this one must follow: ' + PRIOR.join(', '));
    }
    html = html.slice(0, at) + '\n' + desired + html.slice(at);
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
      console.log('OK   ' + rel(file) + ' fill-form in sync');
    } else if (result === 'written') {
      console.log('SYNC ' + rel(file) + ' fill-form updated');
    } else {
      failed = true;
      const why = result === 'missing' ? 'has no fill-form block' : 'fill-form has drifted';
      console.error('X    ' + rel(file) + ' ' + why + ' -> run: node scripts/sync-fill-form.js');
    }
  }

  if (failed) process.exit(1);
}

main();
