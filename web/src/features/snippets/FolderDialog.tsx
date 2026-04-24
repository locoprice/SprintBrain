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
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { folderFormSchema, type FolderFormValues } from '@/types/schemas';

const ICON_OPTIONS = ['🏠', '🌍', '🏢', '📋', '📊', '💬', '✈️', '🔧', '📝', '⭐'];

const DEFAULT_FORM: FolderFormValues = {
  name: '',
  icon: ICON_OPTIONS[0] ?? '📁',
};

type FieldErrors = Partial<Record<keyof FolderFormValues, string>>;

/**
 * Create/edit folder dialog. Driven by `uiStore.folderDialogId`:
 *   - 'new'  → create mode
 *   - uuid   → edit mode (form populated from store)
 *   - null   → closed
 */
export function FolderDialog() {
  const dialogId = useUiStore((s) => s.folderDialogId);
  const closeDialog = useUiStore((s) => s.closeFolderDialog);

  const folders = useSnippetStore((s) => s.folders);
  const snippets = useSnippetStore((s) => s.snippets);
  const addFolder = useSnippetStore((s) => s.addFolder);
  const editFolder = useSnippetStore((s) => s.editFolder);
  const removeFolder = useSnippetStore((s) => s.removeFolder);

  const isEdit = dialogId !== null && dialogId !== 'new';
  const editingFolder = useMemo(
    () => (isEdit && dialogId ? folders.find((f) => f.id === dialogId) ?? null : null),
    [isEdit, dialogId, folders],
  );
  const open = dialogId !== null;

  const affectedSnippetCount = useMemo(() => {
    if (!editingFolder) return 0;
    return snippets.filter((s) => s.folder_id === editingFolder.id).length;
  }, [editingFolder, snippets]);

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
      setForm({ name: editingFolder.name, icon: editingFolder.icon || DEFAULT_FORM.icon });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [open, editingFolder]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) closeDialog();
    },
    [closeDialog],
  );

  function updateField<K extends keyof FolderFormValues>(
    key: K,
    value: FolderFormValues[K],
  ) {
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
      closeDialog();
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
      closeDialog();
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
              : 'Group related snippets under one label.'}
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
            <span className="text-xs font-medium text-ink-muted">Icon</span>
            <div className="flex flex-wrap gap-2">
              {ICON_OPTIONS.map((opt) => {
                const active = form.icon === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => updateField('icon', opt)}
                    disabled={saving}
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-[12px] border text-lg transition-colors',
                      active
                        ? 'border-primary bg-primary-light'
                        : 'border-line bg-card hover:bg-bg-alt',
                    )}
                    aria-pressed={active}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {errors.icon && <span className="text-xs text-danger">{errors.icon}</span>}
          </div>

          {editingFolder && affectedSnippetCount > 0 && confirmDelete && (
            <div className="rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              {affectedSnippetCount} snippet{affectedSnippetCount === 1 ? '' : 's'} will
              move to “All snippets”. Click again to confirm.
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => closeDialog()}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving
                  ? 'Saving…'
                  : editingFolder
                  ? 'Save changes'
                  : 'Create folder'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
