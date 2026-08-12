import { describe, it, expect } from 'vitest';
import {
  buildLabelAssignments,
  labelNameKey,
  matchesLabelFilter,
  normalizeLabelName,
  resolveLabels,
  validateLabelName,
  LABEL_NAME_MAX,
} from '@/lib/labelUtils';
import { labelSwatch, LABEL_COLORS, DEFAULT_LABEL_COLOR } from '@/lib/labelColors';
import type { Label } from '@/types/database';

let seq = 0;
function label(p: Partial<Label> = {}): Label {
  seq += 1;
  return {
    id: `l${seq}`,
    user_id: 'u1',
    name: `Label ${seq}`,
    color: 'azure',
    parent_id: null,
    created_at: '2026-08-07T00:00:00Z',
    updated_at: '2026-08-07T00:00:00Z',
    ...p,
  };
}

describe('normalizeLabelName', () => {
  it('trims padding the way the DB trigger does', () => {
    expect(normalizeLabelName('  Sales  ')).toBe('Sales');
  });

  it('collapses a whitespace-only name to empty', () => {
    expect(normalizeLabelName('   ')).toBe('');
    expect(normalizeLabelName('\t\n ')).toBe('');
  });
});

describe('validateLabelName', () => {
  it('rejects an empty name', () => {
    expect(validateLabelName('', [])).toBe('Label name is required');
  });

  it('rejects a whitespace-only name', () => {
    expect(validateLabelName('   ', [])).toBe('Label name is required');
  });

  it('rejects a name past the DB length cap', () => {
    expect(validateLabelName('x'.repeat(LABEL_NAME_MAX + 1), [])).toMatch(/characters or fewer/);
  });

  it('accepts a name exactly at the cap', () => {
    expect(validateLabelName('x'.repeat(LABEL_NAME_MAX), [])).toBeNull();
  });

  it('rejects a duplicate regardless of case', () => {
    const existing = [label({ name: 'Sales' })];
    expect(validateLabelName('sales', existing)).toBe('"Sales" already exists');
    expect(validateLabelName('SALES', existing)).toBe('"Sales" already exists');
    expect(validateLabelName('  sAlEs  ', existing)).toBe('"Sales" already exists');
  });

  it('lets a rename keep its own name', () => {
    const own = label({ id: 'keep', name: 'Sales' });
    expect(validateLabelName('Sales', [own], 'keep')).toBeNull();
    // …but still blocks colliding with a different label.
    expect(validateLabelName('Sales', [own, label({ id: 'other', name: 'Urgent' })], 'other'))
      .toBe('"Sales" already exists');
  });

  it('accepts a distinct name', () => {
    expect(validateLabelName('Urgent', [label({ name: 'Sales' })])).toBeNull();
  });
});

describe('labelNameKey', () => {
  it('matches the lower(btrim(name)) unique index', () => {
    expect(labelNameKey('  Sales ')).toBe(labelNameKey('SALES'));
  });
});

describe('buildLabelAssignments', () => {
  it('groups label ids under their asset', () => {
    const map = buildLabelAssignments([
      { asset_id: 's1', label_id: 'l1' },
      { asset_id: 's1', label_id: 'l2' },
      { asset_id: 's2', label_id: 'l1' },
    ]);
    expect(map.get('s1')).toEqual(['l1', 'l2']);
    expect(map.get('s2')).toEqual(['l1']);
    expect(map.size).toBe(2);
  });

  it('omits assets with no assignments', () => {
    expect(buildLabelAssignments([]).has('s1')).toBe(false);
  });
});

describe('matchesLabelFilter', () => {
  const assignments = buildLabelAssignments([
    { asset_id: 's1', label_id: 'l1' },
    { asset_id: 's2', label_id: 'l2' },
  ]);

  it('passes everything when nothing is selected', () => {
    expect(matchesLabelFilter('s1', [], assignments)).toBe(true);
    expect(matchesLabelFilter('unlabelled', [], assignments)).toBe(true);
  });

  it('keeps an asset carrying the selected label', () => {
    expect(matchesLabelFilter('s1', ['l1'], assignments)).toBe(true);
  });

  it('drops an asset without it', () => {
    expect(matchesLabelFilter('s2', ['l1'], assignments)).toBe(false);
    expect(matchesLabelFilter('unlabelled', ['l1'], assignments)).toBe(false);
  });

  it('unions multiple selections rather than intersecting them', () => {
    expect(matchesLabelFilter('s1', ['l1', 'l2'], assignments)).toBe(true);
    expect(matchesLabelFilter('s2', ['l1', 'l2'], assignments)).toBe(true);
  });
});

describe('resolveLabels', () => {
  const sales = label({ id: 'l1', name: 'Sales' });
  const urgent = label({ id: 'l2', name: 'Urgent' });
  const assignments = buildLabelAssignments([
    { asset_id: 's1', label_id: 'l1' },
    { asset_id: 's1', label_id: 'gone' },
  ]);

  it('resolves ids to rows in assignment order', () => {
    expect(resolveLabels('s1', assignments, [urgent, sales])).toEqual([sales]);
  });

  it('drops ids whose label was deleted', () => {
    expect(resolveLabels('s1', assignments, [sales]).map((l) => l.id)).toEqual(['l1']);
  });

  it('returns nothing for an unlabelled asset', () => {
    expect(resolveLabels('s9', assignments, [sales])).toEqual([]);
  });
});

describe('labelSwatch', () => {
  it('resolves every key the DB CHECK constraint allows', () => {
    expect(Object.keys(LABEL_COLORS).sort()).toEqual(
      ['amber', 'azure', 'green', 'orange', 'rose', 'slate', 'teal', 'violet'],
    );
  });

  it('falls back to the default for an unknown key rather than crashing', () => {
    expect(labelSwatch('chartreuse')).toBe(LABEL_COLORS[DEFAULT_LABEL_COLOR]);
  });
});
