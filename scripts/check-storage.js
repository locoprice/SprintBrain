#!/usr/bin/env node
// STORAGE GATE — the extension must never STORE anything in chrome.storage.sync.
//
// chrome.storage.sync roams to every Chrome signed into the same Google
// account. Two real incidents came from that: a snippet library travelled
// between profiles, and a Notion API key sat in a roaming key. Both are fixed,
// and app/public/landing/legal/privacy-policy.html now tells the public that
// the extension uses chrome.storage.local exclusively. That sentence is a
// promise, so it gets a gate rather than a code review.
//
// Reads and removes stay legal: migrating a legacy roaming key to local and
// then deleting it is how the promise gets kept on profiles that predate it.
// Writes do not.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

// ── 1. no writes to storage.sync anywhere in the shipped extension ──
// chrome-shim.js is excluded: it BACKS both areas with localStorage so the
// extension scripts run unchanged inside Sprintbrain.html. Nothing it writes
// reaches Google.
const SHIM = path.join('extension', 'shared', 'chrome-shim.js');
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}
const offenders = [];
for (const file of walk(path.join(ROOT, 'extension'), [])) {
  const rel = path.relative(ROOT, file);
  if (rel.split(path.sep).join('/') === SHIM.split(path.sep).join('/')) continue;
  const src = fs.readFileSync(file, 'utf8');
  src.split('\n').forEach((line, i) => {
    if (line.trim().startsWith('//')) return;
    if (/chrome\.storage\.sync\.set\s*\(/.test(line)) {
      offenders.push(rel.split(path.sep).join('/') + ':' + (i + 1));
    }
  });
}
check('nothing writes to chrome.storage.sync', offenders, []);

// ── 2. the roaming keys are read from local ─────────────────────────
const ROAMING = ['trigger', 'triggerCfg', 'sb_default_lang'];
const CONTENT = fs.readFileSync(path.join(ROOT, 'extension', 'content', 'content.js'), 'utf8');
check(
  'content.js reads the trigger settings from local',
  /chrome\.storage\.local\.get\(\['trigger','triggerCfg','sb_default_lang'\]/.test(CONTENT),
  true,
);

// ── 3. the one-time migration behaves ───────────────────────────────
// A user who customized their trigger before the move must not silently fall
// back to "::" afterwards, and a stale roaming copy must never beat a newer
// local one. Runs the REAL function, sliced out of background.js.
const BG = fs.readFileSync(path.join(ROOT, 'extension', 'background', 'background.js'), 'utf8');
const FROM = 'function sbMigrateRoamingPrefs()';
const TO = '// Build on install + create sync alarm';
const from = BG.indexOf(FROM), to = BG.indexOf(TO);
if (from === -1 || to === -1 || to <= from) {
  console.error('X background.js: cannot slice sbMigrateRoamingPrefs, the markers moved');
  failed++;
} else {
  const slice = BG.slice(from, to);
  const area = (store) => ({
    get: (keys, cb) => { const o = {}; [].concat(keys).forEach((k) => { if (k in store) o[k] = store[k]; }); cb(o); },
    set: (obj, cb) => { Object.assign(store, obj); if (cb) cb(); },
    remove: (keys, cb) => { [].concat(keys).forEach((k) => delete store[k]); if (cb) cb(); },
  });
  const run = (sync, local) => {
    const sandbox = {
      chrome: { storage: { sync: area(sync), local: area(local) }, runtime: { lastError: null } },
      console,
    };
    vm.createContext(sandbox);
    vm.runInContext(slice + '\nsbMigrateRoamingPrefs();', sandbox);
    return { sync, local };
  };

  let r = run({ trigger: '//', triggerCfg: { snippetTrigger: '//' }, sb_default_lang: 'ES' }, {});
  check('a customized trigger survives the move', r.local,
    { trigger: '//', triggerCfg: { snippetTrigger: '//' }, sb_default_lang: 'ES' });
  check('the roaming copies are dropped', r.sync, {});

  r = run({ triggerCfg: { snippetTrigger: 'OLD' } }, { triggerCfg: { snippetTrigger: 'NEW' } });
  check('a stale roaming copy never beats the local one', r.local.triggerCfg, { snippetTrigger: 'NEW' });

  r = run({ somethingElse: 1 }, {});
  check('unrelated sync keys are left alone', r.sync, { somethingElse: 1 });

  check('every roaming key is covered', ROAMING.every((k) => slice.includes("'" + k + "'")), true);
}

if (failed) { console.error('\nX ' + failed + ' check(s) failed'); process.exit(1); }
console.log('\nOK storage gate: nothing roams through chrome.storage.sync');
