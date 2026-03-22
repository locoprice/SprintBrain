// SPRINTBRAIN POPUP v5.0 - Supabase cloud sync

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

// BOOT
function boot(){
  refreshUI();
  loadTrigger(function(){
    var tp=gi('tp'); if(tp) tp.textContent=trig;
    var he=gi('hint-ex'); if(he) he.textContent=trig+'quoteEN';
    var sp=gi('spfx'); if(sp) sp.textContent=trig;
  });
  var st=gi('st'); if(st) st.textContent='\u25CF Syncing\u2026';
  DB.loadAll().then(function(data){
    if(data && data.snippets && data.snippets.length>0){
      snips=data.snippets;
      folders=data.folders&&data.folders.length>0?data.folders:DEFAULT_FOLDERS;
    } else {
      // Seed Supabase on first run
      DEFAULT_FOLDERS.forEach(function(f){ DB.upsertFolder(f); });
      DEFAULT_SNIPPETS.forEach(function(s){ DB.upsertSnippet(s); DB.updateStats(s.id,0,0,null); });
    }
    refreshUI();
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

function renderFolders(){
  var el=gi('folder-list'); if(!el) return;
  var h='<div class="folder-item'+(selFolder==='ALL'?' on':'')+'" data-fid="ALL"><span class="folder-ico">\u25C8</span><span class="folder-name">All snippets</span><span class="folder-count">'+snips.length+'</span></div>';
  for(var i=0;i<folders.length;i++){
    var f=folders[i];
    h+='<div class="folder-item'+(selFolder===f.id?' on':'')+'" data-fid="'+f.id+'"><span class="folder-ico">'+esc(f.ico||'\uD83D\uDCC1')+'</span><span class="folder-name">'+esc(f.name)+'</span><span class="folder-count">'+folderCount(f.id)+'</span></div>';
  }
  el.innerHTML=h;
  el.querySelectorAll('.folder-item').forEach(function(row){
    row.addEventListener('click',function(){
      selFolder=row.dataset.fid; renderFolders();
      renderList(gi('sq')?gi('sq').value:'');
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

function openEd(id){
  editId=id||null;
  var s=id?findSnip(id):null;
  gi('edhdr').textContent=s?'Edit Snippet':'New Snippet';
  gi('etit').value=s?(s.title||''):'';
  var full=s?(s.shortcut||''):'';
  gi('ewrd').value=full.indexOf(trig)===0?full.slice(trig.length):full;
  gi('spfx').textContent=trig;
  gi('elng').value=s?(s.lang||'EN'):'EN';
  gi('efolder').innerHTML=buildFolderOpts(s?(s.folder||''):(selFolder!=='ALL'?selFolder:''));
  gi('ebdy').value=s?(s.body||''):'';
  gi('bdel').style.display=s?'block':'none';
  // Urgency fields
  var urgOn = s ? !!s.enable_urgency_timer : false;
  var urgDur = s && s.timer_duration_ms ? Math.round(s.timer_duration_ms / 60000) : 30;
  var urgSc = s && s.scarcity_count ? s.scarcity_count : 0;
  gi('eurg').checked = urgOn;
  gi('eurg-dur').value = urgDur;
  gi('eurg-sc').value = urgSc;
  gi('urg-fields').style.display = urgOn ? '' : 'none';
  gi('sok').className='saveok';
  updateSprev();
  show('pane-ed');
  setTimeout(function(){ gi('etit').focus(); },50);
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

function closeCtxMenu(){ var m=gi('ctx-menu'); if(m) m.className='ctx-menu'; }

gi('ctx-duplicate').addEventListener('click',function(){
  var s=findSnip(ctxId); if(!s) return;
  var copy=JSON.parse(JSON.stringify(s)); copy.id=uid(); copy.title='Copy of '+copy.title; copy.shortcut+='2'; copy.stats={uses:0,fills:0,lastUsed:null};
  snips.splice(snips.indexOf(s)+1,0,copy); DB.upsertSnippet(copy); DB.updateStats(copy.id,0,0,null);
  refreshUI(); closeCtxMenu();
});
gi('ctx-rename').addEventListener('click',function(){ closeCtxMenu(); startInlineRename(ctxId); });
gi('ctx-delete').addEventListener('click',function(){
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
  pendFolderCb=cb||null; selIco='\uD83D\uDCC1';
  gi('folder-name-inp').value='';
  document.querySelectorAll('.ico-opt').forEach(function(el){ el.className='ico-opt'+(el.dataset.ico===selIco?' on':''); });
  gi('folder-modal').className='modal-overlay on';
  setTimeout(function(){ gi('folder-name-inp').focus(); },50);
}
function closeFolderModal(){ gi('folder-modal').className='modal-overlay'; pendFolderCb=null; }

gi('folder-save').addEventListener('click',function(){
  var name=(gi('folder-name-inp').value||'').trim(); if(!name){ shake('folder-name-inp'); return; }
  var nf={id:fuid(),name:name,ico:selIco,sort_order:folders.length+1};
  folders.push(nf); DB.upsertFolder(nf);
  if(pendFolderCb) pendFolderCb(nf.id);
  closeFolderModal(); refreshUI();
});
gi('folder-cancel').addEventListener('click',closeFolderModal);
gi('folder-modal').addEventListener('click',function(e){ if(e.target===gi('folder-modal')) closeFolderModal(); });
gi('folder-name-inp').addEventListener('keydown',function(e){ if(e.key==='Enter') gi('folder-save').click(); if(e.key==='Escape') closeFolderModal(); });
document.getElementById('ico-picker').addEventListener('click',function(e){
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
gi('bnew').addEventListener('click',   function(){ openEd(null); });
gi('bnew2').addEventListener('click',  function(){ openEd(null); });
gi('btn-new-folder').addEventListener('click', function(){ openFolderModal(null); });
gi('bbed').addEventListener('click',   function(){ show('pane-list'); refreshUI(); });
gi('bcan').addEventListener('click',   function(){ show('pane-list'); refreshUI(); });
gi('bsav').addEventListener('click',   doSave);
gi('bdel').addEventListener('click',   doDel);
gi('bcfg').addEventListener('click',   openCfg);
gi('bbcfg').addEventListener('click',  function(){ show('pane-list'); refreshUI(); });
gi('bcct').addEventListener('click',   function(){ show('pane-list'); refreshUI(); });
gi('bappt').addEventListener('click',  applyTrig);
gi('brel').addEventListener('click',   function(){
  var st=gi('st'); if(st) st.textContent='\u25CF Reloading\u2026';
  DB.loadAll().then(function(data){
    if(data&&data.snippets&&data.snippets.length>0){ snips=data.snippets; if(data.folders&&data.folders.length>0) folders=data.folders; }
    refreshUI();
  });
});
gi('sq').addEventListener('input',    function(e){ renderList(e.target.value); });
gi('ewrd').addEventListener('input',  updateSprev);
gi('ebdy').addEventListener('keydown',function(e){ if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();doSave();} });
gi('eurg').addEventListener('change', function(){ gi('urg-fields').style.display = gi('eurg').checked ? '' : 'none'; });
var cmdGrid=document.querySelector('.cmd-grid'); if(cmdGrid) cmdGrid.addEventListener('click',function(e){ if(e.target.dataset.c) insertCmd(e.target.dataset.c); });
document.querySelectorAll('.topt').forEach(function(opt){
  opt.addEventListener('click',function(){ pendT=opt.dataset.t; gi('ctrig').value=pendT; syncTG(pendT); updateWarn(pendT); updateInfo(pendT); });
});
gi('ctrig').addEventListener('input',function(e){ var t=e.target.value; if(!t) return; pendT=t; syncTG(t); updateWarn(t); updateInfo(t); });
document.addEventListener('click',function(e){ var m=gi('ctx-menu'); if(m&&!m.contains(e.target)) closeCtxMenu(); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape') closeCtxMenu(); });

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

gi('lp-cancel').addEventListener('click', function(){ gi('lp-bg').className = 'lp-bg'; });
gi('lp-bg').addEventListener('click', function(e){ if(e.target===gi('lp-bg')) gi('lp-bg').className = 'lp-bg'; });

boot();
