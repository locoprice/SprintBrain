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
import { SearchField } from '@/components/ui/search-field';
import { SpaceDialog } from '@/features/memory/SpaceDialog';
import { SpaceIcon } from '@/features/memory/spaceIcon';
import { useMemoryStore } from '@/stores/memoryStore';
import { useUiStore } from '@/stores/uiStore';
import type { MemorySpace } from '@/types/database';

// The spaces index.
//
// No All / Mine / Shared tabs. Sharing does not exist yet, so a "Shared with me"
// tab would be a permanently empty promise. It arrives with the feature.

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
                title={space.is_default ? 'The default space cannot be trashed' : undefined}
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
          {items === 0 ? 'Empty' : `${items} item${items === 1 ? '' : 's'}`}
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
  const showToast = useUiStore((s) => s.showToast);

  const [query, setQuery] = useState('');
  const [dialogTarget, setDialogTarget] = useState<'new' | MemorySpace | null>(null);

  useEffect(() => {
    if (!loaded) void loadSpaces();
  }, [loaded, loadSpaces]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return spaces;
    return spaces.filter(
      (space) =>
        space.name.toLowerCase().includes(needle) ||
        space.description.toLowerCase().includes(needle),
    );
  }, [spaces, query]);

  async function onTrash(space: MemorySpace) {
    try {
      await trashSpace(space.id);
      showToast(`"${space.name}" moved to trash.`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not trash that space.', 'error');
    }
  }

  return (
    <div>
      <PageHeader
        title="Memory"
        description="Facts, notes and documents your assistant can read."
        action={
          <Button onClick={() => setDialogTarget('new')}>
            <Plus className="h-4 w-4" />
            New space
          </Button>
        }
      />

      {error ? (
        <PageBanner tone="error" onDismiss={clearError}>
          {error}
        </PageBanner>
      ) : null}

      <div className="mb-5 flex items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search spaces…" />
        {/* Held back until the first load finishes: "0 spaces" beside a spinner
            reads as an answer, and it is not one yet. */}
        <span className="text-xs text-ink-subtle">
          {loaded ? `${spaces.length} space${spaces.length === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      {loading && spaces.length === 0 ? (
        <LoadingBlock what="your spaces" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={spaces.length === 0 ? 'No spaces yet' : 'Nothing matches'}
          description={
            spaces.length === 0
              ? 'A space holds the facts one kind of work needs. Create one and add your first note.'
              : 'Try a different search.'
          }
          action={
            spaces.length === 0 ? (
              <Button onClick={() => setDialogTarget('new')}>
                <Plus className="h-4 w-4" />
                New space
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
                onTrash={() => void onTrash(space)}
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
    </div>
  );
}
