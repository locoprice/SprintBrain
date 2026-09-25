import { useEffect, useMemo } from 'react';
import { HistoryPanel, type HistoryEntry } from '@/features/history/HistoryPanel';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import type { SnippetRevision } from '@/types/database';

// A snippet's version history.
//
// The panel itself is shared with prompts and memory items
// (features/history/HistoryPanel). This file is the snippet half: which
// revisions to load, how a revision row maps onto the shared shape, and what
// restoring means here. The diff, the compare selector and the confirm step
// live in the shared panel, so the three sections cannot drift apart.

function toEntry(revision: SnippetRevision): HistoryEntry {
  return {
    id: revision.id,
    versionNumber: revision.version_number,
    editorDisplay: revision.editor_display,
    createdAt: revision.created_at,
    body: revision.body,
    note: revision.edit_note,
  };
}

export function VersionHistoryPanel() {
  const historySnippetId = useUiStore((s) => s.historySnippetId);
  const closeHistory = useUiStore((s) => s.closeHistory);
  const showToast = useUiStore((s) => s.showToast);

  const snippets = useSnippetStore((s) => s.snippets);
  const revisions = useSnippetStore((s) => s.revisions);
  const revisionsLoading = useSnippetStore((s) => s.revisionsLoading);
  const revisionsSnippetId = useSnippetStore((s) => s.revisionsSnippetId);
  const loadRevisions = useSnippetStore((s) => s.loadRevisions);
  const restoreRevision = useSnippetStore((s) => s.restoreRevision);

  const snippet = historySnippetId
    ? (snippets.find((s) => s.id === historySnippetId) ?? null)
    : null;

  useEffect(() => {
    if (historySnippetId && historySnippetId !== revisionsSnippetId) {
      void loadRevisions(historySnippetId);
    }
  }, [historySnippetId, revisionsSnippetId, loadRevisions]);

  const entries = useMemo(() => revisions.map(toEntry), [revisions]);

  async function handleRestore(entry: HistoryEntry) {
    if (!historySnippetId) return;
    const revision = revisions.find((candidate) => candidate.id === entry.id);
    if (!revision) return;
    try {
      await restoreRevision(historySnippetId, revision);
      showToast(`Restored to v${revision.version_number} — saved as the latest version.`);
      closeHistory();
    } catch {
      showToast('Failed to restore revision.', 'error');
    }
  }

  return (
    <HistoryPanel
      open={historySnippetId !== null}
      subject={snippet?.name ?? null}
      noun="snippet"
      entries={entries}
      loading={revisionsLoading}
      onClose={closeHistory}
      onRestore={handleRestore}
    />
  );
}
