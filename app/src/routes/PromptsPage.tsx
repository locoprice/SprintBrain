import { useEffect } from 'react';
import { Brain, Command, Plus } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { LabelManagerDialog } from '@/features/labels/LabelManagerDialog';
import { PromptCard } from '@/features/prompts/PromptCard';
import { PromptBlockEditor } from '@/features/prompts/PromptBlockEditor';
import { PromptFilters } from '@/features/prompts/PromptFilters';
import { PromptCmdK, usePromptCmdKShortcut } from '@/features/prompts/PromptCmdK';
import { PromptPreviewModal } from '@/features/prompts/PromptPreviewModal';
import { cn } from '@/lib/utils';
import { useFilteredPrompts, usePromptStore } from '@/stores/promptStore';
import { useLabelStore } from '@/stores/labelStore';
import { useUiStore } from '@/stores/uiStore';

export function PromptsPage() {
  const load = usePromptStore((s) => s.load);
  const loadLabels = useLabelStore((s) => s.load);
  const labelsLoaded = useLabelStore((s) => s.loaded);
  const prompts = usePromptStore((s) => s.prompts);
  const loading = usePromptStore((s) => s.loading);
  const setCmdKOpen = usePromptStore((s) => s.setCmdKOpen);
  const filtered = useFilteredPrompts();
  const openNewPrompt = useUiStore((s) => s.openNewPrompt);
  // Stable across renders (zustand action), so PromptFilters stays memoized.
  const openLabelManager = useUiStore((s) => s.openLabelManager);
  const editorOpen = useUiStore(
    (s) => s.newPromptOpen || s.editPromptId !== null,
  );

  usePromptCmdKShortcut();

  useEffect(() => {
    if (prompts.length === 0) {
      void load();
    }
  }, [load, prompts.length]);

  // Labels load on their own: a failure here costs badges, never the list.
  useEffect(() => {
    if (!labelsLoaded) {
      void loadLabels();
    }
  }, [loadLabels, labelsLoaded]);

  // Column count follows the space the drawer leaves behind, not a fixed
  // number: two columns of a narrow remainder is worse than one column that
  // can be read. With the drawer closed the list still steps down on smaller
  // screens rather than holding three columns at any width.
  const gridColumns = editorOpen
    ? 'grid-cols-1 2xl:grid-cols-2'
    : 'grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';

  return (
    // Full-height layout that escapes the parent py-8 padding
    <div className="-mx-8 -my-8 flex h-[calc(100vh-60px)] overflow-hidden">
      {/* ── Main content ── */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col overflow-y-auto',
          // Reserve exactly what the drawer covers — same two widths as
          // PromptBlockEditor. A flat 520px left a 1024px screen 165px of
          // list, which is 65px per card once the grid splits it.
          editorOpen && 'pr-[420px] 2xl:pr-[520px]',
        )}
      >
        {/* Page header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-bg px-8 py-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">Prompts</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              AI reasoning infrastructure. Structured, executable workflows.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* ⌘K hint */}
            <button
              type="button"
              onClick={() => setCmdKOpen(true)}
              className="hidden items-center gap-1.5 rounded-[10px] border border-line bg-card px-3 py-1.5 text-xs text-ink-subtle transition-colors hover:border-primary/30 hover:text-ink md:flex"
            >
              <Command className="h-3 w-3" />
              <span className="font-mono">K</span>
              <span className="ml-1">Search</span>
            </button>
            <button
              type="button"
              onClick={openNewPrompt}
              className="inline-flex h-9 items-center gap-2 rounded-[10px] bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-dark"
            >
              <Plus className="h-4 w-4" />
              New prompt
            </button>
          </div>
        </div>

        {/* Filter toolbar + card grid */}
        <div className="px-8 py-6">
          <PromptFilters onManageLabels={openLabelManager} />
          {loading && prompts.length === 0 ? (
            <div className="flex items-center justify-center py-24">
              <span className="text-sm text-ink-subtle">Loading prompts…</span>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Brain}
              title="No prompts match"
              description="Adjust your filters or create a new prompt to get started."
            />
          ) : (
            <div className={cn('grid gap-5', gridColumns)}>
              {filtered.map((prompt) => (
                <PromptCard key={prompt.id} prompt={prompt} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Overlays ── */}
      <PromptBlockEditor />
      <PromptCmdK />
      <PromptPreviewModal />
      <LabelManagerDialog />
    </div>
  );
}
