-- AUTH-EXT-001 follow-up · SprintBrain · 2026-06-06
-- Per-user RLS is already live and enforced on every public table, and the
-- extension authenticates per-user via JWT. This closes the one gap flagged by
-- the Supabase security advisor:
--
--   save_snippet_with_revision is SECURITY DEFINER (bypasses RLS) and was
--   EXECUTE-able by PUBLIC/anon. Its internal guard is
--   `user_id = auth.uid() OR is_shared = TRUE`; an UNAUTHENTICATED caller
--   (auth.uid() IS NULL) still matches the is_shared branch and could overwrite
--   any shared snippet. Restrict execution to signed-in users only.

REVOKE EXECUTE ON FUNCTION public.save_snippet_with_revision(
  uuid, text, text, text, jsonb, text, uuid, boolean, boolean, boolean,
  integer, integer, text, text, text[]
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.save_snippet_with_revision(
  uuid, text, text, text, jsonb, text, uuid, boolean, boolean, boolean,
  integer, integer, text, text, text[]
) TO authenticated, service_role;

-- Advisor: function_search_path_mutable — pin search_path on the trigger helper.
ALTER FUNCTION public.set_updated_at() SET search_path = public;
