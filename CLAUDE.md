# SprintBrain — Root Engineering Standards

**Scope**: Global rules for all packages in this monorepo.  
**Priority**: These rules override nothing in nested `CLAUDE.md` files — they set the floor. Module-level files may add stricter rules for their own scope.  
**Phase**: Pre-seed (Phase 2) — production-quality bar is non-negotiable.

---

## 🎯 Core Feature — Non-Negotiable
**UX/UI excellence and extreme ease of navigation is the primary goal of this project.**  
Every task, feature, and fix must be evaluated first against its impact on simplicity and ease of use.

### Guiding Principles (apply in every session)
- **UX/UI First:** Technical decisions are only acceptable if they preserve or improve the user experience. A technically elegant solution that degrades UX is unacceptable.
- **Navigation Clarity:** Intuitive, low-friction navigation flows take priority over all other concerns. If a feature complicates the interface, it must be redesigned before shipping.
- **Simplicity over Features:** Fewer, well-executed interactions beat many complex ones. Resist feature creep that adds cognitive load.
- **Visible Feedback:** Every user action must produce a clear, immediate, and meaningful response (loading states, success/error signals, confirmation).
- **Consistency:** Visual language, interaction patterns, and terminology must be uniform across the extension and web app.

---

## 🧠 Philosophy
- **Production-first:** Stability and predictability over speed.
- **Zero-defect mindset:** No regressions, no silent failures, no degraded UX.
- **Explicit over implicit:** Clear contracts, typed boundaries, deterministic behavior.
- **AI-assisted development:** Must increase quality, not bypass engineering discipline.
- **Codebase hygiene:** Every change must leave the codebase cleaner, safer, and easier to maintain.

---

## 🚫 Forbidden
- Temporary fixes, quick hacks, or patch-style solutions.
- TODO/FIXME placeholders in production code.
- Commented-out dead code.
- Duplicate logic or copy-paste implementations.
- Silent failures or swallowed exceptions.
- Debug logs committed to production (`console.log`, `console.warn` for debugging).
- TypeScript `any` usage (applies to `app/` — extension is vanilla JS, see `docs/CLAUDE.md`).
- Hidden side effects or implicit mutations.
- Disabling lint/type rules to force builds passing.
- Skipping validation, tests, or verification steps.

---

## ✅ Mandatory
- Preserve backward compatibility unless explicitly approved.
- Validate impacted flows after every modification.
- Keep changes atomic and minimize file surface area.
- Prefer composition over duplication.
- Prefer readability over clever abstractions.
- Add/update tests when business logic changes (see Testing Standards below).
- Log meaningful operational errors with actionable context.
- Maintain strict typing and predictable data flow (where TypeScript applies).
- Keep bundle size and runtime performance under control.

---

## 🔍 Verification Protocol

### After Every Change
1. Run incremental validation immediately.
2. Fix all lint/type errors before continuing.
3. Verify no console warnings/errors remain.
4. Validate impacted UI flows manually.
5. Confirm no regressions introduced.
6. Ensure no unrelated functionality was altered.

### Before Every Commit — `app/` (React/TypeScript)
The following gates are mandatory. All must pass before committing:

```bash
cd app
npm run lint
npm run typecheck
npm run build
# npm run test  ← will be added once the test framework is in place (TESTING-001)
```

### Before Every Commit — Extension (vanilla JS)
No build step. Gates are:
- Manual smoke test: trigger expansion, overlay, formula calculation, context menu
- Confirm no `console.log` debug statements committed
- Reload extension at `chrome://extensions` and verify no errors in service worker

#### Required Summary Format
Every implementation summary must include:

**Changes made:**
- ...

**Verification:**
- lint: PASS / FAIL / N/A
- typecheck: PASS / FAIL / N/A
- build: PASS / FAIL / N/A
- manual test: PASS / FAIL

**Regression check:**
- Result: PASS / FAIL
- Impacted scope: [modules / routes / components / APIs]

---

## 🧪 Regression Policy
- Mandatory regression analysis before implementation.
- Map affected modules, APIs, routes, state flows, and dependencies.
- Re-test critical user paths after changes.
- High-risk changes require smoke tests across related modules.
- No merge allowed with unresolved regressions.
- New features must not degrade existing performance or UX.

---

## 📝 Commit Rules
- **Format:** `type(scope): concise description`
- One logical change per commit.
- No WIP commits on shared branches.
- No debug code or temporary instrumentation.
- Squash noisy history before merge when appropriate.
- Reference issue/ticket IDs when available.

### Accepted Types
`feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `chore`

---

## 🧪 Testing Standards

> **Current state (Phase 2):** The Chrome extension uses manual testing only (no test framework). The `app/` dashboard has no automated test suite yet — this is tracked as `TESTING-001`. Rules below define the standard to build toward.

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

---

## 🏗️ Architecture Standards
- Strict module boundaries; zero circular dependencies.
- TypeScript strict mode enforced globally in `app/`.
- Explicit return types for exported functions (`app/`).
- **Separation of concerns:** UI, Logic, Data, Config, Infrastructure.
- External services must use dedicated service layers.
- Shared logic belongs in reusable modules, not duplicated components.
- State must remain predictable and traceable.
- Favor pure functions and immutable patterns.

---

## ⚡ Performance Standards
- Avoid unnecessary renders and re-fetching.
- Lazy-load heavy modules when possible.
- Prevent memory leaks and dangling listeners.
- Optimize critical rendering paths.
- Keep Lighthouse and Core Web Vitals within acceptable production range.
- Monitor bundle growth continuously.

---

## 🔐 Security Standards
- Zero secrets committed to the repository (env vars + secret manager only).
- Validate and sanitize all inputs; escape outputs by default.
- Principle of least privilege everywhere.
- Enforce authentication and authorization checks globally.
- Apply: CORS, CSRF protection, rate limiting, secure headers.
- Patch critical vulnerabilities within 48h.
- Never trust client-side validation alone.

---

## 🤖 AI Collaboration Rules
- AI must not invent APIs, schemas, or dependencies.
- AI must verify existing architecture before modifying code.
- AI should prefer minimal safe edits over broad rewrites.
- AI must explain risky operations before applying them.
- AI should proactively identify: regressions, performance risks, architectural inconsistencies, and security concerns.
- AI-generated code is never assumed correct without validation.

---

## 📦 Monorepo Structure

```
SprintBrain/
├── CLAUDE.md                          # This file — global engineering standards
├── netlify.toml                       # Netlify deploy (base: app/, publishes dist/)
├── .github/workflows/ci.yml           # CI pipeline (runs on push to develop)
│
├── extension/                         # Chrome MV3 extension (vanilla JS, no build)
│   ├── manifest.json                  # v2.37.0 — permissions, icons, entry points
│   ├── background/background.js       # Service worker: context menus, sync triggers
│   ├── content/content.js             # Keystroke buffer, formula engine, overlay
│   ├── popup/popup.html + popup.js    # Extension popup UI (600×420px)
│   ├── auth/auth.js                   # Supabase OTP + session management
│   ├── services/notion-sync/          # Notion incremental sync engine
│   ├── overlay/overlay.css            # Field input overlay styles
│   ├── shared/tokens/                 # Shared design tokens (colors_and_type.css)
│   └── assets/icons/                  # Extension icons (16/48/128px)
│
├── app/                               # React + Vite SaaS dashboard (v2.28.0)
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
├── design_handoff_design_system/      # Design system (v1.0)
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
    ├── PROJECT_CONTEXT.md             # Full project context (primary AI entry point)
    └── WORKFLOW.md                    # Git branching + commit conventions
```

### CLAUDE.md hierarchy

| File | Scope |
|------|-------|
| `/CLAUDE.md` | **This file** — global floor for all packages |
| `/docs/CLAUDE.md` | Chrome Extension — vanilla JS, MV3, no-build rules |
| `/app/CLAUDE.md` | React/TypeScript dashboard — strict TS, Vite, Supabase |

Local module rules extend but never weaken the global standards defined here.

---

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
Chrome MV3 extension loads directly from `extension/` — no compilation, no bundling.
Manual reload always required: `chrome://extensions` → Reload.

---

## 🚀 Release Standard
A feature or fix is considered complete only if:
- Build passes
- Lint and typecheck pass
- Regression checks pass
- No console noise exists
- UX is validated on the target surface (desktop for dashboard; Chrome for extension)
- Types are strict (where TypeScript applies)
- No temporary workaround remains
- Documentation is updated if architecture changed
