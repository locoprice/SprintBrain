// SNIPPET LIBRARY COUNTING — one rule for "how many snippets do I have".
//
// A translated snippet is not one row. The legacy model gives its language
// siblings a shared `lang_group_id`; the dashboard model keeps one row and puts
// the translations in `bodies`. Counting rows therefore counts a snippet once
// per language, and every surface that shows a number has to collapse the rows
// the same way — otherwise the popup, Sprintbrain.html and the dashboard each
// report a different library size for the same account.
//
// The rule, in order:
//   1. Rows never merge across owners. Sharing a folder never moves ownership
//      (Phase B stamps organization_id, it does not reassign user_id), so two
//      teammates whose triggers happen to collide stay two snippets.
//   2. Rows carrying the same explicit `lang_group_id` are one snippet.
//   3. Rows whose triggers share a base are one snippet. The base drops the
//      trigger prefix ("::air" and "air" are the same trigger) and a trailing
//      language code — but only when that code is the row's OWN language.
//      Without that guard "wait" (FR) sheds its "IT" and merges with "WA".
//
// Both joins are transitive, which is what makes the counts right on real data:
// `::quoteEN` and `::quoteES` sit under two different lang_group_ids in
// production and are still one snippet with four translations.
(function (root) {
  'use strict';

  var LANG_SUFFIX_RE = /(EN|ES|IT|FR|MULTI)$/i;

  // A stored shortcut may or may not carry the trigger baked in.
  function bareShortcut(sc) {
    return String(sc == null ? '' : sc).trim().replace(/^[^a-zA-Z0-9]+/, '');
  }

  // Grouping base of a row's trigger, lowercased. '' when it has no trigger.
  function baseTrigger(row) {
    var sc = bareShortcut(row && row.shortcut);
    if (!sc) return '';
    var m = sc.match(LANG_SUFFIX_RE);
    if (m) {
      var head = sc.slice(0, sc.length - m[1].length);
      var lang = String((row && row.lang) || '').toUpperCase();
      if (head && m[1].toUpperCase() === lang) return head.toLowerCase();
    }
    return sc.toLowerCase();
  }

  function ownerOf(row) {
    return String((row && row.user_id) || '');
  }

  /**
   * Collapse rows into snippet groups.
   *
   * Returns { groups, keyOf, byKey }:
   *   groups — [{ key, stableKey, master, owner, rows, byLang }] in input
   *            order; `master` is the first row of the group, so an upstream
   *            sort still drives ordering.
   *   keyOf  — row id -> group key, for callers that hold a single row.
   *   byKey  — group key -> group.
   *
   * `key` follows `master`, so it moves when the caller re-sorts its input. That
   * is fine for a lookup built and thrown away inside one render, and wrong for
   * anything written to disk. `stableKey` is derived from the group's smallest
   * row id instead, so it survives a re-sort and a reload — use it whenever a
   * group identity is persisted (the mobile companion keys pins and the chosen
   * language by it).
   */
  function index(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var parent = new Array(list.length);
    var i;

    function find(n) {
      while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; }
      return n;
    }
    // The lower index wins the root, so the first row of a group stays master.
    function union(a, b) {
      a = find(a); b = find(b);
      if (a === b) return;
      if (a < b) parent[b] = a; else parent[a] = b;
    }

    var firstByGid = {}, firstByBase = {};
    for (i = 0; i < list.length; i++) {
      parent[i] = i;
      var row = list[i], owner = ownerOf(row);
      var gid = (row && row.lang_group_id) ? String(row.lang_group_id) : '';
      if (gid) {
        var gk = 'u:' + owner + '|g:' + gid;
        if (firstByGid[gk] === undefined) firstByGid[gk] = i; else union(firstByGid[gk], i);
      }
      var base = baseTrigger(row);
      if (base) {
        var bk = 'u:' + owner + '|b:' + base;
        if (firstByBase[bk] === undefined) firstByBase[bk] = i; else union(firstByBase[bk], i);
      }
    }

    var groups = [], byKey = {}, keyOf = {};
    for (i = 0; i < list.length; i++) {
      var rootRow = list[find(i)];
      var key = 'grp:' + String(rootRow.id);
      var g = byKey[key];
      if (!g) {
        g = byKey[key] = { key: key, master: rootRow, owner: ownerOf(rootRow), rows: [], byLang: {} };
        groups.push(g);
      }
      g.rows.push(list[i]);
      if (g.byLang[list[i].lang] === undefined) g.byLang[list[i].lang] = list[i];
      keyOf[String(list[i].id)] = key;
    }

    // Smallest row id wins the stable key. Membership decides it, not order.
    for (i = 0; i < groups.length; i++) {
      var rows = groups[i].rows, low = String(rows[0].id), j;
      for (j = 1; j < rows.length; j++) {
        var rid = String(rows[j].id);
        if (rid < low) low = rid;
      }
      groups[i].stableKey = 'sg:' + low;
    }

    return { groups: groups, keyOf: keyOf, byKey: byKey };
  }

  /** Snippets in `rows`, translations counted once. */
  function count(rows) {
    return index(rows).groups.length;
  }

  /** The group a row belongs to within `rows`, or null. */
  function groupFor(rows, row) {
    if (!row) return null;
    var idx = (rows && rows.groups) ? rows : index(rows);
    return idx.byKey[idx.keyOf[String(row.id)]] || null;
  }

  /**
   * Library breakdown for the signed-in user.
   *
   * personal — snippets you own (including your own that you share out; sharing
   *            a folder does not make a snippet somebody else's).
   * shared   — snippets owned by a teammate, reaching you through a shared
   *            folder. Disjoint from `personal`, so the two always sum to
   *            `total`.
   * owners   — how many different teammates those shared snippets come from.
   *
   * With no signed-in user the library cannot be attributed, so everything
   * counts as personal rather than inventing teammates.
   */
  function stats(rows, currentUserId) {
    var groups = index(rows).groups;
    var me = String(currentUserId || '');
    var out = { total: groups.length, personal: 0, shared: 0, owners: 0 };
    var seen = {};
    for (var i = 0; i < groups.length; i++) {
      var owner = groups[i].owner;
      if (!me || !owner || owner === me) { out.personal++; continue; }
      out.shared++;
      if (!seen[owner]) { seen[owner] = 1; out.owners++; }
    }
    return out;
  }

  /** The one breakdown string both surfaces render, so they cannot drift. */
  function statsLine(s) {
    var line = s.personal + ' personal';
    if (s.shared > 0) {
      line += ' · ' + s.shared + ' shared from ' + s.owners + (s.owners === 1 ? ' person' : ' people');
    }
    return line;
  }

  var API = {
    baseTrigger: baseTrigger,
    index: index,
    count: count,
    groupFor: groupFor,
    stats: stats,
    statsLine: statsLine
  };

  // UMD: browser globals, CommonJS (the node gate), AMD.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else if (typeof define === 'function' && define.amd) {
    define(function () { return API; });
  } else {
    root.SBSnippetStats = API;
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof self !== 'undefined' ? self : this));
