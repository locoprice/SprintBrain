import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ActivityData, ActivityDay } from '@/types/database';
import { ContributionSettings } from './ContributionSettings';

interface ActivityHeatmapProps {
  data: ActivityData;
  showPrivate: boolean;
  showOverview: boolean;
  onChangePrivate: (next: boolean) => void;
  onChangeOverview: (next: boolean) => void;
}

const CELL = 11; // px — square size (matches GitHub)
const GAP = 3; // px — gap between cells
const WEEKDAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', '']; // rows Sun..Sat
const LEVELS = [0, 1, 2, 3, 4] as const;

/** Parse a 'YYYY-MM-DD' string as a local-noon Date (timezone-safe). */
function parseLocal(date: string): Date {
  const parts = date.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(y, m - 1, d, 12);
}

/** Map a raw count to an intensity level 0–4 against the window's peak. */
function levelFor(count: number, max: number): number {
  if (count <= 0) return 0;
  const step = Math.max(1, Math.ceil(max / 4));
  return Math.min(4, Math.ceil(count / step));
}

interface HoverState {
  text: string;
  x: number;
  y: number;
}

export function ActivityHeatmap({
  data,
  showPrivate,
  showOverview,
  onChangePrivate,
  onChangeOverview,
}: ActivityHeatmapProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  const max = useMemo(
    () => data.days.reduce((m, d) => Math.max(m, d.count), 0),
    [data.days],
  );

  // Chunk the dense day list into week columns (start is a Sunday → 7 per column,
  // last column padded with null for days beyond today).
  const weeks = useMemo(() => {
    const cols: (ActivityDay | null)[][] = [];
    for (let i = 0; i < data.days.length; i += 7) {
      const col = data.days.slice(i, i + 7);
      while (col.length < 7) col.push(null as unknown as ActivityDay);
      cols.push(col);
    }
    return cols;
  }, [data.days]);

  // Month label per column — shown only when the month changes.
  const monthLabels = useMemo(() => {
    let prev = '';
    return weeks.map((col) => {
      const first = col.find(Boolean);
      if (!first) return '';
      const d = parseLocal(first.date);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key === prev) return '';
      prev = key;
      return d.toLocaleString('en-US', { month: 'short' });
    });
  }, [weeks]);

  function tooltipFor(day: ActivityDay): string {
    const label = parseLocal(day.date).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    if (!showPrivate) return `Activity hidden · ${label}`;
    if (day.count === 0) return `No snippet expansions on ${label}`;
    return `${day.count} snippet expansion${day.count === 1 ? '' : 's'} on ${label}`;
  }

  function onCellEnter(e: React.MouseEvent<HTMLDivElement>, day: ActivityDay) {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({
      text: tooltipFor(day),
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }

  const heading = showPrivate
    ? `${data.total.toLocaleString()} snippet expansion${data.total === 1 ? '' : 's'} in the last year`
    : 'Snippet activity in the last year';

  const labelColWidth = 30;

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold tracking-tight text-ink">Activity Overview</h3>
          <p className="mt-0.5 text-sm text-ink-muted">{heading}</p>
        </div>
        <ContributionSettings
          items={[
            {
              id: 'private',
              label: 'Private contributions',
              description: 'Show exact expansion counts in the heading and tooltips.',
              checked: showPrivate,
              onChange: onChangePrivate,
            },
            {
              id: 'overview',
              label: 'Activity overview',
              description: 'Show the breakdown and recent activity below the graph.',
              checked: showOverview,
              onChange: onChangeOverview,
            },
          ]}
        />
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-block">
          {/* Month labels */}
          <div className="flex" style={{ marginLeft: labelColWidth }}>
            <div className="flex" style={{ gap: GAP }}>
              {monthLabels.map((label, i) => (
                <div
                  key={i}
                  className="overflow-visible whitespace-nowrap text-[10px] text-ink-muted"
                  style={{ width: CELL, height: 14 }}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>

          {/* Weekday labels + grid */}
          <div className="flex">
            <div
              className="flex flex-col justify-between pr-1.5 text-right"
              style={{ width: labelColWidth, gap: GAP }}
            >
              {WEEKDAY_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-[9px] leading-none text-ink-muted"
                  style={{ height: CELL, lineHeight: `${CELL}px` }}
                >
                  {label}
                </div>
              ))}
            </div>

            <div className="flex" style={{ gap: GAP }}>
              {weeks.map((col, ci) => (
                <div key={ci} className="flex flex-col" style={{ gap: GAP }}>
                  {col.map((day, ri) =>
                    day ? (
                      <div
                        key={ri}
                        onMouseEnter={(e) => onCellEnter(e, day)}
                        onMouseLeave={() => setHover(null)}
                        className="rounded-[2px]"
                        style={{
                          width: CELL,
                          height: CELL,
                          backgroundColor: `var(--activity-${levelFor(day.count, max)})`,
                          boxShadow: 'inset 0 0 0 1px var(--activity-cell-border)',
                        }}
                      />
                    ) : (
                      <div key={ri} style={{ width: CELL, height: CELL }} />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-ink-subtle">Each square is one day of snippet expansions.</p>
        <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
          <span>Less</span>
          <div className="flex items-center" style={{ gap: GAP }}>
            {LEVELS.map((lvl) => (
              <div
                key={lvl}
                className="rounded-[2px]"
                style={{
                  width: CELL,
                  height: CELL,
                  backgroundColor: `var(--activity-${lvl})`,
                  boxShadow: 'inset 0 0 0 1px var(--activity-cell-border)',
                }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>

      {hover && (
        <div
          className={cn(
            'pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full',
            'rounded-[6px] bg-ink px-2 py-1 text-[11px] font-medium text-white shadow-md',
            'whitespace-nowrap',
          )}
          style={{ left: hover.x, top: hover.y - 6 }}
        >
          {hover.text}
        </div>
      )}
    </Card>
  );
}
