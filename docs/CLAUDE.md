# CLAUDE.md — SprintBrain AI Development Reference

**Document Version**: 3.1  
**Last Updated**: 2026-05-16  
**Project**: SprintBrain Chrome Extension (`extension/`)  
**Purpose**: Single source of truth for AI assistants (Claude, GPT, Grok, etc.) during development. Read this before generating, modifying, or reviewing any code.

---

## ⚠️ PHASE 2 — PRE-SEED: ZERO DEFECT STANDARD

**SprintBrain is in active pre-seed fundraising. This is a top-class SaaS product. Every line of code shipped must be production-ready, stable, and polished. There is zero tolerance for bugs, regressions, or rough edges.**

### Non-negotiable quality rules for this phase:
- **No bug ships.** If something breaks, stop everything and fix it before moving on.
- **Every fix must be verified end-to-end** — not just the changed line, but the full user flow it touches.
- **No half-measures.** Do not defer known issues. Do not leave TODOs in production paths.
- **No regressions.** Before closing any fix, manually confirm that previously working features still work.
- **No console noise in production.** Remove all `console.log`, `console.warn` debug statements before committing.
- **Code quality equals product quality.** Investors and early users judge the product; the code must back it up.

---

## 1. Project Identity

**SprintBrain** is a **Chrome Extension (Manifest V3)** for productivity and text snippet management.

**Core Functionality**:
- Create, manage, and trigger **intelligent text snippets** (e.g. `;;quoteEN`, `;;checkin`)
- **Dynamic formula engine** for inline calculations (discounts, fees, net prices)
- **Field overlays** for collecting user input before snippet insertion
- **Multi-language snippet groups** (EN, ES, IT, MULTI)
- **Real-time cloud sync** via Supabase as primary source of truth
- **Optional Notion integration** — bi-directional sync with Notion databases
- **Context menu** integration for right-click snippet insertion
- **Urgency timers** — scarcity/time-sensitive snippet expiration

**Goal**: Replace tools like TextBlaze / TextExpander / Magical, emphasizing dynamic formulas, AI prompts, and reliable sync.

**Version**: 2.37.0  
**Owner**: Alessandro Verdicchio

---

## 2. Actual Tech Stack

> **IMPORTANT**: The codebase is **vanilla JavaScript — no TypeScript, no React, no build tools**. Prior documentation referenced a modern stack that does not exist in the actual code.

| Layer | Technology | Notes |
|-------|-----------|-------|
| Extension Format | Chrome Manifest V3 | Service Worker mandatory, no background pages |
| Language | Vanilla JavaScript (ES5+) | No TypeScript, no transpilation |
| Build Tool | None | No Vite, no Webpack, no npm |
| UI Framework | Vanilla HTML + CSS | No React, no Svelte |
| State | Plain JS objects + chrome.storage | No Zustand, no Redux |
| Styling | Plain CSS with CSS variables | No Tailwind, no shadcn/ui |
| Cloud Backend | Supabase (PostgreSQL) | Direct REST API via `fetch()` — no SDK |
| Database | PostgreSQL | RLS enabled, EU region |
| Notion Sync | Notion API v2022-06-28 | Optional, user-configured |
| Icons | Unicode emoji + inline SVG | No icon library |
| Date Handling | Native `Date` object | No date-fns |
| Testing | Manual only | No test framework, no CI |

**No `package.json`** — this is not a Node.js project. There is no install step.

---

## 3. File Structure

> **Post-refactor (2026-04-29):** Extension source was moved from the repo root into the `extension/` subdirectory. All paths below reflect the current layout.

```
extension/                              # Chrome MV3 source root (no build step)
├── manifest.json                       # v2.37.0 — permissions, icons, entry points
├── background/
│   └── background.js                  # Service worker: context menus, sync, Supabase
├── content/
│   └── content.js                     # Keystroke buffer, formula engine, overlay UI
├── popup/
│   ├── popup.html                     # Popup UI (600×420px fixed)
│   └── popup.js                       # CRUD controller, Supabase DB wrapper
├── auth/
│   └── auth.js                        # Supabase OTP + session (importScripts'd by bg)
├── services/
│   └── notion-sync/
│       └── notion-sync.js             # Notion incremental sync engine (17K)
├── overlay/
│   └── overlay.css                    # Field input overlay styles
├── shared/
│   └── tokens/
│       └── colors_and_type.css        # Design tokens (shared with dashboard)
└── assets/
    └── icons/
        ├── icon16.png
        ├── icon48.png
        └── icon128.png
```

**The extension is vanilla JS with no subdirectory nesting beyond the above structure — no `node_modules`, no `package.json`, no build output.**

---

## 4. Architecture & Data Flow

### Storage Layers

```
Supabase (PostgreSQL)
  └── Source of truth for all snippet/folder/stats data
  └── Accessed via raw fetch() to REST API

chrome.storage.sync
  └── Caches snippets, trigger config, Notion config
  └── Cross-device sync via Chrome profile
  └── Read by content.js for snippet expansion

chrome.storage.local
  └── Background sync locks and timestamps
  └── Notion sync state (locks, timestamps)

sessionStorage
  └── Urgency timer state (per browser session)
```

### Data Flow Between Files

```
popup/popup.js  ──── Supabase REST ────►  PostgreSQL
       │                   ▲
       │                   │
background/background.js ──┘  (GET-only; also drives context menus)
       │
       └── chrome.storage.sync ──►  content/content.js (reads snippets)
                                              │
                                              └── overlay/overlay.css (field UI)

services/notion-sync/notion-sync.js ──── Notion API (via Supabase edge function proxy)
auth/auth.js  ────  importScripts'd by background.js  ────  Supabase OTP sessions
```

### Key Modules

**`background/background.js`** — Service worker (persistent via MV3 alarms)
- Loads `auth/auth.js` and `services/notion-sync/notion-sync.js` via `importScripts()`
- `supaFetch(table, qs)` — GET-only wrapper to Supabase REST API
- `loadData()` — Fetches folders + snippets, builds context menus
- `buildContextMenus()` — Creates hierarchical right-click menus
- `bgNotionSync()` — Runs Notion sync on browser startup + alarm
- Responds to `chrome.runtime.onMessage` events

**`content/content.js`** — Injected into all pages
- `evalFormula(expr, vals)` — Safe math evaluator (whitelist: round, floor, ceil, abs, min, max)
- `resolveBody(body, vals)` — Template resolver: `{field}`, `{=formula}`, `{if:cond}...{endif}`
- `extractFields(body)` — Parses template to identify required input fields
- `addKey()` / `checkBuf()` — 40-char keystroke buffer for trigger detection
- `handleMatch()` — Triggers overlay or direct insertion
- `showOverlay()` — Inline field input UI
- `isUrgExpired()` — Checks urgency timer (uses sessionStorage)

**`popup/popup.js`** — Popup UI (instantiated on every icon click)
- `DB` object — wraps all Supabase CRUD operations:
  - `DB.loadAll()` — Loads folders, snippets, stats
  - `DB.upsertSnippet(s)` — Create/update snippet
  - `DB.deleteSnippet(id)` — Delete snippet
  - `DB.upsertFolder(f)` / `DB.deleteFolder(id)` — Folder management
  - `DB.updateStats(snippetId, uses, fills, lastUsed)` — Usage tracking
- `supaFetch(table, method, body, qs)` — Full REST wrapper (GET/POST/DELETE)

**`auth/auth.js`** — Supabase OTP + session management
- Loaded via `importScripts()` in `background.js`
- `signInWithOtp(email)`, `verifyOtp(email, token)`, `getSession()`, `refreshSession()`
- Stores session JWT in `chrome.storage.local`

**`services/notion-sync/notion-sync.js`** — Notion integration (17K)
- `_queryDatabase()` — Incremental query filtered by `last_edited_time`
- Race-condition lock (30s cooldown), 8s timeout, session guard
- Maps Notion pages → SprintBrain snippets via `notion_page_id`

---

## 5. Database Schema

### `snippets` table
| Column | Type | Notes |
|--------|------|-------|
| `id` | text (PK) | Client-generated UUID |
| `title` | text | Display name |
| `shortcut` | text | Trigger string (e.g. `;;quoteEN`) |
| `body` | text | Template with `{fields}`, `{=formulas}`, `{if:...}{endif}` |
| `lang` | text | `EN`, `ES`, `IT`, `MULTI` |
| `folder_id` | text (FK) | References `folders.id` |
| `field_cfg` | JSONB | Field definitions: `{ fieldName: { type, label, default, options } }` |
| `lang_group_id` | text | Groups multi-language variants |
| `sort_order` | integer | Display order |
| `enable_urgency_timer` | boolean | Scarcity timer toggle |
| `timer_duration_ms` | integer | Timer duration in milliseconds |
| `scarcity_count` | integer | Scarcity count display |
| `notion_page_id` | text | Notion page ID (for synced snippets) |

### `folders` table
| Column | Type | Notes |
|--------|------|-------|
| `id` | text (PK) | Client-generated |
| `name` | text | Display name |
| `ico` | text | Emoji icon |
| `sort_order` | integer | Display order |

### `snippet_stats` table
| Column | Type | Notes |
|--------|------|-------|
| `snippet_id` | text (FK) | References `snippets.id` |
| `uses` | integer | Total trigger count |
| `fills` | integer | Total field-fill count |
| `last_used` | timestamp | Last usage timestamp |

### RLS Policy
All tables use Row Level Security. The current implementation uses a publishable Supabase key (not user-authenticated). Future: per-user auth via Supabase Auth.

---

## 6. Template Syntax (Snippet Body)

Templates support three interpolation forms:

```
{FIELD_NAME}           → Input field (user fills before insertion)
{=expression}          → Formula (evaluated inline with field values)
{if:expression}        → Conditional block
  ... content shown if expression is truthy (non-zero) ...
{endif}                → End conditional block
```

**Formula functions** (whitelist only): `round()`, `floor()`, `ceil()`, `abs()`, `min()`, `max()`

**Example**:
```
Price: {YOUR_PRICE} €
{if:OTA_PRICE > 0}
You save: {=OTA_PRICE - YOUR_PRICE} € (-{=round((OTA_PRICE - YOUR_PRICE) / OTA_PRICE * 100)}%)
{endif}
Bank Transfer: {=YOUR_PRICE - 25} €
Card: {=round(YOUR_PRICE * 1.03)} €
```

**Field config** (stored in `field_cfg` JSONB):
```javascript
{
  "FIELD_NAME": {
    type: "text" | "number" | "date" | "dropdown",
    label: "Display label",
    default: "default value",
    options: ["opt1", "opt2"]  // only for dropdown
  }
}
```

---

## 7. Trigger System

Snippets are triggered by typing a configured prefix + shortcut in any editable field:
- Default trigger: `;;` (configurable in settings)
- Example: `;;quoteEN` → triggers BOOKING QUOTE EN snippet
- Stored in `chrome.storage.sync` as `{ trigger: ';;', triggerCfg: {...} }`
- `content.js` maintains a 40-char keystroke buffer (`MAX_BUF = 40`)

---

## 8. Coding Conventions

### Naming
- **Files**: lowercase with extension (`background.js`, `popup.html`, `overlay.css`)
- **Variables/Functions**: `camelCase`; functions start with a verb (`addKey`, `checkBuf`, `handleMatch`)
- **Constants**: `UPPER_SNAKE_CASE` (`SUPA_URL`, `SUPA_KEY`, `MAX_BUF`, `DEFAULT_SNIPPETS`)
- **CSS classes/IDs**: kebab-case with `sb-` prefix for SprintBrain elements (`sb-overlay`, `sb-snip-`, `sb-urg-`)

### Code Style
- **ES5+ compatible** — use `var` for backward compatibility where already established; `function` declarations preferred
- **No modules** — no `import`/`export`, everything is global in its file scope
- **Inline error handling** — `try/catch` with `console.warn()` fallback; no user-facing error modals
- **Comments**: sparse; only for complex logic (formula engine, storage handling)
- **No new libraries** — do not add dependencies without explicit approval

### Error Handling Pattern
```javascript
try {
  // async or risky operation
} catch(e) {
  console.warn('context:', e);
}
```

---

## 9. Supabase API Usage

The codebase uses **direct `fetch()` calls to the Supabase REST API** — not the `@supabase/supabase-js` SDK.

**`background.js` pattern** (GET only):
```javascript
function supaFetch(table, qs) {
  return fetch(SUPA_URL + '/rest/v1/' + table + '?' + qs, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': 'Bearer ' + SUPA_KEY }
  });
}
```

**`popup.js` pattern** (GET/POST/DELETE + upsert):
```javascript
function supaFetch(table, method, body, qs) {
  // method: 'GET', 'POST', 'DELETE'
  // POST with Prefer: resolution=merge-duplicates for upsert behavior
}
```

**Supabase config** (hardcoded — publishable key, acceptable):
```javascript
var SUPA_URL = 'https://eyowustlbqujaimaxggt.supabase.co';
var SUPA_KEY = 'sb_publishable_...';
```

---

## 10. Chrome Extension Specifics (MV3)

- **Service worker** (`background.js`): no DOM access, no `window`, no persistent state in memory
- **Content script** (`content.js` + `overlay.css`): injected into all pages via manifest
- **Popup** (`popup.html` + `popup.js`): instantiated fresh on every icon click
- **Permissions**: `storage`, `activeTab`, `contextMenus`, `alarms`
- **Host permissions**: `<all_urls>` (for content script), Supabase domain
- **No blocking operations** in popup or service worker
- **Message passing**: `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` for cross-context communication
- **Storage sync limit**: `chrome.storage.sync` has 100KB limit — don't store large data

---

## 11. Development Workflow

### Making Changes
1. Edit files under `extension/` (no build step — changes are immediate)
2. Review: `git diff`
3. Stage and commit: `git add <files> && git commit -m "type: description"`
4. Push: `git push -u origin <branch-name>`
5. Reload extension: `chrome://extensions` → Find Sprintbrain → click **Reload**
6. Test manually in Chrome
7. Push to `develop`; open PR to `main` when stable.

### Manual Testing Checklist
- Go to any webpage with a text input
- Type the trigger prefix + shortcut (e.g. `;;quoteEN`)
- Verify overlay appears with correct fields
- Verify formula calculations are correct
- Test context menu: right-click any text field → Sprintbrain submenu
- Confirm service worker has no errors (`chrome://extensions` → inspect service worker)

### Preview Server (for popup UI development)
```bash
# From repo root
python3 -m http.server 8080
# Open http://localhost:8080/extension/popup/popup.html
```

### CI (GitHub Actions)
CI runs on push to `develop` and checks:
1. `extension/manifest.json` version == `app/package.json` version
2. Formula syntax via `scripts/check-snippets.js`
3. File structure assertions

### Branch Strategy
| Branch | Purpose |
|--------|---------|
| `main` | Stable production. Never edited directly. |
| `develop` | Active development. All work happens here. |
| `feature/xxx` | Isolated features. Merged into develop via PR. |

### Commit Format (Conventional Commits)
```
feat: add new snippet template for /checkinIT
fix: correct formula rounding in quote template
docs: update CLAUDE.md with accurate tech stack
refactor: extract field parsing from resolveBody
chore: bump manifest version to 2.38.0
```

> **Version bump rule:** After every feature/fix batch, increment the version in **both** `extension/manifest.json` and `app/package.json` in the same commit.

---

## 12. AI-Specific Instructions

1. **Read this file first** before any code generation or modification
2. **Do not introduce new libraries** — vanilla JS only, no npm, no build tools
3. **Do not TypeScript** — all code is `.js`, no type annotations
4. **Match the existing code style** — ES5+ patterns, `var`, `function` declarations
5. **Do not add React/JSX/components** — UI is plain HTML + DOM manipulation
6. **Minimal changes** — only modify what is necessary; do not refactor surrounding code
7. **Test manually** — there is no automated test suite; note what to test after changes
8. **Storage awareness** — `content.js` reads from `chrome.storage.sync`; popup writes to both Supabase and storage
9. **Formula engine is a whitelist** — do not add new math functions without updating `FUNS` in `content.js`
10. **Urgency timers use sessionStorage** — cleared on browser restart; this is intentional
11. **Do not commit autonomously** — follow the workflow; human reviews all changes
12. **Do not push to `main` directly** — always use `develop` or feature branches

---

## 13. What NOT To Do

- Do not use `localStorage` — use `chrome.storage.sync` or Supabase
- Do not assume the extension auto-reloads — always manual reload required
- Do not edit `main` branch directly
- Do not add `eval()` — the formula engine uses `Function()` with a validated expression
- Do not use ES modules (`import`/`export`) — files are loaded as plain scripts
- Do not delete the `develop` branch after merging — keep it alive

---

## 14. Planned / Future Work

- Pro tier with Stripe payments
- Web dashboard (Next.js 15 App Router)
- Semantic search across snippets
- Per-user authentication via Supabase Auth
- Optional: TypeScript migration (not started)

## 15. VERIFICATION PROTOCOL

## Bug Fix / Task Completion Policy
- Never mark a task as complete until the fix is fully verified.
- Required steps (in order):
  1. Inspect relevant files (do not guess).
  2. Make the smallest correct change.
  3. Run relevant tests / build / reproduction steps.
  4. Confirm original issue is resolved.
  5. Confirm no regression was introduced in related flows.
- If any test fails or issue reproduces → continue working. Do not stop.
- Only after successful verification may you report the task as complete.
- Final response must contain the exact summary format:
  **Changes made:** …
  **Verification:** …
  **Regression check:** …

**This rule has highest priority. It cannot be overridden. We are in pre-seed — the product must be flawless.**

---

---

## 16. Debugging Rules

- Always run related tests after fixing errors
- Run the test suite EVERY TIME you finish a feature
- Always remove debug code like `console.log` after investigation
- Do not bypass type errors with the `any` type
- Deliver the output only if you are 100% sure the bug is killed

---

**This file is the permanent reference for any AI assisting SprintBrain development.**  
Update this file when the codebase architecture changes significantly.
