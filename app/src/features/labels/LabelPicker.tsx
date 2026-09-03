import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Plus, Tag } from 'lucide-react';
import { LabelBadge } from '@/components/shared/LabelBadge';
import { DEFAULT_LABEL_COLOR, labelSwatch } from '@/lib/labelColors';
import { labelNameKey, normalizeLabelName, validateLabelName } from '@/lib/labelUtils';
import { buildLabelTree, flattenLabelTree, labelPath } from '@/lib/labelTree';
import { useLabelStore } from '@/stores/labelStore';
import { cn } from '@/lib/utils';

/**
 * Assign labels to a snippet or a prompt. Selection is a checkbox list; typing a
 * name that doesn't exist yet offers to create it inline, so a user never has to
 * leave the editor to add a label they just thought of.
 *
 * The menu is portalled with fixed positioning rather than absolutely placed:
 * both editors put this control inside a scrolling, overflow-clipped panel,
 * which would otherwise clip the menu. Mirrors DarkSelect in PromptBlockEditor.
 */
interface LabelPickerProps {
  value: string[];
  onChange: (labelIds: string[]) => void;
  /**
   * `dark` matches the prompt editor's side panel. Its hexes are the panel's
   * existing vocabulary (see PromptBlockEditor) — no new colours are introduced
   * here; the label swatches themselves come from lib/labelColors.ts.
   */
  tone?: 'light' | 'dark';
  disabled?: boolean;
  id?: string;
}

const TONE = {
  light: {
    field:
      'border-line bg-card hover:border-primary/30 focus-visible:border-primary text-sm',
    placeholder: 'text-ink-subtle',
    chevron: 'text-ink-subtle',
    menu: 'rounded-[12px] border border-line bg-card p-1.5 shadow-md',
    input:
      'h-8 rounded-[8px] border border-line bg-card text-xs text-ink placeholder:text-ink-subtle focus:border-primary',
    row: 'text-ink hover:bg-bg-alt',
    muted: 'text-ink-subtle',
    danger: 'text-danger',
    check: 'text-primary',
  },
  dark: {
    field:
      'border-[#34343C] bg-[#1C1C22] hover:border-[#48484F] focus-visible:border-[#3D6FE8] text-xs',
    placeholder: 'text-[#7A7A85]',
    chevron: 'text-[#9C9CA6]',
    menu:
      'rounded-[10px] border border-[#3A3A42] bg-[#24242B] p-1 shadow-[0_12px_40px_rgba(0,0,0,0.7),0_2px_8px_rgba(0,0,0,0.4)]',
    input:
      'h-7 rounded-[6px] border border-[#34343C] bg-[#1C1C22] text-xs text-[#D6D6DE] placeholder:text-[#7A7A85] focus:border-[#3D6FE8]',
    row: 'text-[#B8B8C2] hover:bg-[#30303A]',
    muted: 'text-[#8A8A94]',
    danger: 'text-[#FF5F57]',
    check: 'text-[#1B4FD8]',
  },
} as const;

export function LabelPicker({
  value,
  onChange,
  tone = 'light',
  disabled = false,
  id,
}: LabelPickerProps) {
  const labels = useLabelStore((s) => s.labels);
  const addLabel = useLabelStore((s) => s.addLabel);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = TONE[tone];

  const selected = useMemo(
    () => value.map((idValue) => labels.find((l) => l.id === idValue)).filter((l) => l !== undefined),
    [value, labels],
  );

  const trimmed = normalizeLabelName(query);
  // Unfiltered, the list is a tree so a sub-label reads as belonging to its
  // parent. While searching it flattens to plain hits: indenting a child whose
  // parent was filtered out would point at nothing.
  const matches = useMemo(() => {
    if (trimmed.length === 0) {
      return flattenLabelTree(buildLabelTree(labels)).map((n) => ({
        label: n.label,
        depth: n.depth,
      }));
    }
    const needle = trimmed.toLowerCase();
    return labels
      .filter((l) => l.name.toLowerCase().includes(needle))
      .map((label) => ({ label, depth: 1 }));
  }, [labels, trimmed]);

  // Offer creation only when the typed name isn't already a label — an exact
  // (case-insensitive) hit should tick the existing one, not make a duplicate.
  const canCreate =
    trimmed.length > 0 && !labels.some((l) => labelNameKey(l.name) === labelNameKey(trimmed));

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    }
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setQuery('');
    setError(null);
    setOpen(true);
    // Focus after the portal paints so typing filters immediately.
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function toggle(labelId: string) {
    onChange(
      value.includes(labelId) ? value.filter((v) => v !== labelId) : [...value, labelId],
    );
  }

  async function handleCreate() {
    const message = validateLabelName(trimmed, labels);
    if (message) {
      setError(message);
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const label = await addLabel(trimmed, DEFAULT_LABEL_COLOR);
      onChange([...value, label.id]);
      setQuery('');
      inputRef.current?.focus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create label');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={cn(
          'flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-left transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          t.field,
        )}
      >
        <Tag className={cn('h-3.5 w-3.5 shrink-0', t.chevron)} />
        {selected.length > 0 ? (
          // Read-only chips. The trigger is itself a button, so a chip carrying
          // its own remove button would nest a button inside a button: invalid
          // HTML, and the inner control is not reliably reachable by keyboard or
          // assistive tech. Unticking the row in the dropdown is the removal path
          // here, and it keeps the field behaving the same wherever you click it.
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {selected.map((label) => (
              <LabelBadge
                key={label.id}
                label={label}
                path={labelPath(labels, label.id)}
              />
            ))}
          </span>
        ) : (
          <span className={cn('flex-1', t.placeholder)}>No labels</span>
        )}
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-150',
            t.chevron,
            open && 'rotate-180',
          )}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 220) }}
            // `pointer-events-auto` is load-bearing, not cosmetic. The snippet
            // editor is a modal Radix dialog, which sets `pointer-events: none`
            // on <body> so only the dialog is interactive. This menu is
            // portalled to <body> — outside the dialog's content node — so it
            // inherits `none`, and every click passes straight through to
            // whatever sits behind it. Re-enabling pointer events here is the
            // same thing Radix does for its own portalled popovers in a dialog.
            className={cn('pointer-events-auto fixed z-[9999]', t.menu)}
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (error) setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canCreate) void handleCreate();
                }
              }}
              placeholder={labels.length === 0 ? 'Name your first label…' : 'Find or create…'}
              className={cn('mb-1 w-full px-2.5 focus:outline-none', t.input)}
            />

            <div className="max-h-[220px] overflow-y-auto">
              {matches.map(({ label, depth }) => {
                const active = value.includes(label.id);
                return (
                  <button
                    key={label.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => toggle(label.id)}
                    style={{ paddingLeft: 10 + (depth - 1) * 14 }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[6px] py-1.5 pr-2.5 text-xs transition-colors',
                      t.row,
                    )}
                  >
                    <span
                      className={cn('h-2.5 w-2.5 shrink-0 rounded-full', labelSwatch(label.color).dot)}
                    />
                    <span className="min-w-0 flex-1 truncate text-left">{label.name}</span>
                    {active && <Check className={cn('h-3.5 w-3.5 shrink-0', t.check)} />}
                  </button>
                );
              })}

              {matches.length === 0 && !canCreate && (
                <p className={cn('px-2.5 py-2 text-xs', t.muted)}>
                  {labels.length === 0 ? 'No labels yet.' : 'No match.'}
                </p>
              )}
            </div>

            {canCreate && (
              <button
                type="button"
                disabled={creating}
                onClick={() => void handleCreate()}
                className={cn(
                  'mt-1 flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                  t.row,
                )}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 truncate">Create “{trimmed}”</span>
              </button>
            )}

            {error && <p className={cn('px-2.5 pb-1 pt-1.5 text-[11px]', t.danger)}>{error}</p>}
          </div>,
          document.body,
        )}
    </>
  );
}
