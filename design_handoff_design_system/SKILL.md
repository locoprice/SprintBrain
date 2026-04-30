# SprintBrain Design System — Skill Guide

> Read this before designing or coding anything for SprintBrain. It tells you which tokens to reach for, which surface you're on, and the conventions that are load-bearing vs. negotiable.

---

## 1. Product in one paragraph

SprintBrain is a text-expansion tool for **hospitality operators** (boutique tour companies, property managers, agencies). The user types a shortcut — `::quoteEN`, `::checkin`, `::firm` — into any web input, a Chrome extension catches it, and expands it into a multilingual, formula-driven template (with placeholder fields, `{=price*nights}` math, and `{if:cond}` branching). The **Web Dashboard** is where the library is managed, analytics are seen, and Notion sync is configured.

The primary user writes **quotes, check-in messages, refund explanations, and firm replies** — in EN, IT, ES, FR — dozens of times a day. Speed and predictability are the whole product.

---

## 2. Two surfaces, one system

| | Extension popup + overlay | Web Dashboard |
|---|---|---|
| Viewport | 600×420 popup, variable overlay | ≥1024×720, desktop-only |
| Accent | **Iris** `#6C5CE7` | **Azure** `#1B4FD8` |
| Base font-size | `13px` | `14px` |
| Density | Compact (tight padding, small icons) | Spacious (cards, 16–20px gutters) |
| Role | Fast lookup + fire a shortcut | Library management + analytics |

**Switch via one attribute.** Every component uses `var(--sb-accent)` (and friends). The surface is chosen by the `<body>` attribute:

```html
<body data-sb-surface="extension"> <!-- Iris -->
<body data-sb-surface="dashboard"> <!-- Azure -->
```

Never hard-code `#6C5CE7` or `#1B4FD8` in component CSS. Use `--sb-accent`.

**The logo mark is the only exception** — the lightning bolt stays Iris on the Azure dashboard (same way Gmail's envelope stays red inside Google's blue shell).

---

## 3. Files to load

Always include the tokens file. That's all you need for a new file:

```html
<link rel="stylesheet" href="tokens/colors_and_type.css">
```

It exposes:
- Neutrals (`--sb-bg`, `--sb-bg-alt`, `--sb-bg-muted`, `--sb-line`, `--sb-line-2`)
- Ink (`--sb-ink`, `--sb-ink-muted`, `--sb-ink-subtle`)
- Both palettes (`--sb-iris*`, `--sb-azure*`) and the accent aliases
- Semantic (`--sb-ok*`, `--sb-warn*`, `--sb-danger*`)
- Language (`--sb-lang-en/es/it/fr`) — **identical on both surfaces**
- Type stack + mono stack, full ramp `--sb-fs-10` → `--sb-fs-32`
- Spacing (`--sb-s-1` → `--sb-s-12`, 4px base), radii, shadow ramp, motion, z-index
- Utility classes: `.sb-mono`, `.sb-kbd`, `.sb-code-token`

---

## 4. Reach-for list (common patterns)

| I need… | Use |
|---|---|
| A primary button | `background: var(--sb-accent); color: #fff;` radius `--sb-r-md` on dashboard, `--sb-r-xl` on extension |
| A shortcut chip (`::quoteEN`) | `.sb-code-token` — mono, accent color on accent-bg, pill radius |
| A language label (EN/IT/ES/FR) | `--sb-lang-XX` at 14% opacity bg, full color text, 33% opacity border |
| A keyboard shortcut | `.sb-kbd` — mono, border-bottom:2px, `--sb-line` border |
| A focus ring | `box-shadow: var(--sb-shadow-glow)` — always 3px, tinted to the current accent |
| Card shadow (dashboard) | `--sb-shadow-sm` for resting, `--sb-shadow-md` for hover |
| Popup/modal shadow | `--sb-shadow-lg` or `--sb-shadow-xl` |

---

## 5. Load-bearing rules (don't negotiate)

1. **Icons = Lucide, stroke 2, currentColor.** Never mix in Heroicons/Feather/Phosphor. Mapping table is in `docs/ICONOGRAPHY.md` §4 — if a concept isn't there, add it there first.
2. **No emoji in UI chrome.** User content yes, buttons/nav/tables/status no. Folder-icon picker has a curated SVG set.
3. **Trigger characters are monospaced, accent-colored, 0.45 opacity when paired with the shortcut body.** Emphasis belongs on the verb (`quoteEN`), not the prefix (`::`).
4. **Language color is structural, not decorative.** Same EN=blue, IT=red, ES=orange, FR=purple on both surfaces, always.
5. **Gradient exists in exactly one place**: the logo-mark well (`linear-gradient(135deg, --sb-iris, --sb-iris-light)`). Nowhere else — no gradient buttons, no gradient KPI cards, no gradient backgrounds.
6. **Numbers use `font-variant-numeric: tabular-nums`** — KPI values, use counts, analytics cells.
7. **Errors have a visible border + sublabel**, never toast-only. A red toast with no field highlight is a bug report waiting to happen.
8. **Popup is 600×420 fixed.** Don't add vertical scroll to the popup itself — scroll lives inside `.snip-list` or the editor body.

---

## 6. Voice & copywriting (see `docs/CONTENT_FUNDAMENTALS.md`)

- Hospitality-industry literate. "Guest," "property," "check-in," "firm reply" — not "user," "entity," "user onboarding."
- Sentence case in UI. Title Case only for proper nouns and the product name.
- Verbs on buttons: **New snippet**, **Save**, **Insert**, **Sync now** — never "Submit" or "Create new item."
- Shortcut names: camelCase, language suffix uppercase — `quoteEN`, `welcomeIT`, `refundFR`. Not `quote_en`, not `QuoteEN`.
- Empty states are directive and offer two paths (e.g., "Import from Notion" + "New snippet"). Never a smiley, never "No data found."

---

## 7. When designing a new screen — checklist

1. Which surface? Set `data-sb-surface` on body.
2. Base font-size correct? (13px extension / 14px dashboard)
3. Accent used via `--sb-accent`, not hard-coded?
4. Icons Lucide, stroke 2, 16/18/20 based on context?
5. Any user-visible numbers have `tabular-nums`?
6. Shortcut references wrapped in `.sb-code-token` (or equivalent mono/accent styling)?
7. Language tag uses `--sb-lang-*` tokens?
8. Buttons use correct radius for surface (xl for extension, md for dashboard)?
9. Focus state wired to `--sb-shadow-glow` (which resolves per accent)?
10. Empty, loading, and error states all present?

---

## 8. Kits to crib from

- **Extension chrome** — `kits/extension.html`. Popup list, editor, settings, overlay, trigger picker, context menu, modals, language picker.
- **Dashboard chrome** — `kits/dashboard.html`. App shell (topbar + nav + main), KPI strip, chart card, top-snippets list, snippets table, form field states, empty state, toast.

Copy the CSS blocks verbatim — they're already token-wired.

---

## 9. What not to build

- **Mobile dashboard views.** The dashboard is explicitly desktop-only. Show a "desktop required" screen on <1024px; don't redesign it responsively.
- **Dark mode.** v1 is light-only. Dark is on the roadmap but tokens aren't dual-mode yet; don't invent dark variants on the fly.
- **A third accent color.** If the product grows a third surface, that's a system-level decision — propose it, don't ship it.
- **Inline-styled colors.** Every color a user sees should trace back to a token in `colors_and_type.css`. If you need a new one, add it to the token file with a comment explaining why.

---

## 10. Changing the system

Tokens live in one place. If you change `--sb-iris` you change the extension everywhere, instantly. That's the point. Before editing, search the existing kits and previews — if a value is used in >3 places it's almost certainly already a token. If it isn't but should be, promote it.
