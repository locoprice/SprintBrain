import { supabase } from '@/lib/supabase';
import { readEdgeErrorCode } from '@/lib/api/edgeFunctionError';
import { parseDraftResponse, type DraftKind, type DraftResult } from '@/lib/aiDraft';

// Draft with AI (AI-KNOWLEDGE P3).
//
// Calls the draft-with-ai edge function. It returns a proposal only; nothing is
// saved until the person saves it in the editor.

const EDGE_FN_DRAFT = 'draft-with-ai';

const DRAFT_ERRORS: Record<string, string> = {
  anthropic_not_configured: 'Draft with AI is not set up yet.',
  anthropic_request_failed: 'The drafting service did not respond. Try again.',
  anthropic_bad_output: 'The draft came back unreadable. Try again.',
  draft_refused: 'The AI declined to draft from this text.',
  draft_empty: 'The AI found nothing to draft in this text.',
  draft_too_long: 'The updated text would be longer than one Brain item can hold.',
  target_not_found: "That item no longer exists, or you don't have access to it.",
  target_read_failed: 'Could not read that item. Try again.',
  text_too_short: 'Paste a little more text: at least 20 characters.',
  text_too_long: 'Paste 20,000 characters or fewer.',
  unauthorized: 'Your session has expired. Sign in again.',
};

const DRAFT_FALLBACK = 'Could not reach Draft with AI. Try again.';

export interface DraftRequest {
  kind: DraftKind;
  text: string;
  /** Folder names the draft may file a new snippet or prompt under. */
  folders?: readonly string[];
  /** Label names the draft may tag a new snippet or prompt with. */
  labels?: readonly string[];
  /** Set to update this existing item with the text instead of drafting a new one. */
  targetId?: string;
}

export interface DraftApi {
  draft(request: DraftRequest): Promise<DraftResult>;
}

export const draftApi: DraftApi = {
  async draft(request) {
    const { data, error } = await supabase.functions.invoke<unknown>(EDGE_FN_DRAFT, {
      body: {
        kind: request.kind,
        text: request.text,
        folders: request.folders ?? [],
        labels: request.labels ?? [],
        ...(request.targetId ? { target_id: request.targetId } : {}),
      },
    });
    if (error) {
      const code = await readEdgeErrorCode(error);
      throw new Error(DRAFT_ERRORS[code] ?? DRAFT_FALLBACK);
    }
    const result = parseDraftResponse(request.kind, data);
    if (!result) throw new Error(DRAFT_FALLBACK);
    return result;
  },
};
