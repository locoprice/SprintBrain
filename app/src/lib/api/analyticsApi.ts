import { supabase } from '@/lib/supabase';
import type {
  ActivityData,
  ActivityDay,
  ActivityMonth,
  ActivityOverview,
  AnalyticsSummary,
  TopTrigger,
  UsagePoint,
} from '@/types/database';

// Live aggregation over public.snippet_events. The extension writes one row per
// successful snippet expansion (ANALYTICS-001). We pull the last 14 days,
// bucket client-side, and shape into the AnalyticsSummary the page expects.
//
// When usage outgrows in-process aggregation (~ a few thousand events / 14d),
// move this to a Postgres RPC.

export interface AnalyticsApi {
  getSummary(): Promise<AnalyticsSummary>;
  getActivity(): Promise<ActivityData>;
}

const WINDOW_DAYS = 14;
const SECONDS_SAVED_PER_TRIGGER = 30;
// 53 columns = 52 full weeks + the current (partial) week — matches the
// GitHub contribution graph footprint.
const ACTIVITY_WEEKS = 53;

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

/** Local midnight of the most recent Sunday on or before `d`. */
function startOfWeekSunday(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/** The first cell (a Sunday) and last cell (today) of the heatmap grid. */
function activityBounds(): { start: Date; end: Date } {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = startOfWeekSunday(end);
  start.setDate(start.getDate() - (ACTIVITY_WEEKS - 1) * 7);
  return { start, end };
}

function buildActivity(events: EventRow[]): Omit<ActivityData, 'overview'> {
  const { start, end } = activityBounds();

  const counts = new Map<string, number>();
  let total = 0;
  for (const ev of events) {
    const k = dayKey(ev.created_at);
    counts.set(k, (counts.get(k) ?? 0) + 1);
    total += 1;
  }

  const days: ActivityDay[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const key = dayKey(cursor.toISOString());
    days.push({ date: key, count: counts.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
  }

  return {
    days,
    total,
    start: dayKey(start.toISOString()),
    end: dayKey(end.toISOString()),
  };
}

type ActivityEventRow = { snippet_id: string | null; created_at: string };

function monthLabel(key: string): string {
  const parts = key.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

interface OverviewInput {
  events: ActivityEventRow[];
  snippetToFolder: Map<string, string | null>;
  folderNames: Map<string, string>;
  promptCount: number;
  notionSyncCount: number;
}

function buildOverview(input: OverviewInput): ActivityOverview {
  const { events, snippetToFolder, folderNames, promptCount, notionSyncCount } = input;

  function folderOf(snippetId: string | null): string {
    const folderId = snippetId ? snippetToFolder.get(snippetId) : null;
    return (folderId && folderNames.get(folderId)) || 'Other';
  }

  // Per-month totals + per-folder breakdown, and a global folder tally.
  const months = new Map<string, { total: number; folders: Map<string, number> }>();
  const folderTotals = new Map<string, number>();

  for (const ev of events) {
    const monthKey = dayKey(ev.created_at).slice(0, 7); // YYYY-MM
    let bucket = months.get(monthKey);
    if (!bucket) {
      bucket = { total: 0, folders: new Map() };
      months.set(monthKey, bucket);
    }
    const folder = folderOf(ev.snippet_id);
    bucket.total += 1;
    bucket.folders.set(folder, (bucket.folders.get(folder) ?? 0) + 1);
    folderTotals.set(folder, (folderTotals.get(folder) ?? 0) + 1);
  }

  const timeline: ActivityMonth[] = Array.from(months.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1)) // most recent first
    .map(([key, bucket]) => ({
      key,
      label: monthLabel(key),
      total: bucket.total,
      items: Array.from(bucket.folders.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([label, count]) => ({ label, count })),
    }));

  const activeFolders = Array.from(folderTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([name]) => name);

  return {
    axes: [
      { key: 'snippets', label: 'Snippets', count: snippetToFolder.size },
      { key: 'prompts', label: 'Prompts', count: promptCount },
      { key: 'folders', label: 'Folders', count: folderNames.size },
      { key: 'syncs', label: 'Notion syncs', count: notionSyncCount },
    ],
    activeFolders,
    timeline,
  };
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

  async getActivity() {
    const userId = await currentUserId();
    const { start } = activityBounds();
    const fromIso = start.toISOString();

    const [eventsRes, snippetsRes, foldersRes, promptsRes, notionRes] = await Promise.all([
      supabase
        .from('snippet_events')
        .select('snippet_id, shortcut, created_at')
        .eq('user_id', userId)
        .gte('created_at', fromIso),
      // No user_id filter: RLS surfaces shared (org) snippets + folders too, so
      // expansions of team snippets resolve to their real folder names instead of
      // an "Other" bucket — matching listSnippets/listFolders (app/CLAUDE.md §6).
      supabase.from('snippets').select('id, folder_id'),
      supabase.from('folders').select('id, name'),
      supabase
        .from('prompts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
      supabase
        .from('notion_sync_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId),
    ]);
    if (eventsRes.error) throw eventsRes.error;
    if (snippetsRes.error) throw snippetsRes.error;
    if (foldersRes.error) throw foldersRes.error;

    const events = (eventsRes.data ?? []) as Array<EventRow & { snippet_id: string | null }>;
    const grid = buildActivity(events);

    const snippetToFolder = new Map<string, string | null>(
      ((snippetsRes.data ?? []) as Array<{ id: string; folder_id: string | null }>).map((s) => [
        s.id,
        s.folder_id,
      ]),
    );
    const folderNames = new Map<string, string>(
      ((foldersRes.data ?? []) as Array<{ id: string; name: string }>).map((f) => [f.id, f.name]),
    );

    const overview = buildOverview({
      events,
      snippetToFolder,
      folderNames,
      promptCount: promptsRes.count ?? 0,
      notionSyncCount: notionRes.error ? 0 : notionRes.count ?? 0,
    });

    return { ...grid, overview };
  },
};
