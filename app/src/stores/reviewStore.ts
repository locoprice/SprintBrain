import { create } from 'zustand';
import { reviewApi, type ReviewItem } from '@/lib/api/reviewApi';
import { WAITING_STATUSES, type ReviewStatus } from '@/lib/reviewStatus';
import { useMemoryStore } from '@/stores/memoryStore';
import { usePromptStore } from '@/stores/promptStore';
import { useSnippetStore } from '@/stores/snippetStore';

// The Review page's list (AI-KNOWLEDGE P2): every snippet, prompt and Brain
// item that is not approved, in one shape. The sidebar reads the waiting count
// from here, so it loads once per session and refreshes after any status
// change made through the shared status menu.

interface ReviewStore {
  items: ReviewItem[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  /** Fetch the list. Safe to call repeatedly; concurrent calls share one fetch. */
  load: () => Promise<void>;
  /** Re-fetch only if a list was already loaded (keeps the sidebar count honest). */
  refreshIfLoaded: () => Promise<void>;
  /** Change one item's status from the Review page. Rejects with the server's reason. */
  setStatus: (item: ReviewItem, status: ReviewStatus) => Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useReviewStore = create<ReviewStore>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,

  load: () => {
    if (inflight) return inflight;
    set({ loading: true, error: null });
    inflight = reviewApi
      .listNotApproved()
      .then((items) => set({ items, loaded: true, loading: false }))
      .catch((err: unknown) =>
        set({
          loading: false,
          error: err instanceof Error ? err.message : 'Could not load the review list.',
        }),
      )
      .finally(() => {
        inflight = null;
      });
    return inflight;
  },

  refreshIfLoaded: async () => {
    if (get().loaded) await get().load();
  },

  setStatus: async (item, status) => {
    // Through the section's own store when it holds the row, so its list and
    // badges change too, and a translated snippet changes as one group, the
    // way it does from the editor.
    if (item.kind === 'snippet' && useSnippetStore.getState().snippets.some((s) => s.id === item.id)) {
      await useSnippetStore.getState().setReviewStatus(item.id, status);
    } else if (item.kind === 'prompt' && usePromptStore.getState().prompts.some((p) => p.id === item.id)) {
      await usePromptStore.getState().setReviewStatus(item.id, status);
    } else if (item.kind === 'memory' && useMemoryStore.getState().items.some((i) => i.id === item.id)) {
      await useMemoryStore.getState().setReviewStatus(item.id, status);
    } else {
      await reviewApi.setStatus(item.kind, item.id, status);
    }
    await get().load();
  },
}));

/** How many items wait for a person: the sidebar's count. */
export function countWaiting(items: readonly ReviewItem[]): number {
  return items.filter((i) => WAITING_STATUSES.includes(i.review_status)).length;
}
