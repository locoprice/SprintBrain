import { useEffect, useState } from 'react';
import { Activity, Clock, Hash, Library } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiCard } from '@/components/shared/KpiCard';
import { UsageChart } from '@/features/analytics/UsageChart';
import { TopTriggersTable } from '@/features/analytics/TopTriggersTable';
import { ActivityHeatmap } from '@/features/analytics/ActivityHeatmap';
import { ActivityOverviewSection } from '@/features/analytics/ActivityOverviewSection';
import { ContributionActivity } from '@/features/analytics/ContributionActivity';
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { formatCompact, formatDuration } from '@/lib/utils';

const STORAGE_PRIVATE = 'sb.activity.private';
const STORAGE_OVERVIEW = 'sb.activity.overview';

function readToggle(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function persistToggle(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* storage unavailable — toggle stays in-memory only */
  }
}

export function AnalyticsPage() {
  const summary = useAnalyticsStore((s) => s.summary);
  const loading = useAnalyticsStore((s) => s.loading);
  const load = useAnalyticsStore((s) => s.load);
  const activity = useAnalyticsStore((s) => s.activity);
  const loadActivity = useAnalyticsStore((s) => s.loadActivity);

  const [showPrivate, setShowPrivate] = useState(() => readToggle(STORAGE_PRIVATE, true));
  const [showOverview, setShowOverview] = useState(() => readToggle(STORAGE_OVERVIEW, true));

  function changePrivate(next: boolean) {
    setShowPrivate(next);
    persistToggle(STORAGE_PRIVATE, next);
  }
  function changeOverview(next: boolean) {
    setShowOverview(next);
    persistToggle(STORAGE_OVERVIEW, next);
  }

  useEffect(() => {
    if (!summary) {
      void load();
    }
  }, [summary, load]);

  useEffect(() => {
    if (!activity) {
      void loadActivity();
    }
  }, [activity, loadActivity]);

  if (!summary || loading) {
    return (
      <>
        <PageHeader
          title="Analytics"
          description="Usage signal across snippets, devices, and time."
        />
        <div className="grid grid-cols-4 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-[16px] bg-card" />
          ))}
        </div>
        <div className="mt-6 h-[320px] animate-pulse rounded-[16px] bg-card" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Usage signal across snippets, devices, and time."
      />

      <div className="grid grid-cols-4 gap-5">
        <KpiCard
          label="Total snippets"
          value={formatCompact(summary.total_snippets)}
          icon={Library}
          hint="across 4 folders"
        />
        <KpiCard
          label="Triggers this week"
          value={formatCompact(summary.triggers_this_week)}
          icon={Activity}
          delta={{ value: '12%', positive: true }}
          hint="vs. previous 7 days"
        />
        <KpiCard
          label="Time saved"
          value={formatDuration(summary.estimated_seconds_saved)}
          icon={Clock}
          hint="estimated, last 30 days"
        />
        <KpiCard
          label="Top trigger"
          value={summary.top_trigger.replace(/^:+/, '')}
          icon={Hash}
          hint={`${summary.top_triggers[0]?.count ?? 0} uses`}
        />
      </div>

      <div className="mt-6">
        {activity ? (
          <ActivityHeatmap
            data={activity}
            showPrivate={showPrivate}
            showOverview={showOverview}
            onChangePrivate={changePrivate}
            onChangeOverview={changeOverview}
          />
        ) : (
          <div className="h-[260px] animate-pulse rounded-[16px] bg-card" />
        )}
      </div>

      {activity && showOverview && (
        <>
          <div className="mt-6">
            <ActivityOverviewSection data={activity} showPrivate={showPrivate} />
          </div>
          <div className="mt-6">
            <ContributionActivity data={activity} showPrivate={showPrivate} />
          </div>
        </>
      )}

      <div className="mt-6 grid grid-cols-3 gap-5">
        <div className="col-span-2">
          <UsageChart data={summary.daily_usage} />
        </div>
        <div className="col-span-1">
          <TopTriggersTable data={summary.top_triggers} />
        </div>
      </div>
    </>
  );
}
