import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { UsagePoint } from '@/types/database';

interface UsageChartProps {
  data: UsagePoint[];
}

export function UsageChart({ data }: UsageChartProps) {
  const series = useMemo(
    () => data.map((p) => ({ ...p, label: format(parseISO(p.date), 'MMM d') })),
    [data],
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Usage — last 30 days</CardTitle>
          <CardDescription>Snippet expansions per day across all devices.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[260px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#E5E5EA" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#6B6B70' }}
                axisLine={{ stroke: '#E5E5EA' }}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fontSize: 11, fill: '#6B6B70' }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                cursor={{ stroke: '#1B4FD8', strokeWidth: 1, strokeDasharray: '3 3' }}
                contentStyle={{
                  borderRadius: 12,
                  border: '1px solid #E5E5EA',
                  fontSize: 12,
                  boxShadow: '0 4px 20px rgba(27,79,216,.12)',
                }}
                labelStyle={{ color: '#6E6E73', fontWeight: 500 }}
                formatter={(value: number) => [value, 'Triggers']}
              />
              <Line
                type="monotone"
                dataKey="count"
                stroke="#1B4FD8"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 4, fill: '#1B4FD8' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
