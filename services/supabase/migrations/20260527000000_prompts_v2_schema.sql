-- PROMPTS-V2 · SprintBrain v2.47.0
-- Date: 2026-05-27
--
-- Extends the prompts table with structured metadata for the Prompt Dashboard
-- cognitive OS: strategy_type, thinking_mode, preferred_model, complexity_level,
-- execution_type, intent_category, output_type, and a JSONB blocks column.
--
-- All new columns are nullable — existing rows remain valid without migration.

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS strategy_type    TEXT,
  ADD COLUMN IF NOT EXISTS thinking_mode    TEXT,
  ADD COLUMN IF NOT EXISTS preferred_model  TEXT,
  ADD COLUMN IF NOT EXISTS complexity_level TEXT,
  ADD COLUMN IF NOT EXISTS execution_type   TEXT,
  ADD COLUMN IF NOT EXISTS intent_category  TEXT,
  ADD COLUMN IF NOT EXISTS output_type      TEXT,
  ADD COLUMN IF NOT EXISTS blocks           JSONB;

-- Indexes for the two most-filtered dimensions
CREATE INDEX IF NOT EXISTS prompts_strategy_idx ON public.prompts (user_id, strategy_type);
CREATE INDEX IF NOT EXISTS prompts_intent_idx   ON public.prompts (user_id, intent_category);
