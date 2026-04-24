import { supabase } from '@/lib/supabase';
import type { Prompt } from '@/types/database';
import type { PromptFormValues } from '@/types/schemas';

export interface PromptsApi {
  listPrompts(): Promise<Prompt[]>;
  createPrompt(payload: PromptFormValues): Promise<Prompt>;
  updatePrompt(id: string, patch: Partial<PromptFormValues>): Promise<Prompt>;
  deletePrompt(id: string): Promise<void>;
}

type DbPrompt = {
  id: string;
  user_id: string;
  name: string;
  content: string;
  type: 'one-shot' | 'few-shot';
  tags: string[] | null;
  updated_at: string;
  last_used_at: string | null;
};

const PROMPT_SELECT = 'id, user_id, name, content, type, tags, updated_at, last_used_at';

function dbPromptToPrompt(row: DbPrompt): Prompt {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    content: row.content,
    type: row.type,
    tags: row.tags ?? [],
    updated_at: row.updated_at,
    last_used_at: row.last_used_at,
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
    const userId = await currentUserId();
    const { data, error } = await supabase
      .from('prompts')
      .select(PROMPT_SELECT)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return ((data ?? []) as DbPrompt[]).map(dbPromptToPrompt);
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
        type: payload.type,
        tags: payload.tags,
        updated_at: now,
      })
      .select(PROMPT_SELECT)
      .single();
    if (error) throw error;
    return dbPromptToPrompt(data as DbPrompt);
  },

  async updatePrompt(id, patch) {
    const userId = await currentUserId();
    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (patch.name !== undefined) update['name'] = patch.name;
    if (patch.content !== undefined) update['content'] = patch.content;
    if (patch.type !== undefined) update['type'] = patch.type;
    if (patch.tags !== undefined) update['tags'] = patch.tags;

    const { data, error } = await supabase
      .from('prompts')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
      .select(PROMPT_SELECT)
      .single();
    if (error) throw error;
    return dbPromptToPrompt(data as DbPrompt);
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
};
