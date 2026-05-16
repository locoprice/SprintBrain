export type ChangeType = 'feat' | 'fix' | 'new' | 'refactor';

export interface ChangelogChange {
  type: ChangeType;
  text: string;
}

export interface ChangelogEntry {
  version: string;
  date: string;
  label: string;
  changes?: ChangelogChange[];
  items?: ChangelogChange[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: 'v2.37.0',
    date: '2026-05-16',
    label: 'feat: Notion credentials shared between dashboard and extension via Supabase',
    changes: [
      { type: 'feat', text: 'Dashboard NotionSyncPanel now has editable API key and database ID fields; credentials are stored in Supabase user_metadata' },
      { type: 'feat', text: 'Extension pulls credentials from Supabase on boot if chrome.storage.local is empty, so dashboard-entered credentials are picked up automatically' },
      { type: 'feat', text: 'Extension pushes credentials to Supabase on every change, so the dashboard stays in sync with popup edits' },
      { type: 'feat', text: 'Single source of truth: both surfaces read and write notion_api_key / notion_db_id from auth.users.user_metadata' },
    ],
  },
  {
    version: 'v2.36.0',
    date: '2026-05-14',
    label: 'Fix: Notion sync dedup — one row per snippet group, multi-lang Body properties',
    changes: [
      { type: 'fix', text: 'NotionPush now groups all language variants by lang_group_id and upserts a single Notion page per snippet — no more N rows for N languages' },
      { type: 'fix', text: 'Per-language Body properties (Body EN, Body IT, Body ES, Body MULTI) replace the single Body field; Notion pull recreates all variants from these properties' },
      { type: 'fix', text: 'onComplete match logic now prioritises exact snippet id before falling back to notion_page_id+lang — prevents variant cross-contamination on re-sync' },
      { type: 'fix', text: 'Sync is idempotent: triggering sync multiple times on the same snippets produces no new Notion rows' },
    ],
  },
  {
    version: 'v2.35.0',
    date: '2026-05-14',
    label: 'Fix: stop DEFAULT_SNIPPETS flash + old-snippet save race condition',
    changes: [
      { type: 'fix', text: 'snips and folders now initialise as empty arrays instead of DEFAULT_SNIPPETS/DEFAULT_FOLDERS — no hardcoded snippets are ever shown before Supabase data loads' },
      { type: 'fix', text: 'Eliminated race condition: opening Edit on a DEFAULT_SNIPPET before DB loaded set editId to a string key (e.g. "quoteEN") that no longer existed in snips after load, causing doSave() to return silently without saving' },
      { type: 'fix', text: 'doSave() now shows a visible error toast when findSnip(editId) returns null, so failures are never silent' },
      { type: 'fix', text: 'Empty-DB branch now sets folders=DEFAULT_FOLDERS in memory (not just seeds to Supabase) so folder sidebar renders correctly on first-ever launch' },
    ],
  },
  {
    version: 'v2.32.0',
    date: '2026-05-10',
    label: 'Fix: snippet edits persist — Notion sync respects manually_edited flag',
    changes: [
      { type: 'fix', text: 'Removing "!!" (or any trigger prefix) from a snippet shortcut or body now persists across popup restarts — Notion sync no longer overwrites manually-edited snippets' },
      { type: 'fix', text: '_runNotionSync onComplete skips overwriting any snippet where manually_edited=true, so Notion can no longer restore stale shortcuts' },
      { type: 'fix', text: 'The always-upsert pass now checks manually_edited before pushing Notion data back to Supabase' },
      { type: 'fix', text: 'doSave(), applyTrig(), and trigger-change handler all set manually_edited=true so the guard is active from the first save' },
    ],
  },
  {
    version: 'v2.31.0',
    date: '2026-05-09',
    label: 'Changelog modal: missing entry + key fix + footer',
    changes: [
      { type: 'fix', text: 'v2.30.0 entry was missing from CHANGELOG — modal appeared empty when opened on the latest build' },
      { type: 'fix', text: 'Renderer now reads rel.changes || rel.items so entries written with either key display correctly (v2.27–v2.29 were silently blank)' },
      { type: 'new', text: 'Changelog modal footer shows "Ver. [latest] Last Update: [date]" for at-a-glance version info' },
    ],
  },
  {
    version: 'v2.30.0',
    date: '2026-05-09',
    label: 'Push-to-Sync team snippet sharing',
    changes: [
      { type: 'new', text: 'Team Sync section in Settings — "Sincronizza Snippet con il Team" button promotes private snippets to team-visible status on demand' },
      { type: 'new', text: 'DB: is_shared column added to snippets; RLS policy extended to expose shared snippets to all authenticated team members' },
      { type: 'new', text: 'Extension loadData() now fetches both private (user_id match) and shared snippets in a single OR-filtered query' },
      { type: 'new', text: 'Last sync timestamp persisted to chrome.storage.local and displayed in the Team Sync panel' },
    ],
  },
  {
    version: 'v2.29.0',
    date: '2026-05-09',
    label: 'Fix: lang-modal expansion now replaces trigger text',
    items: [
      { type: 'fix', text: 'Picking a language no longer leaves the literal ::shortcut in the field. Root cause: trigger chars were pre-deleted before opening the modal, but the contenteditable path of deleteChars only SETS a non-collapsed selection — opening the modal stole focus and wiped that selection, so the eventual insertText fell back to inserting at the cursor and the trigger survived. Fix: pass the trigger length through the modal and let handleMatch perform the delete + insert atomically after the user picks a language.' },
    ],
  },
  {
    version: 'v2.28.0',
    date: '2026-05-09',
    label: 'Fix: case-insensitive shortcut match + empty-body CE expansion',
    items: [
      { type: 'fix', text: '::Time (or any mixed-case variant) now directly expands ::time without requiring the picker — shortcut comparison is now case-insensitive' },
      { type: 'fix', text: 'Typing a shortcut whose snippet has an empty body no longer leaves the trigger text selected in the field (contenteditable fix: execCommand is now always fired on the first line so the non-collapsed selection is atomically cleared)' },
    ],
  },
  {
    version: 'v2.27.0',
    date: '2026-05-08',
    label: 'Fix: clean lang modal insertion + deduplicated picker',
    items: [
      { type: 'fix', text: 'Trigger chars (e.g. ::goodnight) are now deleted before the language modal appears, so the chosen translation inserts cleanly without leftover text' },
      { type: 'fix', text: 'Trigger picker now shows one entry per language group instead of listing every variant (EN/ES/IT/FR) separately — selecting it opens the language modal' },
    ],
  },
  {
    version: 'v2.26.0',
    date: '2026-05-15',
    label: 'Fix: OTP email delivery failure — diagnostic logging for auth errors',
    changes: [
      { type: 'fix', text: 'Added HTTP status code logging to sbRequestOtp so SMTP failures (e.g. 535 Authentication credentials invalid) appear in the browser console. Rate-limit responses (HTTP 429) now surface a clear user message instead of the raw Supabase error string.' },
      { type: 'fix', text: 'Added console.error logging to LoginPage.tsx signInWithOtp error path for the same diagnostic purpose.' },
    ],
  },
  {
    version: 'v2.26.0',
    date: '2026-05-08',
    label: 'Fix: lang modal now fires from trigger picker',
    changes: [
      { type: 'fix', text: 'The language picker modal was only wired into checkBuf() (direct full-trigger match) but NOT into selectTriggerItem() (the inline trigger picker that appears when typing ::goo…). Since most users select snippets from the picker, the modal never appeared. Now both paths share _findLangVariants() and show the modal when siblings exist.' },
      { type: 'refactor', text: 'Extracted _findLangVariants(item) as a shared helper — dual-pass detection (lang_group_id first, shortcut-base heuristic second) used by both checkBuf() and selectTriggerItem().' },
    ],
  },
  {
    version: 'v2.25.0',
    date: '2026-05-08',
    label: 'Fix: multi-language modal now fires for all snippets',
    changes: [
      { type: 'fix', text: 'Modal was never triggered because all snippets have lang_group_id=null in Supabase. Added a shortcut-base heuristic as fallback: strips the trailing language suffix (EN/ES/IT/FR/MULTI) from the shortcut and groups snippets that share the same base (e.g. /quoteEN + /quoteES + /quoteIT → modal with 3 buttons). Explicit lang_group_id is still tried first for forward compatibility.' },
    ],
  },
  {
    version: 'v2.24.0',
    date: '2026-05-08',
    label: 'Language picker modal for multi-language snippets',
    changes: [
      { type: 'feat', text: 'When typing a trigger that matches a snippet with multiple language variants, a modal now appears letting the user pick the target language (EN/IT/ES/FR) before inserting. Each button shows the country flag and language name. Escape or backdrop click cancels without insertion.' },
    ],
  },
  {
    version: 'v2.23.2',
    date: '2026-05-08',
    label: 'Submenu flips left near popup edge',
    changes: [
      { type: 'fix', text: '"Move to folder" submenu no longer hides past the popup right edge — when the parent menu is anchored near the right side, the submenu flips to the left' },
    ],
  },
  {
    version: 'v2.23.1',
    date: '2026-05-08',
    label: 'Popup context-menu polish',
    changes: [
      { type: 'fix', text: '"More actions" dropdown no longer clips behind the popup edge — menu measures itself off-screen, then clamps inside the viewport with a 4px safe margin' },
      { type: 'fix', text: 'Empty-area context menu now uses the same boundary-aware clamping logic' },
      { type: 'fix', text: 'Removed "Share snippet" entry from the snippet context menu — handler and menu item both gone' },
    ],
  },
  {
    version: 'v2.23.0',
    date: '2026-05-08',
    label: 'Strict colon-prefix trigger',
    changes: [
      { type: 'fix', text: 'Removed implicit bare-keyword matching — snippets now fire ONLY when the user types the configured "::" prefix' },
      { type: 'fix', text: 'Typing a shortcut as part of a sentence ("the price is...") no longer expands. The "::" trigger is mandatory for every snippet, regardless of how it was stored' },
    ],
  },
  {
    version: 'v2.22.1',
    date: '2026-05-07',
    label: 'Gmail false-positive fix',
    changes: [
      { type: 'fix', text: 'Implicit word-boundary trigger no longer fires on the lone keyword at buffer start (typing "time" in fresh Gmail compose was firing /time)' },
      { type: 'fix', text: 'Buffer sanitized for zero-width / NBSP / soft-hyphen artifacts injected by rich-text contenteditable (Gmail, Slack)' },
      { type: 'fix', text: 'Implicit keyword minimum raised from 2 → 3 chars; preceding-char check switched to explicit delimiter allowlist' },
    ],
  },
  {
    version: 'v2.22.0',
    date: '2026-05-07',
    label: 'Design System Redesign',
    changes: [
      { type: 'new', text: 'Popup redesigned to match SprintBrain design system — iris accent, new typography tokens, refined spacing' },
      { type: 'new', text: 'shared/tokens/colors_and_type.css imported into the popup bundle (--sb-* design tokens)' },
      { type: 'new', text: 'Sync bar uses CheckCircle icon in --sb-ok green; header count rendered as muted pill chip' },
      { type: 'new', text: 'Edit and New Snippet buttons restyled with --sb-line border and --sb-r-xl radius' },
      { type: 'new', text: 'Version bar uses .ver-bar / .dt classes with --sb-mono and --sb-ink-subtle tokens' },
    ],
  },
  {
    version: 'v2.21.0',
    date: '2026-05-07',
    label: 'Paste Fix + Implicit Triggers + Sidebar Sync',
    changes: [
      { type: 'fix', text: 'Paste with "/" no longer triggers snippet execution — dedicated paste guard clears buffer before any trigger evaluation' },
      { type: 'fix', text: 'Ctrl+V / Cmd+V keydown no longer leaks characters into the trigger buffer' },
      { type: 'new', text: 'Implicit trigger system — typing a bare keyword (e.g. "price") now activates the matching snippet with word-boundary detection; ::price still works as before' },
      { type: 'fix', text: 'Sidebar and snippet list always refresh after Notion sync completes, even when no diff was detected' },
      { type: 'fix', text: 'Extension version display always reads from manifest — no stale cached value' },
    ],
  },
  {
    version: 'v2.16.1',
    date: '2026-04-25',
    label: 'WhatsApp Trigger Residue Fix',
    changes: [
      { type: 'fix', text: 'Trigger text (e.g. ::firma) no longer left as residue after snippet insertion in WhatsApp Web' },
      { type: 'fix', text: 'insertText: fixed inverted containment check that caused unnecessary el.focus() on inner Lexical span, resetting the deletion selection' },
      { type: 'fix', text: 'checkBuf: direct snippet match now cancels the debounce picker timer, preventing a spurious picker after a direct trigger fires' },
    ],
  },
  {
    version: 'v2.9.1',
    date: '2026-03-29',
    label: 'Deferred Trigger + Trigger Sync',
    changes: [
      { type: 'fix', text: 'Trigger no longer opens picker immediately — deferred with 600ms debounce for shortcut matching' },
      { type: 'fix', text: 'Typing ::firm now inserts snippet directly without popup interruption' },
      { type: 'fix', text: 'Trigger prefix and Inline Trigger Sequences now synchronized as single source of truth' },
      { type: 'fix', text: 'Changing trigger in settings auto-rewrites all snippet shortcuts' },
      { type: 'fix', text: 'Removed / as preset trigger option — conflicts with WhatsApp, Claude, Notion' },
      { type: 'fix', text: 'Migrated all /-prefixed default snippets to ;; prefix' },
    ],
  },
  {
    version: 'v2.8',
    date: '2026-03-28',
    label: 'Version Alignment + Trigger Picker Fix',
    changes: [
      { type: 'fix', text: 'Trigger picker scroll — no longer closes when scrolling inside the list' },
      { type: 'fix', text: 'Trigger picker click — mousedown handler prevents premature close' },
      { type: 'fix', text: 'Removed 8-snippet cap — all snippets now show in picker' },
      { type: 'new', text: 'Taller picker (320px) with overscroll-behavior:contain' },
      { type: 'fix', text: 'Version alignment — all files now report v2.8' },
    ],
  },
  {
    version: 'v2.7',
    date: '2026-03-22',
    label: 'Configurable Dual Triggers + Paste Fix',
    changes: [
      { type: 'new', text: 'Configurable dual trigger system — :: for snippets, """ for prompts' },
      { type: 'new', text: 'Inline trigger picker — type :: to browse snippets, """ for prompt templates' },
      { type: 'new', text: 'Trigger settings UI in popup — change trigger sequences and activation keys' },
      { type: 'new', text: 'Notion integration — auto-log trigger config changes to a Notion database' },
      { type: 'fix', text: 'Paste event handlers — clipboard input now triggers all UI updates reliably' },
      { type: 'fix', text: 'Overlay fill fields respond to paste events for preview updates' },
    ],
  },
  {
    version: 'v2.6',
    date: '2026-03-21',
    label: 'Urgency Timer & Scarcity',
    changes: [
      { type: 'new', text: 'Optional countdown timer for quote snippets (Combo Deals style)' },
      { type: 'new', text: 'Inventory scarcity label: "Only N unit(s) left" with pulsing indicator' },
      { type: 'new', text: 'Timer persists across page refreshes — no reset on reload' },
      { type: 'new', text: 'Timer expiration blocks quote insertion in content script' },
      { type: 'new', text: 'Toggle enable_urgency_timer + duration/units in snippet editor' },
    ],
  },
  {
    version: 'v2.3',
    date: '2026-03-18',
    label: 'Cloud Sync + Context Menu',
    changes: [
      { type: 'new', text: 'Supabase cloud sync — snippets shared across all team devices in real time' },
      { type: 'new', text: 'Right-click any text field on any website to insert a snippet (TextBlaze style)' },
      { type: 'new', text: 'Context menu groups snippets by folder with submenus' },
      { type: 'new', text: 'Sprint Brain rebrand — clean logo, version footer' },
      { type: 'fix', text: 'Full popup.js clean rewrite — no more patching bugs' },
    ],
  },
  {
    version: 'v2.2',
    date: '2026-03-17',
    label: 'Folders + Stats',
    changes: [
      { type: 'new', text: 'Folder sidebar — organize snippets by category' },
      { type: 'new', text: 'Right-click inside popup — duplicate, move, rename, delete' },
      { type: 'new', text: 'Usage statistics — use count, fill rate, last used' },
      { type: 'new', text: 'Celebration card shows usage milestones' },
    ],
  },
  {
    version: 'v2.1',
    date: '2026-03-16',
    label: 'Chrome Extension',
    changes: [
      { type: 'new', text: 'Chrome Extension — type ;;shortcut anywhere to auto-expand' },
      { type: 'new', text: 'Configurable trigger character (;;, ::, !!)' },
      { type: 'fix', text: 'MV3 CSP — moved all JS to external popup.js' },
    ],
  },
  {
    version: 'v2.0',
    date: '2026-03-15',
    label: 'Web App Launch',
    changes: [
      { type: 'new', text: 'Full snippet manager with formula engine' },
      { type: 'new', text: 'Conditional logic {if:A>0}...{endif}' },
      { type: 'new', text: 'Confetti + Human vs Machine celebration' },
    ],
  },
];
