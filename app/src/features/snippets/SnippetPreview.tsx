import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  clockValue,
  dayValue,
  fillForm,
  loadFillFormEngine,
  runFormButton,
  type SbDayMode,
  type SbFillField,
  type SbFillFormViewModel,
} from '@/lib/fillFormEngine';

/**
 * Live preview of a snippet body — the fields it asks for, and the message it
 * produces once they are answered.
 *
 * Replaces the standalone Composer view in `Sprintbrain.html`: same three
 * panes, same shared engine, but reading the snippet being edited instead of
 * something pasted into a second app. Nothing here decides what a field is —
 * `extension/shared/fill-form.js` answers that for all five fill surfaces and
 * this component only draws the view model it returns.
 */

/** Matches the composer's rebuild delay — a parse per keystroke buys nothing. */
const REBUILD_DELAY_MS = 150;

/** How the choices of a `{formmenu:}` are shown, by whether it takes several. */
function optionInputType(field: SbFillField): 'checkbox' | 'radio' {
  return field.multiple ? 'checkbox' : 'radio';
}

/** The HTML input type for a non-menu field. */
function inputType(field: SbFillField): string {
  switch (field.type) {
    case 'date':
      return 'date';
    case 'time':
      return 'time';
    case 'datetime':
      return 'datetime-local';
    case 'number':
      return 'number';
    default:
      return 'text';
  }
}

/** `PRICE_PER_UNIT` reads as a label, not as a variable name. */
function fieldLabel(key: string): string {
  return key.replace(/_/g, ' ');
}

/**
 * The prose before a field is worth showing only when it says something the
 * label does not: `Plan: {formmenu: …; name=PLAN}` would otherwise render as
 * "PLAN" above "Plan:", twice, on every menu in the form.
 */
function isEchoOfLabel(prose: string, label: string): boolean {
  const strip = (s: string) => s.trim().replace(/[\s:：\-–—]+$/, '').toLowerCase();
  return strip(prose) === strip(label);
}

interface SnippetPreviewProps {
  /** The body being edited, in the active language slot. */
  body: string;
  /** Language code, or '' for a Multi body which carries no single language. */
  lang: string;
}

export function SnippetPreview({ body, lang }: SnippetPreviewProps) {
  const [engineReady, setEngineReady] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  // Formats picked in a field's Adjust panel. Beside `values` rather than in
  // it: the same kind of answer, given while the form is open and never saved.
  const [fmts, setFmts] = useState<Record<string, string>>({});
  const [buttonErrors, setButtonErrors] = useState<string[]>([]);
  const [copied, setCopied] = useState<'idle' | 'done' | 'failed'>('idle');
  // The body lags the textarea by one debounce, so typing does not re-parse on
  // every keystroke. Everything below reads this, never the raw prop.
  const [debouncedBody, setDebouncedBody] = useState(body);

  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFillFormEngine()
      .then(() => {
        if (!cancelled) setEngineReady(true);
      })
      .catch(() => {
        if (!cancelled) {
          setEngineError(
            'The preview engine could not be loaded. Reload the page to try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedBody(body), REBUILD_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [body]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  // A body edit can retire a field; its stale entry must not keep resolving.
  useEffect(() => {
    setButtonErrors([]);
  }, [debouncedBody]);

  const view: SbFillFormViewModel | null = useMemo(() => {
    if (!engineReady) return null;
    return fillForm(debouncedBody, values, { lang, fieldFmt: fmts });
  }, [engineReady, debouncedBody, values, fmts, lang]);

  const setValue = useCallback((key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  }, []);

  const setFormat = useCallback((key: string, format: string) => {
    setFmts((prev) => ({ ...prev, [key]: format }));
  }, []);

  const toggleOption = useCallback(
    (field: SbFillField, option: string, checked: boolean) => {
      if (!field.multiple) {
        setValue(field.key, option);
        return;
      }
      const next = checked
        ? [...field.picks, option]
        : field.picks.filter((p) => p !== option);
      // A multi-choice menu resolves from one ", "-joined value, the same shape
      // the other fill surfaces store.
      setValue(field.key, next.join(', '));
    },
    [setValue],
  );

  const handleButton = useCallback(
    (buttonId: string) => {
      if (!view) return;
      const effective: Record<string, string> = {};
      for (const field of view.fields) effective[field.key] = field.value;

      const { values: written, errors } = runFormButton(
        debouncedBody,
        buttonId,
        effective,
      );

      const unknown: string[] = [];
      const applied: Record<string, string> = {};
      for (const [name, value] of Object.entries(written)) {
        const target = view.fields.find((f) => f.key === name);
        if (!target) {
          unknown.push(`No field called ${name}`);
          continue;
        }
        if (target.type === 'dd' && target.multiple) {
          unknown.push(`${name} is a multi-choice menu`);
          continue;
        }
        if (target.type === 'dd' && !target.options.includes(value)) {
          unknown.push(`${name} has no option "${value}"`);
          continue;
        }
        applied[name] = value;
      }

      setValues((prev) => ({ ...prev, ...applied }));
      setButtonErrors([...errors, ...unknown]);
    },
    [view, debouncedBody],
  );

  async function handleCopy() {
    if (!view?.preview) return;
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(view.preview);
      setCopied('done');
    } catch {
      // The browser refused the clipboard — say so rather than looking idle.
      setCopied('failed');
    }
    copyTimer.current = window.setTimeout(() => setCopied('idle'), 1800);
  }

  const fields = view?.fields ?? [];
  const buttons = view?.buttons ?? [];
  const hasBody = debouncedBody.trim().length > 0;

  return (
    <aside
      aria-label="Live preview"
      // Matches the dialog's insert rail on the other side, so the editor
      // sits between two equal columns instead of off-centre.
      className="flex w-[260px] shrink-0 flex-col overflow-hidden bg-bg"
    >
      {/* ── Values ── */}
      {/* Takes the larger share: this pane is the one being operated, and a
          form of six fields should not need scrolling to reach half of them. */}
      <div className="flex min-h-0 flex-[1.4] flex-col border-b border-line">
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
            Values
          </p>
          {fields.length > 0 && (
            <span className="rounded-full border border-primary/25 bg-primary-light px-2 py-px text-[10px] font-semibold text-primary">
              {fields.length} {fields.length === 1 ? 'field' : 'fields'}
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          {engineError ? (
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
              <AlertCircle className="mt-px h-3 w-3 shrink-0" aria-hidden />
              {engineError}
            </p>
          ) : !engineReady ? (
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              Starting the preview…
            </p>
          ) : fields.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-ink-subtle">
              {hasBody
                ? 'This snippet has no fields to fill — the result is below.'
                : 'Add a field or a formula and it appears here to try out.'}
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {fields.map((field) => (
                <PreviewField
                  key={field.key}
                  field={field}
                  onChange={(value) => setValue(field.key, value)}
                  onFormat={(format) => setFormat(field.key, format)}
                  onToggleOption={(option, checked) =>
                    toggleOption(field, option, checked)
                  }
                />
              ))}

              {buttons.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {buttons.map((button) => (
                    <button
                      key={button.id}
                      type="button"
                      onClick={() => handleButton(button.id)}
                      className="rounded-lg border border-primary/30 bg-primary-light px-2.5 py-1.5 text-xs font-semibold text-primary transition-colors hover:border-primary/60"
                    >
                      {button.label}
                    </button>
                  ))}
                </div>
              )}

              {buttonErrors.length > 0 && (
                <p className="text-[11px] leading-relaxed text-danger">
                  {buttonErrors.join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Result ── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
            Result
          </p>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!view?.preview}
            className={cn(
              'ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-card px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors',
              'hover:border-primary/30 hover:text-primary disabled:opacity-40 disabled:hover:border-line disabled:hover:text-ink-muted',
              copied === 'failed' && 'border-danger/40 text-danger',
            )}
          >
            {copied === 'done' ? (
              <Check className="h-3 w-3" aria-hidden />
            ) : (
              <Copy className="h-3 w-3" aria-hidden />
            )}
            {copied === 'done' ? 'Copied' : copied === 'failed' ? 'Blocked' : 'Copy'}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
          <div
            className={cn(
              'h-full min-h-[120px] whitespace-pre-wrap break-words rounded-[10px] border border-line bg-card px-3 py-2.5 font-mono text-xs leading-relaxed',
              view?.preview ? 'text-ink' : 'italic text-ink-subtle',
            )}
          >
            {view?.preview || 'The finished message appears here as you type.'}
          </div>
        </div>
      </div>
    </aside>
  );
}

interface PreviewFieldProps {
  field: SbFillField;
  onChange: (value: string) => void;
  onFormat: (format: string) => void;
  onToggleOption: (option: string, checked: boolean) => void;
}

/**
 * One row of the fill form. The prose either side of the token comes with the
 * field, so a row reads the way the body does; a choice list is block level and
 * takes its context above and below instead of beside it.
 */
function PreviewField({ field, onChange, onFormat, onToggleOption }: PreviewFieldProps) {
  // A stored display name wins; otherwise the key, humanised.
  const label = field.label || fieldLabel(field.key);
  const showBefore = field.before !== '' && !isEchoOfLabel(field.before, label);
  const before = showBefore ? (
    <span className="text-[11px] leading-snug text-ink-muted">{field.before}</span>
  ) : null;
  const after = field.after ? (
    <span className="text-[11px] leading-snug text-ink-muted">{field.after}</span>
  ) : null;

  if (field.type === 'dd') {
    const type = optionInputType(field);
    return (
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
          {label}
        </span>
        {before}
        {/* Every option on screen, for both kinds of menu: a <select> hides the
            choices behind a control most people do not read as a menu at all.
            Mirrors the overlay, the popup detail and the mobile fill form. */}
        <div className="flex flex-col gap-0.5">
          {field.options.map((option) => {
            const checked = field.picks.includes(option);
            return (
              <label
                key={option}
                className={cn(
                  'flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 text-xs transition-colors hover:bg-bg-alt',
                  checked ? 'font-semibold text-primary' : 'text-ink',
                )}
              >
                <input
                  type={type}
                  // Radios need a group name or two menus share a group.
                  name={type === 'radio' ? `sb-preview-${field.key}` : undefined}
                  checked={checked}
                  onChange={(e) => onToggleOption(option, e.target.checked)}
                  className="h-3.5 w-3.5 shrink-0 accent-primary"
                />
                <span className="min-w-0 break-words">{option}</span>
              </label>
            );
          })}
        </div>
        {after}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {before}
        <input
          type={inputType(field)}
          value={field.value}
          placeholder={label}
          onChange={(e) => onChange(e.target.value)}
          style={field.cols ? { width: `${field.cols}ch`, maxWidth: '100%' } : undefined}
          className={cn(
            'min-w-0 rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs text-ink transition-colors',
            'placeholder:text-ink-subtle focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20',
            // A floor, not a width: long surrounding prose would otherwise
            // squeeze a flex-1 input down to a few characters. The row wraps,
            // so the prose gives way and takes the line above instead.
            field.cols ? '' : 'flex-1 min-w-[7rem]',
          )}
        />
        {after}
      </div>
      <PreviewAdjust field={field} onValue={onChange} onFormat={onFormat} />
    </div>
  );
}

const ADJ_CONTROL =
  'h-7 min-w-0 flex-1 rounded-lg border border-line bg-card px-2 text-[11px] text-ink ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';
const ADJ_LABEL =
  'w-11 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle';

interface PreviewAdjustProps {
  field: SbFillField;
  onValue: (value: string) => void;
  onFormat: (format: string) => void;
}

/**
 * The Date/Time builder's three decisions — which format, which day, what time
 * on it — offered again while the form is open, so a date that is nearly right
 * does not have to be typed out by hand.
 *
 * What each control MEANS is decided in `extension/shared/fill-form.js`; this
 * only draws it, in the same words and the same order as the builder in the
 * rail. Day and Clock write a value the operator could have picked by hand, so
 * they go through `onValue` and everything downstream reads them as ordinary
 * answers. Only Format is held apart: it changes how the value prints, not what
 * the value is.
 *
 * Collapsed behind one link. Nearly every fill wants the day the field already
 * opens on, and three rows under every date would push a short form off screen
 * for a choice most people never make.
 */
function PreviewAdjust({ field, onValue, onFormat }: PreviewAdjustProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<SbDayMode>('none');
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState('D');
  const [back, setBack] = useState(false);
  const [named, setNamed] = useState('');

  const adjust = field.adjust;
  if (!adjust) return null;

  const namedValue = named || adjust.days[0]?.value || '';

  // Every control recomputes the whole choice, because the answer is the four
  // of them together: changing the unit with an amount already typed must move
  // the date, not wait for the amount to be retyped.
  function applyDay(next: {
    mode?: SbDayMode;
    amount?: string;
    unit?: string;
    back?: boolean;
    named?: string;
  }) {
    const value = dayValue(
      field.type,
      {
        mode: next.mode ?? mode,
        amount: next.amount ?? amount,
        unit: next.unit ?? unit,
        back: next.back ?? back,
        named: next.named ?? namedValue,
      },
      field.value,
    );
    // '' means the engine has not loaded. Writing it would clear a date the
    // operator already set, which is worse than the control doing nothing.
    if (value) onValue(value);
  }

  function applyClock(hour: string, minute: string) {
    const value = clockValue(field.type, hour, minute, field.value);
    if (value) onValue(value);
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'self-start px-1 py-0.5 text-[10px] font-semibold transition-colors',
          open ? 'text-primary' : 'text-ink-subtle hover:text-primary',
        )}
      >
        Adjust {open ? '▴' : '▾'}
      </button>

      {open && (
        <div className="mt-1 flex flex-col gap-1.5 rounded-lg border border-line bg-bg-alt px-2 py-2">
          {adjust.formats.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={ADJ_LABEL}>Format</span>
              <select
                value={field.format}
                onChange={(e) => onFormat(e.target.value)}
                className={ADJ_CONTROL}
              >
                {adjust.formats.map((f) => (
                  <option key={f.value || 'raw'} value={f.value}>
                    {f.label} · {f.sample}
                  </option>
                ))}
              </select>
            </div>
          )}

          {adjust.modes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={ADJ_LABEL}>Day</span>
              <select
                value={mode}
                onChange={(e) => {
                  const next = e.target.value as SbDayMode;
                  setMode(next);
                  applyDay({ mode: next });
                }}
                className={ADJ_CONTROL}
              >
                {adjust.modes.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>

              {/* Only one of the two shapes is ever an answer, so the other is
                  not on screen at all rather than sitting there disabled. */}
              {mode === 'fixed' && (
                <div className="flex w-full items-center gap-1.5">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      applyDay({ amount: e.target.value });
                    }}
                    className={cn(ADJ_CONTROL, 'w-14 flex-none')}
                  />
                  <select
                    value={unit}
                    onChange={(e) => {
                      setUnit(e.target.value);
                      applyDay({ unit: e.target.value });
                    }}
                    className={ADJ_CONTROL}
                  >
                    {adjust.units.map((u) => (
                      <option key={u.value} value={u.value}>
                        {u.label}
                      </option>
                    ))}
                  </select>
                  <label className="flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-ink-muted">
                    <input
                      type="checkbox"
                      checked={back}
                      onChange={(e) => {
                        setBack(e.target.checked);
                        applyDay({ back: e.target.checked });
                      }}
                      className="h-3 w-3 accent-primary"
                    />
                    backwards
                  </label>
                </div>
              )}

              {mode === 'named' && (
                <select
                  value={namedValue}
                  onChange={(e) => {
                    setNamed(e.target.value);
                    applyDay({ named: e.target.value });
                  }}
                  className={cn(ADJ_CONTROL, 'w-full flex-none')}
                >
                  {adjust.days.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {adjust.hours.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={ADJ_LABEL}>Clock</span>
              <select
                value={adjust.hour}
                onChange={(e) => applyClock(e.target.value, adjust.minute)}
                className={ADJ_CONTROL}
              >
                {adjust.hours.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <span className="shrink-0 text-[11px] text-ink-subtle">:</span>
              <select
                value={adjust.minute}
                onChange={(e) => applyClock(adjust.hour, e.target.value)}
                className={ADJ_CONTROL}
              >
                {adjust.minutes.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
