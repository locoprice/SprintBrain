import { describe, expect, it } from 'vitest';
import { visiblePromptFolders } from '@/features/prompts/PromptFilters';
import type { Folder, Prompt } from '@/types/database';

function makeFolder(id: string, name: string): Folder {
  return {
    id,
    user_id: 'user-1',
    name,
    icon: 'folder',
    sort_order: 1,
    updated_at: '2026-07-12T00:00:00Z',
  };
}

const PROMPT: Prompt = {
  id: 'prompt-1',
  user_id: 'user-1',
  name: 'Confirmation',
  content: 'hello',
  shortcut: null,
  type: 'one-shot',
  tags: [],
  strategy_type: null,
  thinking_mode: null,
  preferred_model: null,
  complexity_level: null,
  execution_type: null,
  intent_category: null,
  output_type: null,
  blocks: null,
  folder_id: 'folder-prompts',
  notion_page_id: null,
  updated_at: '2026-07-12T00:00:00Z',
  updated_by: 'user-1',
  last_used_at: null,
};

const PROMPT_FOLDER = makeFolder('folder-prompts', 'TEAM SHARED');
const SNIPPET_FOLDER = makeFolder('folder-snippets', 'PRESUPUESTOS');

describe('visiblePromptFolders — chip visibility rule', () => {
  it('keeps only folders that hold prompts; snippet-only folders drop out', () => {
    const visible = visiblePromptFolders([PROMPT_FOLDER, SNIPPET_FOLDER], [PROMPT], null);

    expect(visible).toHaveLength(1);
    expect(visible[0]!.folder.id).toBe('folder-prompts');
    expect(visible[0]!.count).toBe(1);
  });

  it('keeps the selected folder visible even when it holds no prompts', () => {
    const visible = visiblePromptFolders(
      [PROMPT_FOLDER, SNIPPET_FOLDER],
      [PROMPT],
      'folder-snippets',
    );

    expect(visible.map((v) => v.folder.id)).toEqual(['folder-prompts', 'folder-snippets']);
    expect(visible[1]!.count).toBe(0);
  });

  it('returns no folders when no prompt is foldered', () => {
    const unfiled: Prompt = { ...PROMPT, folder_id: null };

    expect(visiblePromptFolders([SNIPPET_FOLDER], [unfiled], null)).toEqual([]);
  });
});
