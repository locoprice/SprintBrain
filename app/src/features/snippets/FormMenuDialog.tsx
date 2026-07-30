import { useEffect, useMemo, useRef, useState } from 'react';
import { MinusCircle, PlusCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  buildFormMenuToken,
  isValidMenuName,
  sanitizeMenuOption,
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
  onInsert: (token: string) => void;
}

/**
 * Builds a `{formmenu:}` token for the snippet body: a menu of choices the
 * person expanding the snippet picks from.
 *
 * The token grammar is written by `@/lib/formMenuToken` and parsed back by the
 * formula engine, so what this dialog previews is exactly what expands.
 */
export function FormMenuDialog({
  open,
  onOpenChange,
  suggestedName,
  onInsert,
}: FormMenuDialogProps) {
  const nextId = useRef(0);
  const makeRow = (label = ''): MenuRow => ({ id: (nextId.current += 1), label });

  const [rows, setRows] = useState<MenuRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [name, setName] = useState('');
  const [multiple, setMultiple] = useState(false);
  const [cols, setCols] = useState('');

  const firstOptionRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts from a clean menu — a half-built one carried over from
  // a cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    nextId.current = STARTING_ROWS;
    setRows(Array.from({ length: STARTING_ROWS }, (_, i) => ({ id: i + 1, label: '' })));
    setSelectedIds([]);
    setName(suggestedName);
    setMultiple(false);
    setCols('');
  }, [open, suggestedName]);

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

  // Single-choice menus hold one preselection; a second click clears it, because
  // "no default" is a valid menu (the field then opens on "— select —").
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

  const filledRows = rows.filter((r) => sanitizeMenuOption(r.label) !== '');
  const nameValid = isValidMenuName(name);

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

  function handleInsert() {
    if (!canInsert) return;
    onInsert(token);
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
          <DialogTitle>Insert dropdown menu field</DialogTitle>
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
                  <div key={row.id} className="flex items-center gap-2.5">
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
              Name
            </label>
            <Input
              id="form-menu-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MENU_1"
              className={cn(
                'h-10 rounded-[10px] font-mono',
                !nameValid && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
            />
            {nameValid ? (
              <p className={HINT}>
                Name of the form field — the body reads it back as{' '}
                <code className="font-mono text-primary/80">{`{${name}}`}</code>.
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-danger">
                Letters, numbers and underscore only, starting with a letter — e.g. MENU_1.
              </p>
            )}
          </div>

          {/* ── Multiple ── */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <label htmlFor="form-menu-multiple" className="text-xs font-medium text-ink">
                Multiple
              </label>
              <p className="text-[11px] text-ink-subtle mt-1">
                Whether the user can select multiple items
              </p>
            </div>
            <Switch
              id="form-menu-multiple"
              checked={multiple}
              onChange={changeMultiple}
              className="mt-0.5"
            />
          </div>

          {/* ── Cols ── */}
          <div>
            <label htmlFor="form-menu-cols" className={SECTION_LABEL}>
              Cols
            </label>
            <Input
              id="form-menu-cols"
              inputMode="numeric"
              value={cols}
              onChange={(e) => setCols(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="auto"
              className="h-10 rounded-[10px] w-28"
            />
            <p className={HINT}>The width of the field in columns of text</p>
          </div>

          {/* ── What lands in the body ── */}
          <div className="rounded-[10px] border border-line bg-bg-alt px-3 py-2.5">
            <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-1">
              Inserts
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
          <Button type="button" variant="primary" onClick={handleInsert} disabled={!canInsert}>
            Insert
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
