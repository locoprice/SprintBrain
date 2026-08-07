import { describe, it, expect } from 'vitest';
import { deriveTriggerFromName, TRIGGER_MAX_LENGTH } from '@/lib/triggerUtils';
import { snippetFormSchema } from '@/types/schemas';

describe('deriveTriggerFromName', () => {
  it('turns a plain name into a token', () => {
    expect(deriveTriggerFromName('Discount')).toBe('discount');
    expect(deriveTriggerFromName('Follow up')).toBe('follow_up');
  });

  it('keeps hyphens and underscores the user typed — both are legal in a trigger', () => {
    expect(deriveTriggerFromName('Follow-up')).toBe('follow-up');
    expect(deriveTriggerFromName('check_in')).toBe('check_in');
  });

  it('collapses a run of illegal characters into one separator', () => {
    expect(deriveTriggerFromName('Quote — English')).toBe('quote_english');
    expect(deriveTriggerFromName('Quote    English')).toBe('quote_english');
    expect(deriveTriggerFromName('Quote / English')).toBe('quote_english');
  });

  it('folds accents instead of dropping the letter', () => {
    // Stripping the character outright would give "espaol" / "prventif".
    expect(deriveTriggerFromName('Español')).toBe('espanol');
    expect(deriveTriggerFromName('Préventif')).toBe('preventif');
    expect(deriveTriggerFromName('Città')).toBe('citta');
  });

  it('survives the emoji that open half this account’s snippet titles', () => {
    expect(deriveTriggerFromName('💰 ESTIMATE B2C ver. 3.6')).toBe('estimate_b2c_ver_3_6');
    expect(deriveTriggerFromName('💻 NEO BOOKING')).toBe('neo_booking');
  });

  it('never leads or trails with a separator', () => {
    expect(deriveTriggerFromName('  Discount  ')).toBe('discount');
    expect(deriveTriggerFromName('!!! Discount !!!')).toBe('discount');
    expect(deriveTriggerFromName('-Discount-')).toBe('discount');
  });

  it('returns empty when a name yields no usable characters', () => {
    expect(deriveTriggerFromName('')).toBe('');
    expect(deriveTriggerFromName('   ')).toBe('');
    expect(deriveTriggerFromName('💰💰💰')).toBe('');
    expect(deriveTriggerFromName('!!!')).toBe('');
  });

  it('truncates to the schema cap without leaving a dangling separator', () => {
    const long = deriveTriggerFromName('a'.repeat(80));
    expect(long).toHaveLength(TRIGGER_MAX_LENGTH);

    // A name whose 60th character lands on a separator must not keep it.
    const onBoundary = deriveTriggerFromName(`${'a'.repeat(TRIGGER_MAX_LENGTH - 1)} tail`);
    expect(onBoundary.endsWith('_')).toBe(false);
    expect(onBoundary).toBe('a'.repeat(TRIGGER_MAX_LENGTH - 1));
  });

  it('always produces something the trigger schema accepts', () => {
    const names = [
      'Discount',
      'Quote — English',
      'Español · Bienvenida',
      '💰 ESTIMATE B2C ver. 3.6',
      'Check-in / Check-out',
      'a'.repeat(80),
      'Präventiv (Deutsch) #1',
      "L'arrivée du client",
    ];
    for (const name of names) {
      const trigger = deriveTriggerFromName(name);
      expect(trigger.length, name).toBeGreaterThan(0);
      const parsed = snippetFormSchema.shape.trigger.safeParse(trigger);
      expect(parsed.success, `${name} → ${trigger}`).toBe(true);
    }
  });
});

/**
 * The sync rule the dialog implements, extracted so it can be tested without
 * mounting React: the trigger follows the name until the user takes it over,
 * and starts following again if they clear it. Mirrors ACF's Field Label →
 * Field Name behaviour.
 */
function shouldSyncTrigger(current: string, lastAuto: string): boolean {
  return current === '' || current === lastAuto;
}

describe('trigger sync rule (ACF parity)', () => {
  it('syncs from an empty trigger', () => {
    expect(shouldSyncTrigger('', '')).toBe(true);
  });

  it('keeps syncing while the trigger still holds what we last wrote', () => {
    expect(shouldSyncTrigger('quote', 'quote')).toBe(true);
  });

  it('stops as soon as the user edits the trigger themselves', () => {
    expect(shouldSyncTrigger('quoteEN', 'quote_english')).toBe(false);
  });

  it('resumes when the user clears the trigger', () => {
    expect(shouldSyncTrigger('', 'quoteEN')).toBe(true);
  });
});
