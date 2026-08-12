import type { Folder } from '@/types/database';

// Folder hierarchy helpers. Pure functions over a flat Folder[] — no store, no
// React — so the same rules drive the snippet rail, the prompt chips, and the
// tests. The vanilla surfaces (Sprintbrain.html, popup.js) mirror this logic.

/** Property > Category > Sub. Matches the DB trigger in 20260731000000_folder_hierarchy.sql. */
export const MAX_FOLDER_DEPTH = 3;

/** Separator used when a nested folder is rendered as a single line of text. */
export const FOLDER_PATH_SEPARATOR = ' / ';

export interface FolderNode {
  folder: Folder;
  /** 1-based: a root folder is depth 1. */
  depth: number;
  children: FolderNode[];
}

function bySortOrder(a: Folder, b: Folder): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return a.name.localeCompare(b.name);
}

/**
 * Nest a flat folder list by parent_id, each level sorted by sort_order.
 *
 * A folder whose parent is missing from the list is treated as a root. That is
 * the normal case for a shared subfolder: RLS hands the user the child they were
 * granted without necessarily handing them its parent, and an orphan must still
 * be reachable rather than silently vanishing from the tree.
 */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const childrenOf = new Map<string, Folder[]>();
  const roots: Folder[] = [];

  for (const f of folders) {
    const parentId = f.parent_id;
    if (parentId && parentId !== f.id && byId.has(parentId)) {
      const siblings = childrenOf.get(parentId);
      if (siblings) siblings.push(f);
      else childrenOf.set(parentId, [f]);
    } else {
      roots.push(f);
    }
  }

  // `seen` stops a cycle (parent_id loop written out-of-band) from recursing
  // forever. The DB trigger prevents cycles; this keeps the UI safe regardless.
  const seen = new Set<string>();
  function build(folder: Folder, depth: number): FolderNode {
    seen.add(folder.id);
    const kids = (childrenOf.get(folder.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(bySortOrder);
    return {
      folder,
      depth,
      children: kids.map((c) => build(c, depth + 1)),
    };
  }

  const nodes = roots.sort(bySortOrder).map((f) => build(f, 1));

  // Every member of a parent_id cycle has a parent that IS in the list, so none
  // of them lands in `roots` and the entire loop would vanish from the tree —
  // taking the snippets inside those folders out of reach, with nothing on
  // screen to explain where they went. Surface whatever the first pass never
  // reached as a root instead, which is how this function already treats a
  // folder whose parent is missing. Unreachable while folders_hierarchy_guard
  // holds; this is the safety net for data written around it.
  for (const folder of [...folders].sort(bySortOrder)) {
    if (!seen.has(folder.id)) nodes.push(build(folder, 1));
  }

  return nodes;
}

/** Flatten a tree to render order, skipping the subtrees of collapsed folders. */
export function flattenTree(
  nodes: FolderNode[],
  isCollapsed: (id: string) => boolean = () => false,
): FolderNode[] {
  const out: FolderNode[] = [];
  function walk(list: FolderNode[]) {
    for (const node of list) {
      out.push(node);
      if (node.children.length > 0 && !isCollapsed(node.folder.id)) walk(node.children);
    }
  }
  walk(nodes);
  return out;
}

/** Every id below `id`, excluding `id` itself. */
export function descendantIds(folders: Folder[], id: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const siblings = childrenOf.get(f.parent_id);
    if (siblings) siblings.push(f.id);
    else childrenOf.set(f.parent_id, [f.id]);
  }
  const out = new Set<string>();
  const queue = [...(childrenOf.get(id) ?? [])];
  while (queue.length > 0) {
    const next = queue.pop();
    if (next === undefined || out.has(next) || next === id) continue;
    out.add(next);
    queue.push(...(childrenOf.get(next) ?? []));
  }
  return out;
}

/** `id` plus everything below it — the set a folder filter should match. */
export function subtreeIds(folders: Folder[], id: string): Set<string> {
  const out = descendantIds(folders, id);
  out.add(id);
  return out;
}

/** Ancestors nearest-first, excluding the folder itself. */
export function ancestorsOf(folders: Folder[], id: string): Folder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: Folder[] = [];
  const seen = new Set<string>([id]);
  let current = byId.get(id)?.parent_id ?? null;
  while (current && !seen.has(current)) {
    const parent = byId.get(current);
    if (!parent) break;
    out.push(parent);
    seen.add(parent.id);
    current = parent.parent_id;
  }
  return out;
}

/** 1-based depth of a folder within the tree. */
export function depthOf(folders: Folder[], id: string): number {
  return ancestorsOf(folders, id).length + 1;
}

/** Height of the subtree rooted at `id`: 1 when the folder has no children. */
export function subtreeHeight(folders: Folder[], id: string): number {
  const childrenOf = new Map<string, Folder[]>();
  for (const f of folders) {
    if (!f.parent_id) continue;
    const siblings = childrenOf.get(f.parent_id);
    if (siblings) siblings.push(f);
    else childrenOf.set(f.parent_id, [f]);
  }
  const seen = new Set<string>();
  function height(folderId: string): number {
    if (seen.has(folderId)) return 1;
    seen.add(folderId);
    const kids = childrenOf.get(folderId) ?? [];
    let tallest = 1;
    for (const kid of kids) tallest = Math.max(tallest, 1 + height(kid.id));
    return tallest;
  }
  return height(id);
}

/**
 * Can `folderId` be reparented under `parentId`? Mirrors the DB trigger so the
 * UI can grey out impossible targets instead of waiting for a failed write.
 * `parentId === null` means "move to root", which is always allowed.
 */
export function canMoveFolder(
  folders: Folder[],
  folderId: string,
  parentId: string | null,
): boolean {
  if (parentId === null) return true;
  if (parentId === folderId) return false;
  if (descendantIds(folders, folderId).has(parentId)) return false;
  return depthOf(folders, parentId) + subtreeHeight(folders, folderId) <= MAX_FOLDER_DEPTH;
}

/**
 * Is there room for a brand-new (childless) folder under `parentId`?
 * Used to grey out "New subfolder" at the deepest level.
 */
export function canNestUnder(folders: Folder[], parentId: string | null): boolean {
  if (parentId === null) return true;
  return depthOf(folders, parentId) + 1 <= MAX_FOLDER_DEPTH;
}

/** Human-readable path, e.g. "Villa Serena / Preventivi". */
export function folderPath(folders: Folder[], id: string): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const self = byId.get(id);
  if (!self) return '';
  const names = ancestorsOf(folders, id)
    .reverse()
    .map((f) => f.name);
  names.push(self.name);
  return names.join(FOLDER_PATH_SEPARATOR);
}

/**
 * Hover text for a folder row: its full path, plus the description on a second
 * line when it has one. Without this a description is invisible until you
 * select the folder, so you cannot tell which folders carry one.
 */
export function folderTooltip(folders: Folder[], id: string): string {
  const path = folderPath(folders, id);
  const description = folders.find((f) => f.id === id)?.description?.trim();
  return description ? `${path}\n${description}` : path;
}

/**
 * Roll per-folder counts up the tree: a parent reports its own items plus every
 * descendant's, so the badge agrees with what selecting that folder lists.
 */
export function rollupCounts(
  folders: Folder[],
  ownCounts: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of folders) {
    let total = ownCounts.get(f.id) ?? 0;
    for (const descendant of descendantIds(folders, f.id)) {
      total += ownCounts.get(descendant) ?? 0;
    }
    out.set(f.id, total);
  }
  return out;
}
