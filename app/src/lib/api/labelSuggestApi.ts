import { supabase } from '@/lib/supabase';
import { reconcileSuggestions, type LabelSuggestion, type RawSuggestion } from '@/lib/labelSuggest';
import type { Label } from '@/types/database';

// AI label suggestions for a draft snippet (LABELS-AI-001).
//
// The edge function reads the caller's own vocabulary under RLS and returns
// plain names. Reconciling those names against the live catalog happens here,
// on the way out, so no component ever handles unreconciled model output.

const EDGE_FN_SUGGEST_LABELS = 'suggest-labels';

/** What the editor knows about the snippet being written. */
export interface SnippetDraft {
  name: string;
  body: string;
  folderName: string | null;
  language: string | null;
}

export interface LabelSuggestApi {
  /**
   * Suggest labels for a draft. Returns an empty list when the draft is too
   * thin to judge — that is an answer, not a failure.
   */
  suggestForSnippet(
    draft: SnippetDraft,
    catalog: readonly Label[],
    assigned: readonly string[],
  ): Promise<LabelSuggestion[]>;
}

/**
 * Turn an edge-function failure into a sentence a user can act on. The
 * function distinguishes "not wired up yet" from "the model call failed", and
 * those need different responses from whoever sees them.
 */
function suggestError(detail: string | undefined): Error {
  if (detail?.includes('anthropic_not_configured')) {
    return new Error('AI suggestions are not configured yet.');
  }
  if (detail?.includes('anthropic_bad_output')) {
    return new Error('The suggestion came back unreadable. Try again.');
  }
  return new Error('Could not reach the suggestion service. Try again.');
}

export const labelSuggestApi: LabelSuggestApi = {
  async suggestForSnippet(draft, catalog, assigned) {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      suggestions: RawSuggestion[];
    }>(EDGE_FN_SUGGEST_LABELS, {
      body: {
        name: draft.name,
        body: draft.body,
        folder_name: draft.folderName,
        language: draft.language,
      },
    });

    if (error) throw suggestError(error.message);
    if (!data?.ok) throw suggestError(undefined);

    return reconcileSuggestions(data.suggestions ?? [], catalog, assigned);
  },
};
