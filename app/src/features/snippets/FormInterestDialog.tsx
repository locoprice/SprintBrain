import { useEffect, useMemo, useRef, useState } from 'react';
import { fillFormApi, formulaEngine, loadFillFormEngine } from '@/lib/fillFormEngine';
import { isValidFieldName } from '@/lib/formNumberToken';
import {
  buildInterestToken,
  DEFAULT_DECIMALS,
  hasDuplicateNames,
  insideCondition,
  INTEREST_SPECS,
  interestNames,
  isValidInterest,
  type FormulaDecimals,
  type InterestKind,
} from '@/lib/formulaToken';
import {
  BoxNames,
  ExampleBox,
  ExampleResult,
  FormulaDialogFrame,
  HINT,
  InsertsBox,
  listAnd,
  MoreOptions,
  RoundingControl,
  SECTION_LABEL,
} from '@/features/snippets/formulaDialogParts';

const COPY: Record<InterestKind, { description: string; numbers: string }> = {
  simple: {
    description:
      'Numbers filled in when the snippet expands. The working, the interest and the total print on one line.',
    numbers: 'Principal, rate % a year and years. Each one is a box you fill in.',
  },
  compound: {
    description:
      'Numbers filled in when the snippet expands. The working, the final amount and the interest print on one line.',
    numbers:
      'Principal, rate % a year, years, and times a year the interest is added. Times a year starts on 12: 1 is yearly, 4 quarterly, 365 daily.',
  },
};

interface FormInterestDialogProps {
  kind: InterestKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The body being edited, so the boxes added never reuse a name it already has. */
  body: string;
  /** Where the answers go: inside an {if:} already, no guard of their own is written. */
  caret: number;
  onInsert: (token: string) => void;
  /** Swaps a range of the body for `text`: '' removes a formula, the old text undoes it. */
  onReplace: (start: number, end: number, text: string) => void;
}

/**
 * Simple or compound interest on numbers typed in when the snippet expands. It
 * adds the boxes itself and prints the working with the answers on one line.
 * What it writes comes from `buildInterestToken` in `@/lib/formulaToken`.
 */
export function FormInterestDialog({
  kind,
  open,
  onOpenChange,
  body,
  caret,
  onInsert,
  onReplace,
}: FormInterestDialogProps) {
  const spec = INTEREST_SPECS[kind];
  const [names, setNames] = useState<string[]>([]);
  const [decimals, setDecimals] = useState<FormulaDecimals>(DEFAULT_DECIMALS);
  const [engineReady, setEngineReady] = useState(() => fillFormApi() !== null);

  // The body as of now, for the effect that runs on opening only. A removal from
  // the list changes the body while the window is open, and that must not reset
  // names the author is halfway through.
  const bodyRef = useRef(body);
  useEffect(() => {
    bodyRef.current = body;
  }, [body]);

  // Every opening starts clean, so nothing from a cancelled insert ships later.
  useEffect(() => {
    if (!open) return;
    setNames(interestNames(bodyRef.current, kind));
    setDecimals(DEFAULT_DECIMALS);
  }, [open, kind]);

  // The example needs the shared engine; load it if nothing has yet.
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
        // An example that cannot render is not a reason to block the insert: the
        // token is written by pure code that does not need the engine.
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const valid = isValidInterest({ kind, names, decimals });
  const inCondition = useMemo(() => insideCondition(body.slice(0, caret)), [body, caret]);
  const token = useMemo(
    () => buildInterestToken({ kind, names, decimals, inCondition }),
    [kind, names, decimals, inCondition],
  );

  // What the line prints for sample numbers, worked out by the real engine.
  const engine = engineReady ? formulaEngine() : null;
  const example = useMemo(() => {
    if (!engine || !valid) return null;
    const vals: Record<string, string> = {};
    names.forEach((n, i) => {
      vals[n] = spec.sample[i] ?? '';
    });
    const filled = spec.roles.map((role, i) => `${role.toLowerCase()} ${spec.sample[i] ?? ''}`);
    return { filled, printed: engine.resolveBody(token, vals) };
  }, [engine, valid, names, spec, token]);

  function handleInsert() {
    if (!valid) return;
    onInsert(token);
    onOpenChange(false);
  }

  const note = valid
    ? ''
    : hasDuplicateNames(names)
      ? 'Two boxes share a name. See More options.'
      : !names.every(isValidFieldName)
        ? 'A box name is not valid. See More options.'
        : 'Check the numbers.';

  return (
    <FormulaDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={spec.label}
      description={COPY[kind].description}
      body={body}
      onReplace={onReplace}
      note={note}
      canInsert={valid}
      onInsert={handleInsert}
    >
      <div>
        <span className={SECTION_LABEL}>Numbers</span>
        <p className="text-sm text-ink">{COPY[kind].numbers}</p>
        <p className={HINT}>
          An empty, zero or negative box prints no answer instead of a wrong one.
        </p>
      </div>

      {example && (
        <ExampleBox>
          With {listAnd(example.filled)} filled in, the line prints{' '}
          <ExampleResult>{example.printed}</ExampleResult>
        </ExampleBox>
      )}

      <MoreOptions>
        <RoundingControl value={decimals} onChange={setDecimals} />
        <BoxNames
          labels={spec.roles}
          names={names}
          onChange={(i, next) => setNames((prev) => prev.map((n, j) => (j === i ? next : n)))}
          onEnter={handleInsert}
          labelWidth="w-24"
        />
      </MoreOptions>

      {valid && <InsertsBox token={token} />}
    </FormulaDialogFrame>
  );
}
