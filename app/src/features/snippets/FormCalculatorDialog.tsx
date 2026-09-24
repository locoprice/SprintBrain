import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { fillFormApi, formulaEngine, loadFillFormEngine } from '@/lib/fillFormEngine';
import { isValidFieldName, nextNumberName } from '@/lib/formNumberToken';
import {
  buildFormulaToken,
  DEFAULT_DECIMALS,
  FORMULA_OPERATIONS,
  getFormulaOperation,
  hasDuplicateNames,
  insideCondition,
  isValidFormula,
  nextNumberNames,
  type FormulaDecimals,
  type FormulaOperation,
} from '@/lib/formulaToken';
import {
  ChoiceCards,
  ERROR,
  FormulaDialogFrame,
  HINT,
  listAnd,
  MoreOptions,
  RoundingControl,
  SECTION_LABEL,
} from '@/features/snippets/formulaDialogParts';

const OPERATION_CARDS = FORMULA_OPERATIONS.map((op) => ({
  id: op.id,
  label: op.label,
  detail: op.sample,
}));

// What the example fills the boxes with, per operation, and '1' for any beyond.
const SAMPLES: Record<FormulaOperation, string[]> = {
  add: ['100', '25', '5'],
  subtract: ['100', '25', '5'],
  multiply: ['4', '2.5', '2'],
  divide: ['100', '4', '5'],
  average: ['100', '25', '5'],
  percentOf: ['200', '15'],
  percentChange: ['100', '80'],
};

function sampleValues(operation: FormulaOperation, count: number): string[] {
  const base = SAMPLES[operation];
  return Array.from({ length: count }, (_, i) => base[i] ?? '1');
}

interface FormCalculatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited, so the boxes added never reuse a name it already has. */
  body: string;
  /** Where the answer goes: inside an {if:} already, no guard of its own is written. */
  caret: number;
  onInsert: (token: string) => void;
  /** Swaps a range of the body for `text`: '' removes a formula, the old text undoes it. */
  onReplace: (start: number, end: number, text: string) => void;
}

/**
 * Adds, subtracts, multiplies, divides, averages or works out a percentage on
 * numbers typed in when the snippet expands. It adds the number boxes itself and
 * prints the working with the answer on one line, `100 - 25 - 5 = 70`.
 *
 * The operations come from `FORMULA_OPERATIONS` in `@/lib/formulaToken`, so a
 * new one appears here without touching this file.
 */
export function FormCalculatorDialog({
  open,
  onOpenChange,
  body,
  caret,
  onInsert,
  onReplace,
}: FormCalculatorDialogProps) {
  const [operation, setOperation] = useState<FormulaOperation>('add');
  const [names, setNames] = useState<string[]>([]);
  const [decimals, setDecimals] = useState<FormulaDecimals>(DEFAULT_DECIMALS);
  const [engineReady, setEngineReady] = useState(() => fillFormApi() !== null);

  // The body as of now, for the effect that runs on opening only. A removal from
  // the list changes the body while the window is open, and that must not wipe a
  // calculation the author is halfway through.
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  // Every opening starts clean: a half-built calculation carried over from a
  // cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    setOperation('add');
    setNames(nextNumberNames(bodyRef.current, 2));
    setDecimals(DEFAULT_DECIMALS);
  }, [open]);

  // The preview needs the shared engine; load it if nothing has yet.
  useEffect(() => {
    if (!open) return;
    if (formulaEngine()) {
      setEngineReady(true);
      return;
    }
    let alive = true;
    loadFillFormEngine()
      .then(() => {
        if (alive) setEngineReady(true);
      })
      .catch(() => {
        // A preview that cannot render is not a reason to block the insert: the
        // token is written by pure code that does not need the engine.
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const spec = getFormulaOperation(operation);
  const fixedCount = spec.minOperands === spec.maxOperands;
  const duplicate = hasDuplicateNames(names);
  const namesValid = names.every(isValidFieldName);
  const valid = isValidFormula({ operation, names, decimals });
  const inCondition = useMemo(() => insideCondition(body.slice(0, caret)), [body, caret]);
  const token = useMemo(
    () => buildFormulaToken({ operation, names, decimals, inCondition }),
    [operation, names, decimals, inCondition],
  );

  // What the calculation prints for sample numbers, worked out by the real engine.
  // Read during render, so the example redraws once the engine has loaded.
  const engine = engineReady ? formulaEngine() : null;
  const example = useMemo(() => {
    if (!engine || !valid) return null;
    const values = sampleValues(operation, names.length);
    const vals: Record<string, string> = {};
    names.forEach((n, i) => {
      vals[n] = values[i] ?? '';
    });
    return { values, printed: engine.resolveBody(token, vals) };
  }, [valid, operation, names, token, engine]);

  function nextFreeName(taken: string[]): string {
    return nextNumberName(`${body} ${taken.join(' ')}`);
  }

  // Switching operation keeps the names already there, and only adds or drops
  // boxes to fit how many numbers the new one takes.
  function chooseOperation(next: FormulaOperation) {
    const nextSpec = getFormulaOperation(next);
    setOperation(next);
    setNames((prev) => {
      const fitted = prev.slice(0, nextSpec.maxOperands);
      while (fitted.length < nextSpec.minOperands) fitted.push(nextFreeName(fitted));
      return fitted;
    });
  }

  function handleInsert() {
    if (!valid) return;
    onInsert(token);
    onOpenChange(false);
  }

  const note = valid
    ? ''
    : duplicate
      ? 'Two boxes share a name. See More options.'
      : !namesValid
        ? 'A box name is not valid. See More options.'
        : 'Check the numbers.';

  return (
    <FormulaDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title="Calculator"
      description="Numbers filled in when the snippet expands. The working and the answer print on one line."
      body={body}
      onReplace={onReplace}
      note={note}
      canInsert={valid}
      onInsert={handleInsert}
    >
      {/* ── What ── */}
      <div>
        <span className={SECTION_LABEL}>What do you want to work out?</span>
        <ChoiceCards
          options={OPERATION_CARDS}
          value={operation}
          onChange={chooseOperation}
          ariaLabel="What to work out"
          columns="grid-cols-2"
        />
        <p className={HINT}>{spec.hint}</p>
      </div>

      {/* ── How many numbers ── */}
      <div>
        <span className={SECTION_LABEL}>Numbers</span>
        {fixedCount ? (
          <p className="text-sm text-ink">
            Two numbers{spec.roles ? `: ${listAnd(spec.roles).toLowerCase()}` : ''}.
          </p>
        ) : (
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNames((prev) => prev.slice(0, -1))}
              disabled={names.length <= spec.minOperands}
              aria-label="One fewer number"
              className="h-9 w-9 p-0"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className="min-w-[2ch] text-center text-sm font-semibold text-ink">
              {names.length}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setNames((prev) => [...prev, nextFreeName(prev)])}
              disabled={names.length >= spec.maxOperands}
              aria-label="One more number"
              className="h-9 w-9 p-0"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <span className="text-[11px] text-ink-subtle">Each one is a box you fill in.</span>
          </div>
        )}
      </div>

      {/* ── What it prints ── */}
      {example && (
        <div className="rounded-[10px] border border-primary/25 bg-primary-light px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-ink-muted">
            Example
          </p>
          <p className="mt-1 text-xs text-ink">
            With {listAnd(example.values)} filled in, the line prints{' '}
            <span className="font-mono font-semibold text-primary">{example.printed}</span>
          </p>
        </div>
      )}

      <MoreOptions>
        <RoundingControl value={decimals} onChange={setDecimals} />
        <div>
          <span className={SECTION_LABEL}>Box names</span>
          <div className="flex flex-col gap-2">
            {names.map((name, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-ink-subtle">
                  {spec.roles?.[i] ?? `Number ${i + 1}`}
                </span>
                <Input
                  value={name}
                  aria-label={`${spec.roles?.[i] ?? `Number ${i + 1}`} box name`}
                  // Stripped as typed, not rejected after: a space failing
                  // validation with no visible cause is worse.
                  onChange={(e) => {
                    const next = e.target.value.replace(/[^A-Za-z0-9_]/g, '');
                    setNames((prev) => prev.map((n, j) => (j === i ? next : n)));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleInsert();
                    }
                  }}
                  className={cn(
                    'h-10 rounded-[10px] font-mono',
                    !isValidFieldName(name) && 'border-danger focus:border-danger focus:ring-danger/20',
                  )}
                />
              </div>
            ))}
          </div>
          {duplicate ? (
            <p className={ERROR}>Each box needs its own name, or two boxes fill as one.</p>
          ) : !namesValid ? (
            <p className={ERROR}>
              Letters, numbers and underscore, starting with a letter. For example NUM_1.
            </p>
          ) : (
            <p className={HINT}>
              Only needed if a formula you type by hand reads these boxes. A box left empty counts as 0.
            </p>
          )}
        </div>
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
    </FormulaDialogFrame>
  );
}
