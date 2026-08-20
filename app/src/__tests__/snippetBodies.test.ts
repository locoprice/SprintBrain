import { describe, expect, it } from 'vitest';
import { clearBodySlot, setBodySlot } from '@/lib/snippetBodies';
import type { SnippetBodies } from '@/types/database';

describe('setBodySlot', () => {
  it('writes text into its own language slot', () => {
    expect(setBodySlot({ EN: 'hello' }, 'IT', 'ciao')).toEqual({ EN: 'hello', IT: 'ciao' });
  });

  it('deletes the slot when the text is empty', () => {
    expect(setBodySlot({ EN: 'hello', IT: 'ciao' }, 'IT', '')).toEqual({ EN: 'hello' });
  });

  it('leaves no key behind for a language that was never filled', () => {
    expect(setBodySlot({ EN: 'hello' }, 'FR', '')).toEqual({ EN: 'hello' });
  });

  it('does not mutate the map it was given', () => {
    const before: SnippetBodies = { EN: 'hello', IT: 'ciao' };
    setBodySlot(before, 'IT', '');
    expect(before).toEqual({ EN: 'hello', IT: 'ciao' });
  });
});

describe('clearBodySlot', () => {
  it('removes only the language it was asked for', () => {
    expect(clearBodySlot({ EN: 'hello', IT: 'ciao', ES: 'hola' }, 'IT')).toEqual({
      EN: 'hello',
      ES: 'hola',
    });
  });

  it('is a no-op on a language that is not there', () => {
    expect(clearBodySlot({ EN: 'hello' }, 'FR')).toEqual({ EN: 'hello' });
  });

  it('empties the map when the last language goes', () => {
    expect(clearBodySlot({ EN: 'hello' }, 'EN')).toEqual({});
  });

  it('does not mutate the map it was given', () => {
    const before: SnippetBodies = { EN: 'hello', IT: 'ciao' };
    clearBodySlot(before, 'IT');
    expect(before).toEqual({ EN: 'hello', IT: 'ciao' });
  });
});

/**
 * The bug Clear was built to close: wiping a language and then switching tabs
 * used to write the emptied slot back as '', which reached the row as a
 * translation that exists and holds nothing. Both surfaces snapshot the
 * textarea through setBodySlot on a language switch, so the cleared slot has to
 * stay gone across any number of switches.
 */
describe('cleared language stays cleared', () => {
  it('survives a switch away and back', () => {
    let bodies: SnippetBodies = { EN: 'hello', IT: 'ciao' };

    // Clear pressed while IT is on screen.
    bodies = clearBodySlot(bodies, 'IT');
    expect(bodies).toEqual({ EN: 'hello' });

    // Switch IT -> EN: the empty textarea is snapshotted back into IT.
    bodies = setBodySlot(bodies, 'IT', '');
    expect(bodies).toEqual({ EN: 'hello' });

    // Switch EN -> IT and back again, EN untouched throughout.
    bodies = setBodySlot(bodies, 'EN', 'hello');
    bodies = setBodySlot(bodies, 'IT', '');
    expect(bodies).toEqual({ EN: 'hello' });
    expect(Object.keys(bodies)).not.toContain('IT');
  });

  it('clearing every language leaves nothing for the row to carry', () => {
    let bodies: SnippetBodies = { EN: 'hello', IT: 'ciao', ES: 'hola', FR: 'salut' };
    for (const lang of ['EN', 'IT', 'ES', 'FR'] as const) {
      bodies = clearBodySlot(bodies, lang);
    }
    expect(bodies).toEqual({});
  });
});
