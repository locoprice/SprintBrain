#!/usr/bin/env node
// Keeps the inlined copy of the shared memory pack identical to the canonical
// file. Same shape as scripts/sync-fill-form.js: run without arguments to write
// the copy, or with --check to assert it matches (used as a gate).
//
//   app/public/mobile/index.html   single-file app by design, cannot load
//                                  extension/shared/memory-pack.js at runtime
//
// The phone reads two things from the module, and both have to be the ones
// every other surface uses:
//
//   estimateTokens       the token count shown while text is being added. It
//                        is the arithmetic the database generates, so a count
//                        worked out anywhere else is a second rule.
//   formatInjectedBlock  the text "Copy whole Brain" hands out, the same block
//                        the extension's Context button puts into an AI chat.
//
// --check also fails if the phone stops reaching them through the module.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'extension', 'shared', 'memory-pack.js');
const MOBILE = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const BEGIN = '<!-- SB_MEMORY_PACK:BEGIN (generated from extension/shared/memory-pack.js by scripts/sync-memory-pack.js, do not edit) -->';
const END = '<!-- SB_MEMORY_PACK:END -->';
// Anchor on another block's END marker, never on the first <script> in the
// file: that one sits inside the snippet-stats block. The app's own script
// opens after the Interactive Steps block, and its gate requires that script to
// follow that block directly, so this one goes ahead of it, after fill-form.
const ANCHOR = '<!-- SB_FILL_FORM:END -->';

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

function apply(source, check) {
  let html = readText(MOBILE);
  const desired = block(source);
  const start = html.indexOf(BEGIN);
  const stop = html.indexOf(END);

  if (start !== -1 && stop !== -1) {
    if (html.slice(start, stop + END.length) === desired) return 'ok';
    if (check) return 'drift';
    html = html.slice(0, start) + desired + html.slice(stop + END.length);
  } else {
    if (check) return 'missing';
    const anchor = html.indexOf(ANCHOR);
    if (anchor === -1) throw new Error(rel(MOBILE) + ' has no ' + ANCHOR + ' to place the block after');
    const at = anchor + ANCHOR.length;
    html = html.slice(0, at) + '\n' + desired + html.slice(at);
  }

  fs.writeFileSync(MOBILE, html);
  return 'written';
}

// The source of one function: from its declaration to the next top-level one.
function fnSource(text, decl) {
  const start = text.indexOf(decl);
  if (start === -1) return '';
  const next = text.indexOf('\nfunction ', start + decl.length);
  return text.slice(start, next === -1 ? undefined : next);
}

// What the gate pins beyond the copy itself: where the block sits, and that
// the phone's own code goes through it rather than around it.
function structure() {
  const html = readText(MOBILE);
  const problems = [];
  const start = html.indexOf(BEGIN);
  if (start === -1) return problems;

  // A block opened inside another script leaves the app's code outside any tag,
  // and the phone prints that code as text.
  const before = html.slice(0, start);
  const open = (before.match(/<script\b/g) || []).length - (before.match(/<\/script>/g) || []).length;
  if (open !== 0) problems.push('the block opens inside another <script>');

  const uses = [
    ['function memBrainBlock(', 'SBMemoryPack.formatInjectedBlock(', 'Copy whole Brain builds its text through the module'],
    ['function memAddCount(', 'SBMemoryPack.estimateTokens(', 'the Add text token count comes from the module'],
  ];
  uses.forEach(([decl, call, what]) => {
    if (fnSource(html, decl).indexOf(call) === -1) problems.push(what + ' (' + decl + '... must call ' + call + '...)');
  });
  return problems;
}

function main() {
  const check = process.argv.includes('--check');
  const result = apply(readText(SOURCE), check);
  let failed = false;

  if (result === 'ok') {
    console.log('OK   ' + rel(MOBILE) + ' memory-pack in sync');
  } else if (result === 'written') {
    console.log('SYNC ' + rel(MOBILE) + ' memory-pack updated');
  } else {
    failed = true;
    const why = result === 'missing' ? 'has no memory-pack block' : 'memory-pack has drifted';
    console.error('X    ' + rel(MOBILE) + ' ' + why + ' -> run: node scripts/sync-memory-pack.js');
  }

  structure().forEach((problem) => {
    failed = true;
    console.error('X    ' + rel(MOBILE) + ': ' + problem);
  });

  if (failed) process.exit(1);
}

main();
