-- MEMORY-002 S1 followup · Make the memory grants match what the migrations say.
--
-- Found by probing the applied schema rather than by reading it, which is the
-- only way this class of bug ever surfaces.
--
-- THE PROBLEM. Supabase ships ALTER DEFAULT PRIVILEGES granting ALL on new
-- tables in `public` to anon, authenticated and service_role. Both memory
-- migrations wrote an explicit GRANT listing the privileges they intended, but a
-- GRANT is additive: it cannot take away what the default already handed out.
-- MEMORY-001 revoked `anon` explicitly, which is why anon is clean, and said
-- nothing about `authenticated`, which therefore held every privilege on every
-- memory table:
--
--   memory_tokens        stated "no INSERT: issuing goes through
--                        memory_issue_token()" and had INSERT.
--   memory_shard_labels  stated insert/delete only, "reassigning is a delete
--                        plus an insert", and had UPDATE.
--   memory_shard_versions stated append-only and had UPDATE and DELETE.
--   memory_audit_log     stated entries cannot be forged and had INSERT.
--
-- WHAT WAS ACTUALLY EXPOSED: nothing. RLS denies any command that has no
-- policy, and none of those tables has a policy for the commands above, so
-- every one of those writes was already refused. Cross-account isolation was
-- verified directly and holds. This is the defence-in-depth layer, not the
-- boundary: the point is that the day someone adds a permissive policy, the
-- grant should not already be waiting for them.
--
-- REVOKE first, then GRANT. That order is the whole fix, and it is why the two
-- earlier migrations did not achieve what they described.
--
-- ⚠ FOR EVERY FUTURE MIGRATION IN THIS FEATURE: a new table in `public` starts
-- with ALL granted to authenticated. Revoke before granting, or the same gap
-- reopens. S3 (documents), S6 (search) and S9 (sharing) each add tables.

-- ── MEMORY-001 tables ────────────────────────────────────────────────────────

revoke all on public.memory_shards       from authenticated;
revoke all on public.memory_steps        from authenticated;
revoke all on public.memory_shard_labels from authenticated;
revoke all on public.memory_step_labels  from authenticated;
revoke all on public.memory_tokens       from authenticated;

grant select, insert, update, delete on public.memory_shards to authenticated;
grant select, insert, update, delete on public.memory_steps  to authenticated;

-- Assignments are insert plus delete. Changing a set is not an UPDATE.
grant select, insert, delete on public.memory_shard_labels to authenticated;

-- The exception: memory_step_labels.weight is edited in place.
grant select, insert, update, delete on public.memory_step_labels to authenticated;

-- No INSERT. Issuing goes through memory_issue_token() so the hash is computed
-- server-side and a client can never store a hash it chose itself.
grant select, update, delete on public.memory_tokens to authenticated;

-- ── MEMORY-002 tables ────────────────────────────────────────────────────────

revoke all on public.memory_spaces         from authenticated;
revoke all on public.memory_shard_versions from authenticated;
revoke all on public.memory_audit_log      from authenticated;

grant select, insert, update, delete on public.memory_spaces to authenticated;

-- Append-only. Versions are written by memory_save_shard and by nothing else;
-- a history a client can edit is not a history.
grant select on public.memory_shard_versions to authenticated;

-- Read your own trail. app.memory_audit is the only writer, and it is a definer
-- function in an unexposed schema.
grant select on public.memory_audit_log to authenticated;

-- ── anon stays at nothing ────────────────────────────────────────────────────
-- Restated rather than assumed. The token-authenticated memory_mcp_* functions
-- are the entire anon surface for this feature, and they reach these tables as
-- SECURITY DEFINER, needing no table grant of their own.

revoke all on public.memory_shards         from anon;
revoke all on public.memory_steps          from anon;
revoke all on public.memory_shard_labels   from anon;
revoke all on public.memory_step_labels    from anon;
revoke all on public.memory_tokens         from anon;
revoke all on public.memory_spaces         from anon;
revoke all on public.memory_shard_versions from anon;
revoke all on public.memory_audit_log      from anon;
