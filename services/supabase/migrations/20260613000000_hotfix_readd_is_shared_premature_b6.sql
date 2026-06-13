-- HOTFIX · re-add snippets.is_shared (reverse the premature B6 column drop)
--
-- WHY: B6 (20260609000000_phase_b_b6_drop_is_shared.sql) dropped
-- `snippets.is_shared`, but not-yet-updated clients still request it:
--   • deployed dashboard < v2.61.0 → SELECT includes `…,is_shared,…`
--   • installed extension  < v2.60.0 → filters `or=(user_id.eq.<uid>,is_shared.eq.true)`
-- Post-drop, PostgREST rejects both with HTTP 400
-- ("column snippets.is_shared does not exist"), so the dashboard shows
-- "Failed to load snippets" and the extension/popup load an empty library.
-- The 158 snippet rows were never affected — this is a read-shape mismatch.
--
-- PHASE_B_SOAK.md §5 sequencing rule: the column may only be dropped AFTER every
-- reader is off it (criterion C4, client adoption, was still pending). B6
-- contracted too early; this reverses that step.
--
-- SAFETY: B5 (20260607040000) already removed the `is_shared = true` RLS read
-- branch, and this migration does NOT re-add it. The column is therefore
-- access-control-inert — folder ACL (app.can_read_folder) remains the sole
-- org-share path, so re-adding the column introduces NO cross-tenant exposure.
-- Faithful to the original definition (20260509000000_add_snippet_sharing.sql):
-- BOOLEAN NOT NULL DEFAULT FALSE → existing rows + omitting-clients get false.
--
-- FOLLOW-UP: once dashboard is on >= v2.61.x everywhere and all extension users
-- are >= v2.60.0 (verify via API logs: zero app-originated is_shared traffic),
-- re-apply B6 to drop the column again.

ALTER TABLE public.snippets
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Refresh PostgREST's schema cache so REST clients see the column immediately.
NOTIFY pgrst, 'reload schema';
