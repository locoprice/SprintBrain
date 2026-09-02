import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import type { MemorySpace } from '@/types/database';

// Create or rename a memory space. One dialog for both, because the fields are
// identical and a second component would drift from this one on the first
// change to either.

const NAME_MAX = 64;
const DESCRIPTION_MAX = 280;

interface SpaceDialogProps {
  /** 'new' creates; a space edits it; null is closed. */
  target: 'new' | MemorySpace | null;
  onClose: () => void;
  onCreate: (name: string, description: string) => Promise<unknown>;
  onRename: (id: string, patch: { name: string; description: string }) => Promise<unknown>;
}

export function SpaceDialog({ target, onClose, onCreate, onRename }: SpaceDialogProps) {
  const editing = target !== null && target !== 'new' ? target : null;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on every open so a cancelled edit does not leak into the next one.
  useEffect(() => {
    if (target === null) return;
    setName(editing?.name ?? '');
    setDescription(editing?.description ?? '');
    setError(null);
    setSaving(false);
  }, [target, editing]);

  const trimmed = name.trim();
  const canSave = trimmed.length > 0 && trimmed.length <= NAME_MAX && !saving;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await onRename(editing.id, { name: trimmed, description });
      } else {
        await onCreate(trimmed, description);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the space.');
      setSaving(false);
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editing ? 'Rename space' : 'New space'}</DialogTitle>
          <DialogDescription>
            A space holds the facts one kind of work needs. Keeping them apart is what
            lets a step attach a few of them instead of all of them.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="space-name" className="text-xs font-medium text-ink-muted">
              Name
            </label>
            <Input
              id="space-name"
              value={name}
              maxLength={NAME_MAX}
              autoFocus
              placeholder="Product reference"
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="space-desc" className="text-xs font-medium text-ink-muted">
              Description <span className="text-ink-subtle">(optional)</span>
            </label>
            <Input
              id="space-desc"
              value={description}
              maxLength={DESCRIPTION_MAX}
              placeholder="What belongs in here"
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {error ? (
            <div className="flex items-start gap-2 rounded-[10px] bg-danger-bg px-3 py-2 text-sm text-danger">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSave}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create space'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
