import { LABEL_NAME_MAX, labelNameKey, normalizeLabelName } from '@/lib/labelUtils';
import type { Label } from '@/types/database';

// Reconcile AI label suggestions against the real vocabulary (LABELS-AI-001).
//
// The suggest-labels edge function returns plain names. This module decides
// what each name actually is — an existing label, or a new one to offer —
// and it is the only place that decision is made. Everything the UI renders
// has been through `reconcileSuggestions`, so a name the model invented can
// only ever surface as a proposal the user has to accept.
//
// Pure and network-free on purpose: the rules that matter here (case-folding,
// dedup, the length cap) are exactly the rules the DB enforces, and they are
// worth testing without a Supabase round trip.

/** One name as it came back from the model. */
export interface RawSuggestion {
  name: string;
  reason: string;
}

/** An existing label the user already owns — accepting it just ticks the box. */
export interface ExistingSuggestion {
  kind: 'existing';
  /** The stored label. Its own `name` wins over whatever the model wrote. */
  label: Label;
  reason: string;
}

/** A label that does not exist yet — accepting it creates the label first. */
export interface ProposedSuggestion {
  kind: 'proposed';
  /** Normalized, length-checked, and known not to collide with the catalog. */
  name: string;
  reason: string;
}

export type LabelSuggestion = ExistingSuggestion | ProposedSuggestion;

/**
 * Turn raw model output into suggestions that are safe to render.
 *
 * A name that case-insensitively matches a stored label resolves to that label
 * — this is what stops "legal" from being offered as new when "Legal" already
 * exists, which is the failure mode that would quietly fork the vocabulary.
 *
 * Dropped: blank names, names past the DB length cap, repeats within one
 * response, and anything already assigned to the asset (re-suggesting a label
 * the snippet carries is noise, not a suggestion).
 *
 * @param raw       what the edge function returned
 * @param catalog   every label the user owns
 * @param assigned  label ids already on the draft
 * @param max       cap on the number returned
 */
export function reconcileSuggestions(
  raw: readonly RawSuggestion[],
  catalog: readonly Label[],
  assigned: readonly string[] = [],
  max = 3,
): LabelSuggestion[] {
  const byKey = new Map(catalog.map((label) => [labelNameKey(label.name), label]));
  const assignedIds = new Set(assigned);
  const seen = new Set<string>();
  const out: LabelSuggestion[] = [];

  for (const entry of raw) {
    if (out.length >= max) break;

    const name = normalizeLabelName(entry.name ?? '');
    if (name.length === 0 || name.length > LABEL_NAME_MAX) continue;

    const key = labelNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);

    const reason = normalizeLabelName(entry.reason ?? '');
    const existing = byKey.get(key);

    if (existing) {
      // Already on the draft — nothing to suggest.
      if (assignedIds.has(existing.id)) continue;
      out.push({ kind: 'existing', label: existing, reason });
    } else {
      out.push({ kind: 'proposed', name, reason });
    }
  }

  return out;
}

/** Stable key for React lists and for dismissing one suggestion. */
export function suggestionKey(suggestion: LabelSuggestion): string {
  return suggestion.kind === 'existing'
    ? `existing:${suggestion.label.id}`
    : `proposed:${labelNameKey(suggestion.name)}`;
}
