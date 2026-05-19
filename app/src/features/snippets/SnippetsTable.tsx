import { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { FileText, Loader2, Pin, Search, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import { SnippetContextMenu } from '@/features/snippets/SnippetContextMenu';
import {
  useFilteredSnippets,
  useSnippetStore,
} from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import type { Snippet, SnippetRow } from '@/types/database';

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

export function SnippetsTable() {
  const rows = useFilteredSnippets();
  const loading = useSnippetStore((s) => s.loading);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);
  const shareSnippet = useSnippetStore((s) => s.shareSnippet);
  const unshareSnippet = useSnippetStore((s) => s.unshareSnippet);
  const sharingIds = useSnippetStore((s) => s.sharingIds);
  const query = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const setFolder = useSnippetStore((s) => s.setSelectedFolder);
  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const [menu, setMenu] = useState<MenuState | null>(null);

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
            }}
          >
            Clear filters
          </Button>
        }
      />
    );
  }

  async function handleDelete(id: string) {
    try {
      await removeSnippet(id);
    } catch {
      // Error surfaces via store.error → page-level banner.
    }
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

  // `overflow-clip` (Chromium 90+ / Safari 16+ / Firefox 102+) clips visually
  // without establishing a scroll container, which is what lets the sticky
  // <th> cells stick to <main>'s scroll position instead of being clipped here.
  return (
    <div className="overflow-clip rounded-[16px] border border-line bg-card">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">Name</th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">Shortcut</th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">Lang</th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">Folder</th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3">Updated</th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-5 py-3 text-right">Usage</th>
            <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-4 py-3 text-center" title="Share this snippet with the team via Notion">
              <Users className="mx-auto h-3.5 w-3.5" />
            </th>
            <th className="sticky top-0 z-10 w-10 border-b border-line bg-bg-alt px-2 py-3" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const trigger = row.triggers[0] ?? '';
            const isLast = i === rows.length - 1;
            return (
              <tr
                key={row.id}
                onClick={() => openEditSnippet(row.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ snippetId: row.id, x: e.clientX, y: e.clientY });
                }}
                className={
                  (isLast ? '' : 'border-b border-line ') +
                  'group cursor-pointer hover:bg-bg-alt/60'
                }
              >
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
                      <div className="flex items-center gap-1.5 pt-0.5">
                        {row.is_formula ? (
                          <Badge variant="primary">formula</Badge>
                        ) : null}
                        {row.tags.slice(0, 2).map((t) => (
                          <Badge key={t} variant="outline">
                            {t}
                          </Badge>
                        ))}
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
                <td className="px-2 py-3 text-right">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(row.id);
                    }}
                    aria-label={`Delete ${row.name}`}
                    title={`Delete ${row.name}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-subtle opacity-0 transition-opacity hover:bg-danger/10 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="border-t border-line bg-bg-alt px-5 py-2.5 text-xs text-ink-subtle">
        {rows.length} snippet{rows.length === 1 ? '' : 's'}
        {query.trim().length > 0 ? ` matching "${query.trim()}"` : ''}
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
