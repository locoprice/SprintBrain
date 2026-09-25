import type { MemoryItemKind } from '@/types/database';

/** How an item's kind reads on its card and in the trash. */
export const KIND_LABEL: Record<MemoryItemKind, string> = {
  fact: 'Fact',
  note: 'Note',
  document: 'Document',
  conversation: 'Conversation',
};
