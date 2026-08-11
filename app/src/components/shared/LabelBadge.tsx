import { X } from 'lucide-react';
import { labelSwatch } from '@/lib/labelColors';
import { cn } from '@/lib/utils';
import type { Label } from '@/types/database';

interface LabelBadgeProps {
  label: Label;
  className?: string;
  /**
   * Reveals a hover-expand × that removes this label. Omit for a read-only
   * badge (e.g. table rows, prompt cards) — those never grow a remove control.
   * Excluded from tab order (`tabIndex={-1}`): it's a pointer shortcut for
   * something already reachable via the picker's dropdown checkbox, not a new
   * capability that needs its own keyboard path.
   */
  onRemove?: () => void;
}

/**
 * A label as it appears on a snippet row or a prompt card. Colour comes from
 * the closed palette in lib/labelColors.ts — the row stores a key, never a hex.
 */
export function LabelBadge({ label, className, onRemove }: LabelBadgeProps) {
  const swatch = labelSwatch(label.color);
  return (
    <span
      title={label.name}
      className={cn(
        'group/badge inline-flex max-w-[140px] items-center rounded-full border py-px text-[10px] font-semibold leading-4',
        onRemove ? 'pl-2 pr-1' : 'px-2',
        swatch.chip,
        className,
      )}
    >
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Remove ${label.name}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 flex w-0 shrink-0 items-center justify-center overflow-hidden rounded-full opacity-0 transition-all duration-150 hover:opacity-70 group-hover/badge:w-3 group-hover/badge:opacity-100"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

interface LabelBadgeListProps {
  labels: Label[];
  /** Show at most this many; the rest collapse into a "+N" chip. */
  max?: number;
  className?: string;
  /** Reveals a hover-expand × on every shown chip, wired to that label's id. */
  onRemove?: (labelId: string) => void;
}

/** Badge row with an overflow chip, so a heavily labelled asset can't wrap forever. */
export function LabelBadgeList({ labels, max = 3, className, onRemove }: LabelBadgeListProps) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const hidden = labels.slice(max);

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {shown.map((label) => (
        <LabelBadge
          key={label.id}
          label={label}
          onRemove={onRemove ? () => onRemove(label.id) : undefined}
        />
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
