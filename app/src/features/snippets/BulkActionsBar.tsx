import { useState } from 'react';
import { ChevronDown, FolderInput, Loader2, Trash2, X } from 'lucide-react';
import { useSnippetStore } from '@/stores/snippetStore';
import { cn } from '@/lib/utils';

type BulkAction = '' | 'move' | 'delete';

const ACTION_LABELS: Record<BulkAction, string> = {
  '': 'Choose action…',
  move: 'Move to folder',
  delete: 'Delete selected',
};

export function BulkActionsBar() {
  const selectedIds = useSnippetStore((s) => s.selectedIds);
  const clearSelection = useSnippetStore((s) => s.clearSelection);
  const bulkMoveSnippets = useSnippetStore((s) => s.bulkMoveSnippets);
  const bulkDeleteSnippets = useSnippetStore((s) => s.bulkDeleteSnippets);
  const bulkMoving = useSnippetStore((s) => s.bulkMoving);
  const bulkDeleting = useSnippetStore((s) => s.bulkDeleting);
  const folders = useSnippetStore((s) => s.folders);

  const [actionDraft, setActionDraft] = useState<BulkAction>('');
  const [showActionDropdown, setShowActionDropdown] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  const isBusy = bulkMoving || bulkDeleting;

  function handleApply() {
    if (actionDraft === 'move') {
      setShowFolderPicker(true);
    } else if (actionDraft === 'delete') {
      setConfirmDelete(true);
    }
  }

  async function handleMove(folderId: string | null) {
    setShowFolderPicker(false);
    try {
      await bulkMoveSnippets([...selectedIds], folderId);
      setActionDraft('');
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
  }

  async function handleConfirmDelete() {
    setConfirmDelete(false);
    try {
      await bulkDeleteSnippets([...selectedIds]);
      setActionDraft('');
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
  }

  return (
    <div className="animate-fade-in flex flex-wrap items-center gap-2 rounded-[10px] border border-primary/20 bg-primary-light px-4 py-2.5 text-sm">

      {/* Selection count */}
      <span className="min-w-max font-semibold text-primary">
        {count} snippet{count === 1 ? '' : 's'} selected
      </span>

      <div className="h-4 w-px bg-primary/20" />

      {/* Action dropdown */}
      <div className="relative">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => { setShowFolderPicker(false); setConfirmDelete(false); setShowActionDropdown((v) => !v); }}
          className={cn(
            'flex items-center gap-1.5 rounded-[8px] border border-primary/30 bg-white px-3 py-1.5 text-xs font-medium text-ink transition-colors',
            isBusy ? 'cursor-not-allowed opacity-50' : 'hover:border-primary hover:text-primary',
          )}
        >
          {ACTION_LABELS[actionDraft]}
          <ChevronDown className="h-3.5 w-3.5 text-ink-subtle" />
        </button>

        {showActionDropdown && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowActionDropdown(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-[10px] border border-line bg-card shadow-md">
              <button
                type="button"
                onClick={() => { setActionDraft('move'); setShowActionDropdown(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-ink hover:bg-bg-alt"
              >
                <FolderInput className="h-3.5 w-3.5 text-primary" />
                Move to folder
              </button>
              <div className="border-t border-line" />
              <button
                type="button"
                onClick={() => { setActionDraft('delete'); setShowActionDropdown(false); }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-danger hover:bg-danger/5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete selected
              </button>
            </div>
          </>
        )}
      </div>

      {/* Apply button + folder picker anchor */}
      <div className="relative">
        <button
          type="button"
          disabled={actionDraft === '' || isBusy}
          onClick={handleApply}
          className={cn(
            'flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-semibold transition-colors',
            actionDraft === 'delete'
              ? 'bg-danger text-white hover:bg-danger/80'
              : 'bg-primary text-white hover:bg-primary-dark',
            (actionDraft === '' || isBusy) && 'cursor-not-allowed opacity-40',
          )}
        >
          {isBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Apply to {count} selected
        </button>

        {/* Folder picker popover — anchored below the Apply button */}
        {showFolderPicker && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowFolderPicker(false)} />
            <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-[10px] border border-line bg-card shadow-md">
              <button
                type="button"
                onClick={() => void handleMove(null)}
                className="w-full px-3 py-2 text-left text-xs text-ink-muted hover:bg-bg-alt"
              >
                No folder (remove from folder)
              </button>
              {folders.length > 0 && <div className="border-t border-line" />}
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => void handleMove(f.id)}
                  className="w-full px-3 py-2 text-left text-xs text-ink hover:bg-bg-alt"
                >
                  <span className="mr-1.5">{f.icon}</span>
                  {f.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Inline delete confirmation */}
      {confirmDelete && (
        <>
          <div className="h-4 w-px bg-primary/20" />
          <div className="flex items-center gap-2 rounded-[8px] border border-danger/30 bg-danger/5 px-3 py-1.5">
            <span className="text-xs font-medium text-danger">
              Delete {count} snippet{count === 1 ? '' : 's'}?
            </span>
            <button
              type="button"
              onClick={() => void handleConfirmDelete()}
              className="rounded-[6px] bg-danger px-2 py-1 text-[11px] font-semibold text-white hover:bg-danger/80"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(false)}
              className="rounded-[6px] px-2 py-1 text-[11px] text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </>
      )}

      {/* Clear selection */}
      <button
        type="button"
        onClick={() => { clearSelection(); setActionDraft(''); setConfirmDelete(false); setShowFolderPicker(false); }}
        className="ml-auto flex items-center gap-1 rounded-[6px] px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-primary/10 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" />
        Clear
      </button>
    </div>
  );
}
