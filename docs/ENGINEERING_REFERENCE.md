# SprintBrain — Engineering Reference

> **On-demand reference.** Orientation material pulled out of the root `CLAUDE.md` to keep always-on context lean. Read when a task touches repo structure, the CI pipeline, or testing. For the fuller project narrative see `docs/PROJECT_CONTEXT.md`.

## 📦 Monorepo Structure

```
SprintBrain/
├── CLAUDE.md                          # Root — global engineering standards (always-on guardrails)
├── netlify.toml                       # Netlify deploy (base: app/, publishes dist/)
├── .github/workflows/ci.yml           # CI pipeline (runs on push to develop)
│
├── extension/                         # Chrome MV3 extension (vanilla JS, no build)
│   ├── manifest.json                  # permissions, icons, entry points
│   ├── background/background.js       # Service worker: context menus, sync triggers
│   ├── content/content.js             # Keystroke buffer, formula engine, overlay
│   ├── popup/popup.html + popup.js    # Extension popup UI
│   ├── auth/auth.js                   # Supabase OTP + session management
│   ├── services/notion-sync/          # Notion incremental sync engine
│   ├── overlay/overlay.css            # Field input overlay styles
│   ├── shared/tokens/                 # Shared design tokens (colors_and_type.css)
│   └── assets/icons/                  # Extension icons (16/48/128px)
│
├── app/                               # React + Vite SaaS dashboard
│   ├── CLAUDE.md                      # Dashboard-specific AI rules
│   ├── package.json                   # Dependencies + version (must match manifest)
│   ├── vite.config.ts                 # Vite 5 config
│   ├── tailwind.config.ts             # Design tokens exposed as Tailwind classes
│   ├── src/                           # All React/TypeScript source
│   └── public/                        # Static assets (landing/, mobile/, icons)
│
├── services/supabase/                 # Backend infrastructure
│   ├── migrations/                    # Ordered SQL migrations (apply via Supabase CLI)
│   └── functions/notion-snippet-push/ # Edge function: Notion → Supabase proxy
│
├── design_handoff_design_system/      # Design system handoff (mockups, tokens, previews)
│   ├── tokens/colors_and_type.css     # Canonical token file (source of truth)
│   ├── kits/                          # Reference HTML kits (extension + dashboard)
│   ├── previews/                      # Live token preview pages
│   └── docs/                          # VISUAL_FOUNDATIONS, CONTENT, ICONOGRAPHY
│
├── scripts/                           # Node.js CI helper scripts
│   ├── check-version.js               # Enforces manifest ≈ package.json version parity
│   └── check-snippets.js              # Validates formula/template syntax
│
└── docs/                              # Architecture + workflow documentation
    ├── CLAUDE.md                      # Extension AI dev reference (vanilla JS rules)
    ├── DESIGN_SYSTEM.md               # Design System v1.1 — canonical tokens (read before UI work)
    ├── ENGINEERING_REFERENCE.md       # This file
    ├── PROJECT_CONTEXT.md             # Full project context (primary AI entry point)
    └── WORKFLOW.md                    # Git branching + commit conventions
```

### CLAUDE.md hierarchy

| File | Scope |
|------|-------|
| `/CLAUDE.md` | Root — global floor for all packages (always-on guardrails) |
| `/docs/CLAUDE.md` | Chrome Extension — vanilla JS, MV3, no-build rules |
| `/app/CLAUDE.md` | React/TypeScript dashboard — strict TS, Vite, Supabase |

Local module rules extend but never weaken the root standards.

## 🔄 CI / Build Pipeline

### GitHub Actions (`.github/workflows/ci.yml`)
Runs on every push to `develop`. Three gates must pass:

1. **Version parity** — `scripts/check-version.js` verifies `extension/manifest.json` version matches `app/package.json`. Both must be kept in sync; increment together.
2. **Formula validation** — `scripts/check-snippets.js` validates snippet template/formula syntax.
3. **File structure** — Asserts `extension/manifest.json`, `app/index.html`, and `app/package.json` exist.

### Dashboard build (Netlify)
Auto-deploys from `main` via `netlify.toml` (`base = "app"`, publishes `dist/`).

```bash
cd app
npm ci && npm run build   # tsc -b && vite build → app/dist/
```

### Extension (no build)
Chrome MV3 extension loads directly from `extension/` — no compilation, no bundling. Manual reload always required: `chrome://extensions` → Reload.

## 🧪 Testing Standards

> **Current state (Phase 2):** The Chrome extension uses manual testing only (no test framework). The `app/` dashboard has no automated test suite yet — tracked as `TESTING-001`. Rules below define the standard to build toward.

### Unit Testing
- Required for utilities and business logic.
- Cover edge cases and failure states.
- Avoid implementation-detail testing.

### Integration Testing
- Required for APIs, routes, auth flows, and critical UI paths.
- Validate real interaction between modules.

### E2E / Smoke Testing
- Required for critical production flows: Authentication, Dashboard actions, Extension communication, Data persistence flows.

### CI Rules (once TESTING-001 lands)
- Never hit live production services during CI.
- Mock external providers and unstable dependencies.
- Flaky tests are treated as failures.
- **Coverage target:** ≥80% lines, ≥80% branches.
