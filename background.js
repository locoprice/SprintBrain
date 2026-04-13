// ── SPRINTBRAIN BACKGROUND v2.12.4 — Context Menus + Notion Sync ──
importScripts('notion-sync.js');

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
      title: 'Insert SprintBrain snippet',
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
        title: f.name,
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
