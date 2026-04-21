import type { AnalyticsSummary } from '@/types/database';
import { mockAnalytics } from '@/mock/fixtures';
import { delay } from './_delay';

// TODO (ANALYTICS-001): live aggregation.
//
// The `snippet_stats` table stores aggregate counters (uses, fills,
// last_used) — no per-event log. The dashboard's AnalyticsSummary shape
// expects a 14-day daily_usage histogram and per-trigger 14-day trend
// sparklines, neither of which are derivable from aggregate data alone.
// Plan:
//   1. Add `snippet_events` table (snippet_id, user_id, trigger, used_at).
//   2. Extension + dashboard log one row per successful trigger.
//   3. Replace this file with grouped/aggregated queries over that table.

export interface AnalyticsApi {
  getSummary(): Promise<AnalyticsSummary>;
}

export const analyticsApi: AnalyticsApi = {
  getSummary: () => delay(mockAnalytics),
};
