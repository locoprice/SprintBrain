-- "Ask User Questions" setting on prompts.
-- When true, the dashboard editor ends the saved prompt text (content) with a
-- short instruction telling the AI to ask clarifying questions before it
-- completes the task. Every surface that uses a prompt pastes content (the
-- in-page picker, the popup, Sprintbrain.html, mobile, the Notion mirror), so
-- the instruction reaches all of them without a client change there.
--
-- Defaults to FALSE so the prompts that already exist keep pasting exactly the
-- text they paste today (decided 2026-09-12). The editor switches the toggle on
-- for a new prompt and always sends the value explicitly.
--
-- No RLS or grant change: authenticated holds table-level privileges on
-- prompts (no column ACLs), and the existing policies cover every column, the
-- same way they covered pinned (20260829000000_add_prompt_pinned.sql).

ALTER TABLE prompts
  ADD COLUMN IF NOT EXISTS ask_user_questions BOOLEAN NOT NULL DEFAULT FALSE;
