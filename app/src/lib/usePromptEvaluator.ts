import { useEffect, useRef, useState } from 'react';
import type {
  Prompt,
  PromptBlock,
  PromptBlockType,
  StrategyType,
  PreferredModel,
  OutputType,
  IntentCategory,
} from '@/types/database';
import { assembleBlocks } from '@/lib/promptUtils';

// ── Public types ───────────────────────────────────────────────────────────────

export type CriterionStatus = 'pass' | 'partial' | 'fail';

export interface EvalCriterion {
  id: string;
  label: string;
  description: string;
  /** Resolved status used for the icon + colour. */
  status: CriterionStatus;
  /** 0–1 graded value (partial credit). Drives the weighted score. */
  value: number;
  /** Relative importance in the weighted average. */
  weight: number;
  /** Why the criterion landed on this status — explains the score. */
  rationale: string;
  /** Concrete improvement example, shown for partial/fail. */
  example?: string;
  /** One-click auto-fix label (enable a block / apply a metadata default). */
  suggestionLabel?: string;
}

export interface EvalResult {
  /** Weighted 0–10, one decimal. */
  score: number;
  /** Weighted 0–100 (integer). */
  pct: number;
  criteria: EvalCriterion[];
}

export interface EvaluatorInput {
  blocks: PromptBlock[];
  strategyType: StrategyType | null;
  preferredModel: PreferredModel | null;
  outputType: OutputType | null;
}

// ── Grading constants ────────────────────────────────────────────────────────

/** Partial-credit value awarded when a criterion is present but weak. */
const PARTIAL_VALUE = 0.6;

/** Assembled-length thresholds for the holistic "depth" criterion. */
const DEPTH_PARTIAL_CHARS = 40;
const DEPTH_PASS_CHARS = 150;

interface BlockSpec {
  type: PromptBlockType;
  label: string;
  description: string;
  weight: number;
  /** Quality signal; when matched (plus length) the block earns full credit. */
  signal?: RegExp;
  /** Characters needed for a length-based pass. */
  strongChars: number;
  /** What a strong version of this block contains (used in rationale). */
  signalHint: string;
  /** Ready-to-adapt sample shown when the block is weak or missing. */
  example: string;
}

const BLOCK_SPECS: BlockSpec[] = [
  {
    type: 'role',
    label: 'Role defined',
    description: 'The AI persona or role is specified in the Role block.',
    weight: 1.5,
    signal: /\b(you are|you're|act as|your role|as an?|expert|specialist|senior|professional)\b/i,
    strongChars: 18,
    signalHint: 'name a clear role or area of expertise',
    example: 'You are a senior B2B copywriter with 10 years of SaaS experience.',
  },
  {
    type: 'objective',
    label: 'Clear objective',
    description: 'The task or goal is clearly stated in the Objective block.',
    weight: 2,
    signal: /\b(write|create|generate|analy[sz]e|review|summari[sz]e|explain|build|draft|produce|design|translate|classify|extract|list|compare|evaluate|plan|fix|refactor|respond|rewrite|describe)\b/i,
    strongChars: 20,
    signalHint: 'start with a clear action verb (Write, Analyze, Generate…)',
    example: 'Write a 150-word product announcement email for a new feature.',
  },
  {
    type: 'context',
    label: 'Context provided',
    description: 'Relevant background information is supplied.',
    weight: 1,
    strongChars: 40,
    signalHint: 'add the background the model needs (audience, goal, source data)',
    example: 'The audience is existing Pro-plan customers; tone is friendly but concise.',
  },
  {
    type: 'reasoning',
    label: 'Reasoning approach',
    description: 'A thinking instruction is given (e.g. "Think step by step").',
    weight: 1,
    signal: /\b(step by step|step-by-step|think|reason|first|then|finally|because|consider|explain your|chain of thought)\b/i,
    strongChars: 14,
    signalHint: 'tell the model how to think (e.g. "think step by step")',
    example: 'Think step by step, then give the final answer.',
  },
  {
    type: 'constraints',
    label: 'Constraints defined',
    description: "Rules or boundaries for the model's response are explicit.",
    weight: 1.5,
    signal: /\b(must|must not|do not|don'?t|never|always|only|avoid|ensure|limit|no more than|at most|at least|within|exactly|word|tone)\b/i,
    strongChars: 14,
    signalHint: 'state limits or rules (length, tone, what to avoid)',
    example: 'Keep it under 150 words. Do not use jargon. Avoid emojis.',
  },
  {
    type: 'examples',
    label: 'Examples included',
    description: 'Input/output examples guide the model toward the expected format.',
    weight: 1,
    signal: /(example|e\.g\.|input:|output:|->|→|\n)/i,
    strongChars: 20,
    signalHint: 'show at least one input → output example',
    example: 'Input: "great product" → Output: {"sentiment":"positive"}',
  },
];

// ── Grading helpers ────────────────────────────────────────────────────────────

function gradeBlock(blocks: PromptBlock[], spec: BlockSpec): EvalCriterion {
  const block = blocks.find((b) => b.type === spec.type);
  const enabled = block?.enabled ?? false;
  const content = block?.content?.trim() ?? '';

  const base = {
    id: spec.type,
    label: spec.label,
    description: spec.description,
    weight: spec.weight,
  };

  // Not contributing at all — empty or switched off.
  if (!enabled || !content) {
    return {
      ...base,
      status: 'fail',
      value: 0,
      rationale: enabled
        ? `The ${spec.type} block is enabled but empty — ${spec.signalHint}.`
        : `The ${spec.type} block is off — ${spec.signalHint}.`,
      example: spec.example,
      // Auto-fix only makes sense when the block is off; an empty enabled
      // block just needs the user to type.
      suggestionLabel: !enabled ? `Enable ${spec.type} block` : undefined,
    };
  }

  const hasSignal = spec.signal ? spec.signal.test(content) : true;
  const longEnough = content.length >= spec.strongChars;

  if (hasSignal && longEnough) {
    return { ...base, status: 'pass', value: 1, rationale: 'Looks solid.' };
  }

  // Present but weak → partial credit, with a targeted reason.
  let rationale: string;
  if (!hasSignal && !longEnough) {
    rationale = `Thin — add more detail and ${spec.signalHint}.`;
  } else if (!hasSignal) {
    rationale = `Present, but ${spec.signalHint}.`;
  } else {
    rationale = `A bit short (${content.length}/${spec.strongChars} chars) — add more detail.`;
  }

  return { ...base, status: 'partial', value: PARTIAL_VALUE, rationale, example: spec.example };
}

function metadataCriterion(
  id: string,
  label: string,
  description: string,
  weight: number,
  isSet: boolean,
  failRationale: string,
  suggestionLabel: string,
  example: string,
): EvalCriterion {
  if (isSet) {
    return { id, label, description, weight, status: 'pass', value: 1, rationale: 'Set.' };
  }
  return {
    id, label, description, weight,
    status: 'fail', value: 0,
    rationale: failRationale,
    example,
    suggestionLabel,
  };
}

// ── Best-practice signal criteria (scan the whole assembled prompt) ────────────

/**
 * Self-check / verification language (scorecard "Iteration & Refinement").
 * A prompt that asks the model to verify its work or admit uncertainty
 * produces fewer confident mistakes.
 */
const REFINEMENT_SIGNAL =
  /\b(check your|double[-\s]?check|verify|review your|proofread|sanity[-\s]?check|make sure|if (?:you'?re |you are )?(?:unsure|uncertain|not sure)|if in doubt|flag (?:any|anything)|ask (?:for )?clarif|don'?t (?:assume|guess))\b/i;

/**
 * Audience / reading-level language (scorecard "Clear Audience Specification").
 * Naming who the response is for lets the model pitch tone and depth correctly.
 */
const AUDIENCE_SIGNAL =
  /\b(audience|readers?|readership|reading level|written for|aimed at|tailored (?:for|to)|for (?:beginners?|experts?|executives?|developers?|engineers?|students?|customers?|a beginner|an expert|non[-\s]?technical|a \w+ audience)|explain (?:it |this )?to|5[-\s]?year[-\s]?old|layperson|laypeople|layman)\b/i;

/**
 * Grades a holistic best-practice that can be expressed in any block, by
 * scanning the assembled prompt for a quality signal. Pass/fail (no partial):
 * the practice is either present in the prompt or it isn't.
 */
function signalCriterion(
  id: string,
  label: string,
  description: string,
  weight: number,
  assembled: string,
  signal: RegExp,
  passRationale: string,
  failRationale: string,
  example: string,
  suggestionLabel: string,
): EvalCriterion {
  if (signal.test(assembled)) {
    return { id, label, description, weight, status: 'pass', value: 1, rationale: passRationale };
  }
  return {
    id, label, description, weight,
    status: 'fail', value: 0,
    rationale: failRationale,
    example,
    suggestionLabel,
  };
}

function depthCriterion(assembledLength: number): EvalCriterion {
  const base = {
    id: 'depth',
    label: 'Sufficient depth',
    description: 'The assembled prompt is detailed enough to be unambiguous.',
    weight: 1,
  };
  if (assembledLength >= DEPTH_PASS_CHARS) {
    return { ...base, status: 'pass', value: 1, rationale: 'The prompt has plenty of detail.' };
  }
  if (assembledLength >= DEPTH_PARTIAL_CHARS) {
    return {
      ...base,
      status: 'partial',
      value: PARTIAL_VALUE,
      rationale: `Getting there (${assembledLength}/${DEPTH_PASS_CHARS} chars) — a fuller prompt scores higher.`,
      example: 'Fuller prompts (role + objective + constraints) consistently perform better.',
    };
  }
  return {
    ...base,
    status: 'fail',
    value: 0,
    rationale: `Too thin (${assembledLength} chars) — the model has little to work with.`,
    example: 'Fuller prompts (role + objective + constraints) consistently perform better.',
  };
}

/**
 * Pure, deterministic prompt evaluator. Weighted + graded:
 * each criterion contributes `value (0–1) × weight` to a weighted average,
 * so a partially-met, high-weight criterion (e.g. objective) moves the score
 * more than a fully-met, low-weight one (e.g. model).
 */
export function evaluatePrompt(input: EvaluatorInput): EvalResult {
  const { blocks, strategyType, preferredModel, outputType } = input;
  const assembled = assembleBlocks(blocks);

  const criteria: EvalCriterion[] = [
    ...BLOCK_SPECS.map((spec) => gradeBlock(blocks, spec)),
    signalCriterion(
      'audience', 'Audience specified',
      'The target audience or reading level is named so the model pitches tone and depth correctly.',
      0.75, assembled, AUDIENCE_SIGNAL,
      'An audience or reading level is named.',
      'No audience named — tell the model who the response is for.',
      'e.g. "Write for non-technical hospitality managers." or "Explain it to a beginner."',
      'Name the audience',
    ),
    signalCriterion(
      'refinement', 'Self-check requested',
      'The prompt asks the model to verify its work or flag uncertainty, reducing confident mistakes.',
      0.75, assembled, REFINEMENT_SIGNAL,
      'A verification or self-check step is requested.',
      'No self-check step — ask the model to verify its answer or flag what it is unsure about.',
      'e.g. "Double-check the result and flag anything you are unsure about."',
      'Add self-check',
    ),
    metadataCriterion(
      'output_format', 'Output format set',
      'The expected output type (JSON, Markdown, etc.) is specified.',
      1, outputType !== null,
      'No output format set — the model may return an unexpected shape.',
      'Set to Plain text', 'e.g. JSON, Markdown, SOP, or Plain.',
    ),
    metadataCriterion(
      'strategy', 'Strategy selected',
      'A prompting strategy (CoT, Few-shot, etc.) has been chosen.',
      1, strategyType !== null,
      'No prompting strategy chosen.',
      'Apply One-shot', 'e.g. Chain-of-Thought for reasoning, Few-shot for format.',
    ),
    depthCriterion(assembled.trim().length),
    metadataCriterion(
      'model', 'Model selected',
      'A preferred model has been specified.',
      0.5, preferredModel !== null,
      'No preferred model selected.',
      'Use Sonnet 4', 'e.g. Opus for hard reasoning, Haiku for speed.',
    ),
  ];

  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  const earned = criteria.reduce((sum, c) => sum + c.value * c.weight, 0);
  const ratio = totalWeight > 0 ? earned / totalWeight : 0;
  const pct = Math.round(ratio * 100);
  const score = Math.round(ratio * 100) / 10; // 0–10, one decimal

  return { score, pct, criteria };
}

// ── Corpus benchmark ─────────────────────────────────────────────────────────

/** Minimum corpus size before a percentile is meaningful enough to show. */
export const MIN_BENCHMARK_CORPUS = 5;

/**
 * Maps a persisted prompt row to evaluator input so its score can be computed
 * the same way as the live draft. Legacy rows without structured blocks fall
 * back to their flat `content` as a single objective block — mirroring how the
 * editor hydrates them.
 */
export function promptToEvaluatorInput(prompt: Prompt): EvaluatorInput {
  const blocks: PromptBlock[] =
    prompt.blocks && prompt.blocks.length > 0
      ? prompt.blocks
      : [{ type: 'objective', content: prompt.content, enabled: !!prompt.content.trim() }];

  return {
    blocks,
    strategyType: prompt.strategy_type,
    preferredModel: prompt.preferred_model,
    outputType: prompt.output_type,
  };
}

/** A set of prompts to benchmark against, plus an optional intent scope label. */
export interface BenchmarkCohort {
  prompts: Prompt[];
  /** When set, the cohort is scoped to this intent (e.g. "Coding"). */
  scopeLabel?: string;
}

/**
 * Chooses which prompts to benchmark the draft against. Prefers a same-intent
 * cohort when it's large enough to be meaningful (more relevant comparison),
 * otherwise falls back to the whole library. Returns null when neither cohort
 * reaches `MIN_BENCHMARK_CORPUS`. The current prompt is always excluded.
 */
export function selectBenchmarkCohort(
  prompts: Prompt[],
  currentId: string | null,
  intent: IntentCategory | null,
): BenchmarkCohort | null {
  const others = prompts.filter((p) => p.id !== currentId);
  const sameIntent = intent ? others.filter((p) => p.intent_category === intent) : [];
  const useIntent = intent !== null && sameIntent.length >= MIN_BENCHMARK_CORPUS;
  const list = useIntent ? sameIntent : others;
  if (list.length < MIN_BENCHMARK_CORPUS) return null;
  return { prompts: list, scopeLabel: useIntent ? intent : undefined };
}

/**
 * Percentile rank of `score` within `corpus` (0–100, integer). Ties count as
 * half, the standard "percent rank" convention, so a prompt that beats every
 * other lands near 100 and one tied with the whole corpus lands near 50.
 */
export function percentRank(corpus: number[], score: number): number {
  if (corpus.length === 0) return 0;
  let below = 0;
  let equal = 0;
  for (const v of corpus) {
    if (v < score) below += 1;
    else if (v === score) equal += 1;
  }
  return Math.round(((below + 0.5 * equal) / corpus.length) * 100);
}

/** Stable hash of the inputs that affect the score — used to skip redundant work. */
export function computeEvalKey(input: EvaluatorInput): string {
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
  const inputKey = computeEvalKey(input);
  useEffect(() => {
    if (!enabled) return;

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);

    timerRef.current = window.setTimeout(() => {
      const key = computeEvalKey(inputRef.current);
      if (key === lastKeyRef.current) return; // No change — skip redundant work.
      lastKeyRef.current = key;
      setResult(evaluatePrompt(inputRef.current));
    }, 500);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // inputKey captures all relevant fields; enabled guards scheduling above.
  }, [inputKey, enabled]);

  return result;
}
