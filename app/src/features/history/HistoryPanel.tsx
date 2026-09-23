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
import { cn } from '@/lib/utils';
import { diffLines, hasDiff, toDisplayName } from '@/features/snippets/diffUtils';

// One version history panel for snippets, prompts and memory items.
//
// The three sections store their history in different tables and restore it in
// different ways, but a person reading it is asking the same three questions
// every time: what changed, who changed it, and can I have the old one back.
// So the panel is shared and each section hands it the same normalised list
// (see HistoryEntry) plus a restore action of its own. Before this existed the
// behaviour lived only in the snippet panel, and memory had been writing
// versions nobody could see.

/** One saved version, as every section describes it after mapping its own row. */
export interface HistoryEntry {
  id: string;
  /** 1-based, ascending with age. Shown as v3, v2, v1. */
  versionNumber: number;
  /** Who saved it, already resolved to a person rather than an id. */
  editorDisplay: string;
  createdAt: string;
  /** The text this version held, which is what the diff compares. */
  body: string;
  /** A note the save carried, if the section records one. */
  note: string | null;
}

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

interface EntryRowProps {
  entry: HistoryEntry;
  /** The whole list, newest first, so this row can offer a version to compare against. */
  entries: HistoryEntry[];
  ownIdx: number;
  isLatest: boolean;
  expanded: boolean;
  onToggle: () => void;
  onRestore: () => Promise<void>;
}

function EntryRow({ entry, entries, ownIdx, isLatest, expanded, onToggle, onRestore }: EntryRowProps) {
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);

  // Sentinel: entries.length means "compare against empty", the state before
  // the first version existed.
  const isOldest = ownIdx === entries.length - 1;
  const defaultCompare = isOldest ? entries.length : ownIdx + 1;
  const [compareToIdx, setCompareToIdx] = useState(defaultCompare);

  // Both latches reset on collapse, so reopening a row never shows a stale
  // comparison or a restore that is one click from happening.
  useEffect(() => {
    if (!expanded) {
      setConfirmRestore(false);
      setCompareToIdx(isOldest ? entries.length : ownIdx + 1);
    }
  }, [expanded, isOldest, ownIdx, entries.length]);

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
  const compareEntry = entries[compareToIdx];
  const compareBody = compareEntry?.body ?? '';
  const compareLabel = compareEntry ? `Changes from v${compareEntry.versionNumber}` : 'Initial content';
  const hasOlderVersions = ownIdx + 1 < entries.length;

  return (
    <div className="rounded-[10px] border border-line bg-card overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-alt/60 transition-colors"
      >
        <ChevronIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />

        <span
          className={cn(
            'shrink-0 inline-flex h-5 min-w-[28px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
            isLatest ? 'bg-primary text-white' : 'bg-bg-alt text-ink-muted',
          )}
        >
          v{entry.versionNumber}
        </span>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium text-ink">{toDisplayName(entry.editorDisplay)}</span>
          {entry.note && (
            <span className="ml-2 text-xs text-ink-subtle italic truncate">"{entry.note}"</span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isLatest && (
            <span className="text-[10px] font-semibold text-primary bg-primary-light rounded-full px-2 py-0.5">
              Current
            </span>
          )}
          <span className="text-xs text-ink-subtle">
            {formatDistanceToNow(new Date(entry.createdAt), { addSuffix: true })}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 flex flex-col gap-3 border-t border-line pt-3">
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
                    {entries.slice(ownIdx + 1).map((older, relIdx) => (
                      <option key={older.id} value={ownIdx + 1 + relIdx}>
                        v{older.versionNumber}
                      </option>
                    ))}
                    <option value={entries.length}>Initial (empty)</option>
                  </select>
                </div>
              )}
            </div>
            <DiffViewer before={compareBody} after={entry.body} />
          </div>

          {/* The current version is already what is saved, so it has nothing to restore to. */}
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
                {confirmRestore ? 'Confirm restore' : `Restore v${entry.versionNumber}`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface HistoryPanelProps {
  open: boolean;
  /** The thing being looked at, shown beside the title. */
  subject: string | null;
  /** The word for what this is a history of: snippet, prompt, item. */
  noun: string;
  entries: HistoryEntry[];
  loading: boolean;
  onClose: () => void;
  /** Restoring writes a NEW version rather than rewriting history. */
  onRestore: (entry: HistoryEntry) => Promise<void>;
}

export function HistoryPanel({
  open,
  subject,
  noun,
  entries,
  loading,
  onClose,
  onRestore,
}: HistoryPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // A fresh open starts collapsed, then opens the newest version once the list
  // arrives: that is the one a person is almost always looking for.
  useEffect(() => {
    if (!open) setExpandedId(null);
  }, [open]);

  useEffect(() => {
    const first = entries[0];
    if (open && first && expandedId === null) setExpandedId(first.id);
  }, [open, entries, expandedId]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[640px] p-0 gap-0 flex flex-col max-h-[80vh]">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-line pr-14">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-ink-muted shrink-0" />
            <DialogTitle className="truncate">
              Version History
              {subject && <span className="ml-1.5 font-normal text-ink-muted">— {subject}</span>}
            </DialogTitle>
          </div>
          <DialogDescription>
            Every save creates a new version. Click a version to see what changed, or restore it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2.5 min-h-0">
          {loading && (
            <div className="flex items-center justify-center py-12 text-ink-subtle">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Clock className="h-8 w-8 text-line" />
              <p className="text-sm font-medium text-ink">No versions yet</p>
              <p className="text-xs text-ink-subtle max-w-[280px]">
                The next time you save this {noun}, a version will be recorded here.
              </p>
            </div>
          )}

          {!loading &&
            entries.map((entry, idx) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                entries={entries}
                ownIdx={idx}
                isLatest={idx === 0}
                expanded={expandedId === entry.id}
                onToggle={() => setExpandedId((prev) => (prev === entry.id ? null : entry.id))}
                onRestore={() => onRestore(entry)}
              />
            ))}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-line flex items-center justify-between">
          <span className="text-xs text-ink-subtle">
            {entries.length > 0
              ? `${entries.length} version${entries.length === 1 ? '' : 's'}`
              : ''}
          </span>
          <Button variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
