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
| `20260607000000_phase_b_b0_snippet_revisions.sql` | ✅ applied 2026-06-07 | Phase B · B0: `snippet_revisions` table with **TEXT** `snippet_id` (the never-applied `20260528000000` used `uuid REFERENCES snippets(id)` against a `text` PK and could not apply); rebuilds `save_snippet_with_revision` with TEXT id params + a folder-aware write guard (replaces the `is_shared = TRUE` write hole). **Supersedes `20260528000000_snippet_revisions.sql`.** |
| `20260607010000_phase_b_b1_leibtour_org.sql` | ✅ applied 2026-06-07 | Phase B · B1: LeibTour organization + memberships (locopricesl + sprintbrainapp = admin, b2b@leibtour.com = member). Data only; no asset rows touched. |
| `20260607020000_phase_b_b2_asset_rls_org_branches.sql` | ✅ applied 2026-06-07 | Phase B · B2: org-aware read/write RLS branches on folders/snippets/prompts (keeps the `is_shared` branch) + `public.accessible_snippets()` permission-aware read RPC for the extension. Additive. |
| `20260607030000_phase_b_b4_migrate_is_shared.sql` | ✅ applied 2026-06-07 | Phase B · B4: move the 35 `is_shared` snippets into the org **Team Shared** folder (org-wide VIEW) + stamp `organization_id`; keeps `is_shared = true`. Reversal mapping in `phase_b_share_migration`. |
| `20260607040000_phase_b_b5_retire_is_shared_read.sql` | ✅ applied 2026-06-07 | Phase B · B5: drop the `is_shared = true` global-read branch from the snippets SELECT policy (closes the cross-tenant leak). Column kept until B6. |
| `20260607050000_phase_b_b3_org_member_directory.sql` | ✅ applied 2026-06-07 | Phase B · B3 support: guarded `org_member_directory()` RPC so the FolderShareModal can resolve teammate identity (co-members only). |
| `20260608000000_phase_b_f1f2_tenancy_triggers.sql` | ✅ applied 2026-06-08 | Phase B hardening (F1/F2/E2): `BEFORE` triggers on snippets/prompts/folders — asset `organization_id` is always derived from its folder (auto-stamp + consistency), `user_id` is immutable, moving an org asset out of its org needs owner/admin, folder org-changes validate membership and cascade to children. Backfilled 26 pre-existing inconsistent snippets (20 in Team Shared → org-stamped/now team-visible; 6 folderless org snippets → cleaned to personal). Verified live with simulated-user tests + clean security advisor. Reversible (drop 4 triggers + 3 `app.*` functions). |
| `20260609000000_phase_b_b6_drop_is_shared.sql` | ✅ applied 2026-06-10 | Phase B · **B6 (contract step, owner-authorized)**: rebuilds `save_snippet_with_revision` **without** `p_is_shared` (old 15-param signature dropped; anon/PUBLIC still revoked) and **drops `snippets.is_shared`** — the per-snippet share flag is fully retired; sharing is folder-ACL only. `notion-snippet-push` v3 was deployed *first* so the EF only writes `notion_page_id` (§4 Option 2 decouple). Post-drop checks: zero `is_shared` references left in any function/policy/view/index; simulated-user RPC save + `accessible_snippets()` PASS; cross-tenant isolation PASS; advisors unchanged. **⚠️ Irreversible** — recovery is platform-backup restore only; the B4 audit mapping (`phase_b_share_migration`) preserves the historical shared set. |

> **Phase B complete (B0–B6).** The `is_shared` column is gone; every reader/writer was migrated first (E1 v2.60.0, E3 v2.61.0, EF v3). History of the soak, exit criteria, and the execution log live in `docs/PHASE_B_SOAK.md`.
>
> **Note:** `20260528000000_snippet_revisions.sql` is retained only as a historical record. It is **broken** (`uuid REFERENCES` a `text` PK) and must not be applied — `20260607000000_phase_b_b0_snippet_revisions.sql` is the corrected, applied version.

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
