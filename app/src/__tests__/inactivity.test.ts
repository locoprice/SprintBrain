import { describe, expect, it } from 'vitest';

import cases from '../../../scripts/inactivity-cases.json';
import {
  clampMonths,
  cutoffMs,
  findInactive,
  formatDate,
  message,
  monthsBetween,
  type InactivityCandidate,
} from '@/lib/inactivity';

// The dashboard half of the unused-asset rule gate (INACTIVE-001).
//
// `app/src/lib/inactivity.ts` is a mirror of `extension/shared/inactivity.js`,
// forced by app/CLAUDE.md section 6 (the dashboard cannot import extension
// source). Both read scripts/inactivity-cases.json, so a change to the rule
// fails here AND in scripts/check-inactivity-parity.js until both copies agree.
//
// Read that JSON file for why every fixture date sits weeks away from a
// threshold boundary.

const NOW = new Date(cases.now).getTime();

const items: InactivityCandidate[] = cases.items.map((i) => ({
  id: i.id,
  name: i.name,
  trigger: i.trigger,
  lastUsedAt: i.lastUsedAt,
  createdAt: i.createdAt,
}));

const keptUntil: Record<string, number> = Object.fromEntries(
  Object.entries(cases.keptUntil).map(([id, iso]) => [id, new Date(iso).getTime()]),
);

describe('findInactive against the shared case table', () => {
  for (const exp of cases.expect) {
    describe(exp._case, () => {
      const out = findInactive(items, keptUntil, exp.months, NOW);

      it('flags the right assets, oldest first', () => {
        expect(out.map((e) => e.id)).toEqual(exp.ids);
      });

      it('words each sentence the way the extension does', () => {
        expect(out.map((e) => message(e))).toEqual(exp.messages);
      });

      it('separates a never-used asset from a long-unused one', () => {
        expect(out.map((e) => e.everUsed)).toEqual(exp.everUsed);
      });
    });
  }
});

describe('clampMonths against the shared case table', () => {
  for (const c of cases.clampMonths) {
    it(`maps ${JSON.stringify(c.in)} to ${c.out}`, () => {
      expect(clampMonths(c.in)).toBe(c.out);
    });
  }
});

describe('formatDate against the shared case table', () => {
  for (const c of cases.formatDate) {
    it(`renders ${c.in} as "${c.out}"`, () => {
      expect(formatDate(new Date(c.in).getTime())).toBe(c.out);
    });
  }
});

describe('cutoffMs counts calendar months', () => {
  it('lands exactly six months back from mid-month', () => {
    const mid = new Date(cutoffMs(new Date(2026, 7, 15, 12).getTime(), 6));
    expect([mid.getDate(), mid.getMonth(), mid.getFullYear()]).toEqual([15, 1, 2026]);
  });

  // Pinned rather than fixed: February has no 31st, so setMonth rolls into
  // March. Both copies do it, and the module comments say why it is left alone.
  it('overflows a month-end date into early March', () => {
    const end = new Date(cutoffMs(new Date(2026, 7, 31, 12).getTime(), 6));
    expect([end.getDate(), end.getMonth(), end.getFullYear()]).toEqual([3, 2, 2026]);
  });
});

describe('edge cases the banner depends on', () => {
  it('skips an asset with neither a use nor a creation date', () => {
    // No evidence is not evidence of staleness. Without this a surface that
    // failed to supply dates would have its whole library condemned.
    const out = findInactive(
      [{ id: 'x', name: 'X', trigger: '', lastUsedAt: null, createdAt: null }],
      {},
      6,
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('falls back to the trigger when an asset has no name', () => {
    const out = findInactive(
      [{ id: 'x', name: '   ', trigger: '::abc', lastUsedAt: null, createdAt: '2020-01-01' }],
      {},
      6,
      NOW,
    );
    expect(out[0]?.name).toBe('::abc');
  });

  it('prefers a recorded use over the creation date', () => {
    // A snippet created two years ago but used last week is not unused. Getting
    // this backwards would flag the most-used snippet in the library.
    const out = findInactive(
      [{ id: 'x', name: 'X', trigger: '', lastUsedAt: '2026-09-01', createdAt: '2024-01-01' }],
      {},
      6,
      NOW,
    );
    expect(out).toEqual([]);
  });

  it('counts whole months only', () => {
    expect(monthsBetween(new Date(2026, 0, 20).getTime(), new Date(2026, 1, 19).getTime())).toBe(0);
    expect(monthsBetween(new Date(2026, 0, 20).getTime(), new Date(2026, 1, 20).getTime())).toBe(1);
  });
});
