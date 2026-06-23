import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ToggleItem {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

interface ContributionSettingsProps {
  items: ToggleItem[];
}

/**
 * GitHub-style "Contribution settings" dropdown. Layout, sizing, and the
 * checkbox-row interaction mirror GitHub; the palette is SprintBrain azure.
 */
export function ContributionSettings({ items }: ContributionSettingsProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[6px] border border-line bg-card',
          'px-3 py-1.5 text-xs font-semibold text-ink-muted',
          'transition-colors hover:bg-bg-alt hover:text-ink',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-bg-alt text-ink',
        )}
      >
        Contribution settings
        <ChevronDown
          className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            'absolute right-0 top-full z-40 mt-2 w-[260px]',
            'rounded-[12px] border border-line bg-card shadow-md',
            'animate-fade-in overflow-hidden p-1.5',
          )}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemcheckbox"
              aria-checked={item.checked}
              onClick={() => item.onChange(!item.checked)}
              className={cn(
                'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left',
                'transition-colors hover:bg-bg-alt',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border',
                  item.checked
                    ? 'border-primary bg-primary text-white'
                    : 'border-line bg-card text-transparent',
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-tight text-ink">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-snug text-ink-muted">
                  {item.description}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
