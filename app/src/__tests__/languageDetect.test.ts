import { describe, it, expect } from 'vitest';
import {
  detectLanguage,
  extractProse,
  findLanguageMismatch,
  mismatchMessage,
} from '@/lib/languageDetect';
import type { SnippetBodies } from '@/types/database';

// Bodies lifted from the shape of real LeibTour snippets — templated prose with
// fields and formulas in the middle, not clean paragraphs.
const EN_BODY =
  'Dear {guest_name}, thank you for your booking at {property_name}. ' +
  'Your room is available from {checkin_date} and the price for {nights} nights is {total_price}. ' +
  'Please let us know if you have any questions before your arrival.';

const ES_BODY =
  'Estimado {guest_name}, gracias por su reserva en {property_name}. ' +
  'La habitación está disponible desde el {checkin_date} y el precio para {nights} noches es {total_price}. ' +
  'Por favor, no dude en escribirnos si tiene alguna pregunta antes de su llegada.';

const IT_BODY =
  'Gentile {guest_name}, grazie per la sua prenotazione presso {property_name}. ' +
  'La camera è disponibile dal {checkin_date} e il prezzo per {nights} notti è {total_price}. ' +
  'Se ha domande prima del suo arrivo non esiti a contattarci.';

const FR_BODY =
  'Bonjour {guest_name}, merci pour votre réservation à {property_name}. ' +
  'La chambre est disponible à partir du {checkin_date} et le prix pour {nights} nuits est {total_price}. ' +
  "N'hésitez pas à nous écrire si vous avez des questions avant votre arrivée.";

describe('extractProse', () => {
  it('drops field, formula and conditional tokens', () => {
    const prose = extractProse('Dear {guest_name}, you owe {=TOTAL * 1.03} {if:nights > 2}extra{endif}');
    expect(prose).not.toContain('guest_name');
    expect(prose).not.toContain('TOTAL');
    expect(prose).not.toContain('nights');
    expect(prose).toContain('Dear');
    expect(prose).toContain('extra');
  });

  it('drops a whole button block, not just its tags', () => {
    const prose = extractProse('Hola {button}window.open("checkout"){/button} gracias');
    expect(prose).not.toContain('window');
    expect(prose).not.toContain('checkout');
    expect(prose).toContain('Hola');
  });

  it('drops urls, emails and numbers', () => {
    const prose = extractProse('Visit https://leibtour.com or mail us at info@leibtour.com — 2026');
    expect(prose).not.toContain('leibtour.com');
    expect(prose).not.toContain('2026');
    expect(prose).toContain('Visit');
  });
});

describe('detectLanguage — positive identification', () => {
  it('identifies English', () => {
    expect(detectLanguage(EN_BODY)?.language).toBe('EN');
  });

  it('identifies Spanish', () => {
    expect(detectLanguage(ES_BODY)?.language).toBe('ES');
  });

  it('identifies Italian', () => {
    expect(detectLanguage(IT_BODY)?.language).toBe('IT');
  });

  it('identifies French', () => {
    expect(detectLanguage(FR_BODY)?.language).toBe('FR');
  });

  it('reports a clear margin over the runner-up', () => {
    const result = detectLanguage(ES_BODY);
    expect(result).not.toBeNull();
    expect(result!.score - result!.runnerUp).toBeGreaterThanOrEqual(2);
  });
});

describe('detectLanguage — fails open (no false positives)', () => {
  // Each of these must return null, not a guess: a verdict here would block a
  // save on text that is perfectly fine.
  const neutral = [
    '',
    'OK',
    'Total',
    'Check-in 15:00',
    'Wifi: LeibTour_Guest',
    '{total_price} €',
    '{guest_name}',
    'Dear {guest_name},',
    '+34 600 000 000',
    'https://leibtour.com/checkin',
    'Villa Serena — Ibiza',
    '10:00 / 22:00',
    'A/C, TV, WiFi',
  ];

  for (const body of neutral) {
    it(`stays silent on ${JSON.stringify(body)}`, () => {
      expect(detectLanguage(body)).toBeNull();
    });
  }

  it('stays silent on a body that is only template syntax', () => {
    expect(detectLanguage('{guest_name} {=TOTAL * 1.03} {if:nights > 2}{endif}')).toBeNull();
  });

  it('stays silent on a proper-noun list with no function words', () => {
    expect(detectLanguage('Ibiza, Formentera, Mallorca, Menorca')).toBeNull();
  });

  it('does not read field names as English prose', () => {
    // Every word here is a token name. If tokens leaked through, EN would win.
    expect(detectLanguage('{guest_name} {property_name} {checkin_date} {review_link}')).toBeNull();
  });
});

describe('detectLanguage — hospitality loanwords are not English markers', () => {
  // Regression: "check", "check-in", "check-out" and "booking" were once scored
  // as English, which made a bare times line read as English (score 3) and
  // blocked saving it into a Spanish or Italian slot. The trade is deliberate —
  // these words stay English inside every language this product serves.
  it('stays silent on a bare check-in / check-out line', () => {
    expect(detectLanguage('Check-in 15:00 — Check-out 10:00')).toBeNull();
  });

  it('stays silent on a list of booking channels', () => {
    expect(detectLanguage('Booking · Airbnb · Expedia · Vrbo')).toBeNull();
  });

  it('stays silent on wifi / parking / online', () => {
    expect(detectLanguage('Wifi + parking online')).toBeNull();
  });

  it('still reads the surrounding language when a loanword sits inside it', () => {
    expect(detectLanguage('El check-in es a las 15:00 y el check-out a las 10:00.')?.language).toBe('ES');
    expect(detectLanguage('Il check-in è alle 15:00 e il check-out alle 10:00.')?.language).toBe('IT');
    expect(detectLanguage('Le check-in est à 15:00 et le check-out à 10:00.')?.language).toBe('FR');
  });

  it('does not block a Spanish body just because it says "booking"', () => {
    expect(findLanguageMismatch({ ES: 'Su booking está confirmado. Gracias por elegirnos.' })).toBeNull();
  });
});

describe('detectLanguage — tolerant of mixed but dominant text', () => {
  it('keeps English when a Spanish proper noun appears in it', () => {
    expect(
      detectLanguage(
        'Dear guest, your room at Casa del Sol is ready and the price includes breakfast for two.',
      )?.language,
    ).toBe('EN');
  });

  it('keeps Spanish when an English loanword appears in it', () => {
    expect(
      detectLanguage(
        'Gracias por su reserva. El check-in es a las tres de la tarde y el desayuno está incluido.',
      )?.language,
    ).toBe('ES');
  });
});

describe('findLanguageMismatch', () => {
  it('flags Spanish text filed under English, with the exact message', () => {
    const mismatch = findLanguageMismatch({ EN: ES_BODY });
    expect(mismatch).not.toBeNull();
    expect(mismatch!.slot).toBe('EN');
    expect(mismatch!.detected).toBe('ES');
    expect(mismatch!.message).toBe(
      'Detected language is Spanish, but this field requires English text.',
    );
  });

  it('passes English text filed under English', () => {
    expect(findLanguageMismatch({ EN: EN_BODY })).toBeNull();
  });

  it('passes every language in its own slot', () => {
    expect(
      findLanguageMismatch({ EN: EN_BODY, ES: ES_BODY, IT: IT_BODY, FR: FR_BODY }),
    ).toBeNull();
  });

  it('flags a wrong slot the user is not currently looking at', () => {
    // EN is correct; the Italian slot is the one holding French.
    const mismatch = findLanguageMismatch({ EN: EN_BODY, IT: FR_BODY });
    expect(mismatch?.slot).toBe('IT');
    expect(mismatch?.detected).toBe('FR');
  });

  it('never judges the MULTI slot — it is a deliberate mix', () => {
    const bodies: SnippetBodies = { MULTI: ES_BODY };
    expect(findLanguageMismatch(bodies)).toBeNull();
  });

  it('ignores empty and whitespace-only slots', () => {
    expect(findLanguageMismatch({ EN: '', ES: '   ' })).toBeNull();
  });

  it('passes a short neutral body in any slot', () => {
    expect(findLanguageMismatch({ EN: 'Check-in 15:00', ES: 'Total: {total_price}' })).toBeNull();
  });

  it('reports the first offending slot in a fixed order', () => {
    // Both slots are wrong; EN is checked before ES, so EN is reported.
    const mismatch = findLanguageMismatch({ EN: ES_BODY, ES: EN_BODY });
    expect(mismatch?.slot).toBe('EN');
  });
});

describe('mismatchMessage', () => {
  it('names both languages in full', () => {
    expect(mismatchMessage('IT', 'FR')).toBe(
      'Detected language is French, but this field requires Italian text.',
    );
  });
});
