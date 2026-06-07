-- Phase B · B3 support — org_member_directory(): member identity for the
-- FolderShareModal principal picker.
--
-- organization_members only stores user_ids, and PostgREST does not expose
-- auth.users, so the dashboard cannot resolve teammate emails/names on its own.
-- This SECURITY DEFINER function returns the member directory for an org the
-- CALLER belongs to (guarded by app.is_org_member) — co-members only, never a
-- cross-org leak.

CREATE OR REPLACE FUNCTION public.org_member_directory(p_org uuid)
RETURNS TABLE (user_id uuid, email text, display_name text, role org_role)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT m.user_id,
         u.email::text,
         COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), u.email)::text,
         m.role
  FROM organization_members m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.organization_id = p_org
    AND app.is_org_member(p_org)
  ORDER BY m.role, u.email;
$$;

REVOKE EXECUTE ON FUNCTION public.org_member_directory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_member_directory(uuid) TO authenticated, service_role;
