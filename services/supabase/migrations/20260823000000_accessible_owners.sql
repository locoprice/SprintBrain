-- accessible_owners() — resolves a snippet's owner (user_id) to a display
-- name, for the mobile info sheet's new "Owner" row.
--
-- snippets.user_id is stamped once and made immutable by the Phase B tenancy
-- trigger (20260608000000_phase_b_f1f2_tenancy_triggers.sql) — sharing is
-- folder-ACL only, ownership never transfers. So "owner" and "creator" are the
-- same value here; there is no second field to add.
--
-- PostgREST does not expose auth.users, and snippets RLS only lets a caller
-- read THEIR OWN row of a teammate's snippet metadata, not that teammate's
-- name — the same gap org_member_directory() and shared_snippet_last_use()
-- exist to close. This is the same shape: SECURITY DEFINER, gated by the exact
-- ACL accessible_snippets() already uses (own + org-shared via
-- app.can_read_folder), so it can only ever name someone whose snippet the
-- caller could already read in full.
--
-- Scoped to snippets only: prompts have no equivalent info view on mobile yet,
-- so there is nothing to wire an owner name into today. Extend this with a
-- prompts UNION branch when that view exists, rather than shipping an unused
-- code path now.

CREATE OR REPLACE FUNCTION public.accessible_owners()
RETURNS TABLE(owner_id uuid, owner_name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT DISTINCT u.id,
         COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), u.email)::text
    FROM auth.users u
   WHERE u.id IN (
     SELECT s.user_id
       FROM snippets s
      WHERE s.user_id = auth.uid()
         OR (s.organization_id IS NOT NULL
             AND s.folder_id IS NOT NULL
             AND app.can_read_folder(s.folder_id))
   );
$$;

COMMENT ON FUNCTION public.accessible_owners() IS
  'Owner id -> display name for every snippet the caller can read (own + org-shared). Mirrors shared_snippet_last_use()''s identity-resolution shape.';

REVOKE ALL ON FUNCTION public.accessible_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accessible_owners() TO authenticated;
