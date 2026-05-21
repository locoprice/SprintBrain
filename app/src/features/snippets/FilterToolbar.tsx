import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useSnippetStore } from '@/stores/snippetStore';
import type { SortColumn } from '@/stores/snippetStore';
import type { Snippet } from '@/types/database';
import { cn } from '@/lib/utils';

const LANGUAGE_CHIPS: Array<{ value: Snippet['language']; label: string }> = [
  { value: 'EN',    label: 'EN' },
  { value: 'ES',    label: 'ES' },
  { value: 'IT',    label: 'IT' },
  { value: 'MULTI', label: 'Multi' },
];

const SORT_COLUMNS: Array<{ value: SortColumn; label: string }> = [
  { value: 'name',        label: 'Name' },
  { value: 'updated_at',  label: 'Updated' },
  { value: 'usage_count', label: 'Usage' },
];

export function FilterToolbar() {
  const languageFilter = useSnippetStore((s) => s.languageFilter);
  const setLanguageFilter = useSnippetStore((s) => s.setLanguageFilter);
  const sortBy = useSnippetStore((s) => s.sortBy);
  const sortDir = useSnippetStore((s) => s.sortDir);
  const setSortBy = useSnippetStore((s) => s.setSortBy);

  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2">
      {/* Language filter chips */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setLanguageFilter(null)}
          className={cn(
            'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
            languageFilter === null
              ? 'bg-primary text-white'
              : 'text-ink-muted hover:bg-bg-alt',
          )}
        >
          All
        </button>
        {LANGUAGE_CHIPS.map((chip) => (
          <button
            key={chip.value}
            type="button"
            onClick={() =>
              setLanguageFilter(chip.value === languageFilter ? null : chip.value)
            }
            className={cn(
              'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
              languageFilter === chip.value
                ? 'bg-primary text-white'
                : 'text-ink-muted hover:bg-bg-alt',
            )}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
          Sort
        </span>
        {SORT_COLUMNS.map((col) => {
          const isActive = sortBy === col.value;
          const Icon = isActive
            ? sortDir === 'asc'
              ? ArrowUp
              : ArrowDown
            : ArrowUpDown;
          return (
            <button
              key={col.value}
              type="button"
              onClick={() => setSortBy(col.value)}
              className={cn(
                'flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs transition-colors',
                isActive
                  ? 'bg-primary-light font-medium text-primary'
                  : 'text-ink-muted hover:bg-bg-alt',
              )}
            >
              {col.label}
              <Icon className="h-3 w-3" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
