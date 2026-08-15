import type { Label } from '@/types/database';

// Label hierarchy helpers (LABELS-002). Pure functions over a flat Label[] — no
// store, no React — so the same rules drive the manager, the picker, the filter
// menu, and the tests.
//
// The whole tree is resolved here rather than in SQL. Labels are personal and
// the dashboard already fetches the user's entire vocabulary in one query, so
// nesting is a regroup of an array that is in memory anyway. That is what keeps
// this feature off the database's hot path — see the header of
// 20260812000000_label_hierarchy.sql for why that distinction matters.

/** Label > Sub-label. Matches the DB trigger in 20260812000000_label_hierarchy.sql. */
export const MAX_LABEL_DEPTH = 2;

/** Separator when a nested label is rendered as one line of text. */
export const LABEL_PATH_SEPARATOR = ' / ';

export interface LabelNode {
  label: Label;
  /** 1-based: a root label is depth 1. */
  depth: number;
  children: LabelNode[];
}

function byName(a: Label, b: Label): number {
  return a.name.localeCompare(b.name);
}

/**
 * Nest a flat label list by parent_id, each level sorted by name.
 *
 * A label whose parent is missing from the list is treated as a root, matching
 * buildFolderTree. That should not happen for labels — the catalog is always
 * fetched whole — but an orphan must stay reachable rather than vanish from
 * every menu at once.
 */
export function buildLabelTree(labels: readonly Label[]): LabelNode[] {
  const byId = new Map(labels.map((l) => [l.id, l]));
  const childrenOf = new Map<string, Label[]>();
  const roots: Label[] = [];

  for (const label of labels) {
    const parentId = label.parent_id;
    if (parentId && parentId !== label.id && byId.has(parentId)) {
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(label);
      else childrenOf.set(parentId, [label]);
    } else {
      roots.push(label);
    }
  }

  // `seen` stops a parent_id loop written out-of-band from recursing forever.
  // The DB trigger prevents cycles; this keeps the UI safe regardless.
  const seen = new Set<string>();
  function build(label: Label, depth: number): LabelNode {
    seen.add(label.id);
    const kids = (childrenOf.get(label.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(byName);
    return { label, depth, children: kids.map((c) => build(c, depth + 1)) };
  }

  const nodes = roots.sort(byName).map((l) => build(l, 1));

  // Every member of a cycle has a parent that exists, so none of them lands in
  // `roots` and the entire loop would vanish from every menu at once. Surface
  // whatever the first pass never reached as a root instead: a label the user
  // can see and repair beats one that silently disappeared. Unreachable while
  // the DB trigger holds — this is the safety net for data written around it.
  for (const label of labels.filter((l) => !seen.has(l.id)).sort(byName)) {
    if (!seen.has(label.id)) nodes.push(build(label, 1));
  }

  return nodes;
}

/** Flatten a tree to render order — the shape every menu iterates. */
export function flattenLabelTree(nodes: readonly LabelNode[]): LabelNode[] {
  const out: LabelNode[] = [];
  function walk(list: readonly LabelNode[]) {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0) walk(node.children);
    }
  }
  walk(nodes);
  return out;
}

/** Direct children of `id`, sorted by name. */
export function childrenOf(labels: readonly Label[], id: string): Label[] {
  return labels.filter((l) => l.parent_id === id).sort(byName);
}

/** The parent of `id`, or null when it is a root or the parent is missing. */
export function parentOf(labels: readonly Label[], id: string): Label | null {
  const parentId = labels.find((l) => l.id === id)?.parent_id ?? null;
  if (!parentId) return null;
  return labels.find((l) => l.id === parentId) ?? null;
}

/** Every id below `id`, excluding `id` itself. */
export function descendantLabelIds(labels: readonly Label[], id: string): Set<string> {
  const out = new Set<string>();
  const queue = labels.filter((l) => l.parent_id === id).map((l) => l.id);
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined || out.has(next) || next === id) continue;
    out.add(next);
    for (const child of labels) {
      if (child.parent_id === next) queue.push(child.id);
    }
  }
  return out;
}

/** `id` plus everything below it — the set a label filter should match. */
export function subtreeLabelIds(labels: readonly Label[], id: string): Set<string> {
  const out = descendantLabelIds(labels, id);
  out.add(id);
  return out;
}

/**
 * Expand a selection to include every sub-label beneath it.
 *
 * This is the roll-up primitive: filtering by "Booking" must also list items
 * tagged only "Booking / Cancellation", the same way selecting a parent folder
 * lists its subfolders' snippets.
 *
 * Callers expand ONCE and pass the result to matchesLabelFilter, which is
 * evaluated per asset — expanding inside that loop would rebuild the same set
 * for every row.
 */
export function expandWithDescendants(
  labels: readonly Label[],
  selected: readonly string[],
): string[] {
  if (selected.length === 0) return [];
  const out = new Set<string>();
  for (const id of selected) {
    out.add(id);
    for (const descendant of descendantLabelIds(labels, id)) out.add(descendant);
  }
  return [...out];
}

/** 1-based depth of a label. A root is 1, its child 2. */
export function labelDepth(labels: readonly Label[], id: string): number {
  return parentOf(labels, id) === null ? 1 : 2;
}

/**
 * Can `id` be nested under `parentId`? Mirrors the DB trigger so the UI can
 * hide impossible targets instead of waiting for a failed write.
 * `parentId === null` means "move to root", always allowed.
 */
export function canNestUnder(
  labels: readonly Label[],
  id: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  if (parentId === id) return false;
  const parent = labels.find((l) => l.id === parentId);
  if (!parent) return false;
  // The target must be a root...
  if (parent.parent_id !== null) return false;
  // ...and a label with children cannot become one, or its children hit depth 3.
  return childrenOf(labels, id).length === 0;
}

/** Is there room for a brand-new (childless) label under `parentId`? */
export function canCreateUnder(labels: readonly Label[], parentId: string | null): boolean {
  if (parentId === null) return true;
  const parent = labels.find((l) => l.id === parentId);
  return parent !== undefined && parent.parent_id === null;
}

/** Human-readable path, e.g. "Booking / Cancellation". */
export function labelPath(labels: readonly Label[], id: string): string {
  const self = labels.find((l) => l.id === id);
  if (!self) return '';
  const parent = parentOf(labels, id);
  return parent ? `${parent.name}${LABEL_PATH_SEPARATOR}${self.name}` : self.name;
}

/**
 * Roll per-label counts up the tree: a parent reports its own items plus every
 * descendant's, so the number beside it agrees with what selecting it lists.
 */
export function rollupLabelCounts(
  labels: readonly Label[],
  ownCounts: ReadonlyMap<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const label of labels) {
    let total = ownCounts.get(label.id) ?? 0;
    for (const descendant of descendantLabelIds(labels, label.id)) {
      total += ownCounts.get(descendant) ?? 0;
    }
    out.set(label.id, total);
  }
  return out;
}
