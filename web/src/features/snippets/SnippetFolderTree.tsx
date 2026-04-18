import { Folders } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSnippetStore } from '@/stores/snippetStore';

export function SnippetFolderTree() {
  const folders = useSnippetStore((s) => s.folders);
  const snippets = useSnippetStore((s) => s.snippets);
  const selected = useSnippetStore((s) => s.selectedFolderId);
  const setSelected = useSnippetStore((s) => s.setSelectedFolder);

  const counts = new Map<string, number>();
  for (const s of snippets) {
    if (s.folder_id) counts.set(s.folder_id, (counts.get(s.folder_id) ?? 0) + 1);
  }

  return (
    <aside className="flex w-[240px] shrink-0 flex-col gap-1">
      <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
        Folders
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
          <button
            key={f.id}
            type="button"
            onClick={() => setSelected(f.id)}
            className={cn(
              'flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary-light text-primary'
                : 'text-ink-muted hover:bg-bg-alt hover:text-ink',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="text-base leading-none">{f.icon}</span>
              {f.name}
            </span>
            <span className="text-xs text-ink-subtle">{count}</span>
          </button>
        );
      })}
    </aside>
  );
}
