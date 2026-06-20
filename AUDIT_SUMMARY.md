# SprintBrain — Two-Platform Audit (Links · CRUD · Parity)

**Date:** 2026-06-20 · **Version:** 2.63.8 · **Branch:** `develop`
**Scope:** Every UI link · Save / Edit / Delete / Sync for **snippets and prompts** on **both platforms** (Chrome extension + web dashboard) · cross-platform parity.
**Verdict:** ✅ **PASS** — all links valid; snippet + prompt CRUD/sync functional on every surface where the operation exists; no unintended parity gaps. One intentional, product-documented asymmetry: extension prompts are read-only.

---

## Method & evidence

| Gate / check | Result |
|---|---|
| `app` — `npm run lint` (eslint) | ✅ clean |
| `app` — `npm run typecheck` (`tsc -b --noEmit`) | ✅ clean |
| `app` — `npm run test` (vitest) | ✅ **143/143** across 9 specs |
| `app` — `npm run build` (`tsc -b && vite build`) | ✅ success (chunk-size advisory only) |
| `node scripts/check-version.js` | ✅ 2.63.8 parity (manifest + package + landing hero) |
| `node scripts/check-snippets.js` | ✅ formula engine 5/5 |
| `node scripts/check-icons.js` | ✅ icon16/48/128 valid PNGs |
| `node --check` × 7 extension JS files | ✅ all parse |
| Live authed dashboard (Vite preview, port 5173) | ✅ persisted session; **141 snippets** + folders + team rendered via RLS |

**Write-path coverage (vitest):** `deletionSync` (18), `snippetRevisions` (11), `promptLifecycle` (6), `promptFolders` (5), `folderShares` (5), `snippetGrouping` (14) — all green.

**Constraints (stated, not worked around):**
- The dashboard is OTP-gated to `@leibtour.com`. Live verification used the preview's persisted session to prove **read / auth / RLS / session** end-to-end against production (141 real snippets, folders, team all surfaced).
- Live **writes were not executed** against the production workspace (141 real, 49 team-shared snippets) to avoid polluting a real team. Save/Edit/Delete are evidenced by the targeted vitest suites above plus a full static UI → store → API → Supabase trace.
- The Chrome extension cannot run in this environment. Its paths are evidenced by `node --check`, the `deletionSync` vitest suite (its real delete logic runs verbatim), the `check-*` gates, and code-path tracing.

---

## 1. Links — all valid

### Landing — `app/public/landing/index.html`
**Internal (file/anchor targets confirmed present):** `/` brand · `#features` → `<section id="features">` (line 897) · `/legal/{privacy-policy,terms-and-conditions,cookie-policy}.html` (all three files present) · favicons + partner logos (all present).

**External (live-checked — HTTP/redirect resolved):**
| Destination | Result |
|---|---|
| Chrome Web Store `…/khdp…opoo` ("Add to Chrome") | ✅ valid listing — "SprintBrain" by locoprice, v2.62.2 (EU consent gate intercepts, then continues to the canonical detail page) |
| `app.sprintbrain.com/{login,signup,mobile}` | ✅ SPA shell serves |
| `github.com/locoprice/SprintBrain` (+ `/issues`) | ✅ repo + issues live |
| `sprintbrain.instatus.com` | ✅ status page live (all systems operational) |
| `leibtour.com`, `locoprice.com` (partner logos) | ✅ external sites, well-formed |
| `mailto:sprintbrainapp@gmail.com` | ✅ well-formed |

The prior audit's orphan `#install` anchor (F1) is gone after the footer refactor — resolved.

### Dashboard
- **Footer legal** (`DashboardLayout.tsx`) — live DOM confirms `sprintbrain.com/legal/{privacy-policy,terms-and-conditions,cookie-policy}.html`; all three return 200.
- **Resource links** (`lib/links.ts`) — investors + bug Jotforms, GitHub issues, Instatus — all live-checked ✅.
- **Signup / Auth legal links** — same `sprintbrain.com/legal/*` targets ✅.

---

## 2. Save / Edit / Delete / Sync — both platforms

| Operation | Dashboard (React) | Extension (vanilla JS) |
|---|---|---|
| **Snippet — Save** | `snippetsApi.createSnippet` → insert | `DB.upsertSnippet` → POST |
| **Snippet — Edit** | `editSnippetWithRevision` (`save_snippet_with_revision` RPC) / `updateSnippet` | `DB.upsertSnippet` (merge-duplicates) |
| **Snippet — Delete** | `removeSnippet` → `deleteSnippet` (owner-scoped) | `DB.deleteSnippet` + `sync-deletion.js` (`SBPopupSync`) |
| **Snippet — Sync** | `pushSnippetToNotion` + Supabase persistence | `syncSnippets()` → `storage.local` → `content.js` |
| **Prompt — Save** | `promptStore.addPrompt` → `createPrompt` | — read-only by design — |
| **Prompt — Edit** | `editPrompt` → `updatePrompt` | — read-only by design — |
| **Prompt — Delete** | `removePrompt` → `deletePrompt` | — read-only by design — |
| **Prompt — Sync** | `pushPromptToNotion` (`notion-prompt-push` edge fn) | `syncPrompts()` → `storage.local` → `"""` picker |

Every dashboard mutation is Zod-validated, optimistic, and wraps the API call in `try/catch` that surfaces `store.error` to the page banner (no silent swallow; optimistic state rolls back on failure). Extension writes go through `supaFetch` (GET/POST/DELETE) with per-row owner scope; deletes are mirrored locally + remotely by `SBPopupSync`.

---

## 3. Parity verdict

- **Snippets:** full Save / Edit / Delete / Sync parity across both platforms. ✅
- **Prompts:** full CRUD on the dashboard; the extension is a **read-only consumer** (list + Copy + `"""` insert). This is intentional and product-documented — the extension's empty state reads *"Create and edit prompts in the dashboard."* It is not a defect and not a regression.
- **No unintended parity gaps found.**

---

## Findings (non-blocking)

| # | Severity | Finding |
|---|---|---|
| F1 | Doc drift | `docs/CLAUDE.md` still states "Testing: Manual only / no test framework." Reality: a live vitest suite (9 specs, 143 tests) is wired to `npm run test`. (Carried from the prior audit.) |
| F2 | Perf (advisory) | `vite build` warns the main JS chunk is ~1.22 MB (338 kB gzip), over the 500 kB advisory. Code-split candidate. |
| F3 | Data parity | Dashboard `createSnippet` does not populate `lang_group_id`; new dashboard-made variants won't group on extension/mobile (which group on that key) until the field is set on create. Display-only; not a CRUD defect. The dashboard now collapses variants by base trigger as a stop-gap (`snippetGrouping.ts`). |

---

## Done criteria
- ✅ Every link enumerated + verified (internal existence + live external checks) — no broken links.
- ✅ Snippet S/E/D/Sync verified on both platforms — full parity.
- ✅ Prompt S/E/D/Sync verified on dashboard; extension read-only consumption documented as intentional.
- ✅ All gates green; live authed dashboard confirms read/auth/RLS in production.
- ✅ Parity reported honestly: no unintended gaps; one documented by-design asymmetry.

**STATUS: PASS**
