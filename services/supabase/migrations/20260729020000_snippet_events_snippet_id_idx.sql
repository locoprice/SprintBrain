-- STATUS-ICONS-003 · SprintBrain
-- Date: 2026-07-29
--
-- `snippet_usage_counts()` groups and joins on `snippet_events.snippet_id`, but
-- every existing index on that table leads with `user_id`
-- (`user_id, created_at DESC` and `user_id, shortcut`), so the aggregate fell
-- back to a sequential scan — ~40 ms today, growing linearly with the event log,
-- and now run on every dashboard load AND every extension popup open.
--
-- Plain CREATE INDEX rather than CONCURRENTLY: the table is small (1735 rows),
-- so the write lock is milliseconds, and CONCURRENTLY cannot run inside the
-- transaction a migration is applied in.

CREATE INDEX IF NOT EXISTS snippet_events_snippet_id_idx
  ON public.snippet_events USING btree (snippet_id);
