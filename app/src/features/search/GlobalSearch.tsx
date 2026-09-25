import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Search, Sparkles, Type } from 'lucide-react';
import {
  labelNameLookup,
  searchAll,
  type SearchHit,
  type SearchKind,
  type SearchResults,
} from '@/lib/searchIndex';
import { useLabelStore } from '@/stores/labelStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSearchStore } from '@/stores/searchStore';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';

// The aggregated half of the one search bar (SEARCH-001).
//
// Typing filters the page you are on. Enter, or ⌘K from anywhere, opens this:
// the same query read across all three libraries at once, grouped by type. It
// replaced a palette that only ever searched prompts and only existed on the
// prompts page.
//
// It loads whatever has not been fetched yet. Searching from the snippets page
// on a fresh session has to find prompts, and prompts only load when their own
// page mounts.

// One row of type chips decides how wide the panel looks. A separate scope
// switch used to sit beside it, but "this section" gave the same answer as the
// section's own chip, and the header bar already filters the page (or Brain)
// you are on.
const TYPE_CHIPS: Array<{ value: 'all' | SearchKind; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'snippet', label: 'Snippets' },
  { value: 'prompt', label: 'Prompts' },
  { value: 'memory', label: 'Brains' },
];

const GROUPS = [
  { key: 'snippets', label: 'Snippets', icon: Type },
  { key: 'prompts', label: 'Prompts', icon: Sparkles },
  { key: 'memory', label: 'Brains', icon: Brain },
] as const;

export function GlobalSearch() {
  const open = useSearchStore((s) => s.paletteOpen);
  const close = useSearchStore((s) => s.closePalette);
  const typeFilter = useSearchStore((s) => s.typeFilter);
  const setTypeFilter = useSearchStore((s) => s.setTypeFilter);
  const input = useSearchStore((s) => s.input);
  const query = useSearchStore((s) => s.query);
  const setInput = useSearchStore((s) => s.setInput);

  const snippets = useSnippetStore((s) => s.snippets);
  const loadSnippets = useSnippetStore((s) => s.load);
  const prompts = usePromptStore((s) => s.prompts);
  const loadPrompts = usePromptStore((s) => s.load);
  const spaces = useMemoryStore((s) => s.spaces);
  const memoryLoaded = useMemoryStore((s) => s.loaded);
  const loadSpaces = useMemoryStore((s) => s.loadSpaces);
  const allItems = useMemoryStore((s) => s.allItems);
  const loadAllItems = useMemoryStore((s) => s.loadAllItems);

  const labels = useLabelStore((s) => s.labels);
  const snippetLabels = useLabelStore((s) => s.snippetLabels);
  const promptLabels = useLabelStore((s) => s.promptLabels);
  const labelsLoaded = useLabelStore((s) => s.loaded);
  const loadLabels = useLabelStore((s) => s.load);

  const openEditSnippet = useUiStore((s) => s.openEditSnippet);
  const openEditPrompt = useUiStore((s) => s.openEditPrompt);
  const navigate = useNavigate();

  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Everything the panel reads, fetched the first time it is opened. Each store
  // guards its own refetch, so this is safe to call on every open.
  useEffect(() => {
    if (!open) return;
    if (snippets.length === 0) void loadSnippets();
    if (prompts.length === 0) void loadPrompts();
    if (!memoryLoaded) void loadSpaces();
    if (!labelsLoaded) void loadLabels();
    void loadAllItems();
  }, [
    open,
    snippets.length,
    prompts.length,
    memoryLoaded,
    labelsLoaded,
    loadSnippets,
    loadPrompts,
    loadSpaces,
    loadLabels,
    loadAllItems,
  ]);

  useEffect(() => {
    if (open) {
      setActiveIndex(0);
      // The bar in the header keeps its own focus ring; the panel takes over
      // typing while it is up.
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  const results = useMemo(() => {
    const snippetNames = labelNameLookup(labels, snippetLabels);
    const promptNames = labelNameLookup(labels, promptLabels);
    return searchAll(
      {
        snippets,
        prompts,
        spaces,
        items: allItems,
        snippetLabels: snippetNames,
        promptLabels: promptNames,
      },
      query,
    );
  }, [snippets, prompts, spaces, allItems, labels, snippetLabels, promptLabels, query]);

  // The type chips narrow what was already matched rather than re-running the
  // search: the rules for what matches live in one place, and the chips only
  // decide how much of the answer is shown.
  const shown: SearchResults = useMemo(() => {
    const keep = (kind: SearchKind): boolean => typeFilter === 'all' || typeFilter === kind;
    const snippetHits = keep('snippet') ? results.snippets : [];
    const promptHits = keep('prompt') ? results.prompts : [];
    const memoryHits = keep('memory') ? results.memory : [];
    return {
      snippets: snippetHits,
      prompts: promptHits,
      memory: memoryHits,
      total: snippetHits.length + promptHits.length + memoryHits.length,
    };
  }, [results, typeFilter]);

  // One flat list behind the grouped display, so the arrow keys walk the panel
  // top to bottom rather than per group.
  const flat: SearchHit[] = useMemo(
    () => [...shown.snippets, ...shown.prompts, ...shown.memory],
    [shown],
  );

  if (!open) return null;

  function select(hit: SearchHit) {
    close();
    if (hit.kind === 'snippet') {
      navigate('/');
      openEditSnippet(hit.id);
    } else if (hit.kind === 'prompt') {
      navigate('/prompts');
      openEditPrompt(hit.id);
    } else {
      navigate(`/memory/${hit.spaceId ?? hit.id}`);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = flat[activeIndex];
      if (hit) select(hit);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      // Closes the panel only. The query stays in the header bar, still
      // filtering the page underneath, which is where it came from.
      close();
    }
  }

  let cursor = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={close}>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-[16px] border border-line bg-card shadow-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-label="Search everything"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search snippets, prompts and memory…"
            aria-label="Search snippets, prompts and memory"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
          />
          <kbd className="hidden items-center gap-0.5 rounded-md border border-line bg-bg-alt px-1.5 py-0.5 font-mono text-[11px] text-ink-subtle sm:flex">
            esc
          </kbd>
        </div>

        {/* The bar filters the page you are on whatever these say; these
            decide how wide the panel below looks. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
          {TYPE_CHIPS.map((chip) => (
            <button
              key={chip.value}
              type="button"
              onClick={() => setTypeFilter(chip.value)}
              aria-pressed={typeFilter === chip.value}
              className={cn(
                'rounded-[6px] px-2 py-1 text-xs font-medium transition-colors',
                typeFilter === chip.value
                  ? 'bg-primary text-white'
                  : 'text-ink-muted hover:bg-bg-alt',
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="max-h-[360px] overflow-y-auto py-2">
          {query.trim() === '' ? (
            <p className="px-4 py-6 text-center text-sm text-ink-subtle">
              Type to search across snippets, prompts and memory.
            </p>
          ) : shown.total === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-subtle">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            GROUPS.map(({ key, label, icon: Icon }) => {
              const hits = shown[key];
              if (hits.length === 0) return null;
              return (
                <div key={key} className="mb-1 last:mb-0">
                  <div className="flex items-center gap-1.5 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    <Icon className="h-3 w-3" />
                    {label}
                    <span className="font-normal normal-case tracking-normal">
                      ({hits.length})
                    </span>
                  </div>
                  {hits.map((hit) => {
                    const index = cursor;
                    cursor += 1;
                    return (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        type="button"
                        onClick={() => select(hit)}
                        onMouseEnter={() => setActiveIndex(index)}
                        className={cn(
                          'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors',
                          index === activeIndex ? 'bg-primary-light' : 'hover:bg-bg-alt',
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-ink">{hit.name}</p>
                          {hit.detail ? (
                            <p className="truncate text-xs text-ink-subtle">{hit.detail}</p>
                          ) : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line px-4 py-2">
          <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
            <kbd className="rounded border border-line bg-bg-alt px-1 font-mono">↑↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1 text-[11px] text-ink-subtle">
            <kbd className="rounded border border-line bg-bg-alt px-1 font-mono">↵</kbd>
            open
          </span>
          <span className="ml-auto text-[11px] text-ink-subtle">
            {shown.total} result{shown.total !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
