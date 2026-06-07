# Phase B — B6 Soak Watch & Go/No-Go

**Status:** SOAKING. Started **2026-06-07** (B5 applied). Target B6 go: **on/after 2026-06-21**
(2-week window confirmed by owner). **Owner sign-off still required before B6** (column drop is
irreversible). Notion-push behavior decided — **Option 2 (decouple)**, see §4. EF change is **not
pre-built** (built as part of the B6 batch). See `PHASE_B_PLAN.md` §2/§4.

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
| C6 | **Notion push behavior** decided, and its code change shipped **in the same B6 batch**. | review + sign-off | ✅ decided 2026-06-07 → Option 2 (decouple); code lands with B6 |
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
-- INTERPRETATION (post Option-2 decision): a new_since_b4 row is a Notion push that set
-- is_shared=true but is owner-only post-B5 — this is now EXPECTED, not a bug. With "decouple",
-- sharing is a deliberate dashboard action, so these snippets are correctly private until shared.
-- No per-row triage needed; we only COUNT them so B6 knows how many stale is_shared=true flags
-- it will clear when it drops the column. To list them if curious:
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

## 4. Notion push after B5 — DECIDED: Option 2 (decouple)

**Problem:** `notion-snippet-push` flips `is_shared = true` but does not place the snippet in
`leibtour_team_shared`. Post-B5 that is a no-op for visibility, so **pushing a snippet to Notion no
longer shares it with the team** — a silent change from the old "push → everyone sees it" flow.

**Decision (owner, 2026-06-07): Option 2 — decouple.** Sending a snippet to Notion will **not**
imply team-sharing. Sharing with the team becomes a **deliberate action** on the dashboard
(FolderShareModal). This is the intended model going forward, not a regression to fix.

**What this means concretely:**
- **In the B6 batch:** `notion-snippet-push` stops writing `is_shared` entirely — it only writes
  `notion_page_id`. No folder filing on push.
- **During the soak (now → B6):** the EF still writes `is_shared = true`, which is harmlessly
  owner-only post-B5. Those rows are *expected* (see §3 Check C) and the column drop clears the flag.
- **Team communication needed:** tell the LeibTour team that "push to Notion" no longer auto-shares —
  to share a snippet with everyone, file it in / share its folder on the dashboard. Capture this in the
  release note that ships with B6.

Options not taken: **1 (file-on-push)** — keeps the old auto-share habit, rejected in favor of explicit
sharing; **3 (org-scoped Notion)** — larger scope, remains deferred (`PHASE_B_PLAN.md` §7.3).

The EF change ships **in the same batch as the column drop** so there is never a window where the EF
writes a column that no longer exists. It is intentionally **not pre-built** (owner: "later is fine").

---

## 5. B6 execution runbook (only when §2 all-green)

1. **Snapshot** — note a Supabase backup/restore point (or `CREATE TABLE snippets_pre_b6_backup AS
   TABLE snippets;`) and record its id here (C7).
2. **EF first** — deploy the `notion-snippet-push` change (§4 Option 2: write only `notion_page_id`,
   stop writing `is_shared`). Verify a test push succeeds and the snippet stays owner-only (sharing is
   now the separate dashboard action). Include the team release note from §4.
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
| 2026-06-07 | decisions recorded | — | Owner: 2-week window (target go ≥ 2026-06-21); Notion push = Option 2 (decouple); EF change not pre-built (lands with B6). |
