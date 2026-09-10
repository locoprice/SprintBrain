import { describe, it, expect } from 'vitest';
import { deriveTriggerFromName, sanitizeTriggerInput, TRIGGER_MAX_LENGTH } from '@/lib/triggerUtils';
import { promptFormSchema, snippetFormSchema } from '@/types/schemas';

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

describe('sanitizeTriggerInput', () => {
  it('writes the separator the user meant instead of joining two words', () => {
    expect(sanitizeTriggerInput('ciao ciao')).toBe('ciao_ciao');
    expect(sanitizeTriggerInput('follow up now')).toBe('follow_up_now');
  });

  it('keeps a separator the user is still typing behind', () => {
    // Mid-word this is "follow_" waiting on its second word. Trimming it here
    // would eat the underscore the moment it was typed.
    expect(sanitizeTriggerInput('follow ')).toBe('follow_');
    expect(sanitizeTriggerInput('follow_')).toBe('follow_');
  });

  it('never opens with a separator it invented', () => {
    expect(sanitizeTriggerInput('  ciao')).toBe('ciao');
    expect(sanitizeTriggerInput('::quote')).toBe('quote');
    // One the user typed themselves is legal, so it stays.
    expect(sanitizeTriggerInput('_quote')).toBe('_quote');
  });

  it('keeps case, unlike the name-derived token', () => {
    expect(sanitizeTriggerInput('quoteEN')).toBe('quoteEN');
    expect(sanitizeTriggerInput('Quote EN')).toBe('Quote_EN');
  });

  it('folds accents instead of dropping the letter', () => {
    expect(sanitizeTriggerInput('Español')).toBe('Espanol');
    expect(sanitizeTriggerInput('Città')).toBe('Citta');
  });

  it('collapses a run of illegal characters into one separator', () => {
    expect(sanitizeTriggerInput('quote    english')).toBe('quote_english');
    expect(sanitizeTriggerInput('quote / english')).toBe('quote_english');
    expect(sanitizeTriggerInput('💰 estimate')).toBe('estimate');
  });

  it('caps at the schema length', () => {
    expect(sanitizeTriggerInput('a'.repeat(80))).toHaveLength(TRIGGER_MAX_LENGTH);
  });

  it('produces something both editors can save', () => {
    const typed = ['ciao ciao', 'Quote EN', '  spaced out  ', '::pasted', 'Español · x', 'a'.repeat(80)];
    for (const raw of typed) {
      const token = sanitizeTriggerInput(raw);
      expect(snippetFormSchema.shape.trigger.safeParse(token).success, `${raw} → ${token}`).toBe(true);
      expect(promptFormSchema.shape.shortcut.safeParse(token).success, `${raw} → ${token}`).toBe(true);
    }
  });

  it('leaves nothing behind when nothing usable was typed', () => {
    expect(sanitizeTriggerInput('')).toBe('');
    expect(sanitizeTriggerInput('   ')).toBe('');
    expect(sanitizeTriggerInput('💰💰')).toBe('');
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
