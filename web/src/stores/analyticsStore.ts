import { create } from 'zustand';
import type { AnalyticsSummary } from '@/types/database';
import { analyticsApi } from '@/lib/api/analyticsApi';

interface AnalyticsStore {
  summary: AnalyticsSummary | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
}

export const useAnalyticsStore = create<AnalyticsStore>((set) => ({
  summary: null,
  loading: false,
  error: null,
  load: async () => {
    set({ loading: true, error: null });
    try {
      const summary = await analyticsApi.getSummary();
      set({ summary, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load analytics',
      });
    }
  },
}));
