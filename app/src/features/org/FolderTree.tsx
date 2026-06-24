import { useState } from 'react';
import { Folders, Globe, Pencil, Plus, Share2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FolderIcon } from '@/lib/folderIcons';
import type { Folder, FolderShareInfo } from '@/types/database';
import type { FolderFormValues } from '@/types/schemas';
import { FolderContextMenu } from '@/features/org/FolderContextMenu';
import { FolderDialog, type FolderDialogTarget } from '@/features/org/FolderDialog';
import { FolderShareModal } from '@/features/org/FolderShareModal';

export interface FolderTreeProps {
  folders: Folder[];
  folderShares: Map<string, FolderShareInfo>;
  selectedFolderId: string | null;
  onSelect: (id: string | null) => void;
  /** folderId → item count (snippets or prompts in that folder). */
  itemCounts: Map<string, number>;
  /** Count shown next to the "All" row. */
  totalCount: number;
  /** Label for the "All" row, e.g. "All snippets" / "All prompts". */
  allLabel: string;
  /** Singular noun used in dialog copy, e.g. "snippet" / "prompt". */
  itemNoun: string;
  addFolder: (payload: FolderFormValues) => Promise<Folder>;
  editFolder: (id: string, patch: Partial<FolderFormValues>) => Promise<Folder>;
  removeFolder: (id: string) => Promise<void>;
  /** Called after a share grant changes so the host can refresh shared items. */
  onShared: () => void | Promise<void>;
  /** Extra classes for the <aside> wrapper (width / surface). */
  className?: string;
}

interface MenuState {
  folderId: string;
  x: number;
  y: number;
}

/**
 * Folder rail shared by the Snippets and Prompts pages. Store-agnostic: the host
 * adapter passes the folder list, counts, and the CRUD actions for its store.
 * Folders are a generic container — the same folder can hold snippets + prompts.
 */
export function FolderTree({
  folders,
  folderShares,
  selectedFolderId,
  onSelect,
  itemCounts,
  totalCount,
  allLabel,
  itemNoun,
  addFolder,
  editFolder,
  removeFolder,
  onShared,
  className,
}: FolderTreeProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [shareFolder, setShareFolder] = useState<Folder | null>(null);
  const [dialogTarget, setDialogTarget] = useState<FolderDialogTarget>(null);

  const activeMenuFolder =
    menu !== null ? folders.find((f) => f.id === menu.folderId) ?? null : null;

  return (
    <aside className={cn('flex shrink-0 flex-col gap-1', className ?? 'w-[240px]')}>
      <div className="flex items-center justify-between px-3 pb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Folders
        </span>
        <button
          type="button"
          onClick={() => setDialogTarget('new')}
          className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-bg-alt hover:text-ink"
          aria-label="New folder"
          title="New folder"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex items-center justify-between rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-colors',
          selectedFolderId === null
            ? 'bg-primary-light text-primary'
            : 'text-ink-muted hover:bg-bg-alt hover:text-ink',
        )}
      >
        <span className="flex items-center gap-2">
          <Folders className="h-4 w-4" />
          {allLabel}
        </span>
        <span className="text-xs text-ink-subtle">{totalCount}</span>
      </button>

      <div className="my-2 h-px bg-line" />

      {folders.map((f) => {
        const isActive = selectedFolderId === f.id;
        const count = itemCounts.get(f.id) ?? 0;
        const share = folderShares.get(f.id) ?? null;
        return (
          <div
            key={f.id}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ folderId: f.id, x: e.clientX, y: e.clientY });
            }}
            className={cn(
              'group relative flex items-center rounded-[10px] transition-colors',
              isActive ? 'bg-primary-light' : 'hover:bg-bg-alt',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              className={cn(
                'flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-left text-sm font-medium transition-colors',
                isActive ? 'text-primary' : 'text-ink-muted group-hover:text-ink',
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <FolderIcon icon={f.icon} />
                <span className="truncate">{f.name}</span>
                {share && <FolderShareBadge info={share} />}
              </span>
              <span className="ml-2 shrink-0 text-xs text-ink-subtle">{count}</span>
            </button>
            <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 bg-inherit opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShareFolder(f);
                }}
                aria-label={`Share ${f.name} with team`}
                title={`Share ${f.name} with team`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-card hover:text-primary"
              >
                <Share2 className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDialogTarget(f.id);
                }}
                aria-label={`Edit ${f.name}`}
                title={`Edit ${f.name}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-card hover:text-ink"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}

      <FolderDialog
        target={dialogTarget}
        onClose={() => setDialogTarget(null)}
        folders={folders}
        addFolder={addFolder}
        editFolder={editFolder}
        removeFolder={removeFolder}
        countFor={(id) => itemCounts.get(id) ?? 0}
        itemNoun={itemNoun}
        allLabel={allLabel}
      />

      {menu !== null && activeMenuFolder !== null && (
        <FolderContextMenu
          folder={activeMenuFolder}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onShare={(f) => setShareFolder(f)}
          onEdit={(f) => setDialogTarget(f.id)}
          onDelete={removeFolder}
        />
      )}

      <FolderShareModal
        folder={shareFolder}
        onClose={() => setShareFolder(null)}
        onShared={onShared}
      />
    </aside>
  );
}

/**
 * At-a-glance sharing indicator next to a folder name (Drive-style):
 *   - team   → azure globe, "available to everyone on the team"
 *   - shared → muted people icon, "shared with N specific teammates"
 * Private folders render no badge. Tooltip carries the detail on hover.
 */
function FolderShareBadge({ info }: { info: FolderShareInfo }) {
  if (info.scope === 'team') {
    return (
      <span
        title="Available to all team members"
        aria-label="Shared with the whole team"
        className="shrink-0 text-primary"
      >
        <Globe className="h-3.5 w-3.5" />
      </span>
    );
  }
  const label =
    info.memberCount === 1
      ? 'Shared with 1 teammate'
      : `Shared with ${info.memberCount} teammates`;
  return (
    <span title={label} aria-label={label} className="shrink-0 text-ink-subtle">
      <Users className="h-3.5 w-3.5" />
    </span>
  );
}
