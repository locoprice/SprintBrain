import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface KpiCardProps {
  label: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  delta?: { value: string; positive: boolean };
}

export function KpiCard({ label, value, icon: Icon, hint, delta }: KpiCardProps) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-ink-subtle">
            {label}
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums text-ink">{value}</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-primary-light text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      {(hint || delta) && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          {delta ? (
            <span
              className={
                delta.positive
                  ? 'inline-flex items-center rounded-full bg-success/10 px-2 py-0.5 font-medium text-success'
                  : 'inline-flex items-center rounded-full bg-danger/10 px-2 py-0.5 font-medium text-danger'
              }
            >
              {delta.positive ? '↑' : '↓'} {delta.value}
            </span>
          ) : null}
          {hint ? <span className="text-ink-muted">{hint}</span> : null}
        </div>
      )}
    </Card>
  );
}
