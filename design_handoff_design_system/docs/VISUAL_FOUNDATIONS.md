# Visual Foundations

> The atomic building blocks of SprintBrain. Colors, type, spacing, radii, shadows, motion, focus. Everything downstream composes from these.

---

## 1. Color philosophy

SprintBrain runs two surfaces with one personality. We express that with **one accent swap** and total neutral + semantic + language-code reuse.

### 1.1 The split

| Surface | Accent name | Hex | Why |
|---|---|---|---|
| Chrome Extension (popup + overlay) | **Iris** | `#6C5CE7` | Warm purple. The extension lives inside other apps (Airbnb, WhatsApp, Gmail) — Iris distinguishes SprintBrain chrome from host UI without clashing with any common brand. |
| Web Dashboard | **Azure** | `#1B4FD8` | Trustworthy blue. The dashboard is a workspace/admin surface; Azure reads "configuration & data" not "in-page helper". |

These are **not two brand colors** — they are two contextual expressions of the same brand. A user sees Iris only when SprintBrain is *acting*; Azure only when they are *managing* SprintBrain.

### 1.2 Neutrals (identical both surfaces)

```
bg         #FFFFFF   Card / primary surface
bg-alt     #FAFAFA   Page background (dashboard), sidebar (extension)
bg-muted   #F4F4F5   Inputs, chip fills, hover row
line       #E4E4E7   Default border
line-2     #D4D4D8   Hover border, stronger divider
```

### 1.3 Ink (text)

```
ink         #18181B   Primary — headings, table cells, body
ink-muted   #52525B   Secondary — descriptions, meta, inactive nav
ink-subtle  #A1A1AA   Tertiary — hints, placeholders, micro-labels
```

Contrast: `ink` on `bg` = 16.1:1 · `ink-muted` on `bg` = 8.0:1 · `ink-subtle` on `bg` = 3.1:1 (body minimum — don't use ink-subtle for paragraph text).

### 1.4 Semantic

| Role | Text | Background | Border |
|---|---|---|---|
| Success | `#16A34A` | `#F0FDF4` | `#BBF7D0` |
| Warning | `#D97706` | `#FFFBEB` | `#FDE68A` |
| Danger | `#DC2626` | `#FEF2F2` | `#FECACA` |

Semantic colors **never** carry information alone. They pair with an icon or a word — operators scanning a list of 200 snippets at 13px should not decode hue.

### 1.5 Language codes (identical both surfaces)

| Lang | Hex | Use |
|---|---|---|
| EN | `#2563EB` | Pills, tabs, dots |
| ES | `#EA580C` | Pills, tabs, dots |
| IT | `#DC2626` | Pills, tabs, dots |
| FR | `#7C3AED` | Pills, tabs, dots |

These are memorized by power users. Treat them as canonical tokens — do **not** redefine in any component.

---

## 2. Typography

### 2.1 Font stacks

```
--sb-font:  -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI',
            system-ui, sans-serif;
--sb-mono:  'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code',
            ui-monospace, Menlo, Consolas, monospace;
```

System-first: the extension has zero bytes of font budget, and the dashboard already loads fast without webfonts. If the user has Inter installed, they get it; otherwise the native stack takes over.

### 2.2 Scale

| Token | Size | Line height | Weight | Use |
|---|---|---|---|---|
| `--sb-fs-10` | 10 | 1.3 | 600 | Uppercase micro-labels, kbd, meta |
| `--sb-fs-11` | 11 | 1.4 | 500–600 | Table header labels, hint text |
| `--sb-fs-12` | 12 | 1.5 | 400–500 | Secondary body, meta lines |
| `--sb-fs-13` | 13 | 1.5 | 400–500 | **Extension base UI** |
| `--sb-fs-14` | 14 | 1.5 | 400–500 | **Dashboard base UI** |
| `--sb-fs-15` | 15 | 1.4 | 600–700 | Extension title, small section heads |
| `--sb-fs-16` | 16 | 1.4 | 600 | Body-lg, card titles |
| `--sb-fs-20` | 20 | 1.3 | 600–700 | H3 |
| `--sb-fs-24` | 24 | 1.2 | 700 | H2 — dashboard page titles |
| `--sb-fs-32` | 32 | 1.1 | 700 | Display — KPI values, empty-state heroes |

### 2.3 Rules

- **Letter-spacing** `-0.3px` on headings ≥20px. `+0.08em` uppercase on labels ≤11px.
- **Weights**: 400 body, 500 UI default, 600 buttons/titles, 700 H1/H2 only. No 800+.
- **Tabular figures**: `font-variant-numeric: tabular-nums` on any column of numbers (usage counts, dates, KPIs).
- **Truncation**: `text-overflow: ellipsis` + `text-wrap: pretty` for paragraph balance.

---

## 3. Spacing

4px base grid. Use tokens, never raw values.

| Token | px | Canonical use |
|---|---|---|
| `--sb-s-1` | 4 | Icon/text gap inside a chip |
| `--sb-s-2` | 8 | Chip horizontal padding; tight vertical stack |
| `--sb-s-3` | 12 | Input padding; list row vertical |
| `--sb-s-4` | 16 | Card padding (extension); section gap |
| `--sb-s-5` | 20 | Card padding (dashboard) |
| `--sb-s-6` | 24 | Page margin; big group gap |
| `--sb-s-8` | 32 | Major layout gap |
| `--sb-s-10` | 40 | Hero padding |
| `--sb-s-12` | 48 | Empty-state vertical padding |

Density difference: the **Extension** is dense (600×420 window → information per px matters). The **Dashboard** is comfortable. Same tokens, different typical values — e.g. card padding uses `--sb-s-4` in the extension, `--sb-s-5` in the dashboard.

---

## 4. Radii

| Token | px | Use |
|---|---|---|
| `--sb-r-xs` | 4 | Inner chips, code tokens inside a cell |
| `--sb-r-sm` | 6 | Small icon wells, close buttons |
| `--sb-r-md` | 8 | Inputs, standard buttons, folder list items |
| `--sb-r-lg` | 10 | Dashboard nav items, topbar search |
| `--sb-r-xl` | 12 | Primary buttons, context menus, overlay container |
| `--sb-r-2xl` | 16 | Dashboard cards, modals |
| `--sb-r-pill` | ∞ | Pills, badges, small status dots |

**Rule of nesting**: a child's radius ≤ parent's radius minus its inset. A pill inside a card (16) with 16px inset can be pill (∞) — but a button (12) inside a card (16) looks right.

---

## 5. Shadow ramp

```
--sb-shadow-sm:  0 1px 3px rgba(0,0,0,.06), 0 4px 14px rgba(0,0,0,.04);
--sb-shadow-md:  0 4px 20px rgba(27,79,216,.10), 0 1px 3px rgba(0,0,0,.06);
--sb-shadow-lg:  0 12px 40px rgba(0,0,0,.12), 0 2px 8px rgba(0,0,0,.06);
--sb-shadow-xl:  0 20px 60px rgba(0,0,0,.16);
```

| Level | Use |
|---|---|
| sm | Cards in a grid (dashboard), resting surface elevation |
| md | Primary button (dashboard), active card on hover |
| lg | Context menus, dropdowns, popovers, overlay chrome |
| xl | Modals, changelog, language picker |

Note `shadow-md`'s blue tint — a subtle Azure wash on the dashboard. It's intentionally weak (10%) so the extension can reuse the same ramp without the tint feeling wrong at 12% opacity under Iris.

**Focus ring** — separate utility, not part of the ramp:
```
--sb-shadow-glow: 0 0 0 3px var(--sb-accent-glow);
```

---

## 6. Motion

| Duration | Use |
|---|---|
| `--sb-dur-fast` (120ms) | Color/border hover, chip active states |
| `--sb-dur-base` (150ms) | Buttons, inputs, menu reveal |
| `--sb-dur-slow` (220ms) | Modal open, panel transition, list reorder |

Easings:
- `--sb-ease` — standard, `cubic-bezier(0.4, 0, 0.2, 1)`.
- `--sb-ease-out` — gentle overshoot for modals and the changelog, `cubic-bezier(0.34, 1.56, 0.64, 1)`.

**Respect `prefers-reduced-motion`**: disable the overshoot easing; keep opacity-only fades ≤150ms. Never animate size/position when the user has reduced motion on.

---

## 7. Focus rings

Always visible, always accent-colored, always separate from hover.

```css
:focus-visible {
  outline: none;
  box-shadow: var(--sb-shadow-glow);
  border-color: var(--sb-accent);
}
```

Inputs layer: `border-color: var(--sb-accent)` **plus** the glow ring. Buttons just get the ring.

---

## 8. Density rules

- **Extension popup**: row height 32–36px, 13px base type, 8–12px padding on primary surfaces.
- **Dashboard**: row height 44–48px, 14px base type, 16–20px padding on primary surfaces.
- **Inline overlay** (content script): matches extension density exactly — field rows 36px, 12px padding.

Never mix densities inside one surface.

---

## 9. Dark mode

**Out of scope for v1.** Both surfaces are light-only. The token architecture (CSS custom props, no hardcoded hex in components) is dark-mode-ready — we'll add `[data-sb-theme="dark"]` overrides in a later version without touching component CSS.
