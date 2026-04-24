import { useEffect } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/layout/EmptyState';
import { PromptCard } from '@/features/prompts/PromptCard';
import { PromptDialog } from '@/features/prompts/PromptDialog';
import {
  useFilteredPrompts,
  usePromptStore,
  type PromptFilter,
} from '@/stores/promptStore';
import { useUiStore } from '@/stores/uiStore';

export function PromptsPage() {
  const load = usePromptStore((s) => s.load);
  const prompts = usePromptStore((s) => s.prompts);
  const filter = usePromptStore((s) => s.filter);
  const setFilter = usePromptStore((s) => s.setFilter);
  const filtered = useFilteredPrompts();
  const openNewPrompt = useUiStore((s) => s.openNewPrompt);

  useEffect(() => {
    if (prompts.length === 0) {
      void load();
    }
  }, [load, prompts.length]);

  return (
    <>
      <PageHeader
        title="Prompts"
        description="Reusable AI prompts — one-shot templates and few-shot examples."
        action={
          <Button variant="primary" onClick={openNewPrompt}>
            <Plus className="h-4 w-4" />
            New prompt
          </Button>
        }
      />

      <Tabs
        value={filter}
        onValueChange={(v) => setFilter(v as PromptFilter)}
        className="mb-6"
      >
        <TabsList>
          <TabsTrigger value="all">All ({prompts.length})</TabsTrigger>
          <TabsTrigger value="one-shot">
            One-shot ({prompts.filter((p) => p.type === 'one-shot').length})
          </TabsTrigger>
          <TabsTrigger value="few-shot">
            Few-shot ({prompts.filter((p) => p.type === 'few-shot').length})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No prompts in this filter"
          description="Switch to another type or add a new prompt to get started."
        />
      ) : (
        <div className="grid grid-cols-3 gap-5">
          {filtered.map((prompt) => (
            <PromptCard key={prompt.id} prompt={prompt} />
          ))}
        </div>
      )}

      <PromptDialog />
    </>
  );
}
