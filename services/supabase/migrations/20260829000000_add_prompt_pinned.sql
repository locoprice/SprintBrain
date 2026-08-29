-- PROMPT-PIN-001: Persistent pin-to-top flag for prompts.
-- Mirrors snippets.pinned (20260518000000_add_snippet_pinned.sql). The mobile
-- companion held prompt pins in localStorage only, so a pin was lost whenever
-- the mobile browser evicted site storage. This column lets the pin survive
-- across sessions and devices.
--
-- No RLS change: the existing per-user UPDATE policy on prompts already covers
-- every column, so an owner can toggle this flag with the same PATCH the mobile
-- app already uses for last_used_at.

ALTER TABLE prompts
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
