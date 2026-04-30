# Content Fundamentals

> How SprintBrain talks, labels, and names things. Voice is unified across the Chrome Extension and the Web Dashboard.

---

## 1. Voice & tone

SprintBrain is used dozens of times per hour by hospitality operators who need to move fast. Copy respects their time.

| Attribute | Do | Don't |
|---|---|---|
| **Crisp** | "Sync now" · "New snippet" | "Click here to synchronize your data" |
| **Operator-literate** | "::quoteEN" · "Trigger" · "Expand" | "Magic word" · "Your snippet spell" |
| **Quiet** | "Saved" (once, then fade) | 🎉 "Awesome! Saved successfully!" |
| **Plain-language errors** | "Notion key looks invalid — starts with `secret_`" | "Error 401: unauthorized" |
| **Neutral-international** | Works for EN/ES/IT/FR users | US-only idioms ("heads up", "gotcha") |

---

## 2. Writing rules

**Sentence case everywhere.** Titles, buttons, labels — all sentence case. The only Title Case exceptions are proper nouns (Notion, Supabase, Chrome, Ibiza) and the product name (SprintBrain, one word, camelCase S and B).

**No trailing punctuation** in buttons, labels, or short lines.
- ✅ `Save` · `New snippet` · `Trigger character`
- ❌ `Save.` · `New Snippet!` · `Trigger Character:`

**Ellipsis `…`** (one character, not three dots) on any action that opens a follow-up step:
`Rename…` · `Move to folder…` · `Delete snippet…`

**Numbers in UI**: always numerals. Use thin space before units in body copy (`142 uses`, `30 min`). In tables, right-align numbers and use `var(--sb-mono)`.

**Dates**: `Synced 4 min ago` (relative), `2026-04-13` (absolute in version/meta lines only).

---

## 3. Shortcut naming (the trigger grammar)

Shortcuts are SprintBrain's keyboard vocabulary. Consistency here matters more than anywhere else.

```
::verb + Qualifier
   │         │
   │         └── Language code (EN/ES/IT/FR) or variant (f = formal)
   └──────────── Lowercase verb or noun, ≤8 chars
```

| Pattern | Example | When |
|---|---|---|
| `::verbLANG` | `::quoteEN`, `::quoteIT`, `::quoteES` | Same content, multiple languages |
| `::verbLANGf` | `::quoteITf` | Formal variant |
| `::noun` | `::firm`, `::refund`, `::checkin` | Single-language utility |
| `::short` | `::hi`, `::disc` | Ultra-frequent (>50/wk) |

**Rules**
- Always lowercase verb, UPPERCASE language code.
- No punctuation inside shortcuts. No underscores, no hyphens.
- Max 10 chars after the prefix. Target 4–7.
- The prefix (`::`, `;;`, `!!`, `"""`) is user-configurable — never hardcode `::` in copy; use `<span class="sb-trigger-prefix">` so it updates.

---

## 4. Label vocabulary (controlled list)

Use these exact terms in both surfaces. No synonyms.

| Concept | Term | Never |
|---|---|---|
| The expanded template | **Snippet** | "macro", "shortcut text", "template" |
| The keyboard sequence | **Shortcut** (UI) / **Trigger** (analytics, settings) | "hotkey", "command" |
| The prefix character | **Trigger character** | "activator", "sigil" |
| AI prompt template | **Prompt** | "AI snippet", "prompt snippet" |
| Curly-brace input | **Field** | "variable", "placeholder" (except in dev docs) |
| `{=…}` math | **Formula** | "calculation", "equation" |
| `{if:…}` block | **Conditional** | "if-block", "logic" |
| Top-level grouping | **Folder** | "group", "collection", "category" |
| Notion→DB pull | **Sync** (verb + noun) | "pull", "import", "refresh" |

---

## 5. Empty states

Three-line formula: **what's missing → why → next action.**

```
No snippets yet
Create your first template or sync from Notion.
[ + New snippet ]  [ Sync from Notion ]
```

Keep illustrations flat. Never use 🎉 or 🚀. A single muted icon (Lucide, 32px, `--sb-ink-subtle`) is enough.

---

## 6. Error & warning copy

Format: **Plain statement → cause → fix.** One sentence, present tense.

| Situation | Copy |
|---|---|
| Invalid Notion key | "Notion key looks invalid — it should start with `secret_` or `ntn_`." |
| Sync hit rate limit | "Notion is rate-limiting us. We'll retry in 60 s." |
| Duplicate shortcut | "`::quoteEN` is already in use. Pick another or edit the existing snippet." |
| Trigger conflict | "This character conflicts with common text. Consider `::` instead." |
| Offline | "You're offline — changes saved locally and will sync when you reconnect." |

Success confirmations: one word, 2 s fade. `Saved` · `Synced` · `Copied`.

---

## 7. Multilingual snippet content

Snippet **bodies** are the user's content — we don't edit them. But the **UI** must accommodate long strings. Design for:

| Language | Length vs EN | Notes |
|---|---|---|
| EN | 1.00× | baseline |
| ES | ~1.20× | "Estimado" > "Dear" |
| IT | ~1.15× | formal address is long |
| FR | ~1.25× | Spaced punctuation (` :`, ` ?`) — preserve when rendering |

Never truncate a shortcut in the UI — truncate the snippet **name** first. Shortcuts are identifiers; names are labels.

---

## 8. Versioning & changelog language

Changelog entries inside the extension use 2-word category badges (ALL CAPS, muted):

- **NEW** · feature added
- **FIX** · bug resolved
- **IMPROVED** · existing behavior refined
- **REMOVED** · feature retired

Entry body: single sentence, present tense, user-visible effect. "Snippets now sync every 5 min in the background." — not "Added chrome.alarms handler for bgNotionSync()".
