# web/CLAUDE.md — SprintBrain Dashboard (React)

**Document Version**: 2.1
**Last Updated**: April 25, 2026
**Project**: SprintBrain SaaS Dashboard (web/)
**Purpose**: AI development reference for the React dashboard. The Chrome extension lives at the repo root and follows a different stack — see `../CLAUDE.md` for that codebase.

---

## 1. What this is

The SprintBrain dashboard is a **desktop-only single-page application** served at the site root (`/`) on Netlify. It is the SaaS surface complementary to the Chrome extension and the mobile companion at `/mobile/`.

**Scope (v2.17.0)**: Supabase magic-link authentication (domain-restricted to `@leibtour.com`) with live reads + full CRUD for snippets, folders, and prompts (AUTH-001 + SNIPPETS-CRUD-001 + PROMPTS-001 all shipped). Analytics still uses mock fixtures pending the `snippet_events` time-series table (`ANALYTICS-001`).

**Audience**: hospitality operators (LeibTour) primarily; B2B prospects evaluating SprintBrain.

---

## 2. Stack (fixed)

| Layer | Choice |
|---|---|
| Build | Vite 5 |
| UI | React 18 + TypeScript (strict) |
| Styling | Tailwind CSS 3 + handcrafted shadcn-style primitives |
| Icons | `lucide-react` |
| Dates | `date-fns` |
| State | Zustand (one store per feature) |
| Router | `react-router-dom` v6 |
| Validation | Zod (`src/types/schemas.ts`) |
| Charts | Recharts |

**Adding a dependency requires explicit approval.** Bump `package.json` in the same commit that introduces the import.

---

## 3. Folder structure

```
web/
├── public/                # Static assets served verbatim
│   ├── icon{16,48,128}.png
│   ├── landing/           # Legacy desktop landing (was repo-root index.html)
│   └── mobile/            # Mobile companion app
├── src/
│   ├── main.tsx           # ReactDOM root
│   ├── App.tsx            # Router + DesktopGate
│   ├── index.css          # Tailwind layers + base styles
│   ├── routes/
│   │   ├── DashboardLayout.tsx
│   │   ├── SnippetsPage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   ├── PromptsPage.tsx
│   │   └── SettingsPage.tsx
│   ├── components/
│   │   ├── ui/            # shadcn primitives
│   │   ├── layout/        # Sidebar, Topbar, PageHeader, EmptyState, DesktopGate
│   │   └── shared/        # Reusable cross-feature components (KpiCard)
│   ├── features/
│   │   ├── snippets/      # SnippetFolderTree, SnippetsTable, NewSnippetDialog
│   │   ├── analytics/     # UsageChart, TopTriggersTable
│   │   ├── prompts/       # PromptCard
│   │   └── settings/      # NotionSyncPanel, AccountPanel, IntegrationsPanel
│   ├── stores/            # Zustand stores: snippet, prompt, analytics, settings, ui
│   ├── lib/
│   │   ├── api/           # Mock service layer; same shape as future Supabase impl
│   │   ├── utils.ts       # cn(), formatDuration(), formatCompact()
│   │   └── useViewportGate.ts
│   ├── types/
│   │   ├── database.ts    # Mirrors Supabase tables (see ../PROJECT_CONTEXT.md §4)
│   │   └── schemas.ts     # Zod schemas
│   └── mock/
│       └── fixtures.ts    # Deterministic seed data
├── index.html             # Vite root
├── package.json
├── tailwind.config.ts
├── tsconfig.json + tsconfig.app.json + tsconfig.node.json
└── vite.config.ts
```

---

## 4. Conventions

### 4.1 Naming
- **Files/folders**: `kebab-case` for non-components, `PascalCase.tsx` for React components
- **Components**: `PascalCase`
- **Functions/variables**: `camelCase` (functions start with a verb)
- **Types/interfaces**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE`

### 4.2 Imports
- Always use the `@/` alias for anything under `src/`. Never use deep relative paths (`../../`).
- Group: external first, then `@/` internal, then relative siblings.

### 4.3 State
- Feature stores in `src/stores/<feature>Store.ts` with one `load()` action that calls `lib/api`
- Cross-cutting UI state lives in `uiStore.ts`
- Component-local state via `useState` / `useReducer`
- Never read mock fixtures directly from a component — always go through `lib/api/*`

### 4.4 Styling
- Tailwind utilities only. No CSS modules, no styled-components.
- Use the design tokens defined in `tailwind.config.ts` (`primary`, `ink`, `bg`, `line`, etc.). Do not hard-code hex values in components.
- Border radius defaults to `12px` (`rounded-[12px]`); cards use `16px` (`rounded-[16px]`).

### 4.5 Desktop-only
- The dashboard renders the `DesktopGate` for any viewport `< 1024px`.
- Do not add mobile breakpoints. Ranges target 1280 / 1440 / 1920.
- Mobile users are redirected to `/mobile/` (existing companion app).

### 4.6 TypeScript
- Strict mode enforced. No `any`. No `// @ts-ignore`.
- Prefer `interface` for object shapes, `type` for unions and primitives.
- All API service responses are typed against `src/types/database.ts`.

### 4.7 Mock vs live data (as of v2.17.0)
- **Live**: `snippetsApi` (folders + snippets + stats joined, full CRUD), `promptsApi` (live reads + CRUD against `public.prompts`), `settingsApi.getProfile` (derived from the authed `auth.users` record), `settingsApi.getNotionSync` (reads latest `notion_sync_log` row).
- **Still mock**: `analyticsApi` (needs `snippet_events` time-series table — tracked in `ANALYTICS-001`).
- Fixtures in `src/mock/fixtures.ts` remain deterministic (no `Math.random()` at runtime). Date offsets use a fixed `day(offset)` helper from `Date.now()` so the chart shape is stable per session.
- All mock UUIDs are hand-rolled and stable across re-renders.

### 4.8 Auth + RLS
- Magic-link flow via `supabase.auth.signInWithOtp`; PKCE. Only `@leibtour.com` emails can sign up (enforced by a `BEFORE INSERT` trigger on `auth.users`).
- The dashboard uses the Supabase publishable key; the JS client attaches the user's JWT to every request automatically.
- DB RLS still has permissive `team_*` policies (`qual: true`) needed by the extension's anon-key reads. Until the extension migrates (`AUTH-EXT-001`), every dashboard query explicitly filters `.eq('user_id', currentUserId)` in app code — do NOT remove those filters.

### 4.9 Forms
- Snippet, folder, and prompt forms are wired to Supabase via Zod-validated stores with optimistic updates (SNIPPETS-CRUD-001, PROMPTS-001).
- Analytics-related controls remain disabled placeholders pending `ANALYTICS-001`. Disabled controls must include `title` explaining why.

---

## 5. Build & deploy

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server on `http://localhost:5173` |
| `npm run build` | `tsc -b && vite build` → `web/dist/` |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run preview` | Serve the production build locally |

**Netlify** publishes `web/dist`. SPA fallback to `index.html`. The static folders `landing/` and `mobile/` are copied verbatim from `web/public/` and served at `/landing/` and `/mobile/`.

---

## 6. What NOT to do

- Do not import from the extension files at the repo root (`background.js`, `popup.js`, etc.). They share no runtime.
- Do not remove the `.eq('user_id', currentUserId)` filter from any Supabase query until `AUTH-EXT-001` lands and the `team_*` RLS policies come off — without it, every authed user can read every other user's rows.
- Do not introduce mobile breakpoints, dark mode, or i18n in this iteration.
- Do not edit the design tokens in `tailwind.config.ts` without updating both the dashboard and the legacy landing in `public/landing/index.html` to stay coherent.
- Do not run `npm install` at the repo root — install only inside `web/`.
- Do not commit the Supabase publishable key anywhere else (it's already in `src/lib/supabase.ts`; don't duplicate into `.env` files).

---

## 7. Roadmap (next tickets)

1. ~~Supabase auth (magic link) + live reads~~ ✅ shipped in v2.15.0 (AUTH-001).
2. ~~**SNIPPETS-CRUD-001** — create / edit / delete snippets and folders from the dashboard with Zod validation and optimistic updates.~~ ✅ shipped in v2.16.0.
3. ~~**PROMPTS-001** — create `public.prompts` table + RLS; replace `promptsApi` mock with live reads.~~ ✅ shipped in v2.17.0.
4. **AUTH-EXT-001** — migrate the Chrome extension from the anon key to per-user JWTs; drop the permissive `team_*` RLS policies.
5. **ANALYTICS-001** — add `public.snippet_events` time-series table; extension + dashboard log one row per trigger; replace `analyticsApi` mock with grouped aggregates.
6. **NOTION-SYNC-DASH-001** — trigger Notion sync from the dashboard + show sync history.
7. Dark mode (`uiStore` already has the seam).

---

> Read this file and `../CLAUDE.md` before any modification. Push to `origin develop` only. No direct commits to `main`.
