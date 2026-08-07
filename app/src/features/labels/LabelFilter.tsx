import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Settings2, Tag } from 'lucide-react';
import { labelSwatch } from '@/lib/labelColors';
import { useLabelStore } from '@/stores/labelStore';
import { cn } from '@/lib/utils';

interface LabelFilterProps {
  selected: string[];
  onChange: (labelIds: string[]) => void;
  /**
   * Open the label manager. Injected rather than pulled from uiStore: this is a
   * leaf control, and reaching into a global store for it would drag the theme
   * bootstrap (which touches localStorage) into every module that imports a
   * toolbar — including the pure-logic tests that import one for a helper.
   */
  onManage: () => void;
}

/**
 * Filter a list by label. One control on both Snippets and Prompts — the label
 * vocabulary is shared, so the way you reach for it should be too.
 *
 * A dropdown rather than an inline chip row: labels are user-defined and
 * unbounded, and a toolbar that grows with the vocabulary stops being a
 * toolbar. Colour still carries at a glance via the swatch dots, and on the
 * badges the rows themselves render.
 *
 * Selecting several labels is a union — "anything in these buckets". See
 * matchesLabelFilter in lib/labelUtils.ts.
 */
export function LabelFilter({ selected, onChange, onManage }: LabelFilterProps) {
  const labels = useLabelStore((s) => s.labels);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // A label deleted while it was filtering would otherwise keep a list empty
  // with no visible cause. Drop stale ids as soon as the catalog changes.
  useEffect(() => {
    if (selected.length === 0) return;
    const live = selected.filter((id) => labels.some((l) => l.id === id));
    if (live.length !== selected.length) onChange(live);
  }, [labels, selected, onChange]);

  const active = selected.length > 0;

  function toggle(labelId: string) {
    onChange(
      selected.includes(labelId)
        ? selected.filter((id) => id !== labelId)
        : [...selected, labelId],
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-[10px] border px-3 text-xs font-medium transition-colors',
          active
            ? 'border-primary/30 bg-primary-light text-primary'
            : 'border-line bg-card text-ink-muted hover:border-primary/20 hover:text-ink',
        )}
      >
        <Tag className="h-3.5 w-3.5" />
        Labels
        {active && (
          <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-white tabular-nums">
            {selected.length}
          </span>
        )}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-2 w-56 animate-fade-in rounded-[12px] border border-line bg-card p-1.5 shadow-md"
        >
          {labels.length === 0 ? (
            <p className="px-2.5 py-2 text-xs text-ink-subtle">
              No labels yet. Create one to group snippets and prompts.
            </p>
          ) : (
            <div className="max-h-[260px] overflow-y-auto">
              {labels.map((label) => {
                const on = selected.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={on}
                    onClick={() => toggle(label.id)}
                    className="flex w-full items-center gap-2 rounded-[8px] px-2.5 py-1.5 text-xs text-ink transition-colors hover:bg-bg-alt"
                  >
                    <span
                      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', labelSwatch(label.color).dot)}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{label.name}</span>
                    {on && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          )}

          <div className="mt-1 flex items-center gap-1 border-t border-line pt-1">
            {active && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="rounded-[8px] px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-bg-alt hover:text-ink"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onManage();
              }}
              className="ml-auto flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary-light"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Manage labels
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
