-- Asset audit · updated_by — "Created by / Last modified by / Last update"
--
-- WHY
-- Shared-folder members can edit each other's assets (RLS-only writes since
-- v2.102.1), so user_id (the owner/creator — trigger-enforced immutable, F1)
-- no longer identifies the last person who touched a row. The dashboard's
-- attribution labels need a DB-maintained "last modifier":
--   * "Created by"        → existing user_id (immutable since insert)
--   * "Last modified by"  → updated_by (added here)
--   * "Last update"       → existing updated_at
--
-- STAMPING RULE (enforced in the DB regardless of client, like the tenancy
-- triggers): every content write bumps updated_at (dashboard helpers and
-- save_snippet_with_revision all set it explicitly); usage writes (e.g.
-- prompts.last_used_at) do not. The trigger therefore re-stamps updated_by
-- ONLY when updated_at changes, so using an asset never claims authorship and
-- a client can never spoof updated_by (the trigger always overwrites it).
-- Writes with no user context (service-role edge functions) preserve the
-- previous author via COALESCE.
--
-- Reversible: drop the two triggers + app.stamp_asset_audit(), then drop the
-- updated_by columns. The backfill (updated_by := user_id) is idempotent.

ALTER TABLE public.snippets
  ADD COLUMN updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.prompts
  ADD COLUMN updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Backfill before the audit triggers attach (an UPDATE afterwards would
-- preserve the still-NULL updated_by). The owner is the only known historical
-- modifier — correct for personal rows, best available for shared ones.
UPDATE public.snippets SET updated_by = user_id;
UPDATE public.prompts  SET updated_by = user_id;

-- BEFORE trigger, fires alphabetically ahead of trg_*_tenancy; the two touch
-- disjoint columns so order carries no behavior.
CREATE OR REPLACE FUNCTION app.stamp_asset_audit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.updated_by := COALESCE(auth.uid(), NEW.user_id);
  ELSIF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    NEW.updated_by := COALESCE(auth.uid(), OLD.updated_by);
  ELSE
    -- Usage-only write (updated_at untouched): keep the previous author.
    NEW.updated_by := OLD.updated_by;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_snippets_audit ON public.snippets;
CREATE TRIGGER trg_snippets_audit
  BEFORE INSERT OR UPDATE ON public.snippets
  FOR EACH ROW EXECUTE FUNCTION app.stamp_asset_audit();

DROP TRIGGER IF EXISTS trg_prompts_audit ON public.prompts;
CREATE TRIGGER trg_prompts_audit
  BEFORE INSERT OR UPDATE ON public.prompts
  FOR EACH ROW EXECUTE FUNCTION app.stamp_asset_audit();
