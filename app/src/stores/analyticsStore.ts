import { create } from 'zustand';
import type { ActivityData, AnalyticsSummary } from '@/types/database';
import { analyticsApi } from '@/lib/api/analyticsApi';

interface AnalyticsStore {
  summary: AnalyticsSummary | null;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  activity: ActivityData | null;
  activityLoading: boolean;
  loadActivity: () => Promise<void>;
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
  activity: null,
  activityLoading: false,
  loadActivity: async () => {
    set({ activityLoading: true });
    try {
      const activity = await analyticsApi.getActivity();
      set({ activity, activityLoading: false });
    } catch (err) {
      set({
        activityLoading: false,
        error: err instanceof Error ? err.message : 'Failed to load activity',
      });
    }
  },
}));
