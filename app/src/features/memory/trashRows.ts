import type { MemoryDocument, MemoryItem } from '@/types/database';

// What the trash panel lists: one row per thing a person deleted.
//
// Trashing a file trashes every piece cut from it, so the raw lists hold the
// file and each of its pieces separately. Listed that way, one long contract
// would bury everything else under near-identical rows, and restoring a single
// piece would bring back half a document. So the pieces of a trashed file fold
// into the file's row. A piece trashed on its own, from a file that is still
// live, stays a row of its own.

export type TrashRow =
  | {
      kind: 'file';
      id: string;
      name: string;
      deletedAt: string;
      document: MemoryDocument;
      /** How many trashed pieces go wherever the file goes. */
      pieces: number;
    }
  | {
      kind: 'item';
      id: string;
      name: string;
      deletedAt: string;
      item: MemoryItem;
    };

type Trashed<T> = T & { deleted_at: string };

function isTrashed<T extends { deleted_at: string | null }>(row: T): row is Trashed<T> {
  return row.deleted_at !== null;
}

/** Most recently deleted first, the order someone looks for what they just removed. */
export function buildTrashRows(items: MemoryItem[], documents: MemoryDocument[]): TrashRow[] {
  const trashedItems = items.filter(isTrashed);
  const trashedFiles = documents.filter(isTrashed);
  const fileIds = new Set(trashedFiles.map((doc) => doc.id));

  const rows: TrashRow[] = trashedFiles.map((doc) => ({
    kind: 'file',
    id: doc.id,
    name: doc.name,
    deletedAt: doc.deleted_at,
    document: doc,
    pieces: trashedItems.filter((item) => item.source_id === doc.id).length,
  }));

  for (const item of trashedItems) {
    if (item.source_id !== null && fileIds.has(item.source_id)) continue;
    rows.push({ kind: 'item', id: item.id, name: item.name, deletedAt: item.deleted_at, item });
  }

  return rows.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** "1 file and 2 items", counted the way the panel shows them. */
export function describeTrashRows(rows: TrashRow[]): string {
  const files = rows.filter((row) => row.kind === 'file').length;
  const items = rows.length - files;
  const parts: string[] = [];
  if (files > 0) parts.push(files === 1 ? '1 file' : `${files} files`);
  if (items > 0) parts.push(items === 1 ? '1 item' : `${items} items`);
  return parts.join(' and ');
}

/** "1 piece" / "3 pieces". */
export function describePieces(count: number): string {
  return count === 1 ? '1 piece' : `${count} pieces`;
}
