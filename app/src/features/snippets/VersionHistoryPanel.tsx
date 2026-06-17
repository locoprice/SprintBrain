import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight, Clock, Loader2, RotateCcw, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import type { SnippetRevision } from '@/types/database';
import { cn } from '@/lib/utils';
import { diffLines, hasDiff, toDisplayName } from '@/features/snippets/diffUtils';

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface DiffViewerProps {
  before: string;
  after: string;
}

function DiffViewer({ before, after }: DiffViewerProps) {
  const lines = diffLines(before, after);

  if (!hasDiff(lines)) {
    return (
      <p className="py-3 text-xs text-ink-subtle italic">No content changes in this version.</p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[8px] border border-line bg-bg text-xs font-mono">
      {lines.map((line, idx) => (
        <div
          key={idx}
          className={cn(
            'flex gap-2 px-3 py-0.5 leading-relaxed whitespace-pre-wrap break-all',
            line.type === 'added' && 'bg-success/8 text-[#15803D]',
            line.type === 'removed' && 'bg-danger/8 text-danger line-through opacity-70',
            line.type === 'context' && 'text-ink-subtle',
          )}
        >
          <span className="shrink-0 select-none w-3 opacity-60">
            {line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '}
          </span>
          <span className="flex-1">{line.text || ' '}</span>
        </div>
      ))}
    </div>
  );
}

interface RevisionItemProps {
  revision: SnippetRevision;
  /** Full revision list sorted newest-first — used to populate the compare selector. */
  allRevisions: SnippetRevision[];
  /** Index of this revision inside allRevisions. */
  ownIdx: number;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRestore: () => Promise<void>;
}

function RevisionItem({
  revision,
  allRevisions,
  ownIdx,
  isLatest,
  expanded,
  onToggle,
  onRestore,
}: RevisionItemProps) {
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Sentinel: allRevisions.length means "compare to empty (initial state)".
  const isOldest = ownIdx === allRevisions.length - 1;
  const defaultCompare = isOldest ? allRevisions.length : ownIdx + 1;
  const [compareToIdx, setCompareToIdx] = useState(defaultCompare);

  // Reset both latches when the item collapses so it reopens with defaults.
  useEffect(() => {
    if (!expanded) {
      setConfirmRestore(false);
      setCompareToIdx(isOldest ? allRevisions.length : ownIdx + 1);
    }
  }, [expanded, isOldest, ownIdx, allRevisions.length]);

  async function handleRestore() {
    if (!confirmRestore) {
      setConfirmRestore(true);
      return;
    }
    setRestoring(true);
    try {
      await onRestore();
    } finally {
      setRestoring(false);
      setConfirmRestore(false);
    }
  }

  const ChevronIcon = expanded ? ChevronDown : ChevronRight;

  // compareToIdx === allRevisions.length → compare against empty string.
  const compareRevision = allRevisions[compareToIdx];
  const compareBody = compareRevision?.body ?? '';
  const compareLabel = compareRevision
    ? `Changes from v${compareRevision.version_number}`
    : 'Initial content';

  // Only show the "vs" selector when there are older versions to pick from.
  const hasOlderVersions = ownIdx + 1 < allRevisions.length;

  return (
    <div className="rounded-[10px] border border-line bg-card overflow-hidden">
      {/* Row header */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-alt/60 transition-colors"
      >
        <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />

        {/* Version badge */}
        <span
          className={cn(
            'shrink-0 inline-flex h-5 min-w-[28px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
            isLatest
              ? 'bg-primary text-white'
              : 'bg-bg-alt text-ink-muted',
          )}
        >
          v{revision.version_number}
        </span>

        {/* Editor + time */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-ink">
            {toDisplayName(revision.editor_display)}
          </span>
          {revision.edit_note && (
            <span className="ml-2 text-xs text-ink-subtle italic truncate">
              "{revision.edit_note}"
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLatest && (
            <span className="text-[10px] font-semibold text-primary bg-primary-light rounded-full px-2 py-0.5">
              Current
            </span>
          )}
          <span className="text-xs text-ink-subtle">
            {formatDistanceToNow(new Date(revision.created_at), { addSuffix: true })}
          </span>
        </div>
      </button>

      {/* Expanded: diff + restore */}
      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-line pt-3">
          {/* Diff header + optional "compare to" selector */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-subtle">
                {compareLabel}
              </p>
              {hasOlderVersions && (
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] text-ink-subtle">vs</span>
                  <select
                    value={compareToIdx}
                    onChange={(e) => setCompareToIdx(Number(e.target.value))}
                    className="h-6 rounded-[6px] border border-line bg-card px-2 text-[11px] text-ink focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
                  >
                    {allRevisions.slice(ownIdx + 1).map((rev, relIdx) => (
                      <option key={rev.id} value={ownIdx + 1 + relIdx}>
                        v{rev.version_number}
                      </option>
                    ))}
                    <option value={allRevisions.length}>Initial (empty)</option>
                  </select>
                </div>
              )}
            </div>
            <DiffViewer before={compareBody} after={revision.body} />
          </div>

          {/* Restore button — hidden for the current (latest) version */}
          {!isLatest && (
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={() => void handleRestore()}
                disabled={restoring}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-xs font-medium transition-colors disabled:opacity-50',
                  confirmRestore
                    ? 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/20'
                    : 'border-line bg-bg text-ink-muted hover:bg-primary-light hover:text-primary hover:border-primary/30',
                )}
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                {confirmRestore ? 'Confirm restore' : `Restore v${revision.version_number}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main panel
// ─────────────────────────────────────────────────────────────────────────────

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

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Load revisions whenever the panel opens for a new snippet.
  useEffect(() => {
    if (historySnippetId && historySnippetId !== revisionsSnippetId) {
      void loadRevisions(historySnippetId);
      setExpandedId(null);
    }
  }, [historySnippetId, revisionsSnippetId, loadRevisions]);

  // Auto-expand the latest revision when data first loads.
  useEffect(() => {
    const first = revisions[0];
    if (first && expandedId === null) {
      setExpandedId(first.id);
    }
  }, [revisions, expandedId]);

  function handleOpenChange(open: boolean) {
    if (!open) closeHistory();
  }

  async function handleRestore(revision: SnippetRevision) {
    if (!historySnippetId) return;
    try {
      await restoreRevision(historySnippetId, revision);
      showToast(`Restored to v${revision.version_number} — saved as the latest version.`);
      closeHistory();
    } catch {
      showToast('Failed to restore revision.', 'error');
    }
  }

  return (
    <Dialog open={historySnippetId !== null} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[640px] p-0 gap-0 flex flex-col max-h-[80vh]">

        {/* Header */}
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-line pr-14">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-ink-muted shrink-0" />
            <DialogTitle className="truncate">
              Version History
              {snippet && (
                <span className="ml-1.5 font-normal text-ink-muted">— {snippet.name}</span>
              )}
            </DialogTitle>
          </div>
          <DialogDescription>
            Every save creates a new version. Click a version to see what changed, or restore it.
          </DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2.5 min-h-0">
          {revisionsLoading && (
            <div className="flex items-center justify-center py-12 text-ink-subtle">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!revisionsLoading && revisions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Clock className="h-8 w-8 text-line" />
              <p className="text-sm font-medium text-ink">No versions yet</p>
              <p className="text-xs text-ink-subtle max-w-[280px]">
                The next time you save this snippet, a version will be recorded here.
              </p>
            </div>
          )}

          {!revisionsLoading &&
            revisions.map((rev, idx) => (
              <RevisionItem
                key={rev.id}
                revision={rev}
                allRevisions={revisions}
                ownIdx={idx}
                isLatest={idx === 0}
                expanded={expandedId === rev.id}
                onToggle={() => setExpandedId((prev) => (prev === rev.id ? null : rev.id))}
                onRestore={() => handleRestore(rev)}
              />
            ))}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-line flex items-center justify-between">
          <span className="text-xs text-ink-subtle">
            {revisions.length > 0
              ? `${revisions.length} version${revisions.length === 1 ? '' : 's'}`
              : ''}
          </span>
          <Button variant="ghost" onClick={closeHistory}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>

      </DialogContent>
    </Dialog>
  );
}
