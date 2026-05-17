import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopTrigger } from '@/types/database';

interface TopTriggersTableProps {
  data: TopTrigger[];
}

// Inline SVG sparkline keeps the component dependency-free and renders identically
// at every viewport. 80x24 viewbox is small enough to align inside a table row.
function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const stepX = 80 / Math.max(values.length - 1, 1);
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(2)},${(24 - ((v - min) / range) * 22 - 1).toFixed(2)}`)
    .join(' ');

  return (
    <svg viewBox="0 0 80 24" width="80" height="24" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke="#1B4FD8"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopTriggersTable({ data }: TopTriggersTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top triggers</CardTitle>
        <CardDescription>Your most-used shortcuts in the last 14 days.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
              <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-6 py-2.5">Trigger</th>
              <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-6 py-2.5">Trend</th>
              <th className="sticky top-0 z-10 border-b border-line bg-bg-alt px-6 py-2.5 text-right">Uses</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr
                key={row.trigger}
                className={i === data.length - 1 ? '' : 'border-b border-line'}
              >
                <td className="px-6 py-3">
                  <code className="inline-flex items-center rounded-md bg-primary-light px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                    <span className="font-normal opacity-45">::</span>
                    <span>{row.trigger}</span>
                  </code>
                </td>
                <td className="px-6 py-3">
                  <Sparkline values={row.trend} />
                </td>
                <td className="px-6 py-3 text-right font-mono text-xs tabular-nums text-ink">
                  {row.count.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
