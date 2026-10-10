# AGENTS.md — Who Does What

**Read `CLAUDE.md` first.** It holds every rule of this repository (simplicity, parity, industry-neutral, verification). This file only splits the work between two agents. It adds no rules of its own, so the two files cannot drift apart.

**Core rule for both agents: simplicity.** Our users are normal people, not tech experts. Everything must be very easy, very friendly and very accessible (see `CLAUDE.md`, 🧭 Simplicity Is the Core Rule).

---

## Claude — Developer and Project Manager (whole project)

Owns everything except the landing page's visual design:

- All code: React dashboard (`app/src`), Chrome extension (`extension/`), mobile app (`app/public/mobile/`), server functions, database, Notion sync (`services/`).
- Project management: planning, task order, version bumps, release readiness, `docs/`, `user-docs/`, and the summaries Valentina and Alessandro read.
- Quality gates, parity checks, commits and pushes (as `CLAUDE.md` defines them).
- **Landing translations.** Claude writes the Italian and Spanish (`app/public/landing/locales/{it,es}.json`) and runs `node scripts/build-landing-i18n.js`.
- Final review of anything Codex delivers, before it is committed.

## Codex — Landing Page Frontend Design (only)

Owns the look and layout of the marketing landing page:

- **May edit:** `app/public/landing/index.html` (English source: layout, CSS, spacing, imagery, responsive behaviour, animation) and files in `app/public/landing/assets/`.
- **Must follow:** `docs/DESIGN_SYSTEM.md` and `design_handoff_design_system/mockups/harmonized-final.html`. Tokens come from there; no invented colours, fonts or spacing.
- **Must keep:** simple, friendly, accessible (readable contrast, visible focus, labelled controls, thumb-sized buttons, fast on mobile).
- **Industry-neutral** in anything the product shows; vertical wording only in marketing copy.

## Boundaries

Codex does **not** touch:

- `app/src/`, `extension/`, `app/public/mobile/`, `services/`, `user-docs/`, `scripts/`, `.github/`, `netlify.toml`, any `package.json` or version number.
- `app/public/landing/it/`, `app/public/landing/es/` and `app/public/landing/locales/` (generated or Claude-owned).
- Any `CLAUDE.md`, or this file.

## Handoff

1. Codex works only in the landing files above and does not commit to `develop` on its own.
2. When Codex changes or adds **English text**, it lists the changed strings in its hand-off note. Claude then writes the Italian and Spanish in the same change. Changing English copy without updating the locale files fails the build on purpose (`node scripts/build-landing-i18n.js --check`).
3. Claude runs the gates, checks the page at phone width and desktop, bumps the version, and ships.
4. If the design needs anything outside Codex's scope (a new data field, a link target, a script), Codex asks Claude. It does not edit around the boundary.

## Branch

Only `develop`. Never create a branch, never push to `main`.
