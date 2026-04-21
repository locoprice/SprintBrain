import type { Prompt } from '@/types/database';
import { mockPrompts } from '@/mock/fixtures';
import { delay } from './_delay';

// TODO (PROMPTS-001): wire to Supabase.
//
// The Supabase schema does not yet contain a `prompts` table — prompts
// were historically managed inside the Chrome extension only. Until that
// table is created and populated, the Prompts page reads deterministic
// seed data from `mockPrompts`. Plan:
//   1. Create `public.prompts` migration (mirrors the Prompt interface).
//   2. Add RLS (`auth.uid() = user_id`) + team_* for anon.
//   3. Backfill Alex's extension-stored prompts into the table.
//   4. Replace this file with supabase.from('prompts').select(...).

export interface PromptsApi {
  listPrompts(): Promise<Prompt[]>;
}

export const promptsApi: PromptsApi = {
  listPrompts: () => delay(mockPrompts),
};
