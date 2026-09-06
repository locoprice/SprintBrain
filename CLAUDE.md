# SprintBrain — Root Engineering Standards

**Scope**: Global floor for all packages in this monorepo. Nested `CLAUDE.md` files (`app/`, `docs/`) add stricter rules; they never weaken these.
**Phase**: Pre-seed (Phase 2) — production-quality bar is non-negotiable. Production-first, zero-defect: stability over speed; every change leaves the codebase cleaner.

> **Lean-context policy** — this file holds only always-on guardrails. Reference material is read on demand when a task needs it:
> - 🎨 **Design tokens, palette & UI rules** → `docs/DESIGN_SYSTEM.md` — **MANDATORY read before ANY UI / CSS / component / token change.** It is the single source of truth for visual decisions.
> - 🏗️ **Monorepo map, CI/build, testing standards** → `docs/ENGINEERING_REFERENCE.md`.

---

## 🗣️ Communication Style — Non-Negotiable
**Valentina and Alessandro read every response here as non-programmers.** Short, direct, plain language — always.

- No preambles, no restating the request, no background context. Get to the point.
- No explanations of code, functions, architecture, or technical terms. Say what changed and whether it works, not how.
- Report outcomes only: what changed, whether it works, what (if anything) they need to do next.
- Errors or blockers: plain language, what broke in real-world terms — never a stack trace, log dump, or internals.
- The engineering rigor elsewhere in this file (verification, gates, regression checks) still runs in full on every change. Only the reporting changes: state PASS/FAIL and the bottom line, not the technical detail behind it.

---

## 🎯 Core Feature — Non-Negotiable
**UX/UI excellence and extreme ease of navigation is the primary goal of this project.** Evaluate every task first against its impact on simplicity and ease of use.

- **UX/UI First** — a technically elegant solution that degrades UX is unacceptable; redesign instead.
- **Navigation clarity** takes priority over all other concerns except security and data integrity.
- **Simplicity over features** — fewer, well-executed interactions beat many complex ones; resist cognitive load.
- **Visible feedback** — every user action yields a clear, immediate response (loading / success / error).
- **Consistency** — uniform visual language, interaction patterns, and terminology across extension and web app.

---

## 🔺 Tripartite Parity: Snippets, Prompts, Memory (Non-Negotiable)
**Snippets, Prompts and Memory are one product in three shapes.** The shell is identical, the contents are not. A user who learns one section must already know how to drive the other two: same page, same menus, same styling, same words. What differs between them is only what each one *is* (see 2). Any other difference is a defect, not a feature.

### 1. Feature parity is automatic, not optional
Any change requested for one of the three is a change to all three. This includes new features, settings, options, filters, sort orders, bulk actions, keyboard shortcuts, empty states, loading and error states, confirmations, toasts, search behaviour, and every fix that alters behaviour a user can see.

- **Never implement one and stop.** "The request only mentioned snippets" is not a scope boundary. The request names the entry point; the deliverable is the trio.
- **Plan the trio in the Plan phase**, before writing code. List the files for all three sections up front, not after the first one is done.
- **One task, one version, all three.** Do not defer prompts or memory to a later task or a later version. A change that lands in one section and not the others is unfinished work, and the task stays open.
- **The rule is symmetric.** It applies whichever section the request starts from: snippets to prompts and memory, prompts to snippets and memory, memory to snippets and prompts.

### 2. What stays distinct, by design
Parity governs the interface, never the nature of each section. These differences are intended and must be preserved:

- **The organising model.** Snippets organise into **folders** (a rail plus a breadcrumb), prompts filter by those same folders as chips, memory organises into its own **spaces**. Never push spaces onto snippets or prompts, and never push folders onto memory.
- **Capabilities that only make sense for one content type.** Snippet form-field dialogs, trigger and expansion settings, version history, language variants, prompt block editing, memory shards and steps. These belong where they belong.
- **What a surface deliberately does not carry.** Prompts are read-only on the extension, the mobile app is intentionally minimal, and memory is not built on mobile yet. Standing decisions, not drift.

Everything else is shared: if a capability is generic (search, filter, sort, select, rename, duplicate, delete, share, export, an item menu), it belongs in all three.

### 3. Layout consistency is absolute (React dashboard)
Across `/` (snippets), `/prompts` and `/memory`, the page shell is 100% identical: page header, toolbar, filter and search row, side panels, action rows, empty, loading and error composition, scroll regions, container widths, alignment and spacing scale. Tokens and values come from `docs/DESIGN_SYSTEM.md`, the single source of truth.

- Same page skeleton, same order of elements, same alignment of every rail, header and action row.
- Same paddings, gaps, radii, borders, shadows, typography ramp and icon sizes.
- Same responsive behaviour at every breakpoint.
- No section gets a "slightly better" layout. If a layout is better, it is applied to all three in the same change.
- Each section's own content sits *inside* that identical shell. A folder tree and a space list occupy the same slot, styled the same way.

The extension, `Sprintbrain.html` and the mobile app follow their own surface conventions. They must not contradict the dashboard's visual language, and rule 1 still binds them.

### 4. UI component parity is exact (React dashboard)
A component built for one section is the same component in the other two: same structure, styling, spacing, states and interaction logic. This covers menus and dropdowns, context menus, filter panels, sort controls, search fields, selection and bulk-action bars, row and card actions, hover and focus states, buttons, dialogs, previews, toggles, chips, badges, tooltips and confirmations.

- Add a menu to snippets and you add the identical menu, with identical items, order, icons, wording pattern, spacing and open/close behaviour, to prompts and memory. Items that do not apply to a section are omitted, never restyled.
- Same trigger gesture, same placement, same animation, same keyboard handling, same disabled and empty conditions.
- Wording follows the same pattern with only the noun changed (`New snippet` / `New prompt` / `New memory`).
- **Build shared, not copied.** Extract the component or the helper and use it in all three. Duplicated markup is already banned (🚫 Forbidden) and is how drift starts.

### 5. Every surface, every copy
Rule 1 is per surface, and each surface keeps its own copies in sync:

- React dashboard: `app/src/features/snippets`, `app/src/features/prompts`, `app/src/features/memory` and their pages in `app/src/routes/`.
- Mobile web app: `app/public/mobile/index.html` (its own renderers, kept aligned by hand).
- Chrome extension: `extension/popup/`, `extension/content/`, `extension/shared/`.
- `Sprintbrain.html` (shares the popup logic core).

Where a section is deliberately absent or read-only on a surface (see 2), that decision stands and parity applies to the surfaces where it exists. Two rules keep this from becoming a loophole:

- **Name it, do not assume it.** State plainly which surfaces you covered and which you did not, and why, in the task summary. An unexplained gap is drift.
- **Never invent a new exception on your own.** If a change genuinely cannot be applied to one of the three, stop and ask Valentina or Alessandro before shipping the partial version. Do not ship one section and call it done.

### 6. Verification for every trio change
Before declaring done, the summary must state, for each of the three sections and each surface touched: what changed, and that it was opened and exercised. Open the three dashboard pages side by side and compare the shell and the new component. The standard gates in 🔍 Verification Protocol still run in full.

---

## ⚡ Authoring and Expansion Parity (Non-Negotiable)
**A snippet feature is not shipped when the editor can write it. It is shipped when someone can use it.** Expansion is what the product is for: writing a snippet happens once, expanding it happens every day. A capability that exists only in the dashboard editor is half a feature, and the half that is missing is the half people actually touch.

This is a second axis of parity, at right angles to the Tripartite rule above. That rule runs across snippets, prompts and memory. This one runs from where a snippet is **written** to everywhere it is **used**.

### 1. Every snippet change reaches the expansion surfaces, in the same task
Add a field kind, a token, an attribute, a control, a default, a validation, a piece of wording: it lands on all of these before the task is done.

| Surface | File | What it is |
|---|---|---|
| **In-page overlay** | `extension/content/content.js` | The fill modal that opens when a trigger fires. **The primary surface.** Three entry points: trigger, picker, context menu |
| **Popup detail modal** | `extension/popup/popup.js` | The popup's fill form, and `Sprintbrain.html`'s, from one file |
| **Editor live preview** | `app/src/features/snippets/SnippetPreview.tsx` | What the author sees while writing |
| **Mobile** | `app/public/mobile/index.html` | Its own renderer, kept aligned by hand |

"The request only mentioned the editor" is not a scope boundary. The editor is the entry point; the deliverable is the snippet working end to end.

### 2. Build it once, in the shared decider
What a fill form **is** (which fields, of what kind, what each control offers, what a choice means) belongs in `extension/shared/fill-form.js`. The four renderers only draw it. Adding a decision to one renderer is how the surfaces drift, and they have drifted before: a stored `field_cfg` honoured in one place, a date opening on today in one place, a menu rendering as a plain text box through two of the three overlay entry points.

A new token in `extension/formula-engine.js` needs a renderer on every surface in the same task. A surface that has not caught up does not show a broken field, it shows **no field at all**, and the snippet quietly prints the wrong thing.

### 3. Mind the surfaces that keep their own copy
`app/public/mobile/index.html` cannot load `extension/`: it carries a generated copy of the shared module (`node scripts/sync-fill-form.js`) plus **its own parser**, so any engine change that alters output has to be ported there by hand. `extension/popup/popup.js` is also `Sprintbrain.html`'s logic core, and the two style it separately, so a new control needs CSS in **both** stylesheets.

### 4. Name the gaps, never invent one
Where a surface deliberately does not carry something (prompts expand raw and have no fill form; memory has no body fields; the popup is read-only), that decision stands and is stated in the summary. If a change genuinely cannot reach a surface, stop and ask Valentina or Alessandro before shipping the partial version.

### 5. Verification
Before declaring done, the summary names each expansion surface and says it was **opened and exercised**, not just compiled. Expansion is verified by expanding: fire the trigger, fill the form, insert, and read what landed in the field.

---

## 🌍 Industry-Neutral — Non-Negotiable
**SprintBrain ships to every industry, not to hospitality.** A law firm, a clinic, a repair shop and a rental host must each open the product and find it built for them. Hospitality is where the product was born and where its first users are; it is not what the product may look like.

- **Nothing the product seeds may name a vertical.** Field chips, sample bodies, placeholder text, onboarding copy, mock fixtures and keyword suggestions stay generic — no guest, property, check-in / check-out, nights, booking, reservation, stay. What a user writes in their own snippets is theirs; the product must not put that vocabulary there first.
- **Generic formulas only.** Every formula, field and example the product ships works unchanged in any industry. Vertical wording belongs in marketing copy, never in the editor.
- **Quantities are numeric fields.** Price, total, count, duration, quantity — declared as a numeric field, never as a text field, and never as a text field a formula happens to add up.
- **Never rewrite user data to satisfy this.** Snippets already written keep working exactly as written. The rule governs what SprintBrain ships, not what people typed into it.

> **Open gap — the numeric rule cannot be satisfied yet.** No body token declares a numeric field: `buildFormFieldCfg` recognises `{formtext:}` / `{formdate:}` / `{formmenu:}` only, and the dashboard writes `field_cfg: {}` on create and never edits it. `type: 'number'` is honoured by the extension overlay and the mobile app, and by neither the popup nor `Sprintbrain.html`. Closing this needs a numeric token in `extension/formula-engine.js`, a builder in the dashboard, and the two missing renderers. Until it lands, say so rather than shipping a quantity as text and calling it done.

---

## 🌐 Landing Translations — Human-Written Only, Non-Negotiable
**The landing page ships in English, Italian and Spanish. Claude never writes the Italian or the Spanish.** Marketing copy carries the brand voice and is read by prospects and investors; a machine translation that is merely "correct" is not good enough, and a wrong one is public.

**The rule:** whenever new text or new content is added to the English source `app/public/landing/index.html`, **stop and ask Valentina or Alessandro for the Italian and Spanish**. They supply a 100% accurate translation. Paste what they give you, verbatim, into the locale files. Do not translate it yourself, do not paraphrase what they send, and do not fill a gap with a placeholder while waiting.

**How it fits the build:**
- English source: `app/public/landing/index.html` (the only file where new copy is authored).
- Locale files: `app/public/landing/locales/{it,es}.json` — a list of `{find, replace, count}` exact-string swaps.
- Generator: `node scripts/build-landing-i18n.js` writes `app/public/landing/{it,es}/index.html`. `--check` is a CI gate.
- The `count` assertion is what makes this safe: reword English copy without updating a locale and the build **fails naming the stale key**, rather than silently leaving English on a translated page. Treat that failure as the prompt to go ask for the translation.

**Corollary:** never "fix" a failing translation gate by editing the `find` string to match the new English while leaving `replace` stale. That defeats the gate and ships mixed-language copy. Adding a language = one new `<lang>.json`, never a hand-copied HTML file.

> Exception, and only this one: strings that are identical in the target language (brand names, `Mobile`, `Analytics`) need no entry at all. Everything a reader actually reads as prose goes to a human.

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
- Vertical vocabulary in anything the product ships — see 🌍 Industry-Neutral.
- Declaring a quantity as a text field.
- Shipping a change to snippets, prompts or memory without the same change in the other two, or giving one of them a page shell, menu, component or wording the others do not have (see the Tripartite Parity section, and its list of what stays distinct).
- Shipping a snippet capability that the editor can write but the expansion surfaces cannot use: the in-page overlay, the popup detail modal (and `Sprintbrain.html`), the live preview and mobile (see ⚡ Authoring and Expansion Parity).
- Writing or guessing landing-page copy in Italian or Spanish — see 🌐 Landing Translations. Ask for it.

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
- Design and apply every snippets, prompts or memory change to all three sections in the same task, on every surface where they exist (see the Tripartite Parity section).
- Carry every snippet change through to expansion in the same task, deciding it once in `extension/shared/fill-form.js` and drawing it on all four fill surfaces (see ⚡ Authoring and Expansion Parity). Verify it by expanding a snippet, not by reading the diff.
- Keep every shipped field, formula, example and suggestion industry-neutral (🌍).

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
- `node --check` on every changed `.js`; `node scripts/check-version.js`, `node scripts/check-snippets.js`, `node scripts/check-expansion.js` and `node scripts/check-memory-parity.js` green.
- Manual smoke test: trigger expansion, overlay, formula calculation, context menu.
- No `console.log` debug statements committed; reload at `chrome://extensions` and confirm no service-worker errors.

### Regression
Map affected modules, APIs, routes, and state flows **before** implementing. High-risk changes require smoke tests across related modules. No merge with unresolved regressions; new features must not degrade existing performance or UX.

### Required summary format
Every implementation summary must include:

**Changes made:** …
**Verification:** lint / typecheck / build — PASS / FAIL / N/A · manual test — PASS / FAIL
**Regression check:** Result PASS / FAIL · Impacted scope [modules / routes / components / APIs]
**Expansion check** (snippet changes only): overlay / popup + `Sprintbrain.html` / live preview / mobile — each opened and exercised, or the reason it does not apply.

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
   - extension: `node --check` on every changed `.js`, plus `node scripts/check-version.js`, `node scripts/check-snippets.js`, `node scripts/check-expansion.js` and `node scripts/check-memory-parity.js` green.
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
