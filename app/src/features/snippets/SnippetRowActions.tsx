import { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Pencil,
  Pin,
  PinOff,
  Power,
  Settings2,
  Tag,
  Trash2,
} from 'lucide-react';
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu';
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
 * Two always-visible icons:
 *   • Pencil        (Edit) → opens the snippet edit dialog
 *   • More actions         → Pin / History / Clone / Label as / Disable / Delete
 *
 * The right-click context menu (SnippetContextMenu) remains available as a
 * power-user shortcut and still covers Share. Pin moved here from the snippet
 * dialog: it orders the list, so it belongs where the list is, not behind an
 * open-edit-save round trip.
 *
 * The menu itself is the shared <ActionMenu>, the same one prompts and memory
 * use: portalled out of the table's `overflow-clip`, anchored to its trigger
 * and clamped to the viewport.
 */
export function SnippetRowActions({ snippet }: SnippetRowActionsProps) {
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const openHistory = useUiStore((s) => s.openHistory);
  const duplicateSnippet = useSnippetStore((s) => s.duplicateSnippet);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);
  const toggleActive = useSnippetStore((s) => s.toggleActive);
  const togglePin = useSnippetStore((s) => s.togglePin);

  const openLabelManager = useUiStore((s) => s.openLabelManager);
  const labels = useLabelStore((s) => s.labels);
  const labelAssignments = useLabelStore((s) => s.snippetLabels);
  const setSnippetLabels = useLabelStore((s) => s.setSnippetLabels);

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

  function handleEdit(e: React.MouseEvent) {
    e.stopPropagation();
    openEditSnippet(snippet.id);
  }

  function handleHistory(close: () => void) {
    openHistory(snippet.id);
    close();
  }

  async function handleClone(close: () => void) {
    setWorking(true);
    try {
      await duplicateSnippet(snippet.id);
      close();
    } catch {
      // Error surfaces via store.error → page-level banner.
    } finally {
      setWorking(false);
    }
  }

  async function handleTogglePin(close: () => void) {
    setWorking(true);
    try {
      await togglePin(snippet.id);
      close();
    } catch {
      // Error surfaces via store.error → page-level banner.
    } finally {
      setWorking(false);
    }
  }

  async function handleToggleActive(close: () => void) {
    setWorking(true);
    try {
      await toggleActive(snippet.id);
      close();
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

  function handleManageLabels(close: () => void) {
    close();
    openLabelManager();
  }

  async function handleDelete(close: () => void) {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setWorking(true);
    try {
      await removeSnippet(snippet.id);
      close();
    } catch {
      setConfirmDelete(false);
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <button
        type="button"
        onClick={handleEdit}
        aria-label={`Edit ${snippet.name}`}
        title={`Edit ${snippet.name}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-subtle transition-colors hover:bg-primary-light hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Pencil className="h-4 w-4" />
      </button>

      <ActionMenu
        label={`Actions for ${snippet.name}`}
        onOpenChange={(open) => {
          // Every open starts from a clean state.
          if (!open) {
            setConfirmDelete(false);
            setView('actions');
          }
        }}
      >
        {(close) =>
          view === 'actions' ? (
            <>
              <ActionMenuItem
                icon={
                  snippet.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />
                }
                label={snippet.pinned ? 'Unpin' : 'Pin to top'}
                onClick={() => void handleTogglePin(close)}
                disabled={working}
              />
              <ActionMenuItem
                icon={<Clock className="h-3.5 w-3.5" />}
                label="History"
                onClick={() => handleHistory(close)}
                disabled={working}
              />
              <ActionMenuItem
                icon={<Copy className="h-3.5 w-3.5" />}
                label="Clone"
                onClick={() => void handleClone(close)}
                disabled={working}
              />
              <ActionMenuItem
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
              <ActionMenuItem
                icon={<Power className="h-3.5 w-3.5" />}
                label={snippet.is_active ? 'Disable' : 'Enable'}
                onClick={() => void handleToggleActive(close)}
                disabled={working}
              />
              <ActionMenuSeparator />
              <ActionMenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label={confirmDelete ? 'Click again to confirm' : 'Delete'}
                onClick={() => void handleDelete(close)}
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
              <ActionMenuSeparator />

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

              <ActionMenuSeparator />
              <ActionMenuItem
                icon={<Settings2 className="h-3.5 w-3.5" />}
                label="Manage labels"
                onClick={() => handleManageLabels(close)}
              />
            </>
          )
        }
      </ActionMenu>
    </div>
  );
}
