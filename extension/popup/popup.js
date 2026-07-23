// SPRINTBRAIN POPUP v2.87.0 — read-only launcher + shared data core (management lives in the dashboard)

// SUPA_URL comes from auth.js (SB_SUPA_URL); legacy var kept for any downstream reference.
var SUPA_URL = SB_SUPA_URL;

// Authed REST wrapper. Refreshes once on 401, returns the original Response either way
// so existing callers reading `.json()` / `.ok` keep working.
function supaFetch(table, method, body, qs) {
  return new Promise(function(resolve, reject) {
    sbAuthHeaders(function(err, headers) {
      if (err || !headers) { reject(new Error('not_authed')); return; }
      _supaFire(table, method, body, qs, headers, false, resolve, reject);
    });
  });
}

function _supaFire(table, method, body, qs, headers, retried, resolve, reject) {
  var url  = SUPA_URL + '/rest/v1/' + table + (qs ? '?' + qs : '');
  var opts = {
    method: method || 'GET',
    headers: {
      'apikey': headers.apikey,
      'Authorization': headers.Authorization,
      'Content-Type': 'application/json',
      'Prefer': (method === 'POST' ? 'resolution=merge-duplicates,' : '') + 'return=minimal'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  fetch(url, opts).then(function(r) {
    if (r.status === 401 && !retried) {
      sbRefreshToken(function(rerr, fresh) {
        if (rerr || !fresh) { resolve(r); return; }
        _supaFire(table, method, body, qs,
          { apikey: SB_SUPA_ANON_KEY, Authorization: 'Bearer ' + fresh.access_token },
          true, resolve, reject);
      });
      return;
    }
    if (!r.ok) {
      r.clone().text().then(function(t) {
        console.error('[SprintBrain] supaFetch ' + method + ' ' + table + ' HTTP ' + r.status + ':', t);
        resolve(r);
      });
      return;
    }
    resolve(r);
  }).catch(reject);
}

// Returns the current authed user's id (set on every write payload).
var SB_CURRENT_USER_ID = null;

var DB = {
  loadAll: function() {
    // Show the current user's own snippets plus any shared by teammates.
    // SNIPPET-DISABLE-001: is_active=eq.true filters out soft-disabled
    // snippets so they don't appear in the popup picker and don't make it
    // into chrome.storage.local — which means content.js trigger matching
    // skips them automatically. The dashboard remains the only surface that
    // shows disabled snippets (so they can be re-enabled).
    // Phase B: snippet visibility is folder-level (View/Edit/Owner), not the
    // legacy global is_shared flag. accessible_snippets() (SECURITY DEFINER,
    // STABLE) returns personal + folder-readable rows in one call; PostgREST
    // lets us project/filter/order the function result like a table. This keeps
    // the popup picker, the right-click menu, and ;;-expansion on the SAME
    // source (background.js already reads this RPC).
    var snipQs = 'select=*&order=sort_order&is_active=eq.true';
    return Promise.all([
      supaFetch('folders',                 'GET', null, 'select=*&order=sort_order').then(function(r){ return r.json(); }),
      supaFetch('rpc/accessible_snippets', 'GET', null, snipQs).then(function(r){ return r.json(); }),
      supaFetch('snippet_stats',           'GET', null, 'select=*').then(function(r){ return r.json(); })
    ]).then(function(res) {
      var folders  = Array.isArray(res[0]) ? res[0] : [];
      var snippets = Array.isArray(res[1]) ? res[1] : [];
      var stats    = Array.isArray(res[2]) ? res[2] : [];
      var sm = {};
      stats.forEach(function(s) { sm[s.snippet_id] = s; });
      return {
        folders: folders,
        snippets: snippets.map(function(s) {
          var st = sm[s.id] || { uses: 0, fills: 0, last_used: null };
          return {
            id: s.id, title: s.title, shortcut: s.shortcut || '',
            body: s.body || '', lang: s.lang || 'EN',
            bodies: (s.bodies && typeof s.bodies === 'object') ? s.bodies : {},
            folder: s.folder_id || '', fieldCfg: s.field_cfg || {}, lang_group_id: s.lang_group_id || s.id,
            sort_order: s.sort_order || 0,
            enable_urgency_timer: s.enable_urgency_timer || false,
            timer_duration_ms: s.timer_duration_ms || 0,
            scarcity_count: s.scarcity_count || 0,
            notion_page_id: s.notion_page_id || null,
            manually_edited: s.manually_edited || false,
            ai_generated: s.ai_generated || false,
            pinned: s.pinned || false,
            stats: { uses: st.uses || 0, fills: st.fills || 0, lastUsed: st.last_used || null }
          };
        })
      };
    }).catch(function(e) { console.error('[Sprintbrain] loadAll:', e); return null; });
  },
  upsertSnippet: function(s) {
    supaFetch('snippets', 'POST', {
      id: s.id, user_id: SB_CURRENT_USER_ID, title: s.title, shortcut: s.shortcut || '',
      body: s.body || '', lang: s.lang || 'EN',
      bodies: (s.bodies && typeof s.bodies === 'object') ? s.bodies : {},
      folder_id: s.folder || null, field_cfg: s.fieldCfg || {}, lang_group_id: s.lang_group_id || s.id,
      sort_order: s.sort_order || 0,
      enable_urgency_timer: s.enable_urgency_timer || false,
      timer_duration_ms: s.timer_duration_ms || 0,
      scarcity_count: s.scarcity_count || 0,
      notion_page_id: s.notion_page_id || null,
      manually_edited: s.manually_edited || false,
      ai_generated: s.ai_generated || false,
      pinned: s.pinned || false
    }).catch(function(e) {
      console.error('upsertSnippet:', e);
      try { showToast('Save failed — changes may not have synced'); } catch (_) {}
    });
  },
  deleteSnippet: function(id) {
    SBPopupSync.performSnippetDelete(supaFetch, id, function(e) {
      console.error('deleteSnippet:', e);
      try { showToast('Delete failed — please retry'); } catch (_) {}
    });
  },
  upsertFolder: function(f) {
    supaFetch('folders', 'POST', {
      id: f.id, user_id: SB_CURRENT_USER_ID, name: f.name, ico: f.ico || 'folder', sort_order: f.sort_order || 0
    }).catch(function(e) { console.error('upsertFolder:', e); });
  },
  deleteFolder: function(id) {
    supaFetch('folders', 'DELETE', null, 'id=eq.' + id).catch(function(e) { console.error('deleteFolder:', e); });
  },
  updateStats: function(snippetId, uses, fills, lastUsed) {
    supaFetch('snippet_stats', 'POST', {
      snippet_id: snippetId, user_id: SB_CURRENT_USER_ID, uses: uses, fills: fills, last_used: lastUsed
    }).catch(function(e) { console.error('updateStats:', e); });
  },
  loadPrompts: function() {
    // No user_id filter — RLS handles both personal and org-shared prompts.
    return supaFetch('prompts', 'GET', null,
      'select=id,name,content,shortcut,type,tags,intent_category,last_used_at&order=updated_at.desc'
    ).then(function(r) { return r.ok ? r.json() : []; })
      .catch(function() { return []; });
  }
};

// ── USER PREFERENCES ──────────────────────────────────────────────
var userPrefs = { defaultLang: 'EN', aiProvider: 'anthropic', aiModel: 'claude-sonnet-4-20250514', aiApiKey: '' };

function loadUserPrefs(cb) {
  chrome.storage.local.get('sb_user_prefs', function(d) {
    if (d && d.sb_user_prefs) {
      var p = d.sb_user_prefs;
      if (p.defaultLang) userPrefs.defaultLang = p.defaultLang;
      if (p.aiProvider) userPrefs.aiProvider = p.aiProvider;
      if (p.aiModel) userPrefs.aiModel = p.aiModel;
      if (p.aiApiKey) userPrefs.aiApiKey = p.aiApiKey;
    }
    // Sync default language to chrome.storage.sync for content.js
    try { chrome.storage.sync.set({ sb_default_lang: userPrefs.defaultLang }); } catch(e) {}
    if (cb) cb();
  });
}

function saveUserPrefs() {
  chrome.storage.local.set({ sb_user_prefs: userPrefs });
  try { chrome.storage.sync.set({ sb_default_lang: userPrefs.defaultLang }); } catch(e) {}
}

// DEFAULT DATA
var DEFAULT_FOLDERS = [
  { id: 'f1', name: 'Presupuestos', ico: 'dollar', sort_order: 1 },
  { id: 'f2', name: 'AI Prompts',   ico: 'cpu', sort_order: 2 }
];

// STATE — start empty; defaults are never shown (prevents race condition where user
// edits a DEFAULT_SNIPPET before Supabase loads and the save silently fails).
var snips        = [];
var folders      = [];
var prompts      = [];
var trig         = '::';
var selFolder    = 'ALL';
var activeMode   = 'snippets';

// v2 launcher UI state (popup-only; all null-guarded so the shared core in
// Sprintbrain.html is unaffected — it drives its own nv-* presentation).
var expandedId      = null;   // snippet id whose inline detail is open
var detailLang      = null;   // active language inside the open detail
var detailFieldVals = {};     // user-entered field values for the open detail's fill form
var selIdx          = -1;     // keyboard selection index in the snippet list
var pSelIdx         = -1;     // keyboard selection index in the prompt list
var loaded          = false;  // true once the authoritative Supabase load resolves
var listAnimated    = false;  // entrance animation runs once, on first data render
var searchAllFolders= false;  // "search all folders" escape from a folder-scoped miss

// TRIGGER CONFIGURATION — synced via chrome.storage.sync + Notion
var triggerCfg = { snippetTrigger: '::', promptTrigger: '"""', snippetActivationKey: 'Tab', promptActivationKey: 'Tab', selectionSuggestions: true };

function loadTriggerCfg(cb) {
  try {
    chrome.storage.sync.get('triggerCfg', function(d) {
      if (d && d.triggerCfg) {
        if (d.triggerCfg.snippetTrigger) triggerCfg.snippetTrigger = d.triggerCfg.snippetTrigger;
        if (d.triggerCfg.promptTrigger) triggerCfg.promptTrigger = d.triggerCfg.promptTrigger;
        if (d.triggerCfg.snippetActivationKey) triggerCfg.snippetActivationKey = d.triggerCfg.snippetActivationKey;
        if (d.triggerCfg.promptActivationKey) triggerCfg.promptActivationKey = d.triggerCfg.promptActivationKey;
        if (typeof d.triggerCfg.selectionSuggestions === 'boolean') triggerCfg.selectionSuggestions = d.triggerCfg.selectionSuggestions;
      }
      if (cb) cb();
    });
  } catch(e) { if (cb) cb(); }
}
// Reflect the current triggerCfg on the read-only settings pane and the local
// prefs. Idempotent — called on first load and again after a user_metadata pull.
// Also derives the display prefix `trig` from the snippet trigger: the popup no
// longer writes triggers, it mirrors the dashboard-owned setting.
function applyTriggerCfgToInputs() {
  trig = triggerCfg.snippetTrigger || trig;
  var ti = gi('itrig');   if (ti) ti.textContent = triggerCfg.snippetTrigger;
  var pi = gi('iprompt'); if (pi) pi.textContent = triggerCfg.promptTrigger;
  var ie = gi('iex');     if (ie) ie.textContent = triggerCfg.snippetTrigger + 'quoteEN';
  var ss = gi('tcfg-sel-suggest'); if (ss) ss.checked = triggerCfg.selectionSuggestions !== false;
  // Segmented-control glyphs mirror the live triggers (never hardcoded).
  var mgs = gi('mglyph-snip');  if (mgs) mgs.textContent = triggerCfg.snippetTrigger;
  var mgp = gi('mglyph-prmpt'); if (mgp) mgp.textContent = triggerCfg.promptTrigger;
}
function saveTriggerCfg() {
  try { chrome.storage.sync.set({triggerCfg: triggerCfg}); } catch(e) {}
}
function validateTriggerSeq(seq) {
  if (!seq || typeof seq !== 'string') return false;
  seq = seq.trim();
  return seq.length >= 1 && seq.length <= 5 && !/\s/.test(seq) && !/^[a-zA-Z0-9]$/.test(seq);
}
function triggerWouldCollide(key, val) {
  var otherKey = key === 'snippetTrigger' ? 'promptTrigger' : 'snippetTrigger';
  var otherVal = triggerCfg[otherKey];
  return val === otherVal || otherVal.indexOf(val) === 0 || val.indexOf(otherVal) === 0;
}

// NOTION SYNC — credentials (local cache, reconciled with user_metadata)
var notionCfg = { apiKey: '', dbId: '' };

function loadNotionCfg(cb) {
  chrome.storage.local.get('sb_notion_cfg', function(d) {
    if (d && d.sb_notion_cfg) {
      notionCfg = d.sb_notion_cfg;
      if (cb) cb();
    } else {
      chrome.storage.sync.get('notionCfg', function(old) {
        if (old && old.notionCfg) {
          notionCfg = old.notionCfg;
          saveNotionCfg();
        }
        if (cb) cb();
      });
    }
  });
}
function saveNotionCfg() {
  chrome.storage.local.set({ sb_notion_cfg: notionCfg });
}

// Pull Notion credentials from Supabase user_metadata (written by the dashboard).
// Merges into local config, overwrites only fields that are currently empty.
// Calls cb() when done (including on error, so callers always continue).
function syncNotionCfgFromSupabase(cb) {
  sbAuthHeaders(function(err, headers) {
    if (err || !headers) { if (cb) cb(); return; }
    fetch(SB_SUPA_URL + '/auth/v1/user', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(j) {
        var meta = (j && j.user_metadata) ? j.user_metadata : {};
        var remoteKey = meta.notion_api_key || '';
        var remoteDb  = meta.notion_db_id  || '';
        var changed = false;
        if (!notionCfg.apiKey && remoteKey) { notionCfg.apiKey = remoteKey; changed = true; }
        if (!notionCfg.dbId  && remoteDb)  { notionCfg.dbId   = remoteDb;  changed = true; }
        if (changed) saveNotionCfg();
        if (cb) cb();
      })
      .catch(function() { if (cb) cb(); });
  });
}

// Push current Notion credentials to Supabase user_metadata so the dashboard stays in sync.
// Best-effort: failures are silent (local storage is the authoritative source for the extension).
function pushNotionCfgToSupabase() {
  sbAuthHeaders(function(err, headers) {
    if (err || !headers) return;
    fetch(SB_SUPA_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: Object.assign({}, headers, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ data: { notion_api_key: notionCfg.apiKey, notion_db_id: notionCfg.dbId } })
    }).catch(function() {});
  });
}

// HELPERS
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid(){  return 's'+Date.now()+Math.random().toString(36).slice(2,5); }
function fuid(){ return 'f'+Date.now()+Math.random().toString(36).slice(2,5); }
function gi(id){ return document.getElementById(id); }

function show(id){
  ['pane-list','pane-cfg'].forEach(function(p){
    var el=gi(p); if(el) el.className='pane'+(p===id?' on':'');
  });
}

function loadTrigger(cb){
  try{ chrome.storage.sync.get('trigger',function(d){ if(d&&d.trigger) trig=d.trigger; if(cb) cb(); }); }
  catch(e){ if(cb) cb(); }
}
function saveTrigger(){ try{ chrome.storage.sync.set({trigger:trig}); }catch(e){} }
// Snippets are stored in chrome.storage.local (5MB) because the array exceeds
// chrome.storage.sync's 8KB per-item limit, causing silent write failures.
// Cross-device sync is handled by Supabase, not chrome.storage.sync.
function syncSnippets(){
  try{
    chrome.storage.local.set({snippets:snips}, function(){
      if(chrome.runtime.lastError) console.error('syncSnippets local:', chrome.runtime.lastError.message);
    });
    // Also clear any stale snippets in sync (from pre-v2.13.1 versions) so
    // content.js doesn't accidentally fall back to an out-of-date list.
    chrome.storage.sync.remove('snippets', function(){
      if(chrome.runtime.lastError) { /* ignore: key may not exist */ }
    });
  }catch(e){ console.error('syncSnippets:',e); }
}

// Push the dashboard Prompt List to chrome.storage.local so the content
// script's """ picker can merge it with its built-in Base Prompts. Mirrors
// syncSnippets(); maps the public.prompts row shape to the picker's item shape
// (name -> title, content -> body, tags -> alternative_queries for search).
function syncPrompts(){
  try{
    var mapped = (prompts||[]).map(function(p){
      return {
        id: p.id,
        title: p.name || 'Untitled',
        body: p.content || '',
        shortcut: p.shortcut || '',
        alternative_queries: Array.isArray(p.tags) ? p.tags : []
      };
    });
    chrome.storage.local.set({sb_prompts:mapped}, function(){
      if(chrome.runtime.lastError) console.error('syncPrompts local:', chrome.runtime.lastError.message);
    });
  }catch(e){ console.error('syncPrompts:',e); }
}


// ── FAVICON — brand mark by default, company logo when the user sets one ──
// Shared by the popup and Sprintbrain.html (both load popup.js), so the DOM
// behaviour is identical on both surfaces (parity). The per-surface brand path
// lives on the <link data-brand>, so this stays path-agnostic. On the extension
// the *visible* toolbar icon is driven separately by the service worker
// (background.js → chrome.action.setIcon); the popup <link> is invisible but
// kept in parity here.
function sbSetFavicon(href) {
  var link = document.getElementById('sb-favicon');
  if (!link) return;
  var target = (typeof href === 'string' && href) ? href : (link.getAttribute('data-brand') || '');
  if (target && link.getAttribute('href') !== target) link.setAttribute('href', target);
}

// Extract a validated company-logo URL from user_metadata and apply it as the
// favicon, falling back to the brand mark when unset. `meta` is the
// auth.users.user_metadata object (company_logo_url is written by the dashboard).
function sbApplyCompanyFavicon(meta) {
  var url = (meta && typeof meta.company_logo_url === 'string' &&
             meta.company_logo_url.indexOf('https://') === 0) ? meta.company_logo_url : null;
  sbSetFavicon(url);
}

// ── CHANGELOG ─────────────────────────────────────────────────────
var CHANGELOG = [
  { version:'v2.117.0', date:'2026-07-23', label:'feat: your company logo as the app icon',
    changes:[
      {type:'new', text:'Set a company logo in Branding and it becomes the SprintBrain icon — the browser-tab favicon on the dashboard, and the toolbar button for the extension. With no logo set, the SprintBrain mark shows.'}
    ]},
  { version:'v2.110.0', date:'2026-07-18', label:'feat: wider popup',
    changes:[
      {type:'new', text:'The popup is a little wider (540px), so snippet titles and shortcuts have more room before they get cut off.'}
    ]},
  { version:'v2.109.0', date:'2026-07-18', label:'feat: click a snippet row to open it',
    changes:[
      {type:'new', text:'Clicking anywhere on a snippet row now opens its inline detail — languages, fill fields and the live preview. The row no longer copies the shortcut: Copy filled, Copy raw and Copy shortcut live inside the detail.'},
      {type:'new', text:'The web dashboard behaves the same — rows expand in place with the exact same detail. In the popup, Enter opens the selected snippet; Enter again copies the result.'}
    ]},
  { version:'v2.99.0', date:'2026-07-11', label:'fix: folder chips scroll with the mouse',
    changes:[
      {type:'fix', text:'When you have more folders than fit across the top, arrow buttons now appear at the edges and the mouse wheel scrolls the folder chips left and right. Before, folders past the right edge were cut off with no way to reach them using a mouse.'}
    ]},
  { version:'v2.98.0', date:'2026-07-11', label:'feat: fill snippet fields and copy the result from the popup',
    changes:[
      {type:'new', text:'Open a snippet in the popup and, if it has fields like {guest_name}, fill them right there and hit Copy filled — you get the finished text ready to paste into WhatsApp Web or anywhere the in-field trigger is awkward.'},
      {type:'new', text:'Dates, formulas and conditional blocks resolve too, using the same engine as the in-page trigger, so the copied text matches exactly. Copy raw still gives you the untouched template.'}
    ]},
  { version:'v2.97.0', date:'2026-07-11', label:'feat: popup redesign — a faster, search-first launcher',
    changes:[
      {type:'new', text:'The popup opens with the search box focused — just type to filter, press Enter to copy the top result. Arrow keys move through the list; no mouse needed.'},
      {type:'new', text:'Folders are now scrollable chips across the top instead of a narrow sidebar, so long folder names read in full and snippet rows use the whole width.'},
      {type:'new', text:'Open a snippet to see its languages side by side and copy the body text in any one of them — the extension could only copy the shortcut before.'},
      {type:'new', text:'Bigger, touch-friendly rows; a single "Open Dashboard" button; and the Notion status now lives as a small chip in the header that only appears once Notion is connected.'},
      {type:'fix', text:'The list no longer flashes "No snippets found" while it loads — it shows your cached snippets instantly, then refreshes.'}
    ]},
  { version:'v2.95.0', date:'2026-07-09', label:'feat: right-click menu icons match the app',
    changes:[
      {type:'new', text:'Folder and snippet icons in the right-click menu now come from the same icon set as the dashboard and the mobile app. A snippet shows its folder icon, so the same item looks the same on every surface.'},
      {type:'fix', text:'A folder whose icon you set in the dashboard now shows that icon in the menu, instead of a generic folder glyph.'}
    ]},
  { version:'v2.94.0', date:'2026-07-09', label:'feat: compact right-click menu, grouped by language',
    changes:[
      {type:'new', text:'Language variants of a snippet collapse into one entry with a language submenu. A folder that listed 30 rows now reads as about a dozen: pick the snippet, then the language.'},
      {type:'new', text:'Tighter rows showing icon, title and language only. The trigger shortcut moved off the menu; it is still shown on every snippet in the popup and dashboard.'},
      {type:'new', text:'Clear sections with headers and separators for Recent, your folders and Unfiled, plus sharper icons for airport, price, time and withdraw.'}
    ]},
  { version:'v2.93.0', date:'2026-07-09', label:'fix: the extension stays signed in',
    changes:[
      {type:'fix', text:'"Sign in via dashboard" now gives the extension a session of its own instead of borrowing the dashboard’s — the two no longer sign each other out'},
      {type:'fix', text:'A network blip or server hiccup during token refresh no longer signs you out — the extension keeps your session and retries'},
      {type:'new', text:'"Keep me signed in" now renews while you use SprintBrain, so an active account stays signed in until you sign out'}
    ]},
  { version:'v2.87.0', date:'2026-07-03', label:'refactor: read-only popup — manage everything in the dashboard',
    changes:[
      {type:'refactor', text:'The popup is now a fast launcher: browse, search and copy snippets and prompts. Creating and editing snippets, folders, triggers, Notion credentials and Team Sync live only in the dashboard — one source of truth, no drift between surfaces'},
      {type:'new', text:'"Open Dashboard" button in the footer and a "Manage in dashboard" shortcut in Settings — both reuse an already-open dashboard tab instead of stacking duplicates'},
      {type:'refactor', text:'Settings pane slimmed to extension-local preferences (default language, selection suggestions) plus a read-only view of the active triggers, which sync from your dashboard settings'}
    ]},
  { version:'v2.73.0', date:'2026-06-24', label:'fix: team-shared snippets & prompts now sync to the mobile companion',
    changes:[
      {type:'fix', text:'Mobile companion (/mobile/) now shows team-shared snippets, prompts and folders. It was reading personal-only because every query filtered by user_id — so snippets like "Time" shared by a teammate were missing. Snippets now load via the accessible_snippets() RPC (the same source as this popup); folders and prompts rely on RLS, so org-shared rows surface for every member'},
      {type:'new', text:'Mobile new-folder form gains an icon picker and renders the shared SVG glyph set, matching the popup and dashboard'}
    ]},
  { version:'v2.64.0', date:'2026-06-21', label:'fix: Team Sync restored — shared snippets & prompts now visible to all team members',
    changes:[
      {type:'fix', text:'Team Sync button restored in Settings — moves personal snippets and prompts into the team-shared folder via the Phase B folder ACL, so all org members can see them through accessible_snippets()'},
      {type:'fix', text:'DB.loadPrompts() no longer filters by user_id — RLS now returns both personal and org-shared prompts in a single query'},
      {type:'fix', text:'Supabase migration adds leibtour@gmail.com to LeibTour org (admin) — was omitted from B1, blocking visible-to-team resolution via can_read_folder()'}
    ]},
  { version:'v2.57.0', date:'2026-06-03', label:'feat: roomier popup + one-click Dashboard link + dashboard prompts in the """ picker',
    changes:[
      {type:'new', text:'Popup window is now larger — wider columns and a taller list so snippet titles, folder names and language badges have more breathing room and more rows show at a glance'},
      {type:'new', text:'New "Dashboard" button in the popup header opens app.sprintbrain.com in a browser tab, and focuses the existing tab if the dashboard is already open'},
      {type:'new', text:'The """ prompt picker now lists your saved dashboard prompts ("Prompt List") alongside the built-in Base Prompts — add a prompt in the dashboard and it shows up in any text field; the picker also works now even before you have any snippets'}
    ]},
  { version:'v2.40.0', date:'2026-05-19', label:'fix: snippet expansion — trigger no longer survives celebration on contenteditable fields',
    changes:[
      {type:'fix', text:'For CE fields (Gmail, Slack, Notion, etc.), the trigger text (e.g. ::time) now deletes atomically before the celebration modal appears, so focus changes during the 5-second window no longer leave ::shortcut in the field'},
      {type:'fix', text:'Same fix applied to the quick-picker (selectTriggerItem) code path'},
      {type:'fix', text:'restoreFieldState Undo path correctly skips re-deletion when the trigger was already pre-deleted'}
    ]},
  { version:'v2.38.0', date:'2026-05-18', label:'feat: design system v1.1 — harmonized across mobile, dashboard, extension',
    changes:[
      {type:'feat', text:'Single Azure primary (#1B4FD8) across every surface; Iris purple #6C5CE7 removed entirely from popup, overlay, and dashboard'},
      {type:'feat', text:'Mobile companion (/mobile/) redesigned: gradient hero, floating quick-action grid, Uber-style chips, Apple/Revolut tab bar'},
      {type:'feat', text:'Dashboard topbar hoisted to full width with brand square; sidebar active state gets 3px left bar + filled count pill'},
      {type:'feat', text:'Language palette aligned across surfaces: IT switched from red to green; MULTI violet added; FR aliased to MULTI'},
      {type:'feat', text:'Canonical mockup at design_handoff_design_system/mockups/harmonized-final.html is now the visual source of truth (codified in CLAUDE.md §Design System v1.1)'}
    ]},
  { version:'v2.37.0', date:'2026-05-16', label:'feat: Notion credentials shared between dashboard and extension via Supabase',
    changes:[
      {type:'feat', text:'Dashboard NotionSyncPanel now has editable API key and database ID fields; credentials are stored in Supabase user_metadata'},
      {type:'feat', text:'Extension pulls credentials from Supabase on boot if chrome.storage.local is empty, so dashboard-entered credentials are picked up automatically'},
      {type:'feat', text:'Extension pushes credentials to Supabase on every change, so the dashboard stays in sync with popup edits'},
      {type:'feat', text:'Single source of truth: both surfaces read and write notion_api_key / notion_db_id from auth.users.user_metadata'}
    ]},
  { version:'v2.36.0', date:'2026-05-14', label:'Fix: Notion sync dedup — one row per snippet group, multi-lang Body properties',
    changes:[
      {type:'fix', text:'NotionPush now groups all language variants by lang_group_id and upserts a single Notion page per snippet — no more N rows for N languages'},
      {type:'fix', text:'Per-language Body properties (Body EN, Body IT, Body ES, Body MULTI) replace the single Body field; Notion pull recreates all variants from these properties'},
      {type:'fix', text:'onComplete match logic now prioritises exact snippet id before falling back to notion_page_id+lang — prevents variant cross-contamination on re-sync'},
      {type:'fix', text:'Sync is idempotent: triggering sync multiple times on the same snippets produces no new Notion rows'}
    ]},
  { version:'v2.35.0', date:'2026-05-14', label:'Fix: stop DEFAULT_SNIPPETS flash + old-snippet save race condition',
    changes:[
      {type:'fix', text:'snips and folders now initialise as empty arrays instead of DEFAULT_SNIPPETS/DEFAULT_FOLDERS — no hardcoded snippets are ever shown before Supabase data loads'},
      {type:'fix', text:'Eliminated race condition: opening Edit on a DEFAULT_SNIPPET before DB loaded set editId to a string key (e.g. "quoteEN") that no longer existed in snips after load, causing doSave() to return silently without saving'},
      {type:'fix', text:'doSave() now shows a visible error toast when findSnip(editId) returns null, so failures are never silent'},
      {type:'fix', text:'Empty-DB branch now sets folders=DEFAULT_FOLDERS in memory (not just seeds to Supabase) so folder sidebar renders correctly on first-ever launch'}
    ]},
  { version:'v2.32.0', date:'2026-05-10', label:'Fix: snippet edits persist — Notion sync respects manually_edited flag',
    changes:[
      {type:'fix', text:'Removing "!!" (or any trigger prefix) from a snippet shortcut or body now persists across popup restarts — Notion sync no longer overwrites manually-edited snippets'},
      {type:'fix', text:'_runNotionSync onComplete skips overwriting any snippet where manually_edited=true, so Notion can no longer restore stale shortcuts'},
      {type:'fix', text:'The always-upsert pass (line 856) now checks manually_edited before pushing Notion data back to Supabase'},
      {type:'fix', text:'doSave(), applyTrig(), and trigger-change handler all set manually_edited=true so the guard is active from the first save'}
    ]},
  { version:'v2.31.0', date:'2026-05-09', label:'Changelog modal: missing entry + key fix + footer',
    changes:[
      {type:'fix', text:'v2.30.0 entry was missing from CHANGELOG — modal appeared empty when opened on the latest build'},
      {type:'fix', text:'Renderer now reads rel.changes || rel.items so entries written with either key display correctly (v2.27–v2.29 were silently blank)'},
      {type:'new', text:'Changelog modal footer shows "Ver. [latest] Last Update: [date]" for at-a-glance version info'}
    ]},
  { version:'v2.30.0', date:'2026-05-09', label:'Push-to-Sync team snippet sharing',
    changes:[
      {type:'new', text:'Team Sync section in Settings — "Sincronizza Snippet con il Team" button promotes private snippets to team-visible status on demand'},
      {type:'new', text:'DB: is_shared column added to snippets; RLS policy extended to expose shared snippets to all authenticated team members'},
      {type:'new', text:'Extension loadData() now fetches both private (user_id match) and shared snippets in a single OR-filtered query'},
      {type:'new', text:'Last sync timestamp persisted to chrome.storage.local and displayed in the Team Sync panel'}
    ]},
  { version:'v2.29.0', date:'2026-05-09', label:'Fix: lang-modal expansion now replaces trigger text',
    items:[
      {type:'fix', text:'Picking a language no longer leaves the literal ::shortcut in the field. Root cause: trigger chars were pre-deleted before opening the modal, but the contenteditable path of deleteChars only SETS a non-collapsed selection — opening the modal stole focus and wiped that selection, so the eventual insertText fell back to inserting at the cursor and the trigger survived. Fix: pass the trigger length through the modal and let handleMatch perform the delete + insert atomically after the user picks a language.'}
    ]},
  { version:'v2.28.0', date:'2026-05-09', label:'Fix: case-insensitive shortcut match + empty-body CE expansion',
    items:[
      {type:'fix', text:'::Time (or any mixed-case variant) now directly expands ::time without requiring the picker — shortcut comparison is now case-insensitive'},
      {type:'fix', text:'Typing a shortcut whose snippet has an empty body no longer leaves the trigger text selected in the field (contenteditable fix: execCommand is now always fired on the first line so the non-collapsed selection is atomically cleared)'}
    ]},
  { version:'v2.27.0', date:'2026-05-08', label:'Fix: clean lang modal insertion + deduplicated picker',
    items:[
      {type:'fix', text:'Trigger chars (e.g. ::goodnight) are now deleted before the language modal appears, so the chosen translation inserts cleanly without leftover text'},
      {type:'fix', text:'Trigger picker now shows one entry per language group instead of listing every variant (EN/ES/IT/FR) separately — selecting it opens the language modal'}
    ]},
  { version:'v2.26.0', date:'2026-05-08', label:'Fix: lang modal now fires from trigger picker',
    changes:[
      {type:'fix', text:'The language picker modal was only wired into checkBuf() (direct full-trigger match) but NOT into selectTriggerItem() (the inline trigger picker that appears when typing ::goo…). Since most users select snippets from the picker, the modal never appeared. Now both paths share _findLangVariants() and show the modal when siblings exist.'},
      {type:'refactor', text:'Extracted _findLangVariants(item) as a shared helper — dual-pass detection (lang_group_id first, shortcut-base heuristic second) used by both checkBuf() and selectTriggerItem().'}
    ]},
  { version:'v2.26.0', date:'2026-05-15', label:'Fix: OTP email delivery failure — diagnostic logging for auth errors',
    changes:[
      {type:'fix', text:'Added HTTP status code logging to sbRequestOtp so SMTP failures (e.g. 535 Authentication credentials invalid) appear in the browser console. Rate-limit responses (HTTP 429) now surface a clear user message instead of the raw Supabase error string.'},
      {type:'fix', text:'Added console.error logging to LoginPage.tsx signInWithOtp error path for the same diagnostic purpose.'}
    ]},
  { version:'v2.25.0', date:'2026-05-08', label:'Fix: multi-language modal now fires for all snippets',
    changes:[
      {type:'fix', text:'Modal was never triggered because all snippets have lang_group_id=null in Supabase. Added a shortcut-base heuristic as fallback: strips the trailing language suffix (EN/ES/IT/FR/MULTI) from the shortcut and groups snippets that share the same base (e.g. /quoteEN + /quoteES + /quoteIT → modal with 3 buttons). Explicit lang_group_id is still tried first for forward compatibility.'}
    ]},
  { version:'v2.24.0', date:'2026-05-08', label:'Language picker modal for multi-language snippets',
    changes:[
      {type:'feat', text:'When typing a trigger that matches a snippet with multiple language variants, a modal now appears letting the user pick the target language (EN/IT/ES/FR) before inserting. Each button shows the country flag and language name. Escape or backdrop click cancels without insertion.'}
    ]},
  { version:'v2.23.2', date:'2026-05-08', label:'Submenu flips left near popup edge',
    changes:[
      {type:'fix', text:'"Move to folder" submenu no longer hides past the popup right edge — when the parent menu is anchored near the right side, the submenu flips to the left (reported by Alessandro after the v2.23.1 patch)'}
    ]},
  { version:'v2.23.1', date:'2026-05-08', label:'Popup context-menu polish',
    changes:[
      {type:'fix', text:'"More actions" dropdown no longer clips behind the popup edge — menu measures itself off-screen, then clamps inside the viewport with a 4px safe margin (reported by Alessandro)'},
      {type:'fix', text:'Empty-area context menu now uses the same boundary-aware clamping logic'},
      {type:'fix', text:'Removed "Share snippet" entry from the snippet context menu — handler and menu item both gone'}
    ]},
  { version:'v2.23.0', date:'2026-05-08', label:'Strict colon-prefix trigger',
    changes:[
      {type:'fix', text:'Removed implicit bare-keyword matching — snippets now fire ONLY when the user types the configured "::" prefix (reported by Valentina, false positives in normal prose)'},
      {type:'fix', text:'Typing a shortcut as part of a sentence ("the price is...") no longer expands. The "::" trigger is mandatory for every snippet, regardless of how it was stored'}
    ]},
  { version:'v2.22.1', date:'2026-05-07', label:'Gmail false-positive fix',
    changes:[
      {type:'fix', text:'Implicit word-boundary trigger no longer fires on the lone keyword at buffer start (typing "time" in fresh Gmail compose was firing /time)'},
      {type:'fix', text:'Buffer sanitized for zero-width / NBSP / soft-hyphen artifacts injected by rich-text contenteditable (Gmail, Slack)'},
      {type:'fix', text:'Implicit keyword minimum raised from 2 → 3 chars; preceding-char check switched to explicit delimiter allowlist'}
    ]},
  { version:'v2.22.0', date:'2026-05-07', label:'Design System Redesign',
    changes:[
      {type:'new', text:'Popup redesigned to match SprintBrain design system — iris accent, new typography tokens, refined spacing'},
      {type:'new', text:'shared/tokens/colors_and_type.css imported into the popup bundle (--sb-* design tokens)'},
      {type:'new', text:'Sync bar uses CheckCircle icon in --sb-ok green; header count rendered as muted pill chip'},
      {type:'new', text:'Edit and New Snippet buttons restyled with --sb-line border and --sb-r-xl radius'},
      {type:'new', text:'Version bar uses .ver-bar / .dt classes with --sb-mono and --sb-ink-subtle tokens'}
    ]},
  { version:'v2.21.0', date:'2026-05-07', label:'Paste Fix + Implicit Triggers + Sidebar Sync',
    changes:[
      {type:'fix', text:'Paste with "/" no longer triggers snippet execution — dedicated paste guard clears buffer before any trigger evaluation'},
      {type:'fix', text:'Ctrl+V / Cmd+V keydown no longer leaks characters into the trigger buffer'},
      {type:'new', text:'Implicit trigger system — typing a bare keyword (e.g. "price") now activates the matching snippet with word-boundary detection; ::price still works as before'},
      {type:'fix', text:'Sidebar and snippet list always refresh after Notion sync completes, even when no diff was detected'},
      {type:'fix', text:'Extension version display always reads from manifest — no stale cached value'}
    ]},
  { version:'v2.16.1', date:'2026-04-25', label:'WhatsApp Trigger Residue Fix',
    changes:[
      {type:'fix', text:'Trigger text (e.g. ::firma) no longer left as residue after snippet insertion in WhatsApp Web'},
      {type:'fix', text:'insertText: fixed inverted containment check that caused unnecessary el.focus() on inner Lexical span, resetting the deletion selection'},
      {type:'fix', text:'checkBuf: direct snippet match now cancels the debounce picker timer, preventing a spurious picker after a direct trigger fires'}
    ]},
  { version:'v2.9.1', date:'2026-03-29', label:'Deferred Trigger + Trigger Sync',
    changes:[
      {type:'fix', text:'Trigger no longer opens picker immediately — deferred with 600ms debounce for shortcut matching'},
      {type:'fix', text:'Typing ::firm now inserts snippet directly without popup interruption'},
      {type:'fix', text:'Trigger prefix and Inline Trigger Sequences now synchronized as single source of truth'},
      {type:'fix', text:'Changing trigger in settings auto-rewrites all snippet shortcuts'},
      {type:'fix', text:'Removed / as preset trigger option — conflicts with WhatsApp, Claude, Notion'},
      {type:'fix', text:'Migrated all /-prefixed default snippets to ;; prefix'}
    ]},
  { version:'v2.8', date:'2026-03-28', label:'Version Alignment + Trigger Picker Fix',
    changes:[
      {type:'fix', text:'Trigger picker scroll — no longer closes when scrolling inside the list'},
      {type:'fix', text:'Trigger picker click — mousedown handler prevents premature close'},
      {type:'fix', text:'Removed 8-snippet cap — all snippets now show in picker'},
      {type:'new', text:'Taller picker (320px) with overscroll-behavior:contain'},
      {type:'fix', text:'Version alignment — all files now report v2.8'}
    ]},
  { version:'v2.7', date:'2026-03-22', label:'Configurable Dual Triggers + Paste Fix',
    changes:[
      {type:'new', text:'Configurable dual trigger system — :: for snippets, """ for prompts'},
      {type:'new', text:'Inline trigger picker — type :: to browse snippets, """ for prompt templates'},
      {type:'new', text:'Trigger settings UI in popup — change trigger sequences and activation keys'},
      {type:'new', text:'Notion integration — auto-log trigger config changes to a Notion database'},
      {type:'fix', text:'Paste event handlers — clipboard input now triggers all UI updates reliably'},
      {type:'fix', text:'Overlay fill fields respond to paste events for preview updates'}
    ]
  },
  { version:'v2.6', date:'2026-03-21', label:'Urgency Timer & Scarcity',
    changes:[
      {type:'new', text:'Optional countdown timer for quote snippets (Combo Deals style)'},
      {type:'new', text:'Inventory scarcity label: "Only N unit(s) left" with pulsing indicator'},
      {type:'new', text:'Timer persists across page refreshes — no reset on reload'},
      {type:'new', text:'Timer expiration blocks quote insertion in content script'},
      {type:'new', text:'Toggle enable_urgency_timer + duration/units in snippet editor'}
    ]
  },
  { version:'v2.3', date:'2026-03-18', label:'Cloud Sync + Context Menu',
    changes:[
      {type:'new', text:'Supabase cloud sync — snippets shared across all team devices in real time'},
      {type:'new', text:'Right-click any text field on any website to insert a snippet (TextBlaze style)'},
      {type:'new', text:'Context menu groups snippets by folder with submenus'},
      {type:'new', text:'Sprint Brain rebrand — clean logo, version footer'},
      {type:'fix', text:'Full popup.js clean rewrite — no more patching bugs'}
    ]
  },
  { version:'v2.2', date:'2026-03-17', label:'Folders + Stats',
    changes:[
      {type:'new', text:'Folder sidebar — organize snippets by category'},
      {type:'new', text:'Right-click inside popup — duplicate, move, rename, delete'},
      {type:'new', text:'Usage statistics — use count, fill rate, last used'},
      {type:'new', text:'Celebration card shows usage milestones'}
    ]
  },
  { version:'v2.1', date:'2026-03-16', label:'Chrome Extension',
    changes:[
      {type:'new', text:'Chrome Extension — type ;;shortcut anywhere to auto-expand'},
      {type:'new', text:'Configurable trigger character (;;, ::, !!)'},
      {type:'fix', text:'MV3 CSP — moved all JS to external popup.js'}
    ]
  },
  { version:'v2.0', date:'2026-03-15', label:'Web App Launch',
    changes:[
      {type:'new', text:'Full snippet manager with formula engine'},
      {type:'new', text:'Conditional logic {if:A>0}...{endif}'},
      {type:'new', text:'Confetti + Human vs Machine celebration'}
    ]
  }
];

function openChangelog() {
  var body = gi('cl-scroll');
  var h = '';
  CHANGELOG.forEach(function(rel) {
    h += '<div class="cl-rel">'
      + '<div class="cl-rh">'
      + '<span class="cl-rv">'+esc(rel.version)+'</span>'
      + '<span class="cl-rl">'+esc(rel.label)+'</span>'
      + '<span class="cl-rd">'+rel.date+'</span>'
      + '</div><div class="cl-cs">';
    (rel.changes || rel.items || []).forEach(function(c) {
      h += '<div class="cl-c"><span class="cl-b '+c.type+'">'+c.type+'</span><span>'+esc(c.text)+'</span></div>';
    });
    h += '</div></div>';
  });
  body.innerHTML = h;
  var latest = CHANGELOG[0];
  var ft = gi('cl-footer');
  if (ft) ft.innerHTML = '<span>Ver. <strong>'+esc(latest.version)+'</strong></span><span>Last Update: <strong>'+esc(latest.date)+'</strong></span>';
  gi('cl-bg').className = 'cl-bg on';
}

function closeChangelog() { gi('cl-bg').className = 'cl-bg'; }

/* ── SYNC STATUS BAR ─────────────────────────────────────── */

function _timeAgo(isoString) {
  if (!isoString) return 'never';
  var diff = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diff < 60)   return diff + 's ago';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
  return Math.floor(diff / 86400) + ' days ago';
}

// Header status chip — a colored dot + text. `state==='refresh'` pulses the dot
// (syncing). The chip's visibility is owned by updateSyncStatus (hidden until
// Notion is configured). `color` accepts a hex or a CSS var() string.
function _setSyncBar(state, text, color) {
  var chip   = document.getElementById('sb-sync-now');
  var dotEl  = document.getElementById('sb-sync-icon');
  var textEl = document.getElementById('sb-sync-text');
  if (chip) chip.style.display = 'inline-flex';
  if (dotEl) {
    dotEl.style.background = color || 'var(--sb-ink-subtle)';
    if (state === 'refresh') dotEl.classList.add('pulse'); else dotEl.classList.remove('pulse');
  }
  if (textEl) textEl.textContent = text;
}

function updateSyncStatus() {
  chrome.storage.local.get(
    ['sb_notion_last_sync_ts', 'sb_notion_sync_error'],
    function(d) {
      var lastSync = d && d['sb_notion_last_sync_ts'];
      var hasError = d && d['sb_notion_sync_error'];
      var hasNotion = notionCfg && notionCfg.apiKey && notionCfg.dbId;
      var chip = gi('sb-sync-now');

      // No Notion \u2192 the status chip is not shown at all (nothing to sync).
      if (!hasNotion) { if (chip) chip.style.display = 'none'; return; }

      if (hasError) {
        _setSyncBar('warn', 'Sync failed \u2014 tap to retry', 'var(--sb-danger)');
        return;
      }

      if (!lastSync) {
        _setSyncBar('refresh', 'Never synced', 'var(--sb-azure)');
        return;
      }

      var ageMin = Math.floor((Date.now() - new Date(lastSync).getTime()) / 60000);

      if (ageMin < 15) {
        _setSyncBar('check', 'Synced ' + _timeAgo(lastSync), 'var(--sb-ok)');
      } else if (ageMin < 30) {
        _setSyncBar('refresh', 'Synced ' + _timeAgo(lastSync), 'var(--sb-azure)');
      } else {
        _setSyncBar('warn', 'Not synced \u2014 tap to sync', 'var(--sb-danger)');
      }
    }
  );
}

// ── NOTION PUSH — App → Notion (bidirectional sync, upsert) ───────
var NotionPush = {

  // Collect all language variants for a snippet's lang_group_id
  _getGroupVariants: function(snippet) {
    var gid = snippet.lang_group_id || snippet.id;
    var variants = snips.filter(function(s) {
      return (s.lang_group_id || s.id) === gid;
    });
    return variants.length ? variants : [snippet];
  },

  // Find the Notion page id already assigned to any variant in the group
  _getGroupPageId: function(variants) {
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].notion_page_id) return variants[i].notion_page_id;
    }
    return null;
  },

  // Build Notion page properties from all variants (one row, per-lang Body fields)
  _buildProps: function(variants) {
    var props = {};

    // Use EN variant as title/shortcut anchor, fall back to first
    var anchor = variants[0];
    for (var i = 0; i < variants.length; i++) {
      if (variants[i].lang === 'EN') { anchor = variants[i]; break; }
    }

    props['Nome Snippet'] = {
      title: [{ text: { content: anchor.title || '' } }]
    };
    props['Shortcut'] = {
      rich_text: [{ text: { content: anchor.shortcut || '' } }]
    };

    // Per-language body properties — one field per language variant
    var langPropMap = { 'EN': 'Body EN', 'IT': 'Body IT', 'ES': 'Body ES', 'MULTI': 'Body MULTI' };
    variants.forEach(function(v) {
      var propName = langPropMap[v.lang] || ('Body ' + v.lang);
      var bodyText = (v.body || '').slice(0, 2000);
      if ((v.body || '').length > 2000) {
        console.error('[SprintBrain] Body truncated to 2000 chars for Notion:', v.title, v.lang);
      }
      props[propName] = { rich_text: [{ text: { content: bodyText } }] };
    });

    if (anchor.folder) {
      var folderName = anchor.folder;
      for (var j = 0; j < folders.length; j++) {
        if (folders[j].id === anchor.folder) { folderName = folders[j].name; break; }
      }
      props['Categoria'] = { select: { name: folderName } };
    }

    if (anchor.versione) {
      props['Versione'] = {
        rich_text: [{ text: { content: anchor.versione || '' } }]
      };
    }

    return props;
  },

  // Unified push — creates or updates the single Notion page for a snippet group
  push: function(snippet) {
    if (!notionCfg || !notionCfg.apiKey || !notionCfg.dbId) return;
    var variants = this._getGroupVariants(snippet);
    var pageId   = this._getGroupPageId(variants);
    if (!pageId) {
      this._create(variants);
    } else {
      this._update(pageId, variants);
    }
  },

  _create: function(variants) {
    var self = this;
    fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + notionCfg.apiKey,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: notionCfg.dbId },
        properties: self._buildProps(variants)
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.id) {
        variants.forEach(function(v) {
          v.notion_page_id = data.id;
          DB.upsertSnippet(v);
        });
      } else {
        console.error('[SprintBrain] Notion create returned no id:', data);
      }
    })
    .catch(function(err) {
      console.error('[SprintBrain] Notion push failed:', err.message);
    });
  },

  _update: function(pageId, variants) {
    var self = this;
    fetch('https://api.notion.com/v1/pages/' + pageId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + notionCfg.apiKey,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ properties: self._buildProps(variants) })
    })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    })
    .catch(function(err) {
      console.error('[SprintBrain] Notion update failed:', err.message);
    });
  },

  archive: function(notionPageId) {
    if (!notionCfg || !notionCfg.apiKey) return;
    if (!notionPageId) return;

    fetch('https://api.notion.com/v1/pages/' + notionPageId, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + notionCfg.apiKey,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ archived: true })
    })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
    })
    .catch(function(err) {
      console.error('[SprintBrain] Notion archive failed:', err.message);
    });
  }

};

function applyPopupGreeting(session) {
  var greetEl = document.getElementById('pop-greet');
  var nameEl  = document.getElementById('pop-name');
  if (!greetEl || !nameEl) return;

  var h = new Date().getHours();
  greetEl.textContent = h >= 5 && h < 12 ? 'Good morning,'
                      : h >= 12 && h < 18 ? 'Good afternoon,'
                      : 'Good evening,';

  function setName(n) { if (n) nameEl.textContent = n; }

  // Instant: cached name from a previous session
  chrome.storage.local.get('sb_display_name', function(d) {
    if (d && d.sb_display_name) {
      setName(d.sb_display_name);
    } else if (session && session.email) {
      var p = session.email.split('@')[0];
      setName(p.charAt(0).toUpperCase() + p.slice(1));
    }
  });

  // Async: fetch accurate full_name from Supabase and cache it
  sbAuthHeaders(function(err, headers) {
    if (err || !headers) return;
    fetch(SB_SUPA_URL + '/auth/v1/user', { headers: headers })
      .then(function(r) { return r.json(); })
      .then(function(j) {
        var meta = j && j.user_metadata ? j.user_metadata : {};
        sbApplyCompanyFavicon(meta);
        var full = (meta.full_name || meta.name || '').trim();
        var first = full.split(/\s+/)[0];
        if (first) {
          setName(first);
          chrome.storage.local.set({ sb_display_name: first });
        }
      })
      .catch(function() {});
  });
}

// BOOT — called once on popup open
function boot() {
    refreshUI();

    // Instant hydrate from the local cache (same shape as `snips`, written by
    // syncSnippets) so the list shows immediately instead of flashing empty
    // while Supabase loads. The authoritative DB.loadAll below reconciles.
    try {
      chrome.storage.local.get('snippets', function (d) {
        if (!snips.length && d && Array.isArray(d.snippets) && d.snippets.length) {
          snips = d.snippets;
          refreshUI();
        }
      });
    } catch (e) {}

    loadTriggerCfg(function () {
          applyTriggerCfgToInputs();
          refreshUI();
          var ss = gi('tcfg-sel-suggest');
          if (ss) {
            ss.addEventListener('change', function () {
              triggerCfg.selectionSuggestions = ss.checked;
              saveTriggerCfg();
            });
          }
          // Refresh from the single source of truth (user_metadata) so the popup
          // reflects a trigger changed on the dashboard, then repaint the lists.
          if (typeof sbPullTriggerMetadata === 'function') {
            sbPullTriggerMetadata(function () { loadTriggerCfg(function () { applyTriggerCfgToInputs(); refreshUI(); }); });
          }
    });

    loadUserPrefs(function() {
      var dl = gi('cfg-default-lang');
      if (dl) dl.value = userPrefs.defaultLang;
    });

    Promise.all([DB.loadAll(), DB.loadPrompts()]).then(function(results) {
      loaded = true;
      var data    = results[0];
      var prmData = Array.isArray(results[1]) ? results[1] : [];
      prompts = prmData;
      if (data && data.snippets && data.snippets.length > 0) {
        snips   = data.snippets;
        folders = (data.folders && data.folders.length > 0) ? data.folders : DEFAULT_FOLDERS;
      } else {
        folders = DEFAULT_FOLDERS.slice();
        DEFAULT_FOLDERS.forEach(function (f) { DB.upsertFolder(f); });
      }
      syncSnippets();
      syncPrompts();
      refreshUI();
    });

    // Check if alarm fetched fresh snippets while popup was closed
    chrome.storage.local.get('sb_alarm_sync_result', function(d) {
      if (d && d.sb_alarm_sync_result && d.sb_alarm_sync_result.snippets) {
        var alarmSnippets = d.sb_alarm_sync_result.snippets;
        var alarmTs = d.sb_alarm_sync_result.timestamp;
        var age = Date.now() - new Date(alarmTs).getTime();

        if (age < 600000 && alarmSnippets.length > 0) {
          alarmSnippets.forEach(function(ns) {
            var exists = false;
            for (var i = 0; i < snips.length; i++) {
              if (snips[i].notion_page_id === ns.notion_page_id ||
                  snips[i].id === ns.id) {
                snips[i] = Object.assign({}, snips[i], ns);
                exists = true; break;
              }
            }
            if (!exists) snips.push(ns);
          });
          syncSnippets();
          refreshUI();
        }
      }
    });

    loadNotionCfg(function() {
      updateSyncStatus();

      if (!notionCfg.apiKey || !notionCfg.dbId) {
        // Config is incomplete — check Supabase (set from the dashboard) before syncing.
        syncNotionCfgFromSupabase(function() { _runNotionSync(); });
      } else {
        _runNotionSync();
      }
    });

    // Refresh status bar timestamp every 60 seconds
    setInterval(updateSyncStatus, 60000);
}

function _runNotionSync(cb, force) {
    NotionSync.run(notionCfg, {

          onProgress: function(state) {
                  if (state === 'syncing') {
                            _setSyncBar('refresh', 'Syncing with Notion\u2026', '#1B4FD8');
                  } else {
                            updateSyncStatus();
                  }
          },

          onComplete: function(notionSnippets, success) {
                  if (success) {
                            chrome.storage.local.remove('sb_notion_sync_error');
                  }

                  if (!notionSnippets || !notionSnippets.length) {
                            updateSyncStatus();
                            if (cb) cb();
                            return;
                  }

                  var changed = false;
                  notionSnippets.forEach(function(ns) {
                            var existingIdx = -1;
                            // Priority 1: exact id match (stable for multi-lang variants)
                            for (var i = 0; i < snips.length; i++) {
                                        if (snips[i].id === ns.id) { existingIdx = i; break; }
                            }
                            // Priority 2: notion_page_id + lang (handles legacy single-lang snippets)
                            if (existingIdx === -1 && ns.notion_page_id) {
                                        for (var i = 0; i < snips.length; i++) {
                                                  if (snips[i].notion_page_id === ns.notion_page_id &&
                                                      (snips[i].lang || 'EN') === (ns.lang || 'EN')) { existingIdx = i; break; }
                                        }
                            }
                            if (existingIdx > -1) {
                                        var existing = snips[existingIdx];
                                        if (!existing.manually_edited &&
                                            (existing.title !== ns.title || existing.body !== ns.body || existing.shortcut !== ns.shortcut)) {
                                                      snips[existingIdx] = Object.assign({}, existing, ns);
                                                      DB.upsertSnippet(snips[existingIdx]);
                                                      changed = true;
                                        }
                            } else {
                                        snips.push(ns);
                                        DB.upsertSnippet(ns);
                                        DB.updateStats(ns.id, 0, 0, null);
                                        changed = true;
                            }
                  });
                  // Persist Notion snippets to Supabase so they survive popup reload when debounce blocks
                  // re-sync — but skip any snippet the user has manually edited to avoid overwriting edits.
                  notionSnippets.forEach(function(ns) {
                    var local = null;
                    for (var j = 0; j < snips.length; j++) {
                      if (snips[j].id === ns.id) { local = snips[j]; break; }
                    }
                    if (!local && ns.notion_page_id) {
                      for (var j = 0; j < snips.length; j++) {
                        if (snips[j].notion_page_id === ns.notion_page_id &&
                            (snips[j].lang || 'EN') === (ns.lang || 'EN')) { local = snips[j]; break; }
                      }
                    }
                    if (!local || !local.manually_edited) DB.upsertSnippet(ns);
                  });

                  // Deletion detection: remove snippets that came from Notion
                  // but are no longer in the Notion response (deleted in Notion)
                  if (success && notionSnippets.length > 0) {
                    var notionIds = {};
                    notionSnippets.forEach(function(ns) {
                      if (ns.notion_page_id) notionIds[ns.notion_page_id] = true;
                    });

                    var toDelete = [];
                    snips.forEach(function(s) {
                      if (s.notion_page_id && !notionIds[s.notion_page_id]) {
                        toDelete.push(s.id);
                      }
                    });

                    if (toDelete.length > 0) {
                      toDelete.forEach(function(id) {
                        snips = SBPopupSync.removeSnippetFromList(snips, id);
                      });
                      syncSnippets();
                      toDelete.forEach(function(id) { DB.deleteSnippet(id); });
                      changed = true;
                    }
                  }

                  if (changed) {
                            syncSnippets();
                            showToast('Notion synced \u2014 ' + notionSnippets.length + ' snippet(s) updated');
                  }
                  // Always refresh the sidebar and snippet list after sync so
                  // imported snippets are visible even when no diff was detected.
                  refreshUI();
                  updateSyncStatus();
                  if (cb) cb();
          },

          onError: function(err) {
                  console.error('[SprintBrain] Notion sync failed:', err.message);

                  chrome.storage.local.set({
                            sb_notion_sync_error: {
                                        message: err.message,
                                        timestamp: new Date().toISOString()
                            }
                  });

                  updateSyncStatus();
                  if (cb) cb();
          }

    }, force || false);
}

// UI REFRESH
function groupCount(arr){ var seen={}; var n=0; for(var i=0;i<arr.length;i++){ var gid=arr[i].lang_group_id||arr[i].id; if(!seen[gid]){ seen[gid]=1; n++; } } return n; }
function refreshUI(){
  var tp=gi('tp'); if(tp && activeMode!=='prompts') tp.innerHTML='<span class="isc-pfx">'+esc(trig)+'</span>quoteEN';
  var gc=groupCount(snips);
  var mcs=gi('mct-snip'); if(mcs) mcs.textContent=gc;
  var mcp=gi('mct-prmpt'); if(mcp) mcp.textContent=prompts.length;
  renderFolders();
  if(activeMode==='prompts') renderPrompts(gi('sq')?gi('sq').value:'');
  else renderList(gi('sq')?gi('sq').value:'');
}

// FOLDERS
function folderCount(fid){ var seen={}; var n=0; for(var i=0;i<snips.length;i++){ if((snips[i].folder||'')!==fid) continue; var gid=snips[i].lang_group_id||snips[i].id; if(!seen[gid]){ seen[gid]=1; n++; } } return n; }

function findFolder(id){ for(var i=0;i<folders.length;i++){ if(folders[i].id===id) return folders[i]; } return null; }
function findPrompt(id){ for(var i=0;i<prompts.length;i++){ if(prompts[i].id===id) return prompts[i]; } return null; }

/* SVG icon map for folder icons — keyed by data-ico values */
var _FOLDER_SVGS = {
  folder: '<svg viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  cpu: '<svg viewBox="0 0 24 24"><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2"/><path d="M15 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M9 2v2"/><path d="M9 20v2"/></svg>',
  star: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  key: '<svg viewBox="0 0 24 24"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/></svg>',
  dollar: '<svg viewBox="0 0 24 24"><line x1="12" x2="12" y1="2" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  'file-text': '<svg viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>'
};
function _folderSvg(ico){ return _FOLDER_SVGS[ico] || _FOLDER_SVGS.folder; }

function renderFolders(){
  var el=gi('folder-list'); if(!el) return;
  var allIco='<svg viewBox="0 0 24 24"><path d="M20 17a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3.9a2 2 0 0 1-1.69-.9l-.81-1.2a2 2 0 0 0-1.67-.9H8a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2Z"/><path d="M2 8v11a2 2 0 0 0 2 2h14"/></svg>';
  var h='<button class="chip'+(selFolder==='ALL'?' on':'')+'" data-fid="ALL" type="button">'
      +'<span class="chip-ic">'+allIco+'</span>All<span class="chip-c">'+groupCount(snips)+'</span></button>';
  for(var i=0;i<folders.length;i++){
    var f=folders[i];
    h+='<button class="chip'+(selFolder===f.id?' on':'')+'" data-fid="'+esc(f.id)+'" type="button">'
      +'<span class="chip-ic">'+_folderSvg(f.ico||'folder')+'</span>'
      +esc(f.name)
      +'<span class="chip-c">'+folderCount(f.id)+'</span>'
      +'</button>';
  }
  el.innerHTML=h;
  el.querySelectorAll('.chip').forEach(function(c){
    c.addEventListener('click',function(){
      selFolder=c.dataset.fid; searchAllFolders=false; expandedId=null; selIdx=-1;
      renderFolders();
      renderList(gi('sq')?gi('sq').value:'');
      try{ c.scrollIntoView({inline:'center',block:'nearest'}); }catch(e){}
    });
  });
  updateChipNav();
}

// Show/hide the folder-chip scroll arrows based on how far the row is scrolled.
function updateChipNav(){
  var list=gi('folder-list'), L=gi('chip-nav-left'), R=gi('chip-nav-right');
  if(!list||!L||!R) return;
  var max=list.scrollWidth-list.clientWidth-1;
  L.classList.toggle('show', list.scrollLeft>2);
  R.classList.toggle('show', max>2 && list.scrollLeft<max);
}
// Wire the arrows once + let the mouse wheel scroll the chips horizontally
// (a plain wheel only scrolls vertically otherwise, leaving hidden chips
// unreachable with a mouse). Popup-only — guarded by #folder-list's presence.
(function initChipNav(){
  var list=gi('folder-list'); if(!list) return;
  var L=gi('chip-nav-left'), R=gi('chip-nav-right');
  if(L) L.addEventListener('click', function(){ list.scrollBy({left:-150, behavior:'smooth'}); });
  if(R) R.addEventListener('click', function(){ list.scrollBy({left:150, behavior:'smooth'}); });
  list.addEventListener('scroll', updateChipNav);
  list.addEventListener('wheel', function(e){
    if(Math.abs(e.deltaY) > Math.abs(e.deltaX)){ list.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive:false });
})();

// SNIPPET LIST
function findSnip(id){ for(var i=0;i<snips.length;i++){ if(snips[i].id===id) return snips[i]; } return null; }

function shortWord(sc){ return String(sc||'').replace(/^[^a-zA-Z0-9]+/,''); }
function matchSnip(s,q){ q=q.toLowerCase(); return String(s.title||'').toLowerCase().indexOf(q)>-1||String(s.shortcut||'').toLowerCase().indexOf(q)>-1; }

// Escape a body for display, then wrap {field}/{=formula}/{if:\u2026} tokens so the
// template's dynamic parts read at a glance in the detail preview.
function highlightVars(body){
  return esc(body).replace(/\{[^{}]*\}/g, function(m){ return '<span class="var">'+m+'</span>'; });
}

// Ordered languages available for a snippet group (sibling rows + single-row
// bodies map), EN/ES/IT/FR first, then anything else findVariants surfaces.
function detailLangOrder(vars){
  var order=[]; LANGS.forEach(function(l){ if(vars[l]) order.push(l); });
  Object.keys(vars).forEach(function(l){ if(order.indexOf(l)<0) order.push(l); });
  return order;
}

function renderSkeleton(el){
  var h='';
  for(var i=0;i<6;i++){
    h+='<div class="sk-row"><div class="sk-main"><span class="sk" style="width:'+(46+i*4)+'%;height:13px"></span>'
      +'<span class="sk" style="width:'+(26+i*2)+'%;height:10px"></span></div>'
      +'<span class="sk" style="width:78px;height:22px;border-radius:9999px"></span></div>';
  }
  el.innerHTML=h;
}

// Resolve a language's body with the single-row bodies map taking priority over
// the raw row (whose `.body` is empty when content lives in `bodies`), then any
// sibling-row variant, then the primary row's own body. Mirrors the dashboard
// editor (Sprintbrain.html openEditor), which reads bodies[lang] first.
function detailBody(s, lang, vars){
  var bm = (s.bodies && typeof s.bodies==='object') ? s.bodies[lang] : null;
  if(typeof bm==='string' && bm.trim()) return bm;
  if(vars[lang] && typeof vars[lang].body==='string' && vars[lang].body.trim()) return vars[lang].body;
  return (lang===(s.lang||'EN')) ? (s.body||'') : '';
}

// \u2500\u2500 FILL-AND-COPY (read-only resolve; never mutates the snippet) \u2500\u2500\u2500\u2500\u2500
// Field detection mirrors the dashboard Composer: {formtext/date/menu:}
// configs, then {{placeholders}}, then bare {fields}.
function detailFieldDefs(body){
  var FE=window.SBFormulaEngine; if(!FE||!body) return {};
  var defs={};
  try{
    var dyn=FE.buildFormFieldCfg(body); for(var k in dyn) defs[k]=dyn[k];
    var ph=FE.parsePlaceholders(body); for(var i=0;i<ph.length;i++){ if(!defs[ph[i]]) defs[ph[i]]={type:'text',default:''}; }
    var sf=FE.extractFields(body); for(var j=0;j<sf.length;j++){ if(!defs[sf[j]]) defs[sf[j]]={type:'text',default:''}; }
  }catch(e){}
  return defs;
}
// Values for a body's fields \u2014 user entry wins, else the field default.
function currentFieldVals(defs){
  var vals={}; Object.keys(defs).forEach(function(k){ vals[k]=(detailFieldVals[k]!==undefined)?detailFieldVals[k]:(defs[k].default||''); });
  return vals;
}
// Resolve a body with field values through the SAME engine as the in-page
// ::trigger expansion (formula-engine.js). Falls back to raw if absent.
function resolveFilled(body, vals, lang){
  var FE=window.SBFormulaEngine; if(!FE) return body;
  try{ return FE.resolveBody(FE.interpolateSnippet(body, vals), vals, {lang:lang}); }catch(e){ return body; }
}
// Language of the body currently shown in the detail — the active pill when the
// snippet has variants, otherwise the snippet's own.
function detailActiveLang(s){
  var vars=findVariants(s);
  return (detailLang && vars[detailLang]) ? detailLang : (s.lang||'EN');
}
function detailActiveBody(s){
  return detailBody(s, detailActiveLang(s), findVariants(s));
}
// Live-update the open detail's preview from the current field inputs.
function updateDetailPreview(id){
  var s=findSnip(id); if(!s) return;
  var body=detailActiveBody(s);
  var out=resolveFilled(body, currentFieldVals(detailFieldDefs(body)), detailActiveLang(s));
  var wrap=document.querySelector('.detail[data-detail="'+id+'"]');
  var pv=wrap?wrap.querySelector('.d-body'):null;
  if(pv){ pv.textContent=out; if(out.trim()) pv.classList.remove('plain'); else pv.classList.add('plain'); }
}
function copyFilled(id){
  var s=findSnip(id); if(!s) return;
  var body=detailActiveBody(s);
  var out=resolveFilled(body, currentFieldVals(detailFieldDefs(body)), detailActiveLang(s));
  try{ navigator.clipboard.writeText(out||''); }catch(e){}
  showToast('Copied filled text');
}
// Enter inside an open detail copies the primary action (filled when the body
// is dynamic, otherwise the raw body).
function copyDetailPrimary(id){
  var s=findSnip(id); if(!s) return;
  var body=detailActiveBody(s);
  var vals=currentFieldVals(detailFieldDefs(body));
  if(resolveFilled(body, vals, detailActiveLang(s))!==body) copyFilled(id); else copyBody(id);
}

function renderDetailHtml(s){
  var vars=findVariants(s);
  var order=detailLangOrder(vars);
  if(!order.length) order=[s.lang||'EN'];
  var active=(detailLang && vars[detailLang]) ? detailLang : (vars[s.lang] ? s.lang : order[0]);
  detailLang=active;
  var body=detailBody(s, active, vars);
  var pills=order.map(function(l){
    return '<button class="d-lp '+esc(l)+(l===active?' on':'')+'" type="button" data-dlang="'+esc(l)+'" data-did="'+esc(s.id)+'">'+esc(l)+'</button>';
  }).join('');

  var editBtn='<button class="d-edit" type="button" data-editdash="1">Edit in dashboard<svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>';
  var scBtn='<button class="d-btn ghost" type="button" data-copysc="'+esc(s.id)+'">Copy shortcut</button>';
  var copyIco='<svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

  var defs=detailFieldDefs(body);
  var fieldKeys=Object.keys(defs);
  var hasFields=fieldKeys.length>0;
  var vals=currentFieldVals(defs);
  var resolved=resolveFilled(body, vals, active);
  var isDynamic=hasFields || (resolved!==body);

  var h='<div class="detail" data-detail="'+esc(s.id)+'">'
    +(order.length>1?'<div class="d-langs">'+pills+'</div>':'');

  if(isDynamic){
    if(hasFields){
      var form='<div class="d-fields" data-fid="'+esc(s.id)+'">';
      fieldKeys.forEach(function(k){
        var def=defs[k], label=k.replace(/_/g,' '), val=(vals[k]!=null?vals[k]:''), inp;
        if(def.type==='dd'){
          var opts=(def.opts||'').split('\n').filter(Boolean);
          inp='<select data-fkey="'+esc(k)+'">'+opts.map(function(o){ return '<option value="'+esc(o)+'"'+(o===val?' selected':'')+'>'+esc(o)+'</option>'; }).join('')+'</select>';
        } else if(def.type==='date'){
          inp='<input type="date" data-fkey="'+esc(k)+'" value="'+esc(val)+'">';
        } else {
          inp='<input type="text" data-fkey="'+esc(k)+'" placeholder="'+esc(label)+'" value="'+esc(val)+'">';
        }
        form+='<div class="d-frow"><label>'+esc(label)+'</label>'+inp+'</div>';
      });
      form+='</div>';
      h+=form;
    }
    var pvCls='d-body'+(resolved.trim()?'':' plain');
    var note=hasFields
      ? 'Fill the fields, then <b>Copy filled</b> \u2014 same result as expanding <b>'+esc(trig)+esc(shortWord(s.shortcut))+'</b> in a page.'
      : '<b>Copy filled</b> resolves dates &amp; formulas \u2014 same result as expanding <b>'+esc(trig)+esc(shortWord(s.shortcut))+'</b> in a page.';
    h+='<div class="'+pvCls+'">'+esc(resolved)+'</div>'
      +'<div class="d-note">'+note+'</div>'
      +'<div class="d-acts">'
        +'<button class="d-btn pri" type="button" data-copyfilled="'+esc(s.id)+'">'+copyIco+'Copy filled</button>'
        +'<button class="d-btn ghost" type="button" data-copybody="'+esc(s.id)+'">Copy raw</button>'
        +scBtn+editBtn
      +'</div>';
  } else {
    var bodyHtml = body.trim() ? highlightVars(body) : 'This language has no body yet.';
    var bodyCls  = body.trim() ? 'd-body' : 'd-body plain';
    h+='<div class="'+bodyCls+'">'+bodyHtml+'</div>'
      +'<div class="d-acts">'
        +'<button class="d-btn pri" type="button" data-copybody="'+esc(s.id)+'">'+copyIco+'Copy body</button>'
        +scBtn+editBtn
      +'</div>';
  }
  return h+'</div>';
}

function renderList(q){
  var el=gi('list'); if(!el) return;
  selIdx=-1;
  // Cold start: show skeleton rows instead of a false "empty" until the
  // authoritative load resolves (or the local cache hydrates `snips`).
  if(!loaded && !snips.length){ el.setAttribute('aria-busy','true'); renderSkeleton(el); return; }
  el.setAttribute('aria-busy','false');

  var effFolder=(searchAllFolders && q) ? 'ALL' : selFolder;
  var filtered=snips.filter(function(s){
    var mf=effFolder==='ALL'||(s.folder||'')===effFolder;
    return mf && (!q||matchSnip(s,q));
  });

  if(!filtered.length){
    // Folder-scoped miss that would hit in another folder \u2192 offer "search all".
    if(loaded && q && !searchAllFolders && selFolder!=='ALL'){
      var other=snips.filter(function(s){ return matchSnip(s,q); });
      if(other.length){
        el.innerHTML='<div class="empty">No matches in this folder.<br>'
          +'<button class="searchall" id="btn-searchall" type="button">'+other.length+' in other folders \u2014 search all</button></div>';
        var b=gi('btn-searchall'); if(b) b.addEventListener('click',function(){ searchAllFolders=true; renderList(gi('sq')?gi('sq').value:''); });
        return;
      }
    }
    el.innerHTML='<div class="empty">'+(q?'No matches for &ldquo;'+esc(q)+'&rdquo;.':'No snippets yet.<br><small>Create snippets in the dashboard.</small>')+'</div>';
    return;
  }

  filtered.sort(function(a,b){ return (b.pinned?1:0)-(a.pinned?1:0); });
  var groups=groupSnips(filtered);
  var h='';
  groups.forEach(function(g){
    var s=g.master;
    var langs=Object.keys(findVariants(s));
    var lb=langs.length>1 ? 'MULTI' : (s.lang||'EN');
    var st=s.stats||{uses:0};
    var usesTxt=st.uses ? ('\u00D7'+st.uses) : 'Never used';
    var base=String(s.title||'').replace(/\s*(EN|ES|IT|FR)$/,'');
    var open=expandedId===s.id;
    h+='<div class="item'+(open?' open':'')+'" data-id="'+esc(s.id)+'" tabindex="-1" role="button" aria-expanded="'+(open?'true':'false')+'" aria-label="'+esc(base)+' \u2014 show details">'
      +'<div class="i-main">'
        +'<div class="i-r1"><span class="iname">'+esc(base)+'</span>'
          +'<span class="isc"><span class="isc-pfx">'+esc(trig)+'</span>'+esc(shortWord(s.shortcut))+'</span></div>'
        +'<div class="i-r2"><span class="lb '+esc(lb)+'">'+esc(lb)+'</span><span class="i-uses">'+esc(usesTxt)+'</span></div>'
      +'</div>'
      +'<button class="chev" type="button" data-chev="'+esc(s.id)+'" title="Details" aria-label="Show languages and body" aria-expanded="'+(open?'true':'false')+'"><svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg></button>'
    +'</div>';
    if(open) h+=renderDetailHtml(s);
  });
  el.innerHTML=h;

  // Entrance stagger runs once, on the first data render.
  if(!listAnimated){ el.classList.add('anim'); listAnimated=true; setTimeout(function(){ el.classList.remove('anim'); },400); }
  else el.classList.remove('anim');

  wireListRows(el);
}

function wireListRows(el){
  el.querySelectorAll('.item').forEach(function(row){
    row.addEventListener('click',function(){ toggleDetail(row.dataset.id); });
  });
  el.querySelectorAll('[data-dlang]').forEach(function(p){
    p.addEventListener('click',function(e){ e.stopPropagation(); detailLang=p.dataset.dlang; renderList(gi('sq')?gi('sq').value:''); reSel(p.dataset.did); });
  });
  el.querySelectorAll('[data-copybody]').forEach(function(btn){
    btn.addEventListener('click',function(e){ e.stopPropagation(); copyBody(btn.dataset.copybody); });
  });
  el.querySelectorAll('[data-copyfilled]').forEach(function(btn){
    btn.addEventListener('click',function(e){ e.stopPropagation(); copyFilled(btn.dataset.copyfilled); });
  });
  el.querySelectorAll('[data-copysc]').forEach(function(btn){
    btn.addEventListener('click',function(e){ e.stopPropagation(); var s=findSnip(btn.dataset.copysc); if(s) doCopyShortcut(s); });
  });
  el.querySelectorAll('[data-editdash]').forEach(function(btn){
    btn.addEventListener('click',function(e){ e.stopPropagation(); openDashboard(); });
  });
  // Fill-form inputs: live-resolve the preview in place (no re-render → focus kept).
  el.querySelectorAll('.d-fields [data-fkey]').forEach(function(inp){
    var box=inp.closest('.d-fields'); var did=box?box.getAttribute('data-fid'):null;
    var handler=function(){ detailFieldVals[inp.getAttribute('data-fkey')]=inp.value; if(did) updateDetailPreview(did); };
    inp.addEventListener('input',handler); inp.addEventListener('change',handler);
  });
}

function toggleDetail(id){
  // Opening a (different) snippet starts with a fresh fill form; language
  // switches keep the entered values (handled in the data-dlang wiring).
  if(expandedId===id){ expandedId=null; detailFieldVals={}; }
  else { expandedId=id; detailLang=null; detailFieldVals={}; }
  renderList(gi('sq')?gi('sq').value:'');
  reSel(id);
}

// Shortcut copy \u2014 fired from the detail panel's "Copy shortcut" on both
// surfaces; copies the raw stored shortcut and bumps usage stats.
function doCopyShortcut(s){
  try{ navigator.clipboard.writeText(s.shortcut||''); }catch(e){}
  if(!s.stats) s.stats={uses:0,fills:0,lastUsed:null};
  s.stats.uses=(s.stats.uses||0)+1;
  s.stats.lastUsed=new Date().toISOString();
  DB.updateStats(s.id,s.stats.uses,s.stats.fills,s.stats.lastUsed);
  flashChip(s.id);
  showToast('Copied '+trig+shortWord(s.shortcut));
}

// Per-language body copy \u2014 copies the RAW template (placeholders intact). Does
// not bump stats (matches the dashboard's "Copy content").
function copyBody(id){
  var s=findSnip(id); if(!s) return;
  var vars=findVariants(s);
  var lang=(detailLang && vars[detailLang]) ? detailLang : (s.lang||'EN');
  var body=detailBody(s, lang, vars);
  try{ navigator.clipboard.writeText(body||''); }catch(e){}
  showToast('Copied '+lang+' body');
}

function flashChip(id){
  var row=document.querySelector('.item[data-id="'+id+'"]');
  if(!row) return;
  var chip=row.querySelector('.isc'); if(!chip) return;
  var orig=chip.innerHTML;
  chip.classList.add('ok'); chip.textContent='\u2713 copied';
  setTimeout(function(){ if(chip){ chip.classList.remove('ok'); chip.innerHTML=orig; } },1500);
}

// ── PROMPT LIST RENDER ─────────────────────────────────────────────
function renderPrompts(q) {
  var el = gi('plist'); if (!el) return;
  var ct = gi('mct-prmpt');
  var filtered = prompts;
  if (q) {
    var lq = q.toLowerCase().replace(/^"+/,'').trim();
    filtered = prompts.filter(function(p) {
      return (p.name||'').toLowerCase().indexOf(lq) !== -1 ||
             (p.intent_category||'').toLowerCase().indexOf(lq) !== -1 ||
             (p.tags||[]).some(function(t){ return (t||'').toLowerCase().indexOf(lq) !== -1; });
    });
  }
  if (ct) ct.textContent = prompts.length;
  if (!filtered.length) {
    el.innerHTML = '<div class="p-empty">'+(q?'No prompts match &ldquo;'+esc(q)+'&rdquo;':'No prompts yet.<br>Create and edit prompts in the <strong>dashboard</strong>.')+'</div>';
    return;
  }
  var pt = triggerCfg.promptTrigger || '"""';
  var h = '';
  filtered.forEach(function(p) {
    var type = (p.type || 'one-shot').replace(/_/g,'-');
    var badgeLbl = type === 'few-shot' ? 'Few-shot' : 'One-shot';
    var scHtml = p.shortcut
      ? '<span class="p-sc"><span class="isc-pfx">'+esc(pt)+'</span>'+esc(shortWord(p.shortcut))+'</span>'
      : '';
    var tags = (p.tags||[]).slice(0,3).map(function(t){
      return '<span class="p-tagpill">'+esc(t)+'</span>';
    }).join('');
    h += '<div class="p-item" data-pid="'+esc(p.id)+'" tabindex="-1" role="button" aria-label="'+esc(p.name||'Untitled')+' — copy prompt">'
      + '<div class="p-body">'
      + '<div class="p-name" id="pname-'+esc(p.id)+'">'+esc(p.name||'Untitled')+'</div>'
      + '<div class="p-meta"><span class="p-badge '+esc(type)+'">'+esc(badgeLbl)+'</span>'+scHtml+tags+'</div>'
      + '</div>'
      + '<button class="p-copy" type="button" title="Copy prompt" aria-label="Copy prompt"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>'
      + '</div>';
  });
  el.innerHTML = h;
  el.querySelectorAll('.p-item').forEach(function(row) {
    row.addEventListener('click', function() { copyPrompt(row.dataset.pid); });
  });
}

function copyPrompt(pid){
  var p = findPrompt(pid); if (!p) return;
  try { navigator.clipboard.writeText(p.content||''); } catch(_) {}
  var nm = gi('pname-'+pid);
  var orig = nm ? nm.textContent : '';
  if (nm) nm.textContent = '✓ Copied!';
  setTimeout(function() { if (nm) nm.textContent = orig; }, 1500);
  showToast('Prompt copied');
}

// ── MODE SWITCHER ──────────────────────────────────────────────────
function setMode(m) {
  activeMode = m;
  var srow       = document.querySelector('.srow');
  var snipChips  = gi('snip-chips');
  var snipMain   = gi('snip-main');
  var pMain      = gi('prompt-main');
  var seg        = gi('mode-seg');
  var sq         = gi('sq');
  var tp         = gi('tp');
  var ptTrig     = triggerCfg.promptTrigger || '"""';

  expandedId = null; selIdx = -1; pSelIdx = -1;

  document.querySelectorAll('.mode-tab').forEach(function(t) {
    var on = t.dataset.mode === m;
    t.className = 'mode-tab' + (on ? ' on' : '');
    t.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  if (seg) { if (m === 'prompts') seg.classList.add('on-prompts'); else seg.classList.remove('on-prompts'); }

  if (m === 'prompts') {
    if (srow) srow.classList.add('pmode');
    if (snipChips) snipChips.style.display = 'none';
    if (snipMain) snipMain.style.display = 'none';
    if (pMain) pMain.className = 'p-main on';
    if (sq) sq.placeholder = 'Search prompts…';
    if (tp) tp.innerHTML = '<span class="isc-pfx">'+esc(ptTrig)+'</span>name';
    renderPrompts(sq ? sq.value : '');
  } else {
    if (srow) srow.classList.remove('pmode');
    if (snipChips) snipChips.style.display = '';
    if (snipMain) snipMain.style.display = '';
    if (pMain) pMain.className = 'p-main';
    if (sq) sq.placeholder = 'Search snippets…';
    if (tp) tp.innerHTML = '<span class="isc-pfx">'+esc(trig)+'</span>quoteEN';
    renderList(sq ? sq.value : '');
  }
}

// SETTINGS — read-only trigger info + extension-local preferences. All
// management (snippets, folders, triggers, Notion, team sync) lives in the
// dashboard; the pane only mirrors state and hosts the two local prefs.
function openCfg(){
  applyTriggerCfgToInputs();
  show('pane-cfg');
}

// Dashboard link — opens the SprintBrain web app in a browser tab.
// Reuses an already-open dashboard tab (focuses it) instead of stacking duplicates,
// mirroring the context-menu behaviour in background.js.
var SB_DASHBOARD_HOME_URL = 'https://app.sprintbrain.com/';
function openDashboard(){
  try {
    chrome.tabs.query({ url: SB_DASHBOARD_HOME_URL + '*' }, function(tabs){
      if (tabs && tabs.length) {
        chrome.tabs.update(tabs[0].id, { active: true });
        if (tabs[0].windowId != null) chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: SB_DASHBOARD_HOME_URL });
      }
    });
  } catch(e) {
    try { chrome.tabs.create({ url: SB_DASHBOARD_HOME_URL }); } catch(e2) { window.open(SB_DASHBOARD_HOME_URL, '_blank'); }
  }
}

// WIRE EVENTS
function on(id,ev,fn){ var e=gi(id); if(e) e.addEventListener(ev,fn); }
on('bcfg','click',    openCfg);
on('bdash','click',   openDashboard);
on('bmanage','click', openDashboard);
on('bbcfg','click',   function(){ show('pane-list'); refreshUI(); });
on('brel','click', function(){
  Promise.all([DB.loadAll(), DB.loadPrompts()]).then(function(results){
    loaded=true;
    var data=results[0]; var prmData=Array.isArray(results[1])?results[1]:[];
    prompts=prmData;
    if(data&&data.snippets&&data.snippets.length>0){ snips=data.snippets; if(data.folders&&data.folders.length>0) folders=data.folders; }
    syncSnippets();
    syncPrompts();
    refreshUI();
  });
});
on('sq','input', function(e){
  expandedId=null;
  if(!e.target.value) searchAllFolders=false;
  if(activeMode==='prompts'){ pSelIdx=-1; renderPrompts(e.target.value); }
  else { selIdx=-1; renderList(e.target.value); }
});
on('cfg-default-lang','change', function(e){ userPrefs.defaultLang = e.target.value; saveUserPrefs(); });

// Mode tabs
document.querySelectorAll('.mode-tab').forEach(function(tab){
  tab.addEventListener('click', function(){ setMode(tab.dataset.mode); });
});

// ── KEYBOARD NAVIGATION (popup only; guarded by #pane-list so the shared core
//    in Sprintbrain.html — which has no #pane-list — is never affected) ──────
function listRows(){ var el=gi('list'); return el?Array.prototype.slice.call(el.querySelectorAll('.item')):[]; }
function setSel(i){
  var rows=listRows(); if(!rows.length){ selIdx=-1; return; }
  if(i<0)i=0; if(i>=rows.length)i=rows.length-1; selIdx=i;
  rows.forEach(function(r,idx){ if(idx===selIdx) r.classList.add('sel'); else r.classList.remove('sel'); });
  try{ rows[selIdx].scrollIntoView({block:'nearest'}); }catch(e){}
}
function reSel(id){ var rows=listRows(); for(var i=0;i<rows.length;i++){ if(rows[i].dataset.id===id){ setSel(i); return; } } }
function pRows(){ var el=gi('plist'); return el?Array.prototype.slice.call(el.querySelectorAll('.p-item')):[]; }
function setPSel(i){
  var rows=pRows(); if(!rows.length){ pSelIdx=-1; return; }
  if(i<0)i=0; if(i>=rows.length)i=rows.length-1; pSelIdx=i;
  rows.forEach(function(r,idx){ if(idx===pSelIdx) r.classList.add('sel'); else r.classList.remove('sel'); });
  try{ rows[pSelIdx].scrollIntoView({block:'nearest'}); }catch(e){}
}
document.addEventListener('keydown', function(e){
  var pane=gi('pane-list'); if(!pane || pane.className.indexOf('on')<0) return;
  var gate=gi('sb-auth'); if(gate && gate.classList.contains('on')) return;
  var cl=gi('cl-bg'); if(cl && cl.classList.contains('on')){ if(e.key==='Escape') closeChangelog(); return; }
  var sq=gi('sq'); var k=e.key;

  // Editing a fill-form field → leave every key to the input (no list nav).
  var ae=document.activeElement;
  if(ae && ae.closest && ae.closest('.d-fields')) return;

  if(k==='/' && document.activeElement!==sq){ if(sq){ e.preventDefault(); sq.focus(); } return; }

  if(activeMode==='prompts'){
    if(k==='ArrowDown'){ e.preventDefault(); setPSel(pSelIdx+1); }
    else if(k==='ArrowUp'){ e.preventDefault(); setPSel(pSelIdx-1); }
    else if(k==='Enter'){ if(pSelIdx<0 && pRows().length) setPSel(0); var pr=pRows()[pSelIdx]; if(pr){ e.preventDefault(); copyPrompt(pr.dataset.pid); } }
    else if(k==='Escape' && sq && sq.value){ e.preventDefault(); sq.value=''; pSelIdx=-1; renderPrompts(''); }
    return;
  }

  var atEnd  = sq ? (sq.selectionStart===sq.value.length && sq.selectionEnd===sq.value.length) : true;
  var atStart= sq ? (sq.selectionStart===0 && sq.selectionEnd===0) : true;
  if(k==='ArrowDown'){ e.preventDefault(); setSel(selIdx+1); }
  else if(k==='ArrowUp'){ e.preventDefault(); setSel(selIdx-1); }
  else if(k==='Enter'){
    if(selIdx<0 && listRows().length) setSel(0);
    var row=listRows()[selIdx];
    if(row){ e.preventDefault(); if(expandedId===row.dataset.id) copyDetailPrimary(row.dataset.id); else toggleDetail(row.dataset.id); }
  }
  else if(k==='ArrowRight' && selIdx>=0 && atEnd){
    var rr=listRows()[selIdx]; if(rr && expandedId!==rr.dataset.id){ e.preventDefault(); toggleDetail(rr.dataset.id); }
  }
  else if(k==='ArrowLeft' && expandedId && atStart){ e.preventDefault(); toggleDetail(expandedId); }
  else if(k==='Escape'){
    if(expandedId){ e.preventDefault(); toggleDetail(expandedId); }
    else if(sq && sq.value){ e.preventDefault(); sq.value=''; searchAllFolders=false; selIdx=-1; renderList(''); }
  }
});

// Changelog events — version bar AND changelog modal are rendered AFTER this <script>
// tag in popup.html, so we wait for DOM ready before binding (otherwise gi() returns null).
document.addEventListener('DOMContentLoaded', function() {
  var v = document.getElementById('ver-btn');
  if (v) {
    v.textContent = 'v' + chrome.runtime.getManifest().version;
    v.addEventListener('click', openChangelog);
  }
  var clx = document.getElementById('cl-x');
  if (clx) clx.addEventListener('click', closeChangelog);
  var clbg = document.getElementById('cl-bg');
  if (clbg) clbg.addEventListener('click', function(e){ if(e.target===clbg) closeChangelog(); });
});


// GROUPING for extension list
function groupSnips(arr) {
  var groups = []; var seen = {};
  arr.forEach(function(s) {
    var gid = s.lang_group_id || s.id;
    if (!seen[gid]) { seen[gid] = {master:s, variants:{}}; groups.push(seen[gid]); }
    seen[gid].variants[s.lang] = s;
  });
  return groups;
}

// LANGUAGE VARIANT SYSTEM v2.4
var LANGS = ['EN','ES','IT','FR'];

// Languages embedded in a single row's `bodies` map (dashboard model). Returns
// lang -> a synthetic variant view backed by the same row, with `body` set to
// the per-language content so the editor tabs, language picker and expansion
// can treat it like a standalone variant. Empty strings are ignored.
function bodyVariants(snip){
  var out = {};
  var b = snip && snip.bodies;
  if(!b || typeof b !== 'object') return out;
  LANGS.forEach(function(l){
    var txt = b[l];
    if(typeof txt !== 'string' || !txt.trim()) return;
    var view = {}; for(var k in snip) view[k] = snip[k];
    view.lang = l; view.body = txt;
    out[l] = view;
  });
  return out;
}

// Non-empty languages a single row carries in its `bodies` map.
function bodyLangs(snip){
  var b = snip && snip.bodies;
  if(!b || typeof b !== 'object') return [];
  return LANGS.filter(function(l){ return typeof b[l] === 'string' && b[l].trim(); });
}

function findVariants(snip){
  if(!snip) return {};
  var gid = snip.lang_group_id || snip.id;
  var v = {};
  snips.forEach(function(s){ if((s.lang_group_id||s.id)===gid) v[s.lang]=s; });
  // Dashboard single-row model: surface languages embedded in the bodies map.
  // Real sibling rows (legacy lang_group_id model) take precedence when both exist.
  var emb = bodyVariants(snip);
  Object.keys(emb).forEach(function(l){ if(!v[l]) v[l] = emb[l]; });
  return v;
}

function showToast(msg){
  var t=gi('toast');
  if(!t){
    t=document.createElement('div'); t.id='toast';
    t.setAttribute('role','status'); t.setAttribute('aria-live','polite');
    t.style.cssText='position:fixed;bottom:68px;left:50%;transform:translateX(-50%);background:var(--sb-toast-bg);color:#fff;padding:8px 16px;border-radius:9999px;font-size:12px;font-weight:600;z-index:9999;opacity:0;transition:opacity var(--sb-dur-slow);box-shadow:var(--sb-shadow-lg);pointer-events:none;white-space:nowrap';
    document.body.appendChild(t);
  }
  t.textContent=msg; t.style.opacity='1';
  clearTimeout(t._to); t._to=setTimeout(function(){ t.style.opacity='0'; },1800);
}

// Paste handler for the search input — route by active mode.
on('sq','paste', function(){ setTimeout(function(){
  var v=gi('sq')?gi('sq').value:'';
  expandedId=null; if(!v) searchAllFolders=false;
  if(activeMode==='prompts') renderPrompts(v); else renderList(v);
},0); });

// ── SYNC NOW BUTTON ──────────────────────────────────────
var syncNowBtn = document.getElementById('sb-sync-now');
if (syncNowBtn) {
  syncNowBtn.addEventListener('click', function() {
    syncNowBtn.disabled = true;
    _setSyncBar('refresh', 'Syncing now\u2026', '#1B4FD8');

    chrome.storage.local.remove('sb_notion_sync_error');
    NotionSync.reset();

    _runNotionSync(function() {
      syncNowBtn.disabled = false;
      updateSyncStatus();
    }, true);
  });
}

// ── AUTH GATE (AUTH-EXT-001 phase A) ──────────────────────────────
// OTP flow: pending state persists in chrome.storage.local under 'sb_otp_pending'
// so closing the popup mid-flow (e.g. to fetch the code from Gmail) doesn't reset it.
// Pending state expires after OTP_TTL_MS to avoid showing a stale code screen.
var OTP_TTL_MS = 55 * 60 * 1000; // Supabase OTPs are valid for 60 min; bail at 55.

var SB_DASHBOARD_LINK_URL = 'https://app.sprintbrain.com/extension-link';

(function initAuthGate() {
  var gate    = document.getElementById('sb-auth');
  var ssoPane = document.getElementById('sb-auth-sso');
  var ssoBtn  = document.getElementById('sb-auth-sso-btn');
  var showOtp = document.getElementById('sb-auth-show-otp');
  var hideOtp = document.getElementById('sb-auth-hide-otp');
  var otpPane = document.getElementById('sb-auth-otp');
  var emailEl = document.getElementById('sb-auth-email');
  var codeEl  = document.getElementById('sb-auth-code');
  var subEl   = document.getElementById('sb-auth-sub');
  var primary = document.getElementById('sb-auth-primary');
  var backEl  = document.getElementById('sb-auth-back');
  var msgEl      = document.getElementById('sb-auth-msg');
  var rememberEl = document.getElementById('sb-auth-remember');
  var rememberRow = document.getElementById('sb-auth-remember-row');
  if (!gate || !primary) return;

  var state = 'email'; // 'email' | 'code'
  var pendingEmail = '';
  var booted = false;

  function setPending(email) {
    pendingEmail = email || '';
    if (email) {
      chrome.storage.local.set({ sb_otp_pending: { email: email, sentAt: Date.now() } });
    } else {
      chrome.storage.local.remove('sb_otp_pending');
    }
  }

  function loadPending(cb) {
    chrome.storage.local.get('sb_otp_pending', function(d) {
      var p = d && d.sb_otp_pending;
      if (p && p.email && p.sentAt && (Date.now() - p.sentAt) < OTP_TTL_MS) {
        cb(p.email);
      } else {
        if (p) chrome.storage.local.remove('sb_otp_pending');
        cb(null);
      }
    });
  }

  function setMsg(text, ok) {
    msgEl.textContent = text || '';
    msgEl.className = 'sb-auth-msg' + (ok ? ' ok' : '');
  }

  function renderState() {
    if (state === 'email') {
      emailEl.style.display = '';
      codeEl.style.display = 'none';
      backEl.style.display = 'none';
      if (rememberRow) rememberRow.style.display = 'flex';
      primary.textContent = 'Send code';
      subEl.textContent = "Enter your work email — we'll send a one-time code.";
      setTimeout(function() { emailEl.focus(); }, 30);
    } else {
      emailEl.style.display = 'none';
      codeEl.style.display = '';
      backEl.style.display = '';
      if (rememberRow) rememberRow.style.display = 'none';
      primary.textContent = 'Verify';
      subEl.textContent = 'Enter the code sent to ' + pendingEmail + '.';
      setTimeout(function() { codeEl.focus(); }, 30);
    }
  }

  function showGate() {
    gate.classList.add('on');
    emailEl.value = '';
    codeEl.value = '';
    setMsg('');
    // Resume pending OTP if one was issued recently and the popup was closed mid-flow.
    loadPending(function(email) {
      if (email) {
        pendingEmail = email;
        state = 'code';
        renderState();
        setMsg('Code sent earlier — paste the code from your inbox.', true);
      } else {
        pendingEmail = '';
        state = 'email';
        renderState();
      }
    });
  }

  function hideGate() {
    gate.classList.remove('on');
  }

  function bootOnce(session) {
    SB_CURRENT_USER_ID = session.user_id;
    applyPopupGreeting(session);
    var emailLabel = document.getElementById('sb-signed-as');
    if (emailLabel && session.email) emailLabel.textContent = 'Signed in as ' + session.email;
    var signOutBtn = document.getElementById('sb-signout-btn');
    if (signOutBtn && !signOutBtn._wired) {
      signOutBtn._wired = true;
      signOutBtn.addEventListener('click', function() { window.sbSignOut(); });
    }
    if (!booted) { booted = true; boot(); }
  }

  primary.addEventListener('click', function() {
    if (primary.disabled) return;
    setMsg('');
    if (state === 'email') {
      var email = (emailEl.value || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { setMsg('Enter a valid email'); return; }
      primary.disabled = true;
      primary.textContent = 'Sending…';
      sbRequestOtp(email, function(err) {
        primary.disabled = false;
        primary.textContent = 'Send code';
        if (err) { setMsg(err); return; }
        setPending(email);
        state = 'code';
        renderState();
        setMsg('Code sent — check your inbox.', true);
      });
    } else {
      var code = (codeEl.value || '').trim();
      if (!/^\d{6,10}$/.test(code)) { setMsg('Enter the code from your email'); return; }
      primary.disabled = true;
      primary.textContent = 'Verifying…';
      if (!pendingEmail) { setMsg('Session lost — request a new code'); state = 'email'; renderState(); return; }
      sbVerifyOtp(pendingEmail, code, rememberEl ? rememberEl.checked : true, function(err, session) {
        primary.disabled = false;
        primary.textContent = 'Verify';
        if (err || !session) { setMsg(err || 'Invalid code'); return; }
        setPending(null); // clear pending OTP — we're authed
        hideGate();
        bootOnce(session);
      });
    }
  });

  backEl.addEventListener('click', function() {
    setPending(null);
    state = 'email';
    codeEl.value = '';
    setMsg('');
    renderState();
  });

  emailEl.addEventListener('keydown', function(e) { if (e.key === 'Enter') primary.click(); });
  codeEl.addEventListener('keydown',  function(e) { if (e.key === 'Enter') primary.click(); });

  // ── SSO via dashboard (AUTH-EXT-002) ────────────────────────────
  function showSsoPane() {
    if (ssoPane) ssoPane.style.display = 'flex';
    if (otpPane) otpPane.style.display = 'none';
    setMsg('');
  }
  function showOtpPane() {
    if (ssoPane) ssoPane.style.display = 'none';
    if (otpPane) otpPane.style.display = 'flex';
    setMsg('');
  }

  if (ssoBtn) {
    ssoBtn.addEventListener('click', function() {
      try { chrome.tabs.create({ url: SB_DASHBOARD_LINK_URL }); } catch(e) { window.open(SB_DASHBOARD_LINK_URL, '_blank'); }
      setMsg('Open the dashboard tab to confirm — popup will sign in automatically.', true);
    });
  }
  if (showOtp) showOtp.addEventListener('click', showOtpPane);
  if (hideOtp) hideOtp.addEventListener('click', showSsoPane);

  // React to a session that arrives via SSO handoff (background.js stores it).
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area !== 'local' || !changes.sb_session) return;
    var next = changes.sb_session.newValue;
    if (next && next.access_token && !booted) {
      chrome.storage.local.set({ sb_remember_until: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 });
      hideGate();
      bootOnce(next);
    }
  });

  // Initial check: if a session exists already, skip the gate.
  sbGetSession(function(session) {
    if (session && session.access_token) {
      hideGate();
      bootOnce(session);
      // Async liveness check: if this session was revoked from the dashboard
      // (Settings → Security), drop back to the sign-in gate immediately.
      sbCheckSessionAlive(function(alive) {
        if (!alive) window.sbSignOut();
      });
    }
    else { showGate(); showSsoPane(); }
  });

  // Expose a sign-out hook for the existing settings menu to call.
  window.sbSignOut = function() {
    sbClearSession(function() {
      booted = false;
      SB_CURRENT_USER_ID = null;
      // Clear in-memory snippet cache so the next sign-in shows the new user's data.
      try { snips = []; folders = []; refreshUI(); } catch(e) {}
      showGate();
    });
  };
})();
