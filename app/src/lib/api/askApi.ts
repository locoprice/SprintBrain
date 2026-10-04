import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import {
  feedbackSources,
  parseAskResponse,
  type AskResult,
  type AskSource,
  type AskVerdict,
  type FeedbackSource,
} from '@/lib/askKnowledge';

// Ask SprintBrain (AI-KNOWLEDGE P1).
//
// `ask` calls the ask-sprintbrain edge function, which searches and reads as the
// signed-in user and answers only from what it found. Feedback is a row in
// knowledge_feedback that someone reviews; it never edits a source.

const EDGE_FN_ASK = 'ask-sprintbrain';

const ASK_ERRORS: Record<string, string> = {
  anthropic_not_configured: 'Ask SprintBrain is not set up yet.',
  anthropic_request_failed: 'The answer service did not respond. Try again.',
  anthropic_bad_output: 'The answer came back unreadable. Try again.',
  question_too_short: 'Write a few more words.',
  question_too_long: 'Shorten the question to 1,000 characters or fewer.',
  search_failed: 'Could not search your SprintBrain. Try again.',
  sources_read_failed: 'Could not read the matching items. Try again.',
  unauthorized: 'Your session has expired. Sign in again.',
};

const ASK_FALLBACK = 'Could not reach Ask SprintBrain. Try again.';

/** supabase-js leaves `message` generic and puts the failed Response on `context`. */
async function readErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return '';
  try {
    const body = (await context.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}

export interface FeedbackInput {
  question: string;
  answer: string;
  verdict: AskVerdict;
  sources: readonly AskSource[];
  /** The team the feedback is filed under, so its admins see it. Null for personal. */
  organizationId: string | null;
}

export interface FeedbackRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  question: string;
  answer: string;
  verdict: string;
  sources: FeedbackSource[];
  status: 'open' | 'resolved';
  created_at: string;
  resolved_at: string | null;
}

export interface AskApi {
  ask(question: string): Promise<AskResult>;
  sendFeedback(input: FeedbackInput): Promise<void>;
  /** Your own feedback, plus your team's when you are its admin. RLS decides. */
  listFeedback(status: 'open' | 'resolved'): Promise<FeedbackRow[]>;
  setFeedbackStatus(id: string, status: 'open' | 'resolved'): Promise<void>;
}

const FEEDBACK_COLUMNS =
  'id, user_id, organization_id, question, answer, verdict, sources, status, created_at, resolved_at';

export const askApi: AskApi = {
  async ask(question) {
    const { data, error } = await supabase.functions.invoke<unknown>(EDGE_FN_ASK, {
      body: { question },
    });
    if (error) {
      const code = await readErrorCode(error);
      throw new Error(ASK_ERRORS[code] ?? ASK_FALLBACK);
    }
    const result = parseAskResponse(data);
    if (!result) throw new Error(ASK_FALLBACK);
    return result;
  },

  async sendFeedback(input) {
    const { error } = await supabase.from('knowledge_feedback').insert({
      question: input.question.slice(0, 1000),
      answer: input.answer.slice(0, 8000),
      verdict: input.verdict,
      sources: feedbackSources(input.sources),
      organization_id: input.organizationId,
    });
    if (error) throw toApiError(error);
  },

  async listFeedback(status) {
    const { data, error } = await supabase
      .from('knowledge_feedback')
      .select(FEEDBACK_COLUMNS)
      .eq('status', status)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw toApiError(error);
    return (data ?? []) as FeedbackRow[];
  },

  async setFeedbackStatus(id, status) {
    const { data, error } = await supabase
      .from('knowledge_feedback')
      .update({ status })
      .eq('id', id)
      .select('id');
    if (error) throw toApiError(error);
    if (!data || data.length === 0) {
      throw new Error("That feedback no longer exists, or you don't have access to it.");
    }
  },
};
