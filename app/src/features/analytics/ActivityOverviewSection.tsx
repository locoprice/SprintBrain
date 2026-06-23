import { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import type { ActivityData, ActivityDay } from '@/types/database';

interface ActivityOverviewSectionProps {
  data: ActivityData;
  showPrivate: boolean;
}

interface Streaks {
  current: number;
  longest: number;
}

function computeStreaks(days: ActivityDay[]): Streaks {
  let longest = 0;
  let run = 0;
  let current = 0;
  days.forEach((d, i) => {
    if (d.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    if (i === days.length - 1) current = run;
  });
  return { current, longest };
}

// Radar geometry — 4 spokes (up / right / down / left), GitHub kite layout.
const CX = 150;
const CY = 120;
const R = 78;
const DIRS = [
  { x: 0, y: -1 }, // top
  { x: 1, y: 0 }, // right
  { x: 0, y: 1 }, // bottom
  { x: -1, y: 0 }, // left
];

function ring(scale: number): string {
  return DIRS.map((d) => `${CX + d.x * R * scale},${CY + d.y * R * scale}`).join(' ');
}

export function ActivityOverviewSection({ data, showPrivate }: ActivityOverviewSectionProps) {
  const streaks = useMemo(() => computeStreaks(data.days), [data.days]);
  const axes = data.overview.axes;
  const activeFolders = data.overview.activeFolders;

  const max = Math.max(1, ...axes.map((a) => a.count));
  const polygon = axes
    .map((a, i) => {
      const v = a.count / max;
      const d = DIRS[i] ?? { x: 0, y: 0 };
      return `${CX + d.x * R * v},${CY + d.y * R * v}`;
    })
    .join(' ');

  const labelPos = [
    { x: CX, y: CY - R - 18, anchor: 'middle' as const },
    { x: CX + R + 12, y: CY - 2, anchor: 'start' as const },
    { x: CX, y: CY + R + 14, anchor: 'middle' as const },
    { x: CX - R - 12, y: CY - 2, anchor: 'end' as const },
  ];

  return (
    <Card className="p-5">
      <h3 className="text-base font-semibold tracking-tight text-ink">Activity overview</h3>

      <div className="mt-4 grid grid-cols-2 items-center gap-6">
        <div>
          <p className="text-xs uppercase tracking-wide text-ink-subtle">Active in</p>
          {activeFolders.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {activeFolders.map((name) => (
                <span
                  key={name}
                  className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">No folder activity yet.</p>
          )}

          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-line pt-4">
            <Stat
              label="Total this year"
              value={showPrivate ? data.total.toLocaleString() : 'Hidden'}
            />
            <Stat label="Current streak" value={`${streaks.current}d`} />
            <Stat label="Longest streak" value={`${streaks.longest}d`} />
          </div>
        </div>

        <div className="flex justify-center">
          <svg viewBox="0 0 300 240" className="w-full max-w-[320px]" role="img" aria-label="Workspace activity radar">
            {/* guide rings */}
            {[0.5, 1].map((s) => (
              <polygon
                key={s}
                points={ring(s)}
                fill="none"
                style={{ stroke: 'var(--color-line)' }}
                strokeWidth={1}
              />
            ))}
            {/* spokes */}
            {DIRS.map((d, i) => (
              <line
                key={i}
                x1={CX}
                y1={CY}
                x2={CX + d.x * R}
                y2={CY + d.y * R}
                style={{ stroke: 'var(--color-line)' }}
                strokeWidth={1}
              />
            ))}
            {/* data kite */}
            <polygon
              points={polygon}
              className="text-primary"
              fill="currentColor"
              fillOpacity={0.18}
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            {axes.map((a, i) => {
              const v = a.count / max;
              const d = DIRS[i] ?? { x: 0, y: 0 };
              return (
                <circle
                  key={a.key}
                  cx={CX + d.x * R * v}
                  cy={CY + d.y * R * v}
                  r={2.5}
                  className="text-primary"
                  fill="currentColor"
                />
              );
            })}
            {/* axis labels */}
            {axes.map((a, i) => {
              const p = labelPos[i] ?? { x: CX, y: CY, anchor: 'middle' as const };
              return (
                <text key={a.key} x={p.x} y={p.y} textAnchor={p.anchor}>
                  <tspan className="fill-ink text-[11px] font-semibold">{a.label}</tspan>
                  <tspan x={p.x} dy={13} className="fill-ink-muted text-[11px]">
                    {a.count.toLocaleString()}
                  </tspan>
                </text>
              );
            })}
          </svg>
        </div>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</p>
    </div>
  );
}
