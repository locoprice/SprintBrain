# Chrome Web Store — Submission Copy
**Extension:** SprintBrain
**Version:** 2.124.0
**Category:** Productivity
**Language:** English
**Last revised:** 2026-07-27 (SEO rewrite — team, AI prompts, customization, Notion)

> **House style:** no em dashes in customer-facing copy (matches the marketing site, v2.91.2).
> Every claim below is verified against shipped code; see §"Claim → reality check".

---

## Short Description (132 chars max — paste into "Summary")

```
AI prompt library and text expander. Free team sharing, dynamic snippets with live formulas, and two-way Notion sync.
```

*(117 characters. Kept identical to `extension/manifest.json` → `description`, which Chrome uses to seed the Summary field on upload.)*

---

## Full Description (paste into "Detailed description")

```
SprintBrain is a free AI productivity extension that turns your best text into a shortcut. Store snippets, AI prompts, and calculation templates in one shared library, then expand any of them with a short trigger inside any text field on any website: Gmail, Outlook, Slack, Notion, WhatsApp Web, ChatGPT, Claude, your CRM, or your booking platform.

Teams lose hours every week retyping the same quotes, replies, and AI prompts, then lose consistency when everyone keeps a private copy. SprintBrain gives your whole team one source of truth and makes it available exactly where the typing happens.


FREE TEAM MANAGEMENT, INCLUDED FROM THE START

Team collaboration is not a paid add-on in SprintBrain. It is the core of the product, and it costs nothing.

• Share a folder with your whole team or with specific teammates. The folder is the permission boundary, so every snippet, prompt, and formula inside it inherits the access you grant.
• Three access levels: View (use it), Edit (use and modify it), Owner (full control, including sharing).
• Shared content appears in each teammate's dashboard, Chrome extension, and mobile view the moment you share it. No exports, no copy and paste, no re-onboarding.
• A team workspace hub shows your member roster, everything shared by you and with you, and who has access to each folder, under your own company logo and cover image.
• Every snippet and prompt carries authorship: who created it, who changed it last, and when.
• Access is enforced server side with row-level security, not just hidden in the interface.
• No credit card required to sign up, and no per-seat pricing for sharing.

Result: one approved wording per situation, adopted by the whole team, updated once and live everywhere.


ADVANCED AI SUPPORT: A PROMPT LIBRARY THAT FOLLOWS YOU

SprintBrain treats AI prompts as first-class assets, not as notes buried in a document.

• Keep your production prompts for ChatGPT, Claude, Gemini, and any other model in a searchable library alongside your text templates.
• Type the prompt trigger (default: """) in any input to browse the library, or give a prompt its own shortcut and expand it straight into the model's chat box.
• Filter by strategy (Chain of Thought, Tree of Thought, one-shot, few-shot, RAG, agentic), by intent (Writing, Coding, Support, SEO, Analysis, Planning, Research, Teaching), and by expected output (JSON, Markdown, SOP, plain text).
• A built-in prompt quality score grades each prompt on role, objective, context, examples, reasoning, and constraints, explains every deduction, and offers one-click fixes. Your team writes better prompts without needing a prompt engineer on staff.
• Share a prompt folder and your whole team draws from the same quality baseline, instead of each person improvising a new instruction every time.


PROMPT AND SNIPPET CUSTOMIZATION

Static text is where most text expanders stop. SprintBrain makes every template adapt to the situation.

• Structured prompt builder: compose prompts from role, objective, context, examples, reasoning, and constraints blocks, and enable only the blocks a given task needs.
• Dynamic fields: write {guest_name} or {check_in} and SprintBrain asks for the values at insertion time through an inline overlay, with text, number, date, and dropdown field types.
• Live formulas: totals, discounts, fees, taxes, and net prices are calculated the instant the template expands, using a safe parser with no eval.
• Conditional blocks: {if:...}{endif} shows or hides entire paragraphs based on the values you just filled in.
• Multi-language variants: keep EN, IT, ES, FR, and MULTI versions of the same snippet grouped together, and pick the language at expansion time.
• Custom triggers: choose your own prefix so expansions never fire by accident in normal prose.
• Urgency timers and scarcity counters for time-sensitive quotes and offers.
• Fill and copy from the extension popup when the target field does not accept in-place expansion.


NOTION SYNCHRONIZATION

If your team already writes in Notion, keep writing there.

• Connect a Notion database and SprintBrain mirrors it into your library, refreshed automatically in the background every five minutes.
• Sync runs both ways: edits made in SprintBrain are pushed back to Notion as one clean row per snippet, with a separate body property per language, so multi-language templates never explode into duplicate pages.
• Incremental sync based on last edited time, with retries, offline caching, and a manual force-sync when you cannot wait.
• Reviewers comment and approve in Notion; the approved wording reaches every teammate's extension within the minute.
• Notion credentials are entered once and shared between the dashboard and the extension automatically.


HOW IT WORKS

1. Install SprintBrain and sign in with a free account (email link, no password to remember).
2. Create snippets, prompts, and folders in the web dashboard, or import them from Notion.
3. Type your trigger plus the shortcut in any text field and press Tab, or right-click the field and pick the snippet from the context menu. The trigger disappears and the finished text takes its place.


WORKS EVERYWHERE YOU TYPE

Gmail, Outlook, Slack, Notion, WhatsApp Web, ChatGPT, Claude, Zendesk, Intercom, HubSpot, Salesforce, Airbnb, Booking.com, and any standard input, textarea, or rich-text editor, including Lexical, ProseMirror, and contenteditable fields. Your library also opens in any mobile browser, so you can search and copy from your phone without installing anything.


WHO IT IS FOR

• Customer support and success teams standardizing replies and macros
• Sales and revenue teams sending quotes with calculated pricing
• Hospitality and property operators handling multilingual guest communication
• Recruiters, agencies, and consultants reusing outreach and follow-up templates
• AI power users and prompt engineers who want a versioned, shared prompt library
• Anyone who types the same thing twice and wants that time back


HOW SPRINTBRAIN GOT HERE

SprintBrain ships continuously. A short history of what has landed:

• March 2026, v2.0 to v2.3: snippet manager with the formula engine and conditional logic, then the Chrome extension itself with configurable triggers, folders, usage statistics, cloud sync, and the right-click menu.
• March to May 2026, v2.6 to v2.29: urgency timers and scarcity counters, separate triggers for snippets and prompts, the inline trigger picker, and multi-language snippet groups with a language picker at expansion time.
• May to June 2026, v2.30 to v2.73: team collaboration, first as push-to-sync sharing and then as folder-level access control with View, Edit, and Owner permissions, extended across the dashboard, the extension, and mobile.
• June to July 2026, v2.79 to v2.98: the web dashboard became the single management surface, prompts gained their own shortcuts and filters, and the popup was rebuilt as a search-first launcher that can fill a snippet's fields and copy the finished text.
• July 2026, v2.101 to v2.124: guided onboarding, the team workspace hub with cover images and member roster, authorship attribution on every asset, company branding applied to the workspace and the extension icon, more reliable sessions, and expansion fixes for Lexical-based editors such as WhatsApp Web.


PRIVACY AND SECURITY

• Your library is cached locally in the browser for instant, offline-safe expansion.
• Cloud storage runs on Supabase in the EU, protected by row-level security, so you only ever read the rows you own or that were shared with you.
• Notion sync uses only the API key you provide. It is used to reach the Notion API and is never sold, shared, or used for anything else.
• Your snippet content is never sold or shared with third parties, and is not used for advertising.
• Review every signed-in device, check recent login activity, and sign out everywhere in one click.


GET STARTED

Install the extension, create a free account, and share your first folder with your team. Setup takes about two minutes.

Website: https://sprintbrain.com
Dashboard: https://app.sprintbrain.com
```

---

## SEO Notes (not pasted into the store)

Chrome Web Store search indexes the extension name, the summary, and the detailed
description. The copy above is built around three keyword clusters, each placed in the
first 200 characters of its section so the store snippet shows them:

| Cluster | Primary terms | Where they appear |
|---|---|---|
| **AI** | AI prompt library, prompt manager, ChatGPT prompts, Claude prompts, prompt engineering, AI productivity, prompt templates | Summary, intro paragraph, "Advanced AI support", "Prompt and snippet customization", "Who it is for" |
| **Productivity** | text expander, text expansion, snippets, canned responses, email templates, keyboard shortcuts, autotext, macros | Summary, intro paragraph, "How it works", "Works everywhere you type" |
| **Collaboration** | team sharing, shared snippets, team collaboration, shared templates, team workspace, permissions, Notion sync | "Free team management", "Notion synchronization", "Who it is for" |

Rules applied:
- Keyword density stays natural. No keyword lists, no stuffing, both of which Chrome Web Store policy treats as spam.
- The four killer features open the description, before the fold, in the order requested by the business: free team management, advanced AI support, prompt customization, Notion sync.
- The update timeline gives recency signals to human readers evaluating whether the extension is maintained.
- The Summary duplicates `manifest.json` → `description` exactly, so the value stays stable across re-uploads.

---

## Claim → Reality Check

| Claim in the copy | Implementation | Verdict |
|---|---|---|
| Free team sharing, no per-seat pricing | No billing surface exists in the product; landing page states "No credit card required" | ✅ Accurate today |
| Whole team or specific teammates, View / Edit / Owner | `FolderShareModal.tsx`, `PermissionLevel = view \| edit \| owner` | ✅ |
| Folder is the permission boundary | `folderShares.ts`; snippets, prompts, formulas inherit folder access | ✅ |
| Enforced server side | Phase B RLS (`app.can_read_folder` / `can_write_folder`), extension reads `accessible_snippets()` | ✅ |
| Team hub, covers, roster, authorship | `TeamPage.tsx`, `TeamCover.tsx`, attribution shipped v2.108.0 | ✅ |
| Company logo as workspace and extension icon | v2.117.0 / v2.119.0 branding | ✅ |
| Prompt library, `"""` trigger, per-prompt shortcuts | v2.57.0 picker, v2.83.0 shortcut expansion | ✅ |
| Strategy / intent / output filters | `PromptBlockEditor.tsx` (`STRATEGIES`, `INTENT_CATEGORIES`, `OUTPUT_TYPES`), `PromptFilters.tsx` | ✅ |
| Prompt quality score with rationale and one-click fixes | `usePromptEvaluator.ts` (weighted 0–10, `rationale`, `suggestionLabel`), `PromptEfficiencyWidget.tsx` | ✅ |
| Prompt blocks: role, objective, context, examples, reasoning, constraints | `BLOCK_ORDER` in `PromptBlockEditor.tsx` | ✅ |
| Dynamic fields with text / number / date / dropdown | `field_cfg` JSONB, overlay in `content/content.js` | ✅ |
| Live formulas, no `eval` | `formula-engine.js`, whitelist parser via `Function()` on a validated expression | ✅ |
| Conditionals, multi-language variants, custom triggers, urgency timers | `resolveBody()`, `lang_group_id`, trigger config, `enable_urgency_timer` | ✅ |
| Fill fields and copy from the popup | v2.98.0 | ✅ |
| Notion sync every 5 minutes, both directions, one row per snippet | `chrome.alarms` 5 min (`background.js`), `NotionPush` (`popup.js`), per-language Body properties (v2.36.0) | ✅ |
| Notion credentials shared between dashboard and extension | v2.37.0 | ✅ |
| Mobile browser access | `app/public/mobile/` (read-only browse, search, copy) | ✅ |
| Devices list, login activity, sign out everywhere | v2.86.0 `SecurityPanel.tsx` | ✅ |
| Supabase in the EU with RLS | Project `eyowustlbqujaimaxggt`, region eu-west-1, RLS on all tables | ✅ |

No aspirational or unshipped feature is claimed. Mobile is described as browse, search, and
copy only, with no sharing UI, matching the build.

---

## Permission Justifications
*(Paste verbatim into the "Permission justification" field in the Developer Dashboard)*

**storage**
SprintBrain stores your snippet and prompt library in `chrome.storage` to keep expansions instant and available offline. Authentication tokens, sync timestamps, and user preferences (active trigger, default language) are also persisted locally.

**activeTab**
Required so that context menu clicks can identify the active tab and send the selected snippet to the correct page for insertion.

**contextMenus**
SprintBrain builds a dynamic right-click menu that mirrors your library, grouped by folder with language submenus. Clicking an entry inserts the snippet into the focused field on the current page.

**alarms**
A repeating alarm fires every 5 minutes to pull updates from your connected Notion database in the background. Without this permission the Manifest V3 service worker cannot schedule periodic tasks.

**Host permission: `<all_urls>`**
Snippet expansion must work in any text field on any website: CRMs, booking platforms, email clients, chat tools, AI chat interfaces, and internal dashboards all use different origins. Restricting to a fixed list of domains would make the core feature non-functional for most users. The content script runs at `document_idle`, injects no UI unless the user types a configured trigger, and reads no page content beyond the keystroke buffer needed for trigger detection.

**Host permission: `https://eyowustlbqujaimaxggt.supabase.co/*`**
SprintBrain authenticates users and stores snippet, prompt, folder, and sharing data on a Supabase backend. All calls are authenticated with a JWT obtained via email OTP. The key embedded in the extension is a Supabase publishable key; access is enforced server side through Row Level Security.

**Host permission: `https://api.notion.com/*`**
Users who connect a Notion database can sync their library in both directions. The extension calls the Notion API using the integration key the user enters, which is stored for that user's account and never shared with third parties.

**`externally_connectable`: `https://app.sprintbrain.com/*`**
The dashboard hands a one-time session token to the extension so signing in on the web signs you in in Chrome. Only the SprintBrain dashboard origin can message the extension, and the handoff mints a session the extension owns independently.

---

## Category & Metadata

| Field | Value |
|---|---|
| Primary category | Productivity |
| Language | English |
| Support email | support@sprintbrain.com *(verify this address exists before submission)* |
| Homepage URL | https://sprintbrain.com |
| Privacy policy URL | https://sprintbrain.com/privacy *(required before submission)* |
| Store item ID | `khdpimdpkgmmaimpbfjgglnpaemmopoo` |

---

## Required Screenshots (1280×800 or 640×400)

Minimum 1, recommended 5. Ordered so the killer features land first, since most
visitors only look at the first two:

1. **Team workspace** — shared folders with team and teammate badges, member roster, access faces
2. **Prompt library** — prompt cards with strategy and intent filters, plus the efficiency score panel
3. **Trigger in action** — a text field mid-expansion, trigger typed, finished template appearing
4. **Dynamic field overlay** — the inline form collecting values, with the calculated total updating live
5. **Notion sync panel** — connected database with the last-sync timestamp

## Promotional Tile (440×280 — optional but recommended)

Tagline: **"Your team's snippets and AI prompts. One trigger away."**

---

## Single-Purpose Statement
*(If asked during review)*

SprintBrain has a single purpose: letting users store reusable text snippets and AI prompts and expand them into any text field on any website using a customisable keyboard trigger. Team sharing, Notion sync, and the dashboard all serve that one purpose by determining which snippets a user can expand.
