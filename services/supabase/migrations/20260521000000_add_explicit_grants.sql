-- GRANTS-001 · SprintBrain v2.40.2
-- Date: 2026-05-21
--
-- Supabase is removing the implicit public-schema grant on May 30 (new projects)
-- and October 30 (all existing projects). This migration locks in explicit grants
-- for every table in the public schema before the deadline, and revokes the
-- overly-broad anon write access that the old default left behind.
--
-- Security model applied here and required for all future table additions:
--   anon          → no access  (app requires authentication)
--   authenticated → per-table CRUD, row-level filtered by RLS policies
--   service_role  → full access (edge functions, admin tooling)

-- ─── snippets ───────────────────────────────────────────────────────────────

REVOKE ALL ON public.snippets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.snippets TO authenticated;
GRANT ALL ON public.snippets TO service_role;

-- ─── folders ────────────────────────────────────────────────────────────────

REVOKE ALL ON public.folders FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.folders TO authenticated;
GRANT ALL ON public.folders TO service_role;

-- ─── snippet_stats ──────────────────────────────────────────────────────────

REVOKE ALL ON public.snippet_stats FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.snippet_stats TO authenticated;
GRANT ALL ON public.snippet_stats TO service_role;

-- ─── snippet_events ─────────────────────────────────────────────────────────
-- Event log: client appends on use, reads own history; no updates or deletes.

REVOKE ALL ON public.snippet_events FROM anon;
REVOKE ALL ON public.snippet_events FROM authenticated;
GRANT SELECT, INSERT ON public.snippet_events TO authenticated;
GRANT ALL ON public.snippet_events TO service_role;

-- ─── notion_sync_log ────────────────────────────────────────────────────────
-- Written by the notion-snippet-push edge function (service_role) and optionally
-- by the client. Client reads its own sync history to surface status in the UI.

REVOKE ALL ON public.notion_sync_log FROM anon;
REVOKE ALL ON public.notion_sync_log FROM authenticated;
GRANT SELECT, INSERT ON public.notion_sync_log TO authenticated;
GRANT ALL ON public.notion_sync_log TO service_role;

-- ─── prompts ────────────────────────────────────────────────────────────────

REVOKE ALL ON public.prompts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prompts TO authenticated;
GRANT ALL ON public.prompts TO service_role;
