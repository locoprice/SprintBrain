-- ── Shared-snippet last-use attribution ─────────────────────────────────────
-- The mobile companion shows "Last used by: NAME | Date | Time" on team-shared
-- snippet cards. snippet_events RLS is select-own (auth.uid() = user_id), so a
-- teammate cannot read who else used a shared snippet directly. This SECURITY
-- DEFINER function exposes ONLY the latest event per ORG-SHARED snippet the
-- caller can read — the same ACL branch accessible_snippets() uses — and
-- resolves the actor's display name the way org_member_directory() does
-- (display_name → email fallback). Events are trustworthy: the insert policy's
-- WITH CHECK (auth.uid() = user_id) guarantees user_id is the real actor.

CREATE OR REPLACE FUNCTION public.shared_snippet_last_use()
RETURNS TABLE(snippet_id text, used_at timestamptz, used_by uuid, used_by_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT DISTINCT ON (e.snippet_id)
         e.snippet_id,
         e.created_at,
         e.user_id,
         COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), u.email)::text
    FROM snippet_events e
    JOIN snippets s ON s.id = e.snippet_id
    LEFT JOIN auth.users u ON u.id = e.user_id
   WHERE s.organization_id IS NOT NULL
     AND s.folder_id IS NOT NULL
     AND app.can_read_folder(s.folder_id)
   ORDER BY e.snippet_id, e.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.shared_snippet_last_use() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shared_snippet_last_use() TO authenticated;
