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

## 🎨 Design System v1.1 — Canonical

**Status**: Active (shipped 2026-05-18). Replaces the dual Iris/Azure split from v1.0 with a single Azure primary across every surface (landing, mobile, dashboard, extension popup, in-page overlay).

### Visual source of truth

`design_handoff_design_system/mockups/harmonized-final.html` is the **single visual reference** for every UI decision. Open it in a browser before designing or reviewing any UI change. Every surface in the file — tokens strip, landing, mobile (home + detail + sheet), dashboard, extension popup — is the rendering target.

When the mockup and a piece of shipped UI disagree, the mockup wins by default. Disagreement that is intentional (e.g. a follow-up ticket altering the design) must be tracked explicitly with a follow-up entry below.

### Canonical tokens

> **Hard rule**: Any new color, radius, shadow, or spacing value introduced in any package must be added to this table **first**, then referenced by name from the appropriate token file:
>  - Dashboard: `app/tailwind.config.ts` + `app/src/index.css` (CSS variables)
>  - Extension + overlay: `extension/shared/tokens/colors_and_type.css`
>  - Mobile companion: inline `:root` in `app/public/mobile/index.html` (kept in sync with this table)
>
> Hard-coded hex values in component files are forbidden outside the per-language inline tints in `SnippetsTable.tsx` (which intentionally mirror the mobile palette).

#### Neutrals

| Token        | Hex       | Usage                                        |
| ------------ | --------- | -------------------------------------------- |
| `bg`         | `#FAFAFA` | Page background (dashboard)                  |
| `bg-alt`     | `#F2F2F7` | Sidebar background (dashboard); muted card   |
| `card`       | `#FFFFFF` | Card / surface (all)                         |
| `line`       | `#E5E5EA` | Hairline border                              |
| `ink`        | `#1C1C1E` | Primary text                                 |
| `ink-muted`  | `#6E6E73` | Secondary text                               |
| `ink-subtle` | `#8E8E93` | Tertiary text / hints                        |

#### Primary (single — Azure)

| Token          | Hex                    | Usage                                  |
| -------------- | ---------------------- | -------------------------------------- |
| `primary`      | `#1B4FD8`              | Brand + accent across every surface    |
| `primary-dark` | `#1440B0`              | Hover / pressed                        |
| `primary-light`| `#3D6FE8`              | Hover bg gradient endpoints            |
| `primary-bg`   | `#EEF2FF`              | Filled-tint badge / active row bg      |
| `primary-bdr`  | `#BED0FF`              | Filled-tint badge border               |
| `primary-glow` | `rgba(27,79,216,.14)`  | Focus ring shadow                      |

**v1.1 removes Iris purple `#6C5CE7` entirely.** The `--sb-iris*` aliases in the extension's tokens file still resolve, but they all point at the azure values. Any new code must use `--sb-azure*` / `primary` directly.

#### Language palette (must stay identical across all surfaces)

| Lang  | Fg        | Bg        |
| ----- | --------- | --------- |
| EN    | `#1B4FD8` | `#EEF2FF` |
| ES    | `#C2410C` | `#FFF7ED` |
| IT    | `#15803D` | `#F0FDF4` |
| MULTI | `#7C3AED` | `#F5F3FF` |

**v1.1 retires the FR pill.** Legacy data with `lang = 'FR'` renders with the MULTI palette via an alias; cleaning up the `Snippet['language']` type union (`app/src/types/database.ts`) is tracked separately.

**v1.1 changed IT from red `#DC2626` to green `#15803D`** to remove the false signal that Italian = stop / error.

#### Semantic

| Token     | Hex       | Usage              |
| --------- | --------- | ------------------ |
| `success` | `#34C759` | Confirmation, deltas (Apple semantic green) |
| `warning` | `#FEBC2E` | Caution            |
| `danger`  | `#E74C3C` | Destructive (Apple semantic red) |

#### Radii

| Token         | Value | Usage                                    |
| ------------- | ----- | ---------------------------------------- |
| `r-xs`        | 4 px  | Inner chips, code tokens                 |
| `r-sm`        | 6 px  | Small buttons, icon wells                |
| `r-in`        | 10 px | Inputs                                   |
| `r` (default) | 12 px | Cards (mobile), primary buttons          |
| `r-btn`       | 14 px | Mobile copy button (large hit target)    |
| `r-card`      | 16 px | Cards (dashboard, mockup KPI + table)    |
| `r-card-lg`   | 18 px | Mobile snippet card                      |
| `r-pill`      | 9999  | Pills, chips, count badges               |

#### Shadows

| Token       | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| `shadow-sm` | `0 1px 3px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.04)`           |
| `shadow-md` | `0 4px 20px rgba(27,79,216,.12), 0 1px 3px rgba(0,0,0,.06)`       |

### Surface-specific rules (v1.1)

- **Dashboard topbar** spans the full width (60 px) above sidebar + main. Brand square (28 px, `--primary` solid) on the left.
- **Dashboard sidebar** active nav: `bg-primary-light` + 3 px primary left bar (painted via `::before`, reserved track so the row doesn't shift on toggle) + filled count pill (`bg-primary` + white text) when count > 0. Inactive count pill: `bg-bg-alt` + `ink-subtle`.
- **Mobile home** is a single-scroll canvas. Gradient hero (`linear-gradient(160deg, #1B4FD8, #1440B0)`) → floating quick-action grid (overlaps hero by `-22 px`) → search → "All snippets" + Uber-style chips (white default, `#1C1C1E` bg when active) → snippet cards (`r-card-lg`, 14 px padding, 46 × 46 colored icon well per language family) → floating Apple/Revolut tab bar (`rgba(28,28,30,.92)` + blur 20).
- **Extension popup** active folder: light-primary bg + 2 px primary left bar + **filled** azure count pill (not tinted). All Iris purples replaced with `#1B4FD8`.
- **Shortcut tag** anywhere it renders: split into `::` prefix at opacity `0.45` + body at full weight. The mockup's `.sctag` pattern is canonical.

### Visual references

| Surface  | Mockup section                                | Live screenshot                                                       |
| -------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Mobile   | "Landing + mobile home" + "Mobile · states"   | `design_handoff_design_system/screenshots/step-a.png`                 |
| Dashboard| "Dashboard · harmonized"                      | `step-b.png` + `step-b-analytics.png`                                 |
| Extension| "Chrome extension · harmonized"               | `step-c.png`                                                          |

### Open follow-ups (intentional deviations from mockup)

- Mobile "Recently used" carousel: omitted from `app/public/mobile/index.html` until we track snippet `last_used_at`. Slot is reserved in the section layout.
- Mobile bottom sheet: 3 actions (Use now / Edit / Delete) instead of mockup's 4 (Share missing) — needs a `navigator.share` JS handler.
- Quick-action tiles + mobile tab-bar items are cosmetic shells (no handlers yet).
- Dashboard "Folders" nav row: mockup shows it; needs a top-level `/folders` route.
- Hero "time saved" stat: shows snippet count instead until we track time-saved telemetry.
- FR pill: retired visually (now renders as MULTI violet) but still in `Snippet['language']` type union.

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

## 🐛 Bug Fix Protocol

These rules apply to every bug fix task, without exception.

### Step 1 — Reproduce first, code second
Before touching a single line of code, Claude **must** reproduce the bug. This means running the exact steps that trigger the failure and observing it directly. Guessing at a fix without confirmed reproduction is forbidden.

> **If the bug cannot be reproduced:** Stop immediately. Do not make any code change. Ask the user for a clearer reproduction case (exact steps, environment, inputs, expected vs actual behavior) before continuing.

### Step 2 — Fix only what is broken
The fix must be scoped strictly to the reported bug. No refactoring, cleanup, or opportunistic improvements beyond the failing behavior — unless explicitly approved. Scope creep during a bug fix introduces untested risk.

### Step 3 — Verify the fix is complete
A bug fix is **not done** until all four gates pass:

1. **Re-reproduce** — Run the exact same steps that triggered the bug and confirm it no longer occurs.
2. **Related flows** — Manually test every user flow that touches the changed code, not just the broken path.
3. **Regression test** — Add a test (unit or integration) that would have caught this bug, so it cannot silently return.
4. **Automated gates** — `npm run lint`, `npm run typecheck`, `npm run build` must all pass (for `app/`).

### Hard rules
- **Never ship a fix that introduces a new bug.** Zero-regression policy: if fixing A breaks B, the task remains open.
- **Never mark a task complete without end-to-end verification.** The fix must be confirmed working in the actual runtime, not just in theory.

### Communication during bug fixes
Work silently and autonomously. Surface a message only when genuinely blocked — not for status updates, intermediate findings, or routine progress. The final report uses the standard summary format above.

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

### End-of-Task Auto-Push (`develop`)
At the end of every **successfully completed** task, prepare a push to `develop` **proactively** — do not wait to be asked. This is a standing authorization that overrides the default "never commit/push unless asked" rule, *for this repository only*, and only under the gates below.

**Preconditions (all must hold — otherwise do NOT push; fix or report instead):**
1. **Verification gates pass.**
   - `app/`: `npm run lint`, `npm run typecheck`, `npm run build` all green.
   - extension: `node --check` on every changed `.js`, plus `node scripts/check-version.js` and `node scripts/check-snippets.js` green.
2. **Version bumped** in `extension/manifest.json` **and** `app/package.json`, kept in parity.
3. **Genuine task completion** — never mid-task, never on a failed or abandoned attempt.

**Workflow (auto-prep + quick confirm):**
1. Run `git status` and `git diff --stat`; report the changed files.
2. Show a draft commit message in `type(scope): description — vX.Y.Z` format.
3. Wait for a one-word confirmation (`go` / `confirm`).
4. On confirm: `git add <specific files>`, `git commit`, `git push origin develop`; report each result and the commit hash.

⛔ The only valid branch is `develop` — never create a branch. ⛔ Never push without the quick confirmation in step 3.

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
