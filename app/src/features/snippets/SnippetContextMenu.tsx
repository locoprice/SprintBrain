import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { formatDistanceToNow } from 'date-fns';
import { Copy, Pencil, Pin, PinOff, Trash2, UserMinus, Users } from 'lucide-react';
import type { SnippetRow } from '@/types/database';
import { cn } from '@/lib/utils';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';

interface SnippetContextMenuProps {
  snippet: SnippetRow;
  x: number;
  y: number;
  onClose: () => void;
}

const MIN_WIDTH = 224;
const VIEWPORT_PADDING = 8;

export function SnippetContextMenu({ snippet, x, y, onClose }: SnippetContextMenuProps) {
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const togglePin = useSnippetStore((s) => s.togglePin);
  const duplicateSnippet = useSnippetStore((s) => s.duplicateSnippet);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);
  const shareSnippet = useSnippetStore((s) => s.shareSnippet);
  const unshareSnippet = useSnippetStore((s) => s.unshareSnippet);

  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ x, y });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);

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

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  function handleEdit() {
    openEditSnippet(snippet.id);
    onClose();
  }

  async function handlePin() {
    setWorking(true);
    try {
      await togglePin(snippet.id);
      onClose();
    } catch {
      setWorking(false);
    }
  }

  async function handleDuplicate() {
    setWorking(true);
    try {
      await duplicateSnippet(snippet.id);
      onClose();
    } catch {
      setWorking(false);
    }
  }

  async function handleShare() {
    setWorking(true);
    try {
      if (snippet.is_shared) await unshareSnippet(snippet.id);
      else await shareSnippet(snippet.id);
      onClose();
    } catch {
      setWorking(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setWorking(true);
    try {
      await removeSnippet(snippet.id);
      onClose();
    } catch {
      setWorking(false);
      setConfirmDelete(false);
    }
  }

  const lastEdited = formatDistanceToNow(new Date(snippet.updated_at), { addSuffix: true });

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`Actions for ${snippet.name}`}
      className="fixed z-[60] min-w-[224px] overflow-hidden rounded-[12px] border border-line bg-card p-1.5 shadow-lg"
      style={{ left: pos.x, top: pos.y, minWidth: MIN_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuItem icon={<Pencil className="h-3.5 w-3.5" />} label="Edit" onClick={handleEdit} disabled={working} />
      <MenuItem
        icon={snippet.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        label={snippet.pinned ? 'Unpin' : 'Pin to top'}
        onClick={handlePin}
        disabled={working}
      />
      <MenuItem icon={<Copy className="h-3.5 w-3.5" />} label="Duplicate" onClick={handleDuplicate} disabled={working} />
      <MenuItem
        icon={snippet.is_shared ? <UserMinus className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
        label={snippet.is_shared ? 'Unshare from team' : 'Share with team'}
        onClick={handleShare}
        disabled={working}
      />
      <div className="my-1 h-px bg-line" />
      <MenuItem
        icon={<Trash2 className="h-3.5 w-3.5" />}
        label={confirmDelete ? 'Click again to confirm' : 'Delete snippet'}
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
