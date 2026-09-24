import { useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { FileText, FileUp, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { KIND_LABEL } from '@/features/memory/kindLabel';
import { describePieces, describeTrashRows, type TrashRow } from '@/features/memory/trashRows';

// A Brain's trash, in a panel over the page (same shell as the History panel).
//
// Everything that ends in a permanent delete confirms in place rather than in a
// second dialog stacked on this one: the button asks once more, and the footer
// turns into the question when the whole trash is about to go.

interface TrashPanelProps {
  open: boolean;
  spaceName: string;
  rows: TrashRow[];
  onClose: () => void;
  /** Takes effect at once; a refusal puts the row back and is reported by the page. */
  onRestore: (row: TrashRow) => void;
  /** Settles once the row is gone or the page has reported why it is not. */
  onDelete: (row: TrashRow) => Promise<void>;
  /** Same contract as `onDelete`, for every row at once. */
  onEmpty: () => Promise<void>;
}

const ACTION_BUTTON =
  'inline-flex h-8 items-center gap-1.5 rounded-[8px] border px-3 text-xs font-medium transition-colors disabled:opacity-50';

function TrashRowView({
  row,
  armed,
  pending,
  locked,
  onRestore,
  onDelete,
}: {
  row: TrashRow;
  armed: boolean;
  pending: boolean;
  locked: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const Icon = row.kind === 'file' ? FileUp : FileText;
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[10px] border border-line bg-card px-4 py-3',
        pending && 'opacity-60',
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-bg-alt text-ink-muted">
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{row.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-subtle">
          <span className="rounded-full bg-bg-alt px-2 py-0.5 font-medium">
            {row.kind === 'file' ? 'File' : KIND_LABEL[row.item.kind]}
          </span>
          {row.kind === 'file' && row.pieces > 0 ? (
            <span className="tabular-nums">{describePieces(row.pieces)}</span>
          ) : null}
          <span>Deleted {formatDistanceToNow(new Date(row.deletedAt), { addSuffix: true })}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={onRestore}
          disabled={locked}
          className={cn(
            ACTION_BUTTON,
            'border-line bg-bg text-ink-muted hover:border-primary/30 hover:bg-primary-light hover:text-primary',
          )}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore
        </button>
        <button
          type="button"
          onClick={onDelete}
          disabled={locked}
          className={cn(
            ACTION_BUTTON,
            armed
              ? 'border-danger bg-danger text-white hover:bg-danger/90'
              : 'border-line bg-bg text-ink-muted hover:border-danger/30 hover:bg-danger-bg hover:text-danger',
          )}
        >
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {pending ? 'Deleting…' : armed ? 'Click again to confirm' : 'Delete'}
        </button>
      </div>
    </div>
  );
}

export function TrashPanel({
  open,
  spaceName,
  rows,
  onClose,
  onRestore,
  onDelete,
  onEmpty,
}: TrashPanelProps) {
  // One latch for the whole panel, so only one permanent delete is ever a
  // single click away.
  const [armedId, setArmedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [emptying, setEmptying] = useState(false);
  const busy = emptying || pendingId !== null;

  // A fresh open never starts with a delete already armed.
  useEffect(() => {
    if (!open) {
      setArmedId(null);
      setConfirmEmpty(false);
    }
  }, [open]);

  async function handleDelete(row: TrashRow) {
    if (armedId !== row.id) {
      setArmedId(row.id);
      setConfirmEmpty(false);
      return;
    }
    setArmedId(null);
    setPendingId(row.id);
    try {
      await onDelete(row);
    } finally {
      setPendingId(null);
    }
  }

  async function handleEmpty() {
    setEmptying(true);
    try {
      await onEmpty();
    } finally {
      setEmptying(false);
      setConfirmEmpty(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="max-w-[640px] p-0 gap-0 flex flex-col max-h-[80vh]">
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b border-line pr-14">
          <div className="flex items-center gap-2">
            <Trash2 className="h-4 w-4 text-ink-muted shrink-0" />
            <DialogTitle className="truncate">
              Trash
              <span className="ml-1.5 font-normal text-ink-muted">· {spaceName}</span>
            </DialogTitle>
          </div>
          <DialogDescription>
            Hidden from your assistant. Everything here stays stored until you delete it or
            empty the trash.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2.5 min-h-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Trash2 className="h-8 w-8 text-line" />
              <p className="text-sm font-medium text-ink">The trash is empty</p>
              <p className="text-xs text-ink-subtle max-w-[280px]">
                Anything you delete from this Brain waits here until you empty the trash.
              </p>
            </div>
          ) : (
            rows.map((row) => (
              <TrashRowView
                key={row.id}
                row={row}
                armed={armedId === row.id}
                pending={pendingId === row.id || emptying}
                locked={busy}
                onRestore={() => {
                  setArmedId(null);
                  onRestore(row);
                }}
                onDelete={() => void handleDelete(row)}
              />
            ))
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-line flex items-center justify-between gap-4">
          {confirmEmpty ? (
            <>
              <span className="text-xs font-medium text-danger">
                Delete {describeTrashRows(rows)} permanently? This can't be undone.
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="ghost" disabled={emptying} onClick={() => setConfirmEmpty(false)}>
                  Cancel
                </Button>
                <Button
                  className="bg-danger text-white hover:bg-danger/90"
                  disabled={emptying}
                  onClick={() => void handleEmpty()}
                >
                  {emptying ? 'Deleting…' : 'Delete permanently'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="text-xs text-ink-subtle">
                {rows.length > 0 ? `${rows.length} in the trash` : ''}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {rows.length > 0 ? (
                  <Button
                    variant="ghost"
                    className="border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/5"
                    disabled={busy}
                    onClick={() => {
                      setArmedId(null);
                      setConfirmEmpty(true);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Empty trash
                  </Button>
                ) : null}
                <Button variant="ghost" disabled={busy} onClick={onClose}>
                  <X className="h-4 w-4" />
                  Close
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
