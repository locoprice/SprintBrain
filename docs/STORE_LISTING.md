# Chrome Web Store — Submission Copy
**Extension:** SprintBrain  
**Version:** 2.40.1  
**Category:** Productivity  
**Language:** English

---

## Short Description (132 chars max — paste into "Summary")

```
Expand reusable text snippets in any field using custom shortcuts. Organize into folders and sync your library with Notion.
```

---

## Full Description (paste into "Detailed description")

```
SprintBrain lets you store reusable text snippets and expand them instantly in any text field on any website — CRMs, email clients, booking platforms, WhatsApp Web, and more.

HOW IT WORKS
Type your custom trigger (default: ::) followed by a shortcut and press Tab. SprintBrain finds the matching snippet and inserts the full text in place, removing the trigger as it goes. No clicks, no copy-paste.

FEATURES
• Custom triggers — configure your own prefix (e.g. :: or ##) to avoid accidental expansions
• Multi-language snippets — store EN, IT, ES, and MULTI variants of the same snippet; a language picker appears automatically when multiple variants exist
• Dynamic fields — use {{placeholder}} syntax to collect values at insert time via a popup form
• Formula engine — embed {=round(price*1.21,2)} style expressions for automatic calculations
• Urgency timers — attach a countdown to time-sensitive snippets (quotes, offers) so the timer appears inline after insertion
• Folder organisation — group snippets into named folders accessible from the extension popup and right-click context menu
• Notion sync — connect your Notion database to import and sync your snippet library automatically every 5 minutes
• Works everywhere — content script runs on all sites at document_idle; inserts text into standard inputs, textareas, and rich-text editors (Lexical, ProseMirror, contentEditable)

SUPPORTED SITES (examples)
Gmail · Outlook · Airbnb · Booking.com · WhatsApp Web · Zendesk · Intercom · Salesforce · Any contentEditable field

PRIVACY
Snippets are stored locally in your browser (chrome.storage.local, up to 5 MB). They are also synced to your SprintBrain account via Supabase for cross-device access. Notion sync uses only the API key you provide — your Notion credentials never leave your browser except to reach api.notion.com directly. No snippet content is shared with third parties.

ACCOUNT REQUIRED
A free SprintBrain account (email + OTP) is required to save and sync snippets. Sign up at https://sprintbrain.com
```

---

## Permission Justifications
*(Paste verbatim into the "Permission justification" field in the Developer Dashboard)*

**storage**
SprintBrain stores your snippet library (up to 5 MB) in chrome.storage.local to keep expansions fast and available offline. Authentication tokens and user preferences are also persisted locally. A small set of cross-device settings (active trigger character, default language) use chrome.storage.sync.

**activeTab**
Required so that context menu clicks can identify the active tab and send the selected snippet to the correct page for insertion.

**contextMenus**
SprintBrain builds a dynamic right-click menu that mirrors your snippet library (organised by folder). Clicking a snippet from the context menu inserts it into the focused field on the current page.

**alarms**
A repeating alarm fires every 5 minutes to pull updates from your connected Notion database in the background. Without this permission the background service worker cannot schedule periodic tasks.

**Host permission: <all_urls>**
Snippet expansion must work in any text field on any website — CRMs, booking platforms, email clients, chat tools, and internal dashboards all use different origins. Restricting to a fixed list of domains would make the core feature non-functional for the majority of users. The content script runs only at document_idle, injects no UI unless the user types a configured trigger, and reads no page content.

**Host permission: https://eyowustlbqujaimaxggt.supabase.co/***
SprintBrain authenticates users and stores snippet data via a Supabase backend. All calls are authenticated with a JWT obtained via email OTP. The anon key embedded in the extension is a Supabase publishable key; access is enforced server-side via Row Level Security policies.

**Host permission: https://api.notion.com/***
Users who connect a Notion database can sync their snippet library. The extension calls the Notion API directly using the API key the user enters in the settings panel — the key is stored locally and never transmitted to SprintBrain servers.

---

## Category & Metadata

| Field | Value |
|---|---|
| Primary category | Productivity |
| Language | English |
| Support email | support@sprintbrain.com *(verify this address exists before submission)* |
| Homepage URL | https://sprintbrain.com |
| Privacy policy URL | https://sprintbrain.com/privacy *(add once page is live — required before submission)* |

---

## Required Screenshots (1280×800 or 640×400)

Minimum 1, recommended 3–5. Suggested shots:

1. **Trigger in action** — A text field mid-expansion showing the trigger being typed and the snippet appearing
2. **Popup — snippet list** — The extension popup open with a populated folder tree and snippet list
3. **Dynamic field modal** — The overlay form collecting placeholder values before insert
4. **Notion sync panel** — Settings panel showing a connected Notion database with last-sync timestamp
5. **Context menu** — Right-click menu on a webpage showing the snippet folder hierarchy

## Promotional Tile (440×280 — optional but recommended)

Tagline suggestion: **"Every text field. Every site. Zero copy-paste."**

---

## Single-Purpose Statement
*(If asked during review)*

SprintBrain has a single purpose: allowing users to store and instantly expand reusable text snippets in any text field on any website using a customisable keyboard trigger.
