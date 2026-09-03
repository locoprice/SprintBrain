import { describe, expect, it } from 'vitest';
import {
  maskTokens,
  sentinel,
  unmaskTokens,
} from '../../../services/supabase/functions/translate-body/tokenMask';

// TRANSLATE-001 — the placeholder guarantee.
//
// These tests are the feature's safety net: they assert that no shape of token
// SprintBrain supports can be altered by a translation round trip, and that a
// model which mangles one is refused rather than believed.

/** Stand-in for the model: translates prose, leaves sentinels alone. */
function fakeTranslate(masked: string, dictionary: Record<string, string>): string {
  let out = masked;
  for (const [from, to] of Object.entries(dictionary)) {
    out = out.split(from).join(to);
  }
  return out;
}

describe('maskTokens', () => {
  it('hides a plain field from the model', () => {
    const { masked, tokens } = maskTokens('Dear {first_name}, welcome.');
    expect(masked).toBe('Dear [[0]], welcome.');
    expect(tokens).toEqual(['{first_name}']);
  });

  it('masks each occurrence separately so every sentinel is unique', () => {
    const { masked, tokens } = maskTokens('{first_name} … {first_name}');
    expect(masked).toBe('[[0]] … [[1]]');
    expect(tokens).toEqual(['{first_name}', '{first_name}']);
  });

  it('keeps a double-brace formula whole', () => {
    const { tokens } = maskTokens('Total: {{= SUBTOTAL * 1.22 }}');
    expect(tokens).toEqual(['{{= SUBTOTAL * 1.22 }}']);
  });

  it('keeps a single-brace formula whole', () => {
    const { tokens } = maskTokens('Due: {=LIST_PRICE - DISCOUNT}');
    expect(tokens).toEqual(['{=LIST_PRICE - DISCOUNT}']);
  });

  it('masks a form field with all its attributes', () => {
    const { masked, tokens } = maskTokens('{formmenu: gold,silver; name=PLAN; default=gold}');
    expect(masked).toBe('[[0]]');
    expect(tokens).toEqual(['{formmenu: gold,silver; name=PLAN; default=gold}']);
  });

  it('leaves the prose inside an {if:} block translatable', () => {
    // The tags are machinery; the sentence between them is what the reader
    // sees, so it MUST reach the model.
    const { masked } = maskTokens('{if:TOTAL > 0}Your balance is due{endif}');
    expect(masked).toBe('[[0]]Your balance is due[[1]]');
  });

  it('masks a {button} block whole, code included', () => {
    // The block body is assignment code. Translating it would rename fields.
    const src = '{button label="Apply"}DISCOUNT = 10{/button}';
    const { masked, tokens } = maskTokens(src);
    expect(masked).toBe('[[0]]');
    expect(tokens).toEqual([src]);
  });

  it('masks only the head of an unclosed {button}', () => {
    const { masked, tokens } = maskTokens('{button label="Apply"}left open');
    expect(masked).toBe('[[0]]left open');
    expect(tokens).toEqual(['{button label="Apply"}']);
  });

  it('does not mistake a field named buttonLabel for a button block', () => {
    const { tokens } = maskTokens('{buttonLabel}');
    expect(tokens).toEqual(['{buttonLabel}']);
  });

  it('protects text that already looks like a sentinel', () => {
    const { masked, tokens } = maskTokens('See note [[1]] and {first_name}');
    expect(tokens).toEqual(['[[1]]', '{first_name}']);
    // The literal was re-numbered, so it cannot collide with our own indexing.
    expect(masked).toBe('See note [[0]] and [[1]]');
  });

  it('leaves an unterminated brace exactly as typed', () => {
    const { masked, tokens } = maskTokens('Dear {first_name');
    expect(masked).toBe('Dear {first_name');
    expect(tokens).toEqual([]);
  });

  it('masks a greeting token', () => {
    const { tokens } = maskTokens('{greeting: lang=ES} …');
    expect(tokens).toEqual(['{greeting: lang=ES}']);
  });
});

describe('unmaskTokens', () => {
  it('restores tokens after a faithful translation', () => {
    const src = 'Dear {first_name}, your total is {{= TOTAL }}.';
    const { masked, tokens } = maskTokens(src);
    const translated = fakeTranslate(masked, { 'Dear': 'Estimado', 'your total is': 'su total es' });
    const result = unmaskTokens(translated, tokens);
    expect(result).toEqual({ ok: true, text: 'Estimado [[0]], su total es [[1]].'.replace('[[0]]', '{first_name}').replace('[[1]]', '{{= TOTAL }}') });
  });

  it('allows a sentinel to move, because word order differs by language', () => {
    const { tokens } = maskTokens('{first_name}, welcome');
    const result = unmaskTokens('Benvenuto, [[0]]', tokens);
    expect(result).toEqual({ ok: true, text: 'Benvenuto, {first_name}' });
  });

  it('refuses a translation that dropped a placeholder', () => {
    const { tokens } = maskTokens('Dear {first_name}, on {start_date}');
    const result = unmaskTokens('Caro [[0]]', tokens);
    expect(result).toEqual({ ok: false, reason: 'missing' });
  });

  it('refuses a translation that duplicated a placeholder', () => {
    const { tokens } = maskTokens('Dear {first_name}');
    const result = unmaskTokens('Caro [[0]] [[0]]', tokens);
    expect(result).toEqual({ ok: false, reason: 'duplicated' });
  });

  it('refuses a placeholder the model invented', () => {
    const { tokens } = maskTokens('Dear {first_name}');
    const result = unmaskTokens('Caro [[0]] e [[7]]', tokens);
    expect(result).toEqual({ ok: false, reason: 'unknown' });
  });

  it('round-trips a body with every token type untouched', () => {
    const src = [
      '{greeting}, {first_name}!',
      '{if:NIGHTS > 1}Long stay{endif}',
      '{formmenu: a,b; name=PLAN}',
      '{formtext: name=REF; default=none}',
      'Total {{= PRICE * NIGHTS }} / {=PRICE}',
      '{button label="Go"}PRICE = 10{/button}',
    ].join('\n');
    const { masked, tokens } = maskTokens(src);
    // The model returns the sentinels untouched — the contract we ask of it.
    const result = unmaskTokens(masked, tokens);
    expect(result).toEqual({ ok: true, text: src });
  });

  it('numbers sentinels consistently with the sentinel helper', () => {
    const { tokens } = maskTokens('{a} {b}');
    expect(unmaskTokens(sentinel(1) + ' ' + sentinel(0), tokens)).toEqual({
      ok: true,
      text: '{b} {a}',
    });
  });
});
