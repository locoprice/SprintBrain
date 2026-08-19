// Shipped-content + language-variant gate (SECURITY-001 / LANG-001).
//
// Two regressions this gate exists for, both found on 2026-08-19:
//
// 1. The extension shipped a real snippet library in DEFAULT_SNIPPETS. Anyone
//    who installed it saw that library in the in-page picker without an
//    account, because a signed-out install seeded the defaults into
//    chrome.storage.local. Nothing the bundle ships may contain snippet
//    content; a signed-out library is empty, by design.
//
// 2. _findLangVariants dropped languages. It expanded a row's `bodies` map only
//    when the group held one row, so a group with sibling rows for ES/IT never
//    surfaced an EN that lived inside a bodies map. Same-language duplicate
//    siblings (real data: a re-import created a second row per language) also
//    let the LAST row win, so which translation appeared depended on row order.
//
// Loads the REAL content.js in a vm context, the same file the browser runs.
const path = require('path');
const fs = require('fs');
const vm = require('vm');

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

const ENGINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'formula-engine.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');

// ── minimal host: only what content.js touches while loading ────────
const noop = function () {};
const stubEl = {
  id: '', style: {}, dataset: {}, textContent: '',
  appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
};
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  innerWidth: 1280, innerHeight: 800,
  document: {
    addEventListener: noop, removeEventListener: noop,
    createElement: () => Object.assign({}, stubEl),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    head: Object.assign({}, stubEl), body: Object.assign({}, stubEl),
    activeElement: null,
  },
  chrome: {
    storage: {
      local: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
      sync:  { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
      onChanged: { addListener: noop },
    },
    runtime: { id: 'gate', lastError: null, sendMessage: noop, onMessage: { addListener: noop } },
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

try {
  vm.runInContext(ENGINE_SRC, sandbox);
  vm.runInContext(CONTENT_SRC, sandbox);
} catch (e) {
  console.error('X content.js failed to evaluate in the gate context: ' + e.message);
  process.exit(1);
}

// ── 1. nothing ships a snippet library ──────────────────────────────
if (!Array.isArray(sandbox.DEFAULT_SNIPPETS)) {
  console.error('X content.js no longer defines DEFAULT_SNIPPETS');
  process.exit(1);
}
check('DEFAULT_SNIPPETS ships empty', sandbox.DEFAULT_SNIPPETS.length, 0);

// A body that reaches the bundle is readable by anyone who installs it, so the
// file itself must stay free of snippet prose and of any customer's identity.
// These markers are drawn from what the 2026-08-19 leak actually shipped.
//
// Scope note: this list targets snippet CONTENT, not vocabulary. SELECTION_TRIGGERS
// still carries industry words ('presupuesto', 'minimum stay') as match keywords
// and customer-shaped snippet ids. That is a separate industry-neutrality gap
// (see the Industry-Neutral section of CLAUDE.md), tracked on its own, and adding
// those words here would make this gate fail for a reason it does not test.
const LEAK_MARKERS = ['leibtour', 'check-in:', 'ecotasa', 'airbnb'];
const contentLower = CONTENT_SRC.toLowerCase();
LEAK_MARKERS.forEach(function (m) {
  check('content.js ships no "' + m + '"', contentLower.indexOf(m), -1);
});

// ── 2. language variants ────────────────────────────────────────────
if (typeof sandbox._findLangVariants !== 'function') {
  console.error('X content.js no longer exposes _findLangVariants');
  process.exit(1);
}
function langsOf(map) { return Object.keys(map).sort(); }

// Duplicate same-language siblings: one entry per language, first row wins.
sandbox.snippets = [
  { id: 'a1', lang_group_id: 'g', shortcut: 'x', lang: 'ES', body: 'ES first',  bodies: {} },
  { id: 'a2', lang_group_id: 'g', shortcut: 'x', lang: 'ES', body: 'ES second', bodies: {} },
  { id: 'a3', lang_group_id: 'g', shortcut: 'x', lang: 'IT', body: 'IT one',    bodies: {} },
];
let m = sandbox._findLangVariants(sandbox.snippets[0]);
check('duplicate siblings collapse per language', langsOf(m), ['ES', 'IT']);
check('first row wins for a duplicated language', m.ES.id, 'a1');

// A language that exists ONLY in a bodies map still surfaces when the group
// already has two or more sibling rows. This is the case that hid English.
sandbox.snippets = [
  { id: 'b1', lang_group_id: 'g', shortcut: 'y', lang: 'ES', body: 'ES', bodies: { EN: 'EN from bodies' } },
  { id: 'b2', lang_group_id: 'g', shortcut: 'y', lang: 'IT', body: 'IT', bodies: {} },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('bodies-only language surfaces in a multi-row group', langsOf(m), ['EN', 'ES', 'IT']);
check('bodies-only variant carries its own body', m.EN.body, 'EN from bodies');
check('a real row still beats a bodies entry', m.ES.body, 'ES');

// The single-row dashboard model keeps working.
sandbox.snippets = [
  { id: 'c1', lang_group_id: null, shortcut: 'z', lang: 'EN', body: 'EN',
    bodies: { EN: 'EN', IT: 'IT body', ES: 'ES body' } },
];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('single row expands its bodies map', langsOf(m), ['EN', 'ES', 'IT']);

// A lone snippet with no translations stays lone (the picker inserts directly
// instead of opening the language modal).
sandbox.snippets = [{ id: 'd1', lang_group_id: null, shortcut: 'w', lang: 'EN', body: 'only', bodies: {} }];
m = sandbox._findLangVariants(sandbox.snippets[0]);
check('a lone snippet reports one variant', langsOf(m), ['EN']);

// -- 3. the signed-out picker says what to do ------------------------
// An empty library must not render as a bare "No matches": that is what a
// signed-out install now shows, and it has to point at sign-in.
if (typeof sandbox._renderPickerItems === 'function') {
  const itemsBox = { innerHTML: '', querySelectorAll: () => [] };
  sandbox.triggerPickerEl = { querySelector: () => itemsBox };
  sandbox.triggerPickerMode = 'snippet';

  sandbox.snippets = [];
  sandbox.hasSession = false;
  sandbox._renderPickerItems('');
  check('signed-out empty library points at sign-in', /Sign in/.test(itemsBox.innerHTML), true);

  sandbox.hasSession = true;
  sandbox._renderPickerItems('');
  check('signed-in empty library points at the dashboard', /dashboard/.test(itemsBox.innerHTML), true);

  sandbox.snippets = [{ id: 'e1', shortcut: 'hello', title: 'Hello', lang: 'EN', body: 'hi', bodies: {} }];
  sandbox._renderPickerItems('zzz');
  check('a query that matches nothing still says No matches', /No matches/.test(itemsBox.innerHTML), true);
  sandbox.triggerPickerEl = null;
} else {
  console.error('X content.js no longer exposes _renderPickerItems');
  failed++;
}

if (failed) { console.error('\nX ' + failed + ' check(s) failed'); process.exit(1); }
console.log('OK lang-variants + shipped-content gate');
