import { memo } from 'react';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePromptStore, useActiveFilterCount, type PromptFilters as PromptFilterState } from '@/stores/promptStore';
import type {
  StrategyType,
  IntentCategory,
  PreferredModel,
  ComplexityLevel,
  OutputType,
} from '@/types/database';

const STRATEGIES: StrategyType[] = ['CoT', 'ToT', 'Few-shot', 'One-shot', 'RAG', 'Agentic'];
const INTENTS: IntentCategory[] = ['Writing', 'Coding', 'Support', 'SEO', 'Analysis', 'Planning', 'Research', 'Teaching'];
const MODELS: { value: PreferredModel; label: string }[] = [
  { value: 'claude-opus-4-7', label: 'Opus' },
  { value: 'claude-sonnet-4-6', label: 'Sonnet' },
  { value: 'claude-haiku-4-5', label: 'Haiku' },
];
const COMPLEXITIES: ComplexityLevel[] = ['simple', 'medium', 'complex'];
const OUTPUT_TYPES: OutputType[] = ['JSON', 'Markdown', 'SOP', 'Plain'];

interface ChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

const Chip = memo(function Chip({ label, active, onClick }: ChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors',
        active
          ? 'border-primary/30 bg-primary-light text-primary'
          : 'border-line bg-card text-ink-muted hover:border-primary/20 hover:text-ink',
      )}
    >
      {label}
    </button>
  );
});

interface FilterGroupProps {
  label: string;
  children: React.ReactNode;
}

function FilterGroup({ label, children }: FilterGroupProps) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-ink-subtle">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export const PromptFilters = memo(function PromptFilters() {
  const filters = usePromptStore((s) => s.filters);
  const setFilters = usePromptStore((s) => s.setFilters);
  const resetFilters = usePromptStore((s) => s.resetFilters);
  const activeCount = useActiveFilterCount();

  function toggle<K extends keyof PromptFilterState>(key: K, value: PromptFilterState[K]) {
    setFilters({ [key]: filters[key] === value ? null : value } as Partial<PromptFilterState>);
  }

  return (
    <aside className="flex w-52 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-bg-alt px-4 py-6">
      {/* Search */}
      <div className="relative">
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

      {/* Strategy */}
      <FilterGroup label="Strategy">
        {STRATEGIES.map((s) => (
          <Chip
            key={s}
            label={s}
            active={filters.strategy === s}
            onClick={() => toggle('strategy', s)}
          />
        ))}
      </FilterGroup>

      {/* Intent */}
      <FilterGroup label="Intent">
        {INTENTS.map((i) => (
          <Chip
            key={i}
            label={i}
            active={filters.intent === i}
            onClick={() => toggle('intent', i)}
          />
        ))}
      </FilterGroup>

      {/* Model */}
      <FilterGroup label="Model">
        {MODELS.map((m) => (
          <Chip
            key={m.value}
            label={m.label}
            active={filters.model === m.value}
            onClick={() => toggle('model', m.value)}
          />
        ))}
      </FilterGroup>

      {/* Complexity */}
      <FilterGroup label="Complexity">
        {COMPLEXITIES.map((c) => (
          <Chip
            key={c}
            label={c}
            active={filters.complexity === c}
            onClick={() => toggle('complexity', c)}
          />
        ))}
      </FilterGroup>

      {/* Output type */}
      <FilterGroup label="Output">
        {OUTPUT_TYPES.map((o) => (
          <Chip
            key={o}
            label={o}
            active={filters.outputType === o}
            onClick={() => toggle('outputType', o)}
          />
        ))}
      </FilterGroup>

      {/* Clear */}
      {activeCount > 0 && (
        <button
          type="button"
          onClick={resetFilters}
          className="mt-auto flex items-center gap-1.5 text-xs text-ink-muted hover:text-danger"
        >
          <X className="h-3.5 w-3.5" />
          Clear {activeCount} filter{activeCount > 1 ? 's' : ''}
        </button>
      )}
    </aside>
  );
});
