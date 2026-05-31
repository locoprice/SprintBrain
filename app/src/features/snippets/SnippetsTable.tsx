import { useEffect, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileText, Loader2, Pin, Search, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { SnippetContextMenu } from '@/features/snippets/SnippetContextMenu';
import { SnippetRowActions } from '@/features/snippets/SnippetRowActions';
import {
  useFilteredSnippets,
  useSnippetStore,
} from '@/stores/snippetStore';
import type { SortColumn } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import type { Snippet, SnippetRow } from '@/types/database';
import { cn } from '@/lib/utils';

interface MenuState {
  snippetId: string;
  x: number;
  y: number;
}

/**
 * Language pill palette — matches the mobile companion app at
 * app/public/mobile/index.html. Defined inline so each language gets the
 * correct tint without bloating tailwind.config.ts with language tokens.
 */
const LANG_STYLE: Record<Snippet['language'], string> = {
  EN:    'bg-[#EEF2FF] text-[#1B4FD8]',
  ES:    'bg-[#FFF7ED] text-[#C2410C]',
  IT:    'bg-[#F0FDF4] text-[#15803D]',
  FR:    'bg-[#EEF2FF] text-[#1B4FD8]', // FR retired in v1.1 but kept until type union is cleaned up
  MULTI: 'bg-[#F5F3FF] text-[#7C3AED]',
};
const LANG_LABEL: Record<Snippet['language'], string> = {
  EN: 'EN', ES: 'ES', IT: 'IT', FR: 'FR', MULTI: 'Multi',
};

function LangPill({ lang }: { lang: Snippet['language'] }) {
  return (
    <span
      className={
        'inline-block rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ' +
        LANG_STYLE[lang]
      }
    >
      {LANG_LABEL[lang]}
    </span>
  );
}

/** Shortcut tag — `::` prefix at 0.45 opacity, trigger at full weight. */
function ShortcutTag({ trigger }: { trigger: string }) {
  return (
    <code className="inline-flex items-center rounded-md bg-primary-light px-2 py-0.5 font-mono text-xs font-semibold text-primary">
      <span className="font-normal opacity-45">::</span>
      <span>{trigger}</span>
    </code>
  );
}

function SortableColumnHeader({ column, label }: { column: SortColumn; label: string }) {
  const sortBy = useSnippetStore((s) => s.sortBy);
  const sortDir = useSnippetStore((s) => s.sortDir);
  const setSortBy = useSnippetStore((s) => s.setSortBy);
  const isActive = sortBy === column;
  const Icon = isActive ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;

  return (
    <button
      type="button"
      onClick={() => setSortBy(column)}
      className={cn(
        'inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider transition-colors',
        isActive ? 'text-primary' : 'text-ink-subtle hover:text-ink',
      )}
    >
      {label}
      <Icon className={cn('h-3 w-3', !isActive && 'opacity-40')} />
    </button>
  );
}

const PAGE_SIZE_OPTIONS = [10, 25, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export function SnippetsTable() {
  const rows = useFilteredSnippets();
  const loading = useSnippetStore((s) => s.loading);
  const shareSnippet = useSnippetStore((s) => s.shareSnippet);
  const unshareSnippet = useSnippetStore((s) => s.unshareSnippet);
  const sharingIds = useSnippetStore((s) => s.sharingIds);
  const query = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const setFolder = useSnippetStore((s) => s.setSelectedFolder);
  const setLanguageFilter = useSnippetStore((s) => s.setLanguageFilter);
  const selectedIds = useSnippetStore((s) => s.selectedIds);
  const toggleSelectSnippet = useSnippetStore((s) => s.toggleSelectSnippet);
  const selectAllSnippets = useSnippetStore((s) => s.selectAllSnippets);
  const clearSelection = useSnippetStore((s) => s.clearSelection);
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Pagination state
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Read filter state to reset to page 1 whenever the visible set changes
  const filterQuery = useSnippetStore((s) => s.searchQuery);
  const filterFolder = useSnippetStore((s) => s.selectedFolderId);
  const filterLang = useSnippetStore((s) => s.languageFilter);
  const filterSortBy = useSnippetStore((s) => s.sortBy);
  const filterSortDir = useSnippetStore((s) => s.sortDir);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterQuery, filterFolder, filterLang, filterSortBy, filterSortDir]);

  // Derived pagination values
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalRows);
  const pageRows = rows.slice(startIdx, endIdx);

  // Selection is scoped to the current page
  const allSelected = pageRows.length > 0 && pageRows.every((r) => selectedIds.has(r.id));
  const someSelected = !allSelected && pageRows.some((r) => selectedIds.has(r.id));

  const masterCheckboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const activeMenuSnippet: SnippetRow | null =
    menu !== null ? rows.find((r) => r.id === menu.snippetId) ?? null : null;

  if (loading && rows.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-12 animate-pulse rounded-[12px] border border-line bg-card"
          />
        ))}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Search}
        title="No snippets match your filters"
        description="Try a different folder or clear the search to see your full library."
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQuery('');
              setFolder(null);
              setLanguageFilter(null);
            }}
          >
            Clear filters
          </Button>
        }
      />
    );
  }

  async function handleShareToggle(e: React.MouseEvent, id: string, currentlyShared: boolean) {
    e.stopPropagation();
    try {
      if (currentlyShared) {
        await unshareSnippet(id);
      } else {
        await shareSnippet(id);
      }
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
  }

  function handleMasterChange() {
    if (allSelected) {
      clearSelection();
    } else {
      selectAllSnippets(pageRows.map((r) => r.id));
    }
  }

  // `overflow-clip` (Chromium 90+ / Safari 16+ / Firefox 102+) clips visually
  // without establishing a scroll container, which is what lets the sticky
  // <th> cells stick to <main>'s scroll position instead of being clipped here.
  return (
    <div className="overflow-clip rounded-[16px] border border-line bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left">
            {/* Master checkbox */}
            <th className="sticky top-0 z-10 w-10 border-b border-line bg-bg-alt px-3 py-3">
              <input
                ref={masterCheckboxRef}
                type="checkbox"
                checked={allSelected}
                onChange={handleMasterChange}
                aria-label="Select all visible snippets"
                className="h-4 w-4 cursor-pointer rounded accent-primary"
              />
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">
              <SortableColumnHeader column="name" label="Name" />
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Shortcut
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Lang
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Folder
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">
              <SortableColumnHeader column="updated_at" label="Updated" />
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3 text-right">
              <SortableColumnHeader column="usage_count" label="Usage" />
            </th>
            <th
              className="sticky top-0 z-10 border-b border-line bg-bg-alt px-4 py-3 text-center"
              title="Share this snippet with the team via Notion"
            >
              <Users className="mx-auto h-3.5 w-3.5 text-ink-subtle" />
            </th>
            <th
              className="sticky top-0 z-10 w-[96px] border-b border-line bg-bg-alt pl-2 pr-4 py-3"
              aria-label="Actions"
            />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, i) => {
            const trigger = row.triggers[0] ?? '';
            const isLast = i === pageRows.length - 1;
            const isSelected = selectedIds.has(row.id);
            return (
              <tr
                key={row.id}
                onClick={() => openEditSnippet(row.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ snippetId: row.id, x: e.clientX, y: e.clientY });
                }}
                className={cn(
                  !isLast && 'border-b border-line',
                  'group cursor-pointer',
                  isSelected
                    ? 'bg-primary-light hover:bg-primary-light/80'
                    : 'hover:bg-bg-alt/60',
                  // Soft-disabled snippets dim to ~50% so users can spot which
                  // rows are turned off at a glance without losing the data.
                  !row.is_active && 'opacity-50',
                )}
                title={!row.is_active ? 'Disabled — will not expand in the extension' : undefined}
              >
                {/* Checkbox cell */}
                <td
                  className="px-3 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelectSnippet(row.id)}
                    aria-label={`Select ${row.name}`}
                    className="h-4 w-4 cursor-pointer rounded accent-primary"
                  />
                </td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary-light text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate font-medium text-ink">
                        {row.pinned && (
                          <Pin
                            className="h-3 w-3 shrink-0 fill-primary text-primary"
                            aria-label="Pinned"
                          />
                        )}
                        <span className="truncate">{row.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                        {row.is_formula ? (
                          <Badge variant="primary">formula</Badge>
                        ) : null}
                        {row.tags.slice(0, 2).map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
                        {row.alternative_queries.slice(0, 3).map((q) => (
                          <span
                            key={q}
                            title={`Alternative query: ${q}`}
                            className="inline-block rounded-[4px] border border-primary-bdr bg-primary-bg px-1.5 py-px text-[9px] font-semibold text-primary/80"
                          >
                            {q}
                          </span>
                        ))}
                        {row.alternative_queries.length > 3 && (
                          <span
                            title={row.alternative_queries.slice(3).join(', ')}
                            className="inline-block rounded-[4px] bg-bg-alt px-1.5 py-px text-[9px] font-medium text-ink-subtle"
                          >
                            +{row.alternative_queries.length - 3}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <ShortcutTag trigger={trigger} />
                </td>
                <td className="px-5 py-3">
                  <LangPill lang={row.language} />
                </td>
                <td className="px-5 py-3 text-ink-muted">{row.folder_name ?? '—'}</td>
                <td className="px-5 py-3 text-ink-muted">
                  {formatDistanceToNow(new Date(row.updated_at), { addSuffix: true })}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs tabular-nums text-ink-muted">
                  {row.usage_count.toLocaleString()}
                </td>
                <td className="px-4 py-3 text-center">
                  {sharingIds.has(row.id) ? (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-ink-subtle" />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => void handleShareToggle(e, row.id, row.is_shared)}
                      aria-label={
                        row.is_shared
                          ? `Unshare ${row.name} from team`
                          : `Share ${row.name} with team`
                      }
                      title={
                        row.is_shared
                          ? 'Shared with team — click to unshare'
                          : 'Share with team via Notion'
                      }
                      className={
                        'inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors ' +
                        (row.is_shared
                          ? 'bg-primary-light text-primary hover:bg-danger/10 hover:text-danger'
                          : 'text-ink-subtle opacity-0 hover:bg-primary-light hover:text-primary focus-visible:opacity-100 group-hover:opacity-100')
                      }
                    >
                      <Users className="h-4 w-4" />
                    </button>
                  )}
                </td>
                <td
                  className="pl-2 pr-4 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SnippetRowActions snippet={row} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* Pagination footer — WordPress-style */}
      <div className="flex items-center justify-between gap-4 border-t border-line bg-bg-alt px-5 py-2.5">
        {/* Left: range + total */}
        <span className="text-xs text-ink-subtle tabular-nums">
          {totalRows === 0 ? '0 snippets' : (
            <>
              {startIdx + 1}–{endIdx} of {totalRows} snippet{totalRows === 1 ? '' : 's'}
              {query.trim().length > 0 ? ` matching "${query.trim()}"` : ''}
            </>
          )}
        </span>

        {/* Center: per-page selector */}
        <div className="flex items-center gap-1">
          {PAGE_SIZE_OPTIONS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => { setPageSize(n); setCurrentPage(1); }}
              className={cn(
                'min-w-[32px] rounded-[6px] px-2 py-1 text-xs font-medium tabular-nums transition-colors',
                pageSize === n
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:bg-line hover:text-ink',
              )}
              aria-label={`Show ${n} per page`}
              aria-pressed={pageSize === n}
            >
              {n}
            </button>
          ))}
          <span className="ml-1 text-xs text-ink-subtle">/ page</span>
        </div>

        {/* Right: prev / page indicator / next */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
            disabled={safePage === 1}
            aria-label="Previous page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors hover:bg-line hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-xs tabular-nums text-ink-subtle">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
            disabled={safePage === totalPages}
            aria-label="Next page"
            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-muted transition-colors hover:bg-line hover:text-ink disabled:pointer-events-none disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {menu !== null && activeMenuSnippet !== null && (
        <SnippetContextMenu
          snippet={activeMenuSnippet}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
