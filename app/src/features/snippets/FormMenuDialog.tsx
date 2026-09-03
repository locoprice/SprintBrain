import { useEffect, useMemo, useRef, useState } from 'react';
import { GripVertical, MinusCircle, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import {
  buildFormMenuToken,
  isValidMenuName,
  sanitizeMenuOption,
  type FormMenuConfig,
} from '@/lib/formMenuToken';

interface MenuRow {
  /** Stable across label edits, so the preselection survives retyping. */
  id: number;
  label: string;
}

const STARTING_ROWS = 3;
const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';

interface FormMenuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled field name — the next free MENU_n for the body being edited. */
  suggestedName: string;
  /**
   * The menu being edited, or null to build a new one. Must be referentially
   * stable while open: the dialog reseeds whenever it changes, so a value
   * rebuilt on every render would wipe the edit in progress.
   */
  initial?: FormMenuConfig | null;
  onSubmit: (token: string) => void;
}

/**
 * Builds a `{formmenu:}` token for the snippet body: a menu of choices the
 * person expanding the snippet picks from.
 *
 * The token grammar is written by `@/lib/formMenuToken` and parsed back by the
 * formula engine, so what this dialog previews is exactly what expands. Passing
 * `initial` loads an existing menu for editing instead of starting blank.
 */
export function FormMenuDialog({
  open,
  onOpenChange,
  suggestedName,
  initial = null,
  onSubmit,
}: FormMenuDialogProps) {
  const nextId = useRef(0);
  const makeRow = (label = ''): MenuRow => ({ id: (nextId.current += 1), label });

  const [rows, setRows] = useState<MenuRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [multiple, setMultiple] = useState(false);
  // No longer editable: `cols` only widened the options box in character units,
  // it never changed the output, and the mobile app ignored it outright. The
  // state stays so a menu written with cols=N keeps it through an edit here
  // rather than losing it the first time someone reopens the builder.
  const [cols, setCols] = useState('');

  const firstOptionRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts from a clean menu — a half-built one carried over from
  // a cancelled insert would silently ship into the next snippet — unless an
  // existing menu was handed in, in which case it starts from that.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      const seeded = initial.options.map((label, i) => ({ id: i + 1, label }));
      const loaded = seeded.length > 0 ? seeded : [{ id: 1, label: '' }];
      nextId.current = loaded.length;
      setRows(loaded);
      setSelectedIds(loaded.filter((r) => initial.selected.includes(r.label)).map((r) => r.id));
      setName(initial.name);
      setMultiple(initial.multiple);
      setCols(initial.cols === null ? '' : String(initial.cols));
      return;
    }
    nextId.current = STARTING_ROWS;
    setRows(Array.from({ length: STARTING_ROWS }, (_, i) => ({ id: i + 1, label: '' })));
    // The first choice starts ticked, so a new menu is written with an explicit
    // `default=` rather than relying on the engine's fallback. It also shows the
    // author, in the token preview, exactly which option a menu nobody touches
    // will expand to.
    setSelectedIds([1]);
    // Left blank like Text Blaze: `suggestedName` is only the placeholder, so a
    // name is something you opt into rather than something to clear.
    setName('');
    setMultiple(false);
    setCols('');
  }, [open, suggestedName, initial]);

  function updateRow(id: number, label: string) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, label } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
    setSelectedIds((prev) => prev.filter((s) => s !== id));
  }

  // Single-choice menus hold one preselection; a second click clears it, which
  // writes a token with no `default=`. On a `multiple` menu that means it opens
  // with nothing ticked. On a single-choice one the engine still opens it on the
  // first option: one option has to win, so "no default" is not a state a
  // single-choice menu can actually be in.
  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((s) => s !== id);
      return multiple ? [...prev, id] : [id];
    });
  }

  // Turning multiple off collapses the preselection to the first pick, matching
  // what the written token can actually carry.
  function changeMultiple(next: boolean) {
    setMultiple(next);
    if (!next) setSelectedIds((prev) => prev.slice(0, 1));
  }

  // Drag to reorder, matching the grip handles on Text Blaze's rows. The order
  // of `rows` is the order the menu offers, so this is a plain array move.
  const dragId = useRef<number | null>(null);

  function moveRow(fromId: number, toId: number) {
    if (fromId === toId) return;
    setRows((prev) => {
      const from = prev.findIndex((r) => r.id === fromId);
      const to = prev.findIndex((r) => r.id === toId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      if (moved) next.splice(to, 0, moved);
      return next;
    });
  }

  const filledRows = rows.filter((r) => sanitizeMenuOption(r.label) !== '');
  // The name is optional, exactly as it is in Text Blaze: blank is fine and the
  // engine keys the menu itself. Only a non-empty *invalid* name blocks Insert.
  const nameValid = name === '' || isValidMenuName(name);

  const token = useMemo(
    () =>
      buildFormMenuToken({
        options: rows.map((r) => r.label),
        selected: rows.filter((r) => selectedIds.includes(r.id)).map((r) => r.label),
        name,
        multiple,
        cols: cols.trim() === '' ? null : Number(cols),
      }),
    [rows, selectedIds, name, multiple, cols],
  );

  const canInsert = filledRows.length > 0 && nameValid;

  function handleSubmit() {
    if (!canInsert) return;
    onSubmit(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[440px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          firstOptionRef.current?.focus();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>{initial ? 'Edit dropdown menu field' : 'Insert dropdown menu field'}</DialogTitle>
          <DialogDescription>
            A menu of choices, picked when the snippet expands.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-2 flex flex-col gap-4">
          {/* ── Values: the options, and which one starts selected ── */}
          <div>
            <span className={SECTION_LABEL}>Values</span>
            <div className="rounded-[12px] border border-line bg-bg-alt p-3 flex flex-col gap-2">
              {rows.map((row, i) => {
                const isSelected = selectedIds.includes(row.id);
                return (
                  <div
                    key={row.id}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId.current !== null) moveRow(dragId.current, row.id);
                      dragId.current = null;
                    }}
                    className="flex items-center gap-2.5"
                  >
                    <span
                      draggable
                      onDragStart={() => {
                        dragId.current = row.id;
                      }}
                      onDragEnd={() => {
                        dragId.current = null;
                      }}
                      aria-hidden
                      title="Drag to reorder"
                      className="shrink-0 cursor-grab text-ink-subtle active:cursor-grabbing"
                    >
                      <GripVertical className="h-4 w-4" />
                    </span>
                    <input
                      type={multiple ? 'checkbox' : 'radio'}
                      name="form-menu-default"
                      checked={isSelected}
                      // The click owns the toggle: a radio fires no change event
                      // when it is already selected, and "no default" has to stay
                      // reachable by clicking the selected one again.
                      onChange={() => undefined}
                      onClick={() => toggleSelected(row.id)}
                      aria-label={`Preselect ${row.label || `choice ${i + 1}`}`}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                    <Input
                      ref={i === 0 ? firstOptionRef : undefined}
                      value={row.label}
                      onChange={(e) => updateRow(row.id, e.target.value)}
                      placeholder={`Choice ${String.fromCharCode(65 + i)}`}
                      className="h-9 rounded-[10px]"
                    />
                    <button
                      type="button"
                      onClick={() => removeRow(row.id)}
                      disabled={rows.length === 1}
                      aria-label="Remove this choice"
                      title="Remove this choice"
                      className="shrink-0 rounded-full text-ink-subtle transition-colors hover:text-danger disabled:opacity-40 disabled:hover:text-ink-subtle"
                    >
                      <MinusCircle className="h-[18px] w-[18px]" />
                    </button>
                  </div>
                );
              })}

              <div className="flex justify-end pt-0.5">
                <button
                  type="button"
                  onClick={addRow}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-primary/30 bg-primary-light px-3 text-xs font-semibold text-primary transition-colors hover:border-primary/50"
                >
                  <PlusCircle className="h-3.5 w-3.5" />
                  Add
                </button>
              </div>
            </div>
            <p className={HINT}>
              The options for the menu. Tick one to preselect it.
            </p>
          </div>

          {/* ── Field name ── */}
          <div>
            <label htmlFor="form-menu-name" className={SECTION_LABEL}>
              Name <span className="font-normal text-ink-subtle">(optional)</span>
            </label>
            <Input
              id="form-menu-name"
              value={name}
              // Disallowed characters (spaces, symbols) are stripped as they're
              // typed rather than rejected after the fact — a space silently
              // failing validation with no visible cause is a worse experience
              // than the character simply not appearing.
              onChange={(e) => setName(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              placeholder={suggestedName}
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !nameValid && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
            {!nameValid ? (
              <p className="mt-1.5 text-[11px] text-danger">
                Letters, numbers and underscore only, starting with a letter — e.g. MENU_1.
              </p>
            ) : name === '' ? (
              <p className={HINT}>
                Name of the form field. Only needed if the body refers back to the choice — leave
                it blank and the menu still works.
              </p>
            ) : (
              <p className={HINT}>
                Name of the form field — the body reads it back as{' '}
                <code className="font-mono text-primary/80">{`{${name}}`}</code>.
              </p>
            )}
          </div>

          {/* ── Single vs multiple ── */}
          {/* Both answers deserve a name here: "off" would have to stand for
              single choice, which is a real setting and not an absence. */}
          <div>
            <span className={SECTION_LABEL}>Selection</span>
            <Segmented
              ariaLabel="How many options can be picked"
              value={multiple ? 'multiple' : 'single'}
              options={[
                { value: 'single', label: 'Single Choice' },
                { value: 'multiple', label: 'Multiple Choice' },
              ]}
              onChange={(next) => changeMultiple(next === 'multiple')}
            />
            <p className={HINT}>
              Single Choice fills as radio buttons, Multiple Choice as checkboxes.
            </p>
          </div>


          {/* ── What lands in the body ── */}
          <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1">
              {initial ? 'Saves as' : 'Inserts'}
            </p>
            <code className="block font-mono text-[11px] leading-relaxed text-ink-muted break-all">
              {token}
            </code>
          </div>
        </div>

        <div className="px-6 py-4 mt-2 border-t border-line flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={!canInsert}>
            {initial ? 'Save' : 'Insert'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
