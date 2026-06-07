# Phase B — B6 Soak Watch & Go/No-Go

**Status:** SOAKING. Started **2026-06-07** (B5 applied). Earliest B6 go: **2026-06-21** (14-day window).
**Owner sign-off required before B6** (column drop is irreversible). See `PHASE_B_PLAN.md` §2/§4.

This is the gate between the **expand+migrate** work already in production (B0–B5) and the
**contract** step (B6). B6 does two one-way things:

1. `ALTER TABLE snippets DROP COLUMN is_shared;` — irreversible.
2. Update `notion-snippet-push` to stop writing `is_shared` (and decide its replacement behavior).

We do not start B6 until every exit criterion below holds. A soak is not a timer alone — it is the
window in which we prove the criteria on real production traffic.

---

## 1. Why a soak (what could still be wrong after B5)

B5 dropped the `is_shared = true` global-read branch. Two things keep the old world alive on purpose
until B6, and both are load-bearing during the soak:

- **The `is_shared` column still exists.** The currently-deployed extension filters
  `is_shared.eq.true` in its REST querystring. RLS intersects that with "yours OR folder-readable",
  so a member on the **old** extension still sees the 35 migrated snippets (they are `is_shared = true`
  **and** in the org shared folder). Drop the column before everyone upgrades and that querystring
  **400s** → the old extension shows zero shared snippets.
- **The Notion push still sets `is_shared = true`** (`notion-snippet-push/index.ts:192`) without
  filing the snippet into `leibtour_team_shared`. Post-B5 that flag grants no visibility, so new
  Notion-pushed snippets are **owner-only**. See §4 — this needs a decision, not just observation.

---

## 2. Exit criteria (ALL must hold before B6)

| # | Criterion | How verified | Pass = |
|---|---|---|---|
| C1 | **Parity invariant holds:** every migrated snippet is still folder-readable by every LeibTour member. | §3 Check A | 0 rows |
| C2 | **No cross-tenant leak:** a non-member authenticated user sees none of the org's snippets via `accessible_snippets()` or a direct `SELECT`. | §3 Check B (simulated user) | own-only |
| C3 | **No new orphan-shared snippets:** `is_shared = true` count has not grown beyond the 35 recorded in `phase_b_share_migration` (or each new one was consciously handled — see §4). | §3 Check C | count == 35, or each delta triaged |
| C4 | **Extension fully migrated:** no client still depends on the `is_shared` column. All active members run the permission-aware extension (calls `/rpc/accessible_snippets`); REST logs show no `is_shared` filter from app traffic. | §3 Check D + version adoption | no `is_shared` REST hits |
| C5 | **Advisor clean:** security + performance advisors report no new findings attributable to Phase B objects. | `get_advisors` (security, performance) | no new |
| C6 | **Notion EF decision made** (§4) and, if it requires a code change, that change is ready to ship **in the same B6 batch**. | review + sign-off | decided |
| C7 | **Pre-drop snapshot taken** of `snippets` (or a full project backup point noted) immediately before the column drop. | §5 step 1 | snapshot id recorded |

Any FAIL ⇒ stay in soak, fix or decide, re-check. Do not drop the column.

---

## 3. Monitoring checks (runnable)

Run via Supabase MCP `execute_sql` against project `eyowustlbqujaimaxggt`. Cadence: **on day 1, day 7,
and the day of the B6 go** (more often if a delta appears). Record each run's result with its date.

### Check A — parity invariant (C1)
Every snippet recorded in the B4 mapping must still sit in the shared org folder and carry the org id.
```sql
SELECT s.id, s.folder_id, s.organization_id
FROM phase_b_share_migration m
JOIN snippets s ON s.id = m.snippet_id
WHERE s.folder_id IS DISTINCT FROM 'leibtour_team_shared'
   OR s.organization_id IS NULL;
-- EXPECT: 0 rows.
```

### Check B — cross-tenant isolation (C2)
Simulate a non-member authenticated user and confirm the org's snippets are invisible. Use the same
`request.jwt.claims` technique as the Phase A/B RLS verification (pick a uuid that is NOT in
`organization_members`):
```sql
BEGIN;
SELECT set_config('role', 'authenticated', true);
SELECT set_config('request.jwt.claims',
  json_build_object('sub','00000000-0000-0000-0000-0000000000ff','role','authenticated')::text, true);

-- Direct table read: must return only rows owned by this (non-existent-data) user → 0.
SELECT count(*) AS visible_org_snippets
FROM snippets
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'leibtour');
-- EXPECT: 0.

-- The extension's read path must also leak nothing for a non-member.
SELECT count(*) AS accessible
FROM accessible_snippets()
WHERE organization_id = (SELECT id FROM organizations WHERE slug = 'leibtour');
-- EXPECT: 0.
ROLLBACK;
```

### Check C — orphan-shared drift (C3)
```sql
SELECT
  (SELECT count(*) FROM snippets WHERE is_shared = true)          AS is_shared_now,
  (SELECT count(*) FROM phase_b_share_migration)                  AS migrated_at_b4,
  (SELECT count(*) FROM snippets
     WHERE is_shared = true
       AND id NOT IN (SELECT snippet_id FROM phase_b_share_migration)) AS new_since_b4;
-- EXPECT: new_since_b4 = 0. Any new_since_b4 row = a Notion push (or manual toggle) that is
-- is_shared=true but NOT team-visible post-B5. List & triage them (move to shared folder or
-- accept owner-only) before B6:
-- SELECT id, title, user_id, folder_id, organization_id FROM snippets
--   WHERE is_shared = true AND id NOT IN (SELECT snippet_id FROM phase_b_share_migration);
```

### Check D — extension adoption (C4)
Operational, two parts:
- **Logs:** `get_logs` (api) — scan recent REST traffic for `is_shared` in querystrings from app
  user agents. Zero app-originated `is_shared` filters ⇒ no client depends on the column.
- **Runtime ritual** per member device: reload extension → refresh a target tab → reopen popup once →
  confirm own + the 35 shared snippets appear and the service worker has no errors. Confirm the popup
  version is the permission-aware build (≥ the version that ships `accessible_snippets`).

### Check E — advisors (C5)
`get_advisors` for **security** and **performance**. Compare against the post-B5 baseline; investigate
any new entry touching `snippets`, `folders`, `prompts`, `folder_permissions`, `accessible_snippets`,
or the `app.*` functions.

---

## 4. Open decision — Notion push after B5 (blocks C6)

**Problem:** `notion-snippet-push` flips `is_shared = true` but does not place the snippet in
`leibtour_team_shared`. Post-B5 that is a no-op for visibility, so **pushing a snippet to Notion no
longer shares it with the team** — a silent regression of the old "push → everyone sees it" flow.

**Options for B6 (pick one):**
1. **File on push.** EF also sets `folder_id = 'leibtour_team_shared'` + `organization_id = <leibtour>`
   (mirrors B4) and stops writing `is_shared`. Preserves the old "push shares it" behavior via folder
   ACL. Lowest surprise; recommended unless we want push to stop implying team-share.
2. **Decouple.** EF only writes `notion_page_id` (drops `is_shared` entirely); team-sharing becomes an
   explicit dashboard action (FolderShareModal). Cleaner model, but changes user expectations — needs a
   note to the team.
3. **Org-scope Notion** (the deferred §7.3 adjacency): per-org Notion DB + ownership. Larger scope;
   only fold into B6 if we're doing it now, otherwise defer and pick option 1 or 2.

Whichever we choose, the EF change ships **in the same batch as the column drop** so there is never a
window where the EF writes a column that no longer exists.

---

## 5. B6 execution runbook (only when §2 all-green)

1. **Snapshot** — note a Supabase backup/restore point (or `CREATE TABLE snippets_pre_b6_backup AS
   TABLE snippets;`) and record its id here (C7).
2. **EF first** — deploy the `notion-snippet-push` change (per §4 decision) so nothing writes
   `is_shared` anymore. Verify a test push succeeds and (option 1) lands in the shared folder.
3. **Drop the column** — one migration `*_phase_b_b6_drop_is_shared.sql`:
   `ALTER TABLE snippets DROP COLUMN is_shared;` Apply via MCP **and** commit the file; update the
   migrations README + `PHASE_B_PLAN.md` Status (B6 done).
4. **Verify** — re-run Check A, B, E; runtime ritual on the extension; confirm a Notion push still
   behaves per the §4 decision; `npm run lint/typecheck/build` + extension `node --check` /
   `check-version` / `check-snippets` green; version bumped in parity.
5. **Sign-off** — record who approved and the date.

## 6. Rollback note

Through B5 everything is reversible (re-add the `OR is_shared = true` branch — one statement). **After
the B6 column drop it is not** — recovery is restore-from-snapshot only. That asymmetry is the whole
reason for this soak: we spend cheap, reversible time now to avoid an expensive, irreversible mistake.

---

## 7. Soak log

| Date | Checks run | Result | Notes |
|---|---|---|---|
| 2026-06-07 | (B5 applied) | — | Soak started. Baseline: 35 shared snippets migrated (B4), parity verified at apply time. |
