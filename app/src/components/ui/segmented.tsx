import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the choice for screen readers, since the buttons only carry labels. */
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A row of joined buttons where exactly one is picked: the filled segment is
 * the current answer, the rest are the alternatives. Reads faster than a
 * switch when both states deserve a name, because neither is "off".
 *
 * Use `Switch` instead when the choice really is on/off and the label alone
 * says what "on" means.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex overflow-hidden rounded-[8px] border border-line', className)}
    >
      {options.map((option, i) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-9 px-3 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40',
              'disabled:cursor-not-allowed disabled:opacity-50',
              // One shared hairline between neighbours rather than two, so the
              // seam matches the outer border instead of doubling it.
              i > 0 && 'border-l border-line',
              active ? 'bg-primary text-white' : 'bg-card text-ink hover:bg-bg-alt',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
