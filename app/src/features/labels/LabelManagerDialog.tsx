import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_LABEL_COLOR,
  LABEL_COLORS,
  LABEL_COLOR_KEYS,
  labelSwatch,
} from '@/lib/labelColors';
import { LABEL_NAME_MAX, normalizeLabelName, validateLabelName } from '@/lib/labelUtils';
import { useLabelStore } from '@/stores/labelStore';
import { useUiStore } from '@/stores/uiStore';
import { cn } from '@/lib/utils';
import type { Label, LabelColor } from '@/types/database';

/** Palette strip — one swatch per key, ticked when it's the current colour. */
function ColorStrip({
  value,
  onPick,
  disabled,
}: {
  value: LabelColor;
  onPick: (color: LabelColor) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Label colour" className="flex items-center gap-1">
      {LABEL_COLOR_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-label={LABEL_COLORS[key].name}
          aria-pressed={value === key}
          title={LABEL_COLORS[key].name}
          onClick={() => onPick(key)}
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full transition-transform disabled:opacity-50',
            LABEL_COLORS[key].dot,
            value === key ? 'ring-2 ring-ink/30 ring-offset-1 ring-offset-card' : 'hover:scale-110',
          )}
        >
          {value === key && <Check className="h-3 w-3 text-white" />}
        </button>
      ))}
    </div>
  );
}

interface LabelRowProps {
  label: Label;
  usage: number;
}

function LabelRow({ label, usage }: LabelRowProps) {
  const labels = useLabelStore((s) => s.labels);
  const editLabel = useLabelStore((s) => s.editLabel);
  const removeLabel = useLabelStore((s) => s.removeLabel);

  const [name, setName] = useState(label.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // A rename committed elsewhere (or rolled back) should win over local draft.
  useEffect(() => {
    setName(label.name);
  }, [label.name]);

  async function commitName() {
    const next = normalizeLabelName(name);
    if (next === label.name) {
      setError(null);
      return;
    }
    const message = validateLabelName(next, labels, label.id);
    if (message) {
      setError(message);
      return;
    }
    setBusy(true);
    try {
      await editLabel(label.id, { name: next });
      setError(null);
    } catch (err) {
      setName(label.name);
      setError(err instanceof Error ? err.message : 'Rename failed');
    } finally {
      setBusy(false);
    }
  }

  async function pickColor(color: LabelColor) {
    if (color === label.color) return;
    setBusy(true);
    try {
      await editLabel(label.id, { color });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Colour change failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await removeLabel(label.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  if (confirmDelete) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border border-danger/30 bg-danger/5 px-3 py-2">
        <AlertCircle className="h-4 w-4 shrink-0 text-danger" />
        <p className="min-w-0 flex-1 text-xs text-danger">
          Delete “{label.name}”?{' '}
          {usage > 0 && (
            <span className="text-danger/80">
              It will be removed from {usage} item{usage === 1 ? '' : 's'}.
            </span>
          )}
        </p>
        <button
          type="button"
          onClick={() => setConfirmDelete(false)}
          className="shrink-0 rounded-[8px] px-2.5 py-1 text-xs font-medium text-ink-muted hover:bg-bg-alt"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void handleDelete()}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] bg-danger px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-danger/90 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-3 w-3 animate-spin" />}
          Delete
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[10px] border border-line px-3 py-2">
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={name}
          maxLength={LABEL_NAME_MAX}
          disabled={busy}
          aria-label={`Rename ${label.name}`}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setName(label.name);
              setError(null);
            }
          }}
          className={cn(
            'min-w-0 flex-1 rounded-[8px] border border-transparent bg-transparent px-2 py-1 text-sm font-medium transition-colors hover:border-line focus:border-primary focus:outline-none disabled:opacity-50',
            labelSwatch(label.color).text,
          )}
        />
        <span className="shrink-0 text-[11px] tabular-nums text-ink-subtle">
          {usage > 0 ? `${usage} item${usage === 1 ? '' : 's'}` : 'unused'}
        </span>
        <ColorStrip value={label.color} onPick={(c) => void pickColor(c)} disabled={busy} />
        <button
          type="button"
          disabled={busy}
          aria-label={`Delete ${label.name}`}
          onClick={() => setConfirmDelete(true)}
          className="shrink-0 rounded-[8px] p-1.5 text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {error && <p className="mt-1.5 px-2 text-[11px] text-danger">{error}</p>}
    </div>
  );
}

/**
 * The one place labels are created, renamed, recoloured, and deleted. Reached
 * from the Labels filter on either page, because the vocabulary is shared and
 * neither list owns it.
 */
export function LabelManagerDialog() {
  const open = useUiStore((s) => s.labelManagerOpen);
  const close = useUiStore((s) => s.closeLabelManager);

  const labels = useLabelStore((s) => s.labels);
  const snippetLabels = useLabelStore((s) => s.snippetLabels);
  const promptLabels = useLabelStore((s) => s.promptLabels);
  const addLabel = useLabelStore((s) => s.addLabel);

  const [draft, setDraft] = useState('');
  const [color, setColor] = useState<LabelColor>(DEFAULT_LABEL_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const draftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setDraft('');
      setColor(DEFAULT_LABEL_COLOR);
      setError(null);
    }
  }, [open]);

  /** How many snippets + prompts each label is on — the cost of deleting it. */
  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const ids of [...snippetLabels.values(), ...promptLabels.values()]) {
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [snippetLabels, promptLabels]);

  async function handleCreate() {
    const message = validateLabelName(draft, labels);
    if (message) {
      setError(message);
      return;
    }
    setCreating(true);
    try {
      await addLabel(draft, color);
      setDraft('');
      setColor(DEFAULT_LABEL_COLOR);
      setError(null);
      draftRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create label');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Labels</DialogTitle>
          <DialogDescription>
            One vocabulary for snippets and prompts. Rename or recolour in place — changes
            apply everywhere the label appears.
          </DialogDescription>
        </DialogHeader>

        {/* Create */}
        <div className="flex items-center gap-3 rounded-[12px] border border-line bg-bg-alt px-3 py-2.5">
          <Input
            ref={draftRef}
            value={draft}
            maxLength={LABEL_NAME_MAX}
            aria-label="New label name"
            placeholder="New label…"
            disabled={creating}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
            className="h-8 flex-1"
          />
          <ColorStrip value={color} onPick={setColor} disabled={creating} />
          <button
            type="button"
            disabled={creating || normalizeLabelName(draft).length === 0}
            onClick={() => void handleCreate()}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] bg-primary px-3 text-xs font-semibold text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add
          </button>
        </div>

        {error && (
          <p role="alert" className="-mt-2 flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        {/* List */}
        {labels.length === 0 ? (
          <p className="rounded-[12px] border border-dashed border-line px-4 py-8 text-center text-sm text-ink-subtle">
            No labels yet. Add one above, then assign it while editing a snippet or a prompt.
          </p>
        ) : (
          <div className="flex max-h-[46vh] flex-col gap-2 overflow-y-auto pr-0.5">
            {labels.map((label) => (
              <LabelRow key={label.id} label={label} usage={usage.get(label.id) ?? 0} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
