# Sprintbrain — Development Workflow

**Version:** 2.8  
**Last updated:** 2026-03-23  
**Owner:** Alessandro Verdicchio

---

## Source of Truth

GitHub `main` branch is the single source of truth.  
No code is valid unless it is committed and pushed to `origin`.

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `main` | Stable production. Never edited directly. |
| `develop` | Active development. All work happens here. |
| `feature/xxx` | Isolated features. Merged into develop via PR. |

---

## Tool Responsibilities

| Tool | Allowed Usage |
|------|--------------|
| Claude Chat (Sonnet) | Code generation, debugging, architecture decisions |
| Claude Code | Single explicit tasks only. Never autonomous. Never commits without review. |
| Alessandro | All git operations. All file changes. All reloads. |

---

## Update Cycle (every change)

1. Edit files locally in `sprintbrain-extension-v2.8`
2. Review the diff: `git diff`
3. Stage and commit: `git add . && git commit -m "type: description"`
4. Push: `git push origin develop`
5. Reload extension: `chrome://extensions` → Reload
6. Test manually in Chrome
7. When stable: open PR from `develop` → `main`

---

## Chrome Extension Reload

**Always manual. No exceptions.**

After any file change:
- Go to `chrome://extensions`
- Find Sprintbrain → click **Reload**
- Test a snippet trigger (e.g. `/firm`, `/quoteEN`)

---

## Snippets Data Flow

Snippets are hardcoded in `content.js`.  
To update snippets:
1. Edit `content.js` directly
2. Commit and push
3. Reload extension in Chrome

No dynamic fetch. No chrome.storage sync. No auto-reload.

---

## Commit Message Format
```
feat: add new snippet /quoteEN
fix: correct price calculation in quote template
chore: update workflow documentation
refactor: restructure content.js snippet array
```

---

## What NOT to Do

- Do not let Claude Code commit autonomously
- Do not edit `main` directly
- Do not assume the extension auto-reloads after a git push
- Do not use localStorage or chrome.storage for snippets
- Do not delete `develop` branch after merging — keep it alive