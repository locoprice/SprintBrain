import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Pencil,
  Power,
  Settings2,
  Settings,
  Tag,
  Trash2,
} from 'lucide-react';
import type { SnippetRow } from '@/types/database';
import { useSnippetStore } from '@/stores/snippetStore';
import { useLabelStore } from '@/stores/labelStore';
import { useUiStore } from '@/stores/uiStore';
import { labelSwatch } from '@/lib/labelColors';
import { buildLabelTree, flattenLabelTree, labelPath } from '@/lib/labelTree';
import { resolveLabels } from '@/lib/labelUtils';
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
  const openHistory = useUiStore((s) => s.openHistory);
  const duplicateSnippet = useSnippetStore((s) => s.duplicateSnippet);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);
  const toggleActive = useSnippetStore((s) => s.toggleActive);

  const openLabelManager = useUiStore((s) => s.openLabelManager);
  const labels = useLabelStore((s) => s.labels);
  const labelAssignments = useLabelStore((s) => s.snippetLabels);
  const setSnippetLabels = useLabelStore((s) => s.setSnippetLabels);

  const gearRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [working, setWorking] = useState(false);
  // The menu drills down rather than flying a submenu out sideways: it is
  // already portalled with viewport clamping, and a second floating layer would
  // need its own edge maths for no gain at this size.
  const [view, setView] = useState<'actions' | 'labels'>('actions');
  const [labelBusy, setLabelBusy] = useState<string | null>(null);

  // Resolved against the catalog, not the raw id list. An id whose label is
  // gone must not be counted (it is invisible in the list below, so the badge
  // would disagree with it) and must not be written back either: the assignment
  // write upserts exactly this set, and a dangling id fails the FK — which
  // would break the next toggle, not just the display.
  const assignedLabels = useMemo(
    () => resolveLabels(snippet.id, labelAssignments, labels),
    [snippet.id, labelAssignments, labels],
  );
  const assigned = useMemo(() => assignedLabels.map((l) => l.id), [assignedLabels]);
  const labelRows = useMemo(() => flattenLabelTree(buildLabelTree(labels)), [labels]);

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
    // `view` is a dependency because drilling into the label list changes the
    // menu's height — without re-measuring, a tall list runs off the bottom of
    // the viewport instead of flipping above the gear.
  }, [open, anchor, view]);

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

  // Reset the delete-confirm latch and the drill-down whenever the menu closes
  // so the next open starts from a clean state.
  useEffect(() => {
    if (!open) {
      setConfirmDelete(false);
      setView('actions');
    }
  }, [open]);

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    openEditSnippet(snippet.id);
  }

  function handleGearToggle(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen((v) => !v);
  }

  function handleHistory() {
    openHistory(snippet.id);
    setOpen(false);
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

  // Writes straight through, like the × on a row badge does — there is no
  // draft to hold here, and a menu that needed a Save button would be worse.
  // The menu stays open: assigning two labels in a row is the normal case.
  async function toggleLabel(labelId: string) {
    const next = assigned.includes(labelId)
      ? assigned.filter((id) => id !== labelId)
      : [...assigned, labelId];
    setLabelBusy(labelId);
    try {
      await setSnippetLabels(snippet.id, next);
    } catch {
      // Error surfaces via store.error → page-level banner.
    } finally {
      setLabelBusy(null);
    }
  }

  function handleManageLabels() {
    setOpen(false);
    openLabelManager();
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
            {view === 'actions' ? (
              <>
                <MenuItem
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="History"
                  onClick={handleHistory}
                  disabled={working}
                />
                <MenuItem
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label="Clone"
                  onClick={handleClone}
                  disabled={working}
                />
                <MenuItem
                  icon={<Tag className="h-3.5 w-3.5" />}
                  label="Label as"
                  onClick={() => setView('labels')}
                  disabled={working}
                  trailing={
                    <span className="flex items-center gap-1 text-[11px] tabular-nums text-ink-subtle">
                      {assigned.length > 0 && assigned.length}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  }
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
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setView('actions')}
                  className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-left text-[13px] font-medium text-ink transition-colors hover:bg-bg-alt"
                >
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                  <span className="flex-1 truncate">Label as</span>
                </button>
                <div className="my-1 h-px bg-line" />

                {labelRows.length === 0 ? (
                  <p className="px-2.5 py-2 text-[12px] leading-snug text-ink-subtle">
                    No labels yet. Create one below, then it appears here for every snippet.
                  </p>
                ) : (
                  <div className="max-h-[240px] overflow-y-auto">
                    {labelRows.map(({ label, depth }) => {
                      const on = assigned.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={on}
                          disabled={labelBusy !== null}
                          title={depth > 1 ? labelPath(labels, label.id) : undefined}
                          onClick={() => void toggleLabel(label.id)}
                          style={{ paddingLeft: 10 + (depth - 1) * 14 }}
                          className="flex w-full items-center gap-2 rounded-[8px] py-1.5 pr-2.5 text-left text-[13px] text-ink transition-colors hover:bg-bg-alt disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <span
                            className={cn(
                              'h-2.5 w-2.5 shrink-0 rounded-full',
                              labelSwatch(label.color).dot,
                            )}
                          />
                          <span className="min-w-0 flex-1 truncate">{label.name}</span>
                          {on && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="my-1 h-px bg-line" />
                <MenuItem
                  icon={<Settings2 className="h-3.5 w-3.5" />}
                  label="Manage labels"
                  onClick={handleManageLabels}
                />
              </>
            )}
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
  /** Right-aligned adornment — a count, a chevron into a sub-view. */
  trailing?: React.ReactNode;
}

function MenuItem({ icon, label, onClick, disabled, danger, trailing }: MenuItemProps) {
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
      {trailing !== undefined && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}
