import type { Folder, SnippetRow } from '@/types/database';
import { mockFolders, mockSnippets, usageBySnippetId } from '@/mock/fixtures';
import { delay } from './_delay';

// Service contract that the follow-up Supabase ticket must implement
// without changing any caller in the UI.
export interface SnippetsApi {
  listFolders(): Promise<Folder[]>;
  listSnippets(): Promise<SnippetRow[]>;
}

function joinSnippetRows(): SnippetRow[] {
  const folderById = new Map(mockFolders.map((f) => [f.id, f]));
  return mockSnippets.map((s) => ({
    ...s,
    folder_name: s.folder_id ? (folderById.get(s.folder_id)?.name ?? null) : null,
    usage_count: usageBySnippetId[s.id] ?? 0,
  }));
}

export const snippetsApi: SnippetsApi = {
  listFolders: () => delay(mockFolders),
  listSnippets: () => delay(joinSnippetRows()),
};
