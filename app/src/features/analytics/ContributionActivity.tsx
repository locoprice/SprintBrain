import { Activity } from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { ActivityData, ActivityMonth } from '@/types/database';

interface ContributionActivityProps {
  data: ActivityData;
  showPrivate: boolean;
}

export function ContributionActivity({ data, showPrivate }: ContributionActivityProps) {
  const timeline = data.overview.timeline;

  return (
    <div>
      <h3 className="text-base font-semibold tracking-tight text-ink">Contribution activity</h3>

      {timeline.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          No snippet activity yet. Expansions will show up here as you use your snippets.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {timeline.map((month) => (
            <MonthGroup key={month.key} month={month} showPrivate={showPrivate} />
          ))}
        </div>
      )}
    </div>
  );
}

function MonthGroup({ month, showPrivate }: { month: ActivityMonth; showPrivate: boolean }) {
  const maxCount = Math.max(1, ...month.items.map((i) => i.count));
  const folderWord = month.items.length === 1 ? 'folder' : 'folders';

  const headline = showPrivate
    ? `Expanded snippets ${month.total.toLocaleString()} times across ${month.items.length} ${folderWord}`
    : `Active across ${month.items.length} ${folderWord}`;

  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line bg-bg-alt text-ink-muted">
          <Activity className="h-3.5 w-3.5" />
        </span>
        <span className="mt-1 w-px flex-1 bg-line" />
      </div>

      <div className="flex-1 pb-1">
        <p className="mb-2 text-sm font-semibold text-ink">{month.label}</p>
        <Card className="p-4">
          <p className="mb-3 text-sm text-ink">{headline}</p>
          <div className="space-y-2">
            {month.items.map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="w-36 shrink-0 truncate text-xs text-ink-muted" title={item.label}>
                  {item.label}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-alt">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((item.count / maxCount) * 100)}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                  {showPrivate ? item.count.toLocaleString() : '·'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
