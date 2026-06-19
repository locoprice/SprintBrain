import { useMemo } from 'react';
import { FolderTree } from '@/features/org/FolderTree';
import { useSnippetStore } from '@/stores/snippetStore';

/** Snippet-page folder rail: wires the shared FolderTree to the snippet store. */
export function SnippetFolderTree() {
  const folders = useSnippetStore((s) => s.folders);
  const folderShares = useSnippetStore((s) => s.folderShares);
  const snippets = useSnippetStore((s) => s.snippets);
  const selected = useSnippetStore((s) => s.selectedFolderId);
  const setSelected = useSnippetStore((s) => s.setSelectedFolder);
  const addFolder = useSnippetStore((s) => s.addFolder);
  const editFolder = useSnippetStore((s) => s.editFolder);
  const removeFolder = useSnippetStore((s) => s.removeFolder);
  const reload = useSnippetStore((s) => s.load);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of snippets) {
      if (s.folder_id) m.set(s.folder_id, (m.get(s.folder_id) ?? 0) + 1);
    }
    return m;
  }, [snippets]);

  return (
    <FolderTree
      folders={folders}
      folderShares={folderShares}
      selectedFolderId={selected}
      onSelect={setSelected}
      itemCounts={counts}
      totalCount={snippets.length}
      allLabel="All snippets"
      itemNoun="snippet"
      addFolder={addFolder}
      editFolder={editFolder}
      removeFolder={removeFolder}
      onShared={reload}
    />
  );
}
