import { supabase } from '@/lib/supabase';
import type { AnalyticsSummary, TopTrigger, UsagePoint } from '@/types/database';

// Live aggregation over public.snippet_events. The extension writes one row per
// successful snippet expansion (ANALYTICS-001). We pull the last 14 days,
// bucket client-side, and shape into the AnalyticsSummary the page expects.
//
// When usage outgrows in-process aggregation (~ a few thousand events / 14d),
// move this to a Postgres RPC.

export interface AnalyticsApi {
  getSummary(): Promise<AnalyticsSummary>;
}

const WINDOW_DAYS = 14;
const SECONDS_SAVED_PER_TRIGGER = 30;

type EventRow = { shortcut: string; created_at: string };

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

function dayKey(iso: string): string {
  // YYYY-MM-DD in the user's local timezone — matches the chart's axis labels.
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildDayRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    out.push(dayKey(d.toISOString()));
  }
  return out;
}

function aggregate(events: EventRow[], totalSnippets: number): AnalyticsSummary {
  const days = buildDayRange(WINDOW_DAYS);
  const dayIndex = new Map(days.map((d, i) => [d, i]));

  const dailyCounts = new Array<number>(WINDOW_DAYS).fill(0);
  const perShortcutDaily = new Map<string, number[]>();
  const perShortcutTotal = new Map<string, number>();

  for (const ev of events) {
    const k = dayKey(ev.created_at);
    const idx = dayIndex.get(k);
    if (idx === undefined) continue; // outside window guard
    dailyCounts[idx] = (dailyCounts[idx] ?? 0) + 1;

    const sc = ev.shortcut || '';
    perShortcutTotal.set(sc, (perShortcutTotal.get(sc) ?? 0) + 1);
    let arr = perShortcutDaily.get(sc);
    if (!arr) {
      arr = new Array<number>(WINDOW_DAYS).fill(0);
      perShortcutDaily.set(sc, arr);
    }
    arr[idx] = (arr[idx] ?? 0) + 1;
  }

  const daily_usage: UsagePoint[] = days.map((date, i) => ({
    date,
    count: dailyCounts[i] ?? 0,
  }));

  // last 7 days = trailing slice of the 14d bucket
  const triggers_this_week = dailyCounts
    .slice(WINDOW_DAYS - 7)
    .reduce((a, b) => a + b, 0);

  const top_triggers: TopTrigger[] = Array.from(perShortcutTotal.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([trigger, count]) => ({
      trigger,
      count,
      trend: perShortcutDaily.get(trigger) ?? new Array<number>(WINDOW_DAYS).fill(0),
    }));

  return {
    total_snippets: totalSnippets,
    triggers_this_week,
    estimated_seconds_saved: events.length * SECONDS_SAVED_PER_TRIGGER,
    top_trigger: top_triggers[0]?.trigger ?? '',
    daily_usage,
    top_triggers,
  };
}

export const analyticsApi: AnalyticsApi = {
  async getSummary() {
    const userId = await currentUserId();

    const totalRes = await supabase
      .from('snippets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (totalRes.error) throw totalRes.error;

    const fromIso = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
    const eventsRes = await supabase
      .from('snippet_events')
      .select('shortcut, created_at')
      .eq('user_id', userId)
      .gte('created_at', fromIso);
    if (eventsRes.error) throw eventsRes.error;

    return aggregate((eventsRes.data ?? []) as EventRow[], totalRes.count ?? 0);
  },
};
