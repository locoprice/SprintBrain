-- Phase B · B6 — drop snippets.is_shared (retire the legacy global-share flag)
--
-- Final step of the Phase B expand→migrate→contract plan. Preconditions met
-- before this ran (see docs/PHASE_B_SOAK.md §2/§5):
--   • B5 already removed the `is_shared = true` global-read RLS branch, so the
--     column had no access-control effect — it was vestigial data.
--   • No client reads or writes it: popup (v2.60.0 E1 + v2.61.0 E3), dashboard
--     (v2.61.0), background.js, and the mobile app (select=*) are all off it.
--   • notion-snippet-push was redeployed first to stop writing `is_shared`
--     (it now only writes notion_page_id back).
--   • Live check: the ONLY DB object referencing the column was
--     save_snippet_with_revision (no other function, policy, view, or index)
--     — rebuilt below without it.
--
-- accessible_snippets() RETURNS SETOF snippets via `SELECT s.*`, so its
-- rowtype follows the table automatically; both extension surfaces read it
-- with select=*.
--
-- ⚠️ IRREVERSIBLE: the column (and the stale flag data it held) is gone after
-- this. The B4 audit mapping (phase_b_share_migration) records which 35 rows
-- were shared pre-Phase-B, so the historical state remains reconstructible.

BEGIN;

-- 1. Rebuild save_snippet_with_revision without p_is_shared.
--    PostgREST matches functions by named arguments, so the old 15-param
--    signature must be dropped (not overloaded) — otherwise a stale client
--    sending p_is_shared would still hit a function that writes a dropped
--    column.
DROP FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean, boolean,
  integer, integer, text, text, text[]
);

CREATE FUNCTION public.save_snippet_with_revision(
  p_snippet_id            text,
  p_title                 text,
  p_shortcut              text,
  p_body                  text,
  p_bodies                jsonb,
  p_lang                  text,
  p_folder_id             text,
  p_pinned                boolean,
  p_enable_urgency_timer  boolean,
  p_timer_duration_ms     integer,
  p_scarcity_count        integer,
  p_editor_display        text,
  p_edit_note             text     DEFAULT NULL,
  p_alternative_queries   text[]   DEFAULT '{}'
) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_next  integer;
  v_uid   uuid := auth.uid();
BEGIN
  -- Personal owner OR org-folder edit/owner (Phase B write guard, unchanged).
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
         enable_urgency_timer  = p_enable_urgency_timer,
         timer_duration_ms     = p_timer_duration_ms,
         scarcity_count        = p_scarcity_count,
         alternative_queries   = p_alternative_queries,
         updated_at            = now()
   WHERE id = p_snippet_id;

  RETURN v_next;
END;
$$;

-- Authenticated callers only (mirrors the B0 hardening).
REVOKE EXECUTE ON FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_snippet_with_revision(
  text, text, text, text, jsonb, text, text, boolean, boolean,
  integer, integer, text, text, text[]
) TO authenticated, service_role;

-- 2. Drop the column.
ALTER TABLE public.snippets DROP COLUMN is_shared;

COMMIT;

-- Make PostgREST pick up the new table shape + function signature immediately.
NOTIFY pgrst, 'reload schema';
