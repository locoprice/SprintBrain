import { beforeEach, describe, expect, it, vi } from 'vitest';

// "Ask User Questions" (prompts.ask_user_questions). The instruction lives in
// the saved content because content is what every surface pastes: the in-page
// picker, the popup, Sprintbrain.html, mobile and the Notion mirror. These
// tests pin both halves: how content is assembled, and that the flag travels
// to and from the database.

const sb = vi.hoisted(() => {
  interface Builder {
    select: (columns: string) => Builder;
    insert: (values: Record<string, unknown>) => Builder;
    update: (values: Record<string, unknown>) => Builder;
    eq: (column: string, value: unknown) => Builder;
    single: () => Promise<{ data: Record<string, unknown>; error: null }>;
  }
  const state = {
    select: '',
    insert: null as Record<string, unknown> | null,
    update: null as Record<string, unknown> | null,
    row: {} as Record<string, unknown>,
  };
  function from(): Builder {
    const b: Builder = {
      select: (columns) => {
        state.select = columns;
        return b;
      },
      insert: (values) => {
        state.insert = values;
        return b;
      },
      update: (values) => {
        state.update = values;
        return b;
      },
      eq: () => b,
      single: () => Promise.resolve({ data: state.row, error: null }),
    };
    return b;
  }
  return { state, from };
});

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => sb.from(),
  },
}));

import { promptsApi } from '@/lib/api/promptsApi';
import { ASK_USER_QUESTIONS_SECTION, assembleBlocks } from '@/lib/promptUtils';
import type { PromptBlock } from '@/types/database';
import type { PromptFormValues } from '@/types/schemas';

const BLOCKS: PromptBlock[] = [
  { type: 'role', content: 'You are an editor.', enabled: true },
  { type: 'objective', content: 'Tighten this paragraph.', enabled: true },
  { type: 'context', content: 'Ignored while disabled.', enabled: false },
];

const WITHOUT_QUESTIONS = '## Role\nYou are an editor.\n\n## Objective\nTighten this paragraph.';

describe('assembleBlocks: Ask User Questions', () => {
  it('leaves the prompt unchanged when the option is off or omitted', () => {
    expect(assembleBlocks(BLOCKS)).toBe(WITHOUT_QUESTIONS);
    expect(assembleBlocks(BLOCKS, { askUserQuestions: false })).toBe(WITHOUT_QUESTIONS);
  });

  it('ends the prompt with the questions section when on', () => {
    expect(assembleBlocks(BLOCKS, { askUserQuestions: true })).toBe(
      `${WITHOUT_QUESTIONS}\n\n${ASK_USER_QUESTIONS_SECTION}`,
    );
  });

  it('keeps an empty prompt empty, so there is nothing to paste', () => {
    const empty: PromptBlock[] = [
      { type: 'role', content: '   ', enabled: true },
      { type: 'context', content: 'Written but disabled.', enabled: false },
    ];
    expect(assembleBlocks(empty, { askUserQuestions: true })).toBe('');
  });

  it('tells the AI to ask one question at a time and confirm before the result', () => {
    expect(ASK_USER_QUESTIONS_SECTION.startsWith('## Questions\n')).toBe(true);
    expect(ASK_USER_QUESTIONS_SECTION).toContain('ask me clarifying questions');
    expect(ASK_USER_QUESTIONS_SECTION).toContain('one question at a time');
    expect(ASK_USER_QUESTIONS_SECTION).toContain('no more than 5 questions');
    expect(ASK_USER_QUESTIONS_SECTION).toContain('ask me to confirm before you give the final result');
  });
});

const PAYLOAD: PromptFormValues = {
  name: 'Tighten a paragraph',
  content: assembleBlocks(BLOCKS, { askUserQuestions: true }),
  shortcut: '',
  type: 'one-shot',
  strategy_type: null,
  thinking_mode: null,
  preferred_model: null,
  complexity_level: null,
  intent_category: null,
  output_type: null,
  blocks: BLOCKS,
  ask_user_questions: true,
  folder_id: null,
};

describe('promptsApi: ask_user_questions round trip', () => {
  beforeEach(() => {
    sb.state.select = '';
    sb.state.insert = null;
    sb.state.update = null;
    sb.state.row = {
      id: 'prompt-1',
      user_id: 'user-1',
      name: PAYLOAD.name,
      content: PAYLOAD.content,
      type: 'one-shot',
      blocks: BLOCKS,
      ask_user_questions: true,
    };
  });

  it('creates a prompt with the flag and the instruction in its content', async () => {
    const created = await promptsApi.createPrompt(PAYLOAD);
    expect(sb.state.insert).toMatchObject({ ask_user_questions: true, content: PAYLOAD.content });
    expect(String(sb.state.insert?.['content'])).toContain(ASK_USER_QUESTIONS_SECTION);
    expect(sb.state.select.split(', ')).toContain('ask_user_questions');
    expect(created.ask_user_questions).toBe(true);
  });

  it('saves the flag when an edit changes it', async () => {
    await promptsApi.updatePrompt('prompt-1', {
      ask_user_questions: false,
      content: assembleBlocks(BLOCKS),
    });
    expect(sb.state.update).toMatchObject({ ask_user_questions: false, content: WITHOUT_QUESTIONS });
  });

  it('leaves the flag alone when an edit does not mention it', async () => {
    await promptsApi.updatePrompt('prompt-1', { name: 'Renamed' });
    expect(sb.state.update).not.toHaveProperty('ask_user_questions');
  });
});
