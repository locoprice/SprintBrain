# SprintBrain — Root Engineering Standards

**Scope**: Global floor for all packages in this monorepo. Nested `CLAUDE.md` files (`app/`, `docs/`) add stricter rules; they never weaken these.
**Phase**: Pre-seed (Phase 2) — production-quality bar is non-negotiable. Production-first, zero-defect: stability over speed; every change leaves the codebase cleaner.

> **Lean-context policy** — this file holds only always-on guardrails. Reference material is read on demand when a task needs it:
> - 🎨 **Design tokens, palette & UI rules** → `docs/DESIGN_SYSTEM.md` — **MANDATORY read before ANY UI / CSS / component / token change.** It is the single source of truth for visual decisions.
> - 🏗️ **Monorepo map, CI/build, testing standards** → `docs/ENGINEERING_REFERENCE.md`.

---

## 🎯 Core Feature — Non-Negotiable
**UX/UI excellence and extreme ease of navigation is the primary goal of this project.** Evaluate every task first against its impact on simplicity and ease of use.

- **UX/UI First** — a technically elegant solution that degrades UX is unacceptable; redesign instead.
- **Navigation clarity** takes priority over all other concerns except security and data integrity.
- **Simplicity over features** — fewer, well-executed interactions beat many complex ones; resist cognitive load.
- **Visible feedback** — every user action yields a clear, immediate response (loading / success / error).
- **Consistency** — uniform visual language, interaction patterns, and terminology across extension and web app.

---

## 🛠️ Engineering Workflow
Senior-engineer method — **Explore → Plan → Implement → Verify** (never collapse Explore into Implement), surgical edits, read-before-edit, investigate-before-referencing. Full definition: engineer's global `~/.claude/CLAUDE.md`.

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
- Inventing APIs, schemas, or dependencies — verify existence before use.
- Skipping validation, tests, or verification steps.

---

## ✅ Mandatory
- Preserve backward compatibility unless explicitly approved.
- Validate impacted flows after every modification.
- Keep changes atomic and minimize file surface area.
- Prefer composition over duplication; readability over clever abstractions.
- Add/update tests when business logic changes (see `docs/ENGINEERING_REFERENCE.md`).
- Log meaningful operational errors with actionable context.
- Maintain strict typing and predictable data flow (where TypeScript applies).
- Keep bundle size and runtime performance under control.
- Explain risky or destructive operations before applying them.
- Proactively flag regressions, performance, architectural, and security risks you spot.

---

## 🔍 Verification Protocol

### After every change
1. Run incremental validation immediately; fix all lint/type errors before continuing.
2. Verify no console warnings/errors remain.
3. Validate impacted UI flows manually; confirm no regressions and no unrelated functionality altered.

### Before every commit — `app/` (React/TypeScript)
All gates mandatory:

```bash
cd app
npm run lint
npm run typecheck
npm run build
# npm run test  ← added once the test framework lands (TESTING-001)
```

### Before every commit — Extension (vanilla JS)
No build step. Gates:
- `node --check` on every changed `.js`; `node scripts/check-version.js` and `node scripts/check-snippets.js` green.
- Manual smoke test: trigger expansion, overlay, formula calculation, context menu.
- No `console.log` debug statements committed; reload at `chrome://extensions` and confirm no service-worker errors.

### Regression
Map affected modules, APIs, routes, and state flows **before** implementing. High-risk changes require smoke tests across related modules. No merge with unresolved regressions; new features must not degrade existing performance or UX.

### Required summary format
Every implementation summary must include:

**Changes made:** …
**Verification:** lint / typecheck / build — PASS / FAIL / N/A · manual test — PASS / FAIL
**Regression check:** Result PASS / FAIL · Impacted scope [modules / routes / components / APIs]

---

## 🐛 Bug Fix Protocol
1. **Reproduce first, code second.** Observe the failure directly before changing anything. If you can't reproduce it, **stop** — make no change and ask for a clearer repro (exact steps, environment, inputs, expected vs actual).
2. **Fix only what is broken.** No refactoring or opportunistic cleanup beyond the failing behavior unless approved.
3. **Verify complete** — re-reproduce (now passes), test every related flow, add a regression test that would have caught it, and pass lint/typecheck/build.

**Zero-regression:** if fixing A breaks B, the task stays open. Never mark done without end-to-end runtime verification. Work silently; surface a message only when genuinely blocked.

---

## 📝 Commit Rules
- **Format:** `type(scope): concise description`. One logical change per commit.
- Accepted types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `chore`.
- No WIP commits on shared branches; no debug code or temporary instrumentation; reference issue/ticket IDs when available.

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

## 🔐 Security Standards
- Zero secrets committed (env vars + secret manager only).
- Validate and sanitize all inputs; escape outputs by default; never trust client-side validation alone.
- Principle of least privilege everywhere; enforce auth/authorization checks globally.
- Apply CORS, CSRF protection, rate limiting, secure headers. Patch critical vulnerabilities within 48h.

---

## 🏗️ Architecture & Performance
- Strict module boundaries; zero circular deps. TS strict mode in `app/`; explicit return types on exported functions.
- Separation of concerns (UI / Logic / Data / Config / Infra); external services via dedicated service layers; shared logic in reusable modules, not duplicated.
- Favor pure functions, immutable patterns, predictable and traceable state.
- Avoid unnecessary renders/re-fetches; lazy-load heavy modules; no memory leaks or dangling listeners; watch bundle growth and Core Web Vitals.

---

## 🚀 Release Standard
Complete only when: build + lint + typecheck pass · regression checks pass · no console noise · UX validated on the target surface (desktop = dashboard, Chrome = extension) · types strict where TS applies · no temporary workaround remains · docs updated if architecture changed.
