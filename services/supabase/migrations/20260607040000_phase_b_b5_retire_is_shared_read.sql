-- Phase B · B5 — retire the is_shared global-read policy
--
-- Before B5 the snippets SELECT policy exposed every `is_shared = true` row to
-- EVERY authenticated user — a single-tenant convenience that becomes a
-- cross-tenant leak the moment a second org has data (ENTERPRISE_ARCHITECTURE
-- §8 R2). B4 moved all 35 shared snippets into the org "Team Shared" folder with
-- org-wide VIEW, and parity was verified (every LeibTour member still sees all
-- 35 via the folder ACL), so dropping the is_shared branch removes access for
-- NON-members only — exactly the intended fix.
--
-- The is_shared COLUMN is intentionally kept: the currently-deployed extension
-- still filters `is_shared.eq.true` over REST, and those rows remain visible to
-- members through the new folder branch. The column is dropped in B6 after the
-- permission-aware extension ships and a soak period passes.
--
-- prior policy (for rollback — re-add the is_shared branch to restore B4 state):
--   CREATE POLICY "snippets: select own or shared" ON snippets FOR SELECT TO authenticated
--   USING (auth.uid() = user_id OR is_shared = true
--     OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_read_folder(folder_id)));

BEGIN;

DROP POLICY "snippets: select own or shared" ON snippets;

CREATE POLICY "snippets: select own" ON snippets FOR SELECT TO authenticated
USING (
  auth.uid() = user_id
  OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_read_folder(folder_id))
);

COMMIT;
