# User docs (docs.sprintbrain.com)

> On-demand reference for the 📘 User Docs rule in the root `CLAUDE.md`. Read it before changing anything a user can see, to find the page that has to change with it.

## How publishing works

- **Source:** `user-docs/` in this repository. `docs.json` holds the menu, colours, logo and redirects. Every page is an `.mdx` file.
- **Publishing:** Mintlify's GitHub app watches `locoprice/SprintBrain`, branch `main`, subdirectory `/user-docs`, and republishes the site on every push to `main`, in about a minute. Nobody clicks anything.
- **Timing:** work lands on `develop`; the docs go live at the develop to main promotion, together with the release they describe.
- **Only here:** never edit in Mintlify's web editor. Its commits would skip `develop` and the gates.
- **Domain:** docs.sprintbrain.com is set in the Mintlify dashboard. DNS is on Netlify: `CNAME docs` to `cname.mintlify.builders`, plus the two TXT records Mintlify asked for (`_acme-challenge.docs`, `_cf-custom-hostname.docs`).
- **History:** until 2026-09 the content lived only in Mintlify's hosted repo. Its snippet pages sat in `snippets/`, a folder name Mintlify reserves for reusable text blocks, so they were never published. The content was moved here, rewritten against v3.49.7, and the folder renamed to `text-snippets/`.

## Preview locally

```bash
cd user-docs
npx mint@4.2.940 dev
```

Open http://localhost:3000. The Mintlify CLI needs Node 20.17 or later.

## Gates

- `node scripts/check-docs.js`: menu and files match; no page in `snippets/`; internal links reach real pages, not redirects; every page has a title and a description; no long dashes; no hospitality words.
- From `user-docs/`: `npx mint@4.2.940 validate` and `npx mint@4.2.940 broken-links`.

CI runs all three on every push to `develop`.

## Page map

| Part of the product | Where it lives in the code | Page |
|---|---|---|
| Sign-up, sign-in, first snippet | `app/src/routes/{SignupPage,LoginPage}.tsx`, `app/src/components/auth/` | `quickstart` |
| Extension install, sign-in, popup, popup settings | `extension/popup/`, `extension/manifest.json` | `install-extension` |
| Typing triggers, the menu, fill form, right-click, selection suggestions, Undo, capitalization | `extension/content/content.js`, `extension/background/background.js`, `extension/shared/fill-form.js` | `text-snippets/insert` |
| Snippet editor, folders, labels, list, bulk actions, unused notice | `app/src/features/snippets/`, `app/src/features/org/`, `app/src/features/labels/` | `text-snippets/create-and-organize` |
| Field builders: Text, Number, Date/Time, Automatic, Range, Choice, Button | `app/src/features/snippets/Form*Dialog.tsx`, `app/src/lib/form*Token.ts`, `extension/formula-engine.js` | `text-snippets/dynamic-fields` |
| Math (Price line, Calculator, Interest), Condition, Greeting, `{time:}`, `{case:}`, functions | `FormPriceLineDialog.tsx`, `FormCalculatorDialog.tsx`, `FormInterestDialog.tsx`, `app/src/lib/formulaToken.ts`, `extension/formula-engine.js` | `text-snippets/formulas` |
| Languages, language check, language picker, greeting and gendered words | `NewSnippetDialog.tsx`, `content.js` (language modal), `formula-engine.js` | `text-snippets/multilanguage` |
| Version history | `VersionHistoryPanel.tsx` | `text-snippets/version-history` |
| Import and export | `app/src/lib/snippetIo.ts`, `ImportExportButtons.tsx` | `text-snippets/import-export` |
| Prompt editor, blocks, Ask User Questions, Interactive Steps, details, history | `app/src/features/prompts/PromptBlockEditor.tsx`, `app/src/lib/promptUtils.ts`, `app/src/lib/interactiveSteps.ts`, `extension/shared/interactive-steps.js` | `prompts/create-prompts` |
| Prompt score | `app/src/lib/usePromptEvaluator.ts`, `PromptEfficiencyWidget.tsx` | `prompts/quality-score` |
| Prompt list, filters, cards, the `"""` menu | `app/src/routes/PromptsPage.tsx`, `PromptFilters.tsx`, `PromptCard.tsx`, `content.js` prompt picker | `prompts/overview`, `prompts/filters-and-shortcuts` |
| Brains: items, uploads, trash, history, Context button, save selection, save chat, phone (Save to Brain) | `app/src/routes/Memory*.tsx`, `app/src/features/memory/`, `extension/content/{memory-picker,save-selection,chat-capture}.js`, `extension/shared/memory-chunk.js`, `app/public/mobile/index.html` | `brains/overview` |
| Folder sharing | `app/src/features/org/FolderShareModal.tsx` | `team/sharing-and-permissions` |
| Team page, invitations, roles | `app/src/routes/{TeamPage,InvitePage}.tsx`, `app/src/features/org/` | `team/workspace` |
| Phone page, including its Brains page, Paste & save, Share beside Copy, and the Share menu entry (`manifest.webmanifest`) | `app/public/mobile/` | `apps/mobile` |
| Where the extension runs | `content.js` field detection | `integrations/supported-sites` |
| Notion sync | `NotionSyncPanel.tsx`, `extension/services/notion-sync/notion-sync.js` | `integrations/notion-sync` |
| Account, branding, unused months | `app/src/features/settings/{AccountPanel,BrandingPanel,InactivityPanel}.tsx` | `settings/account` |
| Triggers | `InlineTriggerPanel.tsx`, `extension/auth/auth.js` | `settings/triggers` |
| Password, devices, login activity | `app/src/features/settings/{PasswordPanel,SecurityPanel}.tsx` | `settings/security` |
| Analytics | `app/src/routes/AnalyticsPage.tsx`, `app/src/features/analytics/`, `app/src/lib/api/analyticsApi.ts` | `settings/analytics` |
| Overviews | | `index`, `introduction`, `text-snippets/overview`, `prompts/overview` |

A new page gets a row here and an entry in the `docs.json` menu in the same change.

## Left out on purpose (checked at v3.49.7, 2026-09-27)

These exist in the product but don't work for users, so the manual stays silent about them until they're fixed. When one is fixed, document it in the same task.

- **Translate from EN** (snippet editor): the `translate-body` edge function is not deployed.
- **Ask SprintBrain** (dashboard search panel, phone search fields, Settings > Answer feedback, v3.58.0): the `ask-sprintbrain` edge function is not deployed and the `knowledge_feedback` migration is not applied. When both are live, document it on a new page (`ask/overview`) and on `apps/mobile`.
- **Notion button on prompt cards**: the `notion-prompt-push` edge function is not deployed.
- **Push to Notion** (snippets): writes to one database set on the server, not to the account's own Notion.
- **Triggers card**: the Shortcut prefix buttons and the Snippet key / Prompt key choices are saved but never read by the extension.
- **Label suggestions**: switched off (`LABEL_SUGGESTIONS_ENABLED = false`).
- **Analytics cards**: "across 4 folders" and the "12%" change are fixed text, and "last 30 days" doesn't match the 14-day data window.

Documented as limits instead: the phone page ignores `{elseif:}` and `{else}`; Notion sync has no French column.
