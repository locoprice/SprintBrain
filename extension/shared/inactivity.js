// inactivity.js: the single source of truth for WHAT counts as unused.
//
// Four surfaces show the unused-asset notice and each builds its own markup:
//
//   extension/popup/popup.js       the popup strip (read-only: Review + Keep)
//   Sprintbrain.html               the same strip, plus Delete and Modify
//   app/src/features/shared/       the dashboard banner, snippets and prompts
//     InactiveAssetBanner.tsx
//   (the in-page overlay shows none: it expands, it does not manage)
//
// They keep their own markup and their own action sets, because the popup is
// read-only by design (v2.87.0) and the other two are not. What they must NOT
// keep is their own answer to "is this stale", "since when", and "what does the
// sentence say". Those are decided here, once.
//
// Staleness is measured in CALENDAR months, not in a day count: "six months
// ago" from 15 August is 15 February, which a fixed 183 days gets wrong by up to
// three days across a leap year.
//
// setMonth OVERFLOWS a short month rather than clamping it, so six months back
// from 31 August is 3 March, not 28 February. That is left as it is. It moves
// the cutoff by at most three days, only for dates in the last days of a long
// month, and in the direction of flagging sooner. Clamping it would mean a
// second rule to keep identical in two codebases, for an edge nobody can see.
//
// The anchor is the last recorded use, and a never-used asset falls back to its
// creation date. That fallback is the only honest reading: an asset created ten
// months ago and never touched is exactly what this feature is for, and it is
// invisible if a missing usage row is treated as "no information".
(function(root) {
  'use strict';

  // Where every surface keeps its copy. chrome.storage.local ONLY: the roaming
  // area is gated (scripts/check-storage.js) and a snooze is a per-device
  // decision anyway. Sprintbrain.html reaches the same key through the shim,
  // which is backed by localStorage, so the two surfaces behave identically.
  var STORAGE_KEY = 'sb_inactivity';

  var MIN_MONTHS = 6;
  var MAX_MONTHS = 9;
  var DEFAULT_MONTHS = 6;

  // How long "Keep" silences one asset. Deliberately not "forever": the point of
  // the notice is that an asset you kept and then still never used is a stronger
  // candidate for deletion three months later, not a weaker one.
  var KEEP_DAYS = 90;
  var DAY_MS = 86400000;

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  function toMs(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return isFinite(value) ? value : null;
    var t = new Date(value).getTime();
    return isFinite(t) ? t : null;
  }

  // 6 is the floor and 9 the ceiling, and anything unreadable lands on 6. A
  // stored value from a future build that widened the range must not silently
  // become "never warn", so this clamps rather than rejects.
  function clampMonths(value) {
    var n = Math.round(Number(value));
    if (!isFinite(n)) return DEFAULT_MONTHS;
    if (n < MIN_MONTHS) return MIN_MONTHS;
    if (n > MAX_MONTHS) return MAX_MONTHS;
    return n;
  }

  // The instant an asset becomes stale: anything last used before this is due.
  function cutoffMs(nowMs, months) {
    var d = new Date(nowMs);
    d.setMonth(d.getMonth() - clampMonths(months));
    return d.getTime();
  }

  function plainObject(value) {
    return (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
  }

  // Reads whatever is in storage and returns a shape the rest of the module can
  // trust. Storage can hold anything: a half-written object from an interrupted
  // write, or a key from an older build.
  function normalizeState(raw) {
    var src = plainObject(raw);
    var lastUsed = plainObject(src.lastUsed);
    var keptUntil = plainObject(src.keptUntil);
    var cleanUsed = {};
    var cleanKept = {};
    var id;
    for (id in lastUsed) {
      if (!Object.prototype.hasOwnProperty.call(lastUsed, id)) continue;
      var at = toMs(lastUsed[id]);
      if (at !== null) cleanUsed[id] = at;
    }
    for (id in keptUntil) {
      if (!Object.prototype.hasOwnProperty.call(keptUntil, id)) continue;
      var until = toMs(keptUntil[id]);
      if (until !== null) cleanKept[id] = until;
    }
    return {
      thresholdMonths: clampMonths(src.thresholdMonths),
      lastUsed: cleanUsed,
      keptUntil: cleanKept
    };
  }

  // The local mirror after one use. Kept here so the write path (content.js on
  // expansion, popup.js on copy) and the read path agree on the shape without
  // either one owning it.
  function recordUse(state, id, nowMs) {
    var next = normalizeState(state);
    if (!id) return next;
    next.lastUsed[String(id)] = nowMs;
    // Using an asset answers the question the notice asks, so the snooze that
    // was standing in for that answer is no longer needed.
    delete next.keptUntil[String(id)];
    return next;
  }

  function keepUntilMs(nowMs) {
    return nowMs + KEEP_DAYS * DAY_MS;
  }

  function recordKeep(state, id, nowMs) {
    var next = normalizeState(state);
    if (!id) return next;
    next.keptUntil[String(id)] = keepUntilMs(nowMs);
    return next;
  }

  // An asset that no longer exists must not keep a snooze or a timestamp alive
  // for ever. Called after each scan with the ids the surface can actually see.
  function pruneState(state, liveIds) {
    var next = normalizeState(state);
    var live = {};
    (liveIds || []).forEach(function(id) { live[String(id)] = true; });
    var id;
    for (id in next.lastUsed) {
      if (Object.prototype.hasOwnProperty.call(next.lastUsed, id) && !live[id]) delete next.lastUsed[id];
    }
    for (id in next.keptUntil) {
      if (Object.prototype.hasOwnProperty.call(next.keptUntil, id) && !live[id]) delete next.keptUntil[id];
    }
    return next;
  }

  // When this asset was last used, and how we know. `server` is the recorded
  // usage log, `local` the offline mirror, `created` the fallback for an asset
  // with no recorded use at all.
  //
  // The two usage sources are compared rather than ranked: the mirror is newer
  // than the server right after an expansion (the server write is fire and
  // forget), and the server is newer than the mirror on a second machine.
  function lastUsedFor(item, serverMap, state) {
    var id = String(item && item.id);
    var fromServer = toMs(serverMap ? serverMap[id] : null);
    var fromLocal = toMs(state && state.lastUsed ? state.lastUsed[id] : null);
    var used = null;
    var source = 'created';
    if (fromServer !== null && fromLocal !== null) {
      used = Math.max(fromServer, fromLocal);
      source = fromLocal > fromServer ? 'local' : 'server';
    } else if (fromServer !== null) {
      used = fromServer;
      source = 'server';
    } else if (fromLocal !== null) {
      used = fromLocal;
      source = 'local';
    }
    if (used !== null) return { at: used, source: source, everUsed: true };
    return { at: toMs(item && item.createdAt), source: 'created', everUsed: false };
  }

  // "12 March 2026". Hand-rolled on purpose: Intl is not used anywhere in the
  // shipped surfaces, and a date that reads differently in the popup and on the
  // dashboard would break the one-product rule for no gain.
  function formatDate(ms) {
    if (ms === null || ms === undefined) return '';
    var d = new Date(ms);
    if (!isFinite(d.getTime())) return '';
    return d.getDate() + ' ' + MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
  }

  function monthsBetween(fromMs, toMsValue) {
    if (fromMs === null || fromMs === undefined) return 0;
    var a = new Date(fromMs);
    var b = new Date(toMsValue);
    var months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) months -= 1;
    return months < 0 ? 0 : months;
  }

  function labelFor(item) {
    var name = String((item && item.name) || '').replace(/^\s+|\s+$/g, '');
    if (name) return name;
    var trigger = String((item && item.trigger) || '').replace(/^\s+|\s+$/g, '');
    return trigger || 'Untitled';
  }

  // The sentence itself. One wording, every surface.
  //
  // The brief asked for "You are not using X since DATE". That is not English,
  // and UI copy is governed by the house tone rules, so the tense is corrected.
  // A never-used asset gets its own sentence rather than a last-used date that
  // would silently be its creation date and read as a lie.
  function message(entry) {
    var label = labelFor(entry);
    if (!entry || !entry.everUsed) {
      var made = formatDate(entry && entry.at);
      return made
        ? 'You have never used ' + label + '. Added ' + made + '.'
        : 'You have never used ' + label + '.';
    }
    return 'You have not used ' + label + ' since ' + formatDate(entry.at) + '.';
  }

  /**
   * The stale assets, oldest first.
   *
   * items      [{ id, name, trigger, createdAt }]  whatever the surface can see
   * serverMap  { id: date }                        recorded last use
   * state      the normalized storage object
   * nowMs      the clock, injected so the gates can move it
   */
  function findInactive(items, serverMap, state, nowMs) {
    var st = normalizeState(state);
    var now = (typeof nowMs === 'number' && isFinite(nowMs)) ? nowMs : Date.now();
    var cutoff = cutoffMs(now, st.thresholdMonths);
    var out = [];
    (items || []).forEach(function(item) {
      if (!item || !item.id) return;
      var id = String(item.id);
      var kept = st.keptUntil[id];
      if (kept !== undefined && kept > now) return;
      var found = lastUsedFor(item, serverMap, st);
      // No usage AND no creation date is not evidence of staleness. A surface
      // that cannot supply either must not have its whole library condemned.
      if (found.at === null) return;
      if (found.at >= cutoff) return;
      out.push({
        id: id,
        name: labelFor(item),
        trigger: String((item && item.trigger) || ''),
        at: found.at,
        source: found.source,
        everUsed: found.everUsed,
        monthsIdle: monthsBetween(found.at, now)
      });
    });
    out.sort(function(a, b) { return a.at - b.at; });
    return out;
  }

  var API = {
    STORAGE_KEY: STORAGE_KEY,
    MIN_MONTHS: MIN_MONTHS,
    MAX_MONTHS: MAX_MONTHS,
    DEFAULT_MONTHS: DEFAULT_MONTHS,
    KEEP_DAYS: KEEP_DAYS,
    clampMonths: clampMonths,
    cutoffMs: cutoffMs,
    normalizeState: normalizeState,
    recordUse: recordUse,
    recordKeep: recordKeep,
    keepUntilMs: keepUntilMs,
    pruneState: pruneState,
    lastUsedFor: lastUsedFor,
    findInactive: findInactive,
    formatDate: formatDate,
    monthsBetween: monthsBetween,
    labelFor: labelFor,
    message: message
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function() { return API; });
  } else {
    root.SBInactivity = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
