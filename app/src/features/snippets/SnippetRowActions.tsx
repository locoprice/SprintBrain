import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Pencil, Power, Settings, Trash2 } from 'lucide-react';
import type { SnippetRow } from '@/types/database';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

interface SnippetRowActionsProps {
  snippet: SnippetRow;
}

/**
 * Per-row direct-access action icons for the snippets table.
 *
 * Replaces the legacy hover-only trash icon with two always-visible icons:
 *   • Pencil (Edit)     → opens the snippet edit dialog
 *   • Cog    (Settings) → opens a dropdown with Clone / Disable / Delete
 *
 * The right-click context menu (SnippetContextMenu) remains available as a
 * power-user shortcut and still covers Pin + Share — actions intentionally
 * kept out of this dropdown to keep it scannable.
 *
 * The dropdown is rendered via React portal so it escapes the table's
 * `overflow-clip` container and is positioned anchored to the gear button
 * (right edge, just below) with viewport-edge clamping.
 */
export function SnippetRowActions({ snippet }: SnippetRowActionsProps) {
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const duplicateSnippet = useSnippetStore((s) => s.duplicateSnippet);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);
  const toggleActive = useSnippetStore((s) => s.toggleActive);

  const gearRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);

  // Position the menu relative to the gear button on every open. We measure
  // after first render so the menu's own size can be subtracted from the
  // right-edge clamp.
  useLayoutEffect(() => {
    if (!open || !gearRef.current) return;
    const rect = gearRef.current.getBoundingClientRect();
    setAnchor({ x: rect.right, y: rect.bottom + 4 });
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !anchor) return;
    const el = menuRef.current;
    const mrect = el.getBoundingClientRect();
    const PAD = 8;
    let nextX = anchor.x - mrect.width; // right-align with the gear button
    let nextY = anchor.y;
    if (nextX < PAD) nextX = PAD;
    if (nextY + mrect.height + PAD > window.innerHeight) {
      // Flip above the gear if there's not enough room below the row.
      nextY = Math.max(PAD, anchor.y - mrect.height - 8 - 32);
    }
    el.style.left = `${nextX}px`;
    el.style.top = `${nextY}px`;
  }, [open, anchor]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (menuRef.current?.contains(target)) return;
      if (gearRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onResize() {
      setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open]);

  // Reset the delete-confirm latch whenever the menu closes so the next open
  // starts from a clean state.
  useEffect(() => {
    if (!open) setConfirmDelete(false);
  }, [open]);

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    openEditSnippet(snippet.id);
  }

  function handleGearToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen((v) => !v);
  }

  async function handleClone() {
    setWorking(true);
    try {
      await duplicateSnippet(snippet.id);
      setOpen(false);
    } catch {
      // Error surfaces via store.error → page-level banner.
    } finally {
      setWorking(false);
    }
  }

  async function handleToggleActive() {
    setWorking(true);
    try {
      await toggleActive(snippet.id);
      setOpen(false);
    } catch {
      // Error surfaces via store.error.
    } finally {
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
      setOpen(false);
    } catch {
      setConfirmDelete(false);
    } finally {
      setWorking(false);
    }
  }

  const iconBtn =
    'inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-subtle transition-colors hover:bg-primary-light hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={handleEdit}
        aria-label={`Edit ${snippet.name}`}
        title={`Edit ${snippet.name}`}
        className={iconBtn}
      >
        <Pencil className="h-4 w-4" />
      </button>
      <button
        ref={gearRef}
        type="button"
        onClick={handleGearToggle}
        aria-label={`More actions for ${snippet.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        className={cn(iconBtn, open && 'bg-primary-light text-primary')}
      >
        <Settings className="h-4 w-4" />
      </button>

      {open &&
        anchor !== null &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Actions for ${snippet.name}`}
            className="fixed z-[60] min-w-[200px] overflow-hidden rounded-[12px] border border-line bg-card p-1.5 shadow-lg"
            // Initial placement; useLayoutEffect refines once measured.
            style={{ left: anchor.x, top: anchor.y, visibility: anchor ? 'visible' : 'hidden' }}
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.preventDefault()}
          >
            <MenuItem
              icon={<Copy className="h-3.5 w-3.5" />}
              label="Clone"
              onClick={handleClone}
              disabled={working}
            />
            <MenuItem
              icon={<Power className="h-3.5 w-3.5" />}
              label={snippet.is_active ? 'Disable' : 'Enable'}
              onClick={handleToggleActive}
              disabled={working}
            />
            <div className="my-1 h-px bg-line" />
            <MenuItem
              icon={<Trash2 className="h-3.5 w-3.5" />}
              label={confirmDelete ? 'Click again to confirm' : 'Delete'}
              onClick={handleDelete}
              disabled={working}
              danger
            />
          </div>,
          document.body,
        )}
    </div>
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
        'flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        danger ? 'text-danger hover:bg-danger/10' : 'text-ink hover:bg-bg-alt',
      )}
    >
      <span className={cn('shrink-0', danger ? 'text-danger' : 'text-ink-subtle')}>{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
