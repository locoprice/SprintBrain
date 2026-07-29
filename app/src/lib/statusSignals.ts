// Status signals behind the animated snippet / prompt badges (STATUS-ICONS-001).
//
// Every rule here is derived from data that already exists — no new columns, no
// runtime telemetry. Two signals ship:
//   • usage      — snippet_stats.uses, already joined onto SnippetRow
//   • soundness  — static validation of the snippet template
// Prompts have no usage counter, so their badge reads the deterministic
// efficiency score from usePromptEvaluator instead (quality, not usage — the
// labels say so).
//
// Pure and side-effect free so the thresholds stay testable in isolation.

import type { Snippet } from '@/types/database';

// ── Template validation ──────────────────────────────────────────────────────

export type TemplateIssueCode = 'unterminated-token' | 'orphan-branch' | 'unclosed-if';

export interface TemplateValidation {
  ok: boolean;
  code: TemplateIssueCode | null;
  /** Plain-text explanation, shared verbatim with the extension popup. */
  message: string;
}

const VALIDATION_MESSAGES: Record<TemplateIssueCode, string> = {
  'unterminated-token': 'A { is never closed — it prints literally instead of filling in.',
  'orphan-branch': 'A branch tag has no matching {if:} — the condition is ignored.',
  'unclosed-if': 'An {if:} is never closed with {endif} — its content is dropped.',
};

function invalid(code: TemplateIssueCode): TemplateValidation {
  return { ok: false, code, message: VALIDATION_MESSAGES[code] };
}

/**
 * Structural faults that make the formula engine emit visibly wrong output
 * while failing silently — the user only finds out after pasting to a guest.
 * Walks the same tokenizer as `resolveBody` so a verdict here matches what the
 * engine actually does with the body.
 *
 * Deliberately narrow: only faults with no legitimate authoring reason. A stray
 * "{" around prose or code still resolves to an unknown field (and is dropped),
 * but that shape is common enough in real bodies that flagging it would be
 * noise, not a signal.
 *
 * MIRRORED from `extension/formula-engine.js` — the dashboard cannot import
 * extension source (app/CLAUDE.md §6). Change both together.
 */
export function validateTemplate(body: string | null | undefined): TemplateValidation {
  const src = body ?? '';
  let i = 0;
  let depth = 0;

  while (i < src.length) {
    if (src.charAt(i) !== '{') {
      i += 1;
      continue;
    }
    if (src.charAt(i + 1) === '{') {
      const dcl = src.indexOf('}}', i + 2);
      if (dcl === -1) return invalid('unterminated-token');
      i = dcl + 2;
      continue;
    }
    const cl = src.indexOf('}', i);
    if (cl === -1) return invalid('unterminated-token');

    const tok = src.slice(i + 1, cl).trim();
    if (tok.slice(0, 3) === 'if:') {
      depth += 1;
    } else if (tok === 'endif') {
      if (depth === 0) return invalid('orphan-branch');
      depth -= 1;
    } else if (tok === 'else' || tok.slice(0, 7).toLowerCase() === 'elseif:') {
      if (depth === 0) return invalid('orphan-branch');
    }
    i = cl + 1;
  }

  if (depth > 0) return invalid('unclosed-if');
  return { ok: true, code: null, message: '' };
}

/**
 * Validates every body a snippet carries — the denormalized `content` plus each
 * per-language variant in `bodies`. Any one of them breaking breaks the snippet,
 * because the extension expands whichever language the user typed.
 */
export function validateSnippet(snippet: Pick<Snippet, 'content' | 'bodies'>): TemplateValidation {
  const sources: string[] = [snippet.content, ...Object.values(snippet.bodies ?? {})];
  for (const src of sources) {
    if (typeof src !== 'string' || src.length === 0) continue;
    const result = validateTemplate(src);
    if (!result.ok) return result;
  }
  return { ok: true, code: null, message: '' };
}

// ── Usage ranking ────────────────────────────────────────────────────────────

/** Floor below which nothing is "top", however small the library. */
export const TOP_MIN_USES = 5;

/**
 * Share of the library's most-used asset needed to qualify.
 *
 * Calibrated 2026-07-29 against production `snippet_stats`: 48 of 122 snippets
 * have any usage at all, max 21, p90 = 5, mean 2. At 0.60 the rule badged a
 * single snippet; at 0.25 it badges 4 of 48 (~8%) — scarce enough to mean
 * something, common enough to be visible. The relative term is what keeps that
 * ratio steady as a library grows, rather than turning every mature account
 * into a wall of trophies.
 */
export const TOP_USAGE_SHARE = 0.25;

/**
 * Top-performing = used enough times to mean something in absolute terms *and*
 * sitting near the top of this user's own library. The floor stops a
 * three-snippet account from handing out trophies on day one.
 */
export function isTopByUsage(usage: number, maxUsage: number): boolean {
  if (usage < TOP_MIN_USES) return false;
  return usage >= maxUsage * TOP_USAGE_SHARE;
}

/**
 * Total expansions for one logical snippet.
 *
 * A translated snippet is several rows sharing a base trigger, and each is
 * expanded under its own id — `time` spans four language variants. Counting a
 * single variant splits the total four ways and buries the snippet that is
 * actually used most, so usage is always summed over the group.
 */
export function sumUsage(rows: readonly { usage_count: number }[]): number {
  return rows.reduce((total, row) => total + row.usage_count, 0);
}

// ── Resolved status ──────────────────────────────────────────────────────────

/** The three states a status badge can render. Consumed by StatusBadge. */
export type BadgeStatus = 'top' | 'broken' | 'weak';

/** Efficiency score at or below which a prompt needs work. */
export const PROMPT_WEAK_SCORE = 4;

export interface PromptSignalInput {
  usage_count: number;
  is_malformed: boolean;
  /** Deterministic 0–10 efficiency score from `evaluatePrompt`. */
  score: number;
}

/**
 * Prompt badge, usage-first.
 *
 * `usage_count` decides eligibility for the trophy: a prompt has to earn it in
 * the real world, so a polished prompt nobody runs stays unbadged no matter how
 * well it scores. The efficiency score is strictly secondary — it can raise the
 * "needs work" wrench, never the trophy. A malformed template outranks both.
 */
export function promptStatus(
  input: PromptSignalInput,
  libraryMax: number,
): BadgeStatus | null {
  if (input.is_malformed) return 'broken';
  if (isTopByUsage(input.usage_count, libraryMax)) return 'top';
  if (input.score <= PROMPT_WEAK_SCORE) return 'weak';
  return null;
}

/** Highest prompt usage across the library — the denominator for the trophy. */
export function maxPromptUsage(prompts: readonly { usage_count: number }[]): number {
  return prompts.reduce((max, p) => (p.usage_count > max ? p.usage_count : max), 0);
}
