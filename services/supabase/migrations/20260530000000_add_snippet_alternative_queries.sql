BEGIN;

-- Add alternative_queries column: array of keyword synonyms for improved
-- context-based snippet matching (ALTERNATIVE-QUERIES-001).
ALTER TABLE snippets
  ADD COLUMN IF NOT EXISTS alternative_queries TEXT[] NOT NULL DEFAULT '{}';

-- GIN index enables efficient containment / overlap queries on the array.
CREATE INDEX IF NOT EXISTS idx_snippets_alternative_queries
  ON snippets USING GIN (alternative_queries);

-- Replace save_snippet_with_revision to forward the new column through the
-- atomic snippet-update + revision-insert RPC used by the dashboard edit dialog.
CREATE OR REPLACE FUNCTION save_snippet_with_revision(
  p_snippet_id            uuid,
  p_title                 text,
  p_shortcut              text,
  p_body                  text,
  p_bodies                jsonb,
  p_lang                  text,
  p_folder_id             uuid,
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
  PERFORM 1
    FROM snippets
   WHERE id = p_snippet_id
     AND (user_id = v_uid OR is_shared = TRUE)
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

GRANT EXECUTE ON FUNCTION save_snippet_with_revision TO authenticated;

COMMIT;
