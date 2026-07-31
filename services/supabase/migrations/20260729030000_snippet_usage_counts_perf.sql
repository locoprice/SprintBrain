-- STATUS-ICONS-004 · SprintBrain
-- Date: 2026-07-29
--
-- Performance rewrite of snippet_usage_counts(). Behaviour is unchanged — same
-- rows, same totals, same ACL — but it runs 34x faster.
--
-- The first version filtered with `... OR app.can_read_folder(s.folder_id)`
-- directly in the WHERE of a join across every event row. Because the function
-- is SECURITY DEFINER, RLS is bypassed inside it, so `snippets` was scanned in
-- full and `app.can_read_folder` — itself a SECURITY DEFINER doing recursive
-- folder/permission lookups — was evaluated for roughly every non-owned snippet.
-- Measured 523 ms under real user claims, on every dashboard load and every
-- extension popup open.
--
-- This version aggregates the events first (cheap, and now index-backed), then
-- narrows to the snippets that actually have events, and evaluates
-- `app.can_read_folder` once per DISTINCT folder among those candidates — a
-- handful of calls instead of a hundred. Measured 15 ms for the same 77 rows.
--
-- The ACL is still a verbatim copy of the "snippets: select own" RLS predicate.
-- Verified after the rewrite: leaked_rows = 0 for both real users (no row is
-- returned that normal RLS on `snippets` would hide), and a fabricated identity
-- sees 0 rows.

CREATE OR REPLACE FUNCTION public.snippet_usage_counts()
RETURNS TABLE(snippet_id text, uses bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  WITH counts AS (
    SELECT e.snippet_id AS sid, count(*)::bigint AS uses
      FROM snippet_events e
     WHERE e.snippet_id IS NOT NULL
     GROUP BY e.snippet_id
  ),
  cand AS (
    SELECT s.id, s.user_id, s.organization_id, s.folder_id
      FROM snippets s
      JOIN counts c ON c.sid = s.id
  ),
  readable AS (
    SELECT f.folder_id
      FROM (SELECT DISTINCT k.folder_id FROM cand k WHERE k.folder_id IS NOT NULL) f
     WHERE app.can_read_folder(f.folder_id)
  )
  SELECT c.sid, c.uses
    FROM counts c
    JOIN cand k ON k.id = c.sid
   WHERE auth.uid() = k.user_id
      OR (k.organization_id IS NOT NULL
          AND k.folder_id IN (SELECT folder_id FROM readable));
$$;

REVOKE ALL ON FUNCTION public.snippet_usage_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.snippet_usage_counts() TO authenticated;
