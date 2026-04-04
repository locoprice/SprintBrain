
# claude.md

# SprintBrain - AI Development Context & Guidelines

**Document Version**: 1.1  
**Date Created**: March 31, 2026  
**Author**: Grok (project context based)  
**Project**: SprintBrain  
**Purpose**: Persistent single source of truth for AI (Claude, Grok, GPT, etc.) during assisted development. Always read before generating, modifying, or reviewing code.

This file ensures architectural consistency, coding style, and best practices across the repository.

---

## 1. Project Identity

**SprintBrain** is a **Chrome Extension (Manifest V3)** for advanced productivity.  

**Core Functionality**:
- Creation, management, and triggering of **intelligent snippets** (expandable text with triggers like `;inv`, `;quote`)  
- **Dynamic formulas** (real-time calculations similar to Excel: discounts, fees, net prices, etc.)  
- One-shot and few-shot **AI prompt library**  
- Multi-device **real-time cloud sync**  
- Optional **Notion integration** (uni- or bi-directional sync)  
- Context menu, popup, and service worker for instant text expansion anywhere  

**Goal**: Replace and surpass tools like Text Blaze / TextExpander / Magical, emphasizing dynamic formulas, AI prompts, and reliable sync.  

**Current Status**: MVP operational with local storage + Supabase as source of truth.  
**Future**: Pro tier with Stripe payments, web dashboard, semantic search.

**Supabase** = main source of truth. Notion is optional mirror only.

---

## 2. Tech Stack

| Layer | Technology | Version/Notes |
|-------|------------|---------------|
| Extension | Chrome Manifest V3 | Service Worker mandatory |
| Language | TypeScript | Strict mode, no `any` |
| Build Tool | Vite | Configured for extension |
| UI Framework | React 18+ | Popup + Options page |
| State Management | Zustand | Lightweight stores for snippets, user, sync |
| Styling | Tailwind CSS + shadcn/ui | Current design system |
| Chrome APIs | `chrome.storage`, `chrome.runtime`, `chrome.contextMenus`, `chrome.commands` | MV3 compliant |
| Cloud Backend | Supabase (PostgreSQL + Auth + Realtime) | EU region, `@supabase/supabase-js` v2 |
| Database | PostgreSQL | RLS mandatory on all tables |
| Validation | Zod | TypeScript-first schemas |
| Testing | Vitest | Where applicable |
| Icons | lucide-react | - |
| Date handling | date-fns | - |

**Main dependencies**:
- `react`, `react-dom`  
- `@supabase/supabase-js`  
- `zustand`  
- `tailwindcss`, `@tailwindcss/vite`  
- `zod`  
- `lucide-react`  

**Note**: No Node.js runtime. Everything is client-side (extension) + serverless (Supabase). Future web dashboard will use Next.js 15 App Router.

---

## 3. Database Schema Reference

**Key tables**:
- `snippets` (`id`, `user_id`, `name`, `content`, `triggers[]`, `tags[]`, `is_formula`, `formula`, `variables JSONB`)  
- `prompts` (`id`, `user_id`, `name`, `content`, `type` → 'one-shot' | 'few-shot')  
- `users` (managed by Supabase Auth)  

**Rule**: Always filter queries by `auth.uid() = user_id`.

---

## 4. Development Guidelines & Coding Standards

### 4.1 Naming Conventions
- **Files/Folders**: `kebab-case`  
- **React Components**: `PascalCase`  
- **Variables/Functions**: `camelCase` (functions start with verb)  
- **Constants**: `UPPER_SNAKE_CASE`  
- **Types/Interfaces**: `PascalCase`  
- **Triggers**: user-configurable prefix (default `;`)

### 4.2 State Management
- **Global**: Zustand stores (`stores/snippetStore.ts`, `stores/userStore.ts`, `stores/syncStore.ts`)  
- **Local**: `useState` / `useReducer`  
- **Chrome Storage**: `useChromeStorage` hook for local persistence + fallback  
- **Supabase**: Realtime subscription in service worker + Zustand store

### 4.3 Error Handling
- Always `try/catch` async operations  
- Check `error` from Supabase  
- UI: use toast messages (sonner or react-hot-toast), simple and clear  
- Dev logs only (`console.error` with context)  
- Critical errors: use custom error classes (`SyncError`, `FormulaParseError`)

### 4.4 Component & Folder Structure
```
src/
├── background/          # Service Worker
├── popup/               # React popup UI
├── options/             # Settings page
├── content/             # Content scripts (optional)
├── lib/                 # Utils, hooks, Supabase client
├── stores/              # Zustand stores
├── components/          # shadcn/ui + feature components
├── features/            # snippets/, prompts/, formulas/
└── types/               # TypeScript definitions
```

### 4.5 Best Practices
- Manifest V3: no blocking operations in popup  
- Lazy-load heavy components  
- TypeScript strict: `noImplicitAny`, `strictNullChecks`  
- No new dependencies without approval  
- Self-documenting code; comments only for complex logic  
- Accessibility: aria labels, keyboard navigation  

### 4.6 Git & Workflow
- Branches: `feature/xxx`, `bugfix/yyy`, `chore/`  
- Commits: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)  
- PR: clear title + acceptance criteria  

---

## 5. AI-Specific Instructions (Claude / LLM)
- **Always read** this file + `Cloud.MD` + `README.md` before any response  
- Maintain **absolute consistency** with current style  
- Do **not introduce new libraries or patterns** without explicit approval  
- Prioritize: simplicity > performance > UX  
- Generate **only the necessary file/module** with proper imports and comments  
- UI must follow **existing design system** (Tailwind + shadcn/ui)  

**Excluded from production** (`.gitignore` + `vite.config.ts`)  

---

## 6. Notes from Context
- Formulas stored in `formula` field; evaluated client-side  
- Triggers update inline automatically  
- Dynamic variables stored as JSONB  
- Optional `sync_logs` table for auditing  
- Multi-device sync via Realtime ensures consistent snippet library  

---

**This file is the permanent reference for Claude Code and any AI assisting SprintBrain development.**  
Do not modify without approval; update version when changes are made.
