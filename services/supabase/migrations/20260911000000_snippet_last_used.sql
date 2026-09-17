-- INACTIVE-001 · SprintBrain
-- Date: 2026-09-11
--
-- Backs the "you have not used this since ..." notice with the date of the last
-- real expansion, per snippet.
--
-- Deliberately NOT snippet_stats.last_used. That column is written only when a
-- user copies a shortcut out of the popup: 29 rows, 13 of them with a date, on
-- an account holding 115 snippets. Ranking staleness on it would declare almost
-- the whole library unused. Real expansions are logged to snippet_events by the
-- extension's service worker and by the mobile companion, which is the same
-- table snippet_usage_counts() and the Analytics page already read.
--
-- Structurally this is snippet_usage_counts() with max(created_at) in place of
-- count(*), and that is on purpose: same join, same ACL branch, same definer
-- reasoning. The two answer "how often" and "how recently" about one event log,
-- and they must never disagree about WHICH snippets a caller may ask about.
--
-- SECURITY DEFINER for the reason given there: snippet_events RLS is select-own,
-- so a plain view would report a different last-use date to every member of a
-- team on the same shared snippet, and a teammate's use would look like no use
-- at all. The WHERE clause is a verbatim copy of the "snippets: select own" RLS
-- predicate, so this exposes dates for exactly the snippets the caller can
-- already read, and nothing else.
--
-- Orphaned events (over half the table points at snippets deleted or replaced
-- by Notion sync) are excluded by the join, the same way they are there. A
-- snippet that does not exist cannot be stale.
--
-- No new table and no new column: a snippet with no row in the result has never
-- been expanded, and each surface falls back to snippets.created_at. That
-- fallback lives in extension/shared/inactivity.js so all four surfaces share
-- one reading of "never used".

CREATE OR REPLACE FUNCTION public.snippet_last_used()
RETURNS TABLE(snippet_id text, last_used_at timestamptz)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT e.snippet_id, max(e.created_at)
    FROM snippet_events e
    JOIN snippets s ON s.id = e.snippet_id
   WHERE (auth.uid() = s.user_id)
      OR (s.organization_id IS NOT NULL
          AND s.folder_id IS NOT NULL
          AND app.can_read_folder(s.folder_id))
   GROUP BY e.snippet_id;
$$;

REVOKE ALL ON FUNCTION public.snippet_last_used() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snippet_last_used() TO authenticated;
