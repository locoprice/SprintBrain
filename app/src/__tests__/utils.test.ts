import { describe, it, expect } from 'vitest';
import { countWords } from '@/lib/utils';

describe('countWords', () => {
  it('counts nothing in an empty or whitespace-only body', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords('\n\n \t ')).toBe(0);
  });

  it('counts a single word', () => {
    expect(countWords('Estimados')).toBe(1);
    expect(countWords('  Estimados  ')).toBe(1);
  });

  it('collapses runs of whitespace rather than counting the gaps', () => {
    expect(countWords('hello world')).toBe(2);
    expect(countWords('hello     world')).toBe(2);
  });

  it('treats newlines and tabs as separators, so paragraphs count correctly', () => {
    expect(countWords('one\ntwo\nthree')).toBe(3);
    expect(countWords('one\t\ttwo')).toBe(2);
    expect(countWords('Estimados\n\nAtentamente,\n\nLeibTour.com')).toBe(3);
  });

  // The documented decision: a placeholder is one word, not zero and not two.
  it('counts a template placeholder as one word', () => {
    expect(countWords('{guest_name}')).toBe(1);
    expect(countWords('Dear {guest_name}, welcome')).toBe(3);
  });

  // A formula carries its own spaces, so it counts as the tokens it contains.
  // Documented rather than special-cased: nothing is stripped.
  it('counts a formula by its whitespace, like any other text', () => {
    expect(countWords('{=TOTAL * 1.03}')).toBe(3);
    expect(countWords('{=TOTAL}')).toBe(1);
  });

  it('counts accented and non-ASCII words', () => {
    expect(countWords('acusamos recibo de la notificación')).toBe(5);
    expect(countWords('mañana señor')).toBe(2);
  });

  it('counts a realistic Spanish snippet body', () => {
    const body = [
      'Estimados',
      '',
      'Por medio del presente mensaje, acusamos recibo de la notificación.',
      '',
      'Atentamente,',
    ].join('\n');
    expect(countWords(body)).toBe(12);
  });
});
