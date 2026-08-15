-- INVITE-002 — resolve the inviter's name from the key the app actually writes.
--
-- Both invitation RPCs read `raw_user_meta_data->>'display_name'`, but nothing
-- writes that key: the dashboard's account settings store the display name as
-- `full_name` (app/src/lib/api/settingsApi.ts, editProfile), and read it back
-- through pickDisplayName() as `full_name ?? name`. Every lookup therefore fell
-- through to the email address — the first real invitation went out reading
-- "sprintbrainapp@gmail.com invited you" for an account whose full_name is "ALE".
--
-- Fallback order matches pickDisplayName's, except the last resort stays the
-- full email rather than its handle: these strings are shown to someone outside
-- the team, where a complete address is a trust signal and a bare handle is not.
--
-- NOTE: public.org_member_directory() has the identical defect and feeds the
-- team roster + share picker. It is deliberately NOT touched here — it belongs
-- to folder sharing, not invitations, and is tracked separately.

CREATE OR REPLACE FUNCTION public.my_pending_invitations()
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  org_name text,
  org_slug text,
  role org_role,
  invited_by_name text,
  expires_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT i.id,
         i.organization_id,
         o.name,
         o.slug,
         i.role,
         COALESCE(
           NULLIF(inviter.raw_user_meta_data->>'full_name', ''),
           NULLIF(inviter.raw_user_meta_data->>'name', ''),
           inviter.email
         )::text,
         i.expires_at,
         i.created_at
    FROM organization_invitations i
    JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN auth.users inviter ON inviter.id = i.invited_by
   WHERE i.status = 'pending'
     AND i.expires_at > now()
     AND lower(i.email) = app.caller_email()
     AND NOT EXISTS (
           SELECT 1 FROM organization_members m
            WHERE m.organization_id = i.organization_id
              AND m.user_id = auth.uid())
   ORDER BY i.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.my_pending_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_pending_invitations() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_invitations(p_org uuid)
RETURNS TABLE (
  id uuid,
  email text,
  role org_role,
  status text,
  expires_at timestamptz,
  created_at timestamptz,
  invited_by_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT i.id,
         i.email,
         i.role,
         CASE WHEN i.status = 'pending' AND i.expires_at <= now()
              THEN 'expired' ELSE i.status END,
         i.expires_at,
         i.created_at,
         COALESCE(
           NULLIF(u.raw_user_meta_data->>'full_name', ''),
           NULLIF(u.raw_user_meta_data->>'name', ''),
           u.email
         )::text
    FROM organization_invitations i
    LEFT JOIN auth.users u ON u.id = i.invited_by
   WHERE i.organization_id = p_org
     AND app.org_role(p_org) IN ('admin', 'manager')
     AND i.status IN ('pending', 'declined')
   ORDER BY i.created_at DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.org_invitations(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_invitations(uuid) TO authenticated, service_role;
