-- PROMPTS-NOTION-001 · SprintBrain v2.62.11
-- Date: 2026-06-19
--
-- Adds notion_page_id to prompts so the notion-prompt-push Edge Function
-- can persist a stable Notion page link (idempotent upsert on re-push).

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS notion_page_id TEXT DEFAULT NULL;
