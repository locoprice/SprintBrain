import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import {
  snippetFormSchema,
  type SnippetFormValues,
} from '@/types/schemas';

const LANGUAGES: SnippetFormValues['language'][] = ['EN', 'IT', 'ES', 'FR', 'MULTI'];

type FieldErrors = Partial<Record<keyof SnippetFormValues, string>>;

const EMPTY_FORM: SnippetFormValues = {
  name: '',
  trigger: '',
  content: '',
  folder_id: null,
  language: 'EN',
};

const FIELD_LABEL = 'text-xs font-medium text-ink-muted';
const SELECT_CLASS =
  'h-10 w-full rounded-[12px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

/**
 * The create/edit snippet dialog. Open-state is driven by the UI store:
 *   - `newSnippetOpen === true` → create mode
 *   - `editSnippetId` is a uuid → edit mode, form is pre-populated
 *
 * When both are set at once, edit mode wins. The header `New snippet` button
 * opens the dialog via the `<DialogTrigger>` wrapper rendered below.
 */
export function NewSnippetDialog() {
  const newOpen = useUiStore((s) => s.newSnippetOpen);
  const editId = useUiStore((s) => s.editSnippetId);
  const openNew = useUiStore((s) => s.openNewSnippet);
  const closeNew = useUiStore((s) => s.closeNewSnippet);
  const closeEdit = useUiStore((s) => s.closeEditSnippet);

  const folders = useSnippetStore((s) => s.folders);
  const snippets = useSnippetStore((s) => s.snippets);
  const addSnippet = useSnippetStore((s) => s.addSnippet);
  const editSnippet = useSnippetStore((s) => s.editSnippet);
  const removeSnippet = useSnippetStore((s) => s.removeSnippet);

  const editingSnippet = useMemo(
    () => (editId ? snippets.find((s) => s.id === editId) ?? null : null),
    [editId, snippets],
  );
  const mode: 'create' | 'edit' = editingSnippet ? 'edit' : 'create';
  const open = mode === 'edit' ? editingSnippet !== null : newOpen;

  const [form, setForm] = useState<SnippetFormValues>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset form whenever the dialog opens (either mode) or the edit target changes.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    setConfirmDelete(false);
    if (editingSnippet) {
      setForm({
        name: editingSnippet.name,
        trigger: editingSnippet.triggers[0] ?? '',
        content: editingSnippet.content,
        folder_id: editingSnippet.folder_id,
        language: editingSnippet.language,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingSnippet]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        if (mode === 'create') openNew();
      } else {
        if (mode === 'edit') closeEdit();
        else closeNew();
      }
    },
    [mode, openNew, closeEdit, closeNew],
  );

  function updateField<K extends keyof SnippetFormValues>(
    key: K,
    value: SnippetFormValues[K],
  ) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    const parsed = snippetFormSchema.safeParse(form);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof SnippetFormValues | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'edit' && editingSnippet) {
        await editSnippet(editingSnippet.id, parsed.data);
        closeEdit();
      } else {
        await addSnippet(parsed.data);
        closeNew();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingSnippet) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      await removeSnippet(editingSnippet.id);
      closeEdit();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="primary">
          <Plus className="h-4 w-4" />
          New snippet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Edit snippet' : 'Create snippet'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update the name, trigger, or body. Changes sync across every device.'
              : 'Give the snippet a name, a trigger, and a body. It will sync immediately.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="snippet-name" className={FIELD_LABEL}>
              Name
            </label>
            <Input
              id="snippet-name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Quote — English"
              autoFocus
              disabled={saving}
            />
            {errors.name && <FieldError message={errors.name} />}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <label htmlFor="snippet-trigger" className={FIELD_LABEL}>
                Trigger
              </label>
              <Input
                id="snippet-trigger"
                value={form.trigger}
                onChange={(e) => updateField('trigger', e.target.value)}
                placeholder="quoteEN"
                disabled={saving}
              />
              {errors.trigger && <FieldError message={errors.trigger} />}
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="snippet-language" className={FIELD_LABEL}>
                Language
              </label>
              <select
                id="snippet-language"
                value={form.language}
                onChange={(e) =>
                  updateField('language', e.target.value as SnippetFormValues['language'])
                }
                disabled={saving}
                className={SELECT_CLASS}
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="snippet-folder" className={FIELD_LABEL}>
              Folder
            </label>
            <select
              id="snippet-folder"
              value={form.folder_id ?? ''}
              onChange={(e) =>
                updateField('folder_id', e.target.value === '' ? null : e.target.value)
              }
              disabled={saving}
              className={SELECT_CLASS}
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.icon} {f.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="snippet-content" className={FIELD_LABEL}>
              Content
            </label>
            <textarea
              id="snippet-content"
              rows={6}
              value={form.content}
              onChange={(e) => updateField('content', e.target.value)}
              disabled={saving}
              className="w-full resize-none rounded-[12px] border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              placeholder="Dear {guest}, …"
            />
            {errors.content && <FieldError message={errors.content} />}
          </div>

          {submitError && (
            <div className="flex items-start gap-2 rounded-[10px] border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-1">
            <div>
              {mode === 'edit' && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={saving}
                  className="inline-flex h-10 items-center gap-2 rounded-[12px] border border-danger/30 bg-danger/5 px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {confirmDelete ? 'Click again to confirm' : 'Delete'}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={saving}>
                {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create snippet'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message: string }) {
  return <span className="text-xs text-danger">{message}</span>;
}
