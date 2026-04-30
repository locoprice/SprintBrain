# PROJECT_CONTEXT.md — SprintBrain
> **Version:** 2.14.1 | **Branch:** develop | **Last Updated:** 2026-04-18  
> **Author:** Alessandro Verdicchio | **Maintainer:** Alessandro + Claude Chat  
> ⚠️ This file is the primary context entry point for Claude Code and all AI agents. Read before executing any task.

---

## 1. CORE PURPOSE

SprintBrain is a **Chrome Extension (Manifest V3)** that expands text shortcuts into structured, reusable content templates — directly inside any web input field (Airbnb, WhatsApp, CRMs, booking engines).

**Primary Use Case:** Hospitality team at **LeibTour** (Ibiza vacation rentals) — multilingual communication templates triggered by shortcuts like `/quoteEN`, `/quoteES`, `/firm`.

**Strategic Vision:**
- Maximize typing speed and reduce cognitive load for hospitality operators
- Enable AI-assisted, prompt-engineering-forward snippet management
- Sync snippets from Notion → Extension with zero manual copy-paste
- Scale into a B2B SaaS tool for prompt engineers and operations teams
- Target: **Y Combinator accelerator** — product must demonstrate clean architecture and investor-grade code quality

---

## 2. TECH STACK — HIGH-FIVE FRAMEWORK

| Layer | Technology | Role |
|---|---|---|
| **Extension** | Chrome MV3 (JS) | Core runtime, DOM injection, trigger detection |
| **Database** | Supabase (PostgreSQL) | Snippets, auth, RLS, sync log |
| **Auth** | Supabase GoTrue | JWT-based user sessions |
| **Sync Source** | Notion API v1 | Snippet database, changelog, project management |
| **Marketing Site** | Webflow | Landing page + onboarding UI |
| **Deployment** | Netlify | Static assets, web endpoints (auto-deploy from `main`) |
| **Source of Truth** | GitHub | All code — `main` = stable, `develop` = active |
| **AI Development** | Claude Chat + Claude Code | Architecture decisions + controlled code generation |

---

## 3. SYSTEM ARCHITECTURE

### 3.1 Data Flow

```
Notion DB (snippets source)
    ↓  [notion-sync.js — Supabase Edge Function proxy]
chrome.storage.local (offline cache: sb_notion_snippet_cache)
    ↓  [content.js — DOM listener]
Text Field (Airbnb, WhatsApp, CRM, etc.)
    ↓  [trigger detected: /shortcut or ::]
Expanded snippet injected into DOM
```

### 3.2 Repo File Map

**Chrome Extension (root)**

| File | Version | Responsibility |
|---|---|---|
| `manifest.json` | 2.14.1 | Permissions, metadata, version |
| `content.js` | — | DOM injection, trigger detection, formula engine |
| `popup.js` | — | UI boot, Notion credential persistence, sync trigger |
| `popup.html` | 2.14.1 | Extension popup UI markup |
| `background.js` | v2.9 | Service worker, startup sync, context menus |
| `notion-sync.js` | v2.2 | Notion → Extension sync engine |
| `overlay.css` | — | Snippet overlay styles |
| `icon{16,48,128}.png` | — | Extension icons (also duplicated in `app/public/`) |

**Web Dashboard (`app/`)** — added in v2.14.0

| Path | Responsibility |
|---|---|
| `app/src/App.tsx` | Router + viewport gate |
| `app/src/routes/` | DashboardLayout + 4 page components (Snippets, Analytics, Prompts, Settings) |
| `app/src/features/` | Per-feature components grouped by domain |
| `app/src/components/{ui,layout,shared}/` | Shadcn primitives + layout chrome + reusable widgets |
| `app/src/stores/` | Zustand stores (snippet, prompt, analytics, settings, ui) |
| `app/src/lib/api/` | Mock service layer; same shape as future Supabase impl |
| `app/src/types/database.ts` | Mirrors Supabase schema (§4) |
| `app/src/mock/fixtures.ts` | Deterministic seed data |
| `app/public/landing/` | Legacy desktop marketing landing (was repo-root `index.html`) |
| `app/public/mobile/` | Mobile companion app (moved from repo-root `mobile/`) |
| `app/CLAUDE.md` | Dashboard-specific AI rules (separate stack from extension) |

### 3.3 Snippet Data Priority (Strict Order)

```
1. chrome.storage.local  →  fast, offline-safe
2. Supabase (snippets table)  →  authenticated, RLS-protected
3. Notion API  →  sync source, requires credentials
```

⚠️ **DO NOT mix data sources** without explicit priority logic.

---

## 4. SUPABASE CONFIGURATION

| Parameter | Value |
|---|---|
| **Project ID** | `eyowustlbqujaimaxggt` |
| **Region** | eu-west-1 |
| **Edge Function Endpoint** | `https://eyowustlbqujaimaxggt.supabase.co/functions/v1/notion-sync` |

### Tables

| Table | Purpose |
|---|---|
| `profiles` | User data |
| `snippets` | Trigger → body mapping |
| `folders` | Snippet organization |
| `snippet_stats` | Usage tracking |
| `logs` | General event log |
| `notion_sync_log` | Sync audit trail |

### RLS Policy
- All tables: `auth.uid() = user_id`
- `anon` key is hardcoded in `background.js` and `popup.js` — expected for Chrome Extensions; RLS is the security layer
- Users: Alessandro + Valentina (accounts must exist in `auth.users`)

---

## 5. NOTION SYNC ENGINE

**File:** `notion-sync.js` v2.2  
**Proxy:** Supabase Edge Function (server-to-server — Notion token never exposed to browser)

### Notion Database

| Parameter | Value |
|---|---|
| **Database ID** | `a06cac8d5e0282c28c4101e9e3ea3f88` |
| **Data Source ID** | `c96cac8d-5e02-83b1-8361-072c52766763` |
| **Integration** | "DATABASE SNIPPETS // sync SprintBrain" (internal `ntn_...` key stored as Supabase secret) |

### Property Schema (VERIFIED 2026-03-29)

| Property | Type | Maps To |
|---|---|---|
| `Nome Snippet` | title | `snippet.title` |
| `Shortcut` | rich_text | `snippet.shortcut` |
| `Categoria` | select | `snippet.folder` |
| `Body` | rich_text | `snippet.body` (property-first, blocks API fallback) |
| `Versione` | rich_text | (not mapped) |
| `Folder Origine` | select | (not mapped) |

### Sync Behavior

| Rule | Value |
|---|---|
| **Pagination** | Cursor-based, 10-page cap (max ~100 snippets) |
| **Retry strategy** | Exponential backoff: 3 retries at 1s / 2s / 4s (only on 429 / 5xx) |
| **Immediate fail** | 400, 401, 403, 404 — no retry |
| **Debounce guard** | Skip if last sync < 60s (key: `sb_notion_last_sync_ts`) |
| **Force sync** | `force=true` parameter bypasses debounce |
| **Offline cache** | Saves to `sb_notion_snippet_cache` on success; fallback on failure |
| **Background alarm** | `chrome.alarms` every 5 minutes |

### Credential Storage

- Key: `sb_notion_cfg` in `chrome.storage.local`
- ⚠️ `background.js` must read `sb_notion_cfg` — any other key = silent failure

---

## 6. FORMULA ENGINE

**Files:** `content.js` and `popup.js` — `resolveBody()` function

Syntax: `{var: name = expression}`

- Supports computed variables (invisible in output)
- Supports ternary operators
- Division-by-zero protected

Example:
```
{var: nights = checkin - checkout}
{var: total = nights > 0 ? nights * rate : 0}
Your stay of {nights} nights totals €{total}.
```

---

## 7. DEVELOPMENT WORKFLOW (NON-NEGOTIABLE)

### Branching
- `main` → stable production (source of truth)
- `develop` → all active work
- `feature/*` → isolated experimental features

### Responsibilities

| Agent | Role | Restrictions |
|---|---|---|
| **Claude Chat** | Architecture, debugging, task instructions | No direct commits |
| **Claude Code** | File edits and git ops | Only on `develop`, only when explicitly invoked |
| **Alessandro** | All git pushes, approvals, extension reloads | Full control |

### Commit Protocol

```
1. Claude Code reports ALL changes before pushing
2. One commit per logical unit
3. Format: type: short description
4. Push to: origin develop ONLY
5. Version bump = final commit in every batch
```

### Version Bump Rule
After every feature/fix batch, increment version across:
- `manifest.json`
- `popup.html`
- File headers (where present)

---

## 8. CHROME EXTENSION RULES

- Extension **never auto-updates** — manual reload required
- Reload path: `chrome://extensions` → Click "Reload"
- Load from git repo path only — extracted ZIPs or `~` paths cause failures
- Always verify loaded version via `chrome://extensions` before testing

---

## 9. KEY CONSTRAINTS & KNOWN ISSUES

| Constraint | Detail |
|---|---|
| **Trigger detection bug** | Extension incorrectly fires on `/` alone — fix requires strict whitelist validation, removing hardcoded fallback triggers |
| **RLS setup** | In progress — verify `auth.users` has accounts for Alessandro + Valentina; `user_id` backfill pending |
| **Notion property names** | Case-sensitive — always verify via live `notion-fetch` before coding sync logic |
| **Body content** | Notion `Body` property may be empty for pages created before property was added — blocks API fallback is mandatory |
| **Storage key mismatch** | `background.js` must use `sb_notion_cfg` — any deviation = credentials not persisting across restarts |
| **Manifest local changes** | Uncommitted local changes in `manifest.json` — resolve before next push |
| **Stale branch** | Delete `claude/check-code-bugs-hi0cD` branch when next in git context |

---

## 10. SECURITY RULES

- **No API keys or tokens** in this file or any client-side file except `anon` key (RLS-protected)
- Notion integration token stored exclusively as **Supabase secret env variable**
- Communication path: Browser → Supabase Edge Function → Notion API (server-to-server only)
- JWT required for all Supabase table access
- RLS is the primary data isolation layer — never disable

---

## 11. FUTURE ROADMAP

| Item | Status |
|---|---|
| Web dashboard scaffold (`app/`, mock data, 4 pages) | ✅ v2.14.0 |
| Web dashboard auth (Supabase magic link or OAuth) | 📋 Planned |
| Web dashboard live data + CRUD | 📋 Planned |
| Marketing site rebuild on Webflow (external) | 📋 Planned |
| Complete RLS setup (Alex + Valentina accounts) | 🔄 In Progress |
| Trigger whitelist validation fix | 📋 Planned |
| Google Chrome Web Store submission | 📋 Planned |
| Modular voice-activated trigger system | 💡 Concept |
| Prompt engineering library (one-shot, chain-of-thought) | 💡 Concept |
| B2B SaaS expansion beyond LeibTour | 💡 Concept |

---

## 12. REPOSITORY & RESOURCES

| Resource | URL |
|---|---|
| **GitHub** | https://github.com/locoprice/SprintBrain |
| **Supabase Dashboard** | https://supabase.com/dashboard/project/eyowustlbqujaimaxggt |
| **Notion Project** | https://www.notion.so/S-B-Business-Plan-03825b4f81f882cba46e81ce6ea9211b |
| **Netlify Site ID** | `ec845afc-6f...` (auto-deploys from `main`) |
| **Local Dev Path** | `C:\Users\averd\Desktop\sprintbrain-extension\` |

---

> ⚠️ **AI Agent Directive:** Read this file fully before executing any task. Never commit to `main`. Never mix data source layers without explicit priority logic. All changes require Alessandro's approval before push.
