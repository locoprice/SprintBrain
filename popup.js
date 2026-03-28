// SPRINTBRAIN POPUP v2.7 — Configurable dual triggers + Notion sync

var SUPA_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
var SUPA_KEY = 'sb_publishable_F_8LSMkr9ZK-9v50sPzXbQ_zjA0D_O0';

function supaFetch(table, method, body, qs) {
  var url  = SUPA_URL + '/rest/v1/' + table + (qs ? '?' + qs : '');
  var opts = {
    method: method || 'GET',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json',
      'Prefer': (method === 'POST' ? 'resolution=merge-duplicates,' : '') + 'return=minimal'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts);
}

var DB = {
  loadAll: function() {
    return Promise.all([
      supaFetch('folders',       'GET', null, 'select=*&order=sort_order').then(function(r){ return r.json(); }),
      supaFetch('snippets',      'GET', null, 'select=*&order=sort_order').then(function(r){ return r.json(); }),
      supaFetch('snippet_stats', 'GET', null, 'select=*').then(function(r){ return r.json(); })
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
            folder: s.folder_id || '', fieldCfg: s.field_cfg || {}, lang_group_id: s.lang_group_id || s.id,
            sort_order: s.sort_order || 0,
            enable_urgency_timer: s.enable_urgency_timer || false,
            timer_duration_ms: s.timer_duration_ms || 0,
            scarcity_count: s.scarcity_count || 0,
            stats: { uses: st.uses || 0, fills: st.fills || 0, lastUsed: st.last_used || null }
          };
        })
      };
    }).catch(function(e) { console.warn('[Sprintbrain] loadAll:', e); return null; });
  },
  upsertSnippet: function(s) {
    supaFetch('snippets', 'POST', {
      id: s.id, title: s.title, shortcut: s.shortcut || '',
      body: s.body || '', lang: s.lang || 'EN',
      folder_id: s.folder || null, field_cfg: s.fieldCfg || {}, lang_group_id: s.lang_group_id || s.id,
      sort_order: s.sort_order || 0,
      enable_urgency_timer: s.enable_urgency_timer || false,
      timer_duration_ms: s.timer_duration_ms || 0,
      scarcity_count: s.scarcity_count || 0
    }).catch(function(e) { console.warn('upsertSnippet:', e); });
  },
  deleteSnippet: function(id) {
    supaFetch('snippets', 'DELETE', null, 'id=eq.' + id).catch(function(e) { console.warn(e); });
  },
  upsertFolder: function(f) {
    supaFetch('folders', 'POST', {
      id: f.id, name: f.name, ico: f.ico || '\uD83D\uDCC1', sort_order: f.sort_order || 0
    }).catch(function(e) { console.warn('upsertFolder:', e); });
  },
  deleteFolder: function(id) {
    supaFetch('folders', 'DELETE', null, 'id=eq.' + id).catch(function(e) { console.warn('deleteFolder:', e); });
  },
  updateStats: function(snippetId, uses, fills, lastUsed) {
    supaFetch('snippet_stats', 'POST', {
      snippet_id: snippetId, uses: uses, fills: fills, last_used: lastUsed
    }).catch(function(e) { console.warn('updateStats:', e); });
  }
};

// DEFAULT DATA
var DEFAULT_FOLDERS = [
  { id: 'f1', name: 'Presupuestos', ico: '\uD83D\uDCB0', sort_order: 1 },
  { id: 'f2', name: 'AI Prompts',   ico: '\uD83E\uDD16', sort_order: 2 }
];

var DEFAULT_SNIPPETS = [
  { id:'s1', shortcut:';;quoteEN', title:'BOOKING QUOTE EN', lang:'EN', folder:'f1', sort_order:1,
    fieldCfg:{OTA_PRICE:{type:'number',default:'0'},YOUR_PRICE:{type:'number',default:'0'},PAYMENT_TERMS:{type:'dd',opts:'Full payment upon confirmation\n50% deposit + balance 40 days before check-in'}},
    body:'Original Accommodation Price: {OTA_PRICE} \u20AC\n\u2605 Your Price: {YOUR_PRICE} \u20AC\n{if:OTA_PRICE > 0}\u2713 You save: {=OTA_PRICE - YOUR_PRICE} \u20AC (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%)\n\u2713 OTA fees saved (12-18%){endif}\n\u2713 Payment terms: {PAYMENT_TERMS}\n\nPAYMENT OPTIONS\n- Bank Transfer: {=YOUR_PRICE - 25} \u20AC \u2764\uFE0F\n- Card: {=round(YOUR_PRICE * 1.03)} \u20AC\n\n\uD83D\uDD17 leibtour.com/faqs/booking-process',
    stats:{uses:0,fills:0,lastUsed:null} },
  { id:'s2', shortcut:';;quoteES', title:'PRESUPUESTO B2C', lang:'ES', folder:'f1', sort_order:2,
    fieldCfg:{OTA_PRICE:{type:'number',default:'0'},YOUR_PRICE:{type:'number',default:'0'},PAYMENT_TERMS:{type:'dd',opts:'Pago completo a la confirmaci\u00F3n\n50% dep\u00F3sito + saldo 40 d\u00EDas antes'}},
    body:'Precio OTA: {OTA_PRICE} \u20AC\n\u2605 Tu Precio: {YOUR_PRICE} \u20AC\n{if:OTA_PRICE > 0}\u2713 Ahorras: {=OTA_PRICE - YOUR_PRICE} \u20AC (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%){endif}\n\u2713 T\u00E9rminos: {PAYMENT_TERMS}\n\nPAGO\n- Transferencia: {=YOUR_PRICE - 25} \u20AC \u2764\uFE0F\n- Tarjeta: {=round(YOUR_PRICE * 1.03)} \u20AC',
    stats:{uses:0,fills:0,lastUsed:null} },
  { id:'s3', shortcut:';;quoteIT', title:'PREVENTIVO B2C', lang:'IT', folder:'f1', sort_order:3,
    fieldCfg:{OTA_PRICE:{type:'number',default:'0'},YOUR_PRICE:{type:'number',default:'0'},PAYMENT_TERMS:{type:'dd',opts:'Pagamento completo alla conferma\n50% deposito + saldo 40 giorni prima'}},
    body:'Prezzo OTA: {OTA_PRICE} \u20AC\n\u2605 Il Tuo Prezzo: {YOUR_PRICE} \u20AC\n{if:OTA_PRICE > 0}\u2713 Risparmi: {=OTA_PRICE - YOUR_PRICE} \u20AC (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%){endif}\n\u2713 Termini: {PAYMENT_TERMS}\n\nPAGAMENTO\n- Bonifico: {=YOUR_PRICE - 25} \u20AC \u2764\uFE0F\n- Carta: {=round(YOUR_PRICE * 1.03)} \u20AC',
    stats:{uses:0,fills:0,lastUsed:null} },
  { id:'s4', shortcut:';;checkin', title:'CHECK-IN EN', lang:'EN', folder:'f1', sort_order:4,
    fieldCfg:{property_name:{type:'dd',opts:'Casa Duquesa\nVilla Santa Eulalia\nApartment San Antonio'},CHECKIN:{type:'date'},CHECKOUT:{type:'date'}},
    body:'Dear {guest_name},\n\nWelcome to {property_name}! \uD83C\uDF05\n\n\uD83D\uDD11 Check-in: {CHECKIN} at 16:00\n\uD83D\uDD11 Check-out: {CHECKOUT} at 11:00\nKeys: {key_location}\n\n\uD83D\uDCCD {property_address}\n\uD83D\uDCF1 Emergency: +34 {phone_number}\n\nEnjoy Ibiza!\nLeibTour Team',
    stats:{uses:0,fills:0,lastUsed:null} },
  { id:'s5', shortcut:';;review', title:'REVIEW REQUEST EN', lang:'EN', folder:'f1', sort_order:5,
    fieldCfg:{property_name:{type:'dd',opts:'Casa Duquesa\nVilla Santa Eulalia\nApartment San Antonio'}},
    body:'Dear {guest_name},\n\nThank you for staying at {property_name}! \uD83C\uDF1F\n\nJust 2 minutes on Airbnb means the world to us.\n\n\uD83D\uDC49 {review_link}\n\nWarm regards,\nLeibTour Team',
    stats:{uses:0,fills:0,lastUsed:null} }
];

// STATE
var snips        = DEFAULT_SNIPPETS.slice();
var folders      = DEFAULT_FOLDERS.slice();
var trig         = ';;';
var editId       = null;
var pendT        = ';;';
var selFolder    = 'ALL';
var ctxId        = null;
var selId        = null;
var pendFolderCb = null;
var selIco       = '\uD83D\uDCC1';
var ctxFolderId  = null;

// TRIGGER CONFIGURATION — synced via chrome.storage.sync + Notion
var triggerCfg = { snippetTrigger: '::', promptTrigger: '"""', snippetActivationKey: 'Tab', promptActivationKey: 'Tab' };

function loadTriggerCfg(cb) {
  try {
    chrome.storage.sync.get('triggerCfg', function(d) {
      if (d && d.triggerCfg) {
        if (d.triggerCfg.snippetTrigger) triggerCfg.snippetTrigger = d.triggerCfg.snippetTrigger;
        if (d.triggerCfg.promptTrigger) triggerCfg.promptTrigger = d.triggerCfg.promptTrigger;
        if (d.triggerCfg.snippetActivationKey) triggerCfg.snippetActivationKey = d.triggerCfg.snippetActivationKey;
        if (d.triggerCfg.promptActivationKey) triggerCfg.promptActivationKey = d.triggerCfg.promptActivationKey;
      }
      if (cb) cb();
    });
  } catch(e) { if (cb) cb(); }
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

// NOTION SYNC — logs trigger config changes
var notionCfg = { apiKey: '', dbId: '' };
var notionLog = [];
var notionSentKeys = {};

function loadNotionCfg() {
  try { chrome.storage.sync.get('notionCfg', function(d) { if (d && d.notionCfg) notionCfg = d.notionCfg; }); } catch(e) {}
}
function saveNotionCfg() {
  try { chrome.storage.sync.set({notionCfg: notionCfg}); } catch(e) {}
}

function notionSync(entry) {
  var key = entry.triggerType + '|' + entry.field + '|' + entry.newValue + '|' + entry.timestamp;
  notionLog.push({ entry: entry, status: 'pending' });
  if (notionLog.length > 20) notionLog.shift();
  if (notionSentKeys[key]) { notionLog[notionLog.length-1].status = 'skipped'; return; }
  if (!notionCfg.apiKey || !notionCfg.dbId) { notionLog[notionLog.length-1].status = 'no config'; return; }
  notionSendWithRetry(entry, 0, notionLog.length - 1, key);
}

function notionSendWithRetry(entry, attempt, logIdx, key) {
  var delays = [1000, 2000, 4000];
  fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + notionCfg.apiKey, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({
      parent: { database_id: notionCfg.dbId },
      properties: {
        'Trigger Type': { title: [{ text: { content: entry.triggerType } }] },
        'Field': { rich_text: [{ text: { content: entry.field } }] },
        'New Value': { rich_text: [{ text: { content: String(entry.newValue) } }] },
        'Old Value': { rich_text: [{ text: { content: String(entry.oldValue || '') } }] },
        'Timestamp': { rich_text: [{ text: { content: entry.timestamp } }] }
      }
    })
  }).then(function(r) {
    if (r.ok) { notionSentKeys[key] = true; if (notionLog[logIdx]) notionLog[logIdx].status = 'synced'; }
    else throw new Error('HTTP ' + r.status);
  }).catch(function(err) {
    console.warn('[Sprintbrain NotionSync] attempt ' + (attempt+1) + ':', err.message);
    if (attempt < 2) setTimeout(function() { notionSendWithRetry(entry, attempt+1, logIdx, key); }, delays[attempt]);
    else if (notionLog[logIdx]) notionLog[logIdx].status = 'failed';
  });
}

function setTriggerCfgValue(key, value) {
  var oldVal = triggerCfg[key];
  if (oldVal === value) return;
  triggerCfg[key] = value;
  saveTriggerCfg();
  notionSync({
    triggerType: key.indexOf('snippet') > -1 ? 'Snippet' : 'Prompt',
    field: key, oldValue: oldVal, newValue: value,
    timestamp: new Date().toISOString()
  });
}

// HELPERS
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function uid(){  return 's'+Date.now()+Math.random().toString(36).slice(2,5); }
function fuid(){ return 'f'+Date.now()+Math.random().toString(36).slice(2,5); }
function gi(id){ return document.getElementById(id); }

function show(id){
  ['pane-list','pane-ed','pane-cfg'].forEach(function(p){
    var el=gi(p); if(el) el.className='pane'+(p===id?' on':'');
  });
}

function loadTrigger(cb){
  try{ chrome.storage.sync.get('trigger',function(d){ if(d&&d.trigger) trig=d.trigger; if(cb) cb(); }); }
  catch(e){ if(cb) cb(); }
}
function saveTrigger(){ try{ chrome.storage.sync.set({trigger:trig}); }catch(e){} }


// ── CHANGELOG ─────────────────────────────────────────────────────
var CHANGELOG = [
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
      {type:'new', text:'Configurable trigger character (;;, ::, !!, /)'},
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
    rel.changes.forEach(function(c) {
      h += '<div class="cl-c"><span class="cl-b '+c.type+'">'+c.type+'</span><span>'+esc(c.text)+'</span></div>';
    });
    h += '</div></div>';
  });
  body.innerHTML = h;
  gi('cl-bg').className = 'cl-bg on';
}

function closeChangelog() { gi('cl-bg').className = 'cl-bg'; }

// BOOT — called once on popup open
function boot() {
    refreshUI();

    loadTrigger(function () {
          var tp = gi('tp');
        if (tp) tp.textContent = trig;
          var he = gi('hint-ex'); if (he) he.textContent = trig + 'quoteEN';
          var sp = gi('spfx'); if (sp) sp.textContent = trig;
    });

    loadTriggerCfg(function () {
          var s  = gi('tcfg-snip');        if (s)  s.value  = triggerCfg.snippetTrigger;
          var p  = gi('tcfg-prompt');      if (p)  p.value  = triggerCfg.promptTrigger;
          var sa = gi('tcfg-snip-key');    if (sa) sa.value = triggerCfg.snippetActivationKey;
          var pa = gi('tcfg-prompt-key');  if (pa) pa.value = triggerCfg.promptActivationKey;
    });

    loadNotionCfg();

    var st = gi('st');   if (st) st.textContent = '● Syncing…';

    DB.loadAll().then(function (data) {
          if (data && data.snippets && data.snippets.length > 0) {
                  snips   = data.snippets;
                  folders = (data.folders && data.folders.length > 0) ? data.folders : DEFAULT_FOLDERS;
          } else {
                  DEFAULT_FOLDERS.forEach(function (f) { DB.upsertFolder(f); });
                  DEFAULT_SNIPPETS.forEach(function (s) { DB.upsertSnippet(s); DB.updateStats(s.id, 0, 0, null); });
          }
          refreshUI();
          _runNotionSync();
    });
}

function _runNotionSync() {
    var st = gi('st');
    var nsEl = gi('notion-st');

    NotionSync.run(notionCfg, {

          onProgress: function (state) {
                  if (state === 'syncing') {
                            if (st)   st.textContent = '● Syncing Notion…';
                            if (nsEl) { nsEl.textContent = 'Syncing…'; nsEl.style.color = '#BA7517'; }
                  } else {
                            if (st)   st.textContent = '● ' + snips.length + ' snippet' + (snips.length !== 1 ? 's' : '');
                            if (nsEl && notionCfg.apiKey && notionCfg.dbId) {
                                        nsEl.textContent = 'Connected'; nsEl.style.color = '#3B6D11';
                            }
                  }
          },

          onComplete: function (notionSnippets, success) {
                  if (!success || !notionSnippets.length) return;
                  var changed = false;
                  notionSnippets.forEach(function (ns) {
                            var existingIdx = -1;
                            for (var i = 0; i < snips.length; i++) {
                                        if (snips[i].notion_page_id && snips[i].notion_page_id === ns.notion_page_id) { existingIdx = i; break; }
                                        if (snips[i].id === ns.id) { existingIdx = i; break; }
                            }
                            if (existingIdx > -1) {
                                        var existing = snips[existingIdx];
                                        if (existing.title !== ns.title || existing.body !== ns.body || existing.shortcut !== ns.shortcut) {
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
                  if (changed) {
                            refreshUI();
                            showToast('✓ Notion synced — ' + notionSnippets.length + ' snippet(s) updated');
                  }
          },

          onError: function (err) {
                  console.warn('[SprintBrain] Notion sync failed — falling back to cache.', err.message);
                  if (nsEl && notionCfg.apiKey && notionCfg.dbId) {
                            nsEl.textContent = 'Sync failed'; nsEl.style.color = '#c0392b';
                  }
          }

    });
}

// UI REFRESH
function refreshUI(){
  var tp=gi('tp'); if(tp) tp.textContent=trig;
  var he=gi('hint-ex'); if(he) he.textContent=trig+'quoteEN';
  var st=gi('st'); if(st) st.textContent='\u25CF '+snips.length+' snippet'+(snips.length!==1?'s':'');
  renderFolders();
  renderList(gi('sq')?gi('sq').value:'');
}

// FOLDERS
function folderCount(fid){ var n=0; for(var i=0;i<snips.length;i++){ if((snips[i].folder||'')===fid) n++; } return n; }

function findFolder(id){ for(var i=0;i<folders.length;i++){ if(folders[i].id===id) return folders[i]; } return null; }

function renderFolders(){
  var el=gi('folder-list'); if(!el) return;
  var h='<div class="folder-item'+(selFolder==='ALL'?' on':'')+'" data-fid="ALL" tabindex="0" role="treeitem"><span class="folder-ico">\u25C8</span><span class="folder-name">All snippets</span><span class="folder-count">'+snips.length+'</span></div>';
  for(var i=0;i<folders.length;i++){
    var f=folders[i];
    h+='<div class="folder-item'+(selFolder===f.id?' on':'')+'" data-fid="'+f.id+'" tabindex="0" role="treeitem">'
      +'<span class="folder-ico">'+esc(f.ico||'\uD83D\uDCC1')+'</span>'
      +'<span class="folder-name">'+esc(f.name)+'</span>'
      +'<span class="folder-count">'+folderCount(f.id)+'</span>'
      +'<span class="folder-dots" data-fdots="'+f.id+'" title="Folder options">\u22EF</span>'
      +'</div>';
  }
  el.innerHTML=h;
  el.querySelectorAll('.folder-item').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.dataset.fdots){ ctxFolderId=e.target.dataset.fdots; showFolderCtxMenu(e.clientX,e.clientY); return; }
      selFolder=row.dataset.fid; renderFolders();
      renderList(gi('sq')?gi('sq').value:'');
    });
    row.addEventListener('contextmenu',function(e){
      e.preventDefault();
      if(row.dataset.fid==='ALL') return;
      ctxFolderId=row.dataset.fid; showFolderCtxMenu(e.clientX,e.clientY);
    });
    row.addEventListener('keydown',function(e){
      if((e.shiftKey&&e.key==='F10')||e.key==='ContextMenu'){
        e.preventDefault();
        if(row.dataset.fid==='ALL') return;
        ctxFolderId=row.dataset.fid;
        var r=row.getBoundingClientRect();
        showFolderCtxMenu(r.right-10,r.bottom);
      }
    });
  });
}

// SNIPPET LIST
function findSnip(id){ for(var i=0;i<snips.length;i++){ if(snips[i].id===id) return snips[i]; } return null; }

function renderList(q){
  var el=gi('list'); if(!el) return;
  var filtered=snips.filter(function(s){
    var mf=selFolder==='ALL'||(s.folder||'')===selFolder;
    var mq=!q||String(s.title||'').toLowerCase().indexOf(q.toLowerCase())>-1||String(s.shortcut||'').toLowerCase().indexOf(q.toLowerCase())>-1;
    return mf&&mq;
  });
  if(!filtered.length){ el.innerHTML='<div class="empty">No snippets found.<br><small>Click \u201C+ New\u201D to add one.</small></div>'; return; }
  var groups=groupSnips(filtered);
  var h='';
  for(var gi2=0;gi2<groups.length;gi2++){
    var g=groups[gi2];
    var master=g.master;
    var variants=g.variants;
    var vLangs=Object.keys(variants);
    var s=variants[selId]||master;
    var st=s.stats||{uses:0,fills:0,lastUsed:null};
    var usesBadge=st.uses===0?'<span class="stat-b never">Never used</span>':st.uses>=10?'<span class="stat-b hot">🔥 ×'+st.uses+'</span>':'<span class="stat-b uses">×'+st.uses+'</span>';
    var fillsBadge=st.uses>0?'<span class="stat-b fills">✏️ '+st.fills+' filled</span>':'';
    var pillsHtml='';
    if(vLangs.length>1){
      ['EN','ES','IT','FR'].forEach(function(l){
        if(variants[l]){
          var isAct=variants[l].id===selId;
          pillsHtml+='<span class="stat-b '+(isAct?'uses':'never')+'" style="cursor:pointer;font-weight:700" data-switch="'+variants[l].id+'">'+l+(isAct?' ✓':'')+'</span>';
        }
      });
    }
    var baseTitle=master.title.replace(/\s*(EN|ES|IT|FR)$/,'');
    h+='<div class="item" data-id="'+s.id+'">'
      +'<div style="flex:1;min-width:0;overflow:hidden">'
      +'<div class="iname" id="iname-'+s.id+'">'+esc(baseTitle)+'</div>'
      +'<div style="display:flex;gap:4px;margin-top:2px">'+usesBadge+fillsBadge+pillsHtml+'</div>'
      +'</div>'
      +'<span class="isc">'+esc(s.shortcut||'')+'</span>'
      +'<span class="lb '+esc(s.lang||'EN')+'">'+esc(s.lang||'EN')+'</span>'
      +'<button class="iedit" data-eid="'+s.id+'">Edit</button>'
      +'</div>';
  }
    el.innerHTML=h;
  el.querySelectorAll('.item').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.dataset.switch){ 
        selId=e.target.dataset.switch; 
        refreshUI(); 
        return; 
      }
      if(e.target.dataset.eid){ openEd(e.target.dataset.eid); return; }
      var s=findSnip(row.dataset.id); if(!s) return;
      try{ navigator.clipboard.writeText(s.shortcut||''); }catch(e2){}
      if(!s.stats) s.stats={uses:0,fills:0,lastUsed:null};
      s.stats.uses=(s.stats.uses||0)+1;
      s.stats.lastUsed=new Date().toISOString();
      DB.updateStats(s.id,s.stats.uses,s.stats.fills,s.stats.lastUsed);
      var nm=gi('iname-'+row.dataset.id);
      var orig=nm?nm.textContent:s.title;
      if(nm) nm.textContent='\u2713 '+(s.shortcut||'')+' copied!';
      setTimeout(function(){ if(nm) nm.textContent=orig; },1600);
    });
    row.addEventListener('contextmenu',function(e){
      e.preventDefault(); ctxId=row.dataset.id; showCtxMenu(e.clientX,e.clientY);
    });
  });
}

// EDITOR
function buildFolderOpts(current){
  var h='<option value="">— No folder —</option>';
  for(var i=0;i<folders.length;i++){
    var f=folders[i];
    h+='<option value="'+f.id+'"'+(f.id===current?' selected':'')+'>'+esc(f.ico+' '+f.name)+'</option>';
  }
  return h;
}

function _s(id,prop,val){ var e=gi(id); if(e) e[prop]=val; }
function openEd(id){
  editId=id||null;
  var s=id?findSnip(id):null;
  _s('edhdr','textContent',s?'Edit Snippet':'New Snippet');
  _s('etit','value',s?(s.title||''):'');
  var full=s?(s.shortcut||''):'';
  var ew=gi('ewrd'); if(ew) ew.value=full.indexOf(trig)===0?full.slice(trig.length):full;
  _s('spfx','textContent',trig);
  var el2=gi('elng'); if(el2) el2.value=s?(s.lang||'EN'):'EN';
  var ef=gi('efolder'); if(ef) ef.innerHTML=buildFolderOpts(s?(s.folder||''):(selFolder!=='ALL'?selFolder:''));
  _s('ebdy','value',s?(s.body||''):'');
  var bd=gi('bdel'); if(bd) bd.style.display=s?'block':'none';
  // Urgency fields
  var urgOn = s ? !!s.enable_urgency_timer : false;
  var urgDur = s && s.timer_duration_ms ? Math.round(s.timer_duration_ms / 60000) : 30;
  var urgSc = s && s.scarcity_count ? s.scarcity_count : 0;
  var eu=gi('eurg'); if(eu) eu.checked = urgOn;
  _s('eurg-dur','value',urgDur);
  _s('eurg-sc','value',urgSc);
  var uf=gi('urg-fields'); if(uf) uf.style.display = urgOn ? '' : 'none';
  var sk=gi('sok'); if(sk) sk.className='saveok';
  updateSprev();
  show('pane-ed');
  setTimeout(function(){ var et=gi('etit'); if(et) et.focus(); },50);
}

function updateSprev(){
  var w=(gi('ewrd').value||'').replace(/^[^a-zA-Z0-9]+/,'');
  var el=gi('sprev'); if(el) el.textContent=trig+(w||'shortcut');
}

function doSave(){
  var title=(gi('etit').value||'').trim();
  var word=(gi('ewrd').value||'').trim().replace(/^[^a-zA-Z0-9]+/,'');
  var body=gi('ebdy').value||'';
  var lang=gi('elng').value||'EN';
  var folder=gi('efolder').value||'';
  var sc=trig+word;
  if(!title){ shake('etit'); return; }
  if(!word){  shake('ewrd'); return; }
  var urgEnabled = gi('eurg').checked;
  var urgDurMs = Math.max(1, parseInt(gi('eurg-dur').value) || 30) * 60000;
  var urgSc = Math.max(0, parseInt(gi('eurg-sc').value) || 0);
  var isNew=!editId, toSave;
  if(isNew){
    toSave={id:uid(),title:title,shortcut:sc,body:body,lang:lang,folder:folder,fieldCfg:{},lang_group_id:'',sort_order:snips.length+1,
      enable_urgency_timer:urgEnabled,timer_duration_ms:urgDurMs,scarcity_count:urgSc,
      stats:{uses:0,fills:0,lastUsed:null}};
    toSave.lang_group_id=toSave.id;
    snips.unshift(toSave);
  } else {
    for(var i=0;i<snips.length;i++){
      if(snips[i].id===editId){
        snips[i].title=title; snips[i].shortcut=sc; snips[i].body=body;
        snips[i].lang=lang; snips[i].folder=folder;
        snips[i].enable_urgency_timer=urgEnabled;
        snips[i].timer_duration_ms=urgDurMs;
        snips[i].scarcity_count=urgSc;
        toSave=snips[i]; break;
      }
    }
  }
  if(!toSave) return;
  DB.upsertSnippet(toSave);
  if(isNew) DB.updateStats(toSave.id,0,0,null);
  // Refresh context menus in background
  try{ chrome.runtime.sendMessage({type:'REFRESH_MENUS'}); }catch(e){}
  gi('sok').className='saveok on';
  setTimeout(function(){ gi('sok').className='saveok'; show('pane-list'); refreshUI(); },700);
}

function doDel(){
  if(!editId||!confirm('Delete this snippet?')) return;
  DB.deleteSnippet(editId);
  snips=snips.filter(function(s){ return s.id!==editId; });
  try{ chrome.runtime.sendMessage({type:'REFRESH_MENUS'}); }catch(e){}
  show('pane-list'); refreshUI();
}

function shake(id){
  var el=gi(id); if(!el) return;
  el.style.borderColor='#c0392b'; el.style.background='#fdf0ef';
  setTimeout(function(){ el.style.borderColor=''; el.style.background=''; },900);
}

function insertCmd(cmd){
  var ta=gi('ebdy'); var s=ta.selectionStart,e=ta.selectionEnd;
  ta.value=ta.value.substring(0,s)+cmd+ta.value.substring(e);
  ta.selectionStart=ta.selectionEnd=s+cmd.length; ta.focus();
}

// CONTEXT MENU
function showCtxMenu(x,y){
  closeCtxMenu();
  var sub=gi('ctx-sub-folders'); var h='';
  for(var i=0;i<folders.length;i++){
    h+='<div class="ctx-sub-item" data-move-to="'+folders[i].id+'"><span style="font-size:12px;width:16px;text-align:center">'+esc(folders[i].ico||'\uD83D\uDCC1')+'</span>'+esc(folders[i].name)+'</div>';
  }
  h+='<div class="ctx-sub-item add" id="ctx-sub-new"><span style="font-size:12px;width:16px;text-align:center">\uFF0B</span>New folder\u2026</div>';
  sub.innerHTML=h;
  sub.querySelectorAll('[data-move-to]').forEach(function(item){
    item.addEventListener('click',function(e){
      e.stopPropagation();
      var s=findSnip(ctxId); if(s){ s.folder=item.dataset.moveTo; DB.upsertSnippet(s); refreshUI(); }
      closeCtxMenu();
    });
  });
  var snf=gi('ctx-sub-new');
  if(snf) snf.addEventListener('click',function(e){
    e.stopPropagation(); closeCtxMenu();
    openFolderModal(function(fid){ var s=findSnip(ctxId); if(s){ s.folder=fid; DB.upsertSnippet(s); refreshUI(); } });
  });
  var m=gi('ctx-menu'); m.style.left=x+'px'; m.style.top=y+'px'; m.className='ctx-menu on';
  setTimeout(function(){ var r=m.getBoundingClientRect(); if(r.right>window.innerWidth) m.style.left=(x-r.width)+'px'; if(r.bottom>window.innerHeight) m.style.top=(y-r.height)+'px'; },0);
}

function closeCtxMenu(){ var m=gi('ctx-menu'); if(m) m.className='ctx-menu'; closeFolderCtxMenu(); closeEmptyCtxMenu(); }

// FOLDER CONTEXT MENU
function showFolderCtxMenu(x,y){
  closeCtxMenu();
  var m=gi('fctx-menu'); if(!m) return;
  m.style.left=x+'px'; m.style.top=y+'px'; m.className='ctx-menu on';
  setTimeout(function(){ var r=m.getBoundingClientRect(); if(r.right>window.innerWidth) m.style.left=(x-r.width)+'px'; if(r.bottom>window.innerHeight) m.style.top=(y-r.height)+'px'; },0);
}
function closeFolderCtxMenu(){ var m=gi('fctx-menu'); if(m) m.className='ctx-menu'; }

// EMPTY AREA CONTEXT MENU
function showEmptyCtxMenu(x,y){
  closeCtxMenu();
  var m=gi('ectx-menu'); if(!m) return;
  m.style.left=x+'px'; m.style.top=y+'px'; m.className='ctx-menu on';
  setTimeout(function(){ var r=m.getBoundingClientRect(); if(r.right>window.innerWidth) m.style.left=(x-r.width)+'px'; if(r.bottom>window.innerHeight) m.style.top=(y-r.height)+'px'; },0);
}
function closeEmptyCtxMenu(){ var m=gi('ectx-menu'); if(m) m.className='ctx-menu'; }

// Folder context menu actions
var fctxRen=gi('fctx-rename'); if(fctxRen) fctxRen.addEventListener('click',function(){
  closeFolderCtxMenu();
  var f=findFolder(ctxFolderId); if(!f) return;
  var name=prompt('Rename folder:',f.name);
  if(name&&name.trim()){ f.name=name.trim(); DB.upsertFolder(f); refreshUI(); }
});

var fctxIco=gi('fctx-icon'); if(fctxIco) fctxIco.addEventListener('click',function(){
  closeFolderCtxMenu();
  var f=findFolder(ctxFolderId); if(!f) return;
  editFolderId=f.id; selIco=f.ico||'\uD83D\uDCC1';
  var inp=gi('folder-name-inp'); if(inp) inp.value=f.name;
  document.querySelectorAll('.ico-opt').forEach(function(el){ el.className='ico-opt'+(el.dataset.ico===selIco?' on':''); });
  var modal=gi('folder-modal'); if(modal) modal.className='modal-overlay on';
  setTimeout(function(){ if(inp) inp.focus(); },50);
});

var fctxDel=gi('fctx-delete'); if(fctxDel) fctxDel.addEventListener('click',function(){
  closeFolderCtxMenu();
  var f=findFolder(ctxFolderId); if(!f) return;
  var cnt=folderCount(f.id);
  var msg=cnt>0?'Delete folder "'+f.name+'" and ungroup its '+cnt+' snippet(s)?':'Delete folder "'+f.name+'"?';
  if(!confirm(msg)) return;
  // Move snippets to no folder
  snips.forEach(function(s){ if((s.folder||'')===f.id){ s.folder=''; DB.upsertSnippet(s); } });
  DB.deleteFolder(f.id);
  folders=folders.filter(function(fl){ return fl.id!==f.id; });
  if(selFolder===f.id) selFolder='ALL';
  refreshUI();
});

// Empty area context menu actions
var ectxSnip=gi('ectx-new-snippet'); if(ectxSnip) ectxSnip.addEventListener('click',function(){ closeEmptyCtxMenu(); openEd(null); });
var ectxFold=gi('ectx-new-folder'); if(ectxFold) ectxFold.addEventListener('click',function(){ closeEmptyCtxMenu(); openFolderModal(null); });

var ctxDup=gi('ctx-duplicate'); if(ctxDup) ctxDup.addEventListener('click',function(){
  var s=findSnip(ctxId); if(!s) return;
  var copy=JSON.parse(JSON.stringify(s)); copy.id=uid(); copy.title='Copy of '+copy.title; copy.shortcut+='2'; copy.stats={uses:0,fills:0,lastUsed:null};
  snips.splice(snips.indexOf(s)+1,0,copy); DB.upsertSnippet(copy); DB.updateStats(copy.id,0,0,null);
  refreshUI(); closeCtxMenu();
});
var ctxRen=gi('ctx-rename'); if(ctxRen) ctxRen.addEventListener('click',function(){ closeCtxMenu(); startInlineRename(ctxId); });
var ctxDel=gi('ctx-delete'); if(ctxDel) ctxDel.addEventListener('click',function(){
  if(!ctxId||!confirm('Delete this snippet?')) return;
  DB.deleteSnippet(ctxId); snips=snips.filter(function(s){ return s.id!==ctxId; });
  refreshUI(); closeCtxMenu();
});

function startInlineRename(id){
  var s=findSnip(id); if(!s) return; var el=gi('iname-'+id); if(!el) return;
  var orig=s.title; var inp=document.createElement('input'); inp.className='iname-edit'; inp.value=orig;
  el.parentNode.replaceChild(inp,el); inp.focus(); inp.select();
  function commit(){ var v=(inp.value||'').trim(); if(v&&v!==orig){ s.title=v; DB.upsertSnippet(s); } renderList(gi('sq')?gi('sq').value:''); }
  inp.addEventListener('blur',commit);
  inp.addEventListener('keydown',function(e){ if(e.key==='Enter'){e.preventDefault();inp.blur();} if(e.key==='Escape'){inp.value=orig;inp.blur();} });
}

// FOLDER MODAL
function openFolderModal(cb){
  pendFolderCb=cb||null; editFolderId=null; selIco='\uD83D\uDCC1';
  var inp=gi('folder-name-inp'); if(inp) inp.value='';
  document.querySelectorAll('.ico-opt').forEach(function(el){ el.className='ico-opt'+(el.dataset.ico===selIco?' on':''); });
  var modal=gi('folder-modal'); if(modal) modal.className='modal-overlay on';
  setTimeout(function(){ var inp2=gi('folder-name-inp'); if(inp2) inp2.focus(); },50);
}
function closeFolderModal(){ var m=gi('folder-modal'); if(m) m.className='modal-overlay'; pendFolderCb=null; editFolderId=null; }

var editFolderId=null;
var fSave=gi('folder-save'); if(fSave) fSave.addEventListener('click',function(){
  var name=(gi('folder-name-inp').value||'').trim(); if(!name){ shake('folder-name-inp'); return; }
  if(editFolderId){
    // Edit-existing-folder mode
    var ef=findFolder(editFolderId);
    if(ef){ ef.name=name; ef.ico=selIco; DB.upsertFolder(ef); }
    editFolderId=null;
    closeFolderModal(); refreshUI();
    return;
  }
  var nf={id:fuid(),name:name,ico:selIco,sort_order:folders.length+1};
  folders.push(nf); DB.upsertFolder(nf);
  if(pendFolderCb) pendFolderCb(nf.id);
  closeFolderModal(); refreshUI();
});
var fCancel=gi('folder-cancel'); if(fCancel) fCancel.addEventListener('click',closeFolderModal);
var fModal=gi('folder-modal'); if(fModal) fModal.addEventListener('click',function(e){ if(e.target===fModal) closeFolderModal(); });
var fNameInp=gi('folder-name-inp'); if(fNameInp) fNameInp.addEventListener('keydown',function(e){ if(e.key==='Enter'){ var fs=gi('folder-save'); if(fs) fs.click(); } if(e.key==='Escape') closeFolderModal(); });
var icoPicker=document.getElementById('ico-picker'); if(icoPicker) icoPicker.addEventListener('click',function(e){
  var opt=e.target.closest('.ico-opt'); if(!opt) return;
  selIco=opt.dataset.ico;
  document.querySelectorAll('.ico-opt').forEach(function(el){ el.className='ico-opt'+(el.dataset.ico===selIco?' on':''); });
});

// SETTINGS
function openCfg(){ pendT=trig; syncTG(pendT); gi('ctrig').value=trig; updateWarn(pendT); updateInfo(pendT); show('pane-cfg'); }
function syncTG(t){ document.querySelectorAll('.topt').forEach(function(el){ el.className='topt'+(el.dataset.t===t?' on':''); }); }
function updateWarn(t){ var w=gi('wbox'); if(t==='/'){ w.innerHTML='\u26A0\uFE0F <strong>/</strong> conflicts with WhatsApp, Claude and Notion. Use <strong>;;</strong> instead.'; w.className='warn on'; }else{ w.className='warn'; } }
function updateInfo(t){ gi('itrig').textContent=t; gi('iex').textContent=t+'quoteEN'; }
function applyTrig(){
  var custom=(gi('ctrig').value||'').trim(); var chosen=custom||pendT; if(!chosen) return;
  var old=trig;
  for(var i=0;i<snips.length;i++){ var sc=snips[i].shortcut||''; if(sc.indexOf(old)===0){ snips[i].shortcut=chosen+sc.slice(old.length); DB.upsertSnippet(snips[i]); } }
  trig=chosen; saveTrigger(); show('pane-list'); refreshUI();
}

// WIRE EVENTS
function on(id,ev,fn){ var e=gi(id); if(e) e.addEventListener(ev,fn); }
on('bnew','click',   function(){ openEd(null); });
on('bnew2','click',  function(){ openEd(null); });
on('btn-new-folder','click', function(){ openFolderModal(null); });
on('bbed','click',   function(){ show('pane-list'); refreshUI(); });
on('bcan','click',   function(){ show('pane-list'); refreshUI(); });
on('bsav','click',   doSave);
on('bdel','click',   doDel);
on('bcfg','click',   openCfg);
on('bbcfg','click',  function(){ show('pane-list'); refreshUI(); });
on('bcct','click',   function(){ show('pane-list'); refreshUI(); });
on('bappt','click',  applyTrig);
on('brel','click',   function(){
  var st=gi('st'); if(st) st.textContent='\u25CF Reloading\u2026';
  DB.loadAll().then(function(data){
    if(data&&data.snippets&&data.snippets.length>0){ snips=data.snippets; if(data.folders&&data.folders.length>0) folders=data.folders; }
    refreshUI();
  });
});
on('sq','input',    function(e){ renderList(e.target.value); });
on('ewrd','input',  updateSprev);
on('ebdy','keydown',function(e){ if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();doSave();} });
on('eurg','change', function(){ var uf=gi('urg-fields'),eu=gi('eurg'); if(uf&&eu) uf.style.display=eu.checked?'':'none'; });
var cmdGrid=document.querySelector('.cmd-grid'); if(cmdGrid) cmdGrid.addEventListener('click',function(e){ if(e.target.dataset.c) insertCmd(e.target.dataset.c); });
document.querySelectorAll('.topt').forEach(function(opt){
  opt.addEventListener('click',function(){ pendT=opt.dataset.t; gi('ctrig').value=pendT; syncTG(pendT); updateWarn(pendT); updateInfo(pendT); });
});
on('ctrig','input',function(e){ var t=e.target.value; if(!t) return; pendT=t; syncTG(t); updateWarn(t); updateInfo(t); });
document.addEventListener('click',function(e){
  var m=gi('ctx-menu'), fm=gi('fctx-menu'), em=gi('ectx-menu');
  if(m&&!m.contains(e.target)&&fm&&!fm.contains(e.target)&&em&&!em.contains(e.target)) closeCtxMenu();
});
document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeCtxMenu(); });
document.addEventListener('scroll',function(){ closeCtxMenu(); },true);

// Empty-area right-click on sidebar
var sbList=gi('folder-list'); if(sbList) sbList.addEventListener('contextmenu',function(e){
  if(e.target.closest('.folder-item')) return;
  e.preventDefault(); showEmptyCtxMenu(e.clientX,e.clientY);
});
// Empty-area right-click on snippet list
var sList=gi('list'); if(sList) sList.addEventListener('contextmenu',function(e){
  if(e.target.closest('.item')) return;
  e.preventDefault(); showEmptyCtxMenu(e.clientX,e.clientY);
});

// Changelog events
var vbtn = gi('ver-btn');
if(vbtn) vbtn.addEventListener('click', openChangelog);
var clx = gi('cl-x');
if(clx) clx.addEventListener('click', closeChangelog);
var clbg = gi('cl-bg');
if(clbg) clbg.addEventListener('click', function(e){ if(e.target===clbg) closeChangelog(); });


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
var LNAMES = {EN:'English',ES:'Español',IT:'Italiano',FR:'Français'};
var LANGS = ['EN','ES','IT','FR'];

function findVariants(snip){
  if(!snip) return {};
  var gid = snip.lang_group_id || snip.id;
  var v = {};
  snips.forEach(function(s){ if((s.lang_group_id||s.id)===gid) v[s.lang]=s; });
  return v;
}

function addLangVariant(targetLang){
  var src = findSnip(selId||''); if(!src){ showToast('Select a snippet first'); return; }
  var v = findVariants(src);
  if(v[targetLang]){ showToast('Already exists — click the pill to switch'); return; }
  var gid = src.lang_group_id || src.id;
  var ns = {
    id: uid(),
    title: src.title.replace(/\s*(EN|ES|IT|FR)$/, '') + ' ' + targetLang,
    shortcut: src.shortcut.replace(/(EN|ES|IT|FR)$/, targetLang),
    body: src.body, lang: targetLang, folder: src.folder,
    fieldCfg: JSON.parse(JSON.stringify(src.fieldCfg||{})),
    lang_group_id: gid, sort_order: snips.length + 1,
    enable_urgency_timer: src.enable_urgency_timer || false,
    timer_duration_ms: src.timer_duration_ms || 0,
    scarcity_count: src.scarcity_count || 0,
    stats: {uses:0, fills:0, lastUsed:null}
  };
  snips.push(ns);
  DB.upsertSnippet(ns);
  DB.updateStats(ns.id, 0, 0, null);
  selId = ns.id;
  openEd(ns.id);
  showToast(LNAMES[targetLang] + ' version created — edit it now!');
}

function showLangPicker(snip){
  if(!snip) return;
  var v = findVariants(snip);
  var vc = Object.keys(v).length;
  gi('lp-ttl').textContent = vc > 1 ? 'Which language?' : 'No variants yet';
  gi('lp-sub').textContent = vc > 1 ? snip.title + ' — ' + vc + ' versions' : 'Add from Edit view';
  var grid = gi('lp-grid'); var h = ''; var sel = snip.lang;
  var colors = {EN:'var(--en)',ES:'var(--es)',IT:'var(--it)',FR:'#7c3aed'};
  LANGS.forEach(function(l){
    var vs = v[l]; var isCur = snip.lang === l;
    h += '<div class="lp-opt'+(vs?' lp-has':'')+(isCur?' lp-sel':'')+(vs?'':' lp-dis')+'" data-lang="'+l+'" data-id="'+(vs?vs.id:'')+'">'
      +'<div class="lp-dot" style="color:'+(colors[l]||'var(--tx2)')+'">'+l+'</div>'
      +'<span class="lp-nm">'+LNAMES[l]+(vs?' ✓':'')+'</span></div>';
  });
  grid.innerHTML = h;
  grid.querySelectorAll('.lp-opt.lp-has').forEach(function(opt){
    opt.addEventListener('click', function(){
      sel = opt.dataset.lang;
      grid.querySelectorAll('.lp-opt').forEach(function(o){o.classList.remove('lp-sel');});
      opt.classList.add('lp-sel');
    });
  });
  gi('lp-ok').onclick = function(){
    gi('lp-bg').className = 'lp-bg';
    var target = v[sel];
    if(target){
      var sc = target.shortcut || '';
      try{ navigator.clipboard.writeText(sc); }catch(e){}
      if(!target.stats) target.stats = {uses:0,fills:0,lastUsed:null};
      target.stats.uses = (target.stats.uses||0)+1;
      target.stats.lastUsed = new Date().toISOString();
      DB.updateStats(target.id, target.stats.uses, target.stats.fills, target.stats.lastUsed);
      var nm = gi('iname-'+target.id);
      var orig = nm ? nm.textContent : target.title;
      if(nm){ nm.textContent = '✓ ' + sc + ' copied!'; setTimeout(function(){if(nm)nm.textContent=orig;},1600); }
    }
  };
  gi('lp-bg').className = 'lp-bg on';
}

function showToast(msg){
  var t=gi('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; t.style.cssText='position:fixed;bottom:12px;left:50%;transform:translateX(-50%);background:#333;color:#fff;padding:6px 14px;border-radius:8px;font-size:11px;z-index:9999;opacity:0;transition:opacity .3s'; document.body.appendChild(t); }
  t.textContent=msg; t.style.opacity='1';
  setTimeout(function(){ t.style.opacity='0'; },2000);
}

var lpCancel=gi('lp-cancel'); if(lpCancel) lpCancel.addEventListener('click', function(){ var bg=gi('lp-bg'); if(bg) bg.className='lp-bg'; });
var lpBg=gi('lp-bg'); if(lpBg) lpBg.addEventListener('click', function(e){ if(e.target===lpBg) lpBg.className='lp-bg'; });

// TRIGGER CONFIG EVENTS
on('tcfg-snip','change', function(e){
  var v=e.target.value.trim(); var st=gi('tcfg-snip-st');
  if(!validateTriggerSeq(v)){ e.target.style.borderColor='#c0392b'; if(st){st.textContent='Invalid';st.style.color='#c0392b';} return; }
  if(triggerWouldCollide('snippetTrigger',v)){ e.target.style.borderColor='#c0392b'; if(st){st.textContent='Collides';st.style.color='#c0392b';} return; }
  e.target.style.borderColor=''; setTriggerCfgValue('snippetTrigger',v);
  if(st){st.textContent='Saved';st.style.color='#3B6D11';setTimeout(function(){st.textContent='';},2000);}
});
on('tcfg-prompt','change', function(e){
  var v=e.target.value.trim(); var st=gi('tcfg-prompt-st');
  if(!validateTriggerSeq(v)){ e.target.style.borderColor='#c0392b'; if(st){st.textContent='Invalid';st.style.color='#c0392b';} return; }
  if(triggerWouldCollide('promptTrigger',v)){ e.target.style.borderColor='#c0392b'; if(st){st.textContent='Collides';st.style.color='#c0392b';} return; }
  e.target.style.borderColor=''; setTriggerCfgValue('promptTrigger',v);
  if(st){st.textContent='Saved';st.style.color='#3B6D11';setTimeout(function(){st.textContent='';},2000);}
});
on('tcfg-snip-key','change', function(e){ setTriggerCfgValue('snippetActivationKey',e.target.value); });
on('tcfg-prompt-key','change', function(e){ setTriggerCfgValue('promptActivationKey',e.target.value); });
on('notion-key','change', function(e){ notionCfg.apiKey=e.target.value.trim(); saveNotionCfg(); updateNotionStatus(); });
on('notion-db','change', function(e){ notionCfg.dbId=e.target.value.trim(); saveNotionCfg(); updateNotionStatus(); });

function updateNotionStatus(){
  var st=gi('notion-st');
  if(st){ st.textContent=notionCfg.apiKey&&notionCfg.dbId?'Connected':''; st.style.color=notionCfg.apiKey&&notionCfg.dbId?'#3B6D11':'#c0392b'; }
}

// Paste handlers for popup inputs
on('sq','paste', function(){ setTimeout(function(){ renderList(gi('sq')?gi('sq').value:''); },0); });
on('ewrd','paste', function(){ setTimeout(updateSprev,0); });

boot();
