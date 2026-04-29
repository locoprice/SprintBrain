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
import { usePromptStore } from '@/stores/promptStore';
import { useUiStore } from '@/stores/uiStore';
import { promptFormSchema, type PromptFormValues } from '@/types/schemas';

const TYPES: PromptFormValues['type'][] = ['one-shot', 'few-shot'];

type FieldErrors = Partial<Record<keyof PromptFormValues | 'tagsInput', string>>;

interface FormState {
  name: string;
  content: string;
  type: PromptFormValues['type'];
  tagsInput: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  content: '',
  type: 'one-shot',
  tagsInput: '',
};

const FIELD_LABEL = 'text-xs font-medium text-ink-muted';
const SELECT_CLASS =
  'h-10 w-full rounded-[12px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

function parseTags(input: string): string[] {
  return input
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Create/edit prompt dialog driven by uiStore:
 *   - `newPromptOpen === true` → create mode
 *   - `editPromptId` is a uuid → edit mode
 * When both are set, edit mode wins.
 */
export function PromptDialog() {
  const newOpen = useUiStore((s) => s.newPromptOpen);
  const editId = useUiStore((s) => s.editPromptId);
  const closeNew = useUiStore((s) => s.closeNewPrompt);
  const closeEdit = useUiStore((s) => s.closeEditPrompt);

  const prompts = usePromptStore((s) => s.prompts);
  const addPrompt = usePromptStore((s) => s.addPrompt);
  const editPrompt = usePromptStore((s) => s.editPrompt);
  const removePrompt = usePromptStore((s) => s.removePrompt);

  const editingPrompt = useMemo(
    () => (editId ? prompts.find((p) => p.id === editId) ?? null : null),
    [editId, prompts],
  );
  const mode: 'create' | 'edit' = editingPrompt ? 'edit' : 'create';
  const open = mode === 'edit' ? editingPrompt !== null : newOpen;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    setConfirmDelete(false);
    if (editingPrompt) {
      setForm({
        name: editingPrompt.name,
        content: editingPrompt.content,
        type: editingPrompt.type,
        tagsInput: editingPrompt.tags.join(', '),
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingPrompt]);

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) return;
      if (mode === 'edit') closeEdit();
      else closeNew();
    },
    [mode, closeEdit, closeNew],
  );

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key as keyof FieldErrors]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    const payload: PromptFormValues = {
      name: form.name,
      content: form.content,
      type: form.type,
      tags: parseTags(form.tagsInput),
    };

    const parsed = promptFormSchema.safeParse(payload);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof PromptFormValues | undefined;
        if (key && !next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setSaving(true);
    try {
      if (mode === 'edit' && editingPrompt) {
        await editPrompt(editingPrompt.id, parsed.data);
        closeEdit();
      } else {
        await addPrompt(parsed.data);
        closeNew();
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!editingPrompt) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setSubmitError(null);
    try {
      await removePrompt(editingPrompt.id);
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? 'Edit prompt' : 'Create prompt'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update the prompt. Changes sync immediately.'
              : 'Save a reusable AI prompt for one-shot or few-shot use.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="prompt-name" className={FIELD_LABEL}>
              Name
            </label>
            <Input
              id="prompt-name"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="Booking summary — formal"
              autoFocus
              disabled={saving}
            />
            {errors.name && <FieldError message={errors.name} />}
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="prompt-type" className={FIELD_LABEL}>
              Type
            </label>
            <select
              id="prompt-type"
              value={form.type}
              onChange={(e) =>
                updateField('type', e.target.value as PromptFormValues['type'])
              }
              disabled={saving}
              className={SELECT_CLASS}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="prompt-content" className={FIELD_LABEL}>
              Content
            </label>
            <textarea
              id="prompt-content"
              rows={8}
              value={form.content}
              onChange={(e) => updateField('content', e.target.value)}
              disabled={saving}
              className="w-full resize-none rounded-[12px] border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
              placeholder="You are a helpful assistant that…"
            />
            {errors.content && <FieldError message={errors.content} />}
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="prompt-tags" className={FIELD_LABEL}>
              Tags
            </label>
            <Input
              id="prompt-tags"
              value={form.tagsInput}
              onChange={(e) => updateField('tagsInput', e.target.value)}
              placeholder="sales, onboarding, email"
              disabled={saving}
            />
            <span className="text-[11px] text-ink-subtle">
              Comma-separated. Leave blank for no tags.
            </span>
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
                {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create prompt'}
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
