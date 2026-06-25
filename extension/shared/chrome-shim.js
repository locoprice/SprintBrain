// ─────────────────────────────────────────────────────────────────
// SPRINTBRAIN — chrome-shim.js
// Web-platform adapter for the SHARED business-logic core.
//
// Purpose: let the exact same extension scripts (auth.js, notion-sync.js,
// sync-deletion.js, popup.js, formula-engine.js) run unchanged inside a plain
// web page (the Sprintbrain.html dashboard), where the Chrome extension APIs
// do not exist. It polyfills only the `chrome.*` surface those scripts touch:
//
//   chrome.storage.local / chrome.storage.sync   →  window.localStorage
//   chrome.storage.onChanged                      →  in-tab + cross-tab events
//   chrome.runtime.getManifest / sendMessage      →  metadata + graceful no-op
//   chrome.runtime.lastError / id / onMessage     →  inert
//   chrome.tabs.query / create / update           →  window.open / no-op
//   chrome.windows.update / create                →  window.open / no-op
//
// Source of truth: Supabase (the data layer in popup.js already syncs there).
// localStorage is only the web surface's LOCAL MIRROR, exactly as
// chrome.storage.local is the extension's local mirror. Both reconcile through
// Supabase, so a dashboard write is visible to the extension popup on its next
// load/sync — and vice-versa.
//
// Install rule: this is a NO-OP when a real extension `chrome.storage.local`
// is present, so it can never shadow native APIs. Only the dashboard loads it.
//
// ES5-only (no arrow functions / modules) to match the rest of the core and
// run verbatim in any browser. Must be loaded BEFORE the shared scripts.
// ─────────────────────────────────────────────────────────────────

(function (root) {
  'use strict';

  // Real extension context → leave the native API untouched.
  if (typeof root.chrome !== 'undefined' &&
      root.chrome.storage && root.chrome.storage.local &&
      typeof root.chrome.storage.local.get === 'function') {
    return;
  }

  // No DOM/Storage at all (e.g. a worker without localStorage) → cannot shim.
  if (typeof root.localStorage === 'undefined') {
    return;
  }

  var LS = root.localStorage;

  // localStorage backing keys — one JSON blob per storage area.
  var BACKING = { local: '__sb_chrome_local__', sync: '__sb_chrome_sync__' };

  function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  // Run a callback asynchronously, mirroring chrome.storage's async contract.
  // This is what guarantees ordering like loadNotionCfg() → _runNotionSync():
  // dependent work lives inside the callback, so it always runs AFTER the read.
  function async(fn) { Promise.resolve().then(fn); }

  function readArea(area) {
    try {
      var raw = LS.getItem(BACKING[area]);
      var obj = raw ? JSON.parse(raw) : {};
      return (obj && typeof obj === 'object') ? obj : {};
    } catch (e) { return {}; }
  }

  function writeArea(area, store) {
    try { LS.setItem(BACKING[area], JSON.stringify(store)); } catch (e) {}
  }

  // ── onChanged registry (chrome's onChanged is global; the listener receives
  //    the areaName). Shared by both areas; fired in-tab on writes and
  //    cross-tab via the window 'storage' event. ───────────────────────────
  var changeListeners = [];

  function fireChanged(area, changes) {
    if (!changes || !Object.keys(changes).length) return;
    async(function () {
      for (var i = 0; i < changeListeners.length; i++) {
        try { changeListeners[i](changes, area); } catch (e) {}
      }
    });
  }

  // ── get(keys, cb) — keys: null | string | string[] | object(defaults).
  //    Matches chrome semantics: string/array omit absent keys; object form
  //    fills absent keys with the supplied default. Returns a Promise when no
  //    callback is supplied (MV3 promise form). ──────────────────────────────
  function areaGet(area, keys, cb) {
    var store = readArea(area);
    var result = {};
    if (keys === null || keys === undefined) {
      result = store;
    } else if (typeof keys === 'string') {
      if (hasOwn(store, keys)) result[keys] = store[keys];
    } else if (Array.isArray(keys)) {
      for (var i = 0; i < keys.length; i++) {
        if (hasOwn(store, keys[i])) result[keys[i]] = store[keys[i]];
      }
    } else if (typeof keys === 'object') {
      var ks = Object.keys(keys);
      for (var j = 0; j < ks.length; j++) {
        var k = ks[j];
        result[k] = hasOwn(store, k) ? store[k] : keys[k];
      }
    }
    if (typeof cb === 'function') { async(function () { cb(result); }); return; }
    return Promise.resolve(result);
  }

  function areaSet(area, obj, cb) {
    var store = readArea(area);
    var changes = {};
    if (obj && typeof obj === 'object') {
      var ks = Object.keys(obj);
      for (var i = 0; i < ks.length; i++) {
        var k = ks[i];
        var oldV = hasOwn(store, k) ? store[k] : undefined;
        var newV = obj[k];
        if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
          changes[k] = { oldValue: oldV, newValue: newV };
        }
        store[k] = newV;
      }
    }
    writeArea(area, store);
    fireChanged(area, changes);
    if (typeof cb === 'function') { async(cb); return; }
    return Promise.resolve();
  }

  function areaRemove(area, keys, cb) {
    var arr = typeof keys === 'string' ? [keys] : (Array.isArray(keys) ? keys : []);
    var store = readArea(area);
    var changes = {};
    for (var i = 0; i < arr.length; i++) {
      var k = arr[i];
      if (hasOwn(store, k)) {
        changes[k] = { oldValue: store[k], newValue: undefined };
        delete store[k];
      }
    }
    writeArea(area, store);
    fireChanged(area, changes);
    if (typeof cb === 'function') { async(cb); return; }
    return Promise.resolve();
  }

  function areaClear(area, cb) {
    var store = readArea(area);
    var changes = {};
    var ks = Object.keys(store);
    for (var i = 0; i < ks.length; i++) {
      changes[ks[i]] = { oldValue: store[ks[i]], newValue: undefined };
    }
    writeArea(area, {});
    fireChanged(area, changes);
    if (typeof cb === 'function') { async(cb); return; }
    return Promise.resolve();
  }

  function makeArea(area) {
    return {
      get:    function (keys, cb) { return areaGet(area, keys, cb); },
      set:    function (obj, cb)  { return areaSet(area, obj, cb); },
      remove: function (keys, cb) { return areaRemove(area, keys, cb); },
      clear:  function (cb)       { return areaClear(area, cb); }
    };
  }

  // Cross-tab propagation: the window 'storage' event fires in OTHER tabs only,
  // so this never double-fires with the in-tab dispatch above. Gives the
  // dashboard free live sync across its own tabs.
  if (typeof root.addEventListener === 'function') {
    root.addEventListener('storage', function (e) {
      if (!e || !e.key) return;
      var area = e.key === BACKING.local ? 'local'
               : e.key === BACKING.sync  ? 'sync' : null;
      if (!area) return;
      var oldStore = {}, newStore = {};
      try { oldStore = e.oldValue ? JSON.parse(e.oldValue) : {}; } catch (x) {}
      try { newStore = e.newValue ? JSON.parse(e.newValue) : {}; } catch (x) {}
      var changes = {}, k;
      for (k in newStore) {
        if (hasOwn(newStore, k) &&
            JSON.stringify(oldStore[k]) !== JSON.stringify(newStore[k])) {
          changes[k] = { oldValue: oldStore[k], newValue: newStore[k] };
        }
      }
      for (k in oldStore) {
        if (hasOwn(oldStore, k) && !hasOwn(newStore, k)) {
          changes[k] = { oldValue: oldStore[k], newValue: undefined };
        }
      }
      fireChanged(area, changes);
    });
  }

  // ── chrome.runtime — metadata + graceful no-ops ──────────────────────────
  // getManifest() reads window.__SB_MANIFEST__ (set inline by the dashboard so
  // the version stays owned by one file) and falls back to a safe default.
  function getManifest() {
    var m = root.__SB_MANIFEST__;
    if (m && typeof m === 'object') return m;
    return { name: 'SprintBrain', version: '0.0.0', manifest_version: 3 };
  }

  function runtimeSendMessage() {
    // Args may be (msg), (msg, cb), (extId, msg, cb). The only forms the core
    // uses are fire-and-forget notifications (REFRESH_MENUS, auth_changed),
    // which have no meaning on the web → swallow. Invoke a trailing callback
    // (if any) asynchronously with no response, matching chrome.
    var cb = arguments.length && typeof arguments[arguments.length - 1] === 'function'
      ? arguments[arguments.length - 1] : null;
    if (cb) async(function () { cb(undefined); });
    return undefined;
  }

  // ── chrome.tabs / chrome.windows — open links in a new browser tab ───────
  function tabsQuery(_info, cb) {
    // No extension-tab concept on the web; report none so callers fall through
    // to their create() branch (e.g. openDashboard()).
    if (typeof cb === 'function') { async(function () { cb([]); }); return; }
    return Promise.resolve([]);
  }

  function tabsCreate(props, cb) {
    var url = props && props.url;
    var win = null;
    if (url) { try { win = root.open(url, '_blank', 'noopener'); } catch (e) {} }
    var tab = { id: -1, url: url || '', active: true };
    if (typeof cb === 'function') { async(function () { cb(tab); }); return; }
    return Promise.resolve(tab);
  }

  function noopCb(_a, cb) {
    var fn = typeof arguments[arguments.length - 1] === 'function'
      ? arguments[arguments.length - 1] : null;
    if (fn) async(function () { fn(); });
  }

  var shim = {
    storage: {
      local: makeArea('local'),
      sync:  makeArea('sync'),
      onChanged: {
        addListener: function (fn) {
          if (typeof fn === 'function' && changeListeners.indexOf(fn) === -1) {
            changeListeners.push(fn);
          }
        },
        removeListener: function (fn) {
          var i = changeListeners.indexOf(fn);
          if (i !== -1) changeListeners.splice(i, 1);
        },
        hasListener: function (fn) { return changeListeners.indexOf(fn) !== -1; }
      }
    },
    runtime: {
      id: 'sprintbrain-web-shim',
      lastError: undefined,
      getManifest: getManifest,
      sendMessage: runtimeSendMessage,
      onMessage: { addListener: function () {}, removeListener: function () {} }
    },
    tabs: {
      query:  tabsQuery,
      create: tabsCreate,
      update: function () { return noopCb.apply(null, arguments); }
    },
    windows: {
      update: function () { return noopCb.apply(null, arguments); },
      create: function (props, cb) { return tabsCreate(props, cb); }
    }
  };

  // Merge onto any partial chrome object rather than clobbering it.
  if (typeof root.chrome === 'undefined') {
    root.chrome = shim;
  } else {
    if (!root.chrome.storage) root.chrome.storage = shim.storage;
    if (!root.chrome.runtime) root.chrome.runtime = shim.runtime;
    if (!root.chrome.tabs)    root.chrome.tabs    = shim.tabs;
    if (!root.chrome.windows) root.chrome.windows = shim.windows;
  }

})(typeof window !== 'undefined' ? window : this);
