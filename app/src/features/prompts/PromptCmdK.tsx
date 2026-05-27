import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { usePromptStore } from '@/stores/promptStore';
import { useUiStore } from '@/stores/uiStore';
import type { Prompt } from '@/types/database';

const MODEL_LABELS: Record<string, string> = {
  'claude-opus-4-7': 'Opus',
  'claude-sonnet-4-6': 'Sonnet',
  'claude-haiku-4-5': 'Haiku',
};

const STRATEGY_COLORS: Record<string, string> = {
  CoT: 'bg-[#EEF2FF] text-[#1B4FD8]',
  ToT: 'bg-[#F5F3FF] text-[#7C3AED]',
  'Few-shot': 'bg-[#F0FDF4] text-[#15803D]',
  'One-shot': 'bg-[#FFF7ED] text-[#C2410C]',
  RAG: 'bg-[#FFF1F2] text-[#BE123C]',
  Agentic: 'bg-[#0A0A0B] text-[#F5F5F5]',
};

function fuzzyMatch(text: string, query: string): boolean {
  if (!query) return true;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function getMatchScore(prompt: Prompt, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  let score = 0;
  if (prompt.name.toLowerCase().includes(q)) score += 3;
  else if (fuzzyMatch(prompt.name, q)) score += 1;
  if (prompt.tags.some((t) => t.toLowerCase().includes(q))) score += 2;
  if ((prompt.intent_category ?? '').toLowerCase().includes(q)) score += 1;
  return score;
}

export function PromptCmdK() {
  const isOpen = usePromptStore((s) => s.cmdKOpen);
  const setCmdKOpen = usePromptStore((s) => s.setCmdKOpen);
  const prompts = usePromptStore((s) => s.prompts);
  const openEditPrompt = useUiStore((s) => s.openEditPrompt);

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results =
    query.trim() === ''
      ? prompts.slice(0, 8)
      : prompts
          .map((p) => ({ prompt: p, score: getMatchScore(p, query) }))
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 8)
          .map((x) => x.prompt);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  function close() {
    setCmdKOpen(false);
  }

  function select(prompt: Prompt) {
    close();
    openEditPrompt(prompt.id);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (results[activeIndex]) select(results[activeIndex]);
    } else if (e.key === 'Escape') {
      close();
    }
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={close}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-full max-w-[560px] overflow-hidden rounded-[16px] border border-line bg-card shadow-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-label="Search prompts"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-ink-subtle" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-subtle"
          />
          <kbd className="hidden items-center gap-0.5 rounded-md border border-line bg-bg-alt px-1.5 py-0.5 font-mono text-[11px] text-ink-subtle sm:flex">
            <span>esc</span>
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[360px] overflow-y-auto py-2">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-subtle">
              No prompts match &ldquo;{query}&rdquo;
            </p>
          ) : (
            results.map((prompt, i) => {
              const strategyClass = prompt.strategy_type
                ? (STRATEGY_COLORS[prompt.strategy_type] ?? 'bg-bg-alt text-ink-muted')
                : null;
              return (
                <button
                  key={prompt.id}
                  type="button"
                  onClick={() => select(prompt)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === activeIndex ? 'bg-primary-light' : 'hover:bg-bg-alt'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{prompt.name}</p>
                    <p className="text-xs text-ink-subtle">
                      {[
                        prompt.intent_category,
                        prompt.preferred_model ? (MODEL_LABELS[prompt.preferred_model] ?? null) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  {prompt.strategy_type && strategyClass && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold ${strategyClass}`}
                    >
                      {prompt.strategy_type}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
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
            {results.length} result{results.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export function usePromptCmdKShortcut() {
  const setCmdKOpen = usePromptStore((s) => s.setCmdKOpen);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdKOpen(true);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setCmdKOpen]);
}
