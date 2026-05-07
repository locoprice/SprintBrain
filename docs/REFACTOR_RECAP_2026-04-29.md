# SprintBrain — Repo Refactor Recap (2026-04-29)

Hand-off note for Claude Code. Paste or @-reference this file when resuming work.

## What changed

The repo was restructured from a flat root-mixed layout into a clean modular tree.

### New structure
```
SprintBrain/
├── .claude/
├── .github/workflows/ci.yml
├── .gitignore                    (hardened: *.pem, dist/, OS files)
├── app/                          (was /web/ — React + Vite dashboard)
├── docs/
│   ├── README.md
│   ├── CLAUDE.md
│   ├── PROJECT_CONTEXT.md
│   └── WORKFLOW.md
├── extension/                    (Chrome MV3, self-contained)
│   ├── manifest.json
│   ├── assets/icons/{16,48,128}.png
│   ├── auth/auth.js
│   ├── background/background.js
│   ├── content/content.js
│   ├── overlay/overlay.css
│   ├── popup/{popup.html, popup.js}
│   └── services/notion-sync/notion-sync.js
├── netlify.toml                  (at root — Netlify auto-discovery)
├── scripts/{check-version.js, check-snippets.js}
└── services/supabase/migrations/
```

## Files modified (path-only edits, no business logic touched)

| File | Change |
|---|---|
| `extension/manifest.json` | `service_worker`, `content_scripts`, `default_popup`, `icons` repointed to role subfolders |
| `extension/background/background.js` | `importScripts('auth.js')` -> `'../auth/auth.js'`; `'notion-sync.js'` -> `'../services/notion-sync/notion-sync.js'` |
| `extension/popup/popup.html` | 2 `<script src>` tags repointed (`../auth/auth.js`, `../services/notion-sync/notion-sync.js`) |
| `netlify.toml` | `base = "web"` -> `"app"` |
| `scripts/check-version.js` | Read paths now `extension/manifest.json` + `app/package.json` (replaces ghost paths `sprintbrain-extension/manifest.json` and `Sprintbrain.html`) |
| `.github/workflows/ci.yml` | File-existence checks now `extension/manifest.json`, `app/index.html`, `app/package.json` |
| `.gitignore` | Adds `*.pem`, `sb-extension.pem`, `dist/`, `.DS_Store`, `Thumbs.db` |

## Architectural deviation from spec

- **`notion-sync.js` lives at `extension/services/notion-sync/`, NOT at top-level `/services/notion-sync/`.**
  Reason: Chrome MV3 service workers (`importScripts`) and popup HTML can only load files inside the extension package (where `manifest.json` sits). Top-level placement would have broken extension load. Supabase migrations (pure SQL, never loaded by Chrome) safely live at top-level `/services/supabase/`.

## Verification status

- 7/7 manifest.json target paths resolve to real files
- 2/2 background.js `importScripts()` targets resolve
- 3/3 popup.html `<script src>` targets resolve
- 3/3 scripts/check-version.js fs targets resolve
- `node scripts/check-version.js` runs cleanly and now correctly reports a real version drift (see Pending #2)
- 0 stale `web/` runtime references remain (only descriptive prose in docs)
- Extension load in Chrome: NOT yet tested by human — please reload at `chrome://extensions` and confirm

## Pending items (require human action)

1. **`.claude/launch.json` line 13** — change `"web"` -> `"app"`. Claude file tool refuses to write under `.claude/`. Edit manually.
2. **Version drift** — `extension/manifest.json` = `2.17.0`, `app/package.json` = `2.20.1`. Decide canonical version and align both. Per WORKFLOW.md, version is bumped via the AskUserQuestion flow on user-facing changes only.
3. **Doc prose cleanup** — `docs/PROJECT_CONTEXT.md` and `app/CLAUDE.md` still describe the old `/web/` paths in prose. Follow-up doc pass when convenient.
4. **Extension reload + smoke test** — at `chrome://extensions` reload the unpacked extension, then verify: popup opens, content script injects on a test page, service worker shows no errors in DevTools.
5. **`check-snippets.js` pre-existing defect** — third test case `{{= broken + 2 }}` is intentionally invalid but the script treats any failure as fatal. CI would always fail. Out of refactor scope; flag for separate fix.

## Key paths for Claude Code

- Extension entry for `chrome://extensions` "Load unpacked": `C:\Users\averd\Desktop\SprintBrain\extension\`
- Web app dev: `cd app && npm run dev` (port 5173)
- CI version check: `node scripts/check-version.js` (run from repo root)
- Supabase migrations: `services/supabase/migrations/`
- `.pem` signing key: removed from repo, gitignored. User holds backup separately.

## Risks logged

- `notion-sync.js` lives in two conceptual places: physically inside `/extension/`, semantically a "service". When working on it, remember it's part of the Chrome extension package and any path changes ripple to `manifest.json` is not affected (it's not declared there) but DO ripple to `background.js` and `popup.html`.
- Netlify deploys depend on `netlify.toml` at repo root — do not move it back into `/config/`.
- Pre-existing version drift will fail CI on next push to `develop` because `scripts/check-version.js` now correctly enforces parity. Resolve before pushing.
