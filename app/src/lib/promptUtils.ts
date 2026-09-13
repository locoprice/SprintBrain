/**
 * Closing section for a prompt with "Ask User Questions" on. It comes last so
 * the model reads the whole task before it decides what to ask.
 */
export const ASK_USER_QUESTIONS_SECTION =
  '## Questions\nBefore you start, ask me clarifying questions about anything you need to know to do this task well.\nAsk one question at a time and wait for my answer, so I can respond easily.\nAsk no more than 5 questions in total.\nOnce you have enough information, ask me to confirm before you give the final result.';

export interface AssembleOptions {
  /** End the prompt with ASK_USER_QUESTIONS_SECTION. */
  askUserQuestions?: boolean;
}

/**
 * Assembles enabled prompt blocks into a plain-text prompt string.
 * Block headers follow the ## Markdown convention used by Claude.
 */
export function assembleBlocks(
  blocks: Array<{ type: string; content: string; enabled: boolean }>,
  options: AssembleOptions = {},
): string {
  const assembled = blocks
    .filter((b) => b.enabled && b.content.trim())
    .map(
      (b) =>
        `## ${b.type.charAt(0).toUpperCase()}${b.type.slice(1)}\n${b.content.trim()}`,
    )
    .join('\n\n');
  // An empty prompt stays empty: with no task written there is nothing to ask
  // about, and the editor's empty-draft states depend on ''.
  if (!assembled || !options.askUserQuestions) return assembled;
  return `${assembled}\n\n${ASK_USER_QUESTIONS_SECTION}`;
}
