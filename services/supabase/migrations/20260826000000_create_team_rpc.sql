-- create_team() — the missing primitive that lets a person start a team.
--
-- WHY THIS MUST BE SECURITY DEFINER. Two Phase A policies deadlock an ordinary
-- client-side create (20260606020000_phase_a_org_access_and_rls.sql):
--
--   org_insert    allows the `organizations` row (created_by = auth.uid())
--   orgmem_write  requires app.org_role(organization_id) = 'admin', which is
--                 NULL for an org that has no members yet
--
-- So the caller can create the organization and then cannot insert their own
-- membership row. The org is left with zero members, which also makes it
-- invisible to them (org_select requires app.is_org_member). Until this
-- function existed every organization in the product was created by hand in a
-- migration, and the dashboard had no create path at all.
--
-- Both inserts run in one statement's transaction, so a failure on the
-- membership row rolls the organization back rather than orphaning it.
--
-- ONE TEAM PER ACCOUNT, deliberately. orgApi.getActiveOrg() reads only the
-- caller's EARLIEST membership and there is no org switcher, so a second
-- organization would be created and then be unreachable. Rejecting it is
-- honest; creating an invisible row is not. Lift this check in the same change
-- that ships the switcher, not before.
--
-- Errors are human-readable strings, matching accept_org_invitation() — the
-- dashboard surfaces err.message directly rather than mapping codes.

CREATE OR REPLACE FUNCTION public.create_team(p_name text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_org  uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;

  IF v_name = '' THEN
    RAISE EXCEPTION 'Give your team a name' USING ERRCODE = '22023';
  END IF;

  IF length(v_name) > 60 THEN
    RAISE EXCEPTION 'Team names are 60 characters or fewer' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM organization_members WHERE user_id = v_user) THEN
    RAISE EXCEPTION 'You are already in a team. One team per account for now.'
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO organizations (name, created_by)
  VALUES (v_name, v_user)
  RETURNING id INTO v_org;

  -- The creator is the admin: without this row the organization above is
  -- unreachable, which is the whole reason this function exists.
  INSERT INTO organization_members (organization_id, user_id, role)
  VALUES (v_org, v_user, 'admin');

  RETURN v_org;
END; $$;

COMMENT ON FUNCTION public.create_team(text) IS
  'Create an organization and make the caller its admin, atomically. Exists because org_insert and orgmem_write deadlock a client-side create. Rejects a caller who already belongs to a team.';

REVOKE EXECUTE ON FUNCTION public.create_team(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team(text) TO authenticated, service_role;
