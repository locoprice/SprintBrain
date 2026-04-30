-- AUTH-001 · SprintBrain v2.15.0 — DEFERRED ONBOARDING
-- Run ONCE after Valentina logs in with valentina@leibtour.com for the first time.
-- NOT applied via MCP — run manually in Supabase SQL editor.
--
-- What it does:
-- Duplicates every folder and snippet owned by b2b@leibtour.com into new rows
-- owned by valentina@leibtour.com, generating fresh IDs and remapping the
-- folder_id foreign key so relationships are preserved inside Valentina's set.
--
-- What it does NOT copy:
--   snippet_stats — Valentina starts with zero usage history
--   notion_page_id — UNIQUE constraint; Valentina's snippets are not Notion-synced
--
-- Idempotency: re-running this script would create duplicate copies. Guard
-- with the INSERT count check at the bottom or only run once.

DO $$
DECLARE
  alex_b2b_id uuid;
  valentina_id uuid;
  folders_copied int;
  snippets_copied int;
  existing_for_valentina int;
BEGIN
  SELECT id INTO alex_b2b_id FROM auth.users WHERE email = 'b2b@leibtour.com' LIMIT 1;
  SELECT id INTO valentina_id FROM auth.users WHERE email = 'valentina@leibtour.com' LIMIT 1;

  IF alex_b2b_id IS NULL THEN
    RAISE EXCEPTION 'b2b@leibtour.com not found. Alex must log in + backfill first.';
  END IF;
  IF valentina_id IS NULL THEN
    RAISE EXCEPTION 'valentina@leibtour.com not found. She must log in via magic link first.';
  END IF;

  SELECT COUNT(*) INTO existing_for_valentina
    FROM public.snippets WHERE user_id = valentina_id;
  IF existing_for_valentina > 0 THEN
    RAISE EXCEPTION 'Valentina already owns % snippets. Refusing to re-run.', existing_for_valentina;
  END IF;

  CREATE TEMPORARY TABLE folder_id_map ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid()::text AS new_id
    FROM public.folders
    WHERE user_id = alex_b2b_id;

  INSERT INTO public.folders (id, name, ico, sort_order, user_id)
    SELECT m.new_id, f.name, f.ico, f.sort_order, valentina_id
    FROM public.folders f
    JOIN folder_id_map m ON f.id = m.old_id;
  GET DIAGNOSTICS folders_copied = ROW_COUNT;

  INSERT INTO public.snippets (
    id, title, shortcut, body, lang, folder_id, field_cfg,
    lang_group_id, sort_order, enable_urgency_timer, timer_duration_ms,
    scarcity_count, notion_page_id, user_id
  )
  SELECT
    gen_random_uuid()::text,
    s.title, s.shortcut, s.body, s.lang,
    m.new_id,
    s.field_cfg, s.lang_group_id, s.sort_order,
    s.enable_urgency_timer, s.timer_duration_ms, s.scarcity_count,
    NULL,
    valentina_id
  FROM public.snippets s
  LEFT JOIN folder_id_map m ON s.folder_id = m.old_id
  WHERE s.user_id = alex_b2b_id;
  GET DIAGNOSTICS snippets_copied = ROW_COUNT;

  RAISE NOTICE 'Copied % folders and % snippets to %',
    folders_copied, snippets_copied, valentina_id;
END $$;
