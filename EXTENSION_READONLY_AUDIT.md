# SprintBrain — Extension Read-Only Refactor & Migration Audit

**Date:** 2026-06-27 · **Version:** 2.77.0 · **Branch:** `claude/extension-readonly-migration-audit-w8wnrq`
**Scope:** Audit the popup → dashboard migration, verify completeness, fix verifiable defects, and define the staged path to a read-only popup.
**Verdict:** ⚠️ **MIGRATION INCOMPLETE (by design, not regressed).** Prompts are already read-only in the popup; **snippets, folders, and settings still carry full business logic in the popup**. This session delivers the audit + the one runtime-safe fix; the read-only transformation is staged as a reviewed follow-up (rationale in §6).

---

## Method & evidence

| Gate / check | Result |
|---|---|
| `node --check` × 7 extension JS files | ✅ all parse (post-edit) |
| `node scripts/check-version.js` | ✅ 2.77.0 parity (manifest + package + landing hero) |
| `node scripts/check-snippets.js` | ✅ formula engine 8/8 |
| `node scripts/check-icons.js` | ✅ icon16/48/128 valid |
| Dead-code detection (grep cross-ref, all `.js`/`.html`) | ✅ 3 unused functions found + removed |

**Hard environment constraint:** this is a Chrome-less remote container. A Chrome extension **cannot be loaded or runtime-verified here.** Per `CLAUDE.md` (zero-regression, reproduce-then-fix, runtime verification before "done"), no change that depends on observing live extension behaviour is shipped in this session. Static analysis (`node --check`, grep cross-referencing, code-path tracing) is the only available evidence, and it bounds what can be safely changed.

---

## 1. Migration Audit

### ✅ Migrated correctly
| Feature | Evidence |
|---|---|
| **Prompt management** | Popup is read-only: list + Copy + `"""` insert only. `renderPrompts()` (popup.js) has no create/edit/delete; empty state reads *"Create and edit prompts in the dashboard."* `setMode('prompts')` hides the "New" button (`bnew2.style.display='none'`). Matches `AUDIT_SUMMARY.md`. |
| **Open Dashboard** | `openDashboard()` reuses/focuses an existing dashboard tab; mirrors `background.js` context-menu behaviour. |
| **Auth (OTP + SSO handoff)** | `initAuthGate()` + `background.js onMessageExternal`; session handoff from `app.sprintbrain.com` via `externally_connectable`. Correctly centralised. |
| **Context menus / quick-insert** | Built in `background.js` from synced data; `content.js` performs expansion. This is the correct "background = sync/messaging layer" role. |

### ⚠️ Partially migrated (logic still duplicated in the popup)
| Feature | Popup still owns | Dashboard owns (source of truth) |
|---|---|---|
| **Snippets** | Full CRUD: `openEd` / `doSave` / `doDel`, multi-language variant editor, `DB.upsertSnippet`/`deleteSnippet` → `supaFetch` POST/DELETE | `snippetsApi` (create/edit-with-revision/delete) |
| **Folders** | Create/rename/delete, icon picker, context menus (`openFolderModal`, `startInlineRename`, folder ctx-menu) | Dashboard folder management |
| **Settings — Notion** | `notion-key` / `notion-db` inputs, `saveNotionCfg`, `pushNotionCfgToSupabase` | Dashboard Notion settings (popup already pulls via `syncNotionCfgFromSupabase`) |
| **Settings — Triggers** | `tcfg-*` inputs rewrite every snippet's shortcut prefix (`applyTrig`, `setTriggerCfgValue`) | Dashboard settings |
| **Team Sync** | `doTeamSync()` PATCHes `snippets`/`prompts` `folder_id` directly in Supabase | Dashboard team/sharing |

### ❌ Not migrated
None outstanding. Every popup capability has a dashboard equivalent; the gap is **direction of ownership** (popup still *writes*), not a missing dashboard feature. Prompt-side migration is the proof-of-shape for the snippet/folder/settings work that remains.

---

## 2. Bugs Fixed

| # | Type | Fix | Verification |
|---|---|---|---|
| B1 | Dead code | Removed `callEdgeFunction` (popup.js:52–72) — defined, **zero references** anywhere in the extension. | grep across all `.js`/`.html`; `node --check` ✅ |
| B2 | Dead code | Removed `addLangVariant` (24 lines) — unreachable; the editor language tabs (`switchEditorLang`/`initEditorLangTabs`) superseded it. | grep cross-ref; `node --check` ✅ |
| B3 | Dead code | Removed `showLangPicker` (39 lines) — unreachable; no caller, no inline handler. | grep cross-ref; `node --check` ✅ |

Net: **90 lines deleted**, no behavioural change. Shared helpers they touched (`findVariants`, `LANGS`, `LNAMES`, `bodyVariants`, `selId`) remain referenced by live code and were preserved.

### Investigated — **not** defects (verified, no change made)
- **Two `onMessage.addListener` in `background.js`** (lines 59, 428): handle disjoint message types (`log_event` vs `auth_changed`); only the first calls `sendResponse`/returns `true`. Valid MV3 multi-listener pattern, not a duplicate-listener bug.
- **`REFRESH_MENUS` message**: popup sends it (popup.js:1626/1638); **handled** at `background.js:494`. No dead message. (Menus also rebuild via `chrome.storage.onChanged` `sb_menu_refresh`.)
- **`doSave` multi-row legacy path**: intricate but coherent (single-row dashboard model vs legacy `lang_group_id` siblings). No verifiable defect; left untouched (can't runtime-test).

---

## 3. Popup Cleanup (this session)

Only the runtime-safe subset was executed:
- Removed 3 unreachable functions (B1–B3), 90 lines.

**Deliberately NOT removed this session** (snippet/folder CRUD, Notion/trigger settings, Team Sync): each is *working* business logic whose removal changes UX and **cannot be runtime-verified without Chrome**. Shipping an untested ~2,000-line rip-out would violate `CLAUDE.md`'s zero-regression mandate. The staged plan is in §6.

---

## 4. Performance Improvements

- **−90 lines / ~3.4 KB** off `popup.js` (no minification in this vanilla-JS extension, so source size ≈ shipped size). Smaller parse/compile surface on every popup open.
- No new dependencies, imports, listeners, or renders introduced.
- Measurable popup-startup wins (deferring CRUD code, lazy editor) depend on the §6 transformation and require Chrome profiling to quantify honestly — not claimed here.

---

## 5. Architecture Validation (current state)

| Layer | Intended role | Actual |
|---|---|---|
| **Dashboard** | Source of truth, CRUD, settings | ✅ Owns all of this |
| **Background** | Sync, messaging, cache, menus | ✅ Correct — alarms, context menus, auth handoff, event logging |
| **Popup** | Lightweight read-only client | ❌ **Still a second app** for snippets/folders/settings; ✅ already read-only for prompts |

The background/dashboard boundaries are sound. The popup is the only layer violating the target architecture, and it does so for snippets/folders/settings only.

---

## 6. Remaining Technical Debt — staged read-only plan

Recommended follow-up, **each step gated by a manual Chrome smoke test** (load unpacked → expand a snippet → open dashboard → confirm sync), in increasing risk order:

1. **Settings duplication (lowest risk).** Replace the popup's Notion-key/DB and trigger-config inputs with a read-only status + "Manage in Dashboard" deep-link. The popup already *pulls* Notion config via `syncNotionCfgFromSupabase`; it only needs to stop *writing* it. Removes `saveNotionCfg`, `pushNotionCfgToSupabase`, `setTriggerCfgValue` write paths and the `tcfg-*`/`notion-*` change handlers.
2. **Team Sync.** `doTeamSync()` writes `snippets`/`prompts` `folder_id` directly — pure dashboard responsibility. Remove the button + handler; surface team state read-only.
3. **Folder management.** Demote create/rename/delete + icon picker to read-only folder filters. Folders become a navigation facet, not an editable entity.
4. **Snippet CRUD (highest risk).** Remove `openEd`/`doSave`/`doDel` + the multi-language editor. Reduce the popup to: quick overview, user + sync status, shortcut list, expansion support, "Open Dashboard." This is the bulk of the ~2,000 lines and the change most needing live verification (variant grouping, Notion archive-on-delete, `manually_edited` semantics).

**Cross-cutting debt (carried from `AUDIT_SUMMARY.md`):**
- **F1** `docs/CLAUDE.md` still says "Testing: Manual only" though a vitest suite exists.
- **F2** `vite build` main chunk ~1.22 MB (338 KB gzip) — code-split candidate (dashboard side).
- **F3** dashboard `createSnippet` doesn't set `lang_group_id`; variant grouping relies on a base-trigger stop-gap. Resolve before step 4 so popup/dashboard grouping fully agree.

---

## Done criteria (this session)
- ✅ Full codebase audit completed; ownership gaps enumerated with evidence.
- ✅ Confirmed: prompts migrated (read-only); snippets/folders/settings still duplicated in popup.
- ✅ One verifiable defect class fixed (90 lines dead code); all extension gates green.
- ✅ False positives investigated and dismissed, not reported as fixes.
- ⏸️ Read-only transformation **staged**, not executed — gated on Chrome runtime verification per `CLAUDE.md`.

**STATUS: AUDIT COMPLETE · SAFE FIXES SHIPPED · TRANSFORMATION STAGED**
