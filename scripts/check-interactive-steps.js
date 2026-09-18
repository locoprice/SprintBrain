#!/usr/bin/env node
// INTERACTIVE STEPS gate.
//
// "Interactive Steps" puts a block before a prompt when SprintBrain hands it
// out. It is decided once in extension/shared/interactive-steps.js and reaches
// five surfaces, so this gate pins what they share:
//
//   1. the module: the key, the block, and when the block is added
//   2. where the setting is stored: chrome.storage.local in the extension, a
//      plain localStorage key on the web, including under chrome-shim.js
//   3. the dashboard copy (app/src/lib/interactiveSteps.ts): same key, same
//      block, same answer for every case
//   4. the load order: manifest.json, popup.html and Sprintbrain.html load the
//      module before the code that uses it, and every copy or insert applies it
//   5. the in-page picker: the real content.js inserts a saved prompt with the
//      block only while the popup switch is on, and never changes a Base Prompt
//   6. the mobile copy, generated between markers like the other shared modules
//
// Run: node scripts/check-interactive-steps.js
//      node scripts/check-interactive-steps.js --write   (regenerates the mobile copy)

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const MODULE_PATH = path.join(ROOT, 'extension', 'shared', 'interactive-steps.js');
const MOBILE_PATH = path.join(ROOT, 'app', 'public', 'mobile', 'index.html');
const BEGIN = '<!-- SB_INTERACTIVE_STEPS:BEGIN (generated from extension/shared/interactive-steps.js by scripts/check-interactive-steps.js --write, do not edit) -->';
const END = '<!-- SB_INTERACTIVE_STEPS:END -->';
// Mobile's own script starts right after the fill-form block, and the module has
// to be defined by then.
const MOBILE_ANCHOR = '<!-- SB_FILL_FORM:END -->';

let failed = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) { console.error('X ' + name + '\n    expected ' + e + '\n    got      ' + a); failed++; return; }
  console.log('  ok  ' + name);
}

// Windows checkouts can hold CRLF while every committed blob is LF.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

const MODULE_SRC = readText(MODULE_PATH);
const S = require(MODULE_PATH);
const PROMPT = '## Objective\nTighten this paragraph.';
const WITH_BLOCK = S.BLOCK + '\n\n' + PROMPT;

// ── 1. the module ─────────────────────────────────────────────────────
check('key is sb_interactive_steps_enabled', S.KEY, 'sb_interactive_steps_enabled');
check('block opens with the tag', S.BLOCK.split('\n')[0], '<INTERACTIVE_STEPS>');
check('block closes with the tag', S.BLOCK.split('\n').pop(), '</INTERACTIVE_STEPS>');
check('off hands out the prompt as written', S.apply(PROMPT, false), PROMPT);
check('on puts the block and a blank line first', S.apply(PROMPT, true), WITH_BLOCK);
check('an empty prompt stays empty', S.apply('', true), '');
check('a blank prompt stays blank', S.apply('  \n', true), '  \n');
check('missing text hands out nothing', S.apply(undefined, true), '');
check('the block is never added twice', S.apply(WITH_BLOCK, true), WITH_BLOCK);
check('only an explicit on counts',
  [true, 'true', false, 'false', undefined, null, 1, 'yes'].map(S.isOn),
  [true, true, false, false, false, false, false, false]);

// ── 2. where the setting is stored ────────────────────────────────────
function memoryLocalStorage() {
  const data = {};
  return {
    data,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
  };
}

function chromeStorage(area) {
  return {
    get: (keys, cb) => {
      const out = {};
      [].concat(keys).forEach((k) => { if (Object.prototype.hasOwnProperty.call(area, k)) out[k] = area[k]; });
      cb(out);
    },
    set: (obj, cb) => { Object.assign(area, obj); if (cb) cb(); },
    remove: () => {},
  };
}

function runModule(host) {
  const sandbox = Object.assign({ console }, host);
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MODULE_SRC, sandbox);
  return sandbox.SBInteractiveSteps;
}

function stored(api) {
  let value;
  api.load((on) => { value = on; });
  return value;
}

{
  const area = {};
  const page = memoryLocalStorage();
  const api = runModule({
    localStorage: page,
    chrome: { runtime: { id: 'extension', lastError: null }, storage: { local: chromeStorage(area) } },
  });
  check('extension: off until switched on', stored(api), false);
  api.save(true);
  check('extension: kept as a boolean in chrome.storage.local', area[S.KEY], true);
  check('extension: nothing written to the page', Object.keys(page.data), []);
  check('extension: reads back on', stored(api), true);
}
{
  const page = memoryLocalStorage();
  const api = runModule({ localStorage: page });
  check('web: off until switched on', stored(api), false);
  api.save(true);
  check('web: kept under its own localStorage key', page.data[S.KEY], 'true');
  check('web: reads back on', stored(api), true);
  api.save(false);
  check('web: reads back off', stored(api), false);
}
{
  const area = {};
  const page = memoryLocalStorage();
  const api = runModule({
    localStorage: page,
    chrome: { runtime: { id: 'sprintbrain-web-shim', lastError: null }, storage: { local: chromeStorage(area) } },
  });
  api.save(true);
  check('Sprintbrain.html: chrome-shim is not used', Object.keys(area), []);
  check('Sprintbrain.html: kept under the plain localStorage key', page.data[S.KEY], 'true');
}

// ── 4. load order, and every copy or insert applies the block ────────
function before(text, first, then) {
  const a = text.indexOf(first), b = text.indexOf(then);
  return a !== -1 && b !== -1 && a < b;
}

// The source of one function: from its declaration to the next declaration at
// the same indent.
function fnSource(text, decl, indent) {
  const start = text.indexOf(decl);
  if (start === -1) return '';
  const next = text.indexOf('\n' + indent + 'function ', start + decl.length);
  return text.slice(start, next === -1 ? undefined : next);
}

const manifestJs = JSON.parse(readText(path.join(ROOT, 'extension', 'manifest.json'))).content_scripts[0].js;
check('manifest.json loads the module before content.js',
  manifestJs.indexOf('shared/interactive-steps.js') !== -1 &&
  manifestJs.indexOf('shared/interactive-steps.js') < manifestJs.indexOf('content/content.js'), true);

const POPUP_HTML = readText(path.join(ROOT, 'extension', 'popup', 'popup.html'));
check('popup.html loads the module before popup.js',
  before(POPUP_HTML, '<script src="../shared/interactive-steps.js"></script>', '<script src="popup.js"></script>'), true);
check('popup.html draws the switch in the Prompts tab',
  before(POPUP_HTML, 'id="prompt-main"', 'id="p-steps-on"') && before(POPUP_HTML, 'id="p-steps-on"', 'id="plist"'), true);

const SB_HTML = readText(path.join(ROOT, 'Sprintbrain.html'));
check('Sprintbrain.html loads the module before popup.js',
  before(SB_HTML, '<script src="extension/shared/interactive-steps.js"></script>', '<script src="extension/popup/popup.js"></script>'), true);

const POPUP_JS = readText(path.join(ROOT, 'extension', 'popup', 'popup.js'));
const MOBILE_HTML = readText(MOBILE_PATH);
const MODAL = readText(path.join(ROOT, 'app', 'src', 'features', 'prompts', 'PromptPreviewModal.tsx'));
const APPLY = 'SBInteractiveSteps.apply(';
check('popup copies through the module', fnSource(POPUP_JS, 'function copyPrompt(', '').indexOf(APPLY) !== -1, true);
check('Sprintbrain.html copies through the module', fnSource(SB_HTML, 'function renderPromptsMain(', '  ').indexOf(APPLY) !== -1, true);
check('mobile copies through the module', fnSource(MOBILE_HTML, 'function promptCopy(', '').indexOf(APPLY) !== -1, true);
check('mobile shares through the module', fnSource(MOBILE_HTML, 'function sharePrompt(', '').indexOf(APPLY) !== -1, true);
check('dashboard preview copies what it shows', /writeText\(output\)/.test(MODAL) && /applyInteractiveSteps\(assembled, stepsOn\)/.test(MODAL), true);
// The dashboard switch lives in the prompt editor, directly under Ask User
// Questions (Valentina, 2026-09-18). The preview window only reads it.
const EDITOR = readText(path.join(ROOT, 'app', 'src', 'features', 'prompts', 'PromptBlockEditor.tsx'));
check('dashboard: the switch sits right under Ask User Questions in the prompt editor',
  before(EDITOR, 'id="prompt-ask-user-questions"', 'id="prompt-interactive-steps"') &&
  before(EDITOR, 'id="prompt-interactive-steps"', 'Efficiency score widget'), true);
check('dashboard: the preview window has no switch of its own', MODAL.indexOf('saveInteractiveSteps') === -1, true);

// ── 5. the in-page picker, on the real content.js ─────────────────────
function bootContent(initialArea) {
  const area = Object.assign({}, initialArea);
  const changeListeners = [];
  const noop = function () {};
  const stubEl = {
    id: '', style: {}, dataset: {}, textContent: '',
    appendChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
    querySelector: () => null, querySelectorAll: () => [], getAttribute: () => null,
  };
  const local = chromeStorage(area);
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
        local,
        sync: { get: (k, cb) => cb && cb({}), set: (o, cb) => cb && cb(), remove: noop },
        onChanged: { addListener: (fn) => changeListeners.push(fn) },
      },
      runtime: { id: 'extension', lastError: null, sendMessage: noop, onMessage: { addListener: noop } },
    },
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  // manifest.json order, as far as content.js needs it.
  vm.runInContext(readText(path.join(ROOT, 'extension', 'formula-engine.js')), sandbox);
  vm.runInContext(readText(path.join(ROOT, 'extension', 'shared', 'snippet-stats.js')), sandbox);
  vm.runInContext(MODULE_SRC, sandbox);
  vm.runInContext(readText(path.join(ROOT, 'extension', 'content', 'content.js')), sandbox);

  const inserted = [];
  sandbox.insertText = function (el, text) { inserted.push(text); };
  sandbox.logEvent = noop;
  const field = { isContentEditable: false, getAttribute: () => null, value: '', selectionStart: 0, selectionEnd: 0 };

  return {
    base: sandbox.BASE_PROMPTS,
    pick(item) {
      inserted.length = 0;
      sandbox.triggerPickerMode = 'prompt';
      sandbox.triggerPickerFiltered = [item];
      sandbox.triggerPickerTarget = field;
      sandbox.triggerPickerDeleteLen = 0;
      sandbox.selectTriggerItem(0);
      return inserted.slice();
    },
    // What chrome.storage.onChanged delivers when the popup flips the switch.
    popupSets(on) {
      const oldValue = area[S.KEY];
      area[S.KEY] = on;
      const changes = {};
      changes[S.KEY] = { oldValue, newValue: on };
      changeListeners.forEach((fn) => fn(changes, 'local'));
    },
  };
}

{
  const page = bootContent({});
  const SAVED = { id: '5b1c2f10-0000-4000-8000-000000000001', title: 'Tighten a paragraph', body: PROMPT, shortcut: 'tight', _group: 'list' };
  const base = page.base[0];
  check('picker: a saved prompt goes in as written while the switch is off', page.pick(SAVED), [PROMPT]);
  page.popupSets(true);
  check('picker: follows the popup switch without a page reload', page.pick(SAVED), [WITH_BLOCK]);
  check('picker: a Base Prompt goes in as written with the switch on',
    page.pick(Object.assign({}, base, { _group: 'base' })), [base.body]);
  check('picker: a saved prompt that took a Base Prompt slot still gets the block',
    page.pick(Object.assign({}, SAVED, { title: base.title, _group: 'base' })), [WITH_BLOCK]);
  page.popupSets(false);
  check('picker: back to the written text when the switch goes off', page.pick(SAVED), [PROMPT]);
}
{
  const startsOn = {};
  startsOn[S.KEY] = true;
  const page = bootContent(startsOn);
  check('picker: a page opened with the switch on adds the block',
    page.pick({ id: 'p2', title: 'Plan', body: PROMPT, _group: 'list' }), [WITH_BLOCK]);
}

// ── 6. the mobile copy ────────────────────────────────────────────────
// The block is a script of its own. Placed inside mobile's <script>, it leaves
// the app's code outside any tag and the phone prints that code as text.
if (MOBILE_HTML.indexOf(BEGIN) !== -1) {
  const beforeBlock = MOBILE_HTML.slice(0, MOBILE_HTML.indexOf(BEGIN));
  check('mobile: the block does not open inside another script',
    (beforeBlock.match(/<script\b/g) || []).length - (beforeBlock.match(/<\/script>/g) || []).length, 0);
  check('mobile: its own script opens right after the block',
    MOBILE_HTML.slice(MOBILE_HTML.indexOf(END) + END.length).trimStart().startsWith('<script>'), true);
}

function mobileBlock() {
  return BEGIN + '\n<script>\n' + MODULE_SRC.trimEnd() + '\n</script>\n' + END;
}

function syncMobile(write) {
  let html = readText(MOBILE_PATH);
  const desired = mobileBlock();
  const start = html.indexOf(BEGIN);
  const stop = html.indexOf(END);
  if (start !== -1 && stop !== -1) {
    if (html.slice(start, stop + END.length) === desired) return 'ok';
    if (!write) return 'drift';
    html = html.slice(0, start) + desired + html.slice(stop + END.length);
  } else {
    if (!write) return 'missing';
    const anchor = html.indexOf(MOBILE_ANCHOR);
    if (anchor === -1) throw new Error('mobile/index.html has no ' + MOBILE_ANCHOR + ' to place the block after');
    const at = anchor + MOBILE_ANCHOR.length;
    html = html.slice(0, at) + '\n' + desired + html.slice(at);
  }
  fs.writeFileSync(MOBILE_PATH, html);
  return 'written';
}

async function main() {
  // ── 3. the dashboard copy ───────────────────────────────────────────
  const ts = await import(pathToFileURL(path.join(ROOT, 'app', 'src', 'lib', 'interactiveSteps.ts')).href);
  check('dashboard: same key', ts.INTERACTIVE_STEPS_KEY, S.KEY);
  check('dashboard: same block', ts.INTERACTIVE_STEPS_BLOCK, S.BLOCK);
  [
    ['off', PROMPT, false],
    ['on', PROMPT, true],
    ['empty', '', true],
    ['blank', '  \n', true],
    ['already carries the block', WITH_BLOCK, true],
    ['block after leading space', '  ' + WITH_BLOCK, true],
  ].forEach(([name, text, on]) => {
    check('dashboard: same text when ' + name, ts.applyInteractiveSteps(text, on), S.apply(text, on));
  });

  const result = syncMobile(process.argv.includes('--write'));
  if (result === 'ok') console.log('  ok  mobile carries the current module');
  else if (result === 'written') console.log('SYNC mobile/index.html interactive-steps block updated');
  else {
    failed++;
    console.error('X mobile/index.html ' + (result === 'missing' ? 'has no interactive-steps block' : 'interactive-steps block has drifted') +
      ' -> run: node scripts/check-interactive-steps.js --write');
  }

  if (failed) {
    console.error('\nX Interactive Steps gate: ' + failed + ' check(s) failed');
    process.exit(1);
  }
  console.log('OK Interactive Steps gate');
}

main().catch((e) => {
  console.error('X Interactive Steps gate crashed: ' + (e && e.stack || e));
  process.exit(1);
});
