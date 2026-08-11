import { describe, it, expect } from 'vitest';
import { reconcileSuggestions, suggestionKey } from '@/lib/labelSuggest';
import { LABEL_NAME_MAX } from '@/lib/labelUtils';
import type { Label } from '@/types/database';

let seq = 0;
function label(p: Partial<Label> = {}): Label {
  seq += 1;
  return {
    id: `l${seq}`,
    user_id: 'u1',
    name: `Label ${seq}`,
    color: 'azure',
    created_at: '2026-08-11T00:00:00Z',
    updated_at: '2026-08-11T00:00:00Z',
    ...p,
  };
}

describe('reconcileSuggestions', () => {
  it('resolves a known name to the stored label', () => {
    const sales = label({ id: 'sales', name: 'Sales' });
    const [first] = reconcileSuggestions([{ name: 'Sales', reason: 'quotes a price' }], [sales]);
    expect(first).toEqual({ kind: 'existing', label: sales, reason: 'quotes a price' });
  });

  it('offers an unknown name as a proposal rather than dropping it', () => {
    const [first] = reconcileSuggestions([{ name: 'legal', reason: 'cites a statute' }], []);
    expect(first).toEqual({ kind: 'proposed', name: 'legal', reason: 'cites a statute' });
  });

  // The vocabulary-forking guard: "legal" must never be offered as new when
  // "Legal" already exists, in either direction of casing or padding.
  it('folds a case- or whitespace-variant onto the existing label', () => {
    const legal = label({ id: 'legal', name: 'Legal' });
    for (const name of ['legal', 'LEGAL', '  lEgAl  ']) {
      const [first] = reconcileSuggestions([{ name, reason: '' }], [legal]);
      expect(first).toEqual({ kind: 'existing', label: legal, reason: '' });
    }
  });

  it('drops a name past the DB length cap', () => {
    const long = 'x'.repeat(LABEL_NAME_MAX + 1);
    expect(reconcileSuggestions([{ name: long, reason: '' }], [])).toEqual([]);
  });

  it('accepts a name exactly at the cap', () => {
    const exact = 'x'.repeat(LABEL_NAME_MAX);
    expect(reconcileSuggestions([{ name: exact, reason: '' }], [])).toHaveLength(1);
  });

  it('drops blank and whitespace-only names', () => {
    expect(reconcileSuggestions([{ name: '', reason: 'a' }, { name: '   ', reason: 'b' }], []))
      .toEqual([]);
  });

  it('collapses repeats within one response, keeping the first', () => {
    const out = reconcileSuggestions(
      [
        { name: 'Booking', reason: 'first' },
        { name: 'booking', reason: 'second' },
      ],
      [],
    );
    expect(out).toEqual([{ kind: 'proposed', name: 'Booking', reason: 'first' }]);
  });

  it('omits a label the draft already carries', () => {
    const sales = label({ id: 'sales', name: 'Sales' });
    const urgent = label({ id: 'urgent', name: 'Urgent' });
    const out = reconcileSuggestions(
      [
        { name: 'Sales', reason: '' },
        { name: 'Urgent', reason: '' },
      ],
      [sales, urgent],
      ['sales'],
    );
    expect(out).toEqual([{ kind: 'existing', label: urgent, reason: '' }]);
  });

  it('caps the number returned', () => {
    const raw = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, reason: '' }));
    expect(reconcileSuggestions(raw, [], [], 3)).toHaveLength(3);
  });

  it('returns nothing for an empty response', () => {
    expect(reconcileSuggestions([], [label()])).toEqual([]);
  });
});

describe('suggestionKey', () => {
  it('is stable per label id and per proposed name, regardless of casing', () => {
    const sales = label({ id: 'sales', name: 'Sales' });
    expect(suggestionKey({ kind: 'existing', label: sales, reason: '' })).toBe('existing:sales');
    expect(suggestionKey({ kind: 'proposed', name: 'Legal', reason: '' })).toBe(
      suggestionKey({ kind: 'proposed', name: 'legal', reason: '' }),
    );
  });
});
