// ── SPRINTBRAIN AUTH v2.93.0 — Email-OTP + dashboard SSO handoff (AUTH-EXT-002/003)
//    + server-side session liveness (sbCheckSessionAlive) and login-activity
//    logging for the Settings → Security dashboard feature.
//    v2.93.0: SSO handoff redeems a one-time token_hash (sbVerifyTokenHash) so
//    the extension owns an independent refresh-token family; token refresh is
//    fail-open on transient errors; the remember-me window slides on use. ──
// Loaded by both the popup (via <script>) and the background SW (via importScripts).
// Vanilla JS, no SDK, talks to Supabase /auth/v1/* directly.
//
// Storage shape (chrome.storage.local key 'sb_session'):
//   { access_token, refresh_token, expires_at, user_id, email }
// expires_at is unix seconds.

var SB_SUPA_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
var SB_SUPA_ANON_KEY = 'sb_publishable_F_8LSMkr9ZK-9v50sPzXbQ_zjA0D_O0';

// In-flight refresh promise (per JS context) — prevents racing refreshes.
var _sbRefreshing = null;

function sbGetSession(cb) {
  chrome.storage.local.get('sb_session', function(d) {
    cb(d && d.sb_session ? d.sb_session : null);
  });
}

function sbSetSession(s, cb) {
  chrome.storage.local.set({ sb_session: s }, function() {
    if (cb) cb();
    try {
      chrome.runtime.sendMessage({ type: 'auth_changed' });
    } catch(e) { /* no listeners is fine */ }
  });
}

function sbClearSession(cb) {
  _sbRefreshing = null;
  chrome.storage.local.remove(['sb_session', 'sb_remember_until'], function() {
    if (cb) cb();
    try {
      chrome.runtime.sendMessage({ type: 'auth_changed' });
    } catch(e) {}
  });
}

// POST /auth/v1/otp — sends a 6-digit code via email.
function sbRequestOtp(email, cb) {
  fetch(SB_SUPA_URL + '/auth/v1/otp', {
    method: 'POST',
    headers: { 'apikey': SB_SUPA_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, create_user: true })
  }).then(function(r) {
    if (r.ok) { cb(null); return; }
    return r.text().then(function(t) {
      var status = r.status;
      var msg = 'Could not send code';
      try { var j = JSON.parse(t); msg = j.msg || j.error_description || j.error || msg; } catch(e) {}
      console.error('[SprintBrain] OTP request failed — HTTP ' + status + ':', msg);
      cb(status === 429 ? 'Too many requests — wait a few minutes and try again.' : msg);
    });
  }).catch(function(e) { cb(e.message || 'Network error'); });
}

// Shared acceptance of a successful /auth/v1/verify response: build + persist
// the session, base the remember-me window, mirror trigger metadata, log the
// login for the Security dashboard.
function _sbAcceptVerifiedSession(j, fallbackEmail, rememberUntil, method, cb) {
  var session = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
    user_id: j.user && j.user.id ? j.user.id : null,
    email: (j.user && j.user.email) || fallbackEmail
  };
  chrome.storage.local.set({ sb_remember_until: rememberUntil });
  if (j.user && j.user.user_metadata) sbApplyTriggerMetadata(j.user.user_metadata);
  sbSetSession(session, function() {
    sbLogLoginEvent(session.access_token, method);
    cb(null, session);
  });
}

// POST /auth/v1/verify — exchanges (email, OTP code) for tokens.
// rememberMe: true → store 30-day expiry; false → expire with access token (no auto-refresh).
function sbVerifyOtp(email, token, rememberMe, cb) {
  fetch(SB_SUPA_URL + '/auth/v1/verify', {
    method: 'POST',
    headers: { 'apikey': SB_SUPA_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, token: token, type: 'email' })
  }).then(function(r) {
    return r.text().then(function(t) {
      var j = null;
      try { j = JSON.parse(t); } catch(e) {}
      if (!r.ok || !j || !j.access_token) {
        var msg = (j && (j.msg || j.error_description || j.error)) || 'Invalid code';
        cb(msg, null);
        return;
      }
      var rememberUntil = rememberMe !== false
        ? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
        : 0;
      _sbAcceptVerifiedSession(j, email, rememberUntil, 'email_otp', cb);
    });
  }).catch(function(e) { cb(e.message || 'Network error', null); });
}

// POST /auth/v1/verify with a one-time token_hash minted server-side by the
// mint-extension-session edge function (AUTH-EXT-003). Verifying it creates a
// session of the extension's own — an independent refresh-token family, so
// dashboard and extension token rotations can never revoke each other.
function sbVerifyTokenHash(tokenHash, cb) {
  fetch(SB_SUPA_URL + '/auth/v1/verify', {
    method: 'POST',
    headers: { 'apikey': SB_SUPA_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token_hash: tokenHash, type: 'magiclink' })
  }).then(function(r) {
    return r.text().then(function(t) {
      var j = null;
      try { j = JSON.parse(t); } catch(e) {}
      if (!r.ok || !j || !j.access_token) {
        cb((j && (j.msg || j.error_description || j.error)) || 'Invalid link token', null);
        return;
      }
      _sbAcceptVerifiedSession(j, null, Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, 'magic_link', cb);
    });
  }).catch(function(e) { cb(e.message || 'Network error', null); });
}

// POST /rest/v1/rpc/log_login_event — record this sign-in in the dashboard's
// "Recent login activity" (Settings → Security). IP, user-agent, country and
// timestamp are derived server-side; repeat calls for one session are no-ops.
// Best-effort fire-and-forget: a failed log must never block login.
function sbLogLoginEvent(accessToken, method) {
  try {
    fetch(SB_SUPA_URL + '/rest/v1/rpc/log_login_event', {
      method: 'POST',
      headers: { 'apikey': SB_SUPA_ANON_KEY, 'Authorization': 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_method: method || 'email_otp' })
    }).catch(function() {});
  } catch(e) {}
}

// POST /rest/v1/rpc/session_alive — is this session's auth.sessions row still
// there? ONLY an explicit `false` means revoked (dashboard "Sign out from all
// devices" / per-device sign-out): the local session is cleared (fires
// auth_changed) and cb(false). Every other outcome — no session, network or
// HTTP error — is fail-open cb(true), so an outage never signs the user out.
// Genuinely dead refresh tokens already self-clean via sbRefreshToken.
function sbCheckSessionAlive(cb) {
  sbGetSession(function(s) {
    if (!s || !s.access_token) { if (cb) cb(true); return; }
    sbAuthHeaders(function(err, headers) {
      if (err || !headers) { if (cb) cb(true); return; }
      fetch(SB_SUPA_URL + '/rest/v1/rpc/session_alive', {
        method: 'POST',
        headers: { 'apikey': headers.apikey, 'Authorization': headers.Authorization, 'Content-Type': 'application/json' },
        body: '{}'
      }).then(function(r) {
        if (!r.ok) { if (cb) cb(true); return; }
        return r.json().then(function(alive) {
          if (alive === false) { sbClearSession(function() { if (cb) cb(false); }); }
          else { if (cb) cb(true); }
        });
      }).catch(function() { if (cb) cb(true); });
    });
  });
}

// POST /auth/v1/token?grant_type=refresh_token — rotates the access_token.
// Skips refresh and rejects if the user's remember-me window has closed.
// Fail-open by design: only a definitive GoTrue rejection of the refresh token
// (or a closed remember-me window) clears the stored session. Transient
// failures — offline, 5xx, rate limit — keep it, so the next caller retries
// and a blip never signs the user out.
function sbRefreshToken(cb) {
  if (_sbRefreshing) { _sbRefreshing.then(function(s){ cb(null, s); }, function(e){ cb(e, null); }); return; }
  _sbRefreshing = new Promise(function(resolve, reject) {
    chrome.storage.local.get('sb_remember_until', function(d) {
      var until = d.sb_remember_until;
      var now = Math.floor(Date.now() / 1000);
      // until === 0: user explicitly declined remember-me; until < now: 30-day window expired
      if (until !== undefined && (until === 0 || until < now)) {
        reject(new Error('session_expired'));
        return;
      }
      doRefresh(until);
    });
    function doRefresh(until) {
    sbGetSession(function(s) {
      if (!s || !s.refresh_token) { reject(new Error('no_session')); return; }
      fetch(SB_SUPA_URL + '/auth/v1/token?grant_type=refresh_token', {
        method: 'POST',
        headers: { 'apikey': SB_SUPA_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token })
      }).then(function(r) {
        return r.text().then(function(t) {
          var j = null;
          try { j = JSON.parse(t); } catch(e) {}
          if (!r.ok || !j || !j.access_token) {
            // 4xx (minus 408/429) = GoTrue rejected this refresh token — the
            // session is genuinely dead. Anything else is transient.
            var dead = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429;
            reject(new Error(dead ? 'refresh_rejected' : 'refresh_transient'));
            return;
          }
          var next = {
            access_token: j.access_token,
            refresh_token: j.refresh_token || s.refresh_token,
            expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
            user_id: (j.user && j.user.id) || s.user_id,
            email:   (j.user && j.user.email) || s.email
          };
          if (j.user && j.user.user_metadata) sbApplyTriggerMetadata(j.user.user_metadata);
          sbSetSession(next, function() {
            // Sliding remember-me: each successful refresh re-bases the 30-day
            // window, so an account in active use stays signed in indefinitely.
            // 0 (user declined remember-me) never slides.
            if (until !== 0) {
              chrome.storage.local.set({ sb_remember_until: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60 });
            }
            resolve(next);
          });
        });
      }).catch(function() { reject(new Error('refresh_transient')); });
    });
    }
  });
  _sbRefreshing.then(
    function(s) { _sbRefreshing = null; cb(null, s); },
    function(e) {
      _sbRefreshing = null;
      var reason = (e && e.message) || 'refresh_failed';
      if (reason === 'refresh_rejected' || reason === 'session_expired') {
        sbClearSession(function() { cb(reason, null); });
      } else {
        cb(reason, null);
      }
    }
  );
}

// Yields { apikey, Authorization } headers for the current session.
// Refreshes proactively if expires within 60s. Calls cb(null, headers) on success,
// cb(err, null) if no session or refresh fails.
function sbAuthHeaders(cb) {
  sbGetSession(function(s) {
    if (!s || !s.access_token) { cb('not_authed', null); return; }
    var now = Math.floor(Date.now() / 1000);
    if (s.expires_at && (s.expires_at - now) < 60) {
      sbRefreshToken(function(err, fresh) {
        if (err || !fresh) { cb(err || 'refresh_failed', null); return; }
        cb(null, { apikey: SB_SUPA_ANON_KEY, Authorization: 'Bearer ' + fresh.access_token });
      });
      return;
    }
    cb(null, { apikey: SB_SUPA_ANON_KEY, Authorization: 'Bearer ' + s.access_token });
  });
}

// Convenience: synchronous-ish current user_id (callback). Returns null when signed out.
function sbCurrentUserId(cb) {
  sbGetSession(function(s) { cb(s && s.user_id ? s.user_id : null); });
}

// ── TRIGGER CONFIG SYNC — single source of truth = auth.users.user_metadata ──
// The snippet/prompt trigger settings live in user_metadata
// (trigger_snippet_seq / trigger_prompt_seq / *_key) — the SAME fields the web
// dashboard reads and writes (see app/src/lib/api/settingsApi.ts). The extension
// mirrors them into chrome.storage.sync.triggerCfg, the local cache content.js
// reads, so a change on either surface reflects on the other.

// Map the user_metadata trigger fields onto the triggerCfg cache and persist.
// Only overwrites keys the metadata actually carries (an unset field keeps its
// current value), and only writes when something changed — so we don't churn
// chrome.storage.onChanged (which content.js listens to for live updates).
function sbApplyTriggerMetadata(meta) {
  if (!meta || typeof meta !== 'object') return;
  chrome.storage.sync.get('triggerCfg', function(d) {
    var cur = (d && d.triggerCfg) ? d.triggerCfg : {};
    var next = {
      snippetTrigger:       cur.snippetTrigger       || '::',
      promptTrigger:        cur.promptTrigger        || '"""',
      snippetActivationKey: cur.snippetActivationKey || 'Tab',
      promptActivationKey:  cur.promptActivationKey  || 'Tab',
      selectionSuggestions: (typeof cur.selectionSuggestions === 'boolean') ? cur.selectionSuggestions : true
    };
    if (typeof meta.trigger_snippet_seq === 'string' && meta.trigger_snippet_seq.trim()) next.snippetTrigger = meta.trigger_snippet_seq.trim();
    if (typeof meta.trigger_prompt_seq  === 'string' && meta.trigger_prompt_seq.trim())  next.promptTrigger  = meta.trigger_prompt_seq.trim();
    if (meta.trigger_snippet_key === 'Tab' || meta.trigger_snippet_key === 'Enter') next.snippetActivationKey = meta.trigger_snippet_key;
    if (meta.trigger_prompt_key  === 'Tab' || meta.trigger_prompt_key  === 'Enter') next.promptActivationKey  = meta.trigger_prompt_key;
    if (next.snippetTrigger !== cur.snippetTrigger || next.promptTrigger !== cur.promptTrigger ||
        next.snippetActivationKey !== cur.snippetActivationKey || next.promptActivationKey !== cur.promptActivationKey) {
      try { chrome.storage.sync.set({ triggerCfg: next }); } catch(e) {}
    }
  });
}

// GET /auth/v1/user — fetch the current user (incl. user_metadata) and apply the
// trigger fields to the local cache. Used on popup open + a background alarm so
// dashboard changes propagate without waiting for a token refresh.
function sbPullTriggerMetadata(cb) {
  sbAuthHeaders(function(err, headers) {
    if (err || !headers) { if (cb) cb(err || 'not_authed'); return; }
    fetch(SB_SUPA_URL + '/auth/v1/user', { method: 'GET', headers: headers })
      .then(function(r) { return r.ok ? r.json() : null; })
      .then(function(u) {
        var meta = u && u.user_metadata ? u.user_metadata : null;
        if (meta) sbApplyTriggerMetadata(meta);
        if (cb) cb(null, meta);
      })
      .catch(function(e) { if (cb) cb(e && e.message ? e.message : 'network_error'); });
  });
}

// PUT /auth/v1/user { data } — write trigger fields back to user_metadata (the
// source of truth), then mirror them into the local cache. Used by the popup
// trigger editor so an extension-side change reaches the dashboard.
function sbWriteTriggerMetadata(patch, cb) {
  if (!patch || typeof patch !== 'object') { if (cb) cb('bad_patch'); return; }
  sbAuthHeaders(function(err, headers) {
    if (err || !headers) { if (cb) cb(err || 'not_authed'); return; }
    fetch(SB_SUPA_URL + '/auth/v1/user', {
      method: 'PUT',
      headers: { 'apikey': headers.apikey, 'Authorization': headers.Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: patch })
    }).then(function(r) {
      return r.text().then(function(t) {
        var j = null; try { j = JSON.parse(t); } catch(e) {}
        if (!r.ok) { if (cb) cb((j && (j.msg || j.error_description || j.error)) || 'update_failed'); return; }
        if (j && j.user_metadata) sbApplyTriggerMetadata(j.user_metadata);
        if (cb) cb(null, j && j.user_metadata ? j.user_metadata : null);
      });
    }).catch(function(e) { if (cb) cb(e && e.message ? e.message : 'network_error'); });
  });
}
