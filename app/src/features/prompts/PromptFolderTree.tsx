import { useMemo } from 'react';
import { FolderTree } from '@/features/org/FolderTree';
import { usePromptStore } from '@/stores/promptStore';

/** Prompt-page folder rail: wires the shared FolderTree to the prompt store. */
export function PromptFolderTree() {
  const folders = usePromptStore((s) => s.folders);
  const folderShares = usePromptStore((s) => s.folderShares);
  const prompts = usePromptStore((s) => s.prompts);
  const selected = usePromptStore((s) => s.selectedFolderId);
  const setSelected = usePromptStore((s) => s.setSelectedFolder);
  const addFolder = usePromptStore((s) => s.addFolder);
  const editFolder = usePromptStore((s) => s.editFolder);
  const removeFolder = usePromptStore((s) => s.removeFolder);
  const reload = usePromptStore((s) => s.load);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of prompts) {
      if (p.folder_id) m.set(p.folder_id, (m.get(p.folder_id) ?? 0) + 1);
    }
    return m;
  }, [prompts]);

  return (
    <FolderTree
      folders={folders}
      folderShares={folderShares}
      selectedFolderId={selected}
      onSelect={setSelected}
      itemCounts={counts}
      totalCount={prompts.length}
      allLabel="All prompts"
      itemNoun="prompt"
      addFolder={addFolder}
      editFolder={editFolder}
      removeFolder={removeFolder}
      onShared={reload}
      className="w-[240px] overflow-y-auto border-r border-line bg-bg-alt px-3 py-5"
    />
  );
}
