import { useEffect } from 'react';
import { Brain, Command, Plus } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { LoadingBlock } from '@/components/layout/LoadingBlock';
import { PageBanner } from '@/components/layout/PageBanner';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { SearchField } from '@/components/ui/search-field';
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
  const error = usePromptStore((s) => s.error);
  const clearError = usePromptStore((s) => s.clearError);
  const search = usePromptStore((s) => s.filters.search);
  const setFilters = usePromptStore((s) => s.setFilters);
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

  return (
    // The editor is a fixed drawer over the right of the viewport, so the page
    // gives back exactly what it covers. Same two widths as PromptBlockEditor:
    // a flat 520px left a 1024px screen 165px of list to split between cards.
    <div className={cn(editorOpen && 'pr-[420px] 2xl:pr-[520px]')}>
      <PageHeader
        title="Prompts"
        description="AI reasoning infrastructure. Structured, executable workflows."
        action={
          <>
            <Button variant="ghost" size="md" onClick={() => setCmdKOpen(true)} title="Search prompts">
              <Command className="h-4 w-4" />
              Search
            </Button>
            <Button onClick={openNewPrompt}>
              <Plus className="h-4 w-4" />
              New prompt
            </Button>
          </>
        }
      />

      {error && (
        <PageBanner tone="error" onDismiss={clearError}>
          {error}
        </PageBanner>
      )}

      <div className="flex min-w-0 flex-col gap-3">
        <SearchField
          value={search}
          onChange={(next) => setFilters({ search: next })}
          placeholder="Search by name, content, or tag…"
        />

        <PromptFilters onManageLabels={openLabelManager} />

        {loading && prompts.length === 0 ? (
          <LoadingBlock what="prompts" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Brain}
            title={prompts.length === 0 ? 'No prompts yet' : 'Nothing matches'}
            description={
              prompts.length === 0
                ? 'A prompt holds a reusable instruction for your assistant. Create one to get started.'
                : 'Try a different search or clear your filters.'
            }
            action={
              prompts.length === 0 ? (
                <Button onClick={openNewPrompt}>
                  <Plus className="h-4 w-4" />
                  New prompt
                </Button>
              ) : null
            }
          />
        ) : (
          <div
            className={cn(
              'grid gap-4',
              editorOpen
                ? 'grid-cols-1 2xl:grid-cols-2'
                : 'grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4',
            )}
          >
            {filtered.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} />
            ))}
          </div>
        )}
      </div>

      <PromptBlockEditor />
      <PromptCmdK />
      <PromptPreviewModal />
      <LabelManagerDialog />
    </div>
  );
}
