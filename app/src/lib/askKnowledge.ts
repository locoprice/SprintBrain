import { z } from 'zod';
import { toReviewStatus } from '@/lib/reviewStatus';

// Ask SprintBrain (AI-KNOWLEDGE P1, docs/AI_KNOWLEDGE_PLAN.md).
//
// The pure half: what the ask-sprintbrain function answers, read defensively,
// and the feedback vocabulary. No network here, so all of it is testable.

/**
 * The verdicts a reader can give an answer, in the order they are offered.
 *
 * Keep in step with the knowledge_feedback verdict check
 * (services/supabase/migrations/20261004120000_knowledge_feedback.sql) and the
 * phone page's ASK_VERDICTS. scripts/check-ask-knowledge.js fails CI if the
 * three lists differ.
 */
export const ASK_VERDICTS = [
  { value: 'useful', label: 'Useful' },
  { value: 'incorrect', label: 'Wrong' },
  { value: 'outdated', label: 'Outdated' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'irrelevant', label: 'Not relevant' },
  { value: 'conflicting', label: 'Conflicts with policy' },
] as const;

export type AskVerdict = (typeof ASK_VERDICTS)[number]['value'];

export function verdictLabel(value: string): string {
  return ASK_VERDICTS.find((v) => v.value === value)?.label ?? value;
}

/** Mirrors the function's and the feedback table's limits. */
export const ASK_QUESTION_MIN = 3;
export const ASK_QUESTION_MAX = 1000;

const sourceSchema = z.object({
  ref: z.string(),
  kind: z.enum(['snippet', 'memory']),
  id: z.string(),
  title: z.string(),
  updated_at: z.string().nullable(),
  space_id: z.string().nullable(),
  // Review status (AI-KNOWLEDGE P2). Optional so a reply from a function
  // deployed before statuses existed still reads; it counts as approved.
  review_status: z.string().optional().transform(toReviewStatus),
  used: z.boolean(),
});

const responseSchema = z.object({
  ok: z.literal(true),
  status: z.enum(['answered', 'not_covered', 'no_sources']),
  answer: z.string(),
  missing: z.string(),
  conflicts: z.string(),
  sources: z.array(sourceSchema),
});

export type AskSource = z.infer<typeof sourceSchema>;
export type AskResult = z.infer<typeof responseSchema>;

/** The function's reply, or null when it does not have the expected shape. */
export function parseAskResponse(value: unknown): AskResult | null {
  const parsed = responseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** One piece of an answer: plain text, or a citation of a source. */
export type AnswerPart = { type: 'text'; text: string } | { type: 'cite'; ref: string };

const CITATION = /\[(S\d+)\]/g;

/**
 * Split an answer into text and citations, so a citation can be drawn as a
 * link to its source. A marker naming a source that was not sent stays as
 * plain text: it cannot be followed, and dropping it would hide that the model
 * cited something it was not given.
 */
export function splitCitations(answer: string, sources: readonly AskSource[]): AnswerPart[] {
  const known = new Set(sources.map((s) => s.ref));
  const parts: AnswerPart[] = [];
  let last = 0;
  for (const match of answer.matchAll(CITATION)) {
    const ref = match[1] ?? '';
    const at = match.index ?? 0;
    if (!known.has(ref)) continue;
    if (at > last) parts.push({ type: 'text', text: answer.slice(last, at) });
    parts.push({ type: 'cite', ref });
    last = at + match[0].length;
  }
  if (last < answer.length) parts.push({ type: 'text', text: answer.slice(last) });
  return parts;
}

/** The answer without citation markers, for copying into a message. */
export function answerPlainText(answer: string): string {
  return answer
    .replace(/\s*\[S\d+\]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

/** What a feedback row records about each source: enough to find it again, even after it is renamed. */
export interface FeedbackSource {
  kind: string;
  id: string;
  title: string;
  /** The Brain a memory item lives in, so the review list can open it. Null for snippets. */
  space_id: string | null;
  used: boolean;
}

export function feedbackSources(sources: readonly AskSource[]): FeedbackSource[] {
  return sources.map((s) => ({ kind: s.kind, id: s.id, title: s.title, space_id: s.space_id, used: s.used }));
}
