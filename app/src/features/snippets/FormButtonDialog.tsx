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
import { cn } from '@/lib/utils';
import {
  buildFormButtonToken,
  isValidButtonField,
  sanitizeButtonExpr,
  type ButtonTrim,
} from '@/lib/formButtonToken';

interface ActionRow {
  /** Stable across edits, so a row keeps its identity while being retyped. */
  id: number;
  field: string;
  expr: string;
}

const HINT = 'text-[11px] text-ink-subtle mt-1.5';
const SECTION_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const SELECT_CLASS =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20';

const TRIM_OPTIONS: { value: ButtonTrim; label: string }[] = [
  { value: 'no', label: 'Keep the surrounding space' },
  { value: 'left', label: 'Trim before the button' },
  { value: 'right', label: 'Trim after the button' },
  { value: 'yes', label: 'Trim both sides' },
];

interface FormButtonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (token: string) => void;
}

/**
 * Builds a `{button}` token: a control that sets field values when clicked and
 * never appears in the message.
 *
 * The token is written by `@/lib/formButtonToken` and parsed back by the formula
 * engine, so what this previews is exactly what runs.
 */
export function FormButtonDialog({ open, onOpenChange, onInsert }: FormButtonDialogProps) {
  const nextId = useRef(0);

  const [label, setLabel] = useState('');
  const [trim, setTrim] = useState<ButtonTrim>('left');
  const [rows, setRows] = useState<ActionRow[]>([]);

  const labelRef = useRef<HTMLInputElement | null>(null);

  // Every opening starts clean — a half-built action carried over from a
  // cancelled insert would silently ship into the next snippet.
  useEffect(() => {
    if (!open) return;
    nextId.current = 1;
    setLabel('');
    setTrim('left');
    setRows([{ id: 1, field: '', expr: '' }]);
  }, [open]);

  function updateRow(id: number, patch: Partial<ActionRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addRow() {
    nextId.current += 1;
    setRows((prev) => [...prev, { id: nextId.current, field: '', expr: '' }]);
  }

  function removeRow(id: number) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  const filledRows = rows.filter((r) => r.field.trim() !== '' && sanitizeButtonExpr(r.expr) !== '');
  const badField = rows.find((r) => r.field.trim() !== '' && !isValidButtonField(r.field.trim()));

  const token = useMemo(
    () => buildFormButtonToken({ label, trim, lines: rows }),
    [label, trim, rows],
  );

  const canInsert = filledRows.length > 0 && !badField;

  function handleInsert() {
    if (!canInsert) return;
    onInsert(token);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[480px] gap-0 p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          labelRef.current?.focus();
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>Insert action button</DialogTitle>
          <DialogDescription>
            A button that changes the numbers while you fill the snippet. It never
            appears in the message.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-6 pb-2 flex flex-col gap-4">
          {/* ── Label ── */}
          <div>
            <label htmlFor="form-button-label" className={SECTION_LABEL}>
              Label
            </label>
            <Input
              id="form-button-label"
              ref={labelRef}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="10% off"
              className="h-10 rounded-[10px]"
            />
            <p className={HINT}>The text on the button. Blank shows “Run”.</p>
          </div>

          {/* ── What it does ── */}
          <div>
            <span className={SECTION_LABEL}>What it does</span>
            <div className="rounded-[12px] border border-line bg-bg-alt p-3 flex flex-col gap-2">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center gap-2">
                  <Input
                    value={row.field}
                    onChange={(e) => updateRow(row.id, { field: e.target.value })}
                    placeholder="PRICE"
                    aria-label="Field to change"
                    className={cn(
                      'h-9 w-[38%] shrink-0 rounded-[10px] font-mono',
                      row.field.trim() !== '' &&
                        !isValidButtonField(row.field.trim()) &&
                        'border-danger focus:border-danger focus:ring-danger/20',
                    )}
                  />
                  <span aria-hidden className="shrink-0 font-mono text-sm text-ink-subtle">
                    =
                  </span>
                  <Input
                    value={row.expr}
                    onChange={(e) => updateRow(row.id, { expr: e.target.value })}
                    placeholder="PRICE * 0.9"
                    aria-label="New value"
                    className="h-9 rounded-[10px] font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length === 1}
                    aria-label="Remove this action"
                    title="Remove this action"
                    className="shrink-0 rounded-full text-ink-subtle transition-colors hover:text-danger disabled:opacity-40 disabled:hover:text-ink-subtle"
                  >
                    <MinusCircle className="h-[18px] w-[18px]" />
                  </button>
                </div>
              ))}

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
            {badField ? (
              <p className="mt-1.5 text-[11px] text-danger">
                Field names use letters, numbers and underscore, starting with a letter.
              </p>
            ) : (
              <p className={HINT}>
                Each line sets one field. Later lines see the earlier results, so{' '}
                <code className="font-mono text-primary/80">SUB</code> can feed{' '}
                <code className="font-mono text-primary/80">TOTAL</code>.
              </p>
            )}
          </div>

          {/* ── Trim ── */}
          <div>
            <label htmlFor="form-button-trim" className={SECTION_LABEL}>
              Spacing
            </label>
            <select
              id="form-button-trim"
              value={trim}
              onChange={(e) => setTrim(e.target.value as ButtonTrim)}
              className={SELECT_CLASS}
            >
              {TRIM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p className={HINT}>
              A button on its own line leaves a blank line behind unless it trims one side.
            </p>
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
