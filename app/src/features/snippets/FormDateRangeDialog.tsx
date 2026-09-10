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
import { cn } from '@/lib/utils';
import { fillFormApi, loadFillFormEngine } from '@/lib/fillFormEngine';
import {
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  TIME_FORMAT_OPTIONS,
  type DateFormat,
  type TimeFormat,
} from '@/lib/formDateToken';
import {
  buildDateRangeToken,
  DEFAULT_BETWEEN_LABEL,
  DEFAULT_INCLUSIVE_LABEL,
  DEFAULT_JOINER,
  DEFAULT_RANGE_MODE,
  nextRangeNames,
  previewRange,
  RANGE_MODE_OPTIONS,
  type RangeMode,
  type RangeSource,
} from '@/lib/dateRangeToken';

const HINT = 'text-[11px] text-ink-subtle mt-1.5 leading-tight';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const COLUMN_TITLE =
  'text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-3';
const SELECT_CLASS =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50';
const RADIO_ROW = 'flex items-start gap-2 text-sm text-ink cursor-pointer';
const RADIO = 'mt-0.5 h-4 w-4 shrink-0 accent-primary';

// The two dates the preview is built from. A fixed pair, not today, because the
// whole point is showing that one span reads as two different numbers, and two
// dates a day apart make that hard to see.
const SAMPLE_START = new Date(2026, 8, 1);
const SAMPLE_END = new Date(2026, 8, 3);

interface FormDateRangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited, read for existing date fields and free names. */
  body: string;
  onInsert: (token: string) => void;
}

/**
 * Builds a date range: two dates and how long the span between them is.
 *
 * The span is two different numbers and an author has to choose which one they
 * mean. 1 to 3 September is 2 apart on a calendar and 3 counting both ends, so
 * the choice is a radio group with both answers shown against the same pair of
 * dates rather than a label they have to reason about.
 *
 * The words are typed, not shipped. A hotel says nights, a rental says days, a
 * clinic says sessions; the product ships the arithmetic and stays out of the
 * vocabulary (see the root CLAUDE.md).
 */
export function FormDateRangeDialog({
  open,
  onOpenChange,
  body,
  onInsert,
}: FormDateRangeDialogProps) {
  const [mode, setMode] = useState<RangeMode>(DEFAULT_RANGE_MODE);
  const [source, setSource] = useState<RangeSource>('insert');
  const [inclusiveLabel, setInclusiveLabel] = useState(DEFAULT_INCLUSIVE_LABEL);
  const [betweenLabel, setBetweenLabel] = useState(DEFAULT_BETWEEN_LABEL);
  const [joiner, setJoiner] = useState(DEFAULT_JOINER);
  const [withTime, setWithTime] = useState(false);
  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(DEFAULT_TIME_FORMAT);
  const [reuseStart, setReuseStart] = useState('');
  const [reuseEnd, setReuseEnd] = useState('');
  // Bumped once the shared module is on the page, so the field list redraws.
  const [engineReady, setEngineReady] = useState(0);

  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  // Which fields the body already holds is decided by extension/shared/fill-form.js,
  // the same module every fill surface asks. Re-deriving "is this a date?" from
  // the text here is exactly how the surfaces drifted before it existed.
  useEffect(() => {
    if (!open || fillFormApi()) return;
    let alive = true;
    loadFillFormEngine()
      .then(() => {
        if (alive) setEngineReady((n) => n + 1);
      })
      .catch(() => {
        // Without it the reuse option stays closed, which is honest: the dialog
        // cannot list fields it was unable to read.
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const existingDateFields = useMemo(() => {
    const api = fillFormApi();
    if (!api) return [] as string[];
    try {
      return api
        .fillForm(body, {}, {})
        .fields.filter((f) => f.type === 'date' || f.type === 'datetime')
        .map((f) => f.key);
    } catch {
      // A body mid-edit can be unparseable. An empty list closes the reuse
      // option rather than offering names that may not survive the next keypress.
      return [] as string[];
    }
    // engineReady is a redraw trigger, not a value this reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, engineReady]);

  // Two date fields are the minimum a range can be built from, so reusing what
  // is already in the body is only offered when there is something to reuse.
  const canReuse = existingDateFields.length >= 2;

  // Every opening starts clean, and starts from the body as it is now: a name
  // carried over from a cancelled insert would collide with a field that has
  // since been written.
  useEffect(() => {
    if (!open) return;
    setMode(DEFAULT_RANGE_MODE);
    setSource('insert');
    setInclusiveLabel(DEFAULT_INCLUSIVE_LABEL);
    setBetweenLabel(DEFAULT_BETWEEN_LABEL);
    setJoiner(DEFAULT_JOINER);
    setWithTime(false);
    setDateFormat(DEFAULT_DATE_FORMAT);
    setTimeFormat(DEFAULT_TIME_FORMAT);
    setReuseStart(existingDateFields[0] ?? '');
    setReuseEnd(existingDateFields[1] ?? '');
  }, [open, existingDateFields]);

  const names = useMemo(() => nextRangeNames(body), [body]);

  const cfg = useMemo(() => {
    const reusing = source === 'reuse' && canReuse;
    return {
      start: reusing ? reuseStart : names.start,
      end: reusing ? reuseEnd : names.end,
      mode,
      inclusiveLabel,
      betweenLabel,
      joiner,
      withFields: !reusing,
      withTime,
      format: withTime ? `${dateFormat} ${timeFormat}` : dateFormat,
    };
  }, [
    source, canReuse, reuseStart, reuseEnd, names, mode,
    inclusiveLabel, betweenLabel, joiner, withTime, dateFormat, timeFormat,
  ]);

  const token = useMemo(() => buildDateRangeToken(cfg), [cfg]);
  const preview = useMemo(() => previewRange(cfg, SAMPLE_START, SAMPLE_END), [cfg]);

  // Reusing needs two distinct fields. Same field twice is a span of zero, which
  // is never what someone means when they pick it.
  const reuseValid =
    source === 'insert' || (canReuse && reuseStart !== '' && reuseEnd !== '' && reuseStart !== reuseEnd);

  function handleSubmit() {
    if (!reuseValid) return;
    onInsert(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[660px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstFieldRef.current?.focus();
          firstFieldRef.current?.select();
        }}
      >
        <DialogHeader className="px-6 pt-5 pb-3">
          <DialogTitle>Insert a date range</DialogTitle>
          <DialogDescription>
            Two dates, and how long the span between them is.
          </DialogDescription>
        </DialogHeader>

        {/* Two columns: the dates on the left, what to print on the right. They
            are independent decisions, and stacking them made the second read as
            a detail of the first. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-5 border-t border-line px-6 py-5 sm:grid-cols-2">
          {/* ── The dates ── */}
          <div className="min-w-0">
            <p className={COLUMN_TITLE}>The dates</p>

            <div className="flex flex-col gap-2.5">
              <label className={RADIO_ROW}>
                <input
                  type="radio"
                  name="sb-range-source"
                  className={RADIO}
                  checked={source === 'insert'}
                  onChange={() => setSource('insert')}
                />
                <span>
                  Add the two date pickers
                  <span className={cn(HINT, 'mt-0.5 block')}>
                    Arrives as {names.start} and {names.end}, ready to fill in.
                  </span>
                </span>
              </label>

              <label className={cn(RADIO_ROW, !canReuse && 'cursor-not-allowed opacity-50')}>
                <input
                  type="radio"
                  name="sb-range-source"
                  className={RADIO}
                  disabled={!canReuse}
                  checked={source === 'reuse'}
                  onChange={() => setSource('reuse')}
                />
                <span>
                  Use dates already in the body
                  <span className={cn(HINT, 'mt-0.5 block')}>
                    {canReuse
                      ? 'Only the count is written. Pick which two below.'
                      : 'Needs two date fields in the body. There are none to pick yet.'}
                  </span>
                </span>
              </label>
            </div>

            {source === 'reuse' && canReuse && (
              <div className="mt-3 flex gap-2">
                <div className="min-w-0 flex-1">
                  <label htmlFor="sb-range-start" className={SECTION_LABEL}>
                    Earlier date
                  </label>
                  <select
                    id="sb-range-start"
                    value={reuseStart}
                    onChange={(e) => setReuseStart(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {existingDateFields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  <label htmlFor="sb-range-end" className={SECTION_LABEL}>
                    Later date
                  </label>
                  <select
                    id="sb-range-end"
                    value={reuseEnd}
                    onChange={(e) => setReuseEnd(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    {existingDateFields.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {source === 'reuse' && canReuse && reuseStart === reuseEnd && (
              <p className={cn(HINT, 'text-danger')}>
                Two different fields. The same one twice is a span of nothing.
              </p>
            )}

            {source === 'insert' && (
              <div className="mt-4">
                <label htmlFor="sb-range-dateformat" className={SECTION_LABEL}>
                  Date format
                </label>
                <select
                  id="sb-range-dateformat"
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

                <label className="mt-3 flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={withTime}
                    onChange={(e) => setWithTime(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Show a time as well
                </label>
                <p className={HINT}>
                  The pickers offer a clock, and the dates print it. The count is unchanged:
                  1 September at 15:00 to 3 September at 11:00 is still 2 days apart.
                </p>

                {withTime && (
                  <div className="mt-3">
                    <label htmlFor="sb-range-timeformat" className={SECTION_LABEL}>
                      Time format
                    </label>
                    <select
                      id="sb-range-timeformat"
                      value={timeFormat}
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
                )}
              </div>
            )}
          </div>

          {/* ── What to print ── */}
          <div className="min-w-0 sm:border-l sm:border-line sm:pl-6">
            <p className={COLUMN_TITLE}>What to print</p>

            {/* Both numbers shown against the same pair of dates. The difference
                between 2 and 3 for one span is the thing to see before picking,
                not after sending. */}
            <div className="flex flex-col gap-2.5">
              {RANGE_MODE_OPTIONS.map((o) => (
                <label key={o.value} className={RADIO_ROW}>
                  <input
                    type="radio"
                    name="sb-range-mode"
                    className={RADIO}
                    checked={mode === o.value}
                    onChange={() => setMode(o.value)}
                  />
                  <span>
                    {o.label}
                    <span className={cn(HINT, 'mt-0.5 block font-mono')}>
                      1 to 3 September → {o.sample}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {mode !== 'between' && (
                <div>
                  <label htmlFor="sb-range-inclusive-label" className={SECTION_LABEL}>
                    Word after the {mode === 'both' ? 'first' : ''} number
                  </label>
                  <Input
                    id="sb-range-inclusive-label"
                    ref={firstFieldRef}
                    value={inclusiveLabel}
                    onChange={(e) => setInclusiveLabel(e.target.value)}
                    placeholder="days"
                  />
                </div>
              )}

              {mode === 'both' && (
                <div>
                  <label htmlFor="sb-range-joiner" className={SECTION_LABEL}>
                    Between the two
                  </label>
                  <Input
                    id="sb-range-joiner"
                    value={joiner}
                    onChange={(e) => setJoiner(e.target.value)}
                    placeholder="and"
                  />
                </div>
              )}

              {mode !== 'inclusive' && (
                <div>
                  <label htmlFor="sb-range-between-label" className={SECTION_LABEL}>
                    Word after the {mode === 'both' ? 'second' : ''} number
                  </label>
                  <Input
                    id="sb-range-between-label"
                    value={betweenLabel}
                    onChange={(e) => setBetweenLabel(e.target.value)}
                    placeholder="your word"
                  />
                </div>
              )}
            </div>
            <p className={HINT}>
              Your words, in your language. Leave one blank to print the bare number.
            </p>
          </div>
        </div>

        {/* The sentence and the block it comes from, full width: both are the
            result of every control above, so neither belongs to one column. */}
        <div className="border-t border-line bg-bg px-6 py-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
              1 to 3 September prints
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
          <Button type="button" variant="primary" disabled={!reuseValid} onClick={handleSubmit}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
