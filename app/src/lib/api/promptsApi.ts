import { supabase } from '@/lib/supabase';
import type { Prompt, PromptBlock, StrategyType, ThinkingMode, PreferredModel, ComplexityLevel, IntentCategory, OutputType } from '@/types/database';
import type { PromptFormValues } from '@/types/schemas';

export interface PromptsApi {
  listPrompts(): Promise<Prompt[]>;
  createPrompt(payload: PromptFormValues): Promise<Prompt>;
  updatePrompt(id: string, patch: Partial<PromptFormValues>) : Promise<Prompt>;
  deletePrompt(id: string): Promise<void>;
  /** Toggle the pinned flag without touching other fields. */
  setPinned(id: string, pinned: boolean): Promise<Prompt>;
  /** Atomically counts one execution; returns the authoritative new total. */
  markUsed(id: string): Promise<{ usage_count: number; last_used_at: string }>;
  /** Push prompt to the team Notion DB via Edge Function; writes notion_page_id back. */
  pushToNotion(id: string): Promise<{ notion_page_id: string }>;
}

const EDGE_FN_PROMPT_PUSH = 'notion-prompt-push';

type DbPrompt = {
  id: string;
  user_id: string;
  name: string;
  content: string;
  shortcut: string | null;
  type: 'one-shot' | 'few-shot';
  strategy_type: string | null;
  thinking_mode: string | null;
  preferred_model: string | null;
  complexity_level: string | null;
  intent_category: string | null;
  output_type: string | null;
  blocks: PromptBlock[] | null;
  folder_id: string | null;
  notion_page_id: string | null;
  pinned: boolean | null;
  updated_at: string;
  updated_by: string | null;
  last_used_at: string | null;
  usage_count: number | null;
  is_malformed: boolean | null;
};

const PROMPT_SELECT = [
  'id', 'user_id', 'name', 'content', 'shortcut', 'type',
  'strategy_type', 'thinking_mode', 'preferred_model', 'complexity_level',
  'intent_category', 'output_type', 'blocks',
  'folder_id', 'notion_page_id', 'pinned', 'updated_at', 'updated_by', 'last_used_at',
  'usage_count', 'is_malformed',
].join(', ');

function dbPromptToPrompt(row: DbPrompt): Prompt {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    content: row.content,
    shortcut: row.shortcut ?? null,
    type: row.type,
    strategy_type: (row.strategy_type as StrategyType) ?? null,
    thinking_mode: (row.thinking_mode as ThinkingMode) ?? null,
    preferred_model: (row.preferred_model as PreferredModel) ?? null,
    complexity_level: (row.complexity_level as ComplexityLevel) ?? null,
    intent_category: (row.intent_category as IntentCategory) ?? null,
    output_type: (row.output_type as OutputType) ?? null,
    blocks: row.blocks ?? null,
    folder_id: row.folder_id ?? null,
    notion_page_id: row.notion_page_id ?? null,
    pinned: row.pinned ?? false,
    updated_at: row.updated_at,
    updated_by: row.updated_by ?? null,
    last_used_at: row.last_used_at,
    usage_count: row.usage_count ?? 0,
    is_malformed: row.is_malformed ?? false,
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('Not authenticated');
  return data.user.id;
}

export const promptsApi: PromptsApi = {
  async listPrompts() {
    // No `.eq('user_id')` filter: RLS returns the user's own prompts plus any
    // that live in a folder shared with them (Phase B). Personal-only users see
    // exactly what they did before. Mirrors snippetsApi.listSnippets.
    const { data, error } = await supabase
      .from('prompts')
      .select(PROMPT_SELECT)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as unknown as DbPrompt[]).map(dbPromptToPrompt);
  },

  async createPrompt(payload) {
    const userId = await currentUserId();
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('prompts')
      .insert({
        user_id: userId,
        name: payload.name,
        content: payload.content,
        shortcut: payload.shortcut?.trim() || null,
        type: payload.type,
        strategy_type: payload.strategy_type ?? null,
        thinking_mode: payload.thinking_mode ?? null,
        preferred_model: payload.preferred_model ?? null,
        complexity_level: payload.complexity_level ?? null,
        intent_category: payload.intent_category ?? null,
        output_type: payload.output_type ?? null,
        blocks: payload.blocks ?? null,
        folder_id: payload.folder_id ?? null,
        updated_at: now,
      })
      .select(PROMPT_SELECT)
      .single();
    if (error) throw error;
    return dbPromptToPrompt(data as unknown as DbPrompt);
  },

  async updatePrompt(id, patch) {
    const userId = await currentUserId();
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) update['name'] = patch.name;
    if (patch.content !== undefined) update['content'] = patch.content;
    if ('shortcut' in patch) update['shortcut'] = patch.shortcut?.trim() || null;
    if (patch.type !== undefined) update['type'] = patch.type;
    if ('strategy_type' in patch) update['strategy_type'] = patch.strategy_type ?? null;
    if ('thinking_mode' in patch) update['thinking_mode'] = patch.thinking_mode ?? null;
    if ('preferred_model' in patch) update['preferred_model'] = patch.preferred_model ?? null;
    if ('complexity_level' in patch) update['complexity_level'] = patch.complexity_level ?? null;
    if ('intent_category' in patch) update['intent_category'] = patch.intent_category ?? null;
    if ('output_type' in patch) update['output_type'] = patch.output_type ?? null;
    if ('blocks' in patch) update['blocks'] = patch.blocks ?? null;
    if ('folder_id' in patch) update['folder_id'] = patch.folder_id ?? null;

    const { data, error } = await supabase
      .from('prompts')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
      .select(PROMPT_SELECT)
      .single();
    if (error) throw error;
    return dbPromptToPrompt(data as unknown as DbPrompt);
  },

  async deletePrompt(id) {
    const userId = await currentUserId();
    const { error } = await supabase
      .from('prompts')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    if (error) throw error;
  },

  async setPinned(id, pinned) {
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('prompts')
      .update({ pinned })
      .eq('id', id)
      .eq('user_id', userId)
      .select(PROMPT_SELECT)
      .single();
    if (error) throw error;
    return dbPromptToPrompt(data as unknown as DbPrompt);
  },

  async markUsed(id) {
    // Atomic: a read-modify-write from the client drops increments whenever the
    // same prompt is used from two surfaces at once. The RPC does it in one
    // UPDATE and stamps last_used_at in the same statement. SECURITY INVOKER,
    // so RLS gates it exactly as the plain update it replaces did — including
    // the shared-folder branch, which the old `.eq('user_id')` filter silently
    // excluded for teammates.
    const { data, error } = await supabase
      .rpc('increment_prompt_usage', { p_prompt_id: id })
      .select('id, usage_count, last_used_at')
      .maybeSingle<{ id: string; usage_count: number; last_used_at: string }>();
    if (error) throw error;
    if (!data) throw new Error('Prompt not found, or you do not have access to it');
    return { usage_count: data.usage_count, last_used_at: data.last_used_at };
  },

  async pushToNotion(id) {
    const { data, error } = await supabase.functions.invoke<{
      ok: boolean;
      notion_page_id: string;
    }>(EDGE_FN_PROMPT_PUSH, { body: { prompt_id: id } });
    if (error) throw error;
    if (!data?.ok || !data.notion_page_id) {
      throw new Error('notion-prompt-push returned unexpected response');
    }
    return { notion_page_id: data.notion_page_id };
  },
};
