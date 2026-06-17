-- Phase B · B0 — snippet_revisions (corrected types) + folder-aware save RPC
--
-- WHY THIS EXISTS
-- The original 20260528000000_snippet_revisions.sql was never applied to
-- production: it declared `snippet_id uuid REFERENCES snippets(id)`, but
-- snippets.id is TEXT — that DDL errors out. The companion RPC inherited the
-- same uuid/text mismatch, so the version-history save path has never worked
-- for the 108/139 non-uuid legacy snippet ids either.
--
-- This migration applies the table with the correct TEXT key and rebuilds the
-- RPC with TEXT id params. It also replaces the RPC's write guard:
--   before: `user_id = auth.uid() OR is_shared = TRUE`  ← any signed-in user
--           could overwrite ANY shared snippet (the leak the 2026-06-06 harden
--           migration flagged but could not fully close while is_shared lived).
--   after:  personal owner OR folder edit/owner via app.can_write_folder().
--
-- Reversible: `DROP TABLE snippet_revisions;` + restore the prior RPC body.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- snippet_revisions — immutable, append-only audit trail of content saves.
-- snippet_id is TEXT to match snippets.id.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snippet_revisions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snippet_id     text        NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
  version_number integer     NOT NULL CHECK (version_number > 0),
  editor_id      uuid        NOT NULL REFERENCES auth.users(id),
  editor_display text        NOT NULL,   -- denormalized email/display name at save time
  title          text        NOT NULL,
  body           text        NOT NULL DEFAULT '',
  bodies         jsonb       NOT NULL DEFAULT '{}',
  edit_note      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snippet_id, version_number)
);

CREATE INDEX IF NOT EXISTS snippet_revisions_snippet_id_idx
  ON snippet_revisions (snippet_id, version_number DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — revisions inherit the parent snippet's visibility.
-- Personal owner OR folder-readable (org branch). No is_shared global read:
-- this is a new table, so there is no legacy behavior to preserve, and Phase B
-- is retiring is_shared anyway.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE snippet_revisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snippet_revisions_select"
  ON snippet_revisions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM snippets s
      WHERE s.id = snippet_revisions.snippet_id
        AND ( s.user_id = auth.uid()
           OR ( s.organization_id IS NOT NULL
                AND s.folder_id IS NOT NULL
                AND app.can_read_folder(s.folder_id) ) )
    )
  );

CREATE POLICY "snippet_revisions_insert"
  ON snippet_revisions FOR INSERT
  TO authenticated
  WITH CHECK (
    editor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM snippets s
      WHERE s.id = snippet_revisions.snippet_id
        AND ( s.user_id = auth.uid()
           OR ( s.organization_id IS NOT NULL
                AND s.folder_id IS NOT NULL
                AND app.can_write_folder(s.folder_id) ) )
    )
  );

-- No UPDATE/DELETE policies — revisions are append-only.

GRANT SELECT, INSERT ON snippet_revisions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- save_snippet_with_revision(…) — atomic snippet update + revision insert.
-- Rebuilt with TEXT id params and a folder-aware write guard.
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop the broken uuid-typed overload first (a CREATE OR REPLACE with new arg
-- types would create a second, ambiguous overload instead of replacing it).
DROP FUNCTION IF EXISTS public.save_snippet_with_revision(
  uuid, text, text, text, jsonb, text, uuid, boolean, boolean, boolean,
  integer, integer, text, text, text[]
);

CREATE OR REPLACE FUNCTION save_snippet_with_revision(
  p_snippet_id            text,
  p_title                 text,
  p_shortcut              text,
  p_body                  text,
  p_bodies                jsonb,
  p_lang                  text,
  p_folder_id             text,
  p_pinned                boolean,
  p_is_shared             boolean,
  p_enable_urgency_timer  boolean,
  p_timer_duration_ms     integer,
  p_scarcity_count        integer,
  p_editor_display        text,
  p_edit_note             text          DEFAULT NULL,
  p_alternative_queries   text[]        DEFAULT '{}'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next  integer;
  v_uid   uuid := auth.uid();
BEGIN
  -- Validate WRITE access and lock the row to serialise concurrent saves.
  -- Personal owner OR org-folder edit/owner. The old is_shared = TRUE branch
  -- is intentionally gone — sharing now grants write only via a folder ACL.
  PERFORM 1
    FROM snippets
   WHERE id = p_snippet_id
     AND ( user_id = v_uid
        OR ( organization_id IS NOT NULL
             AND folder_id IS NOT NULL
             AND app.can_write_folder(folder_id) ) )
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snippet not found or access denied (id=%)', p_snippet_id;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
    FROM snippet_revisions
   WHERE snippet_id = p_snippet_id;

  INSERT INTO snippet_revisions
    (snippet_id, version_number, editor_id, editor_display, title, body, bodies, edit_note)
  VALUES
    (p_snippet_id, v_next, v_uid, p_editor_display, p_title, p_body, p_bodies, p_edit_note);

  UPDATE snippets
     SET title                 = p_title,
         shortcut              = p_shortcut,
         body                  = p_body,
         bodies                = p_bodies,
         lang                  = p_lang,
         folder_id             = p_folder_id,
         pinned                = p_pinned,
         is_shared             = p_is_shared,
         enable_urgency_timer  = p_enable_urgency_timer,
         timer_duration_ms     = p_timer_duration_ms,
         scarcity_count        = p_scarcity_count,
         alternative_queries   = p_alternative_queries,
         updated_at            = now()
   WHERE id = p_snippet_id;

  RETURN v_next;
END;
$$;

-- Authenticated callers only (mirrors the 2026-06-06 hardening).
REVOKE EXECUTE ON FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean, boolean,
  integer, integer, text, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean, boolean,
  integer, integer, text, text, text[]
) TO authenticated, service_role;

COMMIT;
