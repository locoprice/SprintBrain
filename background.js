// ── SPRINTBRAIN BACKGROUND v2.8 — Context Menus ───────────────────

var SUPA_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
var SUPA_KEY = 'sb_publishable_F_8LSMkr9ZK-9v50sPzXbQ_zjA0D_O0';

function supaFetch(table, qs) {
  return fetch(SUPA_URL + '/rest/v1/' + table + '?' + qs, {
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY
    }
  }).then(function(r) { return r.json(); });
}

// ── LOAD SNIPPETS + FOLDERS FROM SUPABASE ─────────────────────────
function loadData() {
  return Promise.all([
    supaFetch('folders',  'select=*&order=sort_order'),
    supaFetch('snippets', 'select=id,title,shortcut,folder_id&order=sort_order')
  ]).then(function(res) {
    return {
      folders:  Array.isArray(res[0]) ? res[0] : [],
      snippets: Array.isArray(res[1]) ? res[1] : []
    };
  }).catch(function() { return { folders: [], snippets: [] }; });
}

// ── BUILD CONTEXT MENUS ───────────────────────────────────────────
function buildContextMenus(data) {
  // Remove all existing menus first
  chrome.contextMenus.removeAll(function() {

    // Root item — only shows in editable fields
    chrome.contextMenus.create({
      id: 'sb-root',
      title: '\u26A1 Insert Sprintbrain snippet',
      contexts: ['editable']
    });

    var folders  = data.folders;
    var snippets = data.snippets;

    if (snippets.length === 0) {
      chrome.contextMenus.create({
        id: 'sb-empty',
        parentId: 'sb-root',
        title: 'No snippets yet — open the popup to add one',
        contexts: ['editable'],
        enabled: false
      });
      return;
    }

    // Group snippets by folder
    var byFolder = {};
    var noFolder = [];

    snippets.forEach(function(s) {
      if (s.folder_id) {
        if (!byFolder[s.folder_id]) byFolder[s.folder_id] = [];
        byFolder[s.folder_id].push(s);
      } else {
        noFolder.push(s);
      }
    });

    // Create folder submenus
    folders.forEach(function(f) {
      var fSnips = byFolder[f.id] || [];
      if (fSnips.length === 0) return;

      // Folder submenu parent
      chrome.contextMenus.create({
        id: 'sb-folder-' + f.id,
        parentId: 'sb-root',
        title: (f.ico || '\uD83D\uDCC1') + ' ' + f.name,
        contexts: ['editable']
      });

      // Snippets inside folder
      fSnips.forEach(function(s) {
        chrome.contextMenus.create({
          id: 'sb-snip-' + s.id,
          parentId: 'sb-folder-' + f.id,
          title: s.title + '  \u00B7  ' + s.shortcut,
          contexts: ['editable']
        });
      });
    });

    // Snippets with no folder — directly under root
    if (noFolder.length > 0) {
      if (folders.length > 0) {
        // Separator
        chrome.contextMenus.create({
          id: 'sb-sep',
          parentId: 'sb-root',
          type: 'separator',
          contexts: ['editable']
        });
      }
      noFolder.forEach(function(s) {
        chrome.contextMenus.create({
          id: 'sb-snip-' + s.id,
          parentId: 'sb-root',
          title: s.title + '  \u00B7  ' + s.shortcut,
          contexts: ['editable']
        });
      });
    }

    console.log('[Sprintbrain] Context menus built —', snippets.length, 'snippets');
  });
}

// ── CONTEXT MENU CLICK HANDLER ────────────────────────────────────
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (!info.menuItemId || !String(info.menuItemId).startsWith('sb-snip-')) return;

  var snippetId = String(info.menuItemId).replace('sb-snip-', '');

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
  loadData().then(buildContextMenus);
}

// Build on install
chrome.runtime.onInstalled.addListener(initMenus);

// Rebuild when popup saves changes (snippets updated)
chrome.storage.onChanged.addListener(function(changes) {
  if (changes.sb_menu_refresh) initMenus();
});

// Rebuild on browser start
chrome.runtime.onStartup.addListener(function() {
  initMenus();
  bgNotionSync();
});
// Message handler from popup
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'REFRESH_MENUS') {
    initMenus();
    sendResponse({ ok: true });
  }
  return true;
});


// ── NOTION SYNC CONFIG READER ─────────────────────────────────────
function loadNotionCfgBg(cb) {
  try {
    chrome.storage.sync.get('notionCfg', function (d) {
      cb(d && d.notionCfg ? d.notionCfg : null);
    });
  } catch (e) { cb(null); }
}

// ── BACKGROUND NOTION SYNC ────────────────────────────────────────
var BG_SYNC_TS_KEY = 'sb_notion_last_sync_ts';
var BG_LOCK_KEY    = 'sb_notion_sync_lock';
var BG_LOCK_TTL_MS = 30000;

function bgNotionSync() {
  loadNotionCfgBg(function (cfg) {
    if (!cfg || !cfg.apiKey || !cfg.dbId) return;
    chrome.storage.local.get(BG_LOCK_KEY, function (d) {
      var lock = d && d[BG_LOCK_KEY];
      if (lock && (Date.now() - lock) < BG_LOCK_TTL_MS) return;
      var lockObj = {}; lockObj[BG_LOCK_KEY] = Date.now();
      chrome.storage.local.set(lockObj, function () {
        chrome.storage.local.get(BG_SYNC_TS_KEY, function (sd) {
          var lastSync = (sd && sd[BG_SYNC_TS_KEY]) ? sd[BG_SYNC_TS_KEY] : null;
          var syncStart = new Date().toISOString();
          var body = { page_size: 100 };
          if (lastSync) {
            body.filter = { timestamp: 'last_edited_time', last_edited_time: { after: lastSync } };
          }
          var controller = new AbortController();
          var timer = setTimeout(function () { controller.abort(); }, 8000);
          fetch('https://api.notion.com/v1/databases/' + cfg.dbId + '/query', {
            method: 'POST',
            headers: {
              'Authorization': 'Bearer ' + cfg.apiKey,
              'Content-Type': 'application/json',
              'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify(body),
            signal: controller.signal
          })
          .then(function (r) { clearTimeout(timer); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (data) {
            var pages = (data && Array.isArray(data.results)) ? data.results : [];
            console.log('[SprintBrain BG] Notion bg-sync:', pages.length, 'page(s)');
            var tsObj = {}; tsObj[BG_SYNC_TS_KEY] = syncStart;
            chrome.storage.local.set(tsObj);
          })
          .catch(function (err) { console.warn('[SprintBrain BG] Notion bg-sync failed:', err.message); })
          .finally(function () { var rel = {}; rel[BG_LOCK_KEY] = null; chrome.storage.local.set(rel); });
        });
      });
    });
  });
}
