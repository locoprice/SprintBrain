import { useEffect, useMemo, useRef, useState } from 'react';
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
import { loadFillFormEngine, formulaEngine } from '@/lib/fillFormEngine';
import {
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  TIME_FORMAT_OPTIONS,
  type DateFormat,
  type TimeFormat,
} from '@/lib/formDateToken';
import {
  buildFormTimeToken,
  fixedShift,
  NAMED_SHIFT_LABELS,
  NAMED_SHIFTS,
  previewTime,
  SHIFT_UNITS,
  type NamedShift,
  type ShiftMode,
  type ShiftUnit,
} from '@/lib/formTimeToken';

const HINT = 'text-[11px] text-ink-subtle mt-1.5 leading-tight';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const COLUMN_TITLE =
  'text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-3';
const SELECT_CLASS =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50';

const MODE_OPTIONS: readonly { value: ShiftMode; label: string }[] = [
  { value: 'none', label: 'Today' },
  { value: 'fixed', label: 'Count forward' },
  { value: 'named', label: 'A named day' },
];

const MODE_HINT: Record<ShiftMode, string> = {
  none: 'The day the snippet is expanded on.',
  fixed: 'A fixed distance from that day. Tick "backwards" to count the other way.',
  named: 'Worked out at expansion. Sent on a Monday, "Next Monday" is a week away.',
};

// Minutes step in fives. A message anchored to 09:07 is not a thing anyone
// writes, and sixty entries to scroll past to reach half past is worse than the
// granularity is worth.
const MINUTE_STEP = 5;

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) =>
  String(i * MINUTE_STEP).padStart(2, '0'),
);

interface FormTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (token: string) => void;
}

/**
 * Builds an automatic date: a `{time:}` token that works itself out when the
 * snippet expands, rather than a blank someone fills in.
 *
 * Two columns because there are two independent decisions — which day, and what
 * time on it — and stacking them made the second look like a detail of the
 * first. The rail is 260px so this cannot live there; it opens as a dialog, the
 * way the Number and Choice builders do.
 *
 * The preview resolves through the engine's own `sbFormatDate`, not a copy, so
 * what the dialog shows is what the snippet prints.
 */
export function FormTimeDialog({ open, onOpenChange, onInsert }: FormTimeDialogProps) {
  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [mode, setMode] = useState<ShiftMode>('none');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<ShiftUnit>('D');
  const [back, setBack] = useState(false);
  const [named, setNamed] = useState<NamedShift>('tomorrow');
  const [withTime, setWithTime] = useState(false);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(DEFAULT_TIME_FORMAT);
  const [hour, setHour] = useState('09');
  const [minute, setMinute] = useState('00');
  // Bumped once the engine's formatter is on the page, so the preview redraws.
  const [engineReady, setEngineReady] = useState(0);

  const amountRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts clean — a half-built token carried over from a
  // cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setDateFormat(DEFAULT_DATE_FORMAT);
    setMode('none');
    setAmount('1');
    setUnit('D');
    setBack(false);
    setNamed('tomorrow');
    setWithTime(false);
    setTimeFormat(DEFAULT_TIME_FORMAT);
    setHour('09');
    setMinute('00');
  }, [open]);

  // The formatter lives in the shared engine. Loading it here rather than
  // mirroring it keeps one date-formatting implementation in the product.
  useEffect(() => {
    if (!open || formulaEngine()) return;
    let alive = true;
    loadFillFormEngine()
      .then(() => {
        if (alive) setEngineReady((n) => n + 1);
      })
      .catch(() => {
        // A preview that cannot render is not a reason to block the insert:
        // the token is written by pure code that does not need the engine.
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const amountValid = /^\d+$/.test(amount.trim()) && Number.parseInt(amount, 10) > 0;

  const shift = useMemo(() => {
    if (mode === 'none') return '';
    if (mode === 'named') return named;
    return amountValid ? fixedShift(Number.parseInt(amount, 10), unit, back) : '';
  }, [mode, named, amount, amountValid, unit, back]);

  const format = withTime ? `${dateFormat} ${timeFormat}` : dateFormat;
  const at = withTime ? `${hour}:${minute}` : '';

  const token = useMemo(
    () => buildFormTimeToken({ format, shift, at }),
    [format, shift, at],
  );

  const preview = useMemo(() => {
    const engine = formulaEngine();
    if (!engine) return '';
    return previewTime({ format, shift, at }, new Date(), engine.sbFormatDate);
    // engineReady is a redraw trigger, not a value this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, shift, at, engineReady]);

  const canInsert = mode !== 'fixed' || amountValid;

  function handleSubmit() {
    if (!canInsert) return;
    onInsert(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[640px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          amountRef.current?.focus();
        }}
      >
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Insert an automatic date</DialogTitle>
          <DialogDescription>
            A date worked out when the snippet expands. Nobody fills it in.
          </DialogDescription>
        </DialogHeader>

        {/* Two columns: which day on the left, what time on the right. They are
            independent decisions, and stacking them made the time read as a
            detail of the date rather than a choice of its own. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 border-t border-line px-6 py-5 sm:grid-cols-2">
          {/* ── Which day ── */}
          <div className="min-w-0">
            <p className={COLUMN_TITLE}>Which day</p>

            <label htmlFor="sb-time-dateformat" className={SECTION_LABEL}>
              Date format
            </label>
            <select
              id="sb-time-dateformat"
              value={dateFormat}
              onChange={(e) => setDateFormat(e.target.value as DateFormat)}
              className={SELECT_CLASS}
            >
              {DATE_FORMAT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label} · {o.sample}
                </option>
              ))}
            </select>

            <div className="mt-4">
              <span className={SECTION_LABEL}>Which day</span>
              <Segmented
                ariaLabel="Which day the date lands on"
                value={mode}
                onChange={setMode}
                options={MODE_OPTIONS}
              />
              <p className={HINT}>{MODE_HINT[mode]}</p>
            </div>

            {mode === 'fixed' && (
              <div className="mt-3">
                <div className="flex items-end gap-2">
                  <div className="w-[86px] shrink-0">
                    <label htmlFor="sb-time-amount" className={SECTION_LABEL}>
                      How many
                    </label>
                    <Input
                      id="sb-time-amount"
                      ref={amountRef}
                      value={amount}
                      inputMode="numeric"
                      onChange={(e) => setAmount(e.target.value)}
                      aria-invalid={!amountValid}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="sb-time-unit" className={SECTION_LABEL}>
                      Unit
                    </label>
                    <select
                      id="sb-time-unit"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value as ShiftUnit)}
                      className={SELECT_CLASS}
                    >
                      {SHIFT_UNITS.map((u) => (
                        <option key={u.value} value={u.value}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <label className="mt-2.5 flex items-center gap-2 text-[11px] text-ink-muted">
                  <input
                    type="checkbox"
                    checked={back}
                    onChange={(e) => setBack(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  Count backwards instead
                </label>
                {!amountValid && (
                  <p className={cn(HINT, 'text-danger')}>
                    A whole number above zero. Anything else writes no offset at all.
                  </p>
                )}
              </div>
            )}

            {mode === 'named' && (
              <div className="mt-3">
                <label htmlFor="sb-time-named" className={SECTION_LABEL}>
                  Day
                </label>
                <select
                  id="sb-time-named"
                  value={named}
                  onChange={(e) => setNamed(e.target.value as NamedShift)}
                  className={SELECT_CLASS}
                >
                  {NAMED_SHIFTS.map((n) => (
                    <option key={n} value={n}>
                      {NAMED_SHIFT_LABELS[n]}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── What time ── */}
          <div className="min-w-0 sm:border-l sm:border-line sm:pl-6">
            <p className={COLUMN_TITLE}>What time</p>

            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={withTime}
                onChange={(e) => setWithTime(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              Print a time as well
            </label>
            <p className={HINT}>
              Off, the token prints only the date. On, it prints the time you pin here —
              the same one every time it expands, not the hour it happened to be sent at.
            </p>

            <div className={cn('mt-4', !withTime && 'pointer-events-none opacity-40')}>
              <span className={SECTION_LABEL}>Time of day</span>
              <div className="flex items-center gap-2">
                <select
                  aria-label="Hour"
                  value={hour}
                  disabled={!withTime}
                  onChange={(e) => setHour(e.target.value)}
                  className={cn(SELECT_CLASS, 'w-[84px] shrink-0')}
                  size={1}
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
                <span className="text-sm font-medium text-ink-muted">:</span>
                <select
                  aria-label="Minute"
                  value={minute}
                  disabled={!withTime}
                  onChange={(e) => setMinute(e.target.value)}
                  className={cn(SELECT_CLASS, 'w-[84px] shrink-0')}
                  size={1}
                >
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <p className={HINT}>Minutes step in fives.</p>

              <div className="mt-4">
                <label htmlFor="sb-time-timeformat" className={SECTION_LABEL}>
                  Time format
                </label>
                <select
                  id="sb-time-timeformat"
                  value={timeFormat}
                  disabled={!withTime}
                  onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}
                  className={SELECT_CLASS}
                >
                  {TIME_FORMAT_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label} · {o.sample}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Preview and token, full width under both columns: they are the result
            of every control above, so they cannot belong to one side. */}
        <div className="border-t border-line bg-bg px-6 py-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
              Prints today as
            </span>
            <span className="font-mono text-sm text-ink">{preview || '…'}</span>
          </div>
          <p className="mt-2 font-mono text-[11px] leading-tight text-ink-subtle break-all">
            {token}
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" disabled={!canInsert} onClick={handleSubmit}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
