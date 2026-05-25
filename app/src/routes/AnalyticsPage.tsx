import { useEffect } from 'react';
import { Activity, Clock, Hash, Library } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { KpiCard } from '@/components/shared/KpiCard';
import { UsageChart } from '@/features/analytics/UsageChart';
import { TopTriggersTable } from '@/features/analytics/TopTriggersTable';
import { useAnalyticsStore } from '@/stores/analyticsStore';
import { formatCompact, formatDuration } from '@/lib/utils';

export function AnalyticsPage() {
  const summary = useAnalyticsStore((s) => s.summary);
  const loading = useAnalyticsStore((s) => s.loading);
  const load = useAnalyticsStore((s) => s.load);

  useEffect(() => {
    if (!summary) {
      void load();
    }
  }, [summary, load]);

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
