import { labelSwatch } from '@/lib/labelColors';
import { cn } from '@/lib/utils';
import type { Label } from '@/types/database';

interface LabelBadgeProps {
  label: Label;
  className?: string;
}

/**
 * A label as it appears on a snippet row or a prompt card. Colour comes from
 * the closed palette in lib/labelColors.ts — the row stores a key, never a hex.
 */
export function LabelBadge({ label, className }: LabelBadgeProps) {
  const swatch = labelSwatch(label.color);
  return (
    <span
      title={label.name}
      className={cn(
        'inline-flex max-w-[140px] items-center rounded-full border px-2 py-px text-[10px] font-semibold leading-4',
        swatch.chip,
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
    </span>
  );
}

interface LabelBadgeListProps {
  labels: Label[];
  /** Show at most this many; the rest collapse into a "+N" chip. */
  max?: number;
  className?: string;
}

/** Badge row with an overflow chip, so a heavily labelled asset can't wrap forever. */
export function LabelBadgeList({ labels, max = 3, className }: LabelBadgeListProps) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <LabelBadge key={label.id} label={label} />
      ))}
      {hidden.length > 0 && (
        <span
          title={hidden.map((l) => l.name).join(', ')}
          className="inline-flex items-center rounded-full bg-bg-alt px-1.5 py-px text-[10px] font-semibold leading-4 text-ink-subtle"
        >
          +{hidden.length}
        </span>
      )}
    </span>
  );
}
