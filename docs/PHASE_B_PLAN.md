# Phase B — Folder Sharing · Explore → Plan

**Status:** ✅ **COMPLETE (B0–B6).** B0–B5 applied to production 2026-06-07; **B6 executed
2026-06-10** (owner-authorized early, ahead of the original soak window — see
`docs/PHASE_B_SOAK.md` §7 for the execution log): `snippets.is_shared` dropped,
`save_snippet_with_revision` rebuilt without `p_is_shared`, `notion-snippet-push` v3 decoupled
(writes only `notion_page_id`), and every client surface migrated (E1 v2.60.0, E3 v2.61.0 —
per-snippet sharing replaced by folder ACL + a separate "Push to Notion" action). All DB steps
verified live with simulated-user RLS checks + the security advisor; dashboard gates
(lint/typecheck/build/test) and extension checks (`node --check`, version, snippets) are green.
See `services/supabase/migrations/README.md` for the applied migration list and §7 below for
the resolved open decisions.
**Prereq:** Phase A foundation (applied 2026-06-06; see `ENTERPRISE_ARCHITECTURE.md` + `project_enterprise_buildout`).
**Goal:** Replace the all-or-nothing `snippets.is_shared` boolean with **folder-level View/Edit/Owner
sharing** enforced by RLS, across dashboard **and** extension, without breaking existing use.

---

## 1. EXPLORE — current state Phase B must touch (verified 2026-06-06)

### 1.1 How sharing works today
- `snippets.is_shared boolean` (default false). `true` ⇒ readable by **every authenticated user**
  via the RLS policy `snippets_select: auth.uid() = user_id OR is_shared = true`.
- Set to `true` by the **`notion-snippet-push` edge function** (after pushing the snippet to a single
  hardcoded team Notion DB), and toggled by `snippetsApi.setShared` / `snippetStore.shareSnippet`.
- There is **no folder-level sharing** today; `is_shared` is per-snippet and global.

### 1.2 `is_shared` touchpoints (the full blast radius)
| Layer | Files |
|---|---|
| **Dashboard reads/writes** | `app/src/lib/api/snippetsApi.ts` (`setShared`, `shareWithNotion`, `listSnippets` `.eq('user_id')`), `app/src/stores/snippetStore.ts` (`shareSnippet`) |
| **Dashboard UI** | `SnippetsTable.tsx` (share toggle col), `SnippetContextMenu.tsx`, `NewSnippetDialog.tsx`, `VersionHistoryPanel.tsx` ("Team shared" badge) |
| **Types/IO** | `types/database.ts`, `types/schemas.ts`, `lib/snippetIo.ts`, `mock/fixtures.ts` |
| **Extension** | `extension/background/background.js` (`loadData()` uses `or=(user_id.eq.{uid},is_shared.eq.true)`), `extension/popup/popup.js` (`shareWithTeamNotion`, `setShared`, `_updateShareSub`) |
| **Edge function** | `services/supabase/functions/notion-snippet-push/index.ts` (sets `is_shared: true`; single hardcoded Notion DB `a06cac8d…`; ownership = `user_id`) |
| **DB** | `20260509000000_add_snippet_sharing.sql` (added column + the global-read policy) |
| **Tests** | `app/src/__tests__/deletionSync.test.ts`, `snippetRevisions.test.ts` |

### 1.3 Constraints inherited from Phase A
- Existing asset-table RLS is **unchanged** (only `auth.uid() = user_id [OR is_shared]`). Org-aware
  branches do **not** exist yet — Phase B adds them.
- Folders/snippets/prompts now have nullable `organization_id`; prompts have `folder_id`. All NULL today.
- `app.*` access functions exist (`can_read_folder`, `can_write_folder`, `folder_level`, …) and are tested-safe.
- `folder_permissions` / `default_folders` tables exist (empty).

### 1.4 ⚠️ Blocking unknowns discovered
- **`snippet_revisions` does not exist in production** (verified: `table_exists = 0`). The
  `save_snippet_with_revision` RPC writes to it ⇒ the version-history save path errors if invoked.
  Migration `20260528000000_snippet_revisions.sql` was apparently never applied. **Phase B must
  resolve this** (apply the table, or confirm the feature is dead) before rewriting that RPC.
- **Notion sync is tenant-blind**: one hardcoded team DB + `user_id` ownership. Org-scoping is a
  Phase-B-adjacent decision (can be deferred, but `is_shared` retirement affects the EF).

---

## 2. PLAN — staged, non-breaking

Principle: **both old and new paths work at every step**; the global `is_shared` read is removed
only after data + reads have moved to folder ACL, and the column is dropped last.

| Step | Change | Surface | Reversible? |
|---|---|---|---|
| **B0** | Resolve `snippet_revisions` (apply table or retire RPC); fix the revision RPC's `is_shared` branch → `app.can_write_folder`. | DB | yes (drop table / revert fn) |
| **B1** | Create the **LeibTour org** + memberships (the deferred Phase-A backfill) — needs the member list. | DB (data) | yes (delete rows) |
| **B2** | Add **org-aware branches** to existing asset RLS (`… OR (organization_id IS NOT NULL AND folder_id IS NOT NULL AND app.can_read_folder(folder_id))`), **keeping** the `is_shared` branch. Additive — nothing breaks. | DB | yes (restore prior policy) |
| **B3** | `permissionService` + **FolderShareModal** UI (grant/revoke user/team/org × view/edit/owner). Writes `folder_permissions`. Dashboard reads stop force-filtering `.eq('user_id')` so shared rows surface. | API + UI | yes (feature-flag UI) |
| **B4** | **Data migration**: for each currently `is_shared = true` snippet, ensure it sits in an org folder shared org-wide (VIEW); set `organization_id`. Then flip dashboard + extension reads to folder-based. | DB (data) + clients | yes (mapping table kept) |
| **B5** | **Retire** the `is_shared = true` global-read policy (drop the OR branch). Now access = personal OR folder ACL only. | DB | yes (re-add branch) |
| **B6** | Later: drop `snippets.is_shared` column; update `notion-snippet-push` to stop writing it (+ optional org-scoped Notion). | DB + EF | column drop is one-way → do last, after a soak |

UI: replace the per-snippet share toggle with **folder-level** sharing (the toggle becomes "this
snippet's folder is shared with N people"). Mirrors the Text Blaze FolderShareModal benchmark.

---

## 3. MIGRATION STRATEGY
- One migration per step (B0, B2, B5, B6 are DDL; B1, B4 are data). Each applied via MCP **and**
  committed as a repo file (keep DB = repo — the Phase A lesson).
- **Expand → migrate → contract**: add org branches (expand), move data (migrate), remove `is_shared`
  (contract). The column survives until B6 so every step is reversible.
- B4 keeps a **mapping record** (which snippets moved to which shared folder) so the data move is
  auditable and reversible.
- Re-run the security advisor + simulated-user RLS checks after **every** DB step (as in Phase A).

## 4. ROLLBACK STRATEGY
| Step | Rollback |
|---|---|
| B0 | `drop table snippet_revisions` / restore prior RPC body. |
| B1 | Delete the org + membership rows (cascade). |
| B2 | Restore the pre-B2 policy text (kept verbatim in the migration's comment). |
| B3 | Feature-flag the UI off; `permissionService` writes are deletable rows. |
| B4 | Re-point reads to `is_shared` (still present); null out the `organization_id` set by the migration using the mapping record. |
| B5 | Re-add the `OR is_shared = true` branch (one statement). |
| B6 | **Irreversible** (column drop) — gate behind a soak period + explicit sign-off; take a snapshot first. |
- **Global escape hatch:** until B5, the `is_shared` path is fully intact, so a single policy revert
  restores today's behavior end-to-end.

## 5. EXTENSION IMPACT ANALYSIS
The extension reads snippets via **raw REST**, not supabase-js, so it can't reuse dashboard logic.
- **`background.js loadData()`** — `is_shared=eq.true` stops returning org snippets after B5. Replace
  with a permission-aware source. **Recommended:** a `SECURITY DEFINER` RPC `app.accessible_snippets()`
  (or an exposed `public` wrapper) returning personal + folder-readable snippets in one call; the
  extension swaps its two `supaFetch('snippets', …)` calls for one `rpc` call. Avoids encoding ACL
  logic in a REST querystring.
- **`popup.js`** — `shareWithTeamNotion` / `setShared` / `_updateShareSub` move from per-snippet
  `is_shared` to folder-level sharing (or are removed from the popup and handled on the dashboard).
- **Context menu** grouping already keys off `folder_id`; shared folders just appear as more folders.
- **Published-ID coupling:** after the v1.0.0 Web Store publish, the new extension ID must be added to
  `SPRINTBRAIN_EXTENSION_IDS` or the dashboard→extension JWT handoff (hence all authed reads) breaks.
- **Verification** must use the runtime ritual: reload ext → refresh target tab → reopen popup once.

## 6. TESTING CHECKLIST
**RLS (simulated users via `set local role / request.jwt.claims`):**
- [ ] Personal snippet/folder: owner reads/writes; non-owner sees nothing (unchanged).
- [ ] Org folder VIEW grantee: can read, **cannot** write. EDIT grantee: can write. Non-member: nothing.
- [ ] Org admin: implicit owner on all org folders. Folder owner: can manage grants.
- [ ] **Cross-tenant isolation:** create a 2nd test org; confirm zero visibility across orgs.
- [ ] Default-folder member: auto-sees the folder without an explicit grant.

**Data migration (B4):**
- [ ] Every previously `is_shared = true` snippet remains visible to the intended audience — none lost, none newly leaked.
- [ ] Count parity: pre-migration shared set == post-migration folder-readable set.

**Functional:**
- [ ] Dashboard FolderShareModal: grant/revoke each level; revoke removes access immediately (after token refresh for JWT-claim path, if added).
- [ ] `save_snippet_with_revision` works end-to-end (requires B0) and respects `can_write_folder`.
- [ ] Notion push still works (or is correctly org-scoped).
- [ ] Extension: sign in → see own + shared; share a folder on dashboard → teammate's extension shows it after reload; revoke → it disappears.

**Regression / gates:**
- [ ] Personal-only users (no org) see no behavior change.
- [ ] `npm run lint && npm run typecheck && npm run build` green; `node scripts/check-version.js` + `check-snippets.js` green.
- [ ] `node --check` on every changed extension `.js`.
- [ ] Security advisor clean after each DB step.

---

## 7. OPEN DECISIONS — RESOLVED (2026-06-07)
1. **`snippet_revisions`**: **APPLIED** (B0), rebuilt with **TEXT** `snippet_id` — the original
   `20260528000000` migration was unappliable (`uuid REFERENCES` a `text` PK), which is why the
   feature never worked in prod (and would have failed for the 108/139 non-uuid legacy snippet ids
   regardless). The save RPC's guard moved from `is_shared = TRUE` → `app.can_write_folder`.
2. **LeibTour org membership** (B1): created org **LeibTour**; `locopricesl@gmail.com` +
   `sprintbrainapp@gmail.com` = **admin** (the two accounts that own the shared snippets),
   `b2b@leibtour.com` = **member**. Pure data — adjust by editing `organization_members`.
3. **Notion sync**: **kept single-DB through Phase B** (org-scoping deferred — lowest risk). The
   per-snippet Notion push still works; team *visibility* is now folder-based, not `is_shared`.
4. **Extension reads**: **`SECURITY DEFINER` RPC** `public.accessible_snippets()` (B2) — the
   extension's `loadData()` now calls `/rpc/accessible_snippets` instead of filtering
   `is_shared.eq.true`; folders ride on their own org-aware RLS.

> Implemented across DB (B0–B5) + dashboard (FolderShareModal, permission/org services, relaxed
> reads) + extension (permission-aware read). B6 remains deferred (see Status header).
