import { create } from 'zustand';
import type { SearchKind } from '@/lib/searchIndex';

// The one search query on the dashboard (SEARCH-001).
//
// Snippets, prompts and memory used to own a search box each, and the topbar
// carried a fourth that was never wired. One bar in the header now feeds all of
// them, so the query lives here rather than inside any one feature store.
//
// Two fields, not one, and the difference matters:
//
//   `input` is what the bar shows. It moves on every keystroke so typing never
//   feels laggy.
//   `query` is what the lists filter on. It follows `input` after a pause, so a
//   thousand-row table is not re-filtered per character.
//
// Splitting them also keeps the header bar and the palette's own input showing
// the same text: both render `input`, both write through `setInput`. A single
// field with a local echo per component would let the two drift apart the
// moment one of them edited the query.

/** Matches the pause the per-page search fields used, so the feel is unchanged. */
const DEBOUNCE_MS = 300;

/** Which type the panel lists. `all` keeps every group. Typing always filters the page in view. */
export type SearchTypeFilter = 'all' | SearchKind;

interface SearchStore {
  /** What the bar shows. Instant. */
  input: string;
  /** What the lists filter on. Trails `input` by `DEBOUNCE_MS`. */
  query: string;
  /** The aggregated, cross-type results panel. */
  paletteOpen: boolean;
  /** The panel's type filter. All by default: the panel exists to look wide. */
  typeFilter: SearchTypeFilter;

  /** Type a character. Schedules the commit to `query`. */
  setInput: (next: string) => void;
  /** Apply `input` now, without waiting. Enter and the palette use this. */
  commit: () => void;
  /** Empty both fields. The "Clear filters" actions and section changes use this. */
  clear: () => void;
  setTypeFilter: (filter: SearchTypeFilter) => void;
  openPalette: () => void;
  closePalette: () => void;
}

// Module-scope because the timer belongs to the store, not to whichever
// component happened to render the bar. Cancelled by every path that writes
// `query` directly, so a pending keystroke can never land after a clear.
let timer: ReturnType<typeof setTimeout> | null = null;

function cancel(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  input: '',
  query: '',
  paletteOpen: false,
  typeFilter: 'all',

  setInput: (next) => {
    set({ input: next });
    cancel();
    timer = setTimeout(() => {
      timer = null;
      set({ query: get().input });
    }, DEBOUNCE_MS);
  },

  commit: () => {
    cancel();
    set({ query: get().input });
  },

  clear: () => {
    cancel();
    // The type filter goes with the text. A filter left armed over an empty box
    // would silently hide results from the next search.
    set({ input: '', query: '', typeFilter: 'all' });
  },

  setTypeFilter: (typeFilter) => set({ typeFilter }),

  openPalette: () => {
    // Opening applies whatever is half-typed: the panel is the same query read
    // wider, so it must not show results for the previous keystroke.
    cancel();
    set({ query: get().input, paletteOpen: true });
  },

  closePalette: () => set({ paletteOpen: false }),
}));
