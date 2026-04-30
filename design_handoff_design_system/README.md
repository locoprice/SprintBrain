# Handoff: SprintBrain Design System

## Overview

This package is the **SprintBrain Design System v1.0** — the single source of truth for visual design across both SprintBrain surfaces:

- **Chrome Extension** (popup + inline overlay) — `manifest.json` v2.14.5, vanilla HTML/CSS/JS, no bundler.
- **Web Dashboard** — `app.sprintbrain.io`, Next.js + Tailwind, desktop-only.

It contains design tokens, foundation docs (color/type/spacing/voice/iconography), preview cards, and two reference UI kits showing every component in context.

The system is built around **two surfaces sharing one set of tokens**, distinguished by accent color (Iris for the Extension, Azure for the Dashboard) — see §"Two surfaces, one system" below.

---

## About the Design Files

The HTML files in this bundle are **design references** — prototypes showing intended look, density, and behavior. They are **not production code to copy directly**.

Your task is to **recreate these designs in the target codebase**:

- For the **Chrome Extension**, the existing surface is `popup.html` + `overlay.css` (vanilla HTML/CSS, no framework, no bundler). Patterns from the kit should be ported as inline styles or appended CSS classes that match the existing structure.
- For the **Web Dashboard** (`web/` directory in the SprintBrain repo), the existing stack is **Next.js + React + TypeScript + Tailwind v3 + shadcn/ui (Radix) + Lucide icons**. Existing primitives live in `web/src/components/ui/` (button, card, badge, input). Reuse and extend those — don't introduce a parallel CSS layer.

The single shared artifact that **should ship verbatim** is `tokens/colors_and_type.css` — the canonical token file. The Tailwind theme in `web/tailwind.config.ts` should be updated to mirror these tokens (color names, type ramp, radii, shadows). The Extension can `<link>` the file directly.

---

## Fidelity

**High-fidelity (hifi).**

All mockups are pixel-perfect with final colors, typography, spacing, radii, shadows, and interaction states. Every value is documented as a CSS custom property in `tokens/colors_and_type.css`. The developer should:

1. Wire `tokens/colors_and_type.css` into both surfaces (Extension via `<link>`, Dashboard via Tailwind config + a global import).
2. Recreate the kit components using the codebase's existing patterns (shadcn primitives on the Dashboard; vanilla DOM on the Extension), referencing the kit HTML for exact dimensions/states.
3. Match dimensions, colors, type, and behavior **exactly** — these are not approximations.

---

## Two surfaces, one system

|  | Chrome Extension | Web Dashboard |
|---|---|---|
| Viewport | 600×420 popup, variable overlay | ≥1024×720, desktop-only (gate below) |
| Accent | **Iris** `#6C5CE7` | **Azure** `#1B4FD8` |
| Base font-size | 13px | 14px |
| Card radius | 12px (xl) | 16px (2xl) |
| Density | Compact | Spacious |
| Stack | Vanilla HTML/CSS/JS | Next.js + React + Tailwind + shadcn/ui |

**Surface switch is one attribute.** Every component uses `var(--sb-accent)` — the surface is selected on `<body>`:

```html
<body data-sb-surface="extension"> <!-- Iris -->
<body data-sb-surface="dashboard"> <!-- Azure -->
```

The CSS in `tokens/colors_and_type.css` resolves `--sb-accent` to either Iris or Azure based on this attribute. **Never hard-code `#6C5CE7` or `#1B4FD8` in component CSS.**

The **only exception** is the logo mark (lightning bolt) — it stays Iris on the Azure dashboard. Same way Gmail's envelope stays red inside Google's blue shell.

---

## Files in this bundle

```
design_handoff_design_system/
├── README.md                    ← this file
├── SKILL.md                     ← AI/dev quick-reference (token names, common patterns, rules)
├── tokens/
│   └── colors_and_type.css      ← THE canonical token file. Ship this.
├── docs/
│   ├── CONTENT_FUNDAMENTALS.md  ← voice, copywriting, shortcut naming, multilingual rules
│   ├── VISUAL_FOUNDATIONS.md    ← color philosophy, type, spacing, motion, focus, density
│   └── ICONOGRAPHY.md           ← Lucide-only, sizes, stroke, mapping table, special glyphs
├── kits/
│   ├── extension.html           ← every Extension component in context
│   └── dashboard.html           ← every Dashboard component in context
├── previews/
│   ├── 01-type.html             ← type ramp
│   ├── 02-colors.html           ← Iris + Azure + neutrals + semantic + language palettes
│   ├── 03-spacing.html          ← spacing scale, radii, shadows
│   ├── 04-components.html       ← buttons, inputs, badges, code tokens, language pills, KPI
│   └── 05-brand.html            ← logo mark, lockup, trigger characters, overlay chrome
└── assets/
    └── logo-mark.svg            ← lightning bolt mark with Iris gradient
```

**Authoritative reads, in order:**

1. `tokens/colors_and_type.css` — every value lives here. If it's not here, it shouldn't be in code.
2. `SKILL.md` — pattern-by-pattern reach-for guide. Read this before touching components.
3. `docs/VISUAL_FOUNDATIONS.md` — the *why* behind the tokens.
4. `docs/CONTENT_FUNDAMENTALS.md` — voice + microcopy rules.
5. `docs/ICONOGRAPHY.md` — icon usage (Lucide only, stroke 2, currentColor).
6. `kits/*.html` — open these in a browser to see every component in context with exact pixel values.

---

## Design tokens (summary)

The full, authoritative list is in `tokens/colors_and_type.css`. Summary:

### Colors

**Neutrals (shared)**
| Token | Value | Use |
|---|---|---|
| `--sb-bg` | `#FFFFFF` | Card / surface |
| `--sb-bg-alt` | `#FAFAFA` | Page bg (Dashboard), sidebar (Extension) |
| `--sb-bg-muted` | `#F4F4F5` | Inputs, chip backgrounds |
| `--sb-line` | `#E4E4E7` | Hairline borders |
| `--sb-line-2` | `#D4D4D8` | Hover borders, dividers |
| `--sb-ink` | `#18181B` | Primary text |
| `--sb-ink-muted` | `#52525B` | Secondary text |
| `--sb-ink-subtle` | `#A1A1AA` | Tertiary / hints |

**Iris (Extension accent)**
| Token | Value |
|---|---|
| `--sb-iris` | `#6C5CE7` |
| `--sb-iris-dark` | `#5A4BD1` |
| `--sb-iris-light` | `#8B7CF6` |
| `--sb-iris-bg` | `#F0EDFF` |
| `--sb-iris-bdr` | `#C9C0FF` |
| `--sb-iris-glow` | `rgba(108, 92, 231, 0.12)` |

**Azure (Dashboard accent)**
| Token | Value |
|---|---|
| `--sb-azure` | `#1B4FD8` |
| `--sb-azure-dark` | `#1440B0` |
| `--sb-azure-light` | `#3D6FE8` |
| `--sb-azure-bg` | `#EEF2FF` |
| `--sb-azure-bdr` | `#BED0FF` |
| `--sb-azure-glow` | `rgba(27, 79, 216, 0.14)` |

**Semantic**
| Token | Value |
|---|---|
| `--sb-ok` / `--sb-ok-bg` / `--sb-ok-bdr` | `#16A34A` / `#F0FDF4` / `#BBF7D0` |
| `--sb-warn` / `--sb-warn-bg` / `--sb-warn-bdr` | `#D97706` / `#FFFBEB` / `#FDE68A` |
| `--sb-danger` / `--sb-danger-bg` / `--sb-danger-bdr` | `#DC2626` / `#FEF2F2` / `#FECACA` |

**Language (identical on both surfaces — structural, not decorative)**
| Token | Value | Lang |
|---|---|---|
| `--sb-lang-en` | `#2563EB` | English |
| `--sb-lang-es` | `#EA580C` | Spanish |
| `--sb-lang-it` | `#DC2626` | Italian |
| `--sb-lang-fr` | `#7C3AED` | French |

Language pills render as: `background: <color>14` (8% opacity), `color: <color>`, `border: 1px solid <color>33` (20% opacity), `font: 700 10px var(--sb-mono) UPPER`.

### Typography

**Stacks**
- Sans: `-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif`
- Mono: `'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', ui-monospace, Menlo, Consolas, monospace`

**Ramp** — `--sb-fs-10` `10px` · `--sb-fs-11` `11px` · `--sb-fs-12` `12px` · `--sb-fs-13` `13px` (Extension base) · `--sb-fs-14` `14px` (Dashboard base) · `--sb-fs-15` `15px` · `--sb-fs-16` `16px` · `--sb-fs-20` `20px` · `--sb-fs-24` `24px` (page titles) · `--sb-fs-32` `32px` (display).

Always set `font-feature-settings: 'cv02','cv03','cv04','cv11'` and `-webkit-font-smoothing: antialiased`. Numbers in KPIs/tables use `font-variant-numeric: tabular-nums`.

### Spacing (4px base)
`--sb-s-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 · `-10` 40 · `-12` 48.

### Radii
`--sb-r-xs` 4 · `-sm` 6 · `-md` 8 (inputs, buttons) · `-lg` 10 (Dashboard nav, topbar search) · `-xl` 12 (Extension cards, modals, popups) · `-2xl` 16 (Dashboard cards, modals) · `-pill` 9999.

### Shadows
- `--sb-shadow-sm` — resting cards
- `--sb-shadow-md` — hover (`0 4px 20px rgba(27,79,216,.10)…`)
- `--sb-shadow-lg` — popups, context menus
- `--sb-shadow-xl` — modals
- `--sb-shadow-glow` — focus ring (`0 0 0 3px var(--sb-accent-glow)`, resolves per surface)

### Motion
- `--sb-dur-fast` 120ms · `--sb-dur-base` 150ms · `--sb-dur-slow` 220ms
- `--sb-ease` `cubic-bezier(.4,0,.2,1)` (default)
- `--sb-ease-out` `cubic-bezier(.34,1.56,.64,1)` (gentle overshoot, modals only)

---

## Surfaces in detail

### Surface A — Chrome Extension popup (600×420)

**Existing source files in repo:** `popup.html`, `overlay.css`, `manifest.json`.

**Layout regions** (from `kits/extension.html`):

1. **Sync bar** (top, 32px) — `--sb-bg-alt` background, `--sb-line` bottom border. Contains a 12px CheckCircle icon (`--sb-ok`), the sync status text, and a "Sync Now" pill button.
2. **Header** (12px padding, `--sb-bg`, bottom border) — logo lockup left (lightning mark + "SprintBrain" 16/700/-.3px), snippet count chip middle, Settings + New buttons right.
3. **Search row** (8px padding, bottom border) — full-width input with leading Lucide Search icon (14px) and trailing trigger pill (e.g., `::` in `--sb-iris` on `--sb-iris-bg`).
4. **Body** (420px tall, flex split):
   - **Sidebar** (170px, `--sb-bg-alt`, right border) — folder list. Each folder row is `padding: 8 12`, 13px text, 16px folder icon. Active folder gets `background: var(--sb-iris-bg)`, `border-left: 2px solid var(--sb-iris)`, `color: var(--sb-iris)`, `font-weight: 600`. Counts in pill `--sb-bg-muted`.
   - **Main** — hint strip (10px on `--sb-bg-alt`) plus scrollable snippet list. Each snippet row: `padding: 10 16`, bottom border, name + EN-pill + use-count badge + shortcut code-token chip.
5. **Footer** (8px padding, top border) — "Reload" secondary + "New Snippet" primary buttons.
6. **Version bar** (4px, `--sb-bg-alt`) — version mono number + date.

**Editor view** (replaces #4) — title input, shortcut row (special: input itself wears the Iris border + glow), language/folder selects, body textarea with vertical language tab sidebar (36×~30px tabs colored per `--sb-lang-*`, white on filled state with a small status dot), quick-insert command chips (formula chips violet on `#F5F3FF`, conditional chips cyan on `#ECFEFF`), and the urgency-timer card (`--sb-bg-alt`, toggle switch right, two number inputs below).

**Inline overlay** (`overlay.css`) — 420px-wide floating card injected into host pages. Same tokens; chrome is minimal (logo + snippet name + close × in 12/16 padding header). Field rows have a mono uppercase Iris label (10px) above each input. Preview block on `--sb-bg-muted`. Footer with Insert button + ⏎/Esc hint. **Real CSS uses `!important`** on every property to beat host page styles — this is load-bearing.

**Trigger picker** (popover when user types just `::` in an empty field) — 360px, max-height 260px scroll list. Each row: shortcut mono Iris + name muted + lang pill. Active row `--sb-iris-bg`. Footer with `↑↓`, `⏎`, `Esc` kbd hints.

**Right-click context menu** — 230px, 12px radius, shadow-lg. Items 7×14 padding, 13px, 14px Lucide icon. Destructive items use `--sb-danger`. Separators are 1px `--sb-line` lines with 4px margin.

**Modals** (new folder, language picker, etc.) — 16px radius, shadow-xl, 24px padding. Buttons grouped flex-end at bottom, primary right.

### Surface B — Web Dashboard (≥1024×720)

**Existing source files in repo:** `web/src/` — App.tsx, routes/DashboardLayout.tsx, components/layout/{Sidebar,Topbar,PageHeader,DesktopGate,EmptyState}.tsx, components/ui/{button,card,badge,input}.tsx, features/snippets/SnippetsTable.tsx + SnippetFolderTree.tsx, mock/fixtures.ts.

**App shell** (from `kits/dashboard.html`):

- **Topbar** (60px, full width, bottom border, `--sb-bg`) — logo lockup (220px wide block) + 460px-max search input (10px radius, `--sb-bg-muted`, ⌘K kbd hint inside) + spacer + 2 icon buttons (Help, Notifications with red dot) + user block (32px gradient avatar + name/workspace).
- **Nav** (240px, left, `--sb-bg-alt`, right border) — grouped: "Workspace" (Overview / Snippets / Prompts / Folders / Analytics), "Team" (Members / Integrations / Settings). Active item: `background: var(--sb-azure-bg)`, `color: var(--sb-azure)`, `font-weight: 600`, **plus a 3px Azure rounded bar absolutely positioned at left edge top:6 bottom:6**. Counts in pill, Azure-filled when active. Bottom: tier card with Iris→Azure-dark linear gradient (135deg).
- **Page header** (20×28px padding, bottom border) — breadcrumb (12px, ink-subtle / strong=ink-muted) + page title (24/700/-.3px) + status pill (e.g., "● Synced" green). Right side: secondary + primary action buttons.
- **Body** (24×28px padding, scrolls, `--sb-bg-alt`).

**KPI strip** — `grid-template-columns: repeat(4, 1fr); gap: 16px`. Each KPI card: 16px radius, 18×20px padding, `--sb-bg`. Header row = label (11/600 uppercase ink-subtle, .06em) + 32px square Azure icon well. Value 30/700/-.5px, `tabular-nums`. Footer = colored delta pill (`--sb-ok-bg` for up, `--sb-danger-bg` for down) + sub label.

**Chart card** — 16px radius. Header: title 15/700 + segmented period control (24h/7d/30d/90d, on-state white pill with `--sb-shadow-sm`). Chart is 220px tall area chart, Azure stroke 2.5px, gradient fill from `#1B4FD8` 25%→0% opacity, dot points + active point with white core. Tooltip is dark (`--sb-ink`), 9px label + 11/700 value. Gridlines `--sb-line`.

**Top-snippets list card** — same 16px radius. Each row: rank (11/700 ink-subtle, tabular-nums) + name + Azure code-token chip + 40px progress bar `--sb-bg-muted` w/ Azure fill + use count right.

**Snippets table** — Filter bar (12×20px padding, top of card): search 320px max + chip filters. Active chip: `--sb-azure-bg`, `--sb-azure-bdr`, `--sb-azure` text, 600 weight, with × dismiss. Inactive chips: white bg, `--sb-line` border, ink-muted text. "More filters" chip has Lucide Filter icon. Sort chip lives flex-end.

Table itself: sticky thead (11/700 uppercase ink-subtle on `--sb-bg-alt`). Rows: 12×14px padding, 13px text, bottom hairline. **Hover row gets `--sb-bg-alt` background AND row-actions (3 icon buttons) fade from opacity 0 → 1.** Checkbox: 14×14, `--sb-line-2` 1.5px border, `--sb-r-xs`; checked = filled Azure with white check. Lang cell uses the `--sb-lang-*` pill formula. Shortcut cell: `.sc-tag` mono 12/600 Azure, with `::` prefix at 0.45 opacity. Updated cell: ink-subtle.

**Form inputs** (3 states):
- Default: `--sb-bg`, `--sb-line` border, 8px radius, 9×12px padding, 14px ink.
- Focus: `border: var(--sb-azure)` + `box-shadow: var(--sb-shadow-glow)` (3px Azure 14% ring).
- Error: `border: var(--sb-danger)` + `.help.err` line below in `--sb-danger`.

Help text always present: 11px ink-subtle below input. Error text replaces in place — never toast-only.

**Empty state** — `--sb-bg`, **dashed** `--sb-line-2` border, 16px radius, max-width 480px, centered. 56px square Azure icon well at top. Title 17/700, sub 13 ink-muted line-height 1.6. Two-button row at bottom (secondary + primary). The dashed border is intentional — empty states shouldn't compete visually with cards.

**Toast** — `--sb-ink` background, white text, 12px radius, 12×16px padding, shadow-lg. Status icon (16px, colored — `--sb-ok` green for success, `--sb-danger` red for error). Inline action link (`#A5B4FC` indigo for normal, `#FCA5A5` for retry). Lives 3s, single inline action only (no dismiss × button).

**Desktop gate** — below 1024px, replace the entire app with a centered card explaining the dashboard is desktop-only. Existing implementation lives in `web/src/components/layout/DesktopGate.tsx`.

---

## Interactions & behavior

| Element | Behavior |
|---|---|
| Folder row click | Set active folder (Iris on Extension / Azure on Dashboard), filter snippet list. URL updates to `?folder=<id>` on Dashboard. |
| Snippet row left-click | Open editor (Extension) / open detail panel (Dashboard). |
| Snippet row right-click (Extension) | Open context menu at cursor position. |
| Trigger field typed (Extension overlay) | If shortcut requires fields → show overlay; if not → expand inline. |
| `⌘K` (Dashboard) | Focus topbar search and open command palette (out of scope of this kit). |
| Filter chip click (Dashboard) | Toggle on/off; active = Azure fill, inactive = white. × dismisses. |
| Bulk select (Dashboard) | Header checkbox toggles all visible. Row checkboxes are independent. Selection count appears in card header. |
| Form input focus | Border → accent, add 3px `--sb-shadow-glow`. Resolves per-surface. |
| Toast lifecycle | Slide up + fade in 220ms (`--sb-ease-out`), live 3s, fade out 150ms. Inline action persists until dismiss. |
| Modal enter/exit | Scale 0.96 → 1.0 with `--sb-ease-out`, fade 150ms. Backdrop fades 220ms. |

All transitions use `--sb-dur-base` (150ms) with `--sb-ease` unless noted.

---

## State management

Existing state stores in repo:
- `web/src/state/snippets.ts` — Zustand store, snippet/folder selection.
- `web/src/state/notion.ts` — Notion sync state.

For new components built from this kit, follow that pattern (Zustand stores per feature). Mock data lives in `web/src/mock/fixtures.ts` and should be the source of truth for shape/types when wiring up new screens.

---

## Load-bearing rules (don't negotiate)

These are listed in `SKILL.md` §5 — repeating the most important here:

1. **Icons = Lucide, stroke 2, `currentColor`.** Mapping table in `docs/ICONOGRAPHY.md` §4. No Heroicons, no Feather, no Phosphor.
2. **No emoji in UI chrome.** User content yes; buttons/nav/tables/status no.
3. **Trigger characters** (`::`, `;;`, `!!`, `"""`) are mono, accent-colored, and **0.45 opacity** when shown alongside the shortcut body — emphasis on the verb (`quoteEN`), not the prefix.
4. **Language colors are structural.** Same EN/IT/ES/FR colors on both surfaces. Always.
5. **Gradient appears in exactly one place: the logo-mark well.** No gradient buttons, no gradient backgrounds, no gradient KPIs.
6. **Numbers use `font-variant-numeric: tabular-nums`** in KPIs and table cells.
7. **Errors get a visible field border + sublabel.** Never toast-only.
8. **Popup is 600×420, fixed.** Vertical scroll lives inside `.snip-list` or the editor body — not on the popup itself.

---

## Voice & copywriting (one-page summary)

Full doc in `docs/CONTENT_FUNDAMENTALS.md`.

- Audience: hospitality operators (boutique tour companies, property managers, agencies). Use industry vocabulary: **guest, property, check-in, firm reply, quote**. Not: user, entity, item, record.
- **Sentence case** in all UI. Title Case only for proper nouns and the product name.
- Buttons are verbs: **New snippet**, **Save**, **Insert**, **Sync now**. Never "Submit," never "Create new item."
- Shortcut names: **camelCase + UPPER lang suffix** — `quoteEN`, `welcomeIT`, `refundFR`. Not `quote_en`, not `QuoteEN`.
- Empty states are directive and offer two paths (e.g., "Import from Notion" + "New snippet"). Never a smiley, never "No data found."
- Time/dates: relative ("2 hours ago", "Yesterday", "3 days ago") on tables and cards. Absolute (`2026-04-13`) only in the version bar and detail views.

---

## Assets

- `assets/logo-mark.svg` — lightning bolt in a 14px-radius square well, Iris→Iris-light gradient. Use this anywhere the SprintBrain mark appears, **including on the Azure dashboard** (the mark stays Iris).
- **Icons** — install `lucide-react` (already in `web/package.json`). Names referenced in this kit: `Type`, `Calculator`, `MessageSquareText`, `Folder`, `Folders`, `Plus`, `Search`, `Settings`, `BarChart3`, `RefreshCw`, `CheckCircle2`, `AlertTriangle`, `Clock`, `GitBranch`, `Lock`, `Copy`, `Pencil`, `Pin`, `Share2`, `Trash2`, `HelpCircle`, `LifeBuoy`, `Bell`, `Globe`, `MoreHorizontal`. Full mapping in `docs/ICONOGRAPHY.md` §4.
- **Fonts** — system stack only (Inter / SF / Segoe UI fallback chain). No webfont download required.

---

## Implementation checklist

- [ ] Drop `tokens/colors_and_type.css` into the project; import once at the entry point of each surface.
- [ ] Update `web/tailwind.config.ts` colors / fontSize / borderRadius / boxShadow to mirror the tokens (Tailwind class names map to `var(--sb-*)`).
- [ ] Set `<body data-sb-surface="extension">` on Extension `popup.html` and `overlay.css` host element.
- [ ] Set `<body data-sb-surface="dashboard">` on Dashboard root layout.
- [ ] Audit existing `web/src/components/ui/*` primitives against `kits/dashboard.html`; align variants (button primary/secondary, card base, input states, badge variants).
- [ ] Replace any hard-coded `#6C5CE7` / `#1B4FD8` with `var(--sb-accent)` or accent-resolving Tailwind classes.
- [ ] Verify all numeric displays (KPIs, table use counts, version numbers) use `tabular-nums`.
- [ ] Verify all icon usage is Lucide at stroke 2; replace any non-Lucide icons.
- [ ] Test focus rings work on both surfaces (3px ring should be Iris-tinted in Extension, Azure-tinted in Dashboard).
- [ ] Verify desktop gate fires below 1024px on Dashboard.

---

## Versioning

This is **v1.0** of the system. Tokens are the only file with a stable contract — components in `kits/` are reference implementations, not a published library. If you need to change a token, edit it in `tokens/colors_and_type.css` and propagate via Tailwind config; don't fork values into components.

The system explicitly **does not yet cover**:
- Dark mode (roadmap; tokens are not dual-mode yet)
- Mobile dashboard (intentional — desktop-only product)
- A third surface beyond Extension + Dashboard

If the product grows a third surface, that's a system-level decision that should add a third accent and update this handoff — not be solved at the component level.
