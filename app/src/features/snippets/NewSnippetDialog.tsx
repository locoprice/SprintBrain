import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertCircle, Clock, History, Pin, Plus, Trash2, Users, X } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import {
  snippetFormSchema,
  type SnippetFormValues,
} from '@/types/schemas';

// FR retired in v1.1 — excluded from picker, still valid in DB for legacy rows
const LANG_PICKER: SnippetFormValues['language'][] = ['EN', 'IT', 'ES', 'MULTI'];

// Inline hex OK per CLAUDE.md — mirrors SnippetsTable.tsx language palette
const LANG_CONFIG: Record<
  SnippetFormValues['language'],
  { fg: string; bg: string; bdr: string; label: string }
> = {
  EN:    { fg: '#1B4FD8', bg: '#EEF2FF', bdr: '#BED0FF', label: 'EN' },
  IT:    { fg: '#15803D', bg: '#F0FDF4', bdr: '#86EFAC', label: 'IT' },
  ES:    { fg: '#C2410C', bg: '#FFF7ED', bdr: '#FDBA74', label: 'ES' },
  FR:    { fg: '#7C3AED', bg: '#F5F3FF', bdr: '#C4B5FD', label: 'FR' },
  MULTI: { fg: '#7C3AED', bg: '#F5F3FF', bdr: '#C4B5FD', label: 'Multi' },
};

type FieldErrors = Partial<Record<keyof SnippetFormValues, string>>;

const EMPTY_FORM: SnippetFormValues = {
  name: '',
  trigger: '',
  content: '',
  bodies: {},
  folder_id: null,
  language: 'EN',
  pinned: false,
  is_shared: false,
  alternative_queries: [],
  enable_urgency_timer: false,
  timer_duration_ms: 0,
  scarcity_count: 0,
};

// Quick Insert: matches the extension popup chips (popup.html:757-767).
// Each entry inserts `data-c` at the cursor position in the body textarea.
interface QuickInsert {
  label: string;
  value: string;
  variant: 'default' | 'formula' | 'cond';
}

const QUICK_INSERTS: QuickInsert[] = [
  { label: 'guest_name',    value: '{guest_name}',           variant: 'default' },
  { label: 'property_name', value: '{property_name}',        variant: 'default' },
  { label: 'checkin_date',  value: '{checkin_date}',         variant: 'default' },
  { label: 'checkout_date', value: '{checkout_date}',        variant: 'default' },
  { label: 'total_price',   value: '{total_price}',          variant: 'default' },
  { label: 'nights',        value: '{nights}',               variant: 'default' },
  { label: 'phone',         value: '{phone_number}',         variant: 'default' },
  { label: 'review_link',   value: '{review_link}',          variant: 'default' },
  { label: '{=formula}',    value: '{=A - B}',               variant: 'formula' },
  { label: '{if:cond}',     value: '{if:A > 0}text{endif}',  variant: 'cond'    },
];

const FIELD_LABEL = 'block text-xs font-medium text-ink-muted mb-1.5';
const SELECT_CLASS =
  'h-10 w-full rounded-[10px] border border-line bg-card px-3 text-sm text-ink focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50';

/**
 * Keyword → candidate alternative queries map.
 * Patterns match against the snippet name + trigger; matching suggestions are
 * shown as one-click chips below the tag input (auto-suggest feature).
 */
const KEYWORD_SUGGESTIONS: Array<{ pattern: RegExp; suggestions: string[] }> = [
  { pattern: /quote|estimate|preventivo|presup/i,  suggestions: ['quote', 'estimate', 'preventivo'] },
  { pattern: /avail|disponib/i,                    suggestions: ['availability', 'no availability', 'disponibilità'] },
  { pattern: /booking|reserv/i,                    suggestions: ['booking', 'reservation', 'prenotazione'] },
  { pattern: /check.?in|arrival/i,                 suggestions: ['check-in', 'arrival', 'arrivo'] },
  { pattern: /check.?out|departure/i,              suggestions: ['check-out', 'departure', 'partenza'] },
  { pattern: /follow.?up/i,                        suggestions: ['follow up', 'follow-up', 'reminder'] },
  { pattern: /welcome|greet/i,                     suggestions: ['welcome', 'benvenuto', 'bienvenido'] },
  { pattern: /cancel|withdraw/i,                   suggestions: ['cancellation', 'refund', 'cancel'] },
  { pattern: /minstay|minimum.stay/i,              suggestions: ['minimum stay', 'min stay', 'soggiorno minimo'] },
  { pattern: /payment|invoice|receipt/i,           suggestions: ['payment', 'invoice', 'pagamento'] },
  { pattern: /discount|offer|sale/i,               suggestions: ['discount', 'offer', 'sconto'] },
  { pattern: /review|feedback/i,                   suggestions: ['review', 'feedback', 'recensione'] },
  { pattern: /info(rmation)?/i,                    suggestions: ['information', 'details', 'info'] },
  { pattern: /address|location/i,                  suggestions: ['address', 'location', 'directions'] },
  { pattern: /urgency|timer|countdown/i,           suggestions: ['urgent', 'limited time', 'last minute'] },
];

/**
 * The create/edit snippet dialog — two-panel layout (main editor + options sidebar).
 *
 * Open-state is driven by the UI store:
 *   - `newSnippetOpen === true`  → create mode
 *   - `editSnippetId` is a UUID  → edit mode, form is pre-populated
 *
 * The header "New snippet" button opens the dialog via the <DialogTrigger> wrapper.
 */
export function NewSnippetDialog() {
  const newOpen  = useUiStore((s) => s.newSnippetOpen);
  const editId   = useUiStore((s) => s.editSnippetId);
  const openNew  = useUiStore((s) => s.openNewSnippet);
  const closeNew = useUiStore((s) => s.closeNewSnippet);
  const closeEdit = useUiStore((s) => s.closeEditSnippet);

  const folders      = useSnippetStore((s) => s.folders);
  const snippets     = useSnippetStore((s) => s.snippets);
  const addSnippet              = useSnippetStore((s) => s.addSnippet);
  const editSnippetWithRevision = useSnippetStore((s) => s.editSnippetWithRevision);
  const removeSnippet           = useSnippetStore((s) => s.removeSnippet);

  const openHistory = useUiStore((s) => s.openHistory);

  const editingSnippet = useMemo(
    () => (editId ? snippets.find((s) => s.id === editId) ?? null : null),
    [editId, snippets],
  );
  const mode: 'create' | 'edit' = editingSnippet ? 'edit' : 'create';
  const open = mode === 'edit' ? editingSnippet !== null : newOpen;

  const [form, setForm] = useState<SnippetFormValues>(EMPTY_FORM);
  const [altQueryDraft, setAltQueryDraft] = useState('');
  const [editNote, setEditNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Auto-suggestions: derived from snippet name + trigger. Suggestions from
  // matching keyword rules that haven't been added yet are shown as one-click chips.
  const suggestedQueries = useMemo<string[]>(() => {
    const corpus = `${form.name} ${form.trigger}`.toLowerCase();
    if (!corpus.trim()) return [];
    const seen = new Set(form.alternative_queries);
    const out: string[] = [];
    for (const { pattern, suggestions } of KEYWORD_SUGGESTIONS) {
      if (pattern.test(corpus)) {
        for (const s of suggestions) {
          if (!seen.has(s) && !out.includes(s)) out.push(s);
        }
      }
    }
    return out.slice(0, 6); // cap at 6 so the UI stays compact
  }, [form.name, form.trigger, form.alternative_queries]);

  // Conflict detection: flag any tag that matches another snippet's primary trigger.
  const conflictingQueries = useMemo<Set<string>>(() => {
    const conflicts = new Set<string>();
    for (const tag of form.alternative_queries) {
      const collision = snippets.find(
        (s) => s.id !== editingSnippet?.id && s.triggers[0]?.toLowerCase() === tag.toLowerCase(),
      );
      if (collision) conflicts.add(tag);
    }
    return conflicts;
  }, [form.alternative_queries, snippets, editingSnippet]);

  // Reset form whenever the dialog opens (either mode) or the edit target changes.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError(null);
    setConfirmDelete(false);
    setEditNote('');
    setAltQueryDraft('');
    if (editingSnippet) {
      // Bodies map drives the textarea — start by trusting the snippet's
      // per-language map, with a fallback so legacy rows (no `bodies` yet)
      // still surface their existing single body under the active language.
      const initialBodies: SnippetFormValues['bodies'] = { ...editingSnippet.bodies };
      if (!initialBodies[editingSnippet.language]) {
        initialBodies[editingSnippet.language] = editingSnippet.content;
      }
      setForm({
        name:                 editingSnippet.name,
        trigger:              editingSnippet.triggers[0] ?? '',
        content:              initialBodies[editingSnippet.language] ?? '',
        bodies:               initialBodies,
        folder_id:            editingSnippet.folder_id,
        language:             editingSnippet.language,
        pinned:               editingSnippet.pinned,
        is_shared:            editingSnippet.is_shared,
        alternative_queries:  editingSnippet.alternative_queries,
        enable_urgency_timer: editingSnippet.enable_urgency_timer,
        timer_duration_ms:    editingSnippet.timer_duration_ms,
        scarcity_count:       editingSnippet.scarcity_count,
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [open, editingSnippet]);

  const contentRef = useRef<HTMLTextAreaElement | null>(null);

  // Insert `value` at the textarea cursor (or append if focus is elsewhere),
  // then re-focus so the user can keep typing without losing position.
  function insertAtCursor(value: string) {
    const el = contentRef.current;
    if (!el) {
      setForm((prev) => {
        const next = prev.content + value;
        return {
          ...prev,
          content: next,
          bodies: { ...prev.bodies, [prev.language]: next },
        };
      });
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end   = el.selectionEnd   ?? el.value.length;
    const next  = el.value.slice(0, start) + value + el.value.slice(end);
    setForm((prev) => ({
      ...prev,
      content: next,
      bodies: { ...prev.bodies, [prev.language]: next },
    }));
    // Restore cursor right after the inserted text on the next frame.
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + value.length;
      el.setSelectionRange(pos, pos);
    });
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
  }

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

  // Typing in the textarea writes to BOTH the active language slot and the
  // `content` mirror so the rest of the form (validation, submit) stays
  // consistent without re-reading bodies[language] everywhere.
  function updateBody(value: string) {
    setForm((prev) => ({
      ...prev,
      content: value,
      bodies: { ...prev.bodies, [prev.language]: value },
    }));
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
  }

  // Switching language: snapshot the current textarea into the OLD language's
  // slot, then load the NEW language's slot into the textarea. Untouched
  // languages keep whatever they had — no silent overwrites.
  function changeLanguage(nextLang: SnippetFormValues['language']) {
    setForm((prev) => {
      if (prev.language === nextLang) return prev;
      const snapshot = { ...prev.bodies, [prev.language]: prev.content };
      return {
        ...prev,
        language: nextLang,
        bodies: snapshot,
        content: snapshot[nextLang] ?? '',
      };
    });
    if (errors.language) setErrors((prev) => ({ ...prev, language: undefined }));
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
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
        // Every explicit "Save changes" creates a revision entry so the full
        // history is preserved. editSnippet is no longer called from the dialog.
        await editSnippetWithRevision(
          editingSnippet.id,
          parsed.data,
          editNote.trim() || undefined,
        );
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

      {/*
        Override defaults via tailwind-merge:
          max-w-lg  → max-w-[860px]
          p-6       → p-0
          gap-4     → gap-0
          grid      → flex flex-col
      */}
      <DialogContent className="max-w-[860px] p-0 gap-0 flex flex-col overflow-hidden max-h-[min(90vh,760px)]">

        {/* ── Dialog header ── */}
        <DialogHeader className="shrink-0 px-6 pt-6 pb-4 pr-14 border-b border-line">
          <DialogTitle>
            {mode === 'edit' ? 'Edit snippet' : 'Create snippet'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? 'Update the name, trigger, or body. Changes sync across every device.'
              : 'Give the snippet a name, a trigger, and a body. It will sync immediately.'}
          </DialogDescription>
        </DialogHeader>

        {/* ── Two-panel body ── */}
        {/*
          The <form> wraps both panels. The footer Submit button links to it via
          form="snippet-form" (HTML5 form association).
        */}
        <form
          id="snippet-form"
          onSubmit={onSubmit}
          noValidate
          className="flex flex-1 overflow-hidden min-h-0"
        >
          {/* ── LEFT PANEL: main editor ── */}
          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 min-w-0">

            {/* Name */}
            <div>
              <label htmlFor="snippet-name" className={FIELD_LABEL}>Name</label>
              <Input
                id="snippet-name"
                value={form.name}
                onChange={(e) => updateField('name', e.target.value)}
                placeholder="Quote — English"
                autoFocus
                disabled={saving}
                className={errors.name ? 'border-danger focus:border-danger focus:ring-danger/20' : ''}
              />
              {errors.name && <FieldError message={errors.name} />}
            </div>

            {/* Trigger + Folder */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="snippet-trigger" className={FIELD_LABEL}>Trigger</label>
                <Input
                  id="snippet-trigger"
                  value={form.trigger}
                  onChange={(e) => updateField('trigger', e.target.value)}
                  placeholder="quoteEN"
                  disabled={saving}
                  className={errors.trigger ? 'border-danger focus:border-danger focus:ring-danger/20' : ''}
                />
                {errors.trigger && <FieldError message={errors.trigger} />}
              </div>
              <div>
                <label htmlFor="snippet-folder" className={FIELD_LABEL}>Folder</label>
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
            </div>

            {/* Alternative Queries */}
            <div>
              <label className={FIELD_LABEL}>
                Alternative queries{' '}
                <span className="font-normal text-ink-subtle">— synonyms for context matching</span>
              </label>

              {/* Added tags */}
              {form.alternative_queries.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1.5">
                  {form.alternative_queries.map((q, idx) => {
                    const hasConflict = conflictingQueries.has(q);
                    return (
                      <span
                        key={idx}
                        title={hasConflict ? `"${q}" is already a primary trigger on another snippet` : undefined}
                        className={cn(
                          'inline-flex items-center gap-1 h-7 rounded-[6px] border px-2 text-xs font-medium',
                          hasConflict
                            ? 'border-warning/60 bg-warning/10 text-warning'
                            : 'border-primary-bdr bg-primary-bg text-primary',
                        )}
                      >
                        {hasConflict && <AlertCircle className="h-3 w-3 shrink-0" />}
                        {q}
                        <button
                          type="button"
                          disabled={saving}
                          aria-label={`Remove "${q}"`}
                          onClick={() =>
                            updateField(
                              'alternative_queries',
                              form.alternative_queries.filter((_, i) => i !== idx),
                            )
                          }
                          className={cn(
                            'transition-colors disabled:opacity-50',
                            hasConflict ? 'text-warning/60 hover:text-warning' : 'text-primary/60 hover:text-primary',
                          )}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Conflict warning banner */}
              {conflictingQueries.size > 0 && (
                <div className="flex items-start gap-1.5 rounded-[8px] border border-warning/40 bg-warning/8 px-2.5 py-2 text-xs text-warning mb-1.5">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
                  <span>
                    {conflictingQueries.size === 1
                      ? `"${[...conflictingQueries][0]}" matches another snippet's primary trigger — expansion may be ambiguous.`
                      : `${conflictingQueries.size} tags conflict with existing primary triggers — expansion may be ambiguous.`}
                  </span>
                </div>
              )}

              {/* Text input */}
              <Input
                id="snippet-alt-queries"
                value={altQueryDraft}
                onChange={(e) => setAltQueryDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const tag = altQueryDraft.trim().toLowerCase().replace(/,/g, '');
                    if (tag && !form.alternative_queries.includes(tag)) {
                      updateField('alternative_queries', [...form.alternative_queries, tag]);
                    }
                    setAltQueryDraft('');
                  } else if (e.key === 'Backspace' && altQueryDraft === '' && form.alternative_queries.length > 0) {
                    updateField(
                      'alternative_queries',
                      form.alternative_queries.slice(0, -1),
                    );
                  }
                }}
                placeholder={form.alternative_queries.length === 0 ? 'Type a keyword and press Enter or comma' : 'Add another keyword…'}
                disabled={saving}
              />

              {/* Auto-suggestions */}
              {suggestedQueries.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className="text-[10px] font-medium text-ink-subtle shrink-0">Suggested:</span>
                  {suggestedQueries.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        if (!form.alternative_queries.includes(s)) {
                          updateField('alternative_queries', [...form.alternative_queries, s]);
                        }
                      }}
                      className="inline-flex h-6 items-center rounded-[6px] border border-line bg-bg-alt px-2 text-[11px] text-ink-muted transition-colors hover:border-primary/40 hover:bg-primary-bg hover:text-primary disabled:opacity-50"
                    >
                      + {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex flex-col gap-1.5 flex-1">
              <label htmlFor="snippet-content" className={FIELD_LABEL}>
                Body{' '}
                <span className="font-normal text-ink-subtle">
                  — use <code className="font-mono text-primary/80">{'{variable}'}</code> for dynamic fields
                </span>
              </label>
              <textarea
                id="snippet-content"
                ref={contentRef}
                rows={12}
                value={form.content}
                onChange={(e) => updateBody(e.target.value)}
                disabled={saving}
                className={cn(
                  'w-full resize-none rounded-[10px] border border-line bg-card px-3.5 py-3 text-sm text-ink font-mono leading-relaxed placeholder:text-ink-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50',
                  errors.content && 'border-danger focus:border-danger focus:ring-danger/20',
                )}
                placeholder="Dear {guest_name}, …"
              />
              {errors.content && <FieldError message={errors.content} />}
            </div>

            {/* Quick insert */}
            <div>
              <span className={FIELD_LABEL}>Quick insert</span>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_INSERTS.map((qi) => (
                  <button
                    key={qi.label}
                    type="button"
                    onClick={() => insertAtCursor(qi.value)}
                    disabled={saving}
                    title={`Insert ${qi.value}`}
                    className={cn(
                      'inline-flex h-7 items-center rounded-[8px] border px-2.5 font-mono text-[11px] transition-colors disabled:opacity-50',
                      qi.variant === 'formula' && 'border-[#BED0FF] bg-[#EEF2FF] text-[#1B4FD8] hover:bg-[#E0EAFF]',
                      qi.variant === 'cond'    && 'border-[#B6E2F5] bg-[#E6F6FD] text-[#0E6F94] hover:bg-[#D2EEFA]',
                      qi.variant === 'default' && 'border-line bg-bg-alt text-ink-muted hover:bg-line/60 hover:text-ink',
                    )}
                  >
                    {qi.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Edit note — only shown in edit mode; recorded in version history */}
            {mode === 'edit' && (
              <div>
                <label htmlFor="snippet-edit-note" className={FIELD_LABEL}>
                  Edit note{' '}
                  <span className="font-normal text-ink-subtle">(optional)</span>
                </label>
                <Input
                  id="snippet-edit-note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder={'What changed? e.g. "Updated checkout wording"'}
                  disabled={saving}
                  maxLength={200}
                />
              </div>
            )}
          </div>

          {/* ── PANEL DIVIDER ── */}
          <div className="w-px bg-line shrink-0" />

          {/* ── RIGHT PANEL: language + options ── */}
          <div className="w-[240px] shrink-0 overflow-y-auto flex flex-col bg-bg">

            {/* Language picker — visual pill tabs matching the extension popup */}
            <div className="p-5 pb-4 border-b border-line">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-3">
                Language
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {LANG_PICKER.map((lang) => {
                  const cfg = LANG_CONFIG[lang];
                  const isActive = form.language === lang;
                  // Dot shown next to the label when this language already has
                  // body text saved (and it isn't the one currently being
                  // edited), so it's visible at a glance which slots are filled.
                  const hasContent = (form.bodies[lang] ?? '').length > 0;
                  const showDot = hasContent && !isActive;
                  return (
                    <button
                      key={lang}
                      type="button"
                      disabled={saving}
                      onClick={() => changeLanguage(lang)}
                      style={
                        isActive
                          ? { background: cfg.bg, color: cfg.fg, borderColor: cfg.bdr }
                          : undefined
                      }
                      className={cn(
                        'relative h-9 rounded-[8px] border text-sm font-semibold transition-all disabled:opacity-50',
                        isActive
                          ? 'shadow-sm'
                          : 'border-line bg-card text-ink-muted hover:bg-bg-alt hover:text-ink',
                      )}
                    >
                      {cfg.label}
                      {showDot && (
                        <span
                          aria-hidden
                          className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-primary"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Options */}
            <div className="flex-1 p-5 flex flex-col gap-2.5">
              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-0.5">
                Options
              </p>

              <OptionToggle
                id="snippet-urgency"
                icon={<Clock className="h-3.5 w-3.5" />}
                title="Urgency Timer"
                description="Countdown + scarcity"
                checked={form.enable_urgency_timer}
                onChange={(v) => updateField('enable_urgency_timer', v)}
                disabled={saving}
              />

              {form.enable_urgency_timer && (
                <div className="grid gap-2 pl-1 pb-0.5">
                  <div>
                    <label htmlFor="snippet-timer-minutes" className="block text-[11px] text-ink-muted mb-1">
                      Duration (minutes)
                    </label>
                    <Input
                      id="snippet-timer-minutes"
                      type="number"
                      min={0}
                      value={Math.round(form.timer_duration_ms / 60000)}
                      onChange={(e) =>
                        updateField(
                          'timer_duration_ms',
                          Math.max(0, Number(e.target.value) || 0) * 60000,
                        )
                      }
                      disabled={saving}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <label htmlFor="snippet-scarcity" className="block text-[11px] text-ink-muted mb-1">
                      Scarcity count
                    </label>
                    <Input
                      id="snippet-scarcity"
                      type="number"
                      min={0}
                      value={form.scarcity_count}
                      onChange={(e) =>
                        updateField('scarcity_count', Math.max(0, Number(e.target.value) || 0))
                      }
                      disabled={saving}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
              )}

              <OptionToggle
                id="snippet-share"
                icon={<Users className="h-3.5 w-3.5" />}
                title="Share with team"
                description="Visible via Notion"
                checked={form.is_shared}
                onChange={(v) => updateField('is_shared', v)}
                disabled={saving}
              />

              <OptionToggle
                id="snippet-pin"
                icon={<Pin className="h-3.5 w-3.5" />}
                title="Pin to top"
                description="Always shows first"
                checked={form.pinned}
                onChange={(v) => updateField('pinned', v)}
                disabled={saving}
              />
            </div>
          </div>
        </form>

        {/* ── Footer ── */}
        <div className="shrink-0 px-6 py-4 border-t border-line bg-card flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {mode === 'edit' && editingSnippet && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    closeEdit();
                    openHistory(editingSnippet.id);
                  }}
                  disabled={saving}
                  title="View version history"
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-line bg-card px-3 text-sm font-medium text-ink-muted transition-colors hover:bg-primary-light hover:text-primary hover:border-primary/30 disabled:opacity-50 shrink-0"
                >
                  <History className="h-3.5 w-3.5" />
                  History
                </button>
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={saving}
                  className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-danger/30 bg-danger/5 px-3 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50 shrink-0"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {confirmDelete ? 'Click again to confirm' : 'Delete'}
                </button>
              </>
            )}
            {submitError && (
              <div className="flex items-center gap-1.5 text-xs text-danger min-w-0">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{submitError}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              type="button"
              variant="ghost"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            {/* form= links this button to <form id="snippet-form"> above */}
            <Button type="submit" form="snippet-form" variant="primary" disabled={saving}>
              {saving ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create snippet'}
            </Button>
          </div>
        </div>

      </DialogContent>
    </Dialog>
  );
}

function FieldError({ message }: { message: string }) {
  return <p className="mt-1 text-xs text-danger">{message}</p>;
}

interface OptionToggleProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

function OptionToggle({
  id,
  icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: OptionToggleProps) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] border border-line bg-card p-3">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-bg-alt text-ink-muted">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-ink leading-tight">{title}</p>
        <p className="text-[11px] text-ink-subtle leading-tight mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className={cn(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-line',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition',
            checked ? 'translate-x-4' : 'translate-x-0',
          )}
        />
      </button>
    </div>
  );
}
