import type { Label, LabelAssignments } from '@/types/database';

// Pure label rules (LABELS-001). The database enforces all of this too — a
// btrim + CHECK for blanks, a unique index on lower(btrim(name)) for
// duplicates. These helpers exist so the user gets a sentence instead of a
// Postgres error code, and so the rules are unit-testable without a network.

/** Matches the `labels_name_length` CHECK constraint. */
export const LABEL_NAME_MAX = 32;

/** Collapse a raw input to what would actually be stored. */
export function normalizeLabelName(raw: string): string {
  return raw.trim();
}

/** The comparison key behind the case-insensitive unique index. */
export function labelNameKey(raw: string): string {
  return normalizeLabelName(raw).toLowerCase();
}

/**
 * Validate a name against the same rules the DB enforces.
 * `excludeId` lets a rename keep its own name.
 *
 * @returns an error sentence, or null when the name is acceptable.
 */
export function validateLabelName(
  raw: string,
  existing: readonly Label[],
  excludeId?: string,
): string | null {
  const name = normalizeLabelName(raw);
  if (name.length === 0) return 'Label name is required';
  if (name.length > LABEL_NAME_MAX) {
    return `Label name must be ${LABEL_NAME_MAX} characters or fewer`;
  }
  const key = labelNameKey(name);
  const clash = existing.find((l) => l.id !== excludeId && labelNameKey(l.name) === key);
  if (clash) return `"${clash.name}" already exists`;
  return null;
}

/**
 * Does an asset satisfy the active label filter? Multi-select is OR, not AND:
 * picking "Sales" and "Urgent" answers "show me anything in either bucket",
 * which is what a filter chip row reads as. Intersection semantics would make
 * a second click empty the list, which users read as a bug.
 */
export function matchesLabelFilter(
  assetId: string,
  selected: readonly string[],
  assignments: LabelAssignments,
): boolean {
  if (selected.length === 0) return true;
  const assigned = assignments.get(assetId);
  if (assigned === undefined || assigned.length === 0) return false;
  return assigned.some((id) => selected.includes(id));
}

/** Resolve stored ids to label rows, dropping any that no longer exist. */
export function resolveLabels(
  assetId: string,
  assignments: LabelAssignments,
  labels: readonly Label[],
): Label[] {
  const ids = assignments.get(assetId);
  if (ids === undefined || ids.length === 0) return [];
  return ids
    .map((id) => labels.find((l) => l.id === id))
    .filter((l): l is Label => l !== undefined);
}

/** Shape the `snippet_labels` / `prompt_labels` rows into the lookup map. */
export function buildLabelAssignments(
  rows: readonly { asset_id: string; label_id: string }[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const current = map.get(row.asset_id);
    if (current) {
      current.push(row.label_id);
    } else {
      map.set(row.asset_id, [row.label_id]);
    }
  }
  return map;
}
