-- Revoke leftover anon table grants (SECURITY-001, 2026-08-19).
--
-- Three tables still carry a full grant set for the `anon` role, inherited from
-- the blanket GRANT in 20260521000000_add_explicit_grants.sql. Nothing reads
-- them anonymously today: RLS denies by default and none of these tables has a
-- policy targeting `anon`, so the grants are unreachable privilege rather than
-- an open door. They are removed so the privilege surface matches the intent,
-- and so a future policy added without an audience cannot quietly become
-- world-readable.
--
-- Scope note: this migration touches privileges only. It creates, alters and
-- deletes no rows, and changes no policy, so every existing session keeps
-- working exactly as before.
--
-- `authenticated` grants are deliberately untouched: that is the role every
-- surface actually uses, and RLS is what scopes it.

revoke all on public.auth_audit_log            from anon;
revoke all on public.snippet_revisions         from anon;
revoke all on public.phase_b_share_migration   from anon;

-- phase_b_share_migration is a one-off migration bookkeeping table with RLS on
-- and no policies at all (it is not part of the API surface). Drop the
-- `authenticated` grants too so it stops appearing as an exposed relation.
revoke all on public.phase_b_share_migration   from authenticated;
