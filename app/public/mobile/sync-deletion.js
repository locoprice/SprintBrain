/* SprintBrain — snippet deletion sync helpers (mobile companion).
 *
 * Pure, DOM-free delete control flow shared between the live mobile page
 * (loaded as a plain <script> before the inline app script — exposes
 * `SBMobileSync`) and the Vitest suite (required as CommonJS). ES5-compatible.
 */
/* global module */
(function (root) {
  'use strict';

  // Supabase REST filter scoping a hard delete to one row, by id AND user.
  function snippetDeleteQuery(id, userId) {
    return 'id=eq.' + encodeURIComponent(id) + '&user_id=eq.' + encodeURIComponent(userId);
  }

  // Local-cache sync: drop the deleted snippet from an in-memory list.
  function removeSnippetFromList(list, id) {
    return (list || []).filter(function (s) { return s && s.id !== id; });
  }

  // Real delete control flow. On success resolves with the NEW list so the
  // caller can update state, rewrite the localStorage cache, and refresh the UI.
  // Rejects without mutating anything on a 401 (session handler took over) or a
  // non-OK response, so the surface stays consistent with the unchanged backend.
  //
  // deps: { fetch, supaUrl, userId, headers, handle401, list }
  function performSnippetDelete(deps, snip) {
    return deps.fetch(
      deps.supaUrl + '/rest/v1/snippets?' + snippetDeleteQuery(snip.id, deps.userId),
      { method: 'DELETE', headers: deps.headers }
    ).then(function (r) {
      if (deps.handle401 && deps.handle401(r)) throw new Error('401');
      if (!r.ok) throw new Error('delete failed');
      return removeSnippetFromList(deps.list, snip.id);
    });
  }

  var api = {
    snippetDeleteQuery: snippetDeleteQuery,
    removeSnippetFromList: removeSnippetFromList,
    performSnippetDelete: performSnippetDelete
  };

  root.SBMobileSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
