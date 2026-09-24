import { useEffect, useState, type ReactNode } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// One trash panel for Brains: the trash inside a Brain and the trash of Brains
// themselves. Same shell as the History panel.
//
// It only draws. Each page hands it rows already worded for that trash, plus
// what restoring and deleting mean there, so the two trashes cannot drift
// apart in how they look or how they ask.
//
// Everything that ends in a permanent delete confirms in place rather than in a
// second dialog stacked on this one: the button asks once more, and the footer
// turns into the question when the whole trash is about to go.

/** One thing in the trash, as the panel shows it. */
export interface TrashPanelRow {
  id: string;
  name: string;
  /** Drawn in the row's icon well. */
  icon: ReactNode;
  /** The short tag under the name: File, Fact, Brain. */
  tag: string;
  /** Anything else worth a glance, such as "3 pieces" or "12 items". */
  detail?: string;
  deletedAt: string;
}

interface TrashPanelProps {
  open: boolean;
  /** Whose trash this is, shown after the title. */
  subject: string;
  /** What being in this trash means. */
  description: string;
  /** What the empty trash says will wait in it. */
  emptyHint: string;
  rows: TrashPanelRow[];
  /** What emptying would delete, as "1 file and 2 items". */
  summary: string;
  onClose: () => void;
  /** Takes effect at once; a refusal puts the row back and is reported by the page. */
  onRestore: (id: string) => void;
  /** Settles once the row is gone or the page has reported why it is not. */
  onDelete: (id: string) => Promise<void>;
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
  row: TrashPanelRow;
  armed: boolean;
  pending: boolean;
  locked: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[10px] border border-line bg-card px-4 py-3',
        pending && 'opacity-60',
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-bg-alt text-ink-muted">
        {row.icon}
      </div>

      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-ink">{row.name}</div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-subtle">
          <span className="rounded-full bg-bg-alt px-2 py-0.5 font-medium">{row.tag}</span>
          {row.detail ? <span className="tabular-nums">{row.detail}</span> : null}
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
  subject,
  description,
  emptyHint,
  rows,
  summary,
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

  async function handleDelete(id: string) {
    if (armedId !== id) {
      setArmedId(id);
      setConfirmEmpty(false);
      return;
    }
    setArmedId(null);
    setPendingId(id);
    try {
      await onDelete(id);
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
              <span className="ml-1.5 font-normal text-ink-muted">· {subject}</span>
            </DialogTitle>
          </div>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-2.5 min-h-0">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
              <Trash2 className="h-8 w-8 text-line" />
              <p className="text-sm font-medium text-ink">The trash is empty</p>
              <p className="text-xs text-ink-subtle max-w-[280px]">{emptyHint}</p>
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
                  onRestore(row.id);
                }}
                onDelete={() => void handleDelete(row.id)}
              />
            ))
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-line flex items-center justify-between gap-4">
          {confirmEmpty ? (
            <>
              <span className="text-xs font-medium text-danger">
                Delete {summary} permanently? This can't be undone.
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
