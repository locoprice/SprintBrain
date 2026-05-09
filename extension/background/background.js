// ── SPRINTBRAIN BACKGROUND v2.28.0 — Dashboard SSO handoff (AUTH-EXT-002) ──
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
    supaPost('snippet_events', msg.payload).catch(function(e) {
      console.warn('log_event:', e);
    });
    try { sendResponse({ ok: true }); } catch(e) {}
    return true;
  }
});

// ── AUTH-EXT-002: accept session handoff from the dashboard ───────
// externally_connectable in manifest already restricts senders to the dashboard
// origin; we double-check the URL prefix as defense in depth.
chrome.runtime.onMessageExternal.addListener(function(msg, sender, sendResponse) {
  if (!sender || !sender.url || sender.url.indexOf('https://sprintbrain.netlify.app/') !== 0) {
    sendResponse({ ok: false, error: 'unauthorized_origin' });
    return false;
  }
  if (msg && msg.type === 'session_handoff' && msg.session && msg.session.access_token) {
    sbSetSession(msg.session, function() {
      // Rebuild context menus immediately under the new identity.
      try { initMenus(); } catch(e) {}
      sendResponse({ ok: true, user_id: msg.session.user_id || null });
    });
    return true; // keep the channel open for the async sendResponse
  }
  sendResponse({ ok: false, error: 'invalid_payload' });
  return false;
});

// ── LOAD SNIPPETS + FOLDERS + STATS FROM SUPABASE ─────────────────
function loadData() {
  return Promise.all([
    supaFetch('folders',  'select=*&order=sort_order'),
    supaFetch('snippets', 'select=id,title,shortcut,folder_id,lang,lang_group_id,sort_order&order=sort_order'),
    supaFetch('snippet_stats', 'select=snippet_id,uses,last_used&order=last_used.desc.nullslast&limit=20')
  ]).then(function(res) {
    return {
      folders:  Array.isArray(res[0]) ? res[0] : [],
      snippets: Array.isArray(res[1]) ? res[1] : [],
      stats:    Array.isArray(res[2]) ? res[2] : []
    };
  }).catch(function() { return { folders: [], snippets: [], stats: [] }; });
}

// ── ICON RULES (keyword-based, no schema change) ──────────────────
var ICON_RULES = [
  { re: /QUOTE|ESTIMATE|PRESUPUE|PREVENTIVO|BUDGET/i, icon: '\uD83D\uDCB0' },        // 💰
  { re: /BOOKING|RESERV|NEOB/i,                       icon: '\uD83D\uDCC5' },        // 📅
  { re: /FOLLOW[\s_-]?UP/i,                           icon: '\u2709\uFE0F' },        // ✉️
  { re: /CALENDAR|\bCAL\b|PRICE/i,                    icon: '\uD83D\uDCC6' },        // 📆
  { re: /NOT[\s_-]?AVAIL|DISPONIBIL/i,                icon: '\uD83D\uDEAB' },        // 🚫
  { re: /ALTERN/i,                                    icon: '\uD83D\uDD00' },        // 🔀
  { re: /WITHDRAW|CANCEL/i,                           icon: '\u21A9\uFE0F' },        // ↩️
  { re: /MIN[\s_-]?STAY|MINIMUM/i,                    icon: '\uD83D\uDECF\uFE0F' },  // 🛏️
  { re: /DISCOUNT|SALE|OFFER/i,                       icon: '\uD83C\uDFF7\uFE0F' },  // 🏷️
  { re: /CHECK[\s_-]?IN/i,                            icon: '\uD83D\uDD11' },        // 🔑
  { re: /CHECK[\s_-]?OUT/i,                           icon: '\uD83D\uDEAA' },        // 🚪
  { re: /ADDRESS|LOCATION|INDIRIZZ/i,                 icon: '\uD83D\uDCCD' },        // 📍
  { re: /PHONE|CALL\b/i,                              icon: '\uD83D\uDCDE' },        // 📞
  { re: /PAYMENT|INVOICE|RECEIPT/i,                   icon: '\uD83D\uDCB3' },        // 💳
  { re: /WELCOME|SALUDO|GREET|HELLO/i,                icon: '\uD83D\uDC4B' },        // 👋
  { re: /THANK/i,                                     icon: '\uD83D\uDE4F' },        // 🙏
  { re: /CONFIRM/i,                                   icon: '\u2705' },              // ✅
  { re: /REMINDER/i,                                  icon: '\u23F0' },              // ⏰
  { re: /FORM\b|JOT/i,                                icon: '\uD83D\uDCCB' },        // 📋
  { re: /CUSTOMER|CLIENT|GUEST|CLIENTE/i,             icon: '\uD83D\uDC64' },        // 👤
  { re: /ACCOMMO|HOUSE|ROOM|PROPERTY|LOCOPRICE/i,     icon: '\uD83C\uDFE0' }         // 🏠
];
function getSnippetIcon(title) {
  var t = String(title || '');
  for (var i = 0; i < ICON_RULES.length; i++) {
    if (ICON_RULES[i].re.test(t)) return ICON_RULES[i].icon;
  }
  return '\uD83D\uDCC4'; // 📄
}

// ── LANGUAGE ORDERING (EN → IT → ES → MULTI → rest) ───────────────
var LANG_ORDER = ['EN', 'IT', 'ES', 'MULTI'];
function langRank(l) {
  var i = LANG_ORDER.indexOf(l || 'EN');
  return i < 0 ? 99 : i;
}

// ── LABEL BUILDER: "{icon} TITLE · LANG · !!shortcut" ─────────────
function snippetLabel(s) {
  var ico = getSnippetIcon(s.title);
  var parts = [String(s.title || 'Untitled').trim()];
  if (s.lang) parts.push(String(s.lang).toUpperCase());
  if (s.shortcut) parts.push(String(s.shortcut));
  return ico + '  ' + parts.join('  \u00B7  ');
}

// ── SORT: respect sort_order, then keep lang variants adjacent (EN first) ──
function sortForMenu(arr) {
  return arr.slice().sort(function(a, b) {
    var sa = (a.sort_order == null) ? 1e9 : a.sort_order;
    var sb = (b.sort_order == null) ? 1e9 : b.sort_order;
    if (sa !== sb) return sa - sb;
    var ta = (a.title || '').toLowerCase();
    var tb = (b.title || '').toLowerCase();
    if (ta !== tb) return ta < tb ? -1 : 1;
    return langRank(a.lang) - langRank(b.lang);
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
          title: snippetLabel(s),
          contexts: ['editable']
        });
      });
    }

    // ── 2. FOLDERS (multi-snippet = submenu; single-snippet = flattened at root) ──
    var singletonSnips = [];
    var foldersWithMulti = [];
    folders.forEach(function(f) {
      var fSnips = byFolder[f.id] || [];
      if (fSnips.length === 0) return;
      if (fSnips.length === 1) {
        singletonSnips.push(fSnips[0]);
      } else {
        foldersWithMulti.push({ folder: f, snips: sortForMenu(fSnips) });
      }
    });

    var showingFoldersOrSingletons = foldersWithMulti.length > 0 || singletonSnips.length > 0;
    if (recent.length > 0 && showingFoldersOrSingletons) addSep('sb-root');

    foldersWithMulti.forEach(function(entry) {
      var f = entry.folder;
      var folderIco = (f.ico && /\p{Extended_Pictographic}/u.test(f.ico)) ? f.ico : '\uD83D\uDCC2'; // 📂
      chrome.contextMenus.create({
        id: 'sb-folder-' + f.id,
        parentId: 'sb-root',
        title: folderIco + '  ' + (f.name || 'Folder'),
        contexts: ['editable']
      });
      entry.snips.forEach(function(s) {
        chrome.contextMenus.create({
          id: 'sb-snip-' + s.id,
          parentId: 'sb-folder-' + f.id,
          title: snippetLabel(s),
          contexts: ['editable']
        });
      });
    });

    // Flattened single-snippet folders — at root, after multi-folders
    sortForMenu(singletonSnips).forEach(function(s) {
      chrome.contextMenus.create({
        id: 'sb-snip-' + s.id,
        parentId: 'sb-root',
        title: snippetLabel(s),
        contexts: ['editable']
      });
    });

    // ── 3. UNFILED (≥4 → submenu; 1–3 → inline) ───────────────────
    if (noFolder.length > 0) {
      var sortedNoFolder = sortForMenu(noFolder);
      if (showingFoldersOrSingletons || recent.length > 0) addSep('sb-root');

      if (sortedNoFolder.length >= 4) {
        chrome.contextMenus.create({
          id: 'sb-unfiled',
          parentId: 'sb-root',
          title: '\uD83D\uDCC4  Unfiled',  // 📄
          contexts: ['editable']
        });
        sortedNoFolder.forEach(function(s) {
          chrome.contextMenus.create({
            id: 'sb-snip-' + s.id,
            parentId: 'sb-unfiled',
            title: snippetLabel(s),
            contexts: ['editable']
          });
        });
      } else {
        sortedNoFolder.forEach(function(s) {
          chrome.contextMenus.create({
            id: 'sb-snip-' + s.id,
            parentId: 'sb-root',
            title: snippetLabel(s),
            contexts: ['editable']
          });
        });
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

    console.log('[SprintBrain] Context menus v2.15.6 built — ' +
      snippets.length + ' snippets, ' +
      foldersWithMulti.length + ' folder submenus, ' +
      singletonSnips.length + ' flattened, ' +
      recent.length + ' recent');
  });
}

// ── DASHBOARD URL ─────────────────────────────────────────────────
var SB_DASHBOARD_URL = 'https://sprintbrain.netlify.app/';

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
    loadData().then(buildContextMenus);
  });
}

// Rebuild menus the moment the popup saves a session (or signs out).
chrome.runtime.onMessage.addListener(function(msg) {
  if (msg && msg.type === 'auth_changed') initMenus();
});

// Build on install + create sync alarm
chrome.runtime.onInstalled.addListener(function(details) {
  chrome.alarms.create('sb_sync_alarm', {
    delayInMinutes: 1,
    periodInMinutes: 5
  });
  console.log('[SprintBrain] Sync alarm created');
  initMenus();
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
      console.log('[SprintBrain] Sync alarm recreated on startup');
    }
  });
  initMenus();
  bgNotionSync();
});

// ── ALARM LISTENER — fires every 5 minutes ──────────────────────
chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name !== 'sb_sync_alarm') return;
  console.log('[SprintBrain] Alarm fired — running background sync');
  _alarmSync();
});
// Message handler from popup
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'REFRESH_MENUS') {
    initMenus();
    sendResponse({ ok: true });
  }
  return true;
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
          chrome.storage.local.set({sb_notion_cfg: sCfg});
          _bgRunSync(sCfg);
        });
        return;
      }

      _bgRunSync(cfg);
    });
  } catch (e) {
    console.warn('[SprintBrain BG] Notion cfg read failed:', e.message);
  }
}

function _bgRunSync(cfg) {
  NotionSync.reset();
  NotionSync.run(cfg, {
    onComplete: function (snippets, ok) {
      console.log('[SprintBrain BG] Notion bg-sync:', ok ? snippets.length + ' snippet(s)' : 'used cache or skipped');
    },
    onError: function (err) {
      console.warn('[SprintBrain BG] Notion bg-sync failed:', err.message);
    }
  });
}

// ── ALARM SYNC — silent background sync every 5 minutes ─────────
function _alarmSync() {
  chrome.storage.local.get('sb_notion_cfg', function(d) {
    var cfg = (d && d.sb_notion_cfg) ? d.sb_notion_cfg : null;
    if (!cfg || !cfg.apiKey || !cfg.dbId) {
      console.log('[SprintBrain Alarm] Notion not configured — skipping');
      return;
    }

    // Check debounce — skip if synced in last 3 minutes
    chrome.storage.local.get('sb_notion_last_sync_ts', function(sd) {
      var lastSync = sd && sd['sb_notion_last_sync_ts'];
      if (lastSync) {
        var elapsed = Date.now() - new Date(lastSync).getTime();
        if (elapsed < 180000) {
          console.log('[SprintBrain Alarm] Skipped — synced ' +
            Math.round(elapsed / 1000) + 's ago');
          return;
        }
      }

      NotionSync.reset();
      NotionSync.run(cfg, {
        onProgress: function(state) {
          console.log('[SprintBrain Alarm] Sync state:', state);
        },
        onComplete: function(snippets, success) {
          if (!success) return;
          console.log('[SprintBrain Alarm] Sync complete —',
            snippets.length, 'snippet(s)');

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
          console.warn('[SprintBrain Alarm] Sync failed:', err.message);
        }
      });
    });
  });
}
