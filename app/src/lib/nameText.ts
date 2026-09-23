/**
 * Names of snippets, prompts and memory items are read back as plain text
 * everywhere else: the extension picker, the popup list, the mobile rows, the
 * MCP index. Each lays the name out in a fixed-height line that a pictograph
 * breaks. Emoji and the joiners, keycaps, flags and skin tones that build them
 * are dropped as they are typed or pasted. Letters in any script, upper and
 * lower case, digits, spaces and punctuation pass through.
 */
const NAME_EMOJI =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u{FE0F}\u{20E3}\u{200D}]/gu;

export function sanitizeName(value: string): string {
  return value.replace(NAME_EMOJI, '');
}
