import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { DEFAULT_FOLDER_ICON, FOLDER_ICON_KEYS, FolderIcon } from '@/lib/folderIcons';
import { canMoveFolder, canNestUnder, folderPath } from '@/lib/folderTree';
import type { Folder } from '@/types/database';
import { folderFormSchema, type FolderFormValues } from '@/types/schemas';

const DEFAULT_FORM: FolderFormValues = {
  name: '',
  icon: DEFAULT_FOLDER_ICON,
  parent_id: null,
};

type FieldErrors = Partial<Record<keyof FolderFormValues, string>>;

/**
 * Open target:
 *   'new'                → create at root
 *   { parentId: id }     → create nested under `id`
 *   a folder id (string) → edit that folder
 *   null                 → closed
 */
export type FolderDialogTarget = 'new' | { parentId: string } | string | null;

function isEditTarget(target: FolderDialogTarget): target is string {
  return typeof target === 'string' && target !== 'new';
}

interface FolderDialogProps {
  target: FolderDialogTarget;
  onClose: () => void;
  folders: Folder[];
  addFolder: (payload: FolderFormValues) => Promise<Folder>;
  editFolder: (id: string, patch: Partial<FolderFormValues>) => Promise<Folder>;
  removeFolder: (id: string) => Promise<void>;
  /** Items (snippets or prompts) currently inside the given folder. */
  countFor: (folderId: string) => number;
  /** Singular noun for copy, e.g. "snippet" / "prompt". */
  itemNoun: string;
  /** "All …" destination label items move to on delete, e.g. "All prompts". */
  allLabel: string;
}

/**
 * Create/edit folder dialog. Store-agnostic: the host passes the folder list and
 * the add/edit/remove actions (snippet store or prompt store), so the same
 * dialog drives both surfaces.
 */
export function FolderDialog({
  target,
  onClose,
  folders,
  addFolder,
  editFolder,
  removeFolder,
  countFor,
  itemNoun,
  allLabel,
}: FolderDialogProps) {
  const isEdit = isEditTarget(target);
  const editingFolder = useMemo(
    () => (isEdit ? folders.find((f) => f.id === target) ?? null : null),
    [isEdit, target, folders],
  );
  const open = target !== null;

  // Parents this folder may sit under. Creating: anything with room below it.
  // Editing: exclude the folder's own subtree and anything too deep for it.
  const parentOptions = useMemo(() => {
    const candidates = folders.filter((f) =>
      editingFolder ? canMoveFolder(folders, editingFolder.id, f.id) : canNestUnder(folders, f.id),
    );
    return candidates
      .map((f) => ({ id: f.id, label: folderPath(folders, f.id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [folders, editingFolder]);

  const affectedCount = editingFolder ? countFor(editingFolder.id) : 0;
  const childCount = editingFolder
    ? folders.filter((f) => f.parent_id === editingFolder.id).length
    : 0;

  const [form, setForm] = useState<FolderFormValues>(DEFAULT_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    setConfirmDelete(false);
    if (editingFolder) {
      setForm({
        name: editingFolder.name,
        icon: editingFolder.icon || DEFAULT_FORM.icon,
        parent_id: editingFolder.parent_id,
      });
    } else {
      setForm({
        ...DEFAULT_FORM,
        parent_id: typeof target === 'object' && target !== null ? target.parentId : null,
      });
    }
  }, [open, editingFolder, target]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );

  function updateField<K extends keyof FolderFormValues>(key: K, value: FolderFormValues[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    const parsed = folderFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof FolderFormValues | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setSaving(true);
    try {
      if (editingFolder) {
        await editFolder(editingFolder.id, parsed.data);
      } else {
        await addFolder(parsed.data);
      }
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingFolder) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      await removeFolder(editingFolder.id);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingFolder ? 'Edit folder' : 'New folder'}</DialogTitle>
          <DialogDescription>
            {editingFolder
              ? 'Rename the folder or pick a different icon.'
              : `Group related ${itemNoun}s under one label.`}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="folder-name" className="text-xs font-medium text-ink-muted">
              Name
            </label>
            <Input
              id="folder-name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Sales"
              autoFocus
              disabled={saving}
            />
            {errors.name && <span className="text-xs text-danger">{errors.name}</span>}
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="folder-parent" className="text-xs font-medium text-ink-muted">
              Parent folder
            </label>
            <select
              id="folder-parent"
              value={form.parent_id ?? ''}
              onChange={(e) => updateField('parent_id', e.target.value || null)}
              disabled={saving}
              className="h-10 rounded-[12px] border border-line bg-card px-3 text-sm text-ink outline-none transition-colors focus:border-primary disabled:opacity-50"
            >
              <option value="">No parent (top level)</option>
              {parentOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-ink-subtle">
              Nest a category under a property, e.g. Villa Serena / Preventivi.
            </span>
          </div>

          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-ink-muted">Icon</span>
            <div className="flex flex-wrap gap-2">
              {FOLDER_ICON_KEYS.map((opt) => {
                const active = form.icon === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => updateField('icon', opt)}
                    disabled={saving}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-[12px] border transition-colors',
                      active
                        ? 'border-primary bg-primary-light text-primary'
                        : 'border-line bg-card text-ink-muted hover:bg-bg-alt hover:text-ink',
                    )}
                    aria-pressed={active}
                  >
                    <FolderIcon icon={opt} className="h-5 w-5" />
                  </button>
                );
              })}
            </div>
            {errors.icon && <span className="text-xs text-danger">{errors.icon}</span>}
          </div>

          {editingFolder && confirmDelete && (affectedCount > 0 || childCount > 0) && (
            <div className="rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              {affectedCount > 0 && (
                <>
                  {affectedCount} {itemNoun}
                  {affectedCount === 1 ? '' : 's'} will move to “{allLabel}”.
                </>
              )}
              {childCount > 0 && (
                <>
                  {affectedCount > 0 ? ' ' : ''}
                  {childCount} subfolder{childCount === 1 ? '' : 's'} will move to the top level.
                </>
              )}{' '}
              Click again to confirm.
            </div>
          )}

          {submitError && (
            <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {editingFolder && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-danger/30 bg-danger/5 px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {confirmDelete ? 'Click again to confirm' : 'Delete folder'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onClose()} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : editingFolder ? 'Save changes' : 'Create folder'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
