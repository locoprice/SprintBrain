-- ADD-PROMPT-SHORTCUT · SprintBrain v2.83.0
-- Date: 2026-07-01
--
-- Adds an optional per-prompt shortcut so dashboard prompts can expand directly
-- in any text field (like snippets) when the user types the trigger + shortcut,
-- instead of only being reachable through the extension's """ picker menu.
--
-- Nullable — existing rows remain valid without migration. Base Prompts (built
-- into the extension) have no DB row and stay menu-only. No uniqueness
-- constraint: matching is client-side and snippets take precedence on collision,
-- mirroring how snippet shortcuts are already non-unique across language rows.

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS shortcut TEXT;
