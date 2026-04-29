# Iconography

> SprintBrain uses inline SVG icons from a single source, at strict sizes and stroke weights. No emoji in UI chrome (user content excepted).

---

## 1. Source

**Lucide** (MIT-licensed, tree-shakeable) is the canonical icon library.

- Dashboard: `lucide-react` (already installed in `web/package.json`).
- Extension: icons are copy-pasted as inline `<svg>` into `popup.html` and `overlay.css` — there's no bundler, so we can't import.

Never mix in a second library. Heroicons, Feather, Phosphor all look *almost* like Lucide and the visual noise of mismatched terminals / caps / miter is immediately visible.

---

## 2. Sizes

| Token class | px | Canonical use |
|---|---|---|
| `ic-sm` | 14 | Chips, pills, kbd, inline hint |
| `ic` *(default)* | 16 | Buttons, nav items, folder rows |
| `ic-lg` | 18 | Context menu items, icon buttons |
| `ic-xl` | 20 | KPI card glyph, primary-action icon button |
| `ic-2xl` | 24 | Empty-state hero, section headers |
| `ic-3xl` | 32 | Onboarding, large empty states |

**Stroke weight**: always **2**. Lucide's default. Do not edit the paths to "fix" thickness — increase the size tier instead.

**Alignment**: all icons render in a `display:inline-flex; align-items:center; justify-content:center` wrapper. Never set `vertical-align` on the `<svg>` directly.

---

## 3. Color

Icons inherit text color via `stroke="currentColor" fill="none"`. That's the only correct wiring. Concretely in Lucide markup:

```html
<span class="ic">
  <svg viewBox="0 0 24 24" stroke="currentColor" fill="none"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <!-- path -->
  </svg>
</span>
```

A chip like `<button class="hdr-btn primary">` sets `color:#fff` → the nested `.ic svg` inherits it. No per-icon color overrides.

---

## 4. Canonical mapping (concept → Lucide name)

Don't invent new mappings. If a concept isn't in this table, add it here first.

| SprintBrain concept | Lucide | Size |
|---|---|---|
| Snippet (generic) | `Type` | 16 |
| Snippet with formula | `Calculator` | 16 |
| Prompt | `MessageSquareText` | 16 |
| Folder | `Folder` | 16 |
| Folders root | `Folders` | 16 |
| New / add | `Plus` | 14 |
| Search | `Search` | 14–16 |
| Settings | `Settings` | 16 |
| Analytics | `BarChart3` | 16 |
| Sync | `RefreshCw` | 14 in sync bar, 16 in settings |
| Sync OK | `CheckCircle2` | 14 |
| Sync failing | `AlertTriangle` | 14 |
| Urgency timer | `Clock` | 14 |
| Formula `{=…}` | `Calculator` | 14 |
| Conditional `{if:…}` | `GitBranch` | 14 |
| Prompt-lock | `Lock` | 14 |
| Copy to clipboard | `Copy` | 14 |
| Duplicate | `Copy` | 14 (same glyph, labeled "Duplicate") |
| Rename | `Pencil` | 14 |
| Pin | `Pin` | 14 |
| Share | `Share2` | 14 |
| Delete | `Trash2` | 14 |
| Notion | Custom `N` mark (see §6) | 16 |
| Help | `HelpCircle` | 16 |
| Feedback | `LifeBuoy` | 16 |
| Notifications | `Bell` | 16 |
| Globe / language | `Globe` | 14 |
| Lightning (brand) | Custom (see §6) | 16–32 |

**Context-menu rule**: always pair the action verb with an icon, 14px, `--sb-ink-muted` default / `--sb-danger` for destructive.

---

## 5. Emoji policy

| Place | Emoji allowed? |
|---|---|
| UI chrome (buttons, nav, tables, status) | **No.** Use Lucide. |
| Folder icons (user-picked) | Yes — from a curated set of 10 SVG glyphs (see `popup.html` folder-modal picker). Emoji fallback only for legacy Notion-synced folders. |
| Language flags (🇬🇧 🇮🇹 🇪🇸 🇫🇷) | Accepted in compact placements (sidebar folder row) but **prefer** the 2-letter lang pill with the language color. Flags are politically fraught (e.g. 🇬🇧 vs 🇺🇸 for EN); lang codes are neutral. |
| Empty states / illustrations | No. Lucide `ic-3xl` in `--sb-ink-subtle`. |
| Snippet body (user content) | Unlimited — it's the user's text. |

---

## 6. Special glyphs

### 6.1 Logo mark (lightning bolt)

SprintBrain's mark is a lightning bolt in a rounded-square well. The well uses an Iris→Iris-light gradient. This is the **only** place we gradient.

```html
<span class="sb-logo-mark">
  <svg viewBox="0 0 24 24">
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
  </svg>
</span>
```

The bolt is filled with white, stroke 1. Background is `linear-gradient(135deg, var(--sb-iris), var(--sb-iris-light))` regardless of surface — the logo keeps its Iris identity even on Azure dashboard, same way Gmail's envelope stays red inside Google's blue shell.

### 6.2 Trigger prefix characters

The trigger characters `::`, `;;`, `!!`, `"""` are the shortcut's leading glyph. They have dedicated styling:

```
font-family: var(--sb-mono);
font-weight: 700;
color: var(--sb-accent);
letter-spacing: 0;
```

Render at 0.45 opacity when inline next to the shortcut body (`::` gray, `quoteEN` full accent) — emphasis belongs on the verb, not the prefix.

### 6.3 Language code chip

2-letter lang codes in a pill are a distinct glyph pattern. They're not icons but they occupy icon slots:

```
<span class="lang-pill EN">EN</span>
```

See `previews/04-components.html` for exact rendering. Font: `--sb-font` 10px 700 upper, no letter-spacing.

---

## 7. Custom icon guidelines

If you must draw a custom SVG (logo, Notion "N", hospitality property glyph), follow:

- `viewBox="0 0 24 24"` always.
- Stroke 2, round caps, round joins — matches Lucide.
- No gradients except the logo mark.
- Optically centered in a 20×20 safe area.
- Export as minified inline SVG, no XML prolog, no `<title>` (we add `aria-label` on the wrapper).

---

## 8. Accessibility

- Decorative icon next to a label: wrap in `<span aria-hidden="true" class="ic">…</span>`.
- Icon-only button: parent `<button aria-label="Delete snippet">` — the SVG itself stays `aria-hidden`.
- Never use an icon alone to convey state — pair with a word or a visible text color change.
