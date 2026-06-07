# Supabase migrations — SprintBrain

Source of truth for all schema and data migrations. Files are numbered with
timestamps so they sort in execution order.

## Applied automatically (via MCP `apply_migration`)

| File | Status | Notes |
|---|---|---|
| `20260421120000_auth_domain_allowlist.sql` | ✅ applied 2026-04-21 | Rejects signups outside `@leibtour.com` |
| `20260606000000_harden_save_snippet_rpc.sql` | ✅ applied 2026-06-06 | Revokes anon/PUBLIC `EXECUTE` on `save_snippet_with_revision` (closes unauthenticated write path to shared snippets); pins `set_updated_at` search_path |
| `20260606010000_phase_a_org_foundation_schema.sql` | ✅ applied 2026-06-06 | Enterprise Phase A: org/team/membership/invitation/folder-permission/default-folder/member-property tables; nullable `organization_id` on folders/snippets/prompts (+`folder_id` on prompts). Additive — existing RLS untouched. |
| `20260606020000_phase_a_org_access_and_rls.sql` | ✅ applied 2026-06-06 | Enterprise Phase A: recursion-safe `app.*` access functions (SECURITY DEFINER, unexposed schema) + RLS policies for the new tables. |

## Deferred (manual run in Supabase SQL editor)

These scripts are **not safe to apply until specific auth events happen**.

| File | Prerequisite | Owner action |
|---|---|---|
| `20260421120001_backfill_alex_ownership.sql` | Alex completes first magic-link login with `b2b@leibtour.com` | Alex pastes + runs in SQL editor once |
| `20260421120002_copy_alex_to_valentina.sql` | Valentina completes first magic-link login with `valentina@leibtour.com` | Alex pastes + runs in SQL editor once |

## How to run a deferred script

1. Open https://supabase.com/dashboard/project/eyowustlbqujaimaxggt/sql/new
2. Paste the full contents of the file
3. Click **Run**
4. The `RAISE NOTICE` at the bottom prints how many rows moved

## Adding a new migration

```sh
# 1. Create the file with next timestamp
supabase/migrations/YYYYMMDDhhmmss_short_name.sql

# 2. If safe to apply to live DB, run via Claude:
#    "apply migration via MCP, name: short_name"

# 3. If deferred (needs a prerequisite event), add a row to the table above.
```
