import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { isValidFieldName } from '@/lib/formNumberToken';
import { formulasInBody, type FormulaDecimals } from '@/lib/formulaToken';

// The pieces the Price line and Calculator windows share, so the two look and
// behave as one: same frame, same list of formulas already in the snippet, same
// choice cards, same name fields.

export const HINT = 'text-[11px] text-ink-subtle mt-1.5';
export const ERROR = 'mt-1.5 text-[11px] text-danger';
export const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
export const SELECT =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 font-mono text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

/** The picker's last choice: a box that does not exist yet, added with the formula. */
export const NEW_BOX = '__new_box__';

const DECIMAL_OPTIONS: readonly { value: `${FormulaDecimals}`; label: string }[] = [
  { value: '0', label: 'Whole number' },
  { value: '1', label: '1 decimal' },
  { value: '2', label: '2 decimals' },
];

/** "100", "100 and 25", "100, 25 and 5". */
export function listAnd(items: readonly string[]): string {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** A group of choices where exactly one is picked, each with a line saying what it does. */
export function ChoiceCards<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
}: {
  options: readonly { id: T; label: string; detail: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  columns: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('grid gap-2', columns)}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex flex-col items-start gap-0.5 rounded-[10px] border px-3 py-2 text-left transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active ? 'border-primary bg-primary-light' : 'border-line bg-card hover:bg-bg-alt',
            )}
          >
            <span className={cn('text-xs font-semibold', active ? 'text-primary' : 'text-ink')}>
              {opt.label}
            </span>
            <span className="text-[11px] leading-tight text-ink-subtle">{opt.detail}</span>
          </button>
        );
      })}
    </div>
  );
}

export function RoundingControl({
  value,
  onChange,
}: {
  value: FormulaDecimals;
  onChange: (next: FormulaDecimals) => void;
}) {
  return (
    <div>
      <span className={SECTION_LABEL}>Rounding</span>
      <Segmented
        options={DECIMAL_OPTIONS}
        value={`${value}`}
        onChange={(v) => onChange(Number(v) as FormulaDecimals)}
        ariaLabel="Answer rounding"
        className="w-full [&>button]:flex-1"
      />
      <p className={HINT}>How many decimals the answer keeps. Numbers you type in print as typed.</p>
    </div>
  );
}

/** A name a box or a rate is called: letters, digits and underscore, and not one already taken. */
export function NameInput({
  id,
  ariaLabel,
  value,
  onChange,
  onEnter,
  taken,
  hint,
  example,
}: {
  id?: string;
  ariaLabel: string;
  value: string;
  /** Called with the name as typed, already stripped of anything a name cannot hold. */
  onChange: (next: string) => void;
  onEnter: () => void;
  taken: boolean;
  hint: ReactNode;
  example: string;
}) {
  const valid = isValidFieldName(value);
  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onEnter();
    }
  }
  return (
    <div>
      <Input
        id={id}
        aria-label={ariaLabel}
        value={value}
        // Stripped as typed, not rejected after: a space failing validation with
        // no visible cause is worse than a space that does not appear.
        onChange={(e) => onChange(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
        onKeyDown={onKeyDown}
        className={cn(
          'h-10 rounded-[10px] font-mono',
          (!valid || taken) && 'border-danger focus:border-danger focus:ring-danger/20',
        )}
      />
      {taken ? (
        <p className={ERROR}>This snippet already uses that name. Pick another one.</p>
      ) : !valid ? (
        <p className={ERROR}>
          Letters, numbers and underscore, starting with a letter. For example {example}.
        </p>
      ) : (
        <p className={HINT}>{hint}</p>
      )}
    </div>
  );
}

/** Settings most people never need, out of the way until asked for. */
export function MoreOptions({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        More options
      </button>
      {open && <div className="mt-3 flex flex-col gap-4">{children}</div>}
    </div>
  );
}

/**
 * The formulas already in the snippet, one line by default (how many there are)
 * and the list behind Manage. Each can be removed, and the last removal undone.
 *
 * It sits above the scrolling form in both windows, never inside it: in there it
 * scrolled out of sight and could not be found.
 */
export function FormulaListSection({
  body,
  onReplace,
}: {
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
}) {
  const formulas = useMemo(() => formulasInBody(body), [body]);
  const [expanded, setExpanded] = useState(false);
  // What the last Remove took out, and where, so Undo can put it back.
  const [lastRemoved, setLastRemoved] = useState<{
    start: number;
    text: string;
    description: string;
  } | null>(null);
  const count = formulas.length;

  return (
    <div className="rounded-[10px] border border-line bg-bg-alt">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <p className="text-xs text-ink-muted">
          {count === 0
            ? 'No formulas in this snippet yet.'
            : `${count} ${count === 1 ? 'formula' : 'formulas'} in this snippet.`}
        </p>
        {count > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-xs font-medium text-primary hover:underline"
          >
            {expanded ? 'Hide' : 'Manage'}
          </button>
        )}
      </div>

      {expanded && count > 0 && (
        <ul className="max-h-[140px] divide-y divide-line overflow-y-auto border-t border-line bg-card">
          {formulas.map((f) => (
            <li key={f.at} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                {f.context !== '' && (
                  <p className="truncate text-[11px] text-ink-subtle">{f.context}</p>
                )}
                <p className="truncate font-mono text-xs text-ink" title={f.description}>
                  {f.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setLastRemoved({
                    start: f.removeStart,
                    text: body.slice(f.removeStart, f.removeEnd),
                    description: f.description,
                  });
                  onReplace(f.removeStart, f.removeEnd, '');
                }}
                aria-label={`Remove ${f.description}`}
                className="flex shrink-0 items-center gap-1 rounded-[6px] border border-line bg-card px-2 py-1 text-[11px] font-medium text-ink-subtle transition-colors hover:border-danger/30 hover:bg-danger/5 hover:text-danger"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {lastRemoved && (
        <p className="border-t border-line px-3 py-2 text-[11px] text-ink-subtle">
          Removed {lastRemoved.description}.{' '}
          <button
            type="button"
            onClick={() => {
              onReplace(lastRemoved.start, lastRemoved.start, lastRemoved.text);
              setLastRemoved(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            Undo
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The window both builders sit in: a title, the list of formulas already in the
 * snippet, the form, and the Cancel and Insert buttons. Never taller than the
 * screen; the title, the list and the buttons stay put and only the form scrolls.
 */
export function FormulaDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  body,
  onReplace,
  note,
  canInsert,
  onInsert,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  body: string;
  onReplace: (start: number, end: number, text: string) => void;
  /** Why Insert is not available yet, in the footer beside the buttons. */
  note: string;
  canInsert: boolean;
  onInsert: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] max-w-[480px] grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-0 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-3">
          <FormulaListSection body={body} onReplace={onReplace} />
        </div>

        {/* shrink-0 on every section: in a scrolling column, a section that
            clips its own overflow would otherwise be squeezed to nothing
            instead of the column scrolling. */}
        <div className="min-h-0 overflow-y-auto px-6 pb-2 flex flex-col gap-5 [&>*]:shrink-0">
          {children}
        </div>

        <div className="mt-2 flex items-center gap-3 border-t border-line px-6 py-4">
          <p className="mr-auto text-[11px] leading-tight text-ink-subtle">{note}</p>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onInsert} disabled={!canInsert}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
