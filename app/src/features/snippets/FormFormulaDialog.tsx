import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
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
import { fillFormApi, formulaEngine, loadFillFormEngine } from '@/lib/fillFormEngine';
import {
  buildFormNumberToken,
  DEFAULT_CURRENCY,
  isValidFieldName,
  nextNumberName,
} from '@/lib/formNumberToken';
import {
  buildFormulaToken,
  buildPriceAdjustToken,
  DEFAULT_DECIMALS,
  FORMULA_OPERATIONS,
  getFormulaOperation,
  getPriceAdjustment,
  hasDuplicateNames,
  isValidFormula,
  isValidPriceAdjust,
  nextNumberNames,
  parsePercent,
  PRICE_ADJUSTMENTS,
  priceFieldNames,
  formulasInBody,
  freeName,
  insideCondition,
  ratesInBody,
  type FormulaDecimals,
  type FormulaInBody,
  type FormulaOperation,
  type PriceAdjustment,
} from '@/lib/formulaToken';

const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const ERROR = 'mt-1.5 text-[11px] text-danger';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const SELECT =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 font-mono text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

type BuilderMode = 'adjust' | 'numbers';

const MODE_OPTIONS: readonly { value: BuilderMode; label: string }[] = [
  { value: 'adjust', label: 'Adjust a price' },
  { value: 'numbers', label: 'New numbers' },
];

const PERCENT_SOURCE_OPTIONS: readonly { value: 'typed' | 'rate'; label: string }[] = [
  { value: 'typed', label: 'Type a %' },
  { value: 'rate', label: 'Use a rate' },
];

const DECIMAL_OPTIONS: readonly { value: `${FormulaDecimals}`; label: string }[] = [
  { value: '0', label: 'Whole number' },
  { value: '1', label: '1 decimal' },
  { value: '2', label: '2 decimals' },
];

// What the example under "Adjust a price" fills the two prices with.
const SAMPLE_PRICE = '100';
const SAMPLE_OTHER = '80';

/** A row of choices where exactly one is picked; wraps onto a grid. */
function ChoiceGrid<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  columns,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  columns: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={cn('grid gap-1.5', columns)}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'h-9 rounded-[8px] border px-2 text-xs font-medium transition-colors',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active
                ? 'border-primary bg-primary text-white'
                : 'border-line bg-card text-ink hover:bg-bg-alt',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function RoundingControl({
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
      <p className={HINT}>How many decimals the answer keeps. The numbers typed in print as typed.</p>
    </div>
  );
}

interface FormFormulaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited: its fields feed "Adjust a price", and new names never collide with them. */
  body: string;
  /** Where the answer goes: a rate is only read below where it is set. */
  caret: number;
  onInsert: (token: string) => void;
  /** Swaps a range of the body for `text`: '' removes a formula, the old text undoes it. */
  onReplace: (start: number, end: number, text: string) => void;
}

/**
 * Builds a formula, in one of two modes.
 *
 * - **Adjust a price** works out a line from a box the snippet already has
 *   (minus or plus a percentage, a part of it, the gap to another price) and
 *   inserts only the answer. This is the quote case: the prices are typed once
 *   and every other line follows from them.
 * - **New numbers** writes fresh number boxes and prints the working with the
 *   answer, `100 - 25 - 5 = 70`.
 *
 * Both lists come from `@/lib/formulaToken`, so a new operation or change
 * appears here without touching this file.
 */
export function FormFormulaDialog({
  open,
  onOpenChange,
  body,
  caret,
  onInsert,
  onReplace,
}: FormFormulaDialogProps) {
  const [mode, setMode] = useState<BuilderMode>('numbers');

  // New numbers.
  const [operation, setOperation] = useState<FormulaOperation>('add');
  const [names, setNames] = useState<string[]>([]);
  const [decimals, setDecimals] = useState<FormulaDecimals>(DEFAULT_DECIMALS);

  // Adjust a price.
  const [priceFields, setPriceFields] = useState<string[]>([]);
  const [fieldsFailed, setFieldsFailed] = useState(false);
  const [adjustment, setAdjustment] = useState<PriceAdjustment>('minusPercent');
  const [price, setPrice] = useState('');
  const [other, setOther] = useState('');
  const [percent, setPercent] = useState('');
  const [percentSource, setPercentSource] = useState<'typed' | 'rate'>('typed');
  const [rate, setRate] = useState('');
  const [saveRate, setSaveRate] = useState(true);
  const [newRateName, setNewRateName] = useState('');
  const [newBoxName, setNewBoxName] = useState('');
  // What the last Remove took out, and where, so Undo can put it back.
  const [lastRemoved, setLastRemoved] = useState<{ start: number; text: string; description: string } | null>(null);
  const [adjustDecimals, setAdjustDecimals] = useState<FormulaDecimals>(DEFAULT_DECIMALS);

  // The body as of now, for the effects below that run on opening only. A
  // removal from the list changes the body while the dialog is open, and that
  // must not wipe a formula the author is halfway through building.
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  // Every opening starts clean: a half-built formula carried over from a
  // cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    const openingBody = bodyRef.current;
    setMode('numbers');
    setOperation('add');
    setNames(nextNumberNames(openingBody, 2));
    setDecimals(DEFAULT_DECIMALS);
    setPriceFields([]);
    setFieldsFailed(false);
    setAdjustment('minusPercent');
    setPrice('');
    setOther('');
    setPercent('');
    setPercentSource('typed');
    setRate('');
    setSaveRate(true);
    setNewRateName('');
    setAdjustDecimals(DEFAULT_DECIMALS);
    setLastRemoved(null);
    // PRICE unless the body already uses it somewhere, e.g. in a text field.
    setNewBoxName(/\bPRICE\b/.test(openingBody) ? nextNumberName(openingBody) : 'PRICE');
  }, [open]);

  // Which boxes the body already has, read by the same fill-form decider every
  // surface uses, so the list matches what the fill form will ask for. With
  // one to adjust, that is the mode the dialog opens on.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadFillFormEngine()
      .then((api) => {
        if (!alive) return;
        const found = priceFieldNames(api.fillForm(bodyRef.current, {}, {}).fields);
        setPriceFields(found);
        if (found.length > 0) {
          setMode('adjust');
          setPrice(found[0] ?? '');
          setOther(found[1] ?? '');
        }
      })
      .catch(() => {
        if (alive) setFieldsFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // Keeps the price list true to the body while the dialog is open: a removed
  // block can take its boxes with it. The choices stand unless their box went.
  useEffect(() => {
    if (!open) return;
    const api = fillFormApi();
    if (!api) return;
    const found = priceFieldNames(api.fillForm(body, {}, {}).fields);
    setPriceFields(found);
    setPrice((p) => (found.includes(p) ? p : (found[0] ?? '')));
    setOther((o) => (found.includes(o) ? o : ''));
  }, [open, body]);

  // ── Formulas already in the body ──
  const formulas = useMemo(() => formulasInBody(body), [body]);

  function removeFormula(f: FormulaInBody) {
    setLastRemoved({ start: f.removeStart, text: body.slice(f.removeStart, f.removeEnd), description: f.description });
    onReplace(f.removeStart, f.removeEnd, '');
  }

  function undoRemove() {
    if (!lastRemoved) return;
    onReplace(lastRemoved.start, lastRemoved.start, lastRemoved.text);
    setLastRemoved(null);
  }

  // Inside an {if:} already, the builder writes no guard of its own: blocks
  // cannot nest, and an inner one would close the outer one early.
  const inCondition = useMemo(() => insideCondition(body.slice(0, caret)), [body, caret]);

  // ── New numbers ──
  const spec = getFormulaOperation(operation);
  const fixedCount = spec.minOperands === spec.maxOperands;
  const duplicate = hasDuplicateNames(names);
  const numbersValid = isValidFormula({ operation, names, decimals });
  const numbersToken = useMemo(
    () => buildFormulaToken({ operation, names, decimals, inCondition }),
    [operation, names, decimals, inCondition],
  );

  function nextFreeName(taken: string[]): string {
    return nextNumberName(`${body} ${taken.join(' ')}`);
  }

  // Switching operation keeps the names already typed, and only adds or drops
  // rows to fit how many numbers the new one takes.
  function chooseOperation(next: FormulaOperation) {
    const nextSpec = getFormulaOperation(next);
    setOperation(next);
    setNames((prev) => {
      const fitted = prev.slice(0, nextSpec.maxOperands);
      while (fitted.length < nextSpec.minOperands) fitted.push(nextFreeName(fitted));
      return fitted;
    });
  }

  function rename(index: number, raw: string) {
    // Disallowed characters are stripped as they are typed, the same as the
    // number dialog: a space failing validation with no visible cause is worse.
    const next = raw.replace(/[^A-Za-z0-9_]/g, '');
    setNames((prev) => prev.map((n, i) => (i === index ? next : n)));
  }

  // ── Adjust a price ──
  // With no price box yet, the box is written together with its formula: the
  // name typed here stands in for the price until both are inserted.
  const creatingBox = mode === 'adjust' && !fieldsFailed && priceFields.length === 0;
  const priceName = creatingBox ? newBoxName : price;
  const adjustSpec = getPriceAdjustment(adjustment);
  const otherChoices = priceFields.filter((f) => f !== priceName);
  // Rates set above the cursor can be reused here; one set below would read 0.
  const rates = useMemo(() => ratesInBody(body.slice(0, caret)), [body, caret]);
  // Every name a new rate must not reuse: the boxes and every rate anywhere.
  const bodyRateNames = useMemo(() => ratesInBody(body).map((r) => r.name), [body]);
  const takenNames = useMemo(
    () => [...priceFields, ...(creatingBox ? [newBoxName] : []), ...bodyRateNames],
    [priceFields, creatingBox, newBoxName, bodyRateNames],
  );
  const boxNameTaken =
    creatingBox && bodyRateNames.some((n) => n.toUpperCase() === newBoxName.toUpperCase());
  const suggestedRateName = adjustSpec.rateName ? freeName(adjustSpec.rateName, takenNames) : '';
  const rateNameValue = newRateName === '' ? suggestedRateName : newRateName;
  const rateNameTaken = takenNames.some((n) => n.toUpperCase() === rateNameValue.toUpperCase());
  const writesNewRate = adjustSpec.needsPercent && percentSource === 'typed' && saveRate;
  const adjustCfg = {
    adjustment,
    price: priceName,
    other,
    percentSource,
    percent,
    rate,
    newRate: writesNewRate ? rateNameValue : '',
    decimals: adjustDecimals,
    inCondition,
  };
  const adjustValid =
    isValidPriceAdjust(adjustCfg) && !(writesNewRate && rateNameTaken) && !boxNameTaken;
  const answerToken = buildPriceAdjustToken(adjustCfg);
  // A new box goes where the cursor is and its answer on the line below, so
  // the author types the words around each.
  const adjustToken = creatingBox
    ? `${buildFormNumberToken({ name: newBoxName, format: 'plain', currency: DEFAULT_CURRENCY, default: '' })}\n${answerToken}`
    : answerToken;
  const percentValue = parsePercent(percent);
  const percentError =
    !adjustSpec.needsPercent || percentSource === 'rate' || percent.trim() === ''
      ? ''
      : percentValue === null
        ? 'Type a number, like 1.5.'
        : adjustment === 'minusPercent' && percentValue > 100
          ? 'A discount cannot be more than 100%.'
          : '';

  // The answer the inserted formula gives for sample prices, worked out by the
  // real engine rather than a copy of the arithmetic.
  const example = useMemo(() => {
    const engine = formulaEngine();
    if (!engine || !adjustValid) return '';
    const vals: Record<string, string> = { [priceName]: SAMPLE_PRICE };
    if (adjustSpec.needsOther) vals[other] = SAMPLE_OTHER;
    const usedRate = rates.find((r) => r.name === rate);
    if (adjustSpec.needsPercent && percentSource === 'rate' && usedRate) vals[usedRate.name] = usedRate.value;
    return engine.resolveBody(answerToken, vals);
  }, [answerToken, adjustValid, adjustSpec, priceName, other, percentSource, rate, rates]);

  function chooseAdjustment(next: PriceAdjustment) {
    const nextSpec = getPriceAdjustment(next);
    setAdjustment(next);
    setAdjustDecimals(nextSpec.defaultDecimals);
    // A name typed for the previous change's rate would misname this one.
    setNewRateName('');
    if (nextSpec.needsOther && (other === '' || other === priceName)) {
      setOther(priceFields.find((f) => f !== priceName) ?? '');
    }
  }

  function choosePrice(next: string) {
    setPrice(next);
    if (other === next) setOther(priceFields.find((f) => f !== next) ?? '');
  }

  const canInsert = mode === 'adjust' ? adjustValid : numbersValid;
  const token = mode === 'adjust' ? adjustToken : numbersToken;

  function handleSubmit() {
    if (!canInsert) return;
    onInsert(token);
    onOpenChange(false);
  }

  function submitOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Never taller than the screen: with a list of formulas above the form
          it can be. The title and the buttons stay put; the middle scrolls. */}
      <DialogContent
        className="max-h-[90vh] max-w-[480px] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Insert formula</DialogTitle>
          <DialogDescription>
            {creatingBox
              ? 'Adds a price box and, on the line below, the answer worked out from it.'
              : mode === 'adjust'
              ? 'Works out a line from a price the snippet already asks for, and inserts only the answer.'
              : 'Numbers typed in when the snippet expands, and the answer worked out for you.'}
          </DialogDescription>
        </DialogHeader>

        {/* shrink-0 on every section: in a scrolling column, a section that
            clips its own overflow (the mode switch, the list) would otherwise
            be squeezed to nothing instead of the column scrolling. */}
        <div className="min-h-0 overflow-y-auto px-6 pb-2 flex flex-col gap-4 [&>*]:shrink-0">
          {(formulas.length > 0 || lastRemoved) && (
            <div>
              <span className={SECTION_LABEL}>In this snippet</span>
              {formulas.length > 0 && (
                <ul className="max-h-[152px] divide-y divide-line overflow-y-auto rounded-[10px] border border-line">
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
                        onClick={() => removeFormula(f)}
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
                <p className={HINT}>
                  Removed {lastRemoved.description}.{' '}
                  <button
                    type="button"
                    onClick={undoRemove}
                    className="font-medium text-primary hover:underline"
                  >
                    Undo
                  </button>
                </p>
              )}
            </div>
          )}

          <Segmented
            options={MODE_OPTIONS}
            value={mode}
            onChange={setMode}
            ariaLabel="Formula mode"
            className="w-full [&>button]:flex-1"
          />

          {mode === 'adjust' ? (
            fieldsFailed ? (
              <p className={ERROR}>
                Could not read the fields in this snippet. Reload the page and try again.
              </p>
            ) : (
              <>
                {/* ── Price ── */}
                {creatingBox ? (
                  <div>
                    <label htmlFor="formula-new-box" className={SECTION_LABEL}>
                      Price box name
                    </label>
                    <Input
                      id="formula-new-box"
                      value={newBoxName}
                      onChange={(e) => setNewBoxName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
                      onKeyDown={submitOnEnter}
                      className={cn(
                        'h-10 rounded-[10px] font-mono',
                        (!isValidFieldName(newBoxName) || boxNameTaken) &&
                          'border-danger focus:border-danger focus:ring-danger/20',
                      )}
                    />
                    {boxNameTaken ? (
                      <p className={ERROR}>This snippet already uses that name. Pick another one.</p>
                    ) : isValidFieldName(newBoxName) ? (
                      <p className={HINT}>
                        This snippet has no price yet, so one comes with the formula: the box
                        where the cursor is, typed in when the snippet expands, and the answer
                        on the line below.
                      </p>
                    ) : (
                      <p className={ERROR}>
                        Letters, numbers and underscore, starting with a letter. For example PRICE.
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <label htmlFor="formula-price" className={SECTION_LABEL}>
                      Price
                    </label>
                    <select
                      id="formula-price"
                      value={price}
                      onChange={(e) => choosePrice(e.target.value)}
                      className={SELECT}
                    >
                      {priceFields.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* ── Change ── */}
                <div>
                  <span className={SECTION_LABEL}>Change</span>
                  <ChoiceGrid
                    options={PRICE_ADJUSTMENTS}
                    value={adjustment}
                    onChange={chooseAdjustment}
                    ariaLabel="Price change"
                    columns="grid-cols-3"
                  />
                  <p className={HINT}>{adjustSpec.hint}</p>
                </div>

                {adjustSpec.needsPercent && (
                  <div>
                    <label htmlFor="formula-percent" className={SECTION_LABEL}>
                      Percentage
                    </label>
                    {/* A rate set higher up can be reused, so one number
                        drives every line that depends on it. */}
                    {rates.length > 0 && (
                      <Segmented
                        options={PERCENT_SOURCE_OPTIONS}
                        value={percentSource}
                        onChange={(next) => {
                          setPercentSource(next);
                          if (next === 'rate' && !rates.some((r) => r.name === rate)) {
                            setRate(rates[0]?.name ?? '');
                          }
                        }}
                        ariaLabel="Where the percentage comes from"
                        className="mb-2 w-full [&>button]:flex-1"
                      />
                    )}
                    {percentSource === 'rate' && rates.length > 0 ? (
                      <>
                        <select
                          id="formula-percent"
                          value={rate}
                          onChange={(e) => setRate(e.target.value)}
                          className={SELECT}
                        >
                          {rates.map((r) => (
                            <option key={r.name} value={r.name}>
                              {r.name} ({r.value}%)
                            </option>
                          ))}
                        </select>
                        <p className={HINT}>
                          Change the rate&apos;s number in the text and every line using it
                          follows.
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <Input
                            id="formula-percent"
                            value={percent}
                            onChange={(e) => setPercent(e.target.value)}
                            onKeyDown={submitOnEnter}
                            inputMode="decimal"
                            placeholder="1.5"
                            className={cn(
                              'h-10 rounded-[10px] font-mono',
                              percentError && 'border-danger focus:border-danger focus:ring-danger/20',
                            )}
                          />
                          <span className="text-sm text-ink-muted" aria-hidden>
                            %
                          </span>
                        </div>
                        {percentError && <p className={ERROR}>{percentError}</p>}
                        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
                          <input
                            type="checkbox"
                            checked={saveRate}
                            onChange={(e) => setSaveRate(e.target.checked)}
                            className="h-4 w-4 accent-primary"
                          />
                          Save as a rate
                        </label>
                        {saveRate ? (
                          <div className="mt-2">
                            <Input
                              aria-label="Rate name"
                              value={rateNameValue}
                              onChange={(e) =>
                                setNewRateName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))
                              }
                              onKeyDown={submitOnEnter}
                              className={cn(
                                'h-10 rounded-[10px] font-mono',
                                (!isValidFieldName(rateNameValue) || rateNameTaken) &&
                                  'border-danger focus:border-danger focus:ring-danger/20',
                              )}
                            />
                            {rateNameTaken ? (
                              <p className={ERROR}>
                                This snippet already uses that name. Pick another one.
                              </p>
                            ) : !isValidFieldName(rateNameValue) ? (
                              <p className={ERROR}>
                                Letters, numbers and underscore, starting with a letter.
                              </p>
                            ) : (
                              <p className={HINT}>
                                The rate goes in just before this line, as{' '}
                                <code className="font-mono text-primary/80">
                                  {`{var: ${rateNameValue} = ${percentValue ?? '1.5'}}`}
                                </code>
                                . Other lines below can use it, and changing that one number
                                updates them all.
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className={HINT}>
                            The number goes straight into this line&apos;s formula, where you
                            can still change it by hand.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                )}

                {adjustSpec.needsOther && (
                  <div>
                    <label htmlFor="formula-other" className={SECTION_LABEL}>
                      Other price
                    </label>
                    {otherChoices.length === 0 ? (
                      <p className={ERROR}>
                        This needs a second price box. Add one from Fields &gt; Number.
                      </p>
                    ) : (
                      <select
                        id="formula-other"
                        value={other}
                        onChange={(e) => setOther(e.target.value)}
                        className={SELECT}
                      >
                        {otherChoices.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <RoundingControl value={adjustDecimals} onChange={setAdjustDecimals} />

                {example !== '' && (
                  <p className="text-[11px] text-ink-subtle">
                    With {priceName} at {SAMPLE_PRICE}
                    {adjustSpec.needsOther ? ` and ${other} at ${SAMPLE_OTHER}` : ''}, this prints{' '}
                    <code className="font-mono text-primary/80">{example}</code>
                  </p>
                )}
              </>
            )
          ) : (
            <>
              {/* ── Operation ── */}
              <div>
                <span className={SECTION_LABEL}>Operation</span>
                <ChoiceGrid
                  options={FORMULA_OPERATIONS}
                  value={operation}
                  onChange={chooseOperation}
                  ariaLabel="Formula operation"
                  columns="grid-cols-4"
                />
                <p className={HINT}>
                  {spec.hint} Prints as{' '}
                  <code className="font-mono text-primary/80">{spec.sample}</code>
                </p>
              </div>

              {/* ── Numbers ── */}
              <div>
                <span className={SECTION_LABEL}>Numbers</span>
                <div className="flex flex-col gap-2">
                  {names.map((name, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className={cn(
                          'shrink-0 text-xs text-ink-subtle',
                          spec.roles ? 'w-14' : 'w-3 text-center font-mono',
                        )}
                        aria-hidden
                      >
                        {spec.roles ? spec.roles[i] : i === 0 ? '' : spec.rowSign}
                      </span>
                      <Input
                        value={name}
                        aria-label={spec.roles ? `${spec.roles[i]} name` : `Number ${i + 1} name`}
                        onChange={(e) => rename(i, e.target.value)}
                        onKeyDown={submitOnEnter}
                        className={cn(
                          'h-10 rounded-[10px] font-mono',
                          !isValidFieldName(name) && 'border-danger focus:border-danger focus:ring-danger/20',
                        )}
                      />
                      {!fixedCount && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setNames((prev) => prev.filter((_, j) => j !== i))}
                          disabled={names.length <= spec.minOperands}
                          aria-label={`Remove number ${i + 1}`}
                          title={
                            names.length <= spec.minOperands
                              ? 'A formula needs at least two numbers.'
                              : 'Remove number'
                          }
                          className="h-10 w-10 shrink-0 p-0"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                {!fixedCount && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setNames((prev) => [...prev, nextFreeName(prev)])}
                    disabled={names.length >= spec.maxOperands}
                    className="mt-2"
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add number
                  </Button>
                )}
                {duplicate ? (
                  <p className={ERROR}>Each number needs its own name, or two boxes fill as one.</p>
                ) : names.every(isValidFieldName) ? (
                  <p className={HINT}>
                    Each name is a number box in the fill form. A box left empty counts as 0.
                  </p>
                ) : (
                  <p className={ERROR}>
                    Letters, numbers and underscore, starting with a letter. For example NUM_1.
                  </p>
                )}
              </div>

              <RoundingControl value={decimals} onChange={setDecimals} />
            </>
          )}

          {/* ── What lands in the body ── */}
          {canInsert && (
            <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1">
                Inserts
              </p>
              <code className="block font-mono text-[11px] leading-relaxed text-ink-muted break-all">
                {token}
              </code>
            </div>
          )}
        </div>

        <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!canInsert}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
