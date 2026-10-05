import { create } from 'zustand';
import type { DraftKind, DraftResult } from '@/lib/aiDraft';

// An AI update handed from one editor to another (AI-KNOWLEDGE P3).
//
// A new draft can turn out to repeat an item that already exists. "Update it
// instead" drafts that item's update in the editor the person is in, then
// closes it and opens the existing item's editor, which takes the update from
// here and shows it, unsaved. One slot: only the editor opening that item takes
// it, and taking it clears it.

interface HandedDraft {
  targetId: string;
  result: DraftResult;
}

interface DraftState {
  handed: HandedDraft | null;
  hand: (targetId: string, result: DraftResult) => void;
  /** The update waiting for this item, once. Null when there is none. */
  take: (kind: DraftKind, targetId: string) => DraftResult | null;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  handed: null,

  hand: (targetId, result) => set({ handed: { targetId, result } }),

  take: (kind, targetId) => {
    const handed = get().handed;
    if (!handed || handed.targetId !== targetId || handed.result.kind !== kind) return null;
    set({ handed: null });
    return handed.result;
  },
}));
