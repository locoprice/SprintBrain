-- SNIPPETS-PER-LANG-001: Per-language body slots for snippets.
-- Previously snippets had a single `body` column plus a `lang` tag. Clicking a
-- language pill in the dashboard edit modal felt like switching between four
-- parallel bodies, but actually overwrote the single column on save — the
-- previous language's text was silently lost.
--
-- This migration adds a `bodies` JSONB column whose keys are 'EN'/'IT'/'ES'/
-- 'FR'/'MULTI'. The dashboard now keeps a body per language; `body` stays as
-- a denormalized mirror of `bodies[lang]` so the Chrome extension (which
-- reads `body` directly) keeps working without changes.

ALTER TABLE snippets
  ADD COLUMN IF NOT EXISTS bodies JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: seed bodies with the current body under whichever lang the row
-- already has. Rows with NULL/empty lang fall back to MULTI to match
-- dashboard's normalizeLang() behavior.
UPDATE snippets
   SET bodies = jsonb_build_object(
         CASE
           WHEN UPPER(COALESCE(lang, '')) IN ('EN', 'IT', 'ES', 'FR', 'MULTI')
             THEN UPPER(lang)
           ELSE 'MULTI'
         END,
         COALESCE(body, '')
       )
 WHERE bodies = '{}'::jsonb;
