import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { fillFormApi, formulaEngine, loadFillFormEngine } from '@/lib/fillFormEngine';
import { buildFormNumberToken, DEFAULT_CURRENCY } from '@/lib/formNumberToken';
import {
  buildPriceAdjustToken,
  DEFAULT_DECIMALS,
  freeName,
  getPriceAdjustment,
  insideCondition,
  isValidPriceAdjust,
  parsePercent,
  PRICE_ADJUSTMENTS,
  priceFieldNames,
  ratesInBody,
  type FormulaDecimals,
  type PriceAdjustment,
} from '@/lib/formulaToken';
import {
  ChoiceCards,
  ERROR,
  FormulaDialogFrame,
  HINT,
  MoreOptions,
  NameInput,
  NEW_BOX,
  RoundingControl,
  SECTION_LABEL,
  SELECT,
} from '@/features/snippets/formulaDialogParts';

const PERCENT_SOURCE_OPTIONS: readonly { value: 'typed' | 'rate'; label: string }[] = [
  { value: 'typed', label: 'Type a percentage' },
  { value: 'rate', label: 'Use a saved one' },
];

const ADJUSTMENT_CARDS = PRICE_ADJUSTMENTS.map((a) => ({ id: a.id, label: a.label, detail: a.hint }));

// What the example fills the prices with.
const SAMPLE_PRICE = '100';
const SAMPLE_OTHER = '80';

interface FormPriceLineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited: its boxes are the prices to pick from, and new names never clash with them. */
  body: string;
  /** Where the answer goes: a saved percentage is only read below where it is set. */
  caret: number;
  onInsert: (token: string) => void;
  /** Swaps a range of the body for `text`: '' removes a formula, the old text undoes it. */
  onReplace: (start: number, end: number, text: string) => void;
}

/**
 * One line of a quote, worked out from a price: the price minus a discount, plus
 * a fee, a deposit, what the client saves. It adds whatever price boxes it needs
 * itself, so it works from an empty snippet as much as from a finished one, and
 * it inserts only the answer.
 *
 * The choices come from `PRICE_ADJUSTMENTS` in `@/lib/formulaToken`, so a new
 * change appears here without touching this file.
 */
export function FormPriceLineDialog({
  open,
  onOpenChange,
  body,
  caret,
  onInsert,
  onReplace,
}: FormPriceLineDialogProps) {
  const [engineReady, setEngineReady] = useState(() => fillFormApi() !== null);
  const [fieldsFailed, setFieldsFailed] = useState(false);
  const [fields, setFields] = useState<{ key: string; type: string }[]>([]);

  const [adjustment, setAdjustment] = useState<PriceAdjustment>('minusPercent');
  // A picked box, NEW_BOX, or '' until the boxes are known.
  const [price, setPrice] = useState('');
  const [other, setOther] = useState('');
  // null means "not touched": the suggested name shows. '' is a name someone cleared.
  const [newBoxName, setNewBoxName] = useState<string | null>(null);
  const [newOtherName, setNewOtherName] = useState<string | null>(null);
  const [newRateName, setNewRateName] = useState<string | null>(null);
  const [percent, setPercent] = useState('');
  const [percentSource, setPercentSource] = useState<'typed' | 'rate'>('typed');
  const [rate, setRate] = useState('');
  const [saveRate, setSaveRate] = useState(true);
  const [decimals, setDecimals] = useState<FormulaDecimals>(DEFAULT_DECIMALS);

  // Every opening starts clean: a half-built line carried over from a cancelled
  // insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setFieldsFailed(false);
    setAdjustment('minusPercent');
    setPrice('');
    setOther('');
    setNewBoxName(null);
    setNewOtherName(null);
    setNewRateName(null);
    setPercent('');
    setPercentSource('typed');
    setRate('');
    setSaveRate(true);
    setDecimals(DEFAULT_DECIMALS);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (fillFormApi()) {
      setEngineReady(true);
      return;
    }
    let alive = true;
    loadFillFormEngine()
      .then(() => {
        if (alive) setEngineReady(true);
      })
      .catch(() => {
        if (alive) setFieldsFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  // The boxes the body has, read by the same fill-form decider every surface
  // uses, so the list matches what the fill form will ask for. Kept true to the
  // body while the window is open: removing a formula can take its boxes with it.
  useEffect(() => {
    if (!open || !engineReady) return;
    const api = fillFormApi();
    if (!api) return;
    setFields(api.fillForm(body, {}, {}).fields.map((f) => ({ key: f.key, type: f.type })));
  }, [open, engineReady, body]);

  const priceFields = useMemo(() => priceFieldNames(fields), [fields]);
  const spec = getPriceAdjustment(adjustment);

  // ── Which price, and which other price ──
  const priceSel = price === NEW_BOX || priceFields.includes(price) ? price : (priceFields[0] ?? NEW_BOX);
  const creatingBox = priceSel === NEW_BOX;
  const otherChoices = priceFields.filter((f) => f !== priceSel);
  const otherSel = other === NEW_BOX || otherChoices.includes(other) ? other : (otherChoices[0] ?? NEW_BOX);
  const creatingOther = spec.needsOther && otherSel === NEW_BOX;

  // Names a new box or rate must not reuse: every field, and every saved percentage.
  const rateNames = useMemo(() => ratesInBody(body).map((r) => r.name), [body]);
  const usedNames = useMemo(() => [...fields.map((f) => f.key), ...rateNames], [fields, rateNames]);
  const boxName = newBoxName ?? freeName('PRICE', usedNames);
  const otherBoxName = newOtherName ?? freeName('OTHER_PRICE', [...usedNames, ...(creatingBox ? [boxName] : [])]);
  const isTaken = (name: string, extra: readonly string[] = []) =>
    [...usedNames, ...extra].some((n) => n.toUpperCase() === name.toUpperCase());
  const boxNameTaken = creatingBox && isTaken(boxName);
  const otherNameTaken = creatingOther && isTaken(otherBoxName, creatingBox ? [boxName] : []);

  const priceName = creatingBox ? boxName : priceSel;
  const otherName = creatingOther ? otherBoxName : otherSel;

  // ── The percentage ──
  // Saved percentages set above the cursor can be reused; one set below would read 0.
  const rates = useMemo(() => ratesInBody(body.slice(0, caret)), [body, caret]);
  const useRate = spec.needsPercent && percentSource === 'rate' && rates.length > 0;
  const rateSel = rates.some((r) => r.name === rate) ? rate : (rates[0]?.name ?? '');
  const writesNewRate = spec.needsPercent && !useRate && saveRate;
  const rateTaken = (name: string) =>
    isTaken(name, [...(creatingBox ? [boxName] : []), ...(creatingOther ? [otherBoxName] : [])]);
  const rateName = newRateName ?? freeName(spec.rateName ?? 'RATE', [
    ...usedNames,
    ...(creatingBox ? [boxName] : []),
    ...(creatingOther ? [otherBoxName] : []),
  ]);
  const rateNameTaken = writesNewRate && rateTaken(rateName);
  const percentValue = parsePercent(percent);
  const percentError =
    !spec.needsPercent || useRate || percent.trim() === ''
      ? ''
      : percentValue === null
        ? 'Type a number, like 1.5.'
        : adjustment === 'minusPercent' && percentValue > 100
          ? 'A discount cannot be more than 100%.'
          : '';

  // Inside an {if:} already, no guard of its own is written: blocks cannot
  // nest, and an inner one would close the outer one early.
  const inCondition = useMemo(() => insideCondition(body.slice(0, caret)), [body, caret]);

  const cfg = {
    adjustment,
    price: priceName,
    other: otherName,
    percentSource: useRate ? ('rate' as const) : ('typed' as const),
    percent,
    rate: rateSel,
    newRate: writesNewRate ? rateName : '',
    decimals,
    inCondition,
  };
  const valid = isValidPriceAdjust(cfg) && !boxNameTaken && !otherNameTaken && !rateNameTaken;
  const answerToken = buildPriceAdjustToken(cfg);
  // New boxes go where the cursor is, one per line, and the answer on the line
  // below them, so the author types the words around each.
  const newBoxes = [...(creatingBox ? [boxName] : []), ...(creatingOther ? [otherBoxName] : [])];
  const token = [
    ...newBoxes.map((name) =>
      buildFormNumberToken({ name, format: 'plain', currency: DEFAULT_CURRENCY, default: '' }),
    ),
    answerToken,
  ].join('\n');

  // What the line prints for sample prices, worked out by the real engine rather
  // than a copy of the arithmetic.
  // Read during render, so the example redraws once the engine has loaded.
  const engine = engineReady ? formulaEngine() : null;
  const example = useMemo(() => {
    if (!engine || !valid) return '';
    const vals: Record<string, string> = { [priceName]: SAMPLE_PRICE };
    if (spec.needsOther) vals[otherName] = SAMPLE_OTHER;
    const used = rates.find((r) => r.name === rateSel);
    if (useRate && used) vals[used.name] = used.value;
    return engine.resolveBody(answerToken, vals);
  }, [answerToken, valid, spec.needsOther, priceName, otherName, useRate, rateSel, rates, engine]);

  const note = valid
    ? ''
    : spec.needsPercent && !useRate && percentValue === null
      ? 'Type the percentage to continue.'
      : 'Check the fields marked in red.';

  function handleInsert() {
    if (!valid) return;
    onInsert(token);
    onOpenChange(false);
  }

  const heading = spec.needsOther ? 'Start from this price' : 'Price';

  return (
    <FormulaDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Price line"
      description="One line of a quote worked out from a price: a discount, a fee, a deposit or the saving."
      body={body}
      onReplace={onReplace}
      note={note}
      canInsert={valid}
      onInsert={handleInsert}
    >
      {fieldsFailed ? (
        <p className={ERROR}>Could not read the fields in this snippet. Reload the page and try again.</p>
      ) : !engineReady ? (
        <p className={HINT}>Loading…</p>
      ) : (
        <>
          {/* ── What ── */}
          <div>
            <span className={SECTION_LABEL}>What do you want to work out?</span>
            <ChoiceCards
              options={ADJUSTMENT_CARDS}
              value={adjustment}
              onChange={(next) => {
                setAdjustment(next);
                setDecimals(getPriceAdjustment(next).defaultDecimals);
                // A name typed for the previous change's saved percentage would misname this one.
                setNewRateName(null);
              }}
              ariaLabel="What to work out"
              columns="grid-cols-1"
            />
          </div>

          {/* ── Price ── */}
          <div>
            <label htmlFor="price-line-price" className={SECTION_LABEL}>
              {heading}
            </label>
            {priceFields.length > 0 && (
              <select
                id="price-line-price"
                value={priceSel}
                onChange={(e) => setPrice(e.target.value)}
                className={cn(SELECT, creatingBox && 'mb-2')}
              >
                {priceFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
                <option value={NEW_BOX}>+ New price box</option>
              </select>
            )}
            {creatingBox && (
              <NameInput
                id={priceFields.length === 0 ? 'price-line-price' : undefined}
                ariaLabel="New price box name"
                value={boxName}
                onChange={setNewBoxName}
                onEnter={handleInsert}
                taken={boxNameTaken}
                example="PRICE"
                hint={
                  priceFields.length === 0
                    ? 'This snippet has no price yet, so one is added with the line: a box where the cursor is, filled in when the snippet expands.'
                    : 'A new price box, added with the line where the cursor is.'
                }
              />
            )}
          </div>

          {/* ── Percentage ── */}
          {spec.needsPercent && (
            <div>
              <label htmlFor="price-line-percent" className={SECTION_LABEL}>
                {spec.percentLabel ?? 'Percentage'}
              </label>
              {rates.length > 0 && (
                <Segmented
                  options={PERCENT_SOURCE_OPTIONS}
                  value={useRate ? 'rate' : 'typed'}
                  onChange={setPercentSource}
                  ariaLabel="Where the percentage comes from"
                  className="mb-2 w-full [&>button]:flex-1"
                />
              )}
              {useRate ? (
                <>
                  <select
                    id="price-line-percent"
                    value={rateSel}
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
                    Change that percentage in the text later and every line using it follows.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      id="price-line-percent"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleInsert();
                        }
                      }}
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
                  {percentError ? (
                    <p className={ERROR}>{percentError}</p>
                  ) : writesNewRate ? (
                    <p className={HINT}>
                      Saved as <span className="font-mono text-ink">{rateName}</span>, so other lines
                      can use the same percentage and changing it once updates them all.
                    </p>
                  ) : (
                    <p className={HINT}>The number goes straight into this line&apos;s formula.</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Other price ── */}
          {spec.needsOther && (
            <div>
              <label htmlFor="price-line-other" className={SECTION_LABEL}>
                {spec.otherLabel ?? 'Other price'}
              </label>
              {otherChoices.length > 0 && (
                <select
                  id="price-line-other"
                  value={otherSel}
                  onChange={(e) => setOther(e.target.value)}
                  className={cn(SELECT, creatingOther && 'mb-2')}
                >
                  {otherChoices.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                  <option value={NEW_BOX}>+ New price box</option>
                </select>
              )}
              {creatingOther && (
                <NameInput
                  id={otherChoices.length === 0 ? 'price-line-other' : undefined}
                  ariaLabel="New second price box name"
                  value={otherBoxName}
                  onChange={setNewOtherName}
                  onEnter={handleInsert}
                  taken={otherNameTaken}
                  example="OTHER_PRICE"
                  hint="A new price box, added with the line where the cursor is."
                />
              )}
            </div>
          )}

          {/* ── What it prints ── */}
          {example !== '' && (
            <div className="rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
                Example
              </p>
              <p className="mt-1 text-xs text-ink">
                With {priceName} at {SAMPLE_PRICE}
                {spec.needsOther ? ` and ${otherName} at ${SAMPLE_OTHER}` : ''}, the line prints{' '}
                <span className="font-mono font-semibold text-primary">{example}</span>
              </p>
            </div>
          )}

          <MoreOptions>
            <RoundingControl value={decimals} onChange={setDecimals} />
            {spec.needsPercent && !useRate && (
              <div>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input
                    type="checkbox"
                    checked={saveRate}
                    onChange={(e) => setSaveRate(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Save the percentage so other lines can use it
                </label>
                {saveRate && (
                  <div className="mt-2">
                    <NameInput
                      ariaLabel="Saved percentage name"
                      value={rateName}
                      onChange={setNewRateName}
                      onEnter={handleInsert}
                      taken={rateNameTaken}
                      example="DISCOUNT"
                      hint={
                        <>
                          Written just before this line as{' '}
                          <code className="font-mono text-primary/80">
                            {`{var: ${rateName} = ${percentValue ?? '1.5'}}`}
                          </code>
                          . It prints nothing.
                        </>
                      }
                    />
                  </div>
                )}
              </div>
            )}
          </MoreOptions>

          {/* ── What lands in the body ── */}
          {valid && (
            <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
                Inserts
              </p>
              <code className="block break-all font-mono text-[11px] leading-relaxed text-ink-muted">
                {token}
              </code>
            </div>
          )}
        </>
      )}
    </FormulaDialogFrame>
  );
}
