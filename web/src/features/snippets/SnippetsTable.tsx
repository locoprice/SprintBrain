import { formatDistanceToNow } from 'date-fns';
import { FileText, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/layout/EmptyState';
import {
  useFilteredSnippets,
  useSnippetStore,
} from '@/stores/snippetStore';

export function SnippetsTable() {
  const rows = useFilteredSnippets();
  const loading = useSnippetStore((s) => s.loading);
  const query = useSnippetStore((s) => s.searchQuery);
  const setQuery = useSnippetStore((s) => s.setSearchQuery);
  const setFolder = useSnippetStore((s) => s.setSelectedFolder);

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

  return (
    <div className="overflow-hidden rounded-[16px] border border-line bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line bg-bg-alt text-left text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            <th className="px-5 py-3">Name</th>
            <th className="px-5 py-3">Shortcut</th>
            <th className="px-5 py-3">Folder</th>
            <th className="px-5 py-3">Updated</th>
            <th className="px-5 py-3 text-right">Usage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const trigger = row.triggers[0] ?? '';
            return (
              <tr
                key={row.id}
                className={
                  i === rows.length - 1
                    ? 'hover:bg-bg-alt/60'
                    : 'border-b border-line hover:bg-bg-alt/60'
                }
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-primary-light text-primary">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-ink">{row.name}</div>
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
                  <code className="rounded-md bg-primary-light px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                    ::{trigger}
                  </code>
                </td>
                <td className="px-5 py-3 text-ink-muted">{row.folder_name ?? '—'}</td>
                <td className="px-5 py-3 text-ink-muted">
                  {formatDistanceToNow(new Date(row.updated_at), { addSuffix: true })}
                </td>
                <td className="px-5 py-3 text-right font-mono text-xs text-ink-muted">
                  {row.usage_count.toLocaleString()}
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
    </div>
  );
}
