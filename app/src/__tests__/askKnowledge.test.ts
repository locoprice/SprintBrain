import { describe, expect, it } from 'vitest';
import {
  ASK_VERDICTS,
  answerPlainText,
  feedbackSources,
  parseAskResponse,
  splitCitations,
  verdictLabel,
  type AskSource,
} from '@/lib/askKnowledge';

const SOURCES: AskSource[] = [
  { ref: 'S1', kind: 'snippet', id: 'snip-1', title: 'Refund policy', updated_at: '2026-09-01T10:00:00Z', space_id: null, review_status: 'approved', used: true },
  { ref: 'S2', kind: 'memory', id: 'mem-1', title: 'Escalation steps', updated_at: null, space_id: 'space-1', review_status: 'deprecated', used: false },
];

describe('parseAskResponse', () => {
  it('accepts a well-formed answer', () => {
    const result = parseAskResponse({
      ok: true,
      status: 'answered',
      coverage: 'full',
      answer: 'Refunds take 14 days [S1].',
      missing: '',
      conflicts: '',
      sources: SOURCES,
    });
    expect(result?.status).toBe('answered');
    expect(result?.sources).toHaveLength(2);
  });

  it('accepts the no-sources reply, which never carries an answer', () => {
    const result = parseAskResponse({ ok: true, status: 'no_sources', answer: '', missing: '', conflicts: '', sources: [] });
    expect(result?.status).toBe('no_sources');
  });

  it('reads a source without a status as approved, and keeps a status it is given', () => {
    const result = parseAskResponse({
      ok: true,
      status: 'answered',
      answer: 'x [S1]',
      missing: '',
      conflicts: '',
      sources: [
        { ref: 'S1', kind: 'snippet', id: 'a', title: 'A', updated_at: null, space_id: null, used: true },
        { ref: 'S2', kind: 'memory', id: 'b', title: 'B', updated_at: null, space_id: 's', review_status: 'deprecated', used: false },
      ],
    });
    expect(result?.sources.map((s) => s.review_status)).toEqual(['approved', 'deprecated']);
  });

  it('rejects anything else rather than rendering half an answer', () => {
    expect(parseAskResponse(null)).toBeNull();
    expect(parseAskResponse({ ok: false })).toBeNull();
    expect(parseAskResponse({ ok: true, status: 'guessed', answer: '', missing: '', conflicts: '', sources: [] })).toBeNull();
    expect(
      parseAskResponse({ ok: true, status: 'answered', answer: 'x', missing: '', conflicts: '', sources: [{ ref: 'S1', kind: 'prompt' }] }),
    ).toBeNull();
  });
});

describe('splitCitations', () => {
  it('turns markers of known sources into citations', () => {
    expect(splitCitations('Refunds take 14 days [S1]. Escalate first [S2].', SOURCES)).toEqual([
      { type: 'text', text: 'Refunds take 14 days ' },
      { type: 'cite', ref: 'S1' },
      { type: 'text', text: '. Escalate first ' },
      { type: 'cite', ref: 'S2' },
      { type: 'text', text: '.' },
    ]);
  });

  it('keeps a marker for a source that was not sent as visible text', () => {
    expect(splitCitations('Something [S9].', SOURCES)).toEqual([{ type: 'text', text: 'Something [S9].' }]);
  });

  it('handles adjacent citations and an answer that starts with one', () => {
    expect(splitCitations('[S1][S2] apply.', SOURCES)).toEqual([
      { type: 'cite', ref: 'S1' },
      { type: 'cite', ref: 'S2' },
      { type: 'text', text: ' apply.' },
    ]);
  });
});

describe('answerPlainText', () => {
  it('drops citation markers so the answer can be pasted into a message', () => {
    expect(answerPlainText('Refunds take 14 days [S1].\nEscalate first [S1][S2].')).toBe(
      'Refunds take 14 days.\nEscalate first.',
    );
  });
});

describe('feedback vocabulary', () => {
  it('offers the six verdicts the database accepts, useful first', () => {
    expect(ASK_VERDICTS.map((v) => v.value)).toEqual([
      'useful',
      'incorrect',
      'outdated',
      'incomplete',
      'irrelevant',
      'conflicting',
    ]);
  });

  it('labels a verdict, and falls back to the raw value for an unknown one', () => {
    expect(verdictLabel('incorrect')).toBe('Wrong');
    expect(verdictLabel('something-new')).toBe('something-new');
  });

  it('snapshots each source by kind, id and title', () => {
    expect(feedbackSources(SOURCES)).toEqual([
      { kind: 'snippet', id: 'snip-1', title: 'Refund policy', space_id: null, used: true },
      { kind: 'memory', id: 'mem-1', title: 'Escalation steps', space_id: 'space-1', used: false },
    ]);
  });
});
