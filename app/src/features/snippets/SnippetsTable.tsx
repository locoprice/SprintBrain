import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileText, Loader2, Pin, Search, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { LabelBadgeList } from '@/components/shared/LabelBadge';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { DND_SNIPPET } from '@/features/org/FolderTree';
import { SnippetContextMenu } from '@/features/snippets/SnippetContextMenu';
import { SnippetRowActions } from '@/features/snippets/SnippetRowActions';
import {
  useFilteredSnippets,
  useSnippetStore,
} from '@/stores/snippetStore';
import type { SortColumn } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { useLabelStore } from '@/stores/labelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveLabels } from '@/lib/labelUtils';
import type { Snippet, SnippetLanguage, SnippetRow } from '@/types/database';
import {
  baseSnippetName,
  groupSnippetsByLanguage,
  resolveActiveLanguage,
  resolveActiveVariant,
  type SnippetGroup,
} from '@/lib/snippetGrouping';
import { DEFAULT_TRIGGER_CONFIG } from '@/lib/triggerUtils';
import {
  isTopByUsage,
  sumUsage,
  validateSnippet,
  type TemplateValidation,
} from '@/lib/statusSignals';
import { attributionTitle, useUserNameResolver } from '@/lib/useUserNames';
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
  FR:    'bg-[#F0FDFA] text-[#0D9488]',
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

/**
 * Language switcher for a grouped row. Renders one clickable pill per available
 * language; the active pill is highlighted with a ring. Clicking switches which
 * variant the row displays (name stays put — only the per-language metadata and
 * edit target change). Clicks are isolated so they never open the edit dialog.
 */
function LangSwitcher({
  group,
  activeLang,
  onSelect,
}: {
  group: SnippetGroup;
  activeLang: SnippetLanguage;
  onSelect: (lang: SnippetLanguage) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {group.languages.map((lang) => {
        const variant = group.byLang.get(lang);
        if (variant === undefined) return null;
        const isActive = lang === activeLang;
        return (
          <button
            key={lang}
            type="button"
            onClick={() => onSelect(lang)}
            aria-pressed={isActive}
            title={`Show ${LANG_LABEL[lang]} version`}
            className={cn(
              'rounded-[4px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-all',
              LANG_STYLE[lang],
              isActive
                ? 'ring-2 ring-primary/50 ring-offset-1 ring-offset-card'
                : 'opacity-50 hover:opacity-100',
            )}
          >
            {LANG_LABEL[lang]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Shortcut tag — two separate chips: a muted trigger chip (the configured
 * prefix) beside the shortcut chip. The trigger is a user setting, never
 * hardcoded (mirrors PromptBlockEditor). Stored triggers are mixed — some
 * already carry the prefix — so strip one leading occurrence to keep the two
 * chips clean and non-duplicated. See DESIGN_SYSTEM.md (shortcut tag).
 */
function ShortcutTag({ trigger }: { trigger: string }) {
  const snippetTrigger =
    useSettingsStore((s) => s.profile?.trigger_snippet_seq) ||
    DEFAULT_TRIGGER_CONFIG.snippetTrigger;
  const shortcut = trigger.startsWith(snippetTrigger)
    ? trigger.slice(snippetTrigger.length)
    : trigger;
  return (
    <span className="inline-flex items-center gap-1">
      <code className="inline-flex items-center rounded-md bg-bg-alt px-2 py-0.5 font-mono text-xs font-semibold text-ink-muted">
        {snippetTrigger}
      </code>
      <code className="inline-flex items-center rounded-md bg-primary-light px-2 py-0.5 font-mono text-xs font-semibold text-primary">
        {shortcut}
      </code>
    </span>
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
  // Collapse translated variants (sharing a base trigger) into one row each.
  const groups = useMemo(() => groupSnippetsByLanguage(rows), [rows]);
  const loading = useSnippetStore((s) => s.loading);
  // Status badges read the whole library, not the filtered page: "top" is
  // relative to every snippet the user owns, so paging or searching never
  // changes which rows earn the trophy. Compared group-to-group, since a
  // translated snippet's expansions are spread across its variant rows.
  const library = useSnippetStore((s) => s.snippets);
  const libraryMax = useMemo(
    () =>
      groupSnippetsByLanguage(library).reduce(
        (max, group) => Math.max(max, sumUsage(group.variants)),
        0,
      ),
    [library],
  );
  // Validate once per data change rather than once per render — the table
  // re-renders on every keystroke in the search box.
  const issues = useMemo(() => {
    const map = new Map<string, TemplateValidation>();
    for (const snippet of library) {
      const result = validateSnippet(snippet);
      if (!result.ok) map.set(snippet.id, result);
    }
    return map;
  }, [library]);
  const pushSnippetToNotion = useSnippetStore((s) => s.pushSnippetToNotion);
  const notionPushingIds = useSnippetStore((s) => s.notionPushingIds);
  const query = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const setFolder = useSnippetStore((s) => s.setSelectedFolder);
  const setLanguageFilter = useSnippetStore((s) => s.setLanguageFilter);
  const setLabelFilter = useSnippetStore((s) => s.setLabelFilter);
  const selectedIds = useSnippetStore((s) => s.selectedIds);
  const setSnippetsSelected = useSnippetStore((s) => s.setSnippetsSelected);
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  // Labels are per row, like every other per-language column here: switching a
  // grouped row's language switches which variant's labels it shows.
  const labelCatalog = useLabelStore((s) => s.labels);
  const labelAssignments = useLabelStore((s) => s.snippetLabels);
  const setSnippetLabels = useLabelStore((s) => s.setSnippetLabels);
  const resolveUserName = useUserNameResolver();
  const [menu, setMenu] = useState<MenuState | null>(null);

  // Active language variant per group key — drives which variant's metadata and
  // edit target a grouped row shows. Defaults (no entry) resolve to EN/master.
  const [activeByKey, setActiveByKey] = useState<Record<string, SnippetLanguage>>({});

  // Pagination state
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [currentPage, setCurrentPage] = useState(1);

  // Read filter state to reset to page 1 whenever the visible set changes
  const filterQuery = useSnippetStore((s) => s.searchQuery);
  const filterFolder = useSnippetStore((s) => s.selectedFolderId);
  const filterLang = useSnippetStore((s) => s.languageFilter);
  const filterLabels = useSnippetStore((s) => s.labelFilter);
  const filterSortBy = useSnippetStore((s) => s.sortBy);
  const filterSortDir = useSnippetStore((s) => s.sortDir);

  useEffect(() => {
    setCurrentPage(1);
  }, [filterQuery, filterFolder, filterLang, filterLabels, filterSortBy, filterSortDir]);

  // Derived pagination values — paginate over groups, not raw rows.
  const totalGroups = groups.length;
  const totalPages = Math.max(1, Math.ceil(totalGroups / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const endIdx = Math.min(startIdx + pageSize, totalGroups);
  const pageGroups = groups.slice(startIdx, endIdx);

  // Selection operates on the underlying snippet rows. Checking a grouped row
  // selects every language variant it represents, so bulk move/delete act on
  // the whole snippet. Scoped to the current page.
  const pageVariantIds = pageGroups.flatMap((g) => g.variants.map((v) => v.id));
  const allSelected =
    pageVariantIds.length > 0 && pageVariantIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && pageVariantIds.some((id) => selectedIds.has(id));

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
              setLabelFilter([]);
            }}
          >
            Clear filters
          </Button>
        }
      />
    );
  }

  async function handleNotionPush(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    try {
      await pushSnippetToNotion(id);
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
  }

  async function handleRemoveLabel(snippetId: string, labelId: string) {
    const current = labelAssignments.get(snippetId) ?? [];
    try {
      await setSnippetLabels(snippetId, current.filter((id) => id !== labelId));
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
  }

  function handleMasterChange() {
    setSnippetsSelected(pageVariantIds, !allSelected);
  }

  // The table is wider than its column on anything short of an ultrawide
  // screen — nine columns need ~1071px and get 411px at 1024px — so the card
  // is a scroll box, not a clip box. `overflow-clip` used to cut the last four
  // columns off with no way to reach them.
  //
  // Vertically it takes exactly the height of the rows it holds. It used to be
  // capped at calc(100vh-380px), which put a second scrollbar inside a page
  // that already scrolls, and how many rows are on screen is already the
  // reader's own choice — 10, 25 or 100 from the footer below.
  //
  // The cost, and it is the whole cost: the sticky <th> no longer pins. Sticky
  // resolves against the nearest scrollport, which is this element, and with no
  // cap it has no vertical scroll range to pin within. The classes stay because
  // they are correct the moment a cap comes back; today they do nothing, and
  // the header scrolls away with the page like any other table's.
  return (
    <div className="overflow-x-auto rounded-[16px] border border-line bg-card">
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
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-5">
              <SortableColumnHeader column="name" label="Name" />
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Shortcut
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Lang
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              Folder
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-5">
              <SortableColumnHeader column="updated_at" label="Updated" />
            </th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-5 text-right">
              <SortableColumnHeader column="usage_count" label="Usage" />
            </th>
            <th
              className="sticky top-0 z-10 border-b border-line bg-bg-alt px-3 py-3 2xl:px-4 text-center"
              title="Mirror snippets to your Notion database (not team sharing)"
            >
              <Send className="mx-auto h-3.5 w-3.5 text-ink-subtle" />
            </th>
            <th
              className="sticky top-0 z-10 w-[96px] border-b border-line bg-bg-alt pl-2 pr-4 py-3"
              aria-label="Actions"
            />
          </tr>
        </thead>
        <tbody>
          {pageGroups.map((group, i) => {
            // The active variant supplies every per-language column (shortcut,
            // lang, folder, updated, usage) and is the edit / push / action
            // target. The displayed name comes from the master and stays put
            // when the user switches language.
            const activeLang = resolveActiveLanguage(group, activeByKey[group.key]);
            const row = resolveActiveVariant(group, activeLang);
            const trigger = row.triggers[0] ?? '';
            const isLast = i === pageGroups.length - 1;
            const multiLang = group.languages.length > 1;
            const displayName = multiLang ? baseSnippetName(group.master.name) : group.master.name;
            const variantIds = group.variants.map((v) => v.id);
            const isSelected = variantIds.every((id) => selectedIds.has(id));
            // Any language variant failing breaks the snippet — including one
            // the row isn't currently showing, which is exactly the case a user
            // cannot spot on their own.
            let issue: TemplateValidation | undefined;
            for (const variant of group.variants) {
              issue = issues.get(variant.id);
              if (issue) break;
            }
            // Expansions across every language variant — the row represents the
            // whole group, so the count it shows has to as well.
            const groupUsage = sumUsage(group.variants);
            // Pin is a group property: any variant pinned marks the whole group.
            const groupPinned = group.variants.some((v) => v.pinned);
            return (
              <tr
                key={group.key}
                draggable
                onDragStart={(e) => {
                  // Dragging a row inside a multi-selection moves the whole
                  // selection; otherwise just this group's language variants.
                  const ids =
                    isSelected && selectedIds.size > 0 ? [...selectedIds] : variantIds;
                  e.dataTransfer.setData(DND_SNIPPET, ids.join(','));
                  e.dataTransfer.effectAllowed = 'move';
                }}
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
                {/* Checkbox cell — selects all language variants in the group */}
                <td
                  className="px-3 py-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => setSnippetsSelected(variantIds, !isSelected)}
                    aria-label={`Select ${displayName}`}
                    className="h-4 w-4 cursor-pointer rounded accent-primary"
                  />
                </td>
                <td className="px-3 py-3 2xl:px-5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary-light text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 truncate font-medium text-ink">
                        {groupPinned && (
                          <Pin
                            className="h-3 w-3 shrink-0 fill-primary text-primary"
                            aria-label="Pinned"
                          />
                        )}
                        <span className="truncate">{displayName}</span>
                        {issue !== undefined ? (
                          <StatusBadge status="broken" detail={issue.message} />
                        ) : isTopByUsage(groupUsage, libraryMax) ? (
                          <StatusBadge
                            status="top"
                            detail={`expanded ${groupUsage.toLocaleString()} times`}
                          />
                        ) : null}
                      </div>
                      <div className="flex items-center gap-1.5 pt-0.5 flex-wrap">
                        <LabelBadgeList
                          labels={resolveLabels(row.id, labelAssignments, labelCatalog)}
                          catalog={labelCatalog}
                          onRemove={(labelId) => void handleRemoveLabel(row.id, labelId)}
                        />
                        {row.is_formula ? (
                          <Badge variant="primary">formula</Badge>
                        ) : null}
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
                <td className="px-3 py-3 2xl:px-5">
                  <ShortcutTag trigger={trigger} />
                </td>
                <td className="px-3 py-3 2xl:px-5">
                  {multiLang ? (
                    <LangSwitcher
                      group={group}
                      activeLang={activeLang}
                      onSelect={(lang) =>
                        setActiveByKey((prev) => ({ ...prev, [group.key]: lang }))
                      }
                    />
                  ) : (
                    <LangPill lang={activeLang} />
                  )}
                </td>
                <td className="px-3 py-3 2xl:px-5 text-ink-muted">{row.folder_name ?? '—'}</td>
                <td
                  className="px-3 py-3 2xl:px-5 text-ink-muted"
                  title={attributionTitle(resolveUserName, row.user_id, row.updated_by, row.updated_at)}
                >
                  {formatDistanceToNow(new Date(row.updated_at), { addSuffix: true })}
                </td>
                <td
                  className="px-3 py-3 2xl:px-5 text-right font-mono text-xs tabular-nums text-ink-muted"
                  title={
                    multiLang
                      ? `${groupUsage.toLocaleString()} expansions across ${group.languages.length} languages`
                      : undefined
                  }
                >
                  {groupUsage.toLocaleString()}
                </td>
                <td className="px-3 py-3 2xl:px-4 text-center">
                  {notionPushingIds.has(row.id) ? (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-ink-subtle" />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => void handleNotionPush(e, row.id)}
                      aria-label={
                        row.notion_page_id
                          ? `Update ${displayName} in Notion`
                          : `Push ${displayName} to Notion`
                      }
                      title={
                        row.notion_page_id
                          ? 'Mirrored to your Notion database — click to update (not team sharing)'
                          : 'Mirror to your Notion database (not team sharing)'
                      }
                      className={
                        'inline-flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors ' +
                        (row.notion_page_id
                          ? 'bg-primary-light text-primary hover:bg-primary-light/70'
                          : 'text-ink-subtle opacity-0 hover:bg-primary-light hover:text-primary focus-visible:opacity-100 group-hover:opacity-100')
                      }
                    >
                      <Send className="h-4 w-4" />
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
          {totalGroups === 0 ? '0 snippets' : (
            <>
              {startIdx + 1}–{endIdx} of {totalGroups} snippet{totalGroups === 1 ? '' : 's'}
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
