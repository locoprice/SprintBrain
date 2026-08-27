import { describe, expect, it } from 'vitest';
import {
  MAX_FOLDER_DEPTH,
  ancestorsOf,
  buildFolderTree,
  canMoveFolder,
  canNestUnder,
  depthOf,
  descendantIds,
  flattenTree,
  folderPath,
  folderTooltip,
  rollupCounts,
  subtreeHeight,
  subtreeIds,
} from '@/lib/folderTree';
import type { Folder } from '@/types/database';

function folder(id: string, name: string, parent_id: string | null, sort_order = 0): Folder {
  return {
    id,
    user_id: 'u1',
    name,
    icon: 'folder',
    sort_order,
    updated_at: '2026-07-31T00:00:00.000Z',
    parent_id,
    description: null,
    organization_id: null,
  };
}

// Villa Serena > { Preventivi, Lamentele }, plus a flat legacy folder.
const villa = folder('villa', 'Villa Serena', null, 1);
const quotes = folder('quotes', 'Preventivi', 'villa', 1);
const complaints = folder('complaints', 'Lamentele', 'villa', 2);
const legacy = folder('legacy', 'Generale', null, 2);
const TREE: Folder[] = [complaints, legacy, quotes, villa];

describe('buildFolderTree', () => {
  it('nests children under their parent and sorts each level by sort_order', () => {
    const roots = buildFolderTree(TREE);
    expect(roots.map((n) => n.folder.id)).toEqual(['villa', 'legacy']);
    expect(roots[0]?.children.map((n) => n.folder.id)).toEqual(['quotes', 'complaints']);
    expect(roots[0]?.depth).toBe(1);
    expect(roots[0]?.children[0]?.depth).toBe(2);
  });

  it('treats a folder whose parent is not visible as a root', () => {
    // RLS can hand over a shared child without its parent — it must still render.
    const roots = buildFolderTree([quotes]);
    expect(roots.map((n) => n.folder.id)).toEqual(['quotes']);
    expect(roots[0]?.depth).toBe(1);
  });

  // Both halves matter. Terminating was never the hard part — the `seen` guard
  // handles that — but every member of a cycle has a parent that IS in the
  // list, so none becomes a root and a naive build drops the whole loop. The
  // folders (and the snippets filed in them) would silently leave the UI.
  it('still renders both folders in a parent_id cycle, without recursing forever', () => {
    const a = folder('a', 'A', 'b');
    const b = folder('b', 'B', 'a');
    const rendered = flattenTree(buildFolderTree([a, b])).map((n) => n.folder.id);
    expect(rendered.sort()).toEqual(['a', 'b']);
  });

  it('renders a longer cycle in full', () => {
    const ring = [
      folder('a', 'A', 'c'),
      folder('b', 'B', 'a'),
      folder('c', 'C', 'b'),
    ];
    const rendered = flattenTree(buildFolderTree(ring)).map((n) => n.folder.id);
    expect(rendered.sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores a folder pointing at itself', () => {
    const self = folder('self', 'Self', 'self');
    const roots = buildFolderTree([self]);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.children).toHaveLength(0);
  });

  // The invariant behind all of the above, stated once against messy data: a
  // folder must always be reachable, whatever parent_id claims.
  it('renders every folder exactly once, whatever the parent ids say', () => {
    const messy = [
      ...TREE,
      folder('orphan', 'Orphan', 'gone'),
      folder('self', 'Self', 'self'),
      folder('ring1', 'Ring1', 'ring2'),
      folder('ring2', 'Ring2', 'ring1'),
    ];
    const ids = flattenTree(buildFolderTree(messy)).map((n) => n.folder.id);
    expect(ids).toHaveLength(messy.length);
    expect(new Set(ids).size).toBe(messy.length);
  });
});

describe('flattenTree', () => {
  it('returns render order for a fully expanded tree', () => {
    const flat = flattenTree(buildFolderTree(TREE));
    expect(flat.map((n) => n.folder.id)).toEqual(['villa', 'quotes', 'complaints', 'legacy']);
  });

  it('skips the subtree of a collapsed folder', () => {
    const flat = flattenTree(buildFolderTree(TREE), (id) => id === 'villa');
    expect(flat.map((n) => n.folder.id)).toEqual(['villa', 'legacy']);
  });
});

describe('descendantIds / subtreeIds', () => {
  it('collects every id below a folder', () => {
    expect(descendantIds(TREE, 'villa')).toEqual(new Set(['quotes', 'complaints']));
    expect(descendantIds(TREE, 'quotes')).toEqual(new Set());
  });

  it('subtreeIds includes the folder itself', () => {
    expect(subtreeIds(TREE, 'villa')).toEqual(new Set(['villa', 'quotes', 'complaints']));
  });
});

describe('ancestorsOf / depthOf / subtreeHeight', () => {
  it('walks ancestors nearest-first', () => {
    expect(ancestorsOf(TREE, 'quotes').map((f) => f.id)).toEqual(['villa']);
    expect(ancestorsOf(TREE, 'villa')).toEqual([]);
  });

  it('returns every ancestor, not just the immediate parent', () => {
    // Drives the breadcrumb: at depth 3 the trail must show both ancestors.
    const sub = folder('sub', 'Sub', 'quotes');
    expect(ancestorsOf([...TREE, sub], 'sub').map((f) => f.id)).toEqual(['quotes', 'villa']);
  });

  it('reports 1-based depth', () => {
    expect(depthOf(TREE, 'villa')).toBe(1);
    expect(depthOf(TREE, 'quotes')).toBe(2);
  });

  it('reports subtree height with the folder itself counting as 1', () => {
    expect(subtreeHeight(TREE, 'villa')).toBe(2);
    expect(subtreeHeight(TREE, 'quotes')).toBe(1);
  });
});

describe('canMoveFolder', () => {
  it('allows moving to root', () => {
    expect(canMoveFolder(TREE, 'quotes', null)).toBe(true);
  });

  it('rejects self-parenting', () => {
    expect(canMoveFolder(TREE, 'villa', 'villa')).toBe(false);
  });

  it('rejects moving a folder into its own subtree', () => {
    expect(canMoveFolder(TREE, 'villa', 'quotes')).toBe(false);
  });

  it('allows a legal reparent', () => {
    expect(canMoveFolder(TREE, 'legacy', 'villa')).toBe(true);
  });

  it('rejects a move that would exceed the depth cap', () => {
    // villa > quotes > sub is already MAX_FOLDER_DEPTH; legacy(+subtree) cannot fit.
    const sub = folder('sub', 'Sub', 'quotes');
    const deep = [...TREE, sub];
    expect(depthOf(deep, 'sub')).toBe(MAX_FOLDER_DEPTH);
    expect(canMoveFolder(deep, 'legacy', 'sub')).toBe(false);
    // Moving a 2-tall subtree under a depth-2 folder would land at depth 3+1.
    expect(canMoveFolder(deep, 'villa', 'legacy')).toBe(false);
  });
});

describe('canNestUnder', () => {
  it('always allows a new root folder', () => {
    expect(canNestUnder(TREE, null)).toBe(true);
  });

  it('allows a new child under a root or second-level folder', () => {
    expect(canNestUnder(TREE, 'villa')).toBe(true);
    expect(canNestUnder(TREE, 'quotes')).toBe(true);
  });

  it('refuses a new child at the deepest level', () => {
    const sub = folder('sub', 'Sub', 'quotes');
    expect(canNestUnder([...TREE, sub], 'sub')).toBe(false);
  });
});

describe('folderPath', () => {
  it('joins ancestors root-first', () => {
    expect(folderPath(TREE, 'quotes')).toBe('Villa Serena / Preventivi');
    expect(folderPath(TREE, 'villa')).toBe('Villa Serena');
  });

  it('returns an empty string for an unknown folder', () => {
    expect(folderPath(TREE, 'nope')).toBe('');
  });
});

describe('folderTooltip', () => {
  it('is just the path when the folder has no description', () => {
    expect(folderTooltip(TREE, 'quotes')).toBe('Villa Serena / Preventivi');
  });

  it('appends the description on a second line', () => {
    const described = [...TREE.filter((f) => f.id !== 'villa'), { ...villa, description: 'Business partners' }];
    expect(folderTooltip(described, 'villa')).toBe('Villa Serena\nBusiness partners');
  });

  it('ignores a whitespace-only description', () => {
    const blank = [...TREE.filter((f) => f.id !== 'villa'), { ...villa, description: '   ' }];
    expect(folderTooltip(blank, 'villa')).toBe('Villa Serena');
  });
});

describe('rollupCounts', () => {
  it('adds descendant counts into the parent', () => {
    const own = new Map([
      ['villa', 2],
      ['quotes', 5],
      ['complaints', 3],
      ['legacy', 1],
    ]);
    const rolled = rollupCounts(TREE, own);
    expect(rolled.get('villa')).toBe(10);
    expect(rolled.get('quotes')).toBe(5);
    expect(rolled.get('legacy')).toBe(1);
  });

  it('reports zero for a folder with no items anywhere in its subtree', () => {
    expect(rollupCounts(TREE, new Map()).get('villa')).toBe(0);
  });
});
