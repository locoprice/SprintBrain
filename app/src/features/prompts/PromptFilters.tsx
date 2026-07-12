import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Folders, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { FolderIcon } from '@/lib/folderIcons';
import { FolderShareBadge } from '@/features/org/FolderTree';
import { usePromptStore, useActiveFilterCount } from '@/stores/promptStore';
import type { Folder, IntentCategory, Prompt, StrategyType } from '@/types/database';

const STRATEGIES: StrategyType[] = ['CoT', 'ToT', 'Few-shot', 'One-shot', 'RAG', 'Agentic'];
const INTENTS: IntentCategory[] = ['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching'];

interface FilterDropdownProps<T extends string> {
  label: string;
  value: T | null;
  options: readonly T[];
  onSelect: (value: T | null) => void;
}

function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onSelect,
}: FilterDropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(option: T) {
    onSelect(option === value ? null : option);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium transition-colors',
          value
            ? 'border-primary/30 bg-primary-light text-primary'
            : 'border-line bg-card text-ink-muted hover:border-primary/20 hover:text-ink',
        )}
      >
        {value ?? label}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 w-44 animate-fade-in rounded-[12px] border border-line bg-card p-1.5 shadow-md"
        >
          {options.map((option) => {
            const active = option === value;
            return (
              <button
                key={option}
                role="menuitemradio"
                aria-checked={active}
                type="button"
                onClick={() => pick(option)}
                className={cn(
                  'flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-xs font-medium hover:bg-bg-alt',
                  active ? 'text-primary' : 'text-ink',
                )}
              >
                {option}
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Folders eligible for the chip row: those holding ≥1 prompt, plus the
 * currently selected one even at count 0 — an active filter must never
 * hide its own control.
 */
export function visiblePromptFolders(
  folders: Folder[],
  prompts: Prompt[],
  selectedFolderId: string | null,
): { folder: Folder; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    if (p.folder_id) counts.set(p.folder_id, (counts.get(p.folder_id) ?? 0) + 1);
  }
  return folders
    .filter((f) => (counts.get(f.id) ?? 0) > 0 || f.id === selectedFolderId)
    .map((f) => ({ folder: f, count: counts.get(f.id) ?? 0 }));
}

interface FolderChipProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: ReactNode;
  badge?: ReactNode;
}

function FolderChip({ active, onClick, label, count, icon, badge }: FolderChipProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors',
        active
          ? 'border-primary/30 bg-primary-light text-primary'
          : 'border-line bg-card text-ink-muted hover:border-primary/20 hover:text-ink',
      )}
    >
      {icon}
      <span className="max-w-[160px] truncate">{label}</span>
      {badge}
      <span
        className={cn(
          'text-[11px] font-semibold tabular-nums',
          active ? 'text-primary/70' : 'text-ink-subtle',
        )}
      >
        {count}
      </span>
    </button>
  );
}

/**
 * Folder filter chips. Folders are a shared container (snippets + prompts), so
 * only folders actually holding prompts render here — the snippet taxonomy
 * never shows up empty on this page. The selected folder stays visible even at
 * count 0 so an active filter can't hide its own control.
 */
function FolderChips() {
  const folders = usePromptStore((s) => s.folders);
  const folderShares = usePromptStore((s) => s.folderShares);
  const prompts = usePromptStore((s) => s.prompts);
  const selected = usePromptStore((s) => s.selectedFolderId);
  const setSelected = usePromptStore((s) => s.setSelectedFolder);

  const visible = useMemo(
    () => visiblePromptFolders(folders, prompts, selected),
    [folders, prompts, selected],
  );
  if (visible.length === 0) return null;

  return (
    <div role="group" aria-label="Filter by folder" className="flex items-center gap-1.5">
      <FolderChip
        active={selected === null}
        onClick={() => setSelected(null)}
        label="All prompts"
        count={prompts.length}
        icon={<Folders className="h-3.5 w-3.5 shrink-0" />}
      />
      {visible.map(({ folder, count }) => {
        const share = folderShares.get(folder.id);
        return (
          <FolderChip
            key={folder.id}
            active={selected === folder.id}
            onClick={() => setSelected(selected === folder.id ? null : folder.id)}
            label={folder.name}
            count={count}
            icon={<FolderIcon icon={folder.icon} className="h-3.5 w-3.5" />}
            badge={share ? <FolderShareBadge info={share} /> : undefined}
          />
        );
      })}
    </div>
  );
}

export const PromptFilters = memo(function PromptFilters() {
  const filters = usePromptStore((s) => s.filters);
  const setFilters = usePromptStore((s) => s.setFilters);
  const resetFilters = usePromptStore((s) => s.resetFilters);
  const activeCount = useActiveFilterCount();

  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-[10px] border border-line bg-card px-3 py-2">
      {/* Search */}
      <div className="relative w-full max-w-[280px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-subtle" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder="Search prompts…"
          className="h-8 w-full rounded-[10px] border border-line bg-card pl-8 pr-3 text-xs text-ink placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {filters.search && (
          <button
            type="button"
            onClick={() => setFilters({ search: '' })}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      <FolderChips />

      <FilterDropdown
        label="Strategy"
        value={filters.strategy}
        options={STRATEGIES}
        onSelect={(strategy) => setFilters({ strategy })}
      />
      <FilterDropdown
        label="Intent"
        value={filters.intent}
        options={INTENTS}
        onSelect={(intent) => setFilters({ intent })}
      />

      {/* Clear */}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={resetFilters}
          className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-ink-muted hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
          Clear {activeCount} filter{activeCount > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
});
