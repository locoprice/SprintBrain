# web/CLAUDE.md — SprintBrain Dashboard (React)

**Document Version**: 1.0
**Last Updated**: April 18, 2026
**Project**: SprintBrain SaaS Dashboard (web/)
**Purpose**: AI development reference for the React dashboard. The Chrome extension lives at the repo root and follows a different stack — see `../CLAUDE.md` for that codebase.

---

## 1. What this is

The SprintBrain dashboard is a **desktop-only single-page application** served at the site root (`/`) on Netlify. It is the SaaS surface complementary to the Chrome extension and the mobile companion at `/mobile/`.

**Scope (v2.14.0)**: layout-only scaffold with mock data. No authentication, no live Supabase calls, no CRUD. Follow-up tickets wire auth and replace mock services.

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

### 4.7 Mock data
- Fixtures in `src/mock/fixtures.ts` are deterministic (no `Math.random()` at runtime). Date offsets use a fixed `day(offset)` helper from `Date.now()` so the chart shape is stable per session.
- All UUIDs are hand-rolled and stable across re-renders.

### 4.8 Forms
- All forms in v2.14.0 are non-functional placeholders. Wire-up happens in the CRUD ticket.
- Disabled controls must include `title` explaining why.

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
- Do not add a Supabase client until the auth ticket lands. The mock service layer is the seam.
- Do not introduce mobile breakpoints, dark mode, or i18n in this iteration.
- Do not edit the design tokens in `tailwind.config.ts` without updating both the dashboard and the legacy landing in `public/landing/index.html` to stay coherent.
- Do not run `npm install` at the repo root — install only inside `web/`.

---

## 7. Roadmap (next tickets)

1. Supabase auth (magic link or Google) + replace mock services with live reads
2. Snippet CRUD with Zod validation + optimistic updates
3. Prompt CRUD + AI provider integration
4. Analytics live aggregation from `snippet_stats`
5. Notion sync trigger + history view
6. Dark mode (`uiStore` already has the seam)

---

> Read this file and `../CLAUDE.md` before any modification. Push to `origin develop` only. No direct commits to `main`.
