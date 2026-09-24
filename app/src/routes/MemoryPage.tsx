import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Brain, Pencil, Plus, Trash2 } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { LoadingBlock } from '@/components/layout/LoadingBlock';
import { PageBanner } from '@/components/layout/PageBanner';
import { PageHeader } from '@/components/layout/PageHeader';
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SpaceDialog } from '@/features/memory/SpaceDialog';
import { SpaceIcon } from '@/features/memory/spaceIcon';
import { TrashPanel, type TrashPanelRow } from '@/features/memory/TrashPanel';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSearchStore } from '@/stores/searchStore';
import { normalizeQuery, scoreSpace } from '@/lib/searchIndex';
import { useUiStore } from '@/stores/uiStore';
import type { MemorySpace } from '@/types/database';

// The spaces index.
//
// No All / Mine / Shared tabs. Sharing does not exist yet, so a "Shared with me"
// tab would be a permanently empty promise. It arrives with the feature.
//
// Trashed Brains leave the grid and wait in the trash panel, the same panel a
// Brain uses for its own trash, where they can be restored or deleted for good.

function describeItems(count: number): string {
  return count === 0 ? 'Empty' : `${count} item${count === 1 ? '' : 's'}`;
}

function describeBrains(count: number): string {
  return `${count} Brain${count === 1 ? '' : 's'}`;
}

function SpaceCard({
  space,
  items,
  tokens,
  onRename,
  onTrash,
}: {
  space: MemorySpace;
  items: number;
  tokens: number;
  onRename: () => void;
  onTrash: () => void;
}) {
  return (
    <Card className="relative flex flex-col gap-3 p-5 transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary-light text-primary">
          <SpaceIcon icon={space.ico} />
        </div>

        <ActionMenu label={`Actions for ${space.name}`}>
          {(close) => (
            <>
              <ActionMenuItem
                icon={<Pencil className="h-3.5 w-3.5" />}
                label="Rename"
                onClick={() => {
                  close();
                  onRename();
                }}
              />
              <ActionMenuSeparator />
              <ActionMenuItem
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Move to trash"
                disabled={space.is_default}
                title={space.is_default ? 'The default Brain cannot be trashed' : undefined}
                danger
                onClick={() => {
                  close();
                  onTrash();
                }}
              />
            </>
          )}
        </ActionMenu>
      </div>

      <Link to={`/memory/${space.id}`} className="flex flex-col gap-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink">
          {space.name}
          {space.is_default ? (
            <span className="rounded-full bg-bg-alt px-2 py-0.5 text-[10px] font-medium text-ink-subtle">
              default
            </span>
          ) : null}
        </span>
        <span className="text-xs text-ink-muted">
          {describeItems(items)}
          {tokens > 0 ? ` · ${tokens.toLocaleString()} tokens` : ''}
        </span>
        {space.description ? (
          <span className="mt-1 line-clamp-2 text-xs text-ink-subtle">{space.description}</span>
        ) : null}
        <span className="mt-1 text-[11px] text-ink-subtle">
          Updated {formatDistanceToNow(new Date(space.updated_at), { addSuffix: true })}
        </span>
      </Link>
    </Card>
  );
}

export function MemoryPage() {
  const spaces = useMemoryStore((s) => s.spaces);
  const totals = useMemoryStore((s) => s.totals);
  const loading = useMemoryStore((s) => s.loadingSpaces);
  const loaded = useMemoryStore((s) => s.loaded);
  const error = useMemoryStore((s) => s.error);
  const clearError = useMemoryStore((s) => s.clearError);
  const loadSpaces = useMemoryStore((s) => s.loadSpaces);
  const createSpace = useMemoryStore((s) => s.createSpace);
  const renameSpace = useMemoryStore((s) => s.renameSpace);
  const trashSpace = useMemoryStore((s) => s.trashSpace);
  const trashedSpaces = useMemoryStore((s) => s.trashedSpaces);
  const restoreSpace = useMemoryStore((s) => s.restoreSpace);
  const deleteSpaceForever = useMemoryStore((s) => s.deleteSpaceForever);
  const showToast = useUiStore((s) => s.showToast);

  const [dialogTarget, setDialogTarget] = useState<'new' | MemorySpace | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  // The one search bar in the header owns the text (SEARCH-001).
  const query = useSearchStore((s) => s.query);

  useEffect(() => {
    if (!loaded) void loadSpaces();
  }, [loaded, loadSpaces]);

  const filtered = useMemo(() => {
    const needle = normalizeQuery(query);
    if (!needle) return spaces;
    return spaces.filter((space) => scoreSpace(space, needle) > 0);
  }, [spaces, query]);

  const trashPanelRows = useMemo<TrashPanelRow[]>(
    () =>
      trashedSpaces.map((space) => ({
        id: space.id,
        name: space.name,
        icon: <SpaceIcon icon={space.ico} className="h-4 w-4" />,
        tag: 'Brain',
        detail: describeItems(totals.get(space.id)?.items ?? 0),
        deletedAt: space.deleted_at ?? space.updated_at,
      })),
    [trashedSpaces, totals],
  );

  function reportFailure(err: unknown, fallback: string) {
    showToast(err instanceof Error ? err.message : fallback, 'error');
  }

  function restoreBrain(space: MemorySpace) {
    restoreSpace(space.id).then(
      () => showToast(`"${space.name}" restored.`),
      (err: unknown) => reportFailure(err, 'Could not restore that Brain.'),
    );
  }

  /** The card leaves the grid at once; the toast offers the way back. */
  function trashBrain(space: MemorySpace) {
    trashSpace(space.id).then(
      () =>
        showToast(`"${space.name}" moved to trash.`, 'success', {
          label: 'Undo',
          onClick: () => restoreBrain(space),
        }),
      (err: unknown) => reportFailure(err, 'Could not trash that Brain.'),
    );
  }

  function restoreTrashed(id: string) {
    const space = trashedSpaces.find((candidate) => candidate.id === id);
    if (space) restoreBrain(space);
  }

  async function deleteTrashed(id: string) {
    const space = trashedSpaces.find((candidate) => candidate.id === id);
    if (!space) return;
    try {
      await deleteSpaceForever(id);
      showToast(`"${space.name}" deleted permanently.`);
    } catch (err) {
      reportFailure(err, 'Could not delete that Brain permanently.');
    }
  }

  // One Brain at a time: each is its own files-first delete. The first failure
  // stops the run, so what is left in the trash is exactly what was not deleted.
  async function emptyTrash() {
    for (const space of [...trashedSpaces]) {
      try {
        await deleteSpaceForever(space.id);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'it could not be deleted.';
        showToast(`Emptying stopped at "${space.name}": ${reason}`, 'error');
        return;
      }
    }
    showToast('Trash emptied.');
    setTrashOpen(false);
  }

  return (
    <div>
      <PageHeader
        title="Brains"
        tag="context assets"
        description="Facts, notes and documents your assistant can read."
        action={
          <Button onClick={() => setDialogTarget('new')}>
            <Plus className="h-4 w-4" />
            New Brain
          </Button>
        }
      />

      {error ? (
        <PageBanner tone="error" onDismiss={clearError}>
          {error}
        </PageBanner>
      ) : null}

      <div className="mb-5 flex items-center justify-between gap-3">
        {/* Held back until the first load finishes: "0 Brains" beside a spinner
            reads as an answer, and it is not one yet. */}
        <span className="text-xs text-ink-subtle">
          {loaded ? describeBrains(spaces.length) : ''}
        </span>
        <button
          type="button"
          onClick={() => setTrashOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-[10px] border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-bg-alt"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {trashedSpaces.length > 0 ? `Trash (${trashedSpaces.length})` : 'Trash'}
        </button>
      </div>

      {loading && spaces.length === 0 ? (
        <LoadingBlock what="your Brains" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={spaces.length === 0 ? 'No Brains yet' : 'Nothing matches'}
          description={
            spaces.length === 0
              ? 'A Brain holds the facts one kind of work needs. Create one and add your first note.'
              : 'Try a different search.'
          }
          action={
            spaces.length === 0 ? (
              <Button onClick={() => setDialogTarget('new')}>
                <Plus className="h-4 w-4" />
                New Brain
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="grid gap-4 grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((space) => {
            const total = totals.get(space.id);
            return (
              <SpaceCard
                key={space.id}
                space={space}
                items={total?.items ?? 0}
                tokens={total?.tokens ?? 0}
                onRename={() => setDialogTarget(space)}
                onTrash={() => trashBrain(space)}
              />
            );
          })}
        </div>
      )}

      <SpaceDialog
        target={dialogTarget}
        onClose={() => setDialogTarget(null)}
        onCreate={createSpace}
        onRename={renameSpace}
      />

      <TrashPanel
        open={trashOpen}
        subject="Brains"
        description="Restore a Brain to bring it back with everything in it. Deleting one removes its items and files for good."
        emptyHint="Brains you delete wait here, with everything in them, until you empty the trash."
        rows={trashPanelRows}
        summary={`${describeBrains(trashedSpaces.length)} and everything in them`}
        onClose={() => setTrashOpen(false)}
        onRestore={restoreTrashed}
        onDelete={deleteTrashed}
        onEmpty={emptyTrash}
      />
    </div>
  );
}
