/**
 * Assembles enabled prompt blocks into a plain-text prompt string.
 * Block headers follow the ## Markdown convention used by Claude.
 */
export function assembleBlocks(
  blocks: Array<{ type: string; content: string; enabled: boolean }>,
): string {
  return blocks
    .filter((b) => b.enabled && b.content.trim())
    .map(
      (b) =>
        `## ${b.type.charAt(0).toUpperCase()}${b.type.slice(1)}\n${b.content.trim()}`,
    )
    .join('\n\n');
}
