import { Folders, Pencil, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { FolderDialog } from '@/features/snippets/FolderDialog';

export function SnippetFolderTree() {
  const folders = useSnippetStore((s) => s.folders);
  const snippets = useSnippetStore((s) => s.snippets);
  const selected = useSnippetStore((s) => s.selectedFolderId);
  const setSelected = useSnippetStore((s) => s.setSelectedFolder);
  const openFolderDialog = useUiStore((s) => s.openFolderDialog);

  const counts = new Map<string, number>();
  for (const s of snippets) {
    if (s.folder_id) counts.set(s.folder_id, (counts.get(s.folder_id) ?? 0) + 1);
  }

  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-1">
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Folders
        </span>
        <button
          type="button"
          onClick={() => openFolderDialog('new')}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-bg-alt hover:text-ink"
          aria-label="New folder"
          title="New folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setSelected(null)}
        className={cn(
          'flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-colors',
          selected === null
            ? 'bg-primary-light text-primary'
            : 'text-ink-muted hover:bg-bg-alt hover:text-ink',
        )}
      >
        <span className="flex items-center gap-2">
          <Folders className="h-4 w-4" />
          All snippets
        </span>
        <span className="text-xs text-ink-subtle">{snippets.length}</span>
      </button>

      <div className="my-2 h-px bg-line" />

      {folders.map((f) => {
        const isActive = selected === f.id;
        const count = counts.get(f.id) ?? 0;
        return (
          <div
            key={f.id}
            className={cn(
              'group relative flex items-center rounded-[10px] transition-colors',
              isActive ? 'bg-primary-light' : 'hover:bg-bg-alt',
            )}
          >
            <button
              type="button"
              onClick={() => setSelected(f.id)}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm font-medium transition-colors',
                isActive ? 'text-primary' : 'text-ink-muted group-hover:text-ink',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="text-base leading-none">{f.icon}</span>
                <span className="truncate">{f.name}</span>
              </span>
              <span className="ml-2 shrink-0 text-xs text-ink-subtle">{count}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openFolderDialog(f.id);
              }}
              aria-label={`Edit ${f.name}`}
              title={`Edit ${f.name}`}
              className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-subtle opacity-0 transition-opacity hover:bg-card hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      <FolderDialog />
    </aside>
  );
}
