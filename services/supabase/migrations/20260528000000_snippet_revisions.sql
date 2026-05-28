BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- snippet_revisions — immutable audit trail of snippet content saves.
--
-- Each row is a snapshot of (title, body, bodies) captured at the moment the
-- user clicks "Save changes" in the dashboard. version_number is 1-indexed and
-- strictly increases per snippet (guaranteed by the FOR UPDATE lock in the
-- companion function below).
--
-- Revisions are never updated or deleted by application code. Cascaded
-- deletes from snippets(id) are the only removal path.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS snippet_revisions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  snippet_id     uuid        NOT NULL REFERENCES snippets(id) ON DELETE CASCADE,
  version_number integer     NOT NULL CHECK (version_number > 0),
  editor_id      uuid        NOT NULL REFERENCES auth.users(id),
  editor_display text        NOT NULL,  -- denormalized; email or display name at save time
  title          text        NOT NULL,
  body           text        NOT NULL DEFAULT '',
  bodies         jsonb       NOT NULL DEFAULT '{}',
  edit_note      text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snippet_id, version_number)
);

-- Fast lookup for "all revisions of snippet X, newest first"
CREATE INDEX IF NOT EXISTS snippet_revisions_snippet_id_idx
  ON snippet_revisions (snippet_id, version_number DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE snippet_revisions ENABLE ROW LEVEL SECURITY;

-- SELECT: user owns the parent snippet OR the snippet is team-shared
CREATE POLICY "snippet_revisions_select"
  ON snippet_revisions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM snippets s
      WHERE s.id = snippet_revisions.snippet_id
        AND (s.user_id = auth.uid() OR s.is_shared = TRUE)
    )
  );

-- INSERT: caller must be the editor, and must have access to the snippet
CREATE POLICY "snippet_revisions_insert"
  ON snippet_revisions FOR INSERT
  TO authenticated
  WITH CHECK (
    editor_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM snippets s
      WHERE s.id = snippet_revisions.snippet_id
        AND (s.user_id = auth.uid() OR s.is_shared = TRUE)
    )
  );

-- No UPDATE or DELETE policies — revisions are append-only.

GRANT SELECT, INSERT ON snippet_revisions TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- save_snippet_with_revision(…) — atomic save + revision in one transaction.
--
-- Updates ALL editable fields on the snippet and appends a revision capturing
-- the new (title, body, bodies) state. The FOR UPDATE lock on the snippet row
-- serialises concurrent edits and prevents duplicate version_numbers.
--
-- Parameters mirror SnippetFormValues in app/src/types/schemas.ts.
-- Returns the new version_number (integer).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION save_snippet_with_revision(
  p_snippet_id          uuid,
  p_title               text,
  p_shortcut            text,
  p_body                text,
  p_bodies              jsonb,
  p_lang                text,
  p_folder_id           uuid,
  p_pinned              boolean,
  p_is_shared           boolean,
  p_enable_urgency_timer boolean,
  p_timer_duration_ms   integer,
  p_scarcity_count      integer,
  p_editor_display      text,
  p_edit_note           text DEFAULT NULL
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
  -- Validate access and acquire a row lock to prevent duplicate version_number
  -- under concurrent saves of the same snippet by different team members.
  PERFORM 1
    FROM snippets
   WHERE id = p_snippet_id
     AND (user_id = v_uid OR is_shared = TRUE)
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'snippet not found or access denied (id=%)', p_snippet_id;
  END IF;

  -- Calculate next version number (atomic within this transaction due to lock above)
  SELECT COALESCE(MAX(version_number), 0) + 1
    INTO v_next
    FROM snippet_revisions
   WHERE snippet_id = p_snippet_id;

  -- Append the revision (snapshot of the new state being saved)
  INSERT INTO snippet_revisions
    (snippet_id, version_number, editor_id, editor_display, title, body, bodies, edit_note)
  VALUES
    (p_snippet_id, v_next, v_uid, p_editor_display, p_title, p_body, p_bodies, p_edit_note);

  -- Update the snippet with all provided fields
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
         updated_at            = now()
   WHERE id = p_snippet_id;

  RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION save_snippet_with_revision TO authenticated;

COMMIT;
