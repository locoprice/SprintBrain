-- AUTH-EXT-001: Tighten RLS policies to authenticated role only — v2.50.0
-- Date: 2026-05-30
--
-- Background: all policies were previously scoped to the `public` role, which
-- technically includes both `anon` and `authenticated`. Table-level grants for
-- `anon` were already revoked by GRANTS-001 (20260521), so anon requests could
-- not reach rows regardless. This migration makes the defence explicit at the
-- policy level by scoping every policy to TO authenticated — ensuring that even
-- if an `anon` table grant were ever accidentally restored, RLS would still
-- block all row access for unauthenticated callers.
--
-- Additional cleanup:
--   - Drops the redundant "snippets: select own" policy (its user_id condition
--     is already covered by the first clause of snippets_select_own_or_shared).
--   - Adds WITH CHECK to "stats: update own" (was missing from the prior set).
--   - All policies are recreated with consistent naming and role scoping.

-- ── SNIPPETS ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS "snippets: select own"          ON public.snippets;
DROP POLICY IF EXISTS "snippets: insert own"          ON public.snippets;
DROP POLICY IF EXISTS "snippets: update own"          ON public.snippets;
DROP POLICY IF EXISTS "snippets: delete own"          ON public.snippets;
DROP POLICY IF EXISTS "snippets_select_own_or_shared" ON public.snippets;

-- SELECT: own rows OR rows explicitly shared with the team.
CREATE POLICY "snippets: select own or shared"
  ON public.snippets FOR SELECT
  TO authenticated
  USING ((auth.uid() = user_id) OR (is_shared = true));

CREATE POLICY "snippets: insert own"
  ON public.snippets FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "snippets: update own"
  ON public.snippets FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "snippets: delete own"
  ON public.snippets FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── FOLDERS ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS "folders: select own" ON public.folders;
DROP POLICY IF EXISTS "folders: insert own" ON public.folders;
DROP POLICY IF EXISTS "folders: update own" ON public.folders;
DROP POLICY IF EXISTS "folders: delete own" ON public.folders;

CREATE POLICY "folders: select own"
  ON public.folders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "folders: insert own"
  ON public.folders FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "folders: update own"
  ON public.folders FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "folders: delete own"
  ON public.folders FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── SNIPPET STATS ─────────────────────────────────────────────────
DROP POLICY IF EXISTS "stats: select own" ON public.snippet_stats;
DROP POLICY IF EXISTS "stats: insert own" ON public.snippet_stats;
DROP POLICY IF EXISTS "stats: update own" ON public.snippet_stats;
DROP POLICY IF EXISTS "stats: delete own" ON public.snippet_stats;

CREATE POLICY "stats: select own"
  ON public.snippet_stats FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "stats: insert own"
  ON public.snippet_stats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "stats: update own"
  ON public.snippet_stats FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "stats: delete own"
  ON public.snippet_stats FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ── SNIPPET EVENTS ────────────────────────────────────────────────
DROP POLICY IF EXISTS "snippet_events: select own" ON public.snippet_events;
DROP POLICY IF EXISTS "snippet_events: insert own" ON public.snippet_events;

CREATE POLICY "snippet_events: select own"
  ON public.snippet_events FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "snippet_events: insert own"
  ON public.snippet_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ── NOTION SYNC LOG ───────────────────────────────────────────────
DROP POLICY IF EXISTS "notion_log: select own" ON public.notion_sync_log;
DROP POLICY IF EXISTS "notion_log: insert own" ON public.notion_sync_log;

CREATE POLICY "notion_log: select own"
  ON public.notion_sync_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "notion_log: insert own"
  ON public.notion_sync_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
