import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input } from '@/components/ui/input';
import { FolderBreadcrumb } from '@/features/org/FolderBreadcrumb';
import { LabelManagerDialog } from '@/features/labels/LabelManagerDialog';
import { BulkActionsBar } from '@/features/snippets/BulkActionsBar';
import { FilterToolbar } from '@/features/snippets/FilterToolbar';
import { ImportExportButtons, type ImportResult } from '@/features/snippets/ImportExportButtons';
import { NewSnippetDialog } from '@/features/snippets/NewSnippetDialog';
import { SnippetFolderTree } from '@/features/snippets/SnippetFolderTree';
import { SnippetsTable } from '@/features/snippets/SnippetsTable';
import { VersionHistoryPanel } from '@/features/snippets/VersionHistoryPanel';
import { useLabelStore } from '@/stores/labelStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';

export function SnippetsPage() {
  const load = useSnippetStore((s) => s.load);
  const loadLabels = useLabelStore((s) => s.load);
  const labelsLoaded = useLabelStore((s) => s.loaded);
  const snippets = useSnippetStore((s) => s.snippets);
  const storeQuery = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const error = useSnippetStore((s) => s.error);
  const clearError = useSnippetStore((s) => s.clearError);
  // The header takes on the selected folder's identity, so its description has
  // somewhere to live. "All snippets" keeps the page-level blurb.
  const folders = useSnippetStore((s) => s.folders);
  const selectedFolderId = useSnippetStore((s) => s.selectedFolderId);
  const setSelectedFolder = useSnippetStore((s) => s.setSelectedFolder);
  const selectedFolder =
    selectedFolderId === null ? null : folders.find((f) => f.id === selectedFolderId) ?? null;

  // The rail costs the table 272px. On a 1280px screen that is the difference
  // between reading the table and scrolling it sideways, so it can be put away.
  const railOpen = useUiStore((s) => s.foldersRailOpen);
  const setRailOpen = useUiStore((s) => s.setFoldersRailOpen);

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

  // Labels load on their own: a failure here costs badges, never the library.
  useEffect(() => {
    if (!labelsLoaded) {
      void loadLabels();
    }
  }, [loadLabels, labelsLoaded]);

  return (
    <>
      <VersionHistoryPanel />
      <LabelManagerDialog />
      <PageHeader
        breadcrumb={
          selectedFolder ? (
            <FolderBreadcrumb
              folders={folders}
              folderId={selectedFolder.id}
              onNavigate={setSelectedFolder}
            />
          ) : undefined
        }
        title={selectedFolder ? selectedFolder.name : 'Snippets'}
        description={
          selectedFolder
            ? selectedFolder.description ?? undefined
            : 'Triggers, formulas, and templates synced across every device.'
        }
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
        {railOpen && <SnippetFolderTree />}

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex items-center gap-2">
            {/* Sits with the search rather than on the rail itself: it has to
                be in the same place whether the rail is there or not. */}
            <button
              type="button"
              onClick={() => setRailOpen(!railOpen)}
              aria-pressed={railOpen}
              title={railOpen ? 'Hide folders' : 'Show folders'}
              aria-label={railOpen ? 'Hide folders' : 'Show folders'}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border border-line bg-card text-ink-subtle transition-colors hover:border-primary/30 hover:text-primary"
            >
              {railOpen ? (
                <PanelLeftClose className="h-4 w-4" aria-hidden />
              ) : (
                <PanelLeftOpen className="h-4 w-4" aria-hidden />
              )}
            </button>
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
              <Input
                type="search"
                value={localQuery}
                onChange={(e) => handleQueryChange(e.target.value)}
                placeholder="Search by name, trigger, or tag…"
                className="pl-9"
              />
            </div>
          </div>

          <FilterToolbar />
          <BulkActionsBar />
          <SnippetsTable />
        </div>
      </div>
    </>
  );
}
