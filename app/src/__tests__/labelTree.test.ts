import { describe, it, expect } from 'vitest';
import {
  buildLabelTree,
  canCreateUnder,
  canNestUnder,
  childrenOf,
  descendantLabelIds,
  expandWithDescendants,
  flattenLabelTree,
  labelDepth,
  labelPath,
  parentOf,
  rollupLabelCounts,
  subtreeLabelIds,
  MAX_LABEL_DEPTH,
} from '@/lib/labelTree';
import type { Label } from '@/types/database';

function label(id: string, name: string, parentId: string | null = null): Label {
  return {
    id,
    user_id: 'u1',
    name,
    color: 'azure',
    parent_id: parentId,
    created_at: '2026-08-12T00:00:00Z',
    updated_at: '2026-08-12T00:00:00Z',
  };
}

//   Booking          (root)
//     Cancellation
//     Deposit
//   Legal            (root)
//   Sales            (root, no children)
const BOOKING = label('booking', 'Booking');
const CANCELLATION = label('cancel', 'Cancellation', 'booking');
const DEPOSIT = label('deposit', 'Deposit', 'booking');
const LEGAL = label('legal', 'Legal');
const SALES = label('sales', 'Sales');
const CATALOG = [CANCELLATION, SALES, BOOKING, DEPOSIT, LEGAL]; // deliberately unordered

describe('buildLabelTree', () => {
  it('nests children under their parent, each level sorted by name', () => {
    const tree = buildLabelTree(CATALOG);
    expect(tree.map((n) => n.label.name)).toEqual(['Booking', 'Legal', 'Sales']);
    expect(tree[0]?.children.map((n) => n.label.name)).toEqual(['Cancellation', 'Deposit']);
  });

  it('reports 1-based depth', () => {
    const tree = buildLabelTree(CATALOG);
    expect(tree[0]?.depth).toBe(1);
    expect(tree[0]?.children[0]?.depth).toBe(2);
  });

  it('treats a label whose parent is missing as a root, rather than dropping it', () => {
    const orphan = label('orphan', 'Orphan', 'gone');
    expect(buildLabelTree([orphan]).map((n) => n.label.name)).toEqual(['Orphan']);
  });

  // A cycle leaves every member with a parent that exists, so a naive build
  // finds no roots and drops the whole loop. Labels must never disappear.
  it('still surfaces every label when a parent_id cycle is written out of band', () => {
    const a = label('a', 'A', 'b');
    const b = label('b', 'B', 'a');
    expect(() => buildLabelTree([a, b])).not.toThrow();
    const names = flattenLabelTree(buildLabelTree([a, b])).map((n) => n.label.name);
    expect(names.sort()).toEqual(['A', 'B']);
  });

  // The invariant the whole module rests on, stated once against messy data.
  it('renders every label exactly once, whatever the parent ids say', () => {
    const messy = [
      ...CATALOG,
      label('orphan', 'Orphan', 'gone'),
      label('self', 'Self', 'self'),
      label('cyc1', 'Cyc1', 'cyc2'),
      label('cyc2', 'Cyc2', 'cyc1'),
    ];
    const ids = flattenLabelTree(buildLabelTree(messy)).map((n) => n.label.id);
    expect(ids.length).toBe(messy.length);
    expect(new Set(ids).size).toBe(messy.length);
  });

  it('ignores a label that points at itself', () => {
    const self = label('s', 'Self', 's');
    expect(buildLabelTree([self]).map((n) => n.label.name)).toEqual(['Self']);
  });

  it('returns nothing for an empty catalog', () => {
    expect(buildLabelTree([])).toEqual([]);
  });
});

describe('flattenLabelTree', () => {
  it('walks parents then their children, in render order', () => {
    const flat = flattenLabelTree(buildLabelTree(CATALOG));
    expect(flat.map((n) => n.label.name)).toEqual([
      'Booking',
      'Cancellation',
      'Deposit',
      'Legal',
      'Sales',
    ]);
  });
});

describe('childrenOf / parentOf', () => {
  it('lists direct children sorted by name', () => {
    expect(childrenOf(CATALOG, 'booking').map((l) => l.name)).toEqual([
      'Cancellation',
      'Deposit',
    ]);
  });

  it('returns no children for a leaf', () => {
    expect(childrenOf(CATALOG, 'sales')).toEqual([]);
  });

  it('resolves a parent, and null for a root', () => {
    expect(parentOf(CATALOG, 'cancel')).toEqual(BOOKING);
    expect(parentOf(CATALOG, 'booking')).toBeNull();
  });

  it('returns null when the parent id dangles', () => {
    expect(parentOf([label('x', 'X', 'gone')], 'x')).toBeNull();
  });
});

describe('descendantLabelIds / subtreeLabelIds', () => {
  it('collects children, excluding the label itself', () => {
    expect(descendantLabelIds(CATALOG, 'booking')).toEqual(new Set(['cancel', 'deposit']));
  });

  it('is empty for a leaf', () => {
    expect(descendantLabelIds(CATALOG, 'sales').size).toBe(0);
  });

  it('includes the label itself in the subtree', () => {
    expect(subtreeLabelIds(CATALOG, 'booking')).toEqual(
      new Set(['booking', 'cancel', 'deposit']),
    );
  });
});

describe('expandWithDescendants', () => {
  // The roll-up contract: filtering by a parent must reach its children.
  it('adds every sub-label under a selected parent', () => {
    expect(new Set(expandWithDescendants(CATALOG, ['booking']))).toEqual(
      new Set(['booking', 'cancel', 'deposit']),
    );
  });

  it('leaves a selected child alone — a child does not imply its parent', () => {
    expect(expandWithDescendants(CATALOG, ['cancel'])).toEqual(['cancel']);
  });

  it('dedups when a parent and its child are both selected', () => {
    const out = expandWithDescendants(CATALOG, ['booking', 'cancel']);
    expect(new Set(out)).toEqual(new Set(['booking', 'cancel', 'deposit']));
    expect(out.length).toBe(3);
  });

  it('passes an empty selection straight through', () => {
    expect(expandWithDescendants(CATALOG, [])).toEqual([]);
  });

  it('keeps an id that is not in the catalog, so a stale filter still matches nothing', () => {
    expect(expandWithDescendants(CATALOG, ['gone'])).toEqual(['gone']);
  });
});

describe('labelDepth', () => {
  it('is 1 for a root and 2 for a child', () => {
    expect(labelDepth(CATALOG, 'booking')).toBe(1);
    expect(labelDepth(CATALOG, 'cancel')).toBe(2);
    expect(MAX_LABEL_DEPTH).toBe(2);
  });
});

describe('canNestUnder', () => {
  it('allows a childless root to become a child of another root', () => {
    expect(canNestUnder(CATALOG, 'sales', 'booking')).toBe(true);
  });

  it('always allows a move to root', () => {
    expect(canNestUnder(CATALOG, 'cancel', null)).toBe(true);
  });

  it('rejects nesting under itself', () => {
    expect(canNestUnder(CATALOG, 'booking', 'booking')).toBe(false);
  });

  // The depth-3 guard, from both directions.
  it('rejects nesting under a label that is already a child', () => {
    expect(canNestUnder(CATALOG, 'sales', 'cancel')).toBe(false);
  });

  it('rejects moving a label that has children', () => {
    expect(canNestUnder(CATALOG, 'booking', 'legal')).toBe(false);
  });

  it('rejects an unknown parent', () => {
    expect(canNestUnder(CATALOG, 'sales', 'gone')).toBe(false);
  });
});

describe('canCreateUnder', () => {
  it('allows a new label at root or under a root', () => {
    expect(canCreateUnder(CATALOG, null)).toBe(true);
    expect(canCreateUnder(CATALOG, 'booking')).toBe(true);
  });

  it('refuses to create beneath an existing child', () => {
    expect(canCreateUnder(CATALOG, 'cancel')).toBe(false);
  });

  it('refuses an unknown parent', () => {
    expect(canCreateUnder(CATALOG, 'gone')).toBe(false);
  });
});

describe('labelPath', () => {
  it('renders a child as "Parent / Child"', () => {
    expect(labelPath(CATALOG, 'cancel')).toBe('Booking / Cancellation');
  });

  it('renders a root as its bare name', () => {
    expect(labelPath(CATALOG, 'booking')).toBe('Booking');
  });

  it('is empty for an unknown id', () => {
    expect(labelPath(CATALOG, 'gone')).toBe('');
  });
});

describe('rollupLabelCounts', () => {
  it('adds descendants into the parent so the badge matches the filtered list', () => {
    const own = new Map([['booking', 1], ['cancel', 3], ['deposit', 2], ['sales', 7]]);
    const rolled = rollupLabelCounts(CATALOG, own);
    expect(rolled.get('booking')).toBe(6);
    expect(rolled.get('cancel')).toBe(3);
    expect(rolled.get('sales')).toBe(7);
  });

  it('reports zero for a label nothing uses', () => {
    expect(rollupLabelCounts(CATALOG, new Map()).get('booking')).toBe(0);
  });
});
