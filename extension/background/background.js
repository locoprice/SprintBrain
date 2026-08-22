// ── SPRINTBRAIN BACKGROUND v2.32.0 — Fix: Notion sync no longer overwrites manually-edited snippets ──
importScripts('../auth/auth.js');
importScripts('../services/notion-sync/notion-sync.js');

var SUPA_URL = SB_SUPA_URL;

// Authed GET. Returns the parsed JSON body, or [] when not signed in.
function supaFetch(table, qs) {
  return new Promise(function(resolve) {
    sbAuthHeaders(function(err, headers) {
      if (err || !headers) { resolve([]); return; }
      _supaFetchWithHeaders(table, qs, headers, false, resolve);
    });
  });
}

function _supaFetchWithHeaders(table, qs, headers, retried, resolve) {
  fetch(SUPA_URL + '/rest/v1/' + table + '?' + qs, {
    headers: { 'apikey': headers.apikey, 'Authorization': headers.Authorization }
  }).then(function(r) {
    if (r.status === 401 && !retried) {
      sbRefreshToken(function(rerr, fresh) {
        if (rerr || !fresh) { resolve([]); return; }
        _supaFetchWithHeaders(table, qs,
          { apikey: SB_SUPA_ANON_KEY, Authorization: 'Bearer ' + fresh.access_token },
          true, resolve);
      });
      return;
    }
    if (!r.ok) { resolve([]); return; }
    r.json().then(resolve, function(){ resolve([]); });
  }).catch(function() { resolve([]); });
}

// ── ANALYTICS-001: log per-trigger events from content.js ─────────
// Stamps user_id from the live session (overrides any payload value to prevent spoofing).
function supaPost(table, body) {
  return new Promise(function(resolve, reject) {
    sbAuthHeaders(function(err, headers) {
      if (err || !headers) { reject(new Error('not_authed')); return; }
      sbCurrentUserId(function(uid) {
        var payload = Object.assign({}, body || {});
        if (uid) payload.user_id = uid;
        fetch(SUPA_URL + '/rest/v1/' + table, {
          method: 'POST',
          headers: {
            'apikey': headers.apikey,
            'Authorization': headers.Authorization,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify(payload)
        }).then(resolve, reject);
      });
    });
  });
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === 'log_event' && msg.payload) {
    supaPost('snippet_events', msg.payload).catch(function() {});
    try { sendResponse({ ok: true }); } catch(e) {}
    return true;
  }
});

// ── MEMORY-001: working-memory reads for the composer picker ──────
//
// Two calls, deliberately. memory_index returns everything the ranking needs
// (name, summary, token_estimate, labels) and NO bodies, so opening the picker
// is cheap no matter how large the library is. Bodies are fetched only for the
// shards a step's budget actually admits.
//
// These go through supaFetch, so they carry the user's own session and RLS
// decides what comes back. The token-authenticated memory_mcp_* functions are
// for the headless MCP server, which has no session; the extension has one and
// must not use a shared secret instead.
function memoryIndex() {
  return Promise.all([
    supaFetch('memory_steps',
      'select=key,name,token_budget,sort_order,memory_step_labels(label_id,weight)&order=sort_order.asc'),
    supaFetch('memory_shards',
      'select=id,name,summary,token_estimate,pinned,priority,memory_shard_labels(label_id)')
  ]).then(function(res) {
    return { steps: res[0] || [], shards: res[1] || [] };
  });
}

function memoryBodies(ids) {
  if (!ids || !ids.length) return Promise.resolve([]);
  var list = ids.map(function(id) { return String(id).replace(/[^0-9a-fA-F-]/g, ''); })
                .filter(Boolean);
  if (!list.length) return Promise.resolve([]);
  return supaFetch('memory_shards', 'select=id,name,body&id=in.(' + list.join(',') + ')');
}

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (!msg) return;

  if (msg.type === 'memory_index') {
    memoryIndex().then(function(data) {
      try { sendResponse({ ok: true, data: data }); } catch(e) {}
    }, function() {
      try { sendResponse({ ok: false }); } catch(e) {}
    });
    return true;
  }

  if (msg.type === 'memory_bodies') {
    memoryBodies(msg.ids).then(function(rows) {
      try { sendResponse({ ok: true, rows: rows }); } catch(e) {}
    }, function() {
      try { sendResponse({ ok: false }); } catch(e) {}
    });
    return true;
  }
});

// ── AUTH-EXT-002/003: accept session handoff from the dashboard ───
// externally_connectable in manifest already restricts senders to the dashboard
// origin; we double-check the URL prefix as defense in depth.
//
// Preferred payload (AUTH-EXT-003) carries a one-time token_hash: redeeming it
// at /auth/v1/verify gives the extension a session of its OWN. Storing the
// dashboard's raw tokens (the original AUTH-EXT-002 shape, kept as fallback)
// shared one rotating refresh-token family between the two surfaces — whichever
// refreshed second got the family revoked, signing the extension out.
chrome.runtime.onMessageExternal.addListener(function(msg, sender, sendResponse) {
  if (!sender || !sender.url || sender.url.indexOf('https://app.sprintbrain.com/') !== 0) {
    sendResponse({ ok: false, error: 'unauthorized_origin' });
    return false;
  }
  if (msg && msg.type === 'session_handoff') {
    var legacy = (msg.session && msg.session.access_token) ? msg.session : null;
    var acceptLegacy = function() {
      if (!legacy) { sendResponse({ ok: false, error: 'invalid_payload' }); return; }
      sbSetSession(legacy, function() {
        // Rebuild context menus immediately under the new identity.
        try { initMenus(); } catch(e) {}
        sendResponse({ ok: true, user_id: legacy.user_id || null });
      });
    };
    if (msg.token_hash) {
      sbVerifyTokenHash(msg.token_hash, function(err, session) {
        if (err || !session) { acceptLegacy(); return; }
        try { initMenus(); } catch(e) {}
        sendResponse({ ok: true, user_id: session.user_id || null });
      });
    } else {
      acceptLegacy();
    }
    return true; // keep the channel open for the async sendResponse
  }
  sendResponse({ ok: false, error: 'invalid_payload' });
  return false;
});

// ── LOAD SNIPPETS + FOLDERS + STATS FROM SUPABASE ─────────────────
// Shows the current user's own snippets plus any in a folder shared with them.
//
// Phase B: snippet visibility is now folder-level (View/Edit/Owner), not the
// legacy global `is_shared` flag. The accessible_snippets() RPC (SECURITY
// DEFINER, STABLE) returns personal + folder-readable rows in one call; PostgREST
// lets us project/filter/order the result set just like a table. Folders ride on
// their own RLS (own + org-readable), so shared folders surface automatically.
function loadData() {
  return new Promise(function(resolve) {
    sbCurrentUserId(function() {
      // is_active=eq.true filters out soft-disabled snippets (SNIPPET-DISABLE-001):
      // disabled rows must not appear in the right-click context menu and must
      // not expand when their shortcut is typed. The dashboard is the only
      // surface that exposes disabled snippets (so they can be re-enabled).
      // The body/field_cfg/urgency columns are not needed to draw the context
      // menu — they are here so this one fetch can also refresh the expansion
      // cache content.js reads (see writeExpansionCache below). Without them the
      // service worker had no body to cache, which is why a snippet edited on
      // the dashboard kept expanding its old text until the popup was opened.
      var snipQs = 'select=id,title,shortcut,alternative_queries,folder_id,lang,lang_group_id,sort_order,' +
        'body,bodies,field_cfg,enable_urgency_timer,timer_duration_ms,scarcity_count,pinned' +
        '&is_active=eq.true&order=sort_order';
      Promise.all([
        supaFetch('folders',  'select=*&order=sort_order'),
        supaFetch('rpc/accessible_snippets', snipQs),
        supaFetch('snippet_stats', 'select=snippet_id,uses,last_used&order=last_used.desc.nullslast&limit=20')
      ]).then(function(res) {
        resolve({
          // `ok` separates "fetched fine, the user has no snippets" from "the
          // fetch failed". Both look like an empty array, and the expansion
          // cache must never be cleared on the second — that would silently
          // disable every trigger until the next successful sync.
          ok: Array.isArray(res[1]),
          folders:  Array.isArray(res[0]) ? res[0] : [],
          snippets: Array.isArray(res[1]) ? res[1] : [],
          stats:    Array.isArray(res[2]) ? res[2] : []
        });
      }).catch(function() { resolve({ ok: false, folders: [], snippets: [], stats: [] }); });
    });
  });
}

// ── FOLDER-ICON VOCABULARY (emoji projection of the canonical keyword set) ──
// The right-click menu is a native chrome.contextMenus tree — it can only render
// text + emoji, never SVG — so these emoji are this surface's projection of the
// SAME folder-icon vocabulary the dashboard draws with Lucide
// (app/src/lib/folderIcons.tsx) and the popup + mobile draw with _FOLDER_SVGS.
// Keep the keys in parity with FOLDER_ICON_KEYS in those files. A snippet shows
// its FOLDER's glyph (the product-wide convention — see app/public/mobile/index.html),
// so the same item shows the same icon on every surface.
var FOLDER_ICON_EMOJI = {
  folder: '📁', clipboard: '📋', home: '🏠', message: '💬', cpu: '🖥️',
  star: '⭐', key: '🔑', dollar: '💵', 'file-text': '📄', globe: '🌐'
};
// Legacy dashboard emoji → canonical key, mirroring resolveFolderIcoKey on the
// other surfaces so folders created before the vocabulary was unified keep a
// meaningful glyph; anything unknown falls back to the folder glyph.
var FOLDER_LEGACY_EMOJI = {
  '🏠': 'home', '🌍': 'globe', '🏢': 'folder', '📋': 'clipboard', '📊': 'folder',
  '💬': 'message', '✈️': 'folder', '🔧': 'key', '📝': 'file-text', '⭐': 'star'
};
function resolveFolderIcoKey(raw) {
  if (!raw) return 'folder';
  if (FOLDER_ICON_EMOJI[raw]) return raw;
  if (FOLDER_LEGACY_EMOJI[raw]) return FOLDER_LEGACY_EMOJI[raw];
  return 'folder';
}
// The emoji glyph for a folder's stored ico value (keyword key or legacy emoji).
function folderEmoji(ico) {
  return FOLDER_ICON_EMOJI[resolveFolderIcoKey(ico)];
}

// ── LANGUAGE ORDERING (EN → IT → ES → MULTI → rest) ───────────────
var LANG_ORDER = ['EN', 'IT', 'ES', 'FR', 'MULTI'];
function langRank(l) {
  var i = LANG_ORDER.indexOf((l || 'EN').toUpperCase());
  return i < 0 ? 99 : i;
}

// ── LABEL BUILDER: compact "{icon} TITLE · LANG" (shortcut dropped) ──
function snippetLabel(s, ico) {
  var title = String(s.title || 'Untitled').trim();
  var lang = s.lang ? String(s.lang).toUpperCase() : '';
  return lang ? (ico + ' ' + title + ' \u00B7 ' + lang) : (ico + ' ' + title);
}

// Child row inside a language submenu - just the language code.
function langChildLabel(s) {
  return String(s.lang || 'EN').toUpperCase();
}

// GROUP language variants (same lang_group_id) into one entry.
// Returns [{ items: [snippet, ...] }]. A snippet with no lang_group_id (or a
// group with a single member in this scope) is its own singleton entry, so it
// renders as a plain leaf rather than a needless one-item submenu.
function groupByLang(snips) {
  var groups = [];
  var byKey = {};
  snips.forEach(function(s) {
    var lg = (s.lang_group_id != null && String(s.lang_group_id).trim() !== '')
      ? 'g:' + s.lang_group_id
      : 's:' + s.id;
    if (!byKey[lg]) { byKey[lg] = { items: [] }; groups.push(byKey[lg]); }
    byKey[lg].items.push(s);
  });
  return groups;
}

// Lowest sort_order in a group (its position among siblings).
function groupMinSort(g) {
  var min = 1e9;
  g.items.forEach(function(s) {
    var v = (s.sort_order == null) ? 1e9 : s.sort_order;
    if (v < min) min = v;
  });
  return min;
}

// Order groups by sort_order then title; stable and predictable.
function sortGroups(groups) {
  return groups.slice().sort(function(a, b) {
    var sa = groupMinSort(a), sb = groupMinSort(b);
    if (sa !== sb) return sa - sb;
    var ta = (a.items[0].title || '').toLowerCase();
    var tb = (b.items[0].title || '').toLowerCase();
    return ta === tb ? 0 : (ta < tb ? -1 : 1);
  });
}

// Emit grouped snippet rows under parentId: singletons as sb-snip-<id> leaves,
// multi-language groups as a titled submenu with one sb-snip-<id> child per
// language (EN, IT, ES, FR, MULTI). Every clickable leaf keeps the
// sb-snip-<id> id the click handler expects, so the insertion path is unchanged.
var _grpN = 0;
function renderSnippetGroups(parentId, groups, ico) {
  groups.forEach(function(g) {
    if (g.items.length === 1) {
      var s = g.items[0];
      chrome.contextMenus.create({
        id: 'sb-snip-' + s.id,
        parentId: parentId,
        title: snippetLabel(s, ico),
        contexts: ['editable']
      });
      return;
    }
    var rep = g.items[0];
    var groupId = 'sb-grp-' + (++_grpN);
    chrome.contextMenus.create({
      id: groupId,
      parentId: parentId,
      title: ico + ' ' + String(rep.title || 'Untitled').trim(),
      contexts: ['editable']
    });
    g.items.slice().sort(function(a, b) {
      var r = langRank(a.lang) - langRank(b.lang);
      if (r !== 0) return r;
      return (a.title || '').toLowerCase() < (b.title || '').toLowerCase() ? -1 : 1;
    }).forEach(function(s) {
      chrome.contextMenus.create({
        id: 'sb-snip-' + s.id,
        parentId: groupId,
        title: langChildLabel(s),
        contexts: ['editable']
      });
    });
  });
}

// ── BUILD CONTEXT MENUS (v2.15.6: Recent + Folders + Unfiled) ─────
function buildContextMenus(data) {
  chrome.contextMenus.removeAll(function() {

    // Root — only in editable fields
    chrome.contextMenus.create({
      id: 'sb-root',
      title: 'Insert SprintBrain snippet',
      contexts: ['editable']
    });

    var folders  = data.folders  || [];
    var snippets = data.snippets || [];
    var stats    = data.stats    || [];

    if (snippets.length === 0) {
      chrome.contextMenus.create({
        id: 'sb-empty',
        parentId: 'sb-root',
        title: 'No snippets yet — open the popup to add one',
        contexts: ['editable'],
        enabled: false
      });
      chrome.contextMenus.create({
        id: 'sb-sep-empty',
        parentId: 'sb-root',
        type: 'separator',
        contexts: ['editable']
      });
      chrome.contextMenus.create({
        id: 'sb-open-dashboard',
        parentId: 'sb-root',
        title: '\uD83C\uDF10  Open SprintBrain Dashboard',
        contexts: ['editable']
      });
      return;
    }

    // Index for quick lookup
    var byId = {};
    snippets.forEach(function(s) { byId[s.id] = s; });

    // A snippet's icon is its FOLDER's glyph (product-wide convention),
    // resolved to the emoji projection. Unfiled snippets fall back to 📁.
    var folderById = {};
    folders.forEach(function(f) { folderById[f.id] = f; });
    function snipIco(s) {
      var f = s.folder_id ? folderById[s.folder_id] : null;
      return folderEmoji(f ? f.ico : '');
    }

    // Group by folder
    var byFolder = {};
    var noFolder = [];
    snippets.forEach(function(s) {
      if (s.folder_id && folders.some(function(f) { return f.id === s.folder_id; })) {
        if (!byFolder[s.folder_id]) byFolder[s.folder_id] = [];
        byFolder[s.folder_id].push(s);
      } else {
        noFolder.push(s);
      }
    });

    var sepN = 0;
    function addSep(parent) {
      chrome.contextMenus.create({
        id: 'sb-sep-' + (++sepN),
        parentId: parent,
        type: 'separator',
        contexts: ['editable']
      });
    }

    // ── 1. RECENT (top 5 by last_used, only valid snippet IDs) ─────
    var recent = stats
      .map(function(st) { return byId[st.snippet_id]; })
      .filter(function(s) { return !!s; })
      .slice(0, 5);

    if (recent.length > 0) {
      chrome.contextMenus.create({
        id: 'sb-hdr-recent',
        parentId: 'sb-root',
        title: '\u2B50  Recent',  // ⭐
        contexts: ['editable'],
        enabled: false
      });
      recent.forEach(function(s) {
        chrome.contextMenus.create({
          id: 'sb-recent-' + s.id,
          parentId: 'sb-root',
          title: snippetLabel(s, snipIco(s)),
          contexts: ['editable']
        });
      });
    }

    // ── 2. FOLDERS — every folder with snippets is its own submenu ──
    // Single-snippet folders are no longer flattened to the root: showing each
    // folder consistently means a folder created in the dashboard is always
    // visible here, and the menu reads the same way every time.
    // Folders nest (Property > Category > Sub), so the menu nests with them:
    // a parent submenu holds its own snippets followed by its child folders.
    function sortFolders(list) {
      return list.slice().sort(function(a, b) {
        var sa = (a.sort_order == null) ? 1e9 : a.sort_order;
        var sb = (b.sort_order == null) ? 1e9 : b.sort_order;
        if (sa !== sb) return sa - sb;
        var na = (a.name || '').toLowerCase();
        var nb = (b.name || '').toLowerCase();
        return na === nb ? 0 : (na < nb ? -1 : 1);
      });
    }
    function childFolders(pid) {
      return sortFolders(folders.filter(function(f) {
        return f.id !== pid && (f.parent_id || '') === pid;
      }));
    }
    // Snippet groups in this folder and everything below it — drives the count
    // on the parent so it matches what opening the submenu leads to.
    function subtreeGroupCount(f, depth) {
      var n = (byFolder[f.id] || []).length ? sortGroups(groupByLang(byFolder[f.id])).length : 0;
      if (depth < 8) {
        childFolders(f.id).forEach(function(c) { n += subtreeGroupCount(c, depth + 1); });
      }
      return n;
    }
    function hasSnippetsDeep(f, depth) { return subtreeGroupCount(f, depth) > 0; }

    // A folder whose parent is not in the list is a root — RLS can share a
    // child without its parent, and it must still appear.
    var folderIds = {};
    folders.forEach(function(f) { folderIds[f.id] = 1; });
    var rootFolders = sortFolders(folders.filter(function(f) {
      var p = f.parent_id || '';
      return !p || p === f.id || !folderIds[p];
    })).filter(function(f) { return hasSnippetsDeep(f, 1); });

    function emitFolderMenu(parentMenuId, f, depth) {
      if (depth > 8) return;
      var folderIco = folderEmoji(f.ico);
      var menuId = 'sb-folder-' + f.id;
      chrome.contextMenus.create({
        id: menuId,
        parentId: parentMenuId,
        title: folderIco + '  ' + (f.name || 'Folder') + '  (' + subtreeGroupCount(f, depth) + ')',
        contexts: ['editable']
      });
      var own = byFolder[f.id] || [];
      if (own.length > 0) renderSnippetGroups(menuId, sortGroups(groupByLang(own)), folderIco);
      var kids = childFolders(f.id).filter(function(c) { return hasSnippetsDeep(c, depth + 1); });
      if (kids.length > 0 && own.length > 0) addSep(menuId);
      kids.forEach(function(c) { emitFolderMenu(menuId, c, depth + 1); });
    }

    var showingFolders = rootFolders.length > 0;
    if (recent.length > 0 && showingFolders) addSep('sb-root');

    rootFolders.forEach(function(f) { emitFolderMenu('sb-root', f, 1); });

    // ── 3. UNFILED (≥4 → submenu; 1–3 → inline) ───────────────────
    if (noFolder.length > 0) {
      var unfiledGroups = sortGroups(groupByLang(noFolder));
      if (showingFolders || recent.length > 0) addSep('sb-root');

      if (unfiledGroups.length >= 4) {
        chrome.contextMenus.create({
          id: 'sb-unfiled',
          parentId: 'sb-root',
          title: '\uD83D\uDCC4  Unfiled',  // 📄
          contexts: ['editable']
        });
        renderSnippetGroups('sb-unfiled', unfiledGroups, folderEmoji(''));
      } else {
        // 1-3 inline entries get a disabled header so they read as a section,
        // not loose rows floating at the root next to the folder submenus.
        chrome.contextMenus.create({
          id: 'sb-hdr-unfiled',
          parentId: 'sb-root',
          title: '📄  Unfiled',  // 📄
          contexts: ['editable'],
          enabled: false
        });
        renderSnippetGroups('sb-root', unfiledGroups, folderEmoji(''));
      }
    }

    // ── 4. DASHBOARD LINK (always at the bottom) ──────────────────
    addSep('sb-root');
    chrome.contextMenus.create({
      id: 'sb-open-dashboard',
      parentId: 'sb-root',
      title: '\uD83C\uDF10  Open SprintBrain Dashboard',  // 🌐
      contexts: ['editable']
    });

  });
}

// ── DASHBOARD URL ─────────────────────────────────────────────────
var SB_DASHBOARD_URL = 'https://app.sprintbrain.com/';

// ── CONTEXT MENU CLICK HANDLER ────────────────────────────────────
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  var id = String(info.menuItemId || '');
  if (!id) return;

  // Dashboard link — opens in a new tab (reuses existing tab if already open)
  if (id === 'sb-open-dashboard') {
    try {
      chrome.tabs.query({ url: SB_DASHBOARD_URL + '*' }, function(tabs) {
        if (tabs && tabs.length) {
          chrome.tabs.update(tabs[0].id, { active: true });
          if (tabs[0].windowId != null) {
            chrome.windows.update(tabs[0].windowId, { focused: true });
          }
        } else {
          chrome.tabs.create({ url: SB_DASHBOARD_URL });
        }
      });
    } catch (e) {
      chrome.tabs.create({ url: SB_DASHBOARD_URL });
    }
    return;
  }

  var snippetId = null;
  if (id.indexOf('sb-snip-') === 0)        snippetId = id.replace('sb-snip-', '');
  else if (id.indexOf('sb-recent-') === 0) snippetId = id.replace('sb-recent-', '');
  if (!snippetId) return;

  // Fetch full snippet body from Supabase then send to content script
  supaFetch('snippets', 'select=*&id=eq.' + snippetId)
    .then(function(rows) {
      var s = rows && rows[0];
      if (!s) return;
      var snippet = {
        id:        s.id,
        title:     s.title,
        shortcut:  s.shortcut || '',
        body:      s.body || '',
        lang:      s.lang || 'EN',
        folder:    s.folder_id || '',
        fieldCfg:  s.field_cfg || {},
        enable_urgency_timer: s.enable_urgency_timer || false,
        timer_duration_ms: s.timer_duration_ms || 0,
        scarcity_count: s.scarcity_count || 0
      };
      chrome.tabs.sendMessage(tab.id, {
        type: 'SB_CONTEXT_INSERT',
        snippet: snippet
      }).catch(function () {
        // Target tab has no content script (chrome:// page, Web Store, PDF, or a
        // tab opened before the extension loaded) — nothing to insert into.
      });
    });
});

// ── INIT + REFRESH MENUS ──────────────────────────────────────────
function initMenus() {
  sbGetSession(function(session) {
    if (!session) {
      chrome.contextMenus.removeAll(function() {
        chrome.contextMenus.create({
          id: 'sb-signin-required',
          title: 'Sign in to SprintBrain',
          contexts: ['editable'],
          enabled: false
        });
      });
      return;
    }
    loadData().then(function(data) {
      buildContextMenus(data);
      if (data.ok) writeExpansionCache(data.snippets);
    });
  });
}

// ── EXPANSION CACHE ────────────────────────────────────────────────
// content.js expands from chrome.storage.local.snippets and live-updates from
// storage.onChanged, so whoever writes this key decides what a typed trigger
// produces. popup.js used to be its only writer, which meant a snippet edited
// on the dashboard (a direct Supabase write, no push to the worker) kept
// expanding its previous body until the user happened to open the popup —
// a menu added there would not appear in the overlay at all.
//
// The menu refresh already runs on the 5-minute alarm and on tab focus, so the
// cache now rides the same fetch and stays as fresh as the context menu.
//
// The row shape MUST match DB.loadAll() in popup/popup.js — content.js reads
// `folder`, `fieldCfg` and `bodies` off these objects. Change both together.
function writeExpansionCache(rows) {
  if (!Array.isArray(rows)) return;
  try {
    chrome.storage.local.set({
      snippets: rows.map(function(s) {
        return {
          id: s.id,
          title: s.title,
          shortcut: s.shortcut || '',
          body: s.body || '',
          bodies: (s.bodies && typeof s.bodies === 'object') ? s.bodies : {},
          lang: s.lang || 'EN',
          folder: s.folder_id || '',
          fieldCfg: s.field_cfg || {},
          lang_group_id: s.lang_group_id || s.id,
          sort_order: s.sort_order || 0,
          alternative_queries: Array.isArray(s.alternative_queries) ? s.alternative_queries : [],
          enable_urgency_timer: s.enable_urgency_timer || false,
          timer_duration_ms: s.timer_duration_ms || 0,
          scarcity_count: s.scarcity_count || 0,
          pinned: s.pinned || false,
          // The worker does not fetch usage, but the popup hydrates its list
          // from this same cache and reads s.stats.uses unguarded. Writing the
          // zeroed shape keeps that contract; DB.loadAll overwrites it with the
          // real counts a moment later.
          expansions: 0,
          stats: { uses: 0, fills: 0, lastUsed: null }
        };
      })
    }, function() {
      if (chrome.runtime.lastError) {
        console.warn('[Sprintbrain] expansion cache write:', chrome.runtime.lastError.message);
      }
    });
  } catch (e) {
    console.warn('[Sprintbrain] expansion cache:', e);
  }
}

// ── TOOLBAR ACTION ICON — brand mark by default, company logo when set ──
// MV3 service workers have no DOM, so a remote company logo is fetched and drawn
// onto an OffscreenCanvas (white rounded square — matching the committed brand
// icons and the dashboard's white logo card) and pushed via chrome.action.setIcon
// as ImageData. The committed assets/icons/icon*.png (the SprintBrain mark) are
// the signed-out / no-logo default. The last-applied URL is cached so repeated
// menu refreshes don't refetch or redraw.
function sbRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function sbComposeActionIcon(bmp, size) {
  var c = new OffscreenCanvas(size, size);
  var ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  sbRoundRect(ctx, 0, 0, size, size, size * 0.22);
  ctx.fill();
  var pad = size * 0.12, inner = size - 2 * pad;
  var scale = inner / Math.max(bmp.width, bmp.height);
  var dw = bmp.width * scale, dh = bmp.height * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, (size - dw) / 2, (size - dh) / 2, dw, dh);
  return ctx.getImageData(0, 0, size, size);
}
function sbSetBrandActionIcon() {
  try {
    chrome.action.setIcon({ path: {
      '16': 'assets/icons/icon16.png',
      '48': 'assets/icons/icon48.png',
      '128': 'assets/icons/icon128.png'
    } });
  } catch (e) {}
}
function sbRenderRemoteActionIcon(url, cb) {
  fetch(url)
    .then(function(r) { return r.ok ? r.blob() : Promise.reject(new Error('http_' + r.status)); })
    .then(function(blob) { return createImageBitmap(blob); })
    .then(function(bmp) {
      if (!bmp || !bmp.width || !bmp.height) throw new Error('no_bitmap'); // e.g. an SVG logo in a SW
      var imageData = {
        16: sbComposeActionIcon(bmp, 16),
        48: sbComposeActionIcon(bmp, 48),
        128: sbComposeActionIcon(bmp, 128)
      };
      chrome.action.setIcon({ imageData: imageData }, function() { if (cb) cb(!chrome.runtime.lastError); });
    })
    .catch(function() { if (cb) cb(false); });
}
// Apply the toolbar icon from user_metadata; pass null (signed out) to revert to
// the brand mark. Skips work when the target already matches what's applied.
function sbUpdateActionIcon(meta) {
  var url = (meta && typeof meta.company_logo_url === 'string' &&
             meta.company_logo_url.indexOf('https://') === 0) ? meta.company_logo_url : null;
  chrome.storage.local.get('sb_action_icon_url', function(d) {
    var cur = (d && d.sb_action_icon_url) ? d.sb_action_icon_url : null;
    if (cur === url) return;
    if (!url) {
      sbSetBrandActionIcon();
      chrome.storage.local.set({ sb_action_icon_url: null });
      return;
    }
    sbRenderRemoteActionIcon(url, function(ok) {
      if (ok) chrome.storage.local.set({ sb_action_icon_url: url });
    });
  });
}
// Pull the latest user_metadata and refresh the toolbar icon (reverts on error).
function sbRefreshActionIcon() {
  if (typeof sbPullTriggerMetadata !== 'function') return;
  sbPullTriggerMetadata(function(err, meta) { sbUpdateActionIcon(err ? null : meta); });
}

// Rebuild menus the moment the popup saves a session (or signs out).
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === 'auth_changed') { initMenus(); sbRefreshActionIcon(); }
});

// ── LEGACY SEED / ROAMING-KEY PURGE ──────────────────────────────
// Two things had to leave the browser on update:
//   1. chrome.storage.sync copies of 'snippets' and 'notionCfg'. sync roams to
//      every Chrome signed into the same Google account, so snippet content and
//      a Notion API key travelled between profiles. Credentials never belong in
//      sync; the local copy is authoritative and the migration reads already ran.
//   2. The snippet cache of an install with no session. Builds up to v2.156.0
//      seeded a real snippet library into chrome.storage.local for signed-out
//      installs, and a sign-out left the previous session's cache in place, so
//      the picker served a library to someone with no account. Signed-in installs
//      are untouched: their cache is their own data.
function sbPurgeLegacyLocalData() {
  try {
    chrome.storage.sync.remove(['snippets', 'notionCfg'], function() {
      if (chrome.runtime.lastError) { /* key may not exist */ }
    });
    chrome.storage.local.get('sb_session', function(d) {
      var signedIn = !!(d && d.sb_session && d.sb_session.user_id);
      if (signedIn) return;
      chrome.storage.local.remove(['snippets', 'sb_prompts'], function() {
        if (chrome.runtime.lastError) { /* key may not exist */ }
      });
    });
  } catch (e) {
    console.error('[SprintBrain BG] Legacy purge failed:', e.message);
  }
}

// ── ROAMING PREFERENCE MIGRATION ─────────────────────────────────
// 'trigger', 'triggerCfg' and 'sb_default_lang' used to live in
// chrome.storage.sync so they roamed to every Chrome signed into the same
// Google account. They are preferences rather than credentials, so nothing
// leaked — but the privacy policy states the extension uses
// chrome.storage.local exclusively, and sync bought nothing anyway: Supabase
// user_metadata is already the cross-device source of truth for triggers and
// auth.js pulls it on every session refresh.
//
// A key moves only when local has no value yet, so a newer local setting is
// never overwritten by a stale roaming one. The sync copies go either way, so
// the keys stop roaming even for a profile that already has local values.
function sbMigrateRoamingPrefs() {
  var KEYS = ['trigger', 'triggerCfg', 'sb_default_lang'];
  try {
    chrome.storage.sync.get(KEYS, function(sd) {
      if (chrome.runtime.lastError || !sd) return;
      chrome.storage.local.get(KEYS, function(ld) {
        var move = {}, moved = 0;
        KEYS.forEach(function(k) {
          if (sd[k] !== undefined && (!ld || ld[k] === undefined)) { move[k] = sd[k]; moved++; }
        });
        function dropRoamingCopies() {
          chrome.storage.sync.remove(KEYS, function() {
            if (chrome.runtime.lastError) { /* key may not exist */ }
          });
        }
        if (moved) chrome.storage.local.set(move, dropRoamingCopies);
        else dropRoamingCopies();
      });
    });
  } catch (e) {
    console.error('[SprintBrain BG] Roaming pref migration failed:', e.message);
  }
}

// Build on install + create sync alarm
chrome.runtime.onInstalled.addListener(function(details) {
  chrome.alarms.create('sb_sync_alarm', {
    delayInMinutes: 1,
    periodInMinutes: 5
  });
  sbPurgeLegacyLocalData();
  sbMigrateRoamingPrefs();
  initMenus();
  sbRefreshActionIcon();
});

// Rebuild when popup saves changes (snippets updated)
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.sb_menu_refresh) initMenus();
});

// Rebuild on browser start + recreate alarm if missing
chrome.runtime.onStartup.addListener(function() {
  chrome.alarms.get('sb_sync_alarm', function(alarm) {
    if (!alarm) {
      chrome.alarms.create('sb_sync_alarm', {
        delayInMinutes: 1,
        periodInMinutes: 5
      });
    }
  });
  // Also on browser start, not only on update: a profile that receives the
  // roaming keys from another Chrome after updating would otherwise keep them.
  sbMigrateRoamingPrefs();
  initMenus();
  bgNotionSync();
  sbRefreshActionIcon();
});

// ── ALARM LISTENER — fires every 5 minutes ──────────────────────
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name !== 'sb_sync_alarm') return;
  // Liveness first: a session revoked from the dashboard (Settings → Security
  // "Sign out from all devices") clears local auth within one alarm tick —
  // sbClearSession fires auth_changed, which rebuilds the menus signed-out.
  if (typeof sbCheckSessionAlive === 'function') sbCheckSessionAlive(function() {});
  // Refresh the context menu from Supabase so snippets/folders created on the
  // dashboard show up without needing to open the popup, then run Notion sync.
  forceRefreshMenus();
  _alarmSync();
});

// ── MENU FRESHNESS — keep the right-click menu in sync with the dashboard ──
// The dashboard writes snippets and folders straight to Supabase; the service
// worker gets no push for those edits. Rebuild the menu when the user changes
// tab or refocuses the browser (e.g. switching from the dashboard back to Gmail
// to expand a snippet), throttled so we don't refetch on every flick between
// tabs. The 5-minute alarm above is the periodic backstop.
var MENU_REFRESH_MIN_MS = 10000;
function forceRefreshMenus() {
  chrome.storage.local.set({ sb_menu_last_refresh: Date.now() });
  initMenus();
  // Same "pull latest dashboard state" hook (sbPullTriggerMetadata) refreshes the
  // trigger settings (user_metadata → chrome.storage.local cache) AND the toolbar
  // action icon (company logo → chrome.action.setIcon), so a change made on the
  // dashboard reflects without the user opening the popup. Fires on the 5-min
  // alarm and on tab-switch / window-focus (throttled) — see call sites.
  sbRefreshActionIcon();
}
function maybeRefreshMenus() {
  chrome.storage.local.get('sb_menu_last_refresh', function(d) {
    var last = (d && d.sb_menu_last_refresh) ? d.sb_menu_last_refresh : 0;
    if (Date.now() - last < MENU_REFRESH_MIN_MS) return;
    forceRefreshMenus();
  });
}
chrome.tabs.onActivated.addListener(function() { maybeRefreshMenus(); });
chrome.windows.onFocusChanged.addListener(function(winId) {
  if (winId === chrome.windows.WINDOW_ID_NONE) return; // focus left the browser
  maybeRefreshMenus();
});
// Message handler from popup
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg && msg.type === 'REFRESH_MENUS') {
    initMenus();
    sendResponse({ ok: true });
  }
  // No `return true`: the response above is synchronous. Returning true kept the
  // channel open for EVERY message (incl. log_event / auth_changed handled by
  // other listeners), producing "message channel closed" noise and leaks.
});


// ── BACKGROUND NOTION SYNC (delegates to NotionSync module) ───────
function bgNotionSync() {
  try {
    chrome.storage.local.get('sb_notion_cfg', function (d) {
      var cfg = d && d.sb_notion_cfg ? d.sb_notion_cfg : null;

      // Fallback: migrate from sync → local if needed
      if (!cfg || !cfg.apiKey || !cfg.dbId) {
        chrome.storage.sync.get('notionCfg', function (sd) {
          var sCfg = sd && sd.notionCfg ? sd.notionCfg : null;
          if (!sCfg || !sCfg.apiKey || !sCfg.dbId) return;
          chrome.storage.local.set({sb_notion_cfg: sCfg}, function() {
            // Drop the roaming copy: an API key must not sit in storage.sync.
            chrome.storage.sync.remove('notionCfg');
          });
          _bgRunSync(sCfg);
        });
        return;
      }

      _bgRunSync(cfg);
    });
  } catch (e) {
    console.error('[SprintBrain BG] Notion cfg read failed:', e.message);
  }
}

function _bgRunSync(cfg) {
  NotionSync.reset();
  NotionSync.run(cfg, {
    onComplete: function () {},
    onError: function (err) {
      console.error('[SprintBrain BG] Notion bg-sync failed:', err.message);
    }
  });
}

// ── ALARM SYNC — silent background sync every 5 minutes ─────────
function _alarmSync() {
  chrome.storage.local.get('sb_notion_cfg', function(d) {
    var cfg = (d && d.sb_notion_cfg) ? d.sb_notion_cfg : null;
    if (!cfg || !cfg.apiKey || !cfg.dbId) {
      return;
    }

    // Check debounce — skip if synced in last 3 minutes
    chrome.storage.local.get('sb_notion_last_sync_ts', function(sd) {
      var lastSync = sd && sd['sb_notion_last_sync_ts'];
      if (lastSync) {
        var elapsed = Date.now() - new Date(lastSync).getTime();
        if (elapsed < 180000) {
          return;
        }
      }

      NotionSync.reset();
      NotionSync.run(cfg, {
        onProgress: function() {},
        onComplete: function(snippets, success) {
          if (!success) return;
          if (snippets.length > 0) {
            chrome.storage.local.set({
              sb_alarm_sync_result: {
                snippets: snippets,
                timestamp: new Date().toISOString()
              }
            });
          }
        },
        onError: function(err) {
          console.error('[SprintBrain Alarm] Sync failed:', err.message);
        }
      });
    });
  });
}
