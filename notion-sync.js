// ─────────────────────────────────────────────────────────────────
// SPRINTBRAIN — notion-sync.js  v2.1
// On-app-open Notion database sync engine
// Reads snippet data from Notion → merges into local + Supabase cache
// Features: pagination, exponential backoff, debounce, offline cache
// ─────────────────────────────────────────────────────────────────

var NotionSync = (function () {

  /* ── Constants ─────────────────────────────────────────────── */
  var API_BASE      = 'https://api.notion.com/v1';
  var API_VERSION   = '2022-06-28';
  var TIMEOUT_MS    = 8000;
  var SYNC_TS_KEY   = 'sb_notion_last_sync_ts';   // chrome.storage.local
  var LOCK_KEY      = 'sb_notion_sync_lock';       // chrome.storage.local
  var LOCK_TTL_MS   = 30000;                       // 30 s stale-lock protection
  var CACHE_KEY     = 'sb_notion_snippet_cache';   // offline cache
  var DEBOUNCE_MS   = 60000;                        // 60 s debounce guard
  var MAX_RETRIES   = 3;
  var RETRY_DELAYS  = [1000, 2000, 4000];
  var MAX_PAGES     = 10;                           // hard cap: 10 pages × 100 = 1000 snippets

  /* ── Session guard (prevents duplicate calls within popup session) ─ */
  var _sessionDone = false;

  /* ── Utility: fetch with hard timeout ──────────────────────── */
  function _fetchTimeout(url, opts) {
    return new Promise(function (resolve, reject) {
      var tid = setTimeout(function () {
        reject(new Error('[NotionSync] Timeout after ' + TIMEOUT_MS + 'ms — ' + url));
      }, TIMEOUT_MS);

      fetch(url, opts)
        .then(function (r) { clearTimeout(tid); resolve(r); })
        .catch(function (e) { clearTimeout(tid); reject(e); });
    });
  }

  /* ── Storage helpers ────────────────────────────────────────── */
  function _getLocal(key, cb) {
    try {
      chrome.storage.local.get(key, function (d) {
        cb((d && d[key]) ? d[key] : null);
      });
    } catch (e) { cb(null); }
  }

  function _setLocal(key, val) {
    try {
      var obj = {};
      obj[key] = val;
      chrome.storage.local.set(obj);
    } catch (e) {}
  }

  /* ── Race-condition lock ────────────────────────────────────── */
  function _acquireLock(cb) {
    _getLocal(LOCK_KEY, function (lock) {
      var now = Date.now();
      if (lock && (now - lock) < LOCK_TTL_MS) {
        cb(false); // another sync is in flight
        return;
      }
      _setLocal(LOCK_KEY, now);
      cb(true);
    });
  }

  function _releaseLock() { _setLocal(LOCK_KEY, null); }

  /* ── Single API request with exponential backoff ─────────────── */
  function _fetchWithRetry(url, opts, attempt) {
    attempt = attempt || 0;
    return _fetchTimeout(url, opts).then(function (r) {
      // Fail immediately on client errors (no retry)
      if (r.status === 400) throw new Error('Notion DB not found or not shared with integration (HTTP 400)');
      if (r.status === 401) throw new Error('Notion API key invalid or expired (HTTP 401)');
      if (r.status === 403) throw new Error('Notion integration lacks access to this database (HTTP 403)');
      if (r.status === 404) throw new Error('Notion database not found — check DB ID (HTTP 404)');
      // Retry on 429 / 5xx only
      if ((r.status === 429 || r.status >= 500) && attempt < MAX_RETRIES - 1) {
        console.warn('[NotionSync] Retry ' + (attempt + 1) + '/' + MAX_RETRIES + ' — HTTP ' + r.status);
        return new Promise(function (resolve) {
          setTimeout(resolve, RETRY_DELAYS[attempt]);
        }).then(function () {
          return _fetchWithRetry(url, opts, attempt + 1);
        });
      }
      if (!r.ok) throw new Error('Notion API HTTP ' + r.status);
      return r.json();
    }).catch(function (err) {
      // Retry network errors (timeout, offline) but not 4xx client errors
      if (/HTTP [4]\d\d/.test(err.message)) throw err;
      if (attempt < MAX_RETRIES - 1) {
        console.warn('[NotionSync] Retry ' + (attempt + 1) + '/' + MAX_RETRIES + ' — ' + err.message);
        return new Promise(function (resolve) {
          setTimeout(resolve, RETRY_DELAYS[attempt]);
        }).then(function () {
          return _fetchWithRetry(url, opts, attempt + 1);
        });
      }
      throw err;
    });
  }

  /* ── Paginated Notion API query ────────────────────────────────── */
  function _queryDatabase(apiKey, dbId, lastSync) {
    var allPages = [];
    var baseFilter = null;

    if (lastSync) {
      baseFilter = {
        timestamp: 'last_edited_time',
        last_edited_time: { after: lastSync }
      };
    }

    function _fetchPage(cursor) {
      var body = { page_size: 100 };
      if (baseFilter) body.filter = baseFilter;
      if (cursor) body.start_cursor = cursor;

      var url = API_BASE + '/databases/' + dbId + '/query';
      var opts = {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
          'Notion-Version': API_VERSION
        },
        body: JSON.stringify(body)
      };

      return _fetchWithRetry(url, opts).then(function (data) {
        var results = (data && Array.isArray(data.results)) ? data.results : [];
        allPages = allPages.concat(results);

        // Continue if more pages and under hard cap
        if (data.has_more && data.next_cursor && allPages.length < MAX_PAGES * 100) {
          return _fetchPage(data.next_cursor);
        }
        return allPages;
      });
    }

    return _fetchPage(null);
  }

  /* ── Map a Notion page → SprintBrain snippet object ────────── */
  function _extractText(arr) {
    if (!Array.isArray(arr) || !arr.length) return '';
    return arr.map(function (b) { return b.plain_text || ''; }).join('');
  }

  function _mapPage(page) {
    var p = page.properties || {};

    // Title: database uses "Nome Snippet" as the title property
    var title = '';
    if (p['Nome Snippet'] && p['Nome Snippet'].title) title = _extractText(p['Nome Snippet'].title);
    else if (p['Title'] && p['Title'].title) title = _extractText(p['Title'].title);
    else if (p['Name'] && p['Name'].title) title = _extractText(p['Name'].title);

    var shortcut = p['Shortcut'] && p['Shortcut'].rich_text
      ? _extractText(p['Shortcut'].rich_text) : '';

    // Body: not a DB property — page content must be fetched separately.
    // For now, use empty string; body will be populated in a future iteration.
    var body = '';

    // Lang: does not exist in this DB — default to 'EN'
    var lang = 'EN';

    // Folder: map from "Categoria" (select) instead of "Folder" (rich_text)
    var folder = '';
    if (p['Categoria'] && p['Categoria'].select && p['Categoria'].select.name) {
      folder = p['Categoria'].select.name;
    }

    // Guard: skip pages missing required fields
    if (!title || !shortcut) return null;

    return {
      id:               'notion_' + page.id.replace(/-/g, ''),
      notion_page_id:   page.id,
      title:            title,
      shortcut:         shortcut,
      body:             body,
      lang:             lang,
      folder:           folder,
      sort_order:       0,
      fieldCfg:         {},
      lang_group_id:    'notion_' + page.id.replace(/-/g, ''),
      enable_urgency_timer: false,
      timer_duration_ms:    0,
      scarcity_count:       0
    };
  }

  /* ── Public API ─────────────────────────────────────────────── */

  /**
   * run(cfg, callbacks)
   *
   * cfg = { apiKey: '...', dbId: '...' }
   *
   * callbacks:
   *   onProgress(state)          → 'syncing' | 'idle'
   *   onComplete(snippets, ok)   → array of mapped snippets, success flag
   *   onError(err)               → called if API fails (non-blocking)
   */
  function run(cfg, callbacks) {
    var cb = callbacks || {};

    // Guard 1: session-level dedup
    if (_sessionDone) {
      if (cb.onComplete) cb.onComplete([], false);
      return;
    }

    // Guard 2: config required
    if (!cfg || !cfg.apiKey || !cfg.dbId) {
      if (cb.onComplete) cb.onComplete([], false);
      return;
    }

    // Guard 3: debounce — skip if last sync was < 60s ago
    _getLocal(SYNC_TS_KEY, function (lastSyncTs) {
      if (lastSyncTs) {
        var elapsed = Date.now() - new Date(lastSyncTs).getTime();
        if (elapsed < DEBOUNCE_MS) {
          console.log('[NotionSync] Skipped — last sync was ' + Math.round(elapsed / 1000) + ' seconds ago');
          if (cb.onComplete) cb.onComplete([], false);
          return;
        }
      }

      // Guard 4: process lock (race condition prevention)
      _acquireLock(function (acquired) {
        if (!acquired) {
          if (cb.onComplete) cb.onComplete([], false);
          return;
        }

        _sessionDone = true;
        if (cb.onProgress) cb.onProgress('syncing');

        var syncStart = new Date().toISOString();

        _queryDatabase(cfg.apiKey, cfg.dbId, lastSyncTs)
          .then(function (pages) {
            _releaseLock();
            var snippets = [];

            pages.forEach(function (page) {
              var s = _mapPage(page);
              if (s) snippets.push(s);
            });

            // Persist timestamp on success
            _setLocal(SYNC_TS_KEY, syncStart);

            // Save offline cache
            _setLocal(CACHE_KEY, snippets);

            console.log('[SprintBrain NotionSync] Sync complete —', snippets.length, 'snippet(s) fetched');
            if (cb.onProgress) cb.onProgress('idle');
            if (cb.onComplete) cb.onComplete(snippets, true);
          })
          .catch(function (err) {
            _releaseLock();
            console.warn('[SprintBrain NotionSync] Failed:', err.message, {
              timestamp: syncStart,
              dbId: cfg.dbId
            });
            if (cb.onProgress) cb.onProgress('idle');
            if (cb.onError) cb.onError(err);

            // Offline cache fallback
            _getLocal(CACHE_KEY, function (cached) {
              if (cached && Array.isArray(cached) && cached.length > 0) {
                console.log('[NotionSync] Offline — using cached snippets (' + cached.length + ' items)');
                if (cb.onComplete) cb.onComplete(cached, false);
              } else {
                if (cb.onComplete) cb.onComplete([], false);
              }
            });
          });
      });
    });
  }

  /** Reset session guard (useful on manual refresh) */
  function reset() { _sessionDone = false; }

  /** Expose last sync timestamp for debugging */
  function getLastSync(cb) { _getLocal(SYNC_TS_KEY, cb); }

  return { run: run, reset: reset, getLastSync: getLastSync };

})();
