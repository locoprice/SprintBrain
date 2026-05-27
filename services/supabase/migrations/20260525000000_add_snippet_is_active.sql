-- SNIPPET-DISABLE-001: Soft-disable flag for snippets.
--
-- The dashboard now exposes a "Disable" action in the per-row settings
-- dropdown so users can temporarily turn off a snippet without deleting it
-- (preserves usage history + the row stays editable in the dashboard).
--
-- Behavior:
--   - is_active = TRUE  → snippet expands normally in the extension
--                         (context menu + ::trigger keystroke match)
--   - is_active = FALSE → snippet is hidden from the extension popup list and
--                         the right-click context menu, and will not expand
--                         when its shortcut is typed. The row remains visible
--                         in the dashboard so it can be re-enabled or edited.
--
-- Default TRUE so every pre-existing snippet keeps its current behavior.

ALTER TABLE snippets
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
