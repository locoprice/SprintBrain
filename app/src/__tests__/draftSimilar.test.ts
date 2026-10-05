import { describe, expect, it } from 'vitest';
import { findSimilar, wordStems } from '@/lib/draftSimilar';

const LIBRARY = [
  {
    id: 'terms',
    title: 'Payment terms',
    text: 'Hi {formtext: name=CLIENT_NAME}, the invoice is due within 30 days of issue. Payment by bank transfer to the account on the invoice.',
    token: 'payterms',
  },
  {
    id: 'welcome',
    title: 'Welcome new client',
    text: 'Welcome aboard! Your account manager will contact you this week to plan the onboarding call.',
    token: 'welcome',
  },
  {
    id: 'outage',
    title: 'Service outage notice',
    text: 'We are aware of an outage affecting the dashboard. Our engineers are working on a fix and we will update you within the hour.',
    token: 'outage',
  },
];

describe('wordStems', () => {
  it('folds accents, drops short and common words, numbers and fill-in fields', () => {
    const stems = wordStems('Grazie! Il pagamento è dovuto entro 30 giorni {formtext: name=CLIENTE}');
    expect(stems.has('pagame')).toBe(true);
    expect(stems.has('dovuto')).toBe(true);
    expect(stems.has('grazie')).toBe(false);
    expect(stems.has('30')).toBe(false);
    expect(stems.has('client')).toBe(false);
  });

  it('counts plural and singular as one word', () => {
    expect([...wordStems('payments')]).toEqual([...wordStems('payment')]);
  });
});

describe('findSimilar', () => {
  it('finds an item that says the same thing in other words', () => {
    const matches = findSimilar(
      {
        title: 'Invoice due date',
        text: 'Hello {formtext: name=CLIENT_NAME}, your invoice is due 30 days after issue. Please pay by bank transfer to the account shown on the invoice.',
      },
      LIBRARY,
    );
    expect(matches[0]?.id).toBe('terms');
    expect(matches[0]?.reason).toBe('content');
  });

  it('finds an item with the same title', () => {
    const matches = findSimilar({ title: 'Payment terms', text: 'Completely different words here.' }, LIBRARY);
    expect(matches.map((m) => [m.id, m.reason])).toEqual([['terms', 'title']]);
  });

  it('always reports an item on the same trigger', () => {
    const matches = findSimilar({ title: 'Something else', text: 'Unrelated', token: 'Outage' }, LIBRARY);
    expect(matches).toEqual([{ id: 'outage', title: 'Service outage notice', reason: 'token', score: 1 }]);
  });

  it('reports nothing for an unrelated draft', () => {
    expect(findSimilar({ title: 'Quarterly report outline', text: 'Sections: revenue, hiring plan, risks and next steps for the quarter.' }, LIBRARY)).toEqual([]);
  });

  it('does not match two short texts on a single shared word', () => {
    expect(findSimilar({ title: 'Call notes', text: 'Onboarding' }, LIBRARY)).toEqual([]);
  });

  it('returns at most the limit, closest first', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, title: 'Payment terms', text: '' }));
    const matches = findSimilar({ title: 'Payment terms', text: '' }, many, 3);
    expect(matches).toHaveLength(3);
  });
});
