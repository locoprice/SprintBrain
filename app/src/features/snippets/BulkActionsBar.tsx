import { useState } from 'react';
import { FolderInput, Loader2, X } from 'lucide-react';
import { useSnippetStore } from '@/stores/snippetStore';
import { cn } from '@/lib/utils';

export function BulkActionsBar() {
  const selectedIds = useSnippetStore((s) => s.selectedIds);
  const clearSelection = useSnippetStore((s) => s.clearSelection);
  const bulkMoveSnippets = useSnippetStore((s) => s.bulkMoveSnippets);
  const bulkMoving = useSnippetStore((s) => s.bulkMoving);
  const folders = useSnippetStore((s) => s.folders);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const count = selectedIds.size;
  if (count === 0) return null;

  async function handleMove(folderId: string | null) {
    setShowFolderPicker(false);
    try {
      await bulkMoveSnippets([...selectedIds], folderId);
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
  }

  return (
    <div className="animate-fade-in relative flex items-center gap-3 rounded-[10px] border border-primary/20 bg-primary-light px-4 py-2.5 text-sm">
      <span className="font-semibold text-primary">
        {count} snippet{count === 1 ? '' : 's'} selected
      </span>

      <div className="ml-auto flex items-center gap-2">
        {/* Move to folder */}
        <div className="relative">
          <button
            type="button"
            disabled={bulkMoving}
            onClick={() => setShowFolderPicker((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 rounded-[8px] border border-primary px-3 py-1.5 text-xs font-medium text-primary transition-colors',
              bulkMoving
                ? 'cursor-not-allowed opacity-50'
                : 'hover:bg-primary hover:text-white',
            )}
          >
            {bulkMoving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FolderInput className="h-3.5 w-3.5" />
            )}
            Move to folder
          </button>

          {showFolderPicker && (
            <>
              {/* Transparent overlay to close picker on outside click */}
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowFolderPicker(false)}
              />
              <div className="absolute bottom-full left-0 z-20 mb-1.5 w-52 overflow-hidden rounded-[10px] border border-line bg-card shadow-md">
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

        {/* Clear selection */}
        <button
          type="button"
          onClick={clearSelection}
          className="flex items-center gap-1 rounded-[6px] px-2 py-1.5 text-xs text-ink-muted transition-colors hover:bg-primary/10 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
          Clear
        </button>
      </div>
    </div>
  );
}
