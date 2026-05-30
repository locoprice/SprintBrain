import { describe, expect, it } from 'vitest';
import { diffLines, hasDiff, toDisplayName } from '../features/snippets/diffUtils';

describe('diffLines', () => {
  it('returns empty array for two empty strings', () => {
    expect(diffLines('', '')).toEqual([]);
  });

  it('returns no diff for identical single-line strings', () => {
    const result = diffLines('hello', 'hello');
    expect(hasDiff(result)).toBe(false);
    expect(result).toEqual([{ type: 'context', text: 'hello' }]);
  });

  it('marks all lines as added when before is empty', () => {
    const result = diffLines('', 'line1\nline2');
    expect(result.every((l) => l.type === 'added')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['line1', 'line2']);
  });

  it('marks all lines as removed when after is empty', () => {
    const result = diffLines('line1\nline2', '');
    expect(result.every((l) => l.type === 'removed')).toBe(true);
    expect(result.map((l) => l.text)).toEqual(['line1', 'line2']);
  });

  it('detects a single changed line with surrounding context', () => {
    const before = 'line1\nold line\nline3';
    const after  = 'line1\nnew line\nline3';
    const result = diffLines(before, after);
    expect(result).toContainEqual({ type: 'removed', text: 'old line' });
    expect(result).toContainEqual({ type: 'added',   text: 'new line' });
    expect(result).toContainEqual({ type: 'context', text: 'line1' });
    expect(result).toContainEqual({ type: 'context', text: 'line3' });
  });

  it('handles multi-line insertions with preserved context', () => {
    const before = 'header\nfooter';
    const after  = 'header\nnew1\nnew2\nfooter';
    const result = diffLines(before, after);
    expect(hasDiff(result)).toBe(true);
    expect(result.filter((l) => l.type === 'added').map((l) => l.text)).toEqual(['new1', 'new2']);
    expect(result.filter((l) => l.type === 'context').map((l) => l.text)).toEqual(['header', 'footer']);
  });

  it('handles multi-line deletions correctly', () => {
    const before = 'keep\nremove1\nremove2\nkeep2';
    const after  = 'keep\nkeep2';
    const result = diffLines(before, after);
    expect(result.filter((l) => l.type === 'removed').map((l) => l.text)).toEqual(['remove1', 'remove2']);
    expect(result.filter((l) => l.type === 'context').map((l) => l.text)).toEqual(['keep', 'keep2']);
  });
});

describe('hasDiff', () => {
  it('returns false when all lines are context', () => {
    expect(hasDiff([{ type: 'context', text: 'x' }])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasDiff([])).toBe(false);
  });

  it('returns true when any line is added', () => {
    expect(hasDiff([{ type: 'context', text: 'a' }, { type: 'added', text: 'b' }])).toBe(true);
  });

  it('returns true when any line is removed', () => {
    expect(hasDiff([{ type: 'removed', text: 'x' }])).toBe(true);
  });
});

describe('toDisplayName', () => {
  it('extracts and capitalizes the local part of an email', () => {
    expect(toDisplayName('valentina@leibtour.com')).toBe('Valentina');
  });

  it('capitalizes only the first character for dot-delimited local parts', () => {
    expect(toDisplayName('john.doe@example.com')).toBe('John.doe');
  });

  it('returns the raw string when input is not an email', () => {
    expect(toDisplayName('Valentina')).toBe('Valentina');
  });

  it('handles empty string gracefully', () => {
    expect(toDisplayName('')).toBe('');
  });
});
