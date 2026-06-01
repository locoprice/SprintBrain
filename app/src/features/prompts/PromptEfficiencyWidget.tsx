import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, XCircle } from 'lucide-react';
import type { EvalCriterion, EvalResult } from '@/lib/usePromptEvaluator';

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
          {score}
        </span>
        <span className="text-[9px] leading-none text-[#5A5A62]">/10</span>
      </div>
    </div>
  );
}

// ── Criterion row ──────────────────────────────────────────────────────────────

interface CriterionRowProps {
  criterion: EvalCriterion;
  onApply: (id: string) => void;
}

function CriterionRow({ criterion, onApply }: CriterionRowProps) {
  const { id, label, passed, suggestionLabel, description } = criterion;

  return (
    <li className="flex items-center gap-2">
      {passed ? (
        <CheckCircle2
          className="h-3.5 w-3.5 shrink-0 text-[#34C759]"
          aria-hidden="true"
        />
      ) : (
        <XCircle
          className="h-3.5 w-3.5 shrink-0 text-[#FF5F57]"
          aria-hidden="true"
        />
      )}
      <span
        title={description}
        className={`flex-1 truncate text-xs ${passed ? 'text-[#83838D]' : 'text-[#D6D6DE]'}`}
        aria-label={`${label}: ${passed ? 'passed' : 'not met'}`}
      >
        {label}
      </span>
      {!passed && suggestionLabel && (
        <button
          type="button"
          onClick={() => onApply(id)}
          className="shrink-0 rounded-[6px] border border-[#26262B] bg-[#0E0E11] px-2 py-0.5 text-[10px] font-medium text-[#6080C8] transition-colors hover:border-[#1B4FD8]/40 hover:bg-[#0A1020] hover:text-[#1B4FD8] focus:outline-none focus:ring-1 focus:ring-[#1B4FD8]/30"
        >
          + {suggestionLabel}
        </button>
      )}
    </li>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export interface PromptEfficiencyWidgetProps {
  result: EvalResult;
  onApply: (criterionId: string) => void;
}

export function PromptEfficiencyWidget({ result, onApply }: PromptEfficiencyWidgetProps) {
  const [expanded, setExpanded] = useState(true);
  const { score, pct, criteria } = result;
  // Compute once here and pass as a prop to ScoreRing to avoid a redundant call.
  const color = scoreColor(pct);
  const failingCount = criteria.filter((c) => !c.passed).length;

  return (
    <div className="border-b border-[#161619]">
      {/*
        Dedicated live region outside the button — screen readers announce score
        changes here. Placing role="status" inside a <button> causes it to be
        ignored by most AT.
      */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {`Prompt efficiency: ${score} out of 10. ${scoreLabel(pct)}.`}
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
          {score}/10
        </span>

        {/* Pending suggestions summary when collapsed */}
        {failingCount > 0 && !expanded && (
          <span className="text-[10px] text-[#5A5A62]">
            · {failingCount} suggestion{failingCount !== 1 ? 's' : ''}
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
        The HTML hidden attribute removes it from both layout and the a11y tree
        when collapsed, without breaking the aria-controls reference.
      */}
      <div
        id="prompt-efficiency-panel"
        hidden={!expanded}
        className="px-5 pb-4"
      >
        {/* Score summary */}
        <div className="mb-4 flex items-center gap-4">
          <ScoreRing pct={pct} score={score} color={color} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#E0E0E8]">{scoreLabel(pct)}</p>
            <p className="text-xs text-[#83838D]">
              {pct}%
              {' · '}
              {failingCount === 0
                ? 'All criteria met'
                : `${failingCount} criterion${failingCount !== 1 ? 'a' : ''} need${failingCount === 1 ? 's' : ''} attention`}
            </p>
          </div>
        </div>

        {/* Criteria list */}
        <ul
          className="space-y-1.5"
          role="list"
          aria-label="Prompt evaluation criteria"
        >
          {criteria.map((c) => (
            <CriterionRow key={c.id} criterion={c} onApply={onApply} />
          ))}
        </ul>
      </div>
    </div>
  );
}
