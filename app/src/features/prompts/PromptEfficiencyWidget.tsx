import { useState } from 'react';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, TrendingUp, XCircle } from 'lucide-react';
import type { CriterionStatus, EvalCriterion, EvalResult } from '@/lib/usePromptEvaluator';

/** Percentile of this prompt against the user's existing prompt corpus. */
export interface PromptBenchmark {
  /** 0–100: % of the corpus this prompt scores higher than. */
  percentile: number;
  /** Number of other prompts the percentile was computed against. */
  corpusSize: number;
  /** When set, the percentile is scoped to prompts of this intent (e.g. "Coding"). */
  scopeLabel?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function scoreColor(pct: number): string {
  if (pct >= 80) return '#34C759'; // success
  if (pct >= 50) return '#1B4FD8'; // primary
  return '#FEBC2E';                // warning
}

function scoreLabel(pct: number): string {
  if (pct >= 80) return 'Excellent';
  if (pct >= 50) return 'Good';
  return 'Needs improvement';
}

/** One-decimal display without a trailing ".0" (e.g. 7 not 7.0, but 7.3 kept). */
function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

// ── Circular score ring ────────────────────────────────────────────────────────

const RING_RADIUS = 20;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// color is pre-computed by the parent to avoid redundant scoreColor() calls.
interface ScoreRingProps { pct: number; score: number; color: string }

function ScoreRing({ pct, score, color }: ScoreRingProps) {
  const offset = RING_CIRCUMFERENCE * (1 - pct / 100);

  return (
    <div className="relative h-14 w-14 shrink-0">
      {/* -rotate-90 so progress starts at 12 o'clock */}
      <svg viewBox="0 0 56 56" className="h-full w-full -rotate-90" aria-hidden="true">
        {/* Track */}
        <circle
          cx={28} cy={28} r={RING_RADIUS}
          fill="none" stroke="#1C1C20" strokeWidth={4}
          strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={0}
        />
        {/* Progress */}
        <circle
          cx={28} cy={28} r={RING_RADIUS}
          fill="none" stroke={color} strokeWidth={4} strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 400ms cubic-bezier(0.4,0,0.2,1), stroke 400ms ease' }}
        />
      </svg>
      {/* Centre label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold leading-none tabular-nums" style={{ color }}>
          {formatScore(score)}
        </span>
        <span className="text-[9px] leading-none text-[#5A5A62]">/10</span>
      </div>
    </div>
  );
}

// ── Status icon ────────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: CriterionStatus }) {
  if (status === 'pass') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#34C759]" aria-hidden="true" />;
  }
  if (status === 'partial') {
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-[#FEBC2E]" aria-hidden="true" />;
  }
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-[#FF5F57]" aria-hidden="true" />;
}

const STATUS_WORD: Record<CriterionStatus, string> = {
  pass: 'passed',
  partial: 'needs improvement',
  fail: 'not met',
};

// ── Criterion row (expandable "why this score") ─────────────────────────────────

interface CriterionRowProps {
  criterion: EvalCriterion;
  index: number;
  total: number;
  onApply: (id: string) => void;
}

function CriterionRow({ criterion, index, total, onApply }: CriterionRowProps) {
  const { id, label, status, suggestionLabel, description, rationale, example } = criterion;
  const [open, setOpen] = useState(false);
  const detailId = `crit-detail-${id}`;
  const labelColor = status === 'pass' ? 'text-[#83838D]' : 'text-[#D6D6DE]';

  return (
    <li className="rounded-[6px]">
      <div className="flex items-center gap-2">
        {/* Expand toggle — reveals rationale + example */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 items-center gap-2 rounded-[6px] py-0.5 text-left transition-colors hover:bg-[#0E0E13] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#1B4FD8]/40"
          aria-expanded={open}
          aria-controls={detailId}
        >
          <StatusIcon status={status} />
          <span
            className={`flex-1 truncate text-[13px] ${labelColor}`}
            aria-label={`${label}: ${STATUS_WORD[status]}`}
          >
            {label}
          </span>
          {open
            ? <ChevronUp className="h-3 w-3 shrink-0 text-[#4A4A52]" aria-hidden="true" />
            : <ChevronDown className="h-3 w-3 shrink-0 text-[#4A4A52]" aria-hidden="true" />}
        </button>

        {/* One-click auto-fix (block enable / metadata default) */}
        {suggestionLabel && (
          <button
            type="button"
            onClick={() => onApply(id)}
            className="shrink-0 rounded-[6px] border border-[#26262B] bg-[#0E0E11] px-2 py-0.5 text-[10px] font-medium text-[#6080C8] transition-colors hover:border-[#1B4FD8]/40 hover:bg-[#0A1020] hover:text-[#1B4FD8] focus:outline-none focus:ring-1 focus:ring-[#1B4FD8]/30"
          >
            + {suggestionLabel}
          </button>
        )}
      </div>

      {/* Rationale + concrete example */}
      <div id={detailId} hidden={!open} className="pb-1.5 pl-[22px] pr-1 pt-1">
        <p className="text-xs leading-relaxed text-[#9A9AA5]">{rationale}</p>
        {description && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-[#5A5A62]">{description}</p>
        )}
        {example && (
          <p className="mt-1.5 rounded-[6px] border border-[#1A1A1E] bg-[#0A0A0D] px-2.5 py-1.5 font-mono text-[10px] leading-relaxed text-[#8A8A95]">
            <span className="mr-1 select-none text-[#4A4A52]">e.g.</span>
            {example}
          </p>
        )}
      </div>

      {/* Decorative hairline between rows (not after the last) */}
      {index < total - 1 && <div className="ml-[22px] h-px bg-[#111114]" />}
    </li>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export interface PromptEfficiencyWidgetProps {
  result: EvalResult;
  onApply: (criterionId: string) => void;
  /** Optional corpus benchmark; hidden when the library is too small to be meaningful. */
  benchmark?: PromptBenchmark | null;
}

export function PromptEfficiencyWidget({ result, onApply, benchmark }: PromptEfficiencyWidgetProps) {
  const [expanded, setExpanded] = useState(true);
  const { score, pct, criteria } = result;
  // Compute once here and pass as a prop to ScoreRing to avoid a redundant call.
  const color = scoreColor(pct);
  const attentionCount = criteria.filter((c) => c.status !== 'pass').length;

  return (
    <div className="border-b border-[#161619]">
      {/*
        Dedicated live region outside the button — screen readers announce score
        changes here. Placing role="status" inside a <button> causes it to be
        ignored by most AT.
      */}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {`Prompt efficiency: ${formatScore(score)} out of 10. ${scoreLabel(pct)}. `
          + `${attentionCount} of ${criteria.length} criteria need attention.`
          + (benchmark
            ? ` Stronger than ${benchmark.percentile}% of your ${benchmark.corpusSize}`
              + `${benchmark.scopeLabel ? ` ${benchmark.scopeLabel}` : ''} prompts.`
            : '')}
      </span>

      {/* ── Collapsible header ── */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-[#0A0A0F] focus:outline-none focus-visible:ring-1 focus-visible:ring-[#1B4FD8]/40"
        aria-expanded={expanded}
        aria-controls="prompt-efficiency-panel"
      >
        <span className="font-mono text-[10px] font-semibold uppercase tracking-widest text-[#83838D]">
          Efficiency Score
        </span>

        {/* Visual score badge — screen readers use the sr-only live region above. */}
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
          style={{ color, backgroundColor: `${color}1A` }}
          aria-hidden="true"
        >
          {formatScore(score)}/10
        </span>

        {/* Pending-work summary when collapsed */}
        {attentionCount > 0 && !expanded && (
          <span className="text-[10px] text-[#5A5A62]">
            · {attentionCount} to improve
          </span>
        )}

        <span className="ml-auto">
          {expanded
            ? <ChevronUp className="h-3.5 w-3.5 text-[#5A5A62]" />
            : <ChevronDown className="h-3.5 w-3.5 text-[#5A5A62]" />}
        </span>
      </button>

      {/*
        Panel is always in the DOM so aria-controls always has a valid target.
        The HTML hidden attribute removes it from layout and the a11y tree when
        collapsed, without breaking the aria-controls reference.
      */}
      <div id="prompt-efficiency-panel" hidden={!expanded} className="px-5 pb-4">
        {/* Score summary */}
        <div className="mb-4 flex items-center gap-4">
          <ScoreRing pct={pct} score={score} color={color} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#E0E0E8]">{scoreLabel(pct)}</p>
            <p className="text-xs text-[#83838D]">
              {pct}%
              {' · '}
              {attentionCount === 0
                ? 'All criteria met'
                : `${attentionCount} of ${criteria.length} need attention`}
            </p>
          </div>
        </div>

        {/* Corpus benchmark — percentile against the user's existing prompts */}
        {benchmark && (
          <div className="mb-3 flex items-center gap-2 rounded-[8px] border border-[#161619] bg-[#0A0A0D] px-3 py-2">
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-[#1B4FD8]" aria-hidden="true" />
            <p className="text-[11px] text-[#9A9AA5]">
              Stronger than{' '}
              <span className="font-semibold text-[#D6D6DE]">{benchmark.percentile}%</span>
              {' '}of your {benchmark.corpusSize}
              {benchmark.scopeLabel ? ` ${benchmark.scopeLabel}` : ''} prompts
            </p>
          </div>
        )}

        {/* Criteria list */}
        <ul className="-mx-1" role="list" aria-label="Prompt evaluation criteria">
          {criteria.map((c, i) => (
            <CriterionRow key={c.id} criterion={c} index={i} total={criteria.length} onApply={onApply} />
          ))}
        </ul>

        <p className="mt-3 text-[10px] leading-relaxed text-[#4A4A52]">
          Click any item to see why it scored that way and a concrete example.
        </p>
      </div>
    </div>
  );
}
