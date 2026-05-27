import { useEffect } from 'react';
import { Brain, Command, Plus } from 'lucide-react';
import { EmptyState } from '@/components/layout/EmptyState';
import { PromptCard } from '@/features/prompts/PromptCard';
import { PromptBlockEditor } from '@/features/prompts/PromptBlockEditor';
import { PromptFilters } from '@/features/prompts/PromptFilters';
import { PromptCmdK, usePromptCmdKShortcut } from '@/features/prompts/PromptCmdK';
import { PromptPreviewModal } from '@/features/prompts/PromptPreviewModal';
import { useFilteredPrompts, usePromptStore } from '@/stores/promptStore';
import { useUiStore } from '@/stores/uiStore';

export function PromptsPage() {
  const load = usePromptStore((s) => s.load);
  const prompts = usePromptStore((s) => s.prompts);
  const loading = usePromptStore((s) => s.loading);
  const setCmdKOpen = usePromptStore((s) => s.setCmdKOpen);
  const filtered = useFilteredPrompts();
  const openNewPrompt = useUiStore((s) => s.openNewPrompt);
  const editorOpen = useUiStore(
    (s) => s.newPromptOpen || s.editPromptId !== null,
  );

  usePromptCmdKShortcut();

  useEffect(() => {
    if (prompts.length === 0) {
      void load();
    }
  }, [load, prompts.length]);

  return (
    // Full-height layout that escapes the parent py-8 padding
    <div className="-mx-8 -my-8 flex h-[calc(100vh-60px)] overflow-hidden">
      {/* ── Filter sidebar ── */}
      <PromptFilters />

      {/* ── Main content ── */}
      <div
        className="flex min-w-0 flex-1 flex-col overflow-y-auto"
        style={editorOpen ? { paddingRight: '520px' } : undefined}
      >
        {/* Page header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-line bg-bg px-8 py-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-ink">Prompts</h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              AI reasoning infrastructure — structured, executable workflows.
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

        {/* Card grid */}
        <div className="px-8 py-6">
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
            <div
              className={`grid gap-5 ${
                editorOpen ? 'grid-cols-2' : 'grid-cols-3'
              }`}
            >
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
    </div>
  );
}
