-- AUTH-001 · SprintBrain v2.15.0 — DEFERRED BACKFILL
-- Run ONCE after Alex logs in with b2b@leibtour.com for the first time.
-- NOT applied via MCP — run manually in Supabase SQL editor.
--
-- What it does:
-- Transfers ownership of all snippet/folder/stats rows currently owned by
-- alex.verdicchio@gmail.com (old dev account) OR with NULL user_id to the
-- new b2b@leibtour.com account.
--
-- Post-conditions:
--   35 snippets, 2 folders, 12 snippet_stats → all owned by b2b@leibtour.com
--   alex.verdicchio@gmail.com remains in auth.users but owns 0 rows

DO $$
DECLARE
  alex_b2b_id uuid;
  snippets_moved int;
  folders_moved int;
  stats_moved int;
BEGIN
  SELECT id INTO alex_b2b_id
    FROM auth.users
    WHERE email = 'b2b@leibtour.com'
    LIMIT 1;

  IF alex_b2b_id IS NULL THEN
    RAISE EXCEPTION 'b2b@leibtour.com not found in auth.users. Log in via magic link first, then re-run this script.';
  END IF;

  UPDATE public.snippets
    SET user_id = alex_b2b_id
    WHERE user_id IS NULL
       OR user_id = '03cf3cc7-5553-49cd-8dd4-a48e9322e670';
  GET DIAGNOSTICS snippets_moved = ROW_COUNT;

  UPDATE public.folders
    SET user_id = alex_b2b_id
    WHERE user_id IS NULL
       OR user_id = '03cf3cc7-5553-49cd-8dd4-a48e9322e670';
  GET DIAGNOSTICS folders_moved = ROW_COUNT;

  UPDATE public.snippet_stats
    SET user_id = alex_b2b_id
    WHERE user_id IS NULL
       OR user_id = '03cf3cc7-5553-49cd-8dd4-a48e9322e670';
  GET DIAGNOSTICS stats_moved = ROW_COUNT;

  RAISE NOTICE 'Backfill complete. snippets=% folders=% stats=% -> %',
    snippets_moved, folders_moved, stats_moved, alex_b2b_id;
END $$;

-- Verification query (run after):
--   SELECT email, COUNT(s.id) AS snippet_count
--   FROM auth.users u
--   LEFT JOIN public.snippets s ON s.user_id = u.id
--   GROUP BY email
--   ORDER BY snippet_count DESC;
