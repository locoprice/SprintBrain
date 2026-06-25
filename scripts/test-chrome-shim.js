// ─────────────────────────────────────────────────────────────────
// test-chrome-shim.js — verification gate for extension/shared/chrome-shim.js
//
// The shim is the only NEW logic in the dashboard parity work; the four shared
// scripts are unchanged extension code. This test loads the shim into a
// simulated browser global and asserts it reproduces chrome.storage / runtime /
// tabs semantics exactly, so the shared core behaves identically on the web.
//
// Plain-Node assertions (same style as check-version.js). Run: node scripts/test-chrome-shim.js
// ─────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SHIM = path.resolve(__dirname, '..', 'extension', 'shared', 'chrome-shim.js');

// ── Minimal browser globals: a Map-backed localStorage + a storage-event bus ──
function makeWindow() {
  const map = new Map();
  const listeners = { storage: [] };
  const win = {
    localStorage: {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
    },
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    open: (...args) => { win.__opened.push(args); return { closed: false }; },
    __opened: [],
    __listeners: listeners,
    Promise, JSON, Object, Array, setTimeout,
  };
  return win;
}

function loadShim(win) {
  const src = fs.readFileSync(SHIM, 'utf8');
  // The shim is an IIFE keyed off `window`; run it with our fake window in scope.
  // eslint-disable-next-line no-new-func
  new Function('window', src)(win);
  return win.chrome;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

(async function run() {
  const win = makeWindow();
  win.__SB_MANIFEST__ = { name: 'SprintBrain', version: '9.9.9', manifest_version: 3 };
  const chrome = loadShim(win);

  // 0) Surface present
  assert.ok(chrome && chrome.storage && chrome.storage.local, 'chrome.storage.local missing');
  assert.equal(typeof chrome.storage.local.get, 'function', 'local.get not a function');
  assert.equal(typeof chrome.storage.sync.get, 'function', 'sync.get not a function');

  // 1) set + get (callback form) — async contract: callback fires after the call
  let order = [];
  chrome.storage.local.set({ a: 1, b: { x: 2 } }, () => { order.push('set-cb'); });
  order.push('after-set');
  await tick();
  assert.deepEqual(order, ['after-set', 'set-cb'], 'storage callbacks must be async');

  // 2) get string key → only that key; absent key omitted
  let g1 = await chrome.storage.local.get('a');
  assert.deepEqual(g1, { a: 1 }, 'get(string) present');
  let g2 = await chrome.storage.local.get('missing');
  assert.deepEqual(g2, {}, 'get(string) absent → {}');

  // 3) get array → present keys only
  let g3 = await chrome.storage.local.get(['a', 'b', 'missing']);
  assert.deepEqual(g3, { a: 1, b: { x: 2 } }, 'get(array)');

  // 4) get object(defaults) → fills absent with default, keeps present
  let g4 = await chrome.storage.local.get({ a: 0, missing: 'def' });
  assert.deepEqual(g4, { a: 1, missing: 'def' }, 'get(defaults)');

  // 5) get(null) → all
  let g5 = await chrome.storage.local.get(null);
  assert.deepEqual(g5, { a: 1, b: { x: 2 } }, 'get(null) → all');

  // 6) remove → key gone
  await chrome.storage.local.remove('a');
  assert.deepEqual(await chrome.storage.local.get('a'), {}, 'remove(string)');
  await chrome.storage.local.remove(['b']);
  assert.deepEqual(await chrome.storage.local.get(null), {}, 'remove(array)');

  // 7) areas are independent
  await chrome.storage.sync.set({ trigger: '::' });
  assert.deepEqual(await chrome.storage.sync.get('trigger'), { trigger: '::' }, 'sync set/get');
  assert.deepEqual(await chrome.storage.local.get('trigger'), {}, 'local/sync isolated');

  // 8) onChanged fires with (changes, areaName), async, only for real changes
  let events = [];
  chrome.storage.onChanged.addListener((changes, area) => { events.push({ changes, area }); });
  chrome.storage.local.set({ k: 'v1' });
  await tick();
  assert.equal(events.length, 1, 'onChanged fired once');
  assert.equal(events[0].area, 'local', 'onChanged area');
  assert.deepEqual(events[0].changes.k, { oldValue: undefined, newValue: 'v1' }, 'onChanged change shape');
  // setting the same value again → no change event
  events = [];
  chrome.storage.local.set({ k: 'v1' });
  await tick();
  assert.equal(events.length, 0, 'no event when value unchanged');
  // changing it → event with oldValue
  events = [];
  chrome.storage.local.set({ k: 'v2' });
  await tick();
  assert.deepEqual(events[0].changes.k, { oldValue: 'v1', newValue: 'v2' }, 'onChanged oldValue');

  // 9) runtime
  assert.deepEqual(chrome.runtime.getManifest(), win.__SB_MANIFEST__, 'getManifest reads __SB_MANIFEST__');
  assert.equal(chrome.runtime.lastError, undefined, 'lastError undefined');
  let smCb = false;
  assert.doesNotThrow(() => chrome.runtime.sendMessage({ type: 'REFRESH_MENUS' }), 'sendMessage no-throw');
  chrome.runtime.sendMessage({ type: 'x' }, () => { smCb = true; });
  await tick();
  assert.ok(smCb, 'sendMessage trailing callback invoked');

  // 10) tabs.query → [] ; tabs.create → window.open
  let qTabs = await chrome.tabs.query({ url: 'https://x/*' });
  assert.deepEqual(qTabs, [], 'tabs.query → []');
  chrome.tabs.create({ url: 'https://app.sprintbrain.com/' });
  assert.equal(win.__opened.length, 1, 'tabs.create opened a window');
  assert.equal(win.__opened[0][0], 'https://app.sprintbrain.com/', 'tabs.create url');
  assert.doesNotThrow(() => chrome.windows.update(1, { focused: true }), 'windows.update no-throw');

  // 11) cross-tab: a 'storage' event from another tab → onChanged
  events = [];
  const blob = JSON.stringify({ k: 'v2', remote: 'hello' });
  const oldBlob = JSON.stringify({ k: 'v2' });
  win.__listeners.storage.forEach((fn) =>
    fn({ key: '__sb_chrome_local__', oldValue: oldBlob, newValue: blob }));
  await tick();
  assert.equal(events.length, 1, 'cross-tab storage event → onChanged');
  assert.deepEqual(events[0].changes.remote, { oldValue: undefined, newValue: 'hello' }, 'cross-tab diff');

  // 12) no-op guard: when a native chrome.storage.local exists, the shim must
  //     NOT overwrite it.
  const win2 = makeWindow();
  const native = { storage: { local: { get() {}, set() {}, remove() {} } } };
  win2.chrome = native;
  loadShim(win2);
  assert.strictEqual(win2.chrome, native, 'shim must not clobber a native chrome');

  console.log('OK chrome-shim: all 12 assertion groups passed');
})().catch((e) => {
  console.error('X chrome-shim test failed:', e.message);
  process.exit(1);
});
