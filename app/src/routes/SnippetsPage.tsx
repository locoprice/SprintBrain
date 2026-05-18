import { useEffect } from 'react';
import { AlertCircle, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { NewSnippetDialog } from '@/features/snippets/NewSnippetDialog';
import { SnippetFolderTree } from '@/features/snippets/SnippetFolderTree';
import { SnippetsTable } from '@/features/snippets/SnippetsTable';
import { useSnippetStore } from '@/stores/snippetStore';

export function SnippetsPage() {
  const load = useSnippetStore((s) => s.load);
  const snippets = useSnippetStore((s) => s.snippets);
  const query = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const error = useSnippetStore((s) => s.error);
  const clearError = useSnippetStore((s) => s.clearError);

  useEffect(() => {
    if (snippets.length === 0) {
      void load();
    }
  }, [load, snippets.length]);

  return (
    <>
      <PageHeader
        title="Snippets"
        description="Triggers, formulas, and templates synced across every device."
        action={<NewSnippetDialog />}
      />

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Dismiss error"
            className="text-danger/60 hover:text-danger"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex gap-8">
        <SnippetFolderTree />

        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, trigger, or tag…"
              className="pl-9"
            />
          </div>

          <SnippetsTable />
        </div>
      </div>
    </>
  );
}
