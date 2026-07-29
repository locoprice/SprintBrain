-- STATUS-ICONS-002 · SprintBrain
-- Date: 2026-07-29
--
-- Fixes the data source behind the "top snippet" badge and the dashboard's
-- Usage column.
--
-- `snippet_stats.uses` is NOT an expansion counter. It is written only by
-- popup.js `DB.updateStats`, which fires when a user copies a shortcut out of
-- the popup — 96 recorded events across 48 snippets. Real expansions are logged
-- by the extension's service worker to `snippet_events` (background.js), which
-- holds 1735 rows across 159 snippets and is what the Analytics page has always
-- read. Ranking on `snippet_stats` therefore inverted the leaderboard: it put
-- `neob` on top at 21 while `time` — the actual most-used snippet, 163
-- expansions across its four language variants — showed 3.
--
-- `snippet_events` cannot be embedded from `snippets` via PostgREST: there is no
-- FK, and one cannot be added because 908 of 1735 events (52%) are orphaned,
-- pointing at snippets that have since been deleted or replaced by Notion sync.
-- Those orphans are correctly excluded here — a snippet that no longer exists
-- cannot carry a badge — via the join to `snippets`.
--
-- SECURITY DEFINER, mirroring public.shared_snippet_last_use(): `snippet_events`
-- RLS is select-own, so a plain view would show each teammate only their own
-- expansions of a SHARED snippet, and the same row would report a different
-- count to every member. The WHERE clause is a verbatim copy of the
-- "snippets: select own" RLS predicate, so this exposes counts for exactly the
-- snippets the caller can already read — no more.

CREATE OR REPLACE FUNCTION public.snippet_usage_counts()
RETURNS TABLE(snippet_id text, uses bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT e.snippet_id, count(*)::bigint
    FROM snippet_events e
    JOIN snippets s ON s.id = e.snippet_id
   WHERE (auth.uid() = s.user_id)
      OR (s.organization_id IS NOT NULL
          AND s.folder_id IS NOT NULL
          AND app.can_read_folder(s.folder_id))
   GROUP BY e.snippet_id;
$$;

REVOKE ALL ON FUNCTION public.snippet_usage_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snippet_usage_counts() TO authenticated;
