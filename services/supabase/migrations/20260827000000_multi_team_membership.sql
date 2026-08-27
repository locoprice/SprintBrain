-- Multi-team membership: lift the one-team-per-account guard from create_team().
--
-- The guard existed for one reason only, recorded in 20260826000000: orgApi
-- read the caller's EARLIEST membership and there was no switcher, so a second
-- organization would be created and then be unreachable. Rejecting it was
-- honest while that was true.
--
-- The switcher ships alongside this migration (orgStore keeps the full list and
-- a persisted active choice), so a second team is now reachable and the guard
-- is the only thing standing between a user and their own team.
--
-- A cap replaces it. Unbounded org creation by any authenticated account is an
-- abuse vector with no legitimate use: ten teams is far past what a real person
-- needs and far below what an attacker would want. It is a ceiling, not a
-- product limit, so it says so in plain words when someone hits it.
--
-- Everything else about the function is unchanged, including the atomic
-- org + creator-as-admin insert that is the whole reason it is SECURITY DEFINER.
-- No listing RPC is added: `org_select` and `orgmem_select` already admit
-- exactly the caller's own memberships, so the dashboard reads the list under
-- ordinary RLS.

CREATE OR REPLACE FUNCTION public.create_team(p_name text)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_count int;
  v_org   uuid;
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

  SELECT count(*) INTO v_count FROM organization_members WHERE user_id = v_user;
  IF v_count >= 10 THEN
    RAISE EXCEPTION 'You can belong to 10 teams at most. Leave one to create another.'
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
  'Create an organization and make the caller its admin, atomically. Exists because org_insert and orgmem_write deadlock a client-side create. Capped at 10 memberships per account.';

REVOKE EXECUTE ON FUNCTION public.create_team(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_team(text) TO authenticated, service_role;
