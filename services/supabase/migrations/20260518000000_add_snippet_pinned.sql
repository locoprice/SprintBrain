-- SNIPPET-PIN-001: Persistent pin-to-top flag for snippets.
-- Pin state was previously held in memory only inside the Chrome extension popup
-- and was lost on every reload. This column lets the pin survive across sessions
-- and across surfaces once Dashboard + Mobile gain a Pin UI.

ALTER TABLE snippets
  ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
