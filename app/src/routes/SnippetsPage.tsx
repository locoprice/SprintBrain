import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { BulkActionsBar } from '@/features/snippets/BulkActionsBar';
import { FilterToolbar } from '@/features/snippets/FilterToolbar';
import { ImportExportButtons, type ImportResult } from '@/features/snippets/ImportExportButtons';
import { NewSnippetDialog } from '@/features/snippets/NewSnippetDialog';
import { SnippetFolderTree } from '@/features/snippets/SnippetFolderTree';
import { SnippetsTable } from '@/features/snippets/SnippetsTable';
import { VersionHistoryPanel } from '@/features/snippets/VersionHistoryPanel';
import { useSnippetStore } from '@/stores/snippetStore';

export function SnippetsPage() {
  const load = useSnippetStore((s) => s.load);
  const snippets = useSnippetStore((s) => s.snippets);
  const storeQuery = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const error = useSnippetStore((s) => s.error);
  const clearError = useSnippetStore((s) => s.clearError);

  // Local input value so typing feels instant; debounce propagation to the store.
  const [localQuery, setLocalQuery] = useState(storeQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Sync when the store query is reset externally (e.g. "Clear filters" in empty state).
  useEffect(() => {
    if (storeQuery === '') {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      setLocalQuery('');
    }
  }, [storeQuery]);

  function handleQueryChange(value: string) {
    setLocalQuery(value);
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQuery(value);
      debounceRef.current = null;
    }, 300);
  }

  useEffect(() => {
    if (snippets.length === 0) {
      void load();
    }
  }, [load, snippets.length]);

  return (
    <>
      <VersionHistoryPanel />
      <PageHeader
        title="Snippets"
        description="Triggers, formulas, and templates synced across every device."
        action={
          <>
            <ImportExportButtons onResult={setImportResult} />
            <NewSnippetDialog />
          </>
        }
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

      {importResult && (
        <div
          role="status"
          className={`mb-4 flex items-start gap-2 rounded-[10px] border p-3 text-xs ${
            importResult.ok
              ? 'border-success/30 bg-success/5 text-success'
              : 'border-danger/30 bg-danger/5 text-danger'
          }`}
        >
          {importResult.ok ? (
            <CheckCircle2 className="mt-px h-4 w-4 shrink-0" />
          ) : (
            <AlertCircle className="mt-px h-4 w-4 shrink-0" />
          )}
          <span className="flex-1">
            {importResult.ok
              ? `${importResult.count} snippet${importResult.count !== 1 ? 's' : ''} imported successfully${importResult.skipped > 0 ? ` · ${importResult.skipped} skipped` : ''}.`
              : importResult.message}
          </span>
          <button
            type="button"
            onClick={() => setImportResult(null)}
            aria-label="Dismiss"
            className={
              importResult.ok ? 'text-success/60 hover:text-success' : 'text-danger/60 hover:text-danger'
            }
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex gap-8">
        <SnippetFolderTree />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
            <Input
              type="search"
              value={localQuery}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder="Search by name, trigger, or tag…"
              className="pl-9"
            />
          </div>

          <FilterToolbar />
          <BulkActionsBar />
          <SnippetsTable />
        </div>
      </div>
    </>
  );
}
