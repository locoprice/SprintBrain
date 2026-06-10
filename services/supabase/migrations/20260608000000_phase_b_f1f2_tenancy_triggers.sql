-- Phase B follow-up · F1 + F2 + E2 — asset/folder tenancy triggers
--
-- WHY
-- The Phase B RLS authenticates the *folder* but never enforced consistency
-- between an asset's organization_id, its folder's organization_id, and grant
-- principals' org. Three concrete consequences (see docs/PHASE_B_SOAK.md §1.1 +
-- the 2026-06-08 security review):
--   F1 — an "Edit" grantee could rewrite user_id / organization_id and pull a
--        shared asset out of the org (ownership steal / exfiltration). RLS
--        WITH CHECK cannot express "column X did not change".
--   F2 — nothing forced asset.org == folder.org, so attribution could drift /
--        a non-owner could move an org asset into another org's folder.
--   E2 — the dashboard never stamped organization_id on assets created in /
--        moved into an already-shared folder, so the cascade silently stopped
--        for everything added after the share. (20 live snippets already sit in
--        "Team Shared" with organization_id = NULL → invisible to teammates.)
--
-- FIX (one invariant, enforced in the DB regardless of client):
--   * an asset's organization_id is ALWAYS its folder's organization_id
--     (NULL when unfiled) — derived by trigger, never trusted from the client;
--   * user_id is immutable after insert;
--   * moving an org asset OUT of its org (to personal or another org) is an
--     ownership action — only the folder owner or an org admin may;
--   * a folder may only be shared into an org the owner belongs to, and only an
--     org admin may re-home/un-share an org folder; folder org changes cascade
--     to the contained assets.
--
-- Reversible: drop the four triggers + three functions; the backfill is a
-- data alignment (asset.org := folder.org) and is itself idempotent.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Backfill existing rows so the invariant holds BEFORE the triggers attach.
--    (Runs with no triggers present, so it is not subject to the move guard.)
--      • 20 snippets in "Team Shared" (org NULL) → org = leibtour  (fixes E2 live;
--        makes them visible to the team, which is the point of that folder)
--      • 6 snippets org=leibtour with no folder   → org = NULL     (orphan cleanup;
--        already invisible to the org, so no visibility change)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE snippets s
   SET organization_id = f.organization_id
  FROM folders f
 WHERE s.folder_id = f.id
   AND s.organization_id IS DISTINCT FROM f.organization_id;
UPDATE snippets s
   SET organization_id = NULL
 WHERE s.folder_id IS NULL AND s.organization_id IS NOT NULL;

UPDATE prompts p
   SET organization_id = f.organization_id
  FROM folders f
 WHERE p.folder_id = f.id
   AND p.organization_id IS DISTINCT FROM f.organization_id;
UPDATE prompts p
   SET organization_id = NULL
 WHERE p.folder_id IS NULL AND p.organization_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Asset tenancy guard (snippets + prompts). BEFORE INSERT OR UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.enforce_asset_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_folder_org uuid;
BEGIN
  -- F1: ownership is immutable once set.
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id;
  END IF;

  -- E2 / F2: an asset's organization is ALWAYS its folder's organization
  -- (NULL when unfiled). Never trust a client-supplied organization_id.
  IF NEW.folder_id IS NULL THEN
    v_folder_org := NULL;
  ELSE
    SELECT organization_id INTO v_folder_org FROM folders WHERE id = NEW.folder_id;
  END IF;
  NEW.organization_id := v_folder_org;

  -- F1 / F2: moving an org asset OUT of its organization (to personal or another
  -- org) is an ownership-level action — only the folder owner or an org admin may.
  IF TG_OP = 'UPDATE'
     AND OLD.organization_id IS NOT NULL
     AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    IF NOT ( app.org_role(OLD.organization_id) = 'admin'
             OR app.folder_level(OLD.folder_id) = 'owner' ) THEN
      RAISE EXCEPTION
        'tenancy: only the folder owner or an org admin may move this asset out of its organization'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Folder tenancy guard. BEFORE INSERT OR UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.enforce_folder_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id;  -- ownership immutable

    IF OLD.organization_id IS NULL AND NEW.organization_id IS NOT NULL THEN
      -- sharing a personal folder into an org: owner only, into an org you belong to
      IF NOT (auth.uid() = OLD.user_id AND app.is_org_member(NEW.organization_id)) THEN
        RAISE EXCEPTION
          'tenancy: you may only share your own folder into an organization you belong to'
          USING ERRCODE = 'check_violation';
      END IF;
    ELSIF OLD.organization_id IS NOT NULL
          AND NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      -- re-homing or un-sharing an org folder: org admin only
      IF NOT (app.org_role(OLD.organization_id) = 'admin') THEN
        RAISE EXCEPTION
          'tenancy: only an org admin may move this folder out of its organization'
          USING ERRCODE = 'check_violation';
      END IF;
    END IF;

  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.organization_id IS NOT NULL AND NOT app.is_org_member(NEW.organization_id) THEN
      RAISE EXCEPTION
        'tenancy: cannot create a folder in an organization you do not belong to'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Folder → asset org cascade. AFTER UPDATE. Keeps contained assets aligned
--    with the folder's org regardless of which path changed it (incl. raw SQL).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app.cascade_folder_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    UPDATE snippets SET organization_id = NEW.organization_id
      WHERE folder_id = NEW.id AND organization_id IS DISTINCT FROM NEW.organization_id;
    UPDATE prompts  SET organization_id = NEW.organization_id
      WHERE folder_id = NEW.id AND organization_id IS DISTINCT FROM NEW.organization_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Attach triggers.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_snippets_tenancy ON snippets;
CREATE TRIGGER trg_snippets_tenancy
  BEFORE INSERT OR UPDATE ON snippets
  FOR EACH ROW EXECUTE FUNCTION app.enforce_asset_tenancy();

DROP TRIGGER IF EXISTS trg_prompts_tenancy ON prompts;
CREATE TRIGGER trg_prompts_tenancy
  BEFORE INSERT OR UPDATE ON prompts
  FOR EACH ROW EXECUTE FUNCTION app.enforce_asset_tenancy();

DROP TRIGGER IF EXISTS trg_folders_tenancy ON folders;
CREATE TRIGGER trg_folders_tenancy
  BEFORE INSERT OR UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION app.enforce_folder_tenancy();

DROP TRIGGER IF EXISTS trg_folders_org_cascade ON folders;
CREATE TRIGGER trg_folders_org_cascade
  AFTER UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION app.cascade_folder_org();

COMMIT;
