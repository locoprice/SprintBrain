-- Phase B · B1 — LeibTour organization + memberships (the deferred Phase-A backfill)
--
-- Decision (resolved 2026-06-07, reversible — these are pure data rows):
--   The members are the accounts that demonstrably own SprintBrain team data
--   (and therefore must keep seeing shared content once is_shared retires in B5),
--   plus the one @leibtour.com address.
--     locopricesl@gmail.com    → admin  (repo owner; 90 snippets)
--     sprintbrainapp@gmail.com → admin  (primary app account; 46 snippets)
--     b2b@leibtour.com         → member (only @leibtour.com auth account)
--   Test / zero-data signups are intentionally excluded; add them by inserting a
--   row into organization_members if they turn out to be real members.
--
-- This step ONLY creates the org + membership rows. It does NOT touch existing
-- folders/snippets — personal data (organization_id IS NULL) stays personal.
-- Shared-snippet migration into an org folder happens in B4.
--
-- Reversible: delete the org row (cascades to members) — see rollback in PHASE_B_PLAN.md §4.

BEGIN;

WITH new_org AS (
  INSERT INTO organizations (name, slug, created_by)
  SELECT 'LeibTour', 'leibtour', u.id
    FROM auth.users u
   WHERE u.email = 'locopricesl@gmail.com'
  ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
  RETURNING id
)
INSERT INTO organization_members (organization_id, user_id, role)
SELECT o.id,
       u.id,
       CASE WHEN u.email IN ('locopricesl@gmail.com', 'sprintbrainapp@gmail.com')
            THEN 'admin'::org_role
            ELSE 'member'::org_role
       END
  FROM new_org o
  CROSS JOIN auth.users u
 WHERE u.email IN ('locopricesl@gmail.com', 'sprintbrainapp@gmail.com', 'b2b@leibtour.com')
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role;

COMMIT;
