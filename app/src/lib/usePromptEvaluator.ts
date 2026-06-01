import { useEffect, useRef, useState } from 'react';
import type { PromptBlock, PromptBlockType, StrategyType, PreferredModel, OutputType } from '@/types/database';
import { assembleBlocks } from '@/lib/promptUtils';

// ── Public types ───────────────────────────────────────────────────────────────

export interface EvalCriterion {
  id: string;
  label: string;
  description: string;
  passed: boolean;
  /** Present only when an auto-fix action is available (block disabled or metadata unset). */
  suggestionLabel?: string;
}

export interface EvalResult {
  /** Integer 0–10. */
  score: number;
  /** Integer 0–100 (score × 10). */
  pct: number;
  criteria: EvalCriterion[];
}

export interface EvaluatorInput {
  blocks: PromptBlock[];
  strategyType: StrategyType | null;
  preferredModel: PreferredModel | null;
  outputType: OutputType | null;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

function blockCriterion(
  blocks: PromptBlock[],
  type: PromptBlockType,
  label: string,
  description: string,
): EvalCriterion {
  const b = blocks.find((blk) => blk.type === type);
  const enabled = b?.enabled ?? false;
  const hasContent = !!(b?.content?.trim());
  const passed = enabled && hasContent;
  return {
    id: type,
    label,
    description,
    passed,
    // Suggestion chip only makes sense when the block is disabled; if it's
    // enabled-but-empty the user just needs to fill in content.
    suggestionLabel: !passed && !enabled ? `Enable ${type} block` : undefined,
  };
}

function evaluate({ blocks, strategyType, preferredModel, outputType }: EvaluatorInput): EvalResult {
  const assembled = assembleBlocks(blocks);

  const criteria: EvalCriterion[] = [
    blockCriterion(blocks, 'role', 'Role defined', 'The AI persona or role is specified in the Role block.'),
    blockCriterion(blocks, 'objective', 'Clear objective', 'The task or goal is clearly stated in the Objective block.'),
    blockCriterion(blocks, 'context', 'Context provided', 'Relevant background information is supplied.'),
    blockCriterion(blocks, 'reasoning', 'Reasoning approach', 'A thinking instruction is given (e.g. "Think step by step").'),
    blockCriterion(blocks, 'constraints', 'Constraints defined', "Rules or boundaries for the model's response are explicit."),
    blockCriterion(blocks, 'examples', 'Examples included', 'Input/output examples guide the model toward the expected format.'),
    {
      id: 'output_format',
      label: 'Output format set',
      description: 'The expected output type (JSON, Markdown, etc.) is specified.',
      passed: outputType !== null,
      suggestionLabel: outputType === null ? 'Set to Plain text' : undefined,
    },
    {
      id: 'strategy',
      label: 'Strategy selected',
      description: 'A prompting strategy (CoT, Few-shot, etc.) has been chosen.',
      passed: strategyType !== null,
      suggestionLabel: strategyType === null ? 'Apply One-shot' : undefined,
    },
    {
      id: 'length',
      label: 'Sufficient content',
      description: 'The assembled prompt is detailed enough (≥ 80 characters).',
      passed: assembled.trim().length >= 80,
      // No auto-fix — user must write more content.
    },
    {
      id: 'model',
      label: 'Model selected',
      description: 'A preferred model has been specified.',
      passed: preferredModel !== null,
      suggestionLabel: preferredModel === null ? 'Use Sonnet 4' : undefined,
    },
  ];

  const score = criteria.filter((c) => c.passed).length;
  return { score, pct: score * 10, criteria };
}

function makeKey(input: EvaluatorInput): string {
  return JSON.stringify({
    b: input.blocks.map((b) => `${b.type}:${Number(b.enabled)}:${b.content}`),
    s: input.strategyType,
    p: input.preferredModel,
    o: input.outputType,
  });
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Returns an `EvalResult` 500 ms after the last content change.
 * When `enabled` is false (editor panel closed) the result is cleared
 * immediately and no evaluation is scheduled.
 *
 * Identical inputs (same hash) are skipped to avoid redundant work.
 */
export function usePromptEvaluator(input: EvaluatorInput, enabled: boolean): EvalResult | null {
  const [result, setResult] = useState<EvalResult | null>(null);
  const timerRef = useRef<number | null>(null);
  const lastKeyRef = useRef<string>('');
  const inputRef = useRef(input);
  inputRef.current = input;

  // Clear result when the editor closes.
  useEffect(() => {
    if (!enabled) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setResult(null);
      lastKeyRef.current = '';
    }
  }, [enabled]);

  // Debounced evaluation — fires 500 ms after the last content change.
  const inputKey = makeKey(input);
  useEffect(() => {
    if (!enabled) return;

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(() => {
      const key = makeKey(inputRef.current);
      if (key === lastKeyRef.current) return; // No change — skip redundant work.
      lastKeyRef.current = key;
      setResult(evaluate(inputRef.current));
    }, 500);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // inputKey captures all relevant fields; enabled guards scheduling above.
  }, [inputKey, enabled]);

  return result;
}
