-- SNIPPET-SHARE-001: Team push-to-sync visibility flag.
-- Adds is_shared to snippets. Private by default (FALSE).
-- Set to TRUE for all snippets owned by a user via the
-- "Sincronizza Snippet con il Team" action.
--
-- RLS NOTE: The permissive team_* policies are still active (AUTH-EXT-001 pending),
-- so privacy is enforced at the application layer: the extension's loadData() and
-- DB.loadAll() filter on or=(user_id.eq.{uid},is_shared.eq.true).
-- The policy below documents intent; it becomes the sole guard once team_* drops.

ALTER TABLE snippets
  ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT FALSE;

-- Update the per-user select policy to also expose shared snippets.
-- Wrap in DO block so the migration doesn't fail if the policy doesn't exist
-- under that exact name (name may vary by environment).
DO $$
BEGIN
  DROP POLICY IF EXISTS "snippets_select_own" ON snippets;
  CREATE POLICY "snippets_select_own_or_shared" ON snippets
    FOR SELECT
    USING (auth.uid() = user_id OR is_shared = TRUE);
EXCEPTION WHEN OTHERS THEN
  -- Policy may already exist or table may not have RLS enabled yet; continue.
  RAISE NOTICE 'snippets_select_own_or_shared policy: %', SQLERRM;
END $$;
