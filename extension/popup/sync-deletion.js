/* SprintBrain — snippet deletion sync helpers (pop-up).
 *
 * Pure, DOM-free, network-light delete logic shared between the live pop-up
 * (loaded as a plain <script> before popup.js — exposes `SBPopupSync`) and the
 * Vitest suite (required as CommonJS). Keep this ES5-compatible: no modules,
 * no arrow functions — it runs verbatim in the MV3 pop-up.
 */
/* global module */
(function (root) {
  'use strict';

  // Supabase REST filter that scopes a hard delete to exactly one snippet row.
  function snippetDeleteQuery(id) {
    return 'id=eq.' + id;
  }

  // Local-cache sync: drop the deleted snippet from an in-memory list, leaving
  // a new array (callers reassign + persist).
  function removeSnippetFromList(list, id) {
    return (list || []).filter(function (s) { return s && s.id !== id; });
  }

  // Fire-and-forget hard delete via the pop-up's supaFetch wrapper. Mirrors the
  // pop-up's optimistic design: the caller already removed the row from the
  // local cache; this issues the backend DELETE and reports failures via
  // onError. Returns the supaFetch promise so callers/tests can await it.
  function performSnippetDelete(supaFetch, id, onError) {
    return supaFetch('snippets', 'DELETE', null, snippetDeleteQuery(id)).catch(function (e) {
      if (onError) onError(e);
    });
  }

  var api = {
    snippetDeleteQuery: snippetDeleteQuery,
    removeSnippetFromList: removeSnippetFromList,
    performSnippetDelete: performSnippetDelete
  };

  root.SBPopupSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
