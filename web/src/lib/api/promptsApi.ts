import type { Prompt } from '@/types/database';
import { mockPrompts } from '@/mock/fixtures';
import { delay } from './_delay';

export interface PromptsApi {
  listPrompts(): Promise<Prompt[]>;
}

export const promptsApi: PromptsApi = {
  listPrompts: () => delay(mockPrompts),
};
