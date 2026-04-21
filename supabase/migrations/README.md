# Supabase migrations — SprintBrain

Source of truth for all schema and data migrations. Files are numbered with
timestamps so they sort in execution order.

## Applied automatically (via MCP `apply_migration`)

| File | Status | Notes |
|---|---|---|
| `20260421120000_auth_domain_allowlist.sql` | ✅ applied 2026-04-21 | Rejects signups outside `@leibtour.com` |

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
