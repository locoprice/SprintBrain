import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Command, Search, X } from 'lucide-react';
import { useSearchStore } from '@/stores/searchStore';

// The one search bar (SEARCH-001).
//
// Snippets, prompts and memory each used to carry their own box. This one sits
// in the header and does both readings of the same text: typing filters the page
// you are on, Enter or ⌘K opens the panel that looks across all three.
//
// It lives in the topbar, which mounts once for the whole dashboard, so the
// query survives navigation unless this component clears it.

/**
 * What the bar says it will search, given where you are.
 *
 * Exported for its test. The wording follows one pattern with the noun swapped,
 * the way the three sections word everything else.
 */
export function searchPlaceholder(pathname: string): string {
  if (pathname === '/') return 'Search snippets…';
  if (pathname.startsWith('/prompts')) return 'Search prompts…';
  // A space's own page filters the notes inside it; the index filters spaces.
  if (/^\/memory\/[^/]+/.test(pathname)) return 'Search this space…';
  if (pathname.startsWith('/memory')) return 'Search spaces…';
  return 'Search everything…';
}

export function MasterSearch() {
  const { pathname } = useLocation();
  const input = useSearchStore((s) => s.input);
  const setInput = useSearchStore((s) => s.setInput);
  const clear = useSearchStore((s) => s.clear);
  const openPalette = useSearchStore((s) => s.openPalette);
  const inputRef = useRef<HTMLInputElement>(null);

  // Each section starts clean. Carrying "invoice" from snippets into prompts
  // would land you on a filtered page that reads as an empty one.
  useEffect(() => {
    clear();
  }, [pathname, clear]);

  // ⌘K from anywhere. It used to open a prompts-only palette from the prompts
  // page; it now opens the one panel from every page.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openPalette]);

  return (
    <div className="relative min-w-0 flex-1 md:max-w-[360px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle" />
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && input.trim() !== '') {
            e.preventDefault();
            openPalette();
          } else if (e.key === 'Escape' && input !== '') {
            e.preventDefault();
            clear();
          }
        }}
        aria-label={searchPlaceholder(pathname)}
        placeholder={searchPlaceholder(pathname)}
        className="h-9 w-full rounded-[10px] border border-line bg-bg-alt pl-9 pr-12 text-sm text-ink placeholder:text-ink-subtle focus:border-primary focus:bg-card focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
      {input === '' ? (
        <kbd className="pointer-events-none absolute right-2 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded-md border border-line bg-card px-1.5 text-[11px] font-medium text-ink-subtle">
          <Command className="h-3 w-3" />
          K
        </kbd>
      ) : (
        <button
          type="button"
          onClick={() => {
            clear();
            inputRef.current?.focus();
          }}
          aria-label="Clear search"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle transition-colors hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
