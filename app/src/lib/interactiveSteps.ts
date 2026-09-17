/**
 * "Interactive Steps": a device setting that starts a copied prompt with
 * instructions to work one step at a time and wait between steps.
 *
 * The extension, Sprintbrain.html and mobile run
 * extension/shared/interactive-steps.js. The dashboard cannot load extension
 * code, so this is its copy, and scripts/check-interactive-steps.js runs both
 * over the same cases and fails when they differ.
 *
 * The key is shared with Sprintbrain.html and mobile, which are served from the
 * same origin, so one browser keeps one setting across the three.
 */

export const INTERACTIVE_STEPS_KEY = 'sb_interactive_steps_enabled';

const OPEN = '<INTERACTIVE_STEPS>';

export const INTERACTIVE_STEPS_BLOCK = [
  OPEN,
  'Work through this task with me one step at a time.',
  '1. Start by listing the steps you plan to take, one short line each, and ask me to confirm the plan.',
  '2. Then complete one step per reply. Show the result of that step and stop.',
  '3. End each reply with one short question: continue, change something, or skip ahead.',
  '4. Wait for my answer before you start the next step. Apply any change I ask for first.',
  '5. After the last step, give me the complete final result in one piece.',
  'If this prompt also asks you to ask me clarifying questions, ask them before you list the steps.',
  '</INTERACTIVE_STEPS>',
].join('\n');

/**
 * The text a prompt hands out: the block, a blank line, then the prompt. An
 * empty prompt stays empty, and a prompt that already opens with the block is
 * left alone, so the same text never carries it twice.
 */
export function applyInteractiveSteps(text: string, on: boolean): string {
  if (!on || !text.trim()) return text;
  if (text.replace(/^\s+/, '').startsWith(OPEN)) return text;
  return `${INTERACTIVE_STEPS_BLOCK}\n\n${text}`;
}

/** Off unless this browser has stored an explicit "on". */
export function loadInteractiveSteps(): boolean {
  try {
    return window.localStorage.getItem(INTERACTIVE_STEPS_KEY) === 'true';
  } catch (err) {
    console.error('Interactive Steps: could not read the setting on this device:', err);
    return false;
  }
}

/** False when the browser refused the write, so the caller can say so. */
export function saveInteractiveSteps(on: boolean): boolean {
  try {
    window.localStorage.setItem(INTERACTIVE_STEPS_KEY, on ? 'true' : 'false');
    return true;
  } catch (err) {
    console.error('Interactive Steps: could not save the setting on this device:', err);
    return false;
  }
}
