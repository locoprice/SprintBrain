// Trigger-expansion behavior gate (EXPANSION-001).
//
// Pins WHEN a typed trigger expands and HOW MANY characters it removes — the
// two numbers that decide whether the field is left clean.
//
// The bug this gate exists for: a shortcut that is also the opening of a longer
// word fired the instant it matched. Typing "::neobooking" expanded "::neob" at
// the sixth character and stranded "ooking" in the message; "::forms" could
// never be reached because "::form" fired one character earlier. A match now
// settles before it expands (see _armMatch in content.js) and a further letter
// drops it, so the longer trigger gets its turn.
//
// The real content.js runs in a vm context with the DOM surface it touches at
// load time stubbed out. Keystrokes go through the SHIPPING keydown listener,
// and handleMatch is intercepted so each case can assert the snippet that fired
// and the delete span, against a plain-string model of the field.
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function fail(msg) {
  console.error('X ' + msg);
  process.exit(1);
}

const ENGINE_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'formula-engine.js'), 'utf8');
const CONTENT_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extension', 'content', 'content.js'), 'utf8');

// Mirrors the production shapes that collide: a shortcut that opens a longer
// word ("neob"), a shortcut that is the prefix of another ("form"/"forms"), and
// an alternative query that spells the word the user actually types.
const LIBRARY = [
  { id: 'neob',  shortcut: 'neob',  title: 'NEO BOOKING', lang: 'ES',
    alternative_queries: ['booking', 'neobooking'], body: 'NEOB BODY' },
  { id: 'form',  shortcut: 'form',  title: 'JOT FORM',  lang: 'ES', body: 'FORM BODY' },
  { id: 'forms', shortcut: 'forms', title: 'JOT FORMS', lang: 'ES', body: 'FORMS BODY' },
  { id: 'time',  shortcut: 'time',  title: 'TIME',      lang: 'EN', body: 'TIME BODY' },
];

// ── minimal host: only what content.js touches while loading ────────
const listeners = {};
const noop = function () {};
const stubEl = {
  id: '', style: {}, dataset: {}, textContent: '',
  appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
  querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
};
const RECT = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  innerWidth: 1280, innerHeight: 800,
  document: {
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: noop,
    createElement: () => Object.assign({}, stubEl),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    head: Object.assign({}, stubEl),
    body: Object.assign({}, stubEl),
    activeElement: null,
  },
  chrome: {
    storage: {
      local: { get: (k, cb) => cb && cb({ snippets: LIBRARY }), set: (o, cb) => cb && cb() },
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
  fail('content.js failed to evaluate in the gate context: ' + e.message);
}
if (typeof sandbox.checkBuf !== 'function') fail('content.js no longer exposes checkBuf');
if (typeof sandbox._armMatch !== 'function') {
  fail('content.js no longer arms a match before expanding.\n' +
    '  Expanding the instant a shortcut matches strands the rest of the word in\n' +
    '  the field (typing "::neobooking" fired "::neob" and left "ooking").');
}
const onKeyDown = (listeners.keydown || [])[0];
if (!onKeyDown) fail('content.js no longer registers a keydown listener');

// ── field model + intercepted expansion ─────────────────────────────
// The field is a live textarea model so the REAL handleMatch runs, including
// the span correction that reads the text in front of the caret. Interception
// sits one level lower, at deleteChars — the call that finally decides how many
// characters leave the field.
let fired = null;   // { id, span, result }

const target = {
  tagName: 'TEXTAREA', value: '', selectionStart: 0, selectionEnd: 0,
  closest: () => null, getAttribute: () => null,
  getBoundingClientRect: () => RECT,   // the picker anchors to the field's box
  focus: noop, setSelectionRange: noop,
};

function setField(text) {
  target.value = text;
  target.selectionStart = target.selectionEnd = text.length;
}

sandbox.deleteChars = function (el, n, cb) {
  fired = { span: n, result: target.value.slice(0, Math.max(0, target.value.length - n)) };
  if (cb) cb();
};
sandbox._proceedInsert = function (el, snip) {
  if (fired) { fired.id = snip.id; fired.result += '<' + snip.id + '>'; }
  sandbox.processing = false;
};
sandbox.injectLangModal = function () { fail('unexpected language modal in a single-variant fixture'); };

function key(k) {
  let prevented = false;
  onKeyDown({ key: k, target: target, ctrlKey: false, metaKey: false,
              preventDefault: () => { prevented = true; }, stopPropagation: noop });
  if (!prevented && k.length === 1) setField(target.value + k);
  return prevented;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function typeText(text, gapMs) {
  for (const ch of text) { key(ch); await wait(gapMs); }
}

async function reset() {
  sandbox.closeTriggerPicker();   // a case may leave the suggestion menu open
  sandbox._cancelArmed();
  sandbox.buf = '';
  sandbox.processing = false;
  sandbox.triggerPending = false;
  sandbox.triggerAffix = '';
  fired = null;
  setField('');
  await wait(60);
}

// SETTLE must outlast MATCH_SETTLE_MS in content.js; read it rather than guess.
const SETTLE = sandbox.MATCH_SETTLE_MS + 150;
const FAST = 60;    // a burst well inside the settle window

const cases = [
  { name: 'over-typed trigger ("::neobooking") does not fire mid-word',
    run: async () => { await typeText('::neobooking', FAST); await wait(SETTLE); },
    expect: { id: 'neob', span: 12, result: '<neob>' } },

  { name: 'exact trigger then a pause still expands',
    run: async () => { await typeText('::time', FAST); await wait(SETTLE); },
    expect: { id: 'time', span: 6, result: '<time>' } },

  { name: 'space confirms and is consumed with the trigger',
    run: async () => { setField('hola '); await typeText('::time ', FAST); await wait(200); },
    expect: { id: 'time', span: 7, result: 'hola <time>' } },

  { name: 'longer shortcut reaches its own snippet ("::forms")',
    run: async () => { await typeText('::forms', FAST); await wait(SETTLE); },
    expect: { id: 'forms', span: 7, result: '<forms>' } },

  { name: 'shorter shortcut alone still wins ("::form")',
    run: async () => { await typeText('::form', FAST); await wait(SETTLE); },
    expect: { id: 'form', span: 6, result: '<form>' } },

  { name: 'unknown tail expands nothing and keeps the text',
    run: async () => { await typeText('::timeXYZ', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'Enter confirms instead of sending the raw trigger',
    run: async () => {
      await typeText('::time', FAST);
      if (!key('Enter')) fail('Enter was not consumed while a match was armed — the raw trigger would be sent');
      await wait(120);
    },
    expect: { id: 'time', span: 6, result: '<time>' } },

  { name: 'Tab confirms an armed match',
    run: async () => { await typeText('::time', FAST); key('Tab'); await wait(120); },
    expect: { id: 'time', span: 6, result: '<time>' } },

  // Unique-prefix expansion — the operator should not have to type a shortcut
  // in full when only one snippet can still be meant.
  { name: 'prefix "::neo" expands NEO BOOKING',
    run: async () => { await typeText('::neo', FAST); await wait(SETTLE); },
    expect: { id: 'neob', span: 5, result: '<neob>' } },

  { name: 'prefix keeps the text before it intact',
    run: async () => { setField('hola '); await typeText('::neo', FAST); await wait(SETTLE); },
    expect: { id: 'neob', span: 5, result: 'hola <neob>' } },

  { name: 'two-letter prefix "::ne" still resolves to one snippet',
    run: async () => { await typeText('::ne', FAST); await wait(SETTLE); },
    expect: { id: 'neob', span: 4, result: '<neob>' } },

  { name: 'ambiguous prefix "::fo" expands nothing (form vs forms)',
    run: async () => { await typeText('::fo', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'single letter "::n" is below the prefix floor',
    run: async () => { await typeText('::n', FAST); await wait(SETTLE); },
    expect: null },

  { name: 'space confirms a prefix too, and is consumed with it',
    run: async () => { await typeText('::neo ', FAST); await wait(200); },
    expect: { id: 'neob', span: 6, result: '<neob>' } },

  { name: 'a trigger sitting inside a word expands nothing',
    run: async () => { await typeText('ratio::xyz', FAST); await wait(SETTLE); },
    expect: null },
];

// ── span correction (measured from the field, not counted) ──────────
// Every counter that feeds a delete span can drift from the field — a menu that
// swallows a keystroke, an editor that rewrites what it received. When it does,
// the deletion must still start at the trigger: the alternative is a piece of
// the trigger stranded in the message ("::ne" in front of the snippet).
const spanCases = [
  { name: 'count 4 short is corrected back to the trigger',
    value: '::neobooking', span: 8,  expect: 12 },
  { name: 'count reduced to the bare trigger is corrected',
    value: '::neob',       span: 2,  expect: 6 },
  { name: 'text before the trigger is never touched',
    value: 'hola ::neob',  span: 2,  expect: 6 },
  { name: 'a correct count is left alone',
    value: 'hola ::time',  span: 6,  expect: 6 },
  { name: 'a trailing space confirmed the trigger — count stands',
    value: 'hola ::time ', span: 7,  expect: 7 },
  { name: 'no trigger in front of the caret — count stands',
    value: 'plain text',   span: 4,  expect: 4 },
  { name: 'a word break means the trigger was abandoned — count stands',
    value: '::neo hola',   span: 4,  expect: 4 },
];

function runSpanCases() {
  for (const c of spanCases) {
    setField(c.value);
    const got = sandbox._fieldTriggerSpan(target, c.span);
    if (got !== c.expect) {
      fail('span case "' + c.name + '" -> got ' + got + ', expected ' + c.expect +
        '\n  field ' + JSON.stringify(c.value) + ', counted span ' + c.span);
    }
  }
}

(async () => {
  for (const c of cases) {
    await reset();
    await c.run();
    if (!c.expect) {
      if (fired) {
        fail('case "' + c.name + '" -> expanded ' + fired.id + ' (span ' + fired.span + '), expected nothing');
      }
      continue;
    }
    if (!fired) fail('case "' + c.name + '" -> nothing expanded, expected ' + c.expect.id);
    if (fired.id !== c.expect.id) {
      fail('case "' + c.name + '" -> expanded ' + fired.id + ', expected ' + c.expect.id);
    }
    if (fired.span !== c.expect.span) {
      fail('case "' + c.name + '" -> delete span ' + fired.span + ', expected ' + c.expect.span +
        '\n  A wrong span leaves part of the trigger in the field, or eats the message before it.');
    }
    if (fired.result !== c.expect.result) {
      fail('case "' + c.name + '" -> field ' + JSON.stringify(fired.result) +
        ', expected ' + JSON.stringify(c.expect.result));
    }
  }
  runSpanCases();
  // selectTriggerItem feeds the picker's own tally into the same deletion, so it
  // must correct it too — an untested call site is how the residue came back.
  const pickerFn = CONTENT_SRC.slice(CONTENT_SRC.indexOf('function selectTriggerItem('));
  if (!pickerFn.slice(0, pickerFn.indexOf('\nfunction ')).includes('_fieldTriggerSpan(el, dLen)')) {
    fail('selectTriggerItem no longer corrects the picker delete span against the field.\n' +
      '  Confirming from the suggestion menu would clip the wrong characters and\n' +
      '  leave part of the trigger in the message.');
  }
  console.log('OK Trigger expansion passed all ' + (cases.length + spanCases.length + 1) + ' cases');
})();
