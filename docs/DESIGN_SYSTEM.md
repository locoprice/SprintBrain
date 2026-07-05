# SprintBrain — Design System v1.1 (Canonical)

> **On-demand reference.** Pulled out of the root `CLAUDE.md` to keep always-on context lean. **Read this file before any UI, CSS, component, or token change** — it is the single source of truth for visual decisions.

**Status**: Active (shipped 2026-05-18). Replaces the dual Iris/Azure split from v1.0 with a single Azure primary across every surface (landing, mobile, dashboard, extension popup, in-page overlay).

## Visual source of truth

`design_handoff_design_system/mockups/harmonized-final.html` is the **single visual reference** for every UI decision. Open it in a browser before designing or reviewing any UI change. Every surface in the file — tokens strip, landing, mobile (home + detail + sheet), dashboard, extension popup — is the rendering target.

When the mockup and a piece of shipped UI disagree, the mockup wins by default. Disagreement that is intentional (e.g. a follow-up ticket altering the design) must be tracked explicitly with a follow-up entry below.

## Canonical tokens

> **Hard rule**: Any new color, radius, shadow, or spacing value introduced in any package must be added to this table **first**, then referenced by name from the appropriate token file:
>  - Dashboard: `app/tailwind.config.ts` + `app/src/index.css` (CSS variables)
>  - Extension + overlay: `extension/shared/tokens/colors_and_type.css`
>  - Mobile companion: inline `:root` in `app/public/mobile/index.html` (kept in sync with this table)
>
> Hard-coded hex values in component files are forbidden outside the per-language inline tints in `SnippetsTable.tsx` (which intentionally mirror the mobile palette).

### Neutrals

| Token        | Hex       | Usage                                        |
| ------------ | --------- | -------------------------------------------- |
| `bg`         | `#FAFAFA` | Page background (dashboard)                  |
| `bg-alt`     | `#F2F2F7` | Sidebar background (dashboard); muted card   |
| `card`       | `#FFFFFF` | Card / surface (all)                         |
| `line`       | `#E5E5EA` | Hairline border                              |
| `ink`        | `#1C1C1E` | Primary text                                 |
| `ink-muted`  | `#6E6E73` | Secondary text                               |
| `ink-subtle` | `#6B6B70` | Tertiary text / hints (WCAG AA ≥4.5:1 on `card` / `bg` / `bg-alt`) |

### Primary (single — Azure)

| Token          | Hex                    | Usage                                  |
| -------------- | ---------------------- | -------------------------------------- |
| `primary`      | `#1B4FD8`              | Brand + accent across every surface    |
| `primary-dark` | `#1440B0`              | Hover / pressed                        |
| `primary-light`| `#3D6FE8`              | Hover bg gradient endpoints            |
| `primary-bg`   | `#EEF2FF`              | Filled-tint badge / active row bg      |
| `primary-bdr`  | `#BED0FF`              | Filled-tint badge border               |
| `primary-glow` | `rgba(27,79,216,.14)`  | Focus ring shadow                      |

**v1.1 removes Iris purple `#6C5CE7` entirely.** The `--sb-iris*` aliases in the extension's tokens file still resolve, but they all point at the azure values. Any new code must use `--sb-azure*` / `primary` directly.

### Language palette (must stay identical across all surfaces)

| Lang  | Fg        | Bg        |
| ----- | --------- | --------- |
| EN    | `#1B4FD8` | `#EEF2FF` |
| ES    | `#C2410C` | `#FFF7ED` |
| IT    | `#15803D` | `#F0FDF4` |
| FR    | `#0D9488` | `#F0FDFA` |
| MULTI | `#7C3AED` | `#F5F3FF` |

**FR is a first-class language (re-added v2.88.0)** with its own teal palette — distinct from EN, IT, ES, and MULTI so every language pill stays visually unambiguous. It appears in the create/edit language picker; the `Snippet['language']` union already carries it.

**v1.1 changed IT from red `#DC2626` to green `#15803D`** to remove the false signal that Italian = stop / error.

### Semantic

| Token     | Hex       | Usage              |
| --------- | --------- | ------------------ |
| `success` | `#34C759` | Confirmation, deltas (Apple semantic green) |
| `warning` | `#FEBC2E` | Caution            |
| `danger`  | `#D70015` | Destructive (Apple SF system red — AA-safe as text on `card`) |

### Activity heatmap scale (Analytics "Activity Overview")

Azure intensity ramp for the GitHub-style contribution graph. Replaces GitHub's green so the heatmap stays on the single azure primary. Defined as CSS variables in `app/src/index.css` (light + dark) — referenced by name, never hard-coded in components.

| Token (light → dark)   | Light       | Dark        | Usage                          |
| ---------------------- | ----------- | ----------- | ------------------------------ |
| `--activity-0`         | `#EBEDF0`   | `#2C2F36`   | No activity (empty cell)       |
| `--activity-1`         | `#C7D8FF`   | `#1E3A6E`   | Low activity                   |
| `--activity-2`         | `#8FAEF6`   | `#2C56A8`   | Moderate activity              |
| `--activity-3`         | `#4E7AEA`   | `#3F74E0`   | High activity                  |
| `--activity-4`         | `#1B4FD8`   | `#6E96F0`   | Peak activity (brand)          |
| `--activity-cell-border` | `rgba(27,31,35,.06)` | `rgba(255,255,255,.06)` | 1px inset cell hairline |

### Radii

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

### Shadows

| Token       | Value                                                            |
| ----------- | ---------------------------------------------------------------- |
| `shadow-sm` | `0 1px 3px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.04)`           |
| `shadow-md` | `0 4px 20px rgba(27,79,216,.12), 0 1px 3px rgba(0,0,0,.06)`       |

## Surface-specific rules (v1.1)

- **Dashboard topbar** spans the full width (60 px) above sidebar + main. Brand square (28 px, `--primary` solid) on the left.
- **Dashboard sidebar** active nav: `bg-primary-light` + 3 px primary left bar (painted via `::before`, reserved track so the row doesn't shift on toggle) + filled count pill (`bg-primary` + white text) when count > 0. Inactive count pill: `bg-bg-alt` + `ink-subtle`.
- **Mobile home** is a single-scroll canvas. Gradient hero (`linear-gradient(160deg, #1B4FD8, #1440B0)`) → floating quick-action grid (overlaps hero by `-22 px`) → search → "All snippets" + Uber-style chips (white default, `#1C1C1E` bg when active) → snippet cards (`r-card-lg`, 14 px padding, 46 × 46 colored icon well per language family) → floating Apple/Revolut tab bar (`rgba(28,28,30,.92)` + blur 20).
- **Extension popup** active folder: light-primary bg + 2 px primary left bar + **filled** azure count pill (not tinted). All Iris purples replaced with `#1B4FD8`.
- **Shortcut tag** (dashboard): the trigger and shortcut render as two separate chips — a muted trigger chip (`bg-bg-alt` / `ink-muted`) beside the shortcut chip (`bg-primary-light` / `primary`). Supersedes the single-pill `.sctag` (prefix at `0.45` opacity); the extension popup + mobile still use the inline form pending alignment.

## Visual references

| Surface  | Mockup section                                | Live screenshot                                                       |
| -------- | --------------------------------------------- | --------------------------------------------------------------------- |
| Mobile   | "Landing + mobile home" + "Mobile · states"   | `design_handoff_design_system/screenshots/step-a.png`                 |
| Dashboard| "Dashboard · harmonized"                      | `step-b.png` + `step-b-analytics.png`                                 |
| Extension| "Chrome extension · harmonized"               | `step-c.png`                                                          |

## Open follow-ups (intentional deviations from mockup)

- Mobile "Recently used" carousel: omitted from `app/public/mobile/index.html` until we track snippet `last_used_at`. Slot is reserved in the section layout.
- Mobile bottom sheet: 3 actions (Use now / Edit / Delete) instead of mockup's 4 (Share missing) — needs a `navigator.share` JS handler.
- Quick-action tiles + mobile tab-bar items are cosmetic shells (no handlers yet).
- Dashboard "Folders" nav row: mockup shows it; needs a top-level `/folders` route.
- Hero "time saved" stat: shows snippet count instead until we track time-saved telemetry.
