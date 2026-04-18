import type { AnalyticsSummary } from '@/types/database';
import { mockAnalytics } from '@/mock/fixtures';
import { delay } from './_delay';

export interface AnalyticsApi {
  getSummary(): Promise<AnalyticsSummary>;
}

export const analyticsApi: AnalyticsApi = {
  getSummary: () => delay(mockAnalytics),
};
