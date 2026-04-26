// ── SPRINTBRAIN AUTH v2.17.0 — Email-OTP + dashboard SSO handoff (AUTH-EXT-002) ──
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
  chrome.storage.local.remove('sb_session', function() {
    if (cb) cb();
    try {
      chrome.runtime.sendMessage({ type: 'auth_changed' });
    } catch(e) {}
  });
}

// POST /auth/v1/otp — sends a 6-digit code via email.
// shouldCreateUser=false so domain-restricted emails fail fast at the trigger.
function sbRequestOtp(email, cb) {
  fetch(SB_SUPA_URL + '/auth/v1/otp', {
    method: 'POST',
    headers: { 'apikey': SB_SUPA_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, create_user: true })
  }).then(function(r) {
    if (r.ok) { cb(null); return; }
    return r.text().then(function(t) {
      var msg = 'Could not send code';
      try { var j = JSON.parse(t); msg = j.msg || j.error_description || j.error || msg; } catch(e) {}
      cb(msg);
    });
  }).catch(function(e) { cb(e.message || 'Network error'); });
}

// POST /auth/v1/verify — exchanges (email, 6-digit code) for tokens.
function sbVerifyOtp(email, token, cb) {
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
      var session = {
        access_token: j.access_token,
        refresh_token: j.refresh_token,
        expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
        user_id: j.user && j.user.id ? j.user.id : null,
        email: (j.user && j.user.email) || email
      };
      sbSetSession(session, function() { cb(null, session); });
    });
  }).catch(function(e) { cb(e.message || 'Network error', null); });
}

// POST /auth/v1/token?grant_type=refresh_token — rotates the access_token.
function sbRefreshToken(cb) {
  if (_sbRefreshing) { _sbRefreshing.then(function(s){ cb(null, s); }, function(e){ cb(e, null); }); return; }
  _sbRefreshing = new Promise(function(resolve, reject) {
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
            reject(new Error('refresh_failed'));
            return;
          }
          var next = {
            access_token: j.access_token,
            refresh_token: j.refresh_token || s.refresh_token,
            expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + (j.expires_in || 3600)),
            user_id: (j.user && j.user.id) || s.user_id,
            email:   (j.user && j.user.email) || s.email
          };
          sbSetSession(next, function() { resolve(next); });
        });
      }).catch(function(e) { reject(e); });
    });
  });
  _sbRefreshing.then(
    function(s) { _sbRefreshing = null; cb(null, s); },
    function(e) { _sbRefreshing = null; sbClearSession(function() { cb(e.message || 'refresh_failed', null); }); }
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
