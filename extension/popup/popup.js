// SPRINTBRAIN POPUP v2.17.0 — Dashboard SSO + email-OTP fallback (AUTH-EXT-002)

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
            notion_page_id: s.notion_page_id || null,
            manually_edited: s.manually_edited || false,
            ai_generated: s.ai_generated || false,
            stats: { uses: st.uses || 0, fills: st.fills || 0, lastUsed: st.last_used || null }
          };
        })
      };
    }).catch(function(e) { console.warn('[Sprintbrain] loadAll:', e); return null; });
  },
  upsertSnippet: function(s) {
    supaFetch('snippets', 'POST', {
      id: s.id, user_id: SB_CURRENT_USER_ID, title: s.title, shortcut: s.shortcut || '',
      body: s.body || '', lang: s.lang || 'EN',
      folder_id: s.folder || null, field_cfg: s.fieldCfg || {}, lang_group_id: s.lang_group_id || s.id,
      sort_order: s.sort_order || 0,
      enable_urgency_timer: s.enable_urgency_timer || false,
      timer_duration_ms: s.timer_duration_ms || 0,
      scarcity_count: s.scarcity_count || 0,
      notion_page_id: s.notion_page_id || null,
      manually_edited: s.manually_edited || false,
      ai_generated: s.ai_generated || false
    }).catch(function(e) { console.warn('upsertSnippet:', e); });
  },
  deleteSnippet: function(id) {
    supaFetch('snippets', 'DELETE', null, 'id=eq.' + id).catch(function(e) { console.warn(e); });
  },
  upsertFolder: function(f) {
    supaFetch('folders', 'POST', {
      id: f.id, user_id: SB_CURRENT_USER_ID, name: f.name, ico: f.ico || 'folder', sort_order: f.sort_order || 0
    }).catch(function(e) { console.warn('upsertFolder:', e); });
  },
  deleteFolder: function(id) {
    supaFetch('folders', 'DELETE', null, 'id=eq.' + id).catch(function(e) { console.warn('deleteFolder:', e); });
  },
  updateStats: function(snippetId, uses, fills, lastUsed) {
    supaFetch('snippet_stats', 'POST', {
      snippet_id: snippetId, user_id: SB_CURRENT_USER_ID, uses: uses, fills: fills, last_used: lastUsed
    }).catch(function(e) { console.warn('updateStats:', e); });
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

var DEFAULT_SNIPPETS = [
  // ── PRESUPUESTOS ──────────────────────────────────────────────────
  {id:'quoteEN', shortcut:'::quoteEN', title:'ESTIMATE B2C ver. 3.6', lang:'EN', cat:'PRESUPUESTOS',
   body:'\uD83D\uDCCB QUOTATION SENT h.[TIME_HH:MM] \u00B7 [DATE_DD/MM/YYYY]\nValid for 3 hours.\n\nYour request: [ENQUIRE_FORM]\n\uD83D\uDD17Property: https://www.leibtour.com/stays/\n\nCheck-in: [CHECKIN DD/MM/YYYY]\nCheck-out: [CHECKOUT DD/MM/YYYY]\n\nRoom: Studio (no terrace)\nCala Llonga area\nRate Plan: NOT Refundable - always cheaper\nPayment methods: Credit / Debit card +3%\n\n\u2605 Your Price: [YOUR_PRICE]\u20AC (extra savings when you choose how to pay)\n\n- Bank Transfer: [YOUR_PRICE - 25]\u20AC \u2764\uFE0F Loved by our guests\n- Card: [YOUR_PRICE \u00D7 1.03]\u20AC\n\nOriginal Accommodation Price: [OTA_PRICE]\u20AC\n\u2713 You save: [OTA_PRICE - YOUR_PRICE]\u20AC\n\u2713 You also save: OTA service fees (typically 12-18%)\n\u2713 Discount codes: Not valid\n\u2713 Payment terms: Full payment upon confirmation\n\nCANCELLATION POLICY\n\u26A0\uFE0F NON-REFUNDABLE \u2014 Generally offer a lower price compared to refundable fares, but they come with stricter cancellation policies.\n\n\uD83D\uDCCE Full cancellation terms \u2192 leibtour.com/policy\n\u2753 FAQ & booking process \u2192 leibtour.com/faqs/booking-process\n\nNote:\n1. Only 1 unit(s) left at this rate. The price will increase.\n2. COMBO DEALS: book the accommodation and save on Car Hire: zero excess, zero deposit, full insurance.'},
  {id:'quoteES', shortcut:'::quoteES', title:'PRESUPUESTO B2C', lang:'ES', cat:'PRESUPUESTOS',
   body:'\uD83D\uDCCB PRESUPUESTO ENVIADO h.[HH:mm] \u00B7 [DD/MM/YYYY]\nV\u00E1lido por 3 horas.\n\nTu solicitud: [ENQUIRE_FORM]\n\uD83D\uDD17Alojamiento: https://www.leibtour.com/stays/\n\nCheck-in: [CHECKIN]\nCheck-out: [CHECKOUT]\n\nHabitaci\u00F3n: Estudio (sin terraza) zona Cala Llonga\nTarifa: NO Reembolsable - siempre m\u00E1s barata\nM\u00E9todos de pago: Tarjeta de cr\u00E9dito / d\u00E9bito +3%\n\nPrecio original del alojamiento: [OTA_PRICE]\u20AC\n\u2605 Tu precio: [YOUR_PRICE]\u20AC\n\u2713 Ahorras: [OTA_PRICE - YOUR_PRICE]\u20AC\n\u2713 Tambi\u00E9n ahorras: comisiones de servicio OTA (normalmente 12-18%)\n\u2713 C\u00F3digos de descuento: No v\u00E1lidos\n\u2713 Condiciones de pago: Pago completo a la confirmaci\u00F3n\n\nOPCIONES DE PAGO\n- Transferencia bancaria: [YOUR_PRICE - 25]\u20AC \u2764\uFE0F La preferida por nuestros hu\u00E9spedes\n- Tarjeta: [YOUR_PRICE \u00D7 1.03]\u20AC\n\nPOL\u00CDTICA DE CANCELACI\u00D3N\n\u26A0\uFE0F NO REEMBOLSABLE \u2014 Precio m\u00E1s bajo. Pago inmediato. Sin cancelaci\u00F3n.\n\n\uD83D\uDCCE Condiciones completas de cancelaci\u00F3n \u2192 leibtour.com/policy\n\u2753 Preguntas frecuentes \u2192 leibtour.com/faqs/booking-process\n\nNota:\n1. Solo queda 1 unidad a esta tarifa. Tarifas din\u00E1micas, el precio subir\u00E1.\n2. COMBO DEALS: reserva el alojamiento y ahorra en tambi\u00E9n en alquiler de Coche: sin franquicia, sin dep\u00F3sito, seguro a todo riesgo incluido.'},
  {id:'quoteIT', shortcut:'::quoteIT', title:'PREVENTIVO B2C', lang:'IT', cat:'PRESUPUESTOS',
   body:'\uD83D\uDCCB PREVENTIVO INVIATO \uD83D\uDD51 [HH:mm] \u00B7 [DD/MM/YYYY]\nValido per 3 ore.\n\nLa tua richiesta: [ENQUIRE_FORM]\n\uD83D\uDD17Alloggio: https://www.leibtour.com/stays/\n\nCheck-in: [CHECKIN]\nCheck-out: [CHECKOUT]\n\nCamera: Monolocale (senza terrazza) zona Cala Llonga\nTariffa: NON Rimborsabile - sempre pi\u00F9 conveniente\nMetodi di pagamento: Carta di credito / debito +3%\n\nPrezzo originale: [OTA_PRICE]\u20AC\n\u2605 La tua tariffa: [YOUR_PRICE]\u20AC\n\u2713 Risparmi: [OTA_PRICE - YOUR_PRICE]\u20AC\n\u2713 Risparmi anche: commissioni di servizio OTA (solitamente 12-18%)\n\u2713 Codici sconto: Non validi\n\u2713 Condizioni di pagamento: Pagamento completo alla conferma\n\nOPZIONI DI PAGAMENTO\n- Bonifico: [YOUR_PRICE - 25]\u20AC \u2764\uFE0F Preferito dai nostri ospiti\n- Carta: [YOUR_PRICE \u00D7 1.03]\u20AC\n\nPOLITICA DI CANCELLAZIONE\n\u26A0\uFE0F NON RIMBORSABILE \u2014 Prezzo pi\u00F9 basso, cancellazione non consentita.\n\n\uD83D\uDCCE Condizioni complete di cancellazione \u2192 leibtour.com/policy\n\u2753 FAQ \u2192 leibtour.com/faqs/booking-process\n\nNote:\n- Ultima unit\u00E0 disponibile. Tariffa dinamica, il prezzo salir\u00E0.\n- COMBO DEALS prenota l\'alloggio e risparmia anche su noleggio auto: nessuna franchigia, zero deposito, assicurazione casco inclusa.'},
  {id:'neob', shortcut:'::neob', title:'NEO BOOKING', lang:'ES', cat:'PRESUPUESTOS',
   body:'Buenos d\u00EDas [NOMBRE_PROVEEDOR]:\n\nSoy Valentina y paso otra reserva LeibTour \uD83C\uDF89\n\nSi necesitais cualquier cosa estoy a completa disposici\u00F3n :)\n\nSi el cliente rellena el formulario Real Decreto os envio su DNI/Pasaporte para hacer un pre-checkin.\n\nNecesitar\u00EDamos factura por favor.\n\nEl cliente debe ecotasa y sabe que tiene que abonarla a su llegada.\n\nPosiblemente darles a los huespedes una buena habitacion en la planta mas alta disponible :)\n\nEn cuanto a la configuraci\u00F3n de las camas, son amigos, por lo tanto necesitan camas individuales \uD83D\uDECF\uFE0F\uD83D\uDECF\uFE0F\n\nHasta la pr\u00F3xima reserva \u2661'},
  {id:'locoprice', shortcut:'::locoprice', title:'CLIENTE CERCA ACCOMMODATION', lang:'MULTI', cat:'PRESUPUESTOS',
   body:'I suggest you find something online and share the link with us. We can offer you a B2B quotation on any accommodation worldwide: https://www.locoprice.com/better-price/.\n\nShare any offer you might find online, and we will provide you with a better B2B quotation for any accommodation worldwide.\n\n---\n\nTi suggerisco di cercare qualcosa online e di mandarmi il link. Possiamo offrirti un preventivo B2B per qualsiasi tipo di alloggio in tutto il mondo: https://www.locoprice.com/better-price/.\n\n---\n\nTe aconsejo que busque algo por internet y nos comparta el enlace. Podemos ofrecerte una cotizaci\u00F3n B2B en cualquier alojamiento a nivel mundial: https://www.locoprice.com/better-price/'},
  // ── RESERVATION MGMT ──────────────────────────────────────────────
  {id:'followup', shortcut:'::followup', title:'FOLLOW UP', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hey there! Any update for me? Did you finally book your accommodation in Ibiza? Please let me know since I have several properties around the island :D\n\nI will be more than happy to assist you.\n\nRegards\n\n---\n\n\u00A1Hola! \u00BFTienes alguna novedad para m\u00ED? \u00BFFinalmente reservaste tu alojamiento en Ibiza? Por favor, av\u00EDsame ya que tengo varias propiedades en la isla :D\n\nEstar\u00E9 m\u00E1s que encantado de ayudarte.\n\nSaludos\n\n---\n\nCiao! Hai qualche novit\u00E0 per me? Hai finalmente prenotato il tuo alloggio a Ibiza? Fammi sapere :D\n\nCerca sul web Leibtour (pagina Contatti) e sar\u00F2 pi\u00F9 che felice di aiutarti...\n\nUn saluto'},
  {id:'cal', shortcut:'::cal', title:'CALENDAR AND PRICE NO UPDATE', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hola :)\nPara evitar cualquier malentendido y asegurar que tengas la mejor experiencia, te explicamos en detalle c\u00F3mo funciona nuestro proceso de reserva...\n\n### VERY IMPORTANT \u2013 PLEASE READ!\n\n\u260E Before sending your booking request ALWAYS CONTACT US to check availability\n\uD83D\uDECF\uFE0F The look of the apartment can be slightly different from the images\n\u26D4 Do NOT pay for the reservation before confirming with us\n\uD83D\uDCC5 Our calendars are almost always open because we have alternative properties available\n\u2600 During high summer season many accommodations have a variable minimum stay\n\n---> Por estos motivos LeibTour NO TRABAJA con reservas inmediata sino solo bajo petici\u00F3n!\n---> 100% normal: Mira porfa los terminos y condiciones\n---> Te aconsejo que vuelvas a buscar activando el filtro solo de las propiedades con "reservas inmediatas" en 2 clicks te ahorras mucho tiempo ;)'},
  {id:'notavail', shortcut:'::notavail', title:'NO DISPONIBILIT\u00C0', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hi. Unfortunately, the accommodation you selected is not available. However, I can suggest an alternative option.\n\n---\n\nHola. Lamentablemente, no tenemos disponibilidad para las fechas seleccionadas. Sin embargo, puedo ofrecerte una opci\u00F3n alternativa. Estaba mirando ahora la disponibilidad y en tus fechas este apartamento esta vendido :(. Si quieres, te miro la disponibilidad por otro apartamento pero no lo tenemos publicado en airbnb (solo Leibtour).\n\nHazme saber\n\nEspero noticias\n\nLeibtour Team\n\n---\n\nCiao. Purtroppo non abbiamo disponibilit\u00E0 per le date selezionate. Tuttavia, posso proporti un\'opzione alternativa.'},
  {id:'price', shortcut:'::price', title:'PREZZO NON AGGIORNATO', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Dear (___) the price displayed is not up to date.\nIf you wish to proceed, please withdraw your current booking request.\n[I will then update the price and you\'ll be able to resubmit your booking request with the correct amount.] / [Then I will send you the offer with the updated price.]\n\n---\n\nQuerido (___) el precio mostrado no est\u00E1 actualizado. Si deseas proceder con la reserva, por favor retira primero la solicitud.\n[Luego podr\u00E1s volver a enviar la solicitud de reserva con el importe correcto.] / [Luego te enviar\u00E9 la oferta con el precio actualizado.]\n\n---\n\nCaro (___) il prezzo non \u00E8 aggiornato. Se desideri procedere con la prenotazione, ti prego di ritirare prima la richiesta. [Dopo aver corretto il prezzo, potrai inviare nuovamente la richiesta.] / [Successivamente ti invier\u00F2 l\'offerta con il prezzo aggiornato.]'},
  {id:'time', shortcut:'::time', title:'TIME', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Dear ### I\'ll get back to you shortly, I still need to check the quotation and availability... Now I\'m busy with another guest on LeibTour who is booking for tomorrow. Ok? thanks for your patience \u263A\uFE0F\n\n---\n\nQuerido ###, enseguida te respondo, todav\u00EDa tengo que averiguar el precio y la disponibilidad... Ahora estoy ocupada con otro hu\u00E9sped en LeibTour que est\u00E1 reservando para ma\u00F1ana. \u00BFDe acuerdo? Gracias por tu paciencia \u263A\uFE0F\n\n---\n\nCaro ###, ti rispondo a breve, devo ancora verificare se il prezzo e la disponibilit\u00E0 sono corretti... Adesso sono impegnata con un altro ospite su LeibTour che sta prenotando per domani. Va bene? Grazie per la tua pazienza \u263A\uFE0F'},
  {id:'withdraw', shortcut:'::withdraw', title:'RITIRARE LA RICHIESTA', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Kindly withdraw your current booking request so Airbnb can release the pending balance pre-authorized on your account. I can\'t do it because I don\'t have the permissions and my boss is not in the office now.\n\nThe refund is instant. For any questions regarding the payment contact Airbnb guest support since we didn\'t accept the reservation and we don\'t handle payments.\n\nYou can withdraw your booking request directly from your Airbnb account. Simply go to the reservation settings and you will find the option to cancel your pending request.\n\n---\n\nDe todos modos, puedes retirar la solicitud pendiente en cualquier momento para que Airbnb te desbloquee el importe. No puedo hacerlo yo porque no tengo los permisos y mi jefe no se encuentra en la ofi ahora.\n\nLa devolucion es instant\u00E1nea. Para cualquier pregunta relacionada con el pago contacta directamente con la asistencia de Airbnb.\n\n---\n\nIn ogni caso puoi ritirare la richiesta di prenotazione in qualsiasi momento, Airbnb ti restituir\u00E0 subito l\'importo pre-autorizzato. Il rimborso \u00E8 istantaneo.'},
  {id:'altern', shortcut:'::altern', title:'ALTERNATIVA', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'1) Alternativa 2 unit\u00E0:\n\nBefore we proceed, may I ask if you would be open to considering the option of splitting your group into two separate units?\n---\n\u00BFEstar\u00EDas disponible para valorar la opci\u00F3n de dividirse en dos unidades?\n---\nSaresti disponibile a valutare la possibilit\u00E0 di dividervi in due unit\u00E0?\n\n2) Alternativa stessa zona o altra zona:\n\nMay I ask if you are looking for something in the same area or if you would also consider another zone?\n---\n\u00BFPuedo preguntarte si est\u00E1s buscando algo en la misma zona o si tambi\u00E9n considerar\u00EDas otra \u00E1rea?\n---\nPosso chiederti se stai cercando qualcosa nella stessa zona o se prenderesti in considerazione anche un\'altra area?'},
  {id:'budgetstay', shortcut:'::budgetstay', title:'BUDGET STAY - NO A/C', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Before we proceed with your booking, could you please confirm that you\'ve read and understood this is a budget studio/one (1) bedroom apartment without air conditioning?\n\n\u261D VERY IMPORTANT \u261D\nThis is a budget accommodation so be prepared to find a modest but comfortable place. The average price per night in this area is more than double. You are saving a lot of money :)\n\n---\n\nPrima di procedere con la tua prenotazione, puoi confermare che si tratta di uno studio economico senza aria condizionata?\n\n\u261D IMPORTANTE \u261D\nEssendo un alloggio modesto, preparati a trovare un luogo semplice ma confortevole. Stai risparmiando un botto di soldi :)\n\n---\n\nAntes de continuar con tu reserva, \u00BFpuedes confirmar que se trata de un estudio econ\u00F3mico sin aire acondicionado?\n\n\u261DMUY IMPORTANTE \u261D\nSe trata de un alojamiento modesto. El precio medio por noche en esta zona es m\u00E1s del doble. Est\u00E1s ahorrando un paston :)'},
  {id:'minstay', shortcut:'::minstay', title:'MINIMUM STAY', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'For the selected property, there is a minimum stay requirement of several nights. If your dates are flexible or if you\'re interested, I\'d be happy to suggest some alternative options.\n\n---\n\nPara el alojamiento que has elegido, hay un requisito de estancia m\u00EDnima de varias noches. Si tus fechas no cumplen con este requisito, puedo proponerte alternativas similares. \u00BFTe gustar\u00EDa que te env\u00EDe otras opciones?\n\n---\n\nPer la struttura che hai scelto \u00E8 previsto un soggiorno minimo di pi\u00F9 notti. Se le tue date non rispettano questo requisito, posso comunque proporti alternative simili. Vuoi che ti invii altre opzioni?'},
  {id:'discount', shortcut:'::discount', title:'DISCOUNT', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'Hello! Thank you very much for your request! I have availability and I can accept you.\nBefore doing so, I just wanted to ask if you are interested in getting a small discount on your Airbnb booking. In that case, please look me up online as Leibtour (Contact Us) as soon as possible. Otherwise, I will go ahead and accept the pending request.\n\nSince we are a company based in Ibiza, I can also offer my guests exclusive rates on car, motorbike, and bicycle rentals, as well as ferry tickets to Formentera and all other excursions, activities, and entrances to Ibiza\'s clubs.\n\nP.S. Simply add my listing to your Airbnb favorites by clicking on the little heart in the upper right corner of the ad ;) Best regards.\n\n---\n\nHola! Muchas gracias por tu solicitud! Tengo disponibilidad y puedo aceptarte.\nAntes de hacerlo, \u00BFest\u00E1s interesado en conseguir un descuentillo en la reserva de Airbnb? B\u00FAscame en la web como Leibtour (Contact Us) lo antes posible. De lo contrario, aceptar\u00E9 la solicitud pendiente.\n\n---\n\nCiao! Grazie mille per la tua richiesta! Ho disponibilit\u00E0 e posso accettarti.\nPrima di farlo, sei interessato ad ottenere un piccolo sconto sulla prenotazione di Airbnb? Cercami sul web come Leibtour (Contact Us) il prima possibile.'},
  {id:'forms', shortcut:'::forms', title:'JOT FORM', lang:'ES', cat:'RESERVATION MGMT',
   body:'Porfa rellena el siguiente formulario https://www.leibtour.com/car-rental/car-quotations/ y en la mayor brevedad te enviaremos un par de presupuestos.'},
  {id:'salb2b', shortcut:'::salb2b', title:'SALUDOS B2B', lang:'ES', cat:'RESERVATION MGMT',
   body:'\u2605 Muchas gracias y hasta pronto.\n\n\u2605\u2605 Gracias por tu ayuda y colaboracion, espero verte pronto. Un fuerte abrazo.\n\n\u2605\u2605\u2605 Con todo mi corazon mil gracias \u2665 Es un verdadero placer trabajar con gente como tu. Te mando un fuerte abrazo!!!\n\n1. Quedo a vuestra disposici\u00F3n para cualquier consulta. \u00A1Muchas gracias por vuestra colaboraci\u00F3n!\n2. Como siempre, agradecemos vuestra profesionalidad.\n3. Gracias por la atenci\u00F3n. Quedamos a la espera de vuestra confirmaci\u00F3n.\n4. Os agradecemos la colaboraci\u00F3n de siempre.\n5. Muchas gracias por gestionar esta reserva con la eficiencia de siempre. \u00A1Un saludo cordial!\n6. Agradecemos vuestra r\u00E1pida gesti\u00F3n.\n7. Como siempre, es un placer trabajar con vosotros.\n8. Gracias por vuestra disponibilidad y profesionalidad.\n9. Os enviamos un cordial saludo y agradecemos vuestra excelente colaboraci\u00F3n. \u00A1Hasta la pr\u00F3xima!\n10. Muchas gracias por todo. \u00A1Un abrazo del equipo LeibTour!'},
  {id:'salb2c', shortcut:'::salb2c', title:'SALUDOS B2C', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'1) Cliente ospite con noi:\nHello, how are you? Thank you for choosing us, it\'s truly a pleasure to have you as our guest. \u2764\uFE0F\uD83C\uDF89\nHola, \u00BFc\u00F3mo est\u00E1s? Gracias por elegirnos, es realmente un placer tenerte como nuestro hu\u00E9sped. \u2764\uFE0F\uD83C\uDF89\nCiao, come stai? Grazie per averci scelto, per noi \u00E8 davvero un piacere averti come ospite. \u2764\uFE0F\uD83C\uDF89\n\n2) Cliente non presente ma aperti ad ospitarlo altrove:\nHello, how are you? We would have been happy to have you as our guest, and we\'re always glad to welcome you. \uD83D\uDE09\u2764\uFE0F\nHola, \u00BFc\u00F3mo est\u00E1s? Nos habr\u00EDa encantado tenerte como hu\u00E9sped. \uD83D\uDE09\u2764\uFE0F\nCiao, come stai? Ci avrebbe fatto piacere averti come ospite. \uD83D\uDE09\u2764\uFE0F\n\n3) Cliente impossibilitato ad essere ospitato:\nHello, how are you? We\'re sorry we couldn\'t welcome you this time, but you will always be very welcome in the future. \uD83D\uDE09\u2764\uFE0F\nHola, \u00BFc\u00F3mo est\u00E1s? Lamentamos no haber podido recibirte esta vez, pero siempre ser\u00E1s muy bienvenido. \uD83D\uDE09\u2764\uFE0F\nCiao, come stai? Ci dispiace non averti potuto accogliere questa volta. \uD83D\uDE09\u2764\uFE0F'},
  {id:'address', shortcut:'::address', title:'INDIRIZZO', lang:'MULTI', cat:'RESERVATION MGMT',
   body:'You\'ll receive an automatic e-mail with GPS coordinates and full address 2 days before your arrival. For privacy and security reasons the address will be shown only after the booking.\n\nRead our FAQ: https://www.leibtour.com/faqs/booking-process/\n\n---\n\nRecibir\u00E1s un correo electr\u00F3nico con las coordenadas GPS y la direcci\u00F3n completa 2 d\u00EDas antes de tu llegada. Por razones de privacidad y seguridad, la direcci\u00F3n se mostrar\u00E1 solo despu\u00E9s de la reserva.\n\nAqui tienes las preguntas frecuentes: https://www.leibtour.com/faqs/booking-process/\n\n---\n\nRiceverai un\'e-mail automatica con le coordinate GPS e l\'indirizzo completo 2 giorni prima del tuo arrivo. Per motivi di privacy e sicurezza, l\'indirizzo sar\u00E0 mostrato solo dopo la prenotazione.\n\nLeggi le FAQ: https://www.leibtour.com/faqs/booking-process/'},
  {id:'firm', shortcut:'::firm', title:'Valenx (firma)', lang:'ES', cat:'RESERVATION MGMT',
   body:'Valentina P.\n[Reservations department LeibTour]'}
];

// STATE
var snips        = DEFAULT_SNIPPETS.slice();
var folders      = DEFAULT_FOLDERS.slice();
var trig         = '::';
var editId       = null;
var pendT        = '::';
var selFolder    = 'ALL';
var ctxId        = null;
var selId        = null;
var pendFolderCb = null;
var selIco       = 'folder';
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
// Snippets are stored in chrome.storage.local (5MB) because the array exceeds
// chrome.storage.sync's 8KB per-item limit, causing silent write failures.
// Cross-device sync is handled by Supabase, not chrome.storage.sync.
function syncSnippets(){
  try{
    chrome.storage.local.set({snippets:snips}, function(){
      if(chrome.runtime.lastError) console.warn('syncSnippets local:', chrome.runtime.lastError.message);
    });
    // Also clear any stale snippets in sync (from pre-v2.13.1 versions) so
    // content.js doesn't accidentally fall back to an out-of-date list.
    chrome.storage.sync.remove('snippets', function(){
      if(chrome.runtime.lastError) { /* ignore: key may not exist */ }
    });
  }catch(e){ console.warn('syncSnippets:',e); }
}


// ── CHANGELOG ─────────────────────────────────────────────────────
var CHANGELOG = [
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
    rel.changes.forEach(function(c) {
      h += '<div class="cl-c"><span class="cl-b '+c.type+'">'+c.type+'</span><span>'+esc(c.text)+'</span></div>';
    });
    h += '</div></div>';
  });
  body.innerHTML = h;
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

/* SVG icon map for sync bar — Lucide-style stroke icons */
var _SYNC_SVGS = {
  settings: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M2.5 22v-6h6"/><path d="M2.5 11.5a10 10 0 0 1 18.8-4.3M21.5 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  warn: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};

function _setSyncBar(icon, text, color) {
  var iconEl = document.getElementById('sb-sync-icon');
  var textEl = document.getElementById('sb-sync-text');
  if (iconEl) {
    iconEl.innerHTML = _SYNC_SVGS[icon] || _SYNC_SVGS.refresh;
    iconEl.style.color = color || '#A1A1AA';
  }
  if (textEl) {
    textEl.textContent = text;
    textEl.style.color = color || '#A1A1AA';
  }
}

function updateSyncStatus() {
  chrome.storage.local.get(
    ['sb_notion_last_sync_ts', 'sb_notion_sync_error'],
    function(d) {
      var lastSync = d && d['sb_notion_last_sync_ts'];
      var hasError = d && d['sb_notion_sync_error'];
      var hasNotion = notionCfg && notionCfg.apiKey && notionCfg.dbId;

      if (!hasNotion) {
        _setSyncBar('settings', 'Notion not configured', '#A1A1AA');
        return;
      }

      if (hasError) {
        _setSyncBar('warn', 'Sync failed \u2014 ' + _timeAgo(lastSync), '#DC2626');
        return;
      }

      if (!lastSync) {
        _setSyncBar('refresh', 'Never synced', '#6C5CE7');
        return;
      }

      var ageMs = Date.now() - new Date(lastSync).getTime();
      var ageMin = Math.floor(ageMs / 60000);

      if (ageMin < 15) {
        _setSyncBar('check', 'Synced with Notion ' + _timeAgo(lastSync), '#16A34A');
      } else if (ageMin < 30) {
        _setSyncBar('refresh', 'Synced ' + _timeAgo(lastSync), '#6C5CE7');
      } else {
        _setSyncBar('warn', 'Not synced for ' + _timeAgo(lastSync) + ' \u2014 click Sync Now', '#DC2626');
      }
    }
  );
}

// ── NOTION PUSH — App → Notion (bidirectional sync) ───────────────
var NotionPush = {

  _buildProps: function(snippet) {
    var props = {};

    props['Nome Snippet'] = {
      title: [{ text: { content: snippet.title || '' } }]
    };

    props['Shortcut'] = {
      rich_text: [{ text: { content: snippet.shortcut || '' } }]
    };

    var bodyText = (snippet.body || '').slice(0, 2000);
    if (snippet.body && snippet.body.length > 2000) {
      console.warn('[SprintBrain] Body truncated to 2000 chars for Notion:', snippet.title);
    }
    props['Body'] = {
      rich_text: [{ text: { content: bodyText } }]
    };

    if (snippet.folder) {
      // Resolve folder ID → folder name for Notion select
      var folderName = snippet.folder;
      for (var i = 0; i < folders.length; i++) {
        if (folders[i].id === snippet.folder) { folderName = folders[i].name; break; }
      }
      props['Categoria'] = { select: { name: folderName } };
    }

    if (snippet.versione) {
      props['Versione'] = {
        rich_text: [{ text: { content: snippet.versione || '' } }]
      };
    }

    return props;
  },

  create: function(snippet) {
    if (!notionCfg || !notionCfg.apiKey || !notionCfg.dbId) return;

    fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + notionCfg.apiKey,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        parent: { database_id: notionCfg.dbId },
        properties: this._buildProps(snippet)
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data && data.id) {
        snippet.notion_page_id = data.id;
        DB.upsertSnippet(snippet);
        console.log('[SprintBrain] Pushed to Notion:', snippet.title, '→', data.id);
      } else {
        console.warn('[SprintBrain] Notion create returned no id:', data);
      }
    })
    .catch(function(err) {
      console.warn('[SprintBrain] Notion push failed:', err.message);
    });
  },

  update: function(snippet) {
    if (!notionCfg || !notionCfg.apiKey) return;
    if (!snippet.notion_page_id) {
      this.create(snippet);
      return;
    }

    fetch('https://api.notion.com/v1/pages/' + snippet.notion_page_id, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bearer ' + notionCfg.apiKey,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ properties: this._buildProps(snippet) })
    })
    .then(function(r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      console.log('[SprintBrain] Updated in Notion:', snippet.title);
    })
    .catch(function(err) {
      console.warn('[SprintBrain] Notion update failed:', err.message);
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
      console.log('[SprintBrain] Archived in Notion:', notionPageId);
    })
    .catch(function(err) {
      console.warn('[SprintBrain] Notion archive failed:', err.message);
    });
  }

};

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

    loadUserPrefs(function() {
      var dl = gi('cfg-default-lang');
      if (dl) dl.value = userPrefs.defaultLang;
    });

    var st = gi('st');   if (st) st.textContent = '● Syncing…';

    DB.loadAll().then(function (data) {
          if (data && data.snippets && data.snippets.length > 0) {
                  snips   = data.snippets;
                  folders = (data.folders && data.folders.length > 0) ? data.folders : DEFAULT_FOLDERS;
          } else {
                  DEFAULT_FOLDERS.forEach(function (f) { DB.upsertFolder(f); });
                  console.log('[SprintBrain] Empty DB — seeding folders, waiting for Notion sync');
          }
          syncSnippets();
          refreshUI();
    });

    // Check if alarm fetched fresh snippets while popup was closed
    chrome.storage.local.get('sb_alarm_sync_result', function(d) {
      if (d && d.sb_alarm_sync_result && d.sb_alarm_sync_result.snippets) {
        var alarmSnippets = d.sb_alarm_sync_result.snippets;
        var alarmTs = d.sb_alarm_sync_result.timestamp;
        var age = Date.now() - new Date(alarmTs).getTime();

        if (age < 600000 && alarmSnippets.length > 0) {
          console.log('[SprintBrain] Using alarm cache —',
            alarmSnippets.length, 'snippet(s) from',
            Math.round(age / 1000) + 's ago');

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
      var nk = document.getElementById('notion-key');
      var nd = document.getElementById('notion-db');
      if (nk && notionCfg.apiKey) nk.value = notionCfg.apiKey;
      if (nd && notionCfg.dbId) nd.value = notionCfg.dbId;
      updateNotionStatus();
      updateSyncStatus();
      _runNotionSync();
    });

    // Refresh status bar timestamp every 60 seconds
    setInterval(updateSyncStatus, 60000);
}

function _runNotionSync(cb, force) {
    var nsEl = document.getElementById('notion-st');

    NotionSync.run(notionCfg, {

          onProgress: function(state) {
                  if (state === 'syncing') {
                            _setSyncBar('refresh', 'Syncing with Notion\u2026', '#6C5CE7');
                            if (nsEl) { nsEl.textContent = 'Syncing\u2026'; nsEl.style.color = '#6C5CE7'; }
                  } else {
                            updateSyncStatus();
                            if (nsEl && notionCfg.apiKey && notionCfg.dbId) {
                                        nsEl.textContent = 'Connected'; nsEl.style.color = '#3B6D11';
                            }
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
                  // Always persist all Notion snippets to Supabase so they
                  // survive popup reload even when debounce blocks re-sync
                  notionSnippets.forEach(function(ns) { DB.upsertSnippet(ns); });

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
                        snips = snips.filter(function(s) { return s.id !== id; });
                      });
                      _saveLocalCache();
                      toDelete.forEach(function(id) { DB.deleteSnippet(id); });
                      changed = true;
                      console.log('[SprintBrain] Removed', toDelete.length,
                        'snippet(s) deleted in Notion');
                    }
                  }

                  if (changed) {
                            syncSnippets();
                            refreshUI();
                            showToast('Notion synced \u2014 ' + notionSnippets.length + ' snippet(s) updated');
                  }

                  console.log('[SprintBrain] Sync result:',
                    notionSnippets.length, 'from Notion |',
                    snips.length, 'total in app |',
                    'changed:', changed
                  );

                  updateSyncStatus();
                  if (cb) cb();
          },

          onError: function(err) {
                  console.warn('[SprintBrain] Notion sync failed:', err.message);

                  chrome.storage.local.set({
                            sb_notion_sync_error: {
                                        message: err.message,
                                        timestamp: new Date().toISOString()
                            }
                  });

                  if (nsEl && notionCfg.apiKey && notionCfg.dbId) {
                            nsEl.textContent = 'Sync failed'; nsEl.style.color = '#c0392b';
                  }

                  updateSyncStatus();
                  if (cb) cb();
          }

    }, force || false);
}

// UI REFRESH
function groupCount(arr){ var seen={}; var n=0; for(var i=0;i<arr.length;i++){ var gid=arr[i].lang_group_id||arr[i].id; if(!seen[gid]){ seen[gid]=1; n++; } } return n; }
function refreshUI(){
  var tp=gi('tp'); if(tp) tp.textContent=trig;
  var he=gi('hint-ex'); if(he) he.textContent=trig+'quoteEN';
  var gc=groupCount(snips);
  var st=gi('st'); if(st) st.textContent='\u25CF '+gc+' snippet'+(gc!==1?'s':'');
  renderFolders();
  renderList(gi('sq')?gi('sq').value:'');
}

// FOLDERS
function folderCount(fid){ var seen={}; var n=0; for(var i=0;i<snips.length;i++){ if((snips[i].folder||'')!==fid) continue; var gid=snips[i].lang_group_id||snips[i].id; if(!seen[gid]){ seen[gid]=1; n++; } } return n; }

function findFolder(id){ for(var i=0;i<folders.length;i++){ if(folders[i].id===id) return folders[i]; } return null; }

/* SVG icon map for folder icons — keyed by data-ico values */
var _FOLDER_SVGS = {
  folder: '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
  message: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  cpu: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  star: '<svg viewBox="0 0 24 24"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  key: '<svg viewBox="0 0 24 24"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  dollar: '<svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  'file-text': '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>'
};
function _folderSvg(ico){ return _FOLDER_SVGS[ico] || _FOLDER_SVGS.folder; }

function renderFolders(){
  var el=gi('folder-list'); if(!el) return;
  var allIco='<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>';
  var h='<div class="folder-item'+(selFolder==='ALL'?' on':'')+'" data-fid="ALL" tabindex="0" role="treeitem"><span class="folder-ico">'+allIco+'</span><span class="folder-name">All snippets</span><span class="folder-count">'+groupCount(snips)+'</span></div>';
  for(var i=0;i<folders.length;i++){
    var f=folders[i];
    h+='<div class="folder-item'+(selFolder===f.id?' on':'')+'" data-fid="'+f.id+'" tabindex="0" role="treeitem">'
      +'<span class="folder-ico">'+_folderSvg(f.ico||'folder')+'</span>'
      +'<span class="folder-name">'+esc(f.name)+'</span>'
      +'<span class="folder-count">'+folderCount(f.id)+'</span>'
      +'<span class="folder-dots" data-fdots="'+f.id+'" title="Folder options">\u22EF</span>'
      +'</div>';
  }
  el.innerHTML=h;
  el.querySelectorAll('.folder-item').forEach(function(row){
    row.addEventListener('click',function(e){
      if(e.target.dataset.fdots){ e.stopPropagation(); ctxFolderId=e.target.dataset.fdots; showFolderCtxMenu(e.clientX,e.clientY); return; }
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
  // Sort pinned snippets to top
  filtered.sort(function(a,b){ return (b.pinned?1:0)-(a.pinned?1:0); });
  var groups=groupSnips(filtered);
  var h='';
  for(var gi2=0;gi2<groups.length;gi2++){
    var g=groups[gi2];
    var master=g.master;
    var variants=g.variants;
    var vLangs=Object.keys(variants);
    var s=variants[selId]||master;
    var st=s.stats||{uses:0,fills:0,lastUsed:null};
    var usesBadge=st.uses===0?'<span class="stat-b never">Never used</span>':st.uses>=10?'<span class="stat-b hot">\u00D7'+st.uses+'</span>':'<span class="stat-b uses">\u00D7'+st.uses+'</span>';
    var fillsBadge=st.uses>0?'<span class="stat-b fills">'+st.fills+' filled</span>':'';
    var pillsHtml='';
    if(vLangs.length>1){
      ['EN','ES','IT','FR'].forEach(function(l){
        if(variants[l]){
          var isAct=variants[l].id===selId;
          pillsHtml+='<span class="stat-b '+(isAct?'uses':'never')+'" style="cursor:pointer;font-weight:700" data-switch="'+variants[l].id+'">'+l+(isAct?' \u2713':'')+'</span>';
        }
      });
    }
    var baseTitle=master.title.replace(/\s*(EN|ES|IT|FR)$/,'');
    h+='<div class="item" data-id="'+s.id+'">'
      +'<div style="flex:1;min-width:0;overflow:hidden">'
      +'<div class="iname" id="iname-'+s.id+'">'+esc(baseTitle)+'</div>'
      +'<div style="display:flex;gap:4px;margin-top:2px">'+usesBadge+fillsBadge+pillsHtml+'</div>'
      +'</div>'
      +'<span class="isc"><span class="isc-pfx">'+esc(trig)+'</span>'+esc((s.shortcut||'').replace(/^[^a-zA-Z0-9]+/,''))+'</span>'
      +'<span class="lb '+esc(s.lang||'EN')+'">'+esc(s.lang||'EN')+'</span>'
      +'<button class="iedit" data-eid="'+s.id+'">Edit</button>'
      +'<button class="idots" data-dots="'+s.id+'" title="More actions">\u22EF</button>'
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
      if(e.target.dataset.dots){ e.stopPropagation(); ctxId=e.target.dataset.dots; var dr=e.target.getBoundingClientRect(); showCtxMenu(dr.right,dr.bottom); return; }
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
    h+='<option value="'+f.id+'"'+(f.id===current?' selected':'')+'>'+esc(f.name)+'</option>';
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
  initEditorLangTabs(s);
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
  var folder=gi('efolder').value||'';
  var sc=trig+word;
  if(!title){ shake('etit'); return; }
  if(!word){  shake('ewrd'); return; }
  var urgEnabled = gi('eurg').checked;
  var urgDurMs = Math.max(1, parseInt(gi('eurg-dur').value) || 30) * 60000;
  var urgSc = Math.max(0, parseInt(gi('eurg-sc').value) || 0);

  // Capture current textarea into the active language buffer
  edLangBuf[edLangActive] = body;
  var lang = edLangActive;

  var isNew=!editId, variantIsNew=false, toSave;
  if(isNew){
    toSave={id:uid(),title:title,shortcut:sc,body:body,lang:lang,folder:folder,fieldCfg:{},lang_group_id:'',sort_order:snips.length+1,
      enable_urgency_timer:urgEnabled,timer_duration_ms:urgDurMs,scarcity_count:urgSc,
      stats:{uses:0,fills:0,lastUsed:null}};
    toSave.lang_group_id=toSave.id;
    snips.unshift(toSave);
  } else {
    // Resolve the anchor snippet and the correct save target for the active language.
    // editId always points to the snippet that was opened — it may be a different language
    // than the one currently active in the editor.
    var anchorSnip = findSnip(editId);
    if (!anchorSnip) return;
    var anchorGid = anchorSnip.lang_group_id || anchorSnip.id;
    // Find the existing variant for edLangActive within this lang group
    for(var i=0;i<snips.length;i++){
      if((snips[i].lang_group_id||snips[i].id)===anchorGid && snips[i].lang===lang){
        toSave=snips[i]; break;
      }
    }
    if(toSave){
      // Update the language-correct variant
      toSave.title=title; toSave.shortcut=sc; toSave.body=body;
      toSave.folder=folder;
      toSave.enable_urgency_timer=urgEnabled;
      toSave.timer_duration_ms=urgDurMs;
      toSave.scarcity_count=urgSc;
    } else {
      // No variant exists yet for this language — create one
      variantIsNew=true;
      toSave={
        id:uid(), title:title, shortcut:sc, body:body, lang:lang,
        folder:folder, fieldCfg:JSON.parse(JSON.stringify(anchorSnip.fieldCfg||{})),
        lang_group_id:anchorGid, sort_order:snips.length+1,
        enable_urgency_timer:urgEnabled, timer_duration_ms:urgDurMs,
        scarcity_count:urgSc, notion_page_id:null,
        stats:{uses:0,fills:0,lastUsed:null}
      };
      snips.push(toSave);
      // Keep edLangVariants in sync so the LANGS loop below won't double-create
      edLangVariants[lang] = toSave;
    }
    // Propagate shared metadata changes (title, folder, urgency) to the anchor
    // when the anchor is a different variant than the one being saved
    if(anchorSnip !== toSave){
      anchorSnip.title=title; anchorSnip.folder=folder;
      anchorSnip.enable_urgency_timer=urgEnabled;
      anchorSnip.timer_duration_ms=urgDurMs;
      anchorSnip.scarcity_count=urgSc;
      DB.upsertSnippet(anchorSnip);
    }
  }
  if(!toSave) return;
  DB.upsertSnippet(toSave);
  syncSnippets();
  if(isNew || variantIsNew) {
    DB.updateStats(toSave.id,0,0,null);
    NotionPush.create(toSave);
  } else {
    NotionPush.update(toSave);
  }

  // Save all other language variant buffers
  var gid = toSave.lang_group_id || toSave.id;
  LANGS.forEach(function(l) {
    if (l === lang) return; // already saved above
    if (edLangBuf[l] === undefined) return; // never touched
    var existing = edLangVariants[l];
    if (existing) {
      // Update existing variant body
      existing.body = edLangBuf[l];
      existing.folder = folder;
      existing.enable_urgency_timer = urgEnabled;
      existing.timer_duration_ms = urgDurMs;
      existing.scarcity_count = urgSc;
      DB.upsertSnippet(existing);
    } else {
      // Create new variant
      var baseTitle = title.replace(/\s*(EN|ES|IT|FR)$/, '');
      var baseWord = word.replace(/(EN|ES|IT|FR)$/, '');
      var ns = {
        id: uid(), title: baseTitle + ' ' + l,
        shortcut: trig + baseWord + l,
        body: edLangBuf[l], lang: l, folder: folder,
        fieldCfg: JSON.parse(JSON.stringify(toSave.fieldCfg || {})),
        lang_group_id: gid, sort_order: snips.length + 1,
        enable_urgency_timer: urgEnabled, timer_duration_ms: urgDurMs,
        scarcity_count: urgSc,
        stats: { uses: 0, fills: 0, lastUsed: null }
      };
      snips.push(ns);
      DB.upsertSnippet(ns);
      DB.updateStats(ns.id, 0, 0, null);
    }
  });
  // Refresh context menus in background
  try{ chrome.runtime.sendMessage({type:'REFRESH_MENUS'}); }catch(e){}
  gi('sok').className='saveok on';
  setTimeout(function(){ gi('sok').className='saveok'; show('pane-list'); refreshUI(); },700);
}

function doDel(){
  if(!editId||!confirm('Delete this snippet?')) return;
  var _delSnip = findSnip(editId);
  if(_delSnip && _delSnip.notion_page_id) NotionPush.archive(_delSnip.notion_page_id);
  DB.deleteSnippet(editId);
  snips=snips.filter(function(s){ return s.id!==editId; });
  syncSnippets();
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
    h+='<div class="ctx-sub-item" data-move-to="'+folders[i].id+'"><span class="sub-ico">'+_folderSvg(folders[i].ico||'folder')+'</span>'+esc(folders[i].name)+'</div>';
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
  // Update pin label
  var pinLbl=gi('ctx-pin-label'); var pinSnip=findSnip(ctxId);
  if(pinLbl&&pinSnip) pinLbl.textContent=pinSnip.pinned?'Unpin':'Pin to top';
  var m=gi('ctx-menu'); m.style.left=x+'px'; m.style.top=y+'px'; m.className='ctx-menu on';
  setTimeout(function(){
    var r=m.getBoundingClientRect(); if(r.right>window.innerWidth) m.style.left=(x-r.width)+'px'; if(r.bottom>window.innerHeight) m.style.top=(y-r.height)+'px';
    // Focus first menu item for keyboard navigation
    var first=m.querySelector('.ctx-item'); if(first) first.focus();
  },0);
}

function closeCtxMenu(){ var m=gi('ctx-menu'); if(m) m.className='ctx-menu'; closeFolderCtxMenu(); closeEmptyCtxMenu(); }

// Keyboard navigation for snippet context menu
(function(){
  var menu=gi('ctx-menu'); if(!menu) return;
  menu.addEventListener('keydown',function(e){
    var items=Array.prototype.slice.call(menu.querySelectorAll('.ctx-item'));
    if(!items.length) return;
    var cur=document.activeElement;
    var idx=items.indexOf(cur);
    if(e.key==='ArrowDown'||e.key==='Down'){
      e.preventDefault(); idx=(idx+1)%items.length; items[idx].focus();
    } else if(e.key==='ArrowUp'||e.key==='Up'){
      e.preventDefault(); idx=(idx-1+items.length)%items.length; items[idx].focus();
    } else if(e.key==='Enter'||e.key===' '){
      e.preventDefault(); if(cur&&cur.classList.contains('ctx-item')) cur.click();
    } else if(e.key==='Escape'||e.key==='Esc'){
      e.preventDefault(); closeCtxMenu();
    }
  });
})();

// FOLDER CONTEXT MENU
function showFolderCtxMenu(x,y){
  // Close other menus individually — closeCtxMenu() also calls closeFolderCtxMenu()
  var cm=gi('ctx-menu'); if(cm) cm.className='ctx-menu';
  var em=gi('ectx-menu'); if(em) em.className='ctx-menu';

  var m=gi('fctx-menu'); if(!m) return;
  // Temporarily show off-screen to measure
  m.style.left='-9999px'; m.style.top='-9999px';
  m.className='ctx-menu on';

  setTimeout(function(){
    var r=m.getBoundingClientRect();
    var vw=document.documentElement.clientWidth||window.innerWidth;
    var vh=document.documentElement.clientHeight||window.innerHeight;
    var finalX=Math.min(x,vw-r.width-4);
    var finalY=Math.min(y,vh-r.height-4);
    finalX=Math.max(4,finalX);
    finalY=Math.max(4,finalY);
    m.style.left=finalX+'px';
    m.style.top=finalY+'px';
  },0);
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
  editFolderId=f.id; selIco=f.ico||'folder';
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
  syncSnippets(); refreshUI(); closeCtxMenu();
});
var ctxRen=gi('ctx-rename'); if(ctxRen) ctxRen.addEventListener('click',function(){ closeCtxMenu(); startInlineRename(ctxId); });
var ctxDel=gi('ctx-delete'); if(ctxDel) ctxDel.addEventListener('click',function(){
  if(!ctxId||!confirm('Delete this snippet?')) return;
  DB.deleteSnippet(ctxId); snips=snips.filter(function(s){ return s.id!==ctxId; });
  syncSnippets(); refreshUI(); closeCtxMenu();
});

// Pin / Unpin
var ctxPin=gi('ctx-pin'); if(ctxPin) ctxPin.addEventListener('click',function(){
  var s=findSnip(ctxId); if(!s) return;
  s.pinned=!s.pinned;
  DB.upsertSnippet(s); syncSnippets(); refreshUI(); closeCtxMenu();
});

// Copy content (body) to clipboard
var ctxCopy=gi('ctx-copy'); if(ctxCopy) ctxCopy.addEventListener('click',function(){
  var s=findSnip(ctxId); if(!s) return;
  try{ navigator.clipboard.writeText(s.body||''); }catch(e2){}
  closeCtxMenu();
  // Flash feedback on snippet name
  var nm=gi('iname-'+s.id); if(nm){ var orig=nm.textContent; nm.textContent='\u2713 Content copied!'; setTimeout(function(){ nm.textContent=orig; },1400); }
});

// Share snippet (serialized JSON to clipboard)
var ctxShare=gi('ctx-share'); if(ctxShare) ctxShare.addEventListener('click',function(){
  var s=findSnip(ctxId); if(!s) return;
  var payload={title:s.title,shortcut:s.shortcut||'',body:s.body||'',lang:s.lang||'EN',folder:s.folder||'',fieldCfg:s.fieldCfg||{}};
  try{ navigator.clipboard.writeText(JSON.stringify(payload,null,2)); }catch(e2){}
  closeCtxMenu();
  var nm=gi('iname-'+s.id); if(nm){ var orig=nm.textContent; nm.textContent='\u2713 Snippet shared!'; setTimeout(function(){ nm.textContent=orig; },1400); }
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
  pendFolderCb=cb||null; editFolderId=null; selIco='folder';
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
function updateWarn(t){ var w=gi('wbox'); if(t==='/'){ w.innerHTML='<strong>/</strong> conflicts with WhatsApp, Claude and Notion. Use <strong>::</strong> instead.'; w.className='warn on'; }else if(/^[a-zA-Z0-9]$/.test(t)){ w.innerHTML='Single alphanumeric triggers may cause false positives.'; w.className='warn on'; }else{ w.className='warn'; } }
function updateInfo(t){ gi('itrig').textContent=t; gi('iex').textContent=t+'quoteEN'; }
function applyTrig(){
  var custom=(gi('ctrig').value||'').trim(); var chosen=custom||pendT; if(!chosen) return;
  var old=trig;
  for(var i=0;i<snips.length;i++){ var sc=snips[i].shortcut||''; if(sc.indexOf(old)===0){ snips[i].shortcut=chosen+sc.slice(old.length); DB.upsertSnippet(snips[i]); } }
  trig=chosen; saveTrigger();
  // Sync: update snippetTrigger to match trigger prefix (single source of truth)
  triggerCfg.snippetTrigger=chosen; saveTriggerCfg();
  var s=gi('tcfg-snip'); if(s) s.value=chosen;
  // Save default language preference
  var dl=gi('cfg-default-lang'); if(dl) { userPrefs.defaultLang=dl.value; saveUserPrefs(); }
  show('pane-list'); refreshUI();
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
    syncSnippets();
    refreshUI();
  });
});
on('sq','input',    function(e){ renderList(e.target.value); });
on('ewrd','input',  updateSprev);
on('ebdy','keydown',function(e){ if((e.metaKey||e.ctrlKey)&&e.key==='s'){e.preventDefault();doSave();} });
on('eurg','change', function(){ var uf=gi('urg-fields'),eu=gi('eurg'); if(uf&&eu) uf.style.display=eu.checked?'':'none'; });
var cmdGrid=document.querySelector('.cmds'); if(cmdGrid) cmdGrid.addEventListener('click',function(e){ if(e.target.dataset.c) insertCmd(e.target.dataset.c); });
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
  syncSnippets();
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
  var colors = {EN:'var(--en)',ES:'var(--es)',IT:'var(--it)',FR:'var(--fr)'};
  LANGS.forEach(function(l){
    var vs = v[l]; var isCur = snip.lang === l;
    h += '<div class="lp-opt'+(vs?' lp-has':'')+(isCur?' lp-sel':'')+(vs?'':' lp-dis')+'" data-lang="'+l+'" data-id="'+(vs?vs.id:'')+'">'
      +'<div class="lp-dot" style="color:'+(colors[l]||'var(--tx2)')+'">'+l+'</div>'
      +'<span class="lp-nm">'+LNAMES[l]+(vs?' \u2713':'')+'</span></div>';
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
      if(nm){ nm.textContent = sc + ' copied'; setTimeout(function(){if(nm)nm.textContent=orig;},1600); }
    }
  };
  gi('lp-bg').className = 'lp-bg on';
}

// ── EDITOR LANGUAGE TABS ──────────────────────────────────────────
var edLangBuf = {};      // {EN:'...', ES:'...', IT:'...', FR:'...'}
var edLangActive = 'EN'; // currently active tab in editor
var edLangVariants = {};  // {EN: snippetObj, ES: snippetObj, ...}

function initEditorLangTabs(snip) {
  edLangBuf = {};
  edLangVariants = {};
  edLangActive = snip ? (snip.lang || userPrefs.defaultLang || 'EN') : (userPrefs.defaultLang || 'EN');
  if (snip) {
    edLangVariants = findVariants(snip);
    LANGS.forEach(function(l) {
      if (edLangVariants[l]) edLangBuf[l] = edLangVariants[l].body || '';
    });
  }
  // Set current snippet body into its lang buffer
  if (snip) edLangBuf[edLangActive] = snip.body || '';
  refreshLangTabs();
}

function refreshLangTabs() {
  var tabs = document.querySelectorAll('#lang-sidebar .lang-tab');
  tabs.forEach(function(tab) {
    var l = tab.dataset.lang;
    tab.classList.toggle('on', l === edLangActive);
    tab.classList.toggle('has-content', !!(edLangBuf[l] && edLangBuf[l].trim()));
  });
  // Sync the language dropdown
  var el = gi('elng');
  if (el) el.value = edLangActive;
  // Show/hide textarea vs empty state
  var ta = gi('ebdy');
  var emp = gi('lang-empty');
  var hasContent = edLangBuf[edLangActive] !== undefined;
  if (ta) ta.style.display = hasContent ? '' : 'none';
  if (emp) {
    emp.classList.toggle('on', !hasContent);
    emp.querySelector('.lang-empty-txt').innerHTML = 'No <b>' + LNAMES[edLangActive] + '</b> content yet.<br>Click to start writing.';
  }
}

function switchEditorLang(lang) {
  if (lang === edLangActive) return;
  // Save current textarea content to buffer
  var ta = gi('ebdy');
  if (ta) edLangBuf[edLangActive] = ta.value || '';
  edLangActive = lang;
  // Load target language content
  if (ta) {
    var content = edLangBuf[lang];
    if (content !== undefined) {
      ta.value = content;
      ta.style.display = '';
      var emp = gi('lang-empty');
      if (emp) emp.classList.remove('on');
    }
  }
  // Sync language dropdown
  var el = gi('elng');
  if (el) el.value = lang;
  refreshLangTabs();
}

function editorLangEmptyClick() {
  // Create empty buffer entry and show textarea
  edLangBuf[edLangActive] = '';
  var ta = gi('ebdy');
  var emp = gi('lang-empty');
  if (ta) { ta.value = ''; ta.style.display = ''; ta.focus(); }
  if (emp) emp.classList.remove('on');
  refreshLangTabs();
}

// Wire up sidebar tab clicks + dropdown sync
(function() {
  var tabs = document.querySelectorAll('#lang-sidebar .lang-tab');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() { switchEditorLang(tab.dataset.lang); });
  });
  var emp = gi('lang-empty');
  if (emp) emp.addEventListener('click', editorLangEmptyClick);
  var elng = gi('elng');
  if (elng) elng.addEventListener('change', function() { switchEditorLang(elng.value); });
})();

function showToast(msg){
  var t=gi('toast');
  if(!t){ t=document.createElement('div'); t.id='toast'; t.style.cssText='position:fixed;bottom:14px;left:50%;transform:translateX(-50%);background:#18181B;color:#fff;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:500;z-index:9999;opacity:0;transition:opacity .3s;box-shadow:0 4px 12px rgba(0,0,0,.15)'; document.body.appendChild(t); }
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
  // Sync: rewrite all snippet prefixes and update trigger to match
  var old=trig;
  if(old!==v){
    for(var i=0;i<snips.length;i++){ var sc=snips[i].shortcut||''; if(sc.indexOf(old)===0){ snips[i].shortcut=v+sc.slice(old.length); DB.upsertSnippet(snips[i]); } }
    trig=v; saveTrigger();
    var tp=gi('tp'); if(tp) tp.textContent=trig;
    var he=gi('hint-ex'); if(he) he.textContent=trig+'quoteEN';
    var sp=gi('spfx'); if(sp) sp.textContent=trig;
    gi('ctrig').value=v; syncTG(v);
    refreshUI();
  }
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

// ── SYNC NOW BUTTON ──────────────────────────────────────
var syncNowBtn = document.getElementById('sb-sync-now');
if (syncNowBtn) {
  syncNowBtn.addEventListener('click', function() {
    syncNowBtn.disabled = true;
    syncNowBtn.textContent = '…';
    _setSyncBar('refresh', 'Syncing now\u2026', '#6C5CE7');

    chrome.storage.local.remove('sb_notion_sync_error');
    NotionSync.reset();

    _runNotionSync(function() {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = 'Sync Now';
      updateSyncStatus();
    }, true);
  });
}

// ── AUTH GATE (AUTH-EXT-001 phase A) ──────────────────────────────
// OTP flow: pending state persists in chrome.storage.local under 'sb_otp_pending'
// so closing the popup mid-flow (e.g. to fetch the code from Gmail) doesn't reset it.
// Pending state expires after OTP_TTL_MS to avoid showing a stale code screen.
var OTP_TTL_MS = 55 * 60 * 1000; // Supabase OTPs are valid for 60 min; bail at 55.

var SB_DASHBOARD_LINK_URL = 'https://sprintbrain.netlify.app/extension-link';

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
  var msgEl   = document.getElementById('sb-auth-msg');
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
      primary.textContent = 'Send code';
      subEl.textContent = "Enter your work email — we'll send a one-time code.";
      setTimeout(function() { emailEl.focus(); }, 30);
    } else {
      emailEl.style.display = 'none';
      codeEl.style.display = '';
      backEl.style.display = '';
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
      sbVerifyOtp(pendingEmail, code, function(err, session) {
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
      hideGate();
      bootOnce(next);
    }
  });

  // Initial check: if a session exists already, skip the gate.
  sbGetSession(function(session) {
    if (session && session.access_token) { hideGate(); bootOnce(session); }
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
