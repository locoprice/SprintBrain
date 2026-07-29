-- STATUS-ICONS-001 · SprintBrain
-- Date: 2026-07-29
--
-- Backs the animated status badges with real columns:
--   prompts.usage_count   — prompts had no counter at all (only last_used_at),
--                           so "top prompt" was previously underivable. Brings
--                           the prompt model in line with snippet_stats.uses.
--   prompts.is_malformed  — template validation verdict, persisted on write.
--   snippets.is_malformed — same verdict for snippets, so both asset types are
--                           filterable server-side by the same predicate.
--
-- Both flags are written by the shared TemplateValidator on every create/update
-- (extension/formula-engine.js `validateTemplate`, mirrored in
-- app/src/lib/statusSignals.ts). The dashboard and popup ALSO validate live at
-- render time, so a row whose flag is stale can never surface a wrong badge —
-- the column is the queryable mirror, the live check is the source of truth.
--
-- NOT NULL + DEFAULT on Postgres 11+ is a catalogue-only change: no table
-- rewrite, no ACCESS EXCLUSIVE hold beyond the catalogue update. Existing rows
-- backfill to 0 / FALSE implicitly.

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS usage_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.prompts
  ADD COLUMN IF NOT EXISTS is_malformed BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.snippets
  ADD COLUMN IF NOT EXISTS is_malformed BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Atomic usage increment ──────────────────────────────────────────────────
-- PostgREST cannot express `usage_count = usage_count + 1`, so a read-modify-
-- write from the client would drop increments whenever the same prompt is used
-- from two surfaces at once. This does it in one statement: the row lock Postgres
-- takes for the UPDATE serialises concurrent callers, so every execution counts.
--
-- SECURITY INVOKER (the default) on purpose — RLS applies exactly as it does to
-- the plain `last_used_at` update this replaces, so a teammate using a shared
-- prompt increments it under the same folder-ACL branch and no new permission
-- surface is introduced.
--
-- `updated_at` is deliberately left alone: using a prompt is not editing it.
-- app.stamp_asset_audit already treats an updated_at-untouched write as a
-- usage-only write and preserves the previous `updated_by`.
CREATE OR REPLACE FUNCTION public.increment_prompt_usage(p_prompt_id uuid)
RETURNS TABLE(id uuid, usage_count integer, last_used_at timestamptz)
LANGUAGE sql
VOLATILE
SET search_path TO 'public'
AS $$
  UPDATE public.prompts p
     SET usage_count  = p.usage_count + 1,
         last_used_at = now()
   WHERE p.id = p_prompt_id
  RETURNING p.id, p.usage_count, p.last_used_at;
$$;

REVOKE ALL ON FUNCTION public.increment_prompt_usage(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_prompt_usage(uuid) TO authenticated;
