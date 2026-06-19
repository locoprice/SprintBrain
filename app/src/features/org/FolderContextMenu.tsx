import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { Pencil, Share2, Smile, Trash2 } from 'lucide-react';
import type { Folder } from '@/types/database';
import { cn } from '@/lib/utils';

interface FolderContextMenuProps {
  folder: Folder;
  x: number;
  y: number;
  onClose: () => void;
  /** Open the folder-sharing modal for this folder. */
  onShare: (folder: Folder) => void;
  /** Open the rename / change-icon dialog for this folder. */
  onEdit: (folder: Folder) => void;
  /** Delete this folder (its items drop back to "no folder"). */
  onDelete: (id: string) => Promise<void>;
}

const MIN_WIDTH = 224;
const VIEWPORT_PADDING = 8;

export function FolderContextMenu({
  folder,
  x,
  y,
  onClose,
  onShare,
  onEdit,
  onDelete,
}: FolderContextMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);

  // Position the menu within the viewport, flipping if needed.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let nextX = x;
    let nextY = y;
    if (nextX + rect.width + VIEWPORT_PADDING > window.innerWidth) {
      nextX = Math.max(VIEWPORT_PADDING, window.innerWidth - rect.width - VIEWPORT_PADDING);
    }
    if (nextY + rect.height + VIEWPORT_PADDING > window.innerHeight) {
      nextY = Math.max(VIEWPORT_PADDING, window.innerHeight - rect.height - VIEWPORT_PADDING);
    }
    if (nextX !== x || nextY !== y) setPos({ x: nextX, y: nextY });
  }, [x, y]);

  // Close on outside click + Escape.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // pointerdown on capture so we close before any synthetic onClick fires
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function handleEdit() {
    onEdit(folder);
    onClose();
  }

  function handleShare() {
    onShare(folder);
    onClose();
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setWorking(true);
    try {
      await onDelete(folder.id);
      onClose();
    } catch {
      setWorking(false);
      setConfirmDelete(false);
    }
  }

  const lastEdited = formatDistanceToNow(new Date(folder.updated_at), {
    addSuffix: true,
  });

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${folder.name}`}
      className="fixed z-[60] min-w-[224px] overflow-hidden rounded-[12px] border border-line bg-card p-1.5 shadow-lg"
      style={{ left: pos.x, top: pos.y, minWidth: MIN_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Rename" onClick={handleEdit} />
      <MenuItem icon={<Smile className="h-3.5 w-3.5" />} label="Change icon" onClick={handleEdit} />
      <MenuItem icon={<Share2 className="h-3.5 w-3.5" />} label="Share with team…" onClick={handleShare} />
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label={confirmDelete ? 'Click again to confirm' : 'Delete folder'}
        onClick={handleDelete}
        disabled={working}
        danger
      />
      <div className="my-1 h-px bg-line" />
      <div className="px-2.5 py-1 text-[11px] leading-snug text-ink-subtle">
        Last edited {lastEdited}
      </div>
    </div>,
    document.body,
  );
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  danger?: boolean;
}

function MenuItem({ icon, label, onClick, disabled, danger }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => void onClick()}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-[13px] text-left transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-bg-alt',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-danger' : 'text-ink-subtle')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
