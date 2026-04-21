-- AUTH-001 · SprintBrain v2.15.0
-- Applied via MCP: apply_migration name="auth_domain_allowlist_leibtour"
-- Date: 2026-04-21
--
-- Rejects new signups whose email does not end with @leibtour.com.
-- BEFORE INSERT trigger only affects new rows — existing accounts keep working.

CREATE OR REPLACE FUNCTION public.enforce_leibtour_domain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.email !~* '^[^@[:space:]]+@leibtour\.com$' THEN
    RAISE EXCEPTION 'Only @leibtour.com email addresses are permitted for signup. Attempted: %',
      NEW.email
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_leibtour_domain_on_signup ON auth.users;

CREATE TRIGGER enforce_leibtour_domain_on_signup
  BEFORE INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_leibtour_domain();

COMMENT ON FUNCTION public.enforce_leibtour_domain() IS
  'SprintBrain v2.15.0 — restricts signup to @leibtour.com emails. AUTH-001.';
