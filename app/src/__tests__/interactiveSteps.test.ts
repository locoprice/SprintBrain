import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  INTERACTIVE_STEPS_BLOCK,
  INTERACTIVE_STEPS_KEY,
  applyInteractiveSteps,
  loadInteractiveSteps,
  saveInteractiveSteps,
} from '@/lib/interactiveSteps';

// "Interactive Steps" adds a block before a prompt when it is copied from the
// preview window. The block is never saved into the prompt, so off must give
// back the written text exactly. scripts/check-interactive-steps.js holds this
// copy to the extension's; these tests pin what the dashboard does with it.

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    data,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('applyInteractiveSteps', () => {
  const PROMPT = '## Objective\nTighten this paragraph.';

  it('leaves the prompt exactly as written when off', () => {
    expect(applyInteractiveSteps(PROMPT, false)).toBe(PROMPT);
  });

  it('puts the block and a blank line before the prompt when on', () => {
    expect(applyInteractiveSteps(PROMPT, true)).toBe(`${INTERACTIVE_STEPS_BLOCK}\n\n${PROMPT}`);
  });

  it('keeps an empty prompt empty', () => {
    expect(applyInteractiveSteps('', true)).toBe('');
    expect(applyInteractiveSteps('  \n', true)).toBe('  \n');
  });

  it('never adds the block twice', () => {
    const once = applyInteractiveSteps(PROMPT, true);
    expect(applyInteractiveSteps(once, true)).toBe(once);
  });

  it('opens and closes the block with the INTERACTIVE_STEPS tag', () => {
    expect(INTERACTIVE_STEPS_BLOCK.startsWith('<INTERACTIVE_STEPS>\n')).toBe(true);
    expect(INTERACTIVE_STEPS_BLOCK.endsWith('\n</INTERACTIVE_STEPS>')).toBe(true);
  });
});

describe('Interactive Steps setting', () => {
  it('is off when nothing is stored', () => {
    vi.stubGlobal('window', { localStorage: memoryStorage() });
    expect(loadInteractiveSteps()).toBe(false);
  });

  it('saves under sb_interactive_steps_enabled and reads it back', () => {
    const storage = memoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    expect(saveInteractiveSteps(true)).toBe(true);
    expect(INTERACTIVE_STEPS_KEY).toBe('sb_interactive_steps_enabled');
    expect(storage.data.get('sb_interactive_steps_enabled')).toBe('true');
    expect(loadInteractiveSteps()).toBe(true);
    saveInteractiveSteps(false);
    expect(loadInteractiveSteps()).toBe(false);
  });

  it('reads as off and reports a failed save when the browser blocks storage', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    vi.stubGlobal('window', { localStorage: blocked });
    expect(loadInteractiveSteps()).toBe(false);
    expect(saveInteractiveSteps(true)).toBe(false);
    expect(console.error).toHaveBeenCalledTimes(2);
  });
});
