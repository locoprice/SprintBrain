// ── SPRINTBRAIN BACKGROUND v5.1 — Context Menus ───────────────────

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
chrome.runtime.onStartup.addListener(initMenus);

// Message handler from popup
chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  if (msg.type === 'REFRESH_MENUS') {
    initMenus();
    sendResponse({ ok: true });
  }
  return true;
});
