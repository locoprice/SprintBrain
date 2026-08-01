import { ChevronRight } from 'lucide-react';
import { ancestorsOf } from '@/lib/folderTree';
import type { Folder } from '@/types/database';

interface FolderBreadcrumbProps {
  folders: Folder[];
  /** The folder currently in view. Its own name lives in the page title. */
  folderId: string;
  /** Jump to an ancestor folder. */
  onNavigate: (id: string) => void;
}

/**
 * Ancestor trail above the page title, e.g. "ACCOMMODATIONS ›" over
 * "Apartamentos del Rey". Without it a subfolder's title reads like a top-level
 * one and you cannot tell where you are, or get back up in one click.
 *
 * Renders nothing for a root folder — there is no trail to show.
 * The current folder is deliberately omitted: it is the <h1> right below.
 */
export function FolderBreadcrumb({ folders, folderId, onNavigate }: FolderBreadcrumbProps) {
  // ancestorsOf is nearest-first; the trail reads root-first.
  const trail = ancestorsOf(folders, folderId).slice().reverse();
  if (trail.length === 0) return null;

  return (
    <nav aria-label="Folder path" className="flex min-w-0 items-center gap-0.5 text-xs">
      {trail.map((folder) => (
        <span key={folder.id} className="flex min-w-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onNavigate(folder.id)}
            className="max-w-[220px] truncate rounded-[6px] px-1 py-0.5 font-medium text-ink-subtle transition-colors hover:bg-bg-alt hover:text-ink"
          >
            {folder.name}
          </button>
          <ChevronRight className="h-3 w-3 shrink-0 text-ink-subtle" aria-hidden="true" />
        </span>
      ))}
    </nav>
  );
}
