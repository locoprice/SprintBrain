import { useEffect, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { PageBanner } from '@/components/layout/PageBanner';
import { PageHeader } from '@/components/layout/PageHeader';
import { SearchField } from '@/components/ui/search-field';
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

  const [importResult, setImportResult] = useState<ImportResult | null>(null);

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
        <PageBanner tone="error" onDismiss={clearError}>
          {error}
        </PageBanner>
      )}

      {importResult && (
        <PageBanner
          tone={importResult.ok ? 'success' : 'error'}
          onDismiss={() => setImportResult(null)}
        >
          {importResult.ok
            ? `${importResult.count} snippet${importResult.count !== 1 ? 's' : ''} imported successfully${importResult.skipped > 0 ? ` · ${importResult.skipped} skipped` : ''}.`
            : importResult.message}
        </PageBanner>
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
            <SearchField
              value={storeQuery}
              onChange={setQuery}
              placeholder="Search by name, trigger, or tag…"
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
