# ⚡ Sprintbrain

> Team snippet manager for LeibTour — Ibiza vacation rentals.  
> Type `;;quoteEN` anywhere → full booking message appears instantly.

---

## What is Sprintbrain?

Sprintbrain is an internal productivity tool for the LeibTour team.  
It replaces manual copy-paste with smart snippet expansion — including formulas, dropdowns, date pickers and conditional logic.

---

## Products

| Product | File | Description |
|---|---|---|
| **Web App** | `Sprintbrain.html` | Open in any browser — works offline |
| **Chrome Extension** | `sprintbrain-extension/` | Auto-expands shortcuts on Gmail, WhatsApp, Airbnb, Claude |

---

## Features

- `{variable}` — fill-in text fields
- `{=A - B}` — live formula calculations (savings, card surcharge, etc.)
- `{if:OTA > 0}…{endif}` — conditional blocks
- Dropdowns, date pickers, paragraph fields
- Folder sidebar — organize snippets by category
- Right-click context menu — duplicate, move, rename, delete
- Usage statistics — track most-used snippets and fill rate
- Confetti + Human vs Machine celebration on copy
- **Supabase cloud sync** — all 10 team members share the same snippets in real time

---

## Architecture

```
Sprintbrain.html        → Web app (Netlify)
sprintbrain-extension/  → Chrome Extension (Developer Mode)
Supabase                → Cloud database (snippets, folders, stats)
```

**Database:** `eyowustlbqujaimaxggt.supabase.co`  
Tables: `folders` · `snippets` · `snippet_stats`

---

## Default Snippets

| Shortcut | Title | Lang |
|---|---|---|
| `;;quoteEN` | BOOKING QUOTE EN | EN |
| `;;quoteES` | PRESUPUESTO B2C | ES |
| `;;quoteIT` | PREVENTIVO B2C | IT |
| `;;checkin` | CHECK-IN EN | EN |
| `;;review` | REVIEW REQUEST EN | EN |

---

## Deployment

### Netlify (Web App)
1. Connect this repo to Netlify
2. Build command: *(none)*
3. Publish directory: `.`
4. Every push to `main` → auto-deploys

### Chrome Extension
1. Open `chrome://extensions`
2. Enable Developer Mode
3. Click "Load unpacked" → select `sprintbrain-extension/` folder
4. Snippets sync automatically via Supabase

---

## Changelog

### v5.0.0 — Supabase Cloud Sync
- Replaced localStorage/chrome.storage with Supabase
- All team members share snippets in real time
- Stats (uses, fills, last used) stored in cloud
- Seeding: first run automatically populates the database

### v4.1.0 — Usage Statistics
- Per-snippet usage counter (copies + fills)
- Stats badges on every card
- 📊 Stats tab with full ranking table
- Celebration card shows use milestone

### v4.0.0 — Folders + Right-click
- Folder sidebar with create/manage
- Right-click context menu: duplicate, move, rename, delete
- Default folders: 💰 Presupuestos · 🤖 AI Prompts

### v3.0.0 — Chrome Extension
- Keystroke buffer approach — works on all editors
- Fixed center overlay with dark backdrop
- Content script v3.0 clean rewrite

---

## Tech Stack

- Vanilla HTML/CSS/JS (no framework — intentional)
- [Supabase](https://supabase.com) — PostgreSQL + REST API
- [Netlify](https://netlify.com) — hosting + CI/CD
- Chrome Extension Manifest V3

---

*Built for LeibTour — Ibiza, Spain 🌴*
