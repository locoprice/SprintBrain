import { describe, expect, it } from 'vitest';
import { sanitizeName } from '@/lib/nameText';

describe('sanitizeName', () => {
  it('keeps letters in both cases, digits, spaces and punctuation', () => {
    for (const name of ['TIME', 'Quote English', 'Añadir número 3', 'A-B_C (x).', 'Città']) {
      expect(sanitizeName(name)).toBe(name);
    }
  });

  it('drops single emoji, joined sequences, flags, keycaps and skin tones', () => {
    expect(sanitizeName('😀 Hello')).toBe(' Hello');
    expect(sanitizeName('Team 👨‍👩‍👧')).toBe('Team ');
    expect(sanitizeName('🇮🇹IT')).toBe('IT');
    expect(sanitizeName('Step 3️⃣')).toBe('Step 3');
    expect(sanitizeName('Ok👍🏽')).toBe('Ok');
  });

  it('returns an empty string for an emoji-only name', () => {
    expect(sanitizeName('🔥✨')).toBe('');
  });
});
