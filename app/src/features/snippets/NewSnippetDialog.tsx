import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Clock,
  History,
  MousePointerClick,
  Pencil,
  Pin,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { AssetAttribution } from '@/components/shared/AssetAttribution';
import { LabelPicker } from '@/features/labels/LabelPicker';
import { FormButtonDialog } from '@/features/snippets/FormButtonDialog';
import { FormMenuDialog } from '@/features/snippets/FormMenuDialog';
import { cn } from '@/lib/utils';
import {
  findMenuTokenAt,
  nextMenuName,
  parseFormMenuToken,
  type FormMenuConfig,
  type MenuTokenRange,
} from '@/lib/formMenuToken';
import { DEFAULT_TRIGGER_CONFIG, deriveTriggerFromName } from '@/lib/triggerUtils';
import { findLanguageMismatch } from '@/lib/languageDetect';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { useLabelStore } from '@/stores/labelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  snippetFormSchema,
  type SnippetFormValues,
} from '@/types/schemas';

// Each language is a first-class picker option with its own color (FR re-added v2.88.0).
const LANG_PICKER: SnippetFormValues['language'][] = ['EN', 'IT', 'ES', 'FR', 'MULTI'];

// Inline hex OK per CLAUDE.md — mirrors SnippetsTable.tsx language palette
const LANG_CONFIG: Record<
  SnippetFormValues['language'],
  { fg: string; bg: string; bdr: string; label: string }
> = {
  EN:    { fg: '#1B4FD8', bg: '#EEF2FF', bdr: '#BED0FF', label: 'EN' },
  IT:    { fg: '#15803D', bg: '#F0FDF4', bdr: '#86EFAC', label: 'IT' },
  ES:    { fg: '#C2410C', bg: '#FFF7ED', bdr: '#FDBA74', label: 'ES' },
  FR:    { fg: '#0D9488', bg: '#F0FDFA', bdr: '#99F6E4', label: 'FR' },
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
  alternative_queries: [],
  enable_urgency_timer: false,
  timer_duration_ms: 0,
  scarcity_count: 0,
};

/**
 * A snippet trigger is a bare token — the extension prepends the trigger prefix
 * (::) at match time (see content.js: `snippetTrigger + sc`), so it must never
 * be stored here. Strip anything that isn't a letter, number, hyphen, or
 * underscore so a prefix like `::` or a stray symbol can't be typed, pasted, or
 * carried over from a legacy row. Mirrors snippetFormSchema.trigger.
 */
function sanitizeTrigger(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

// Quick Insert: mirrors the Sprintbrain.html chip rail. Each entry inserts
// `value` at the cursor position in the body textarea.
//
// Grouped because the two halves behave differently and the flat row never said
// so: a `field` becomes an input to fill when the snippet expands, while `logic`
// resolves on its own.
//
// Every entry carries a `hint` — a token name is not an explanation, and `phone`
// inserting {phone_number} is only obvious once someone tells you.
interface QuickInsert {
  label: string;
  value: string;
  variant: 'default' | 'formula' | 'cond';
  group: 'field' | 'logic';
  hint: string;
}

const QUICK_INSERTS: QuickInsert[] = [
  { label: 'guest_name',    value: '{guest_name}',           variant: 'default', group: 'field',
    hint: "The guest's name — inserts {guest_name}" },
  { label: 'property_name', value: '{property_name}',        variant: 'default', group: 'field',
    hint: 'The property name — inserts {property_name}' },
  { label: 'checkin_date',  value: '{checkin_date}',         variant: 'default', group: 'field',
    hint: 'Arrival date — inserts {checkin_date}' },
  { label: 'checkout_date', value: '{checkout_date}',        variant: 'default', group: 'field',
    hint: 'Departure date — inserts {checkout_date}' },
  { label: 'total_price',   value: '{total_price}',          variant: 'default', group: 'field',
    hint: 'Total price of the stay — inserts {total_price}' },
  { label: 'nights',        value: '{nights}',               variant: 'default', group: 'field',
    hint: 'Number of nights — inserts {nights}' },
  { label: 'phone',         value: '{phone_number}',         variant: 'default', group: 'field',
    hint: 'Phone number — inserts {phone_number}' },
  { label: 'review_link',   value: '{review_link}',          variant: 'default', group: 'field',
    hint: 'Link to your review page — inserts {review_link}' },
  { label: '{=formula}',    value: '{=A - B}',               variant: 'formula', group: 'logic',
    hint: 'Calculate from other fields — e.g. {=OTA_PRICE - YOUR_PRICE}' },
  { label: '{if:cond}',     value: '{if:A > 0}text{endif}',  variant: 'cond',    group: 'logic',
    hint: 'Show text only when a condition is true — e.g. {if:NIGHTS > 3}…{endif}' },
];

const CHIP_GROUP_LABEL = 'block text-[11px] font-semibold text-ink-muted mb-1.5';

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
  const setSnippetLabels        = useLabelStore((s) => s.setSnippetLabels);

  const openHistory = useUiStore((s) => s.openHistory);

  // Snippet trigger prefix (e.g. "::") — a user setting, never hardcoded.
  // Shown as a leading affix on the Trigger field so the full shortcut
  // (prefix + token) is obvious at a glance. Mirrors ShortcutTag in SnippetsTable.
  const snippetPrefix =
    useSettingsStore((s) => s.profile?.trigger_snippet_seq) ||
    DEFAULT_TRIGGER_CONFIG.snippetTrigger;

  const editingSnippet = useMemo(
    () => (editId ? snippets.find((s) => s.id === editId) ?? null : null),
    [editId, snippets],
  );
  const mode: 'create' | 'edit' = editingSnippet ? 'edit' : 'create';
  const open = mode === 'edit' ? editingSnippet !== null : newOpen;

  const [form, setForm] = useState<SnippetFormValues>(EMPTY_FORM);
  // Labels are an association, not snippet content: they save alongside the
  // snippet but never enter the revision RPC, so assigning one doesn't create a
  // version entry. Hence local state rather than a SnippetFormValues field.
  const [labelIds, setLabelIds] = useState<string[]>([]);
  // Last trigger the name filled in. The trigger keeps following the name only
  // while it still equals this — the moment it doesn't, the user has typed
  // their own and owns it. A ref, not state: nothing renders from it.
  const autoTriggerRef = useRef('');
  const [altQueryDraft, setAltQueryDraft] = useState('');
  const [editNote, setEditNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Dropdown-menu field builder — writes a {formmenu:} token at the cursor.
  const [menuFieldOpen, setMenuFieldOpen] = useState(false);
  // Body caret, tracked so the menu chip can offer Edit when it sits inside a
  // {formmenu:} token. React's onSelect fires on plain caret moves, not only
  // on selections, which is what makes this cheap enough to keep in state.
  const [caret, setCaret] = useState(0);
  // The menu being edited: its range in the body plus the config the dialog
  // loads. Held in state so the object stays referentially stable while the
  // dialog is open — rebuilding it per render would reseed and wipe the edit.
  const [menuEdit, setMenuEdit] = useState<{ range: MenuTokenRange; cfg: FormMenuConfig } | null>(
    null,
  );
  // Action-button builder — writes a {button}…{/button} token at the cursor.
  const [actionButtonOpen, setActionButtonOpen] = useState(false);

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
    // A new form starts with the trigger unclaimed, so the name may fill it.
    autoTriggerRef.current = '';
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
        trigger:              sanitizeTrigger(editingSnippet.triggers[0] ?? ''),
        content:              initialBodies[editingSnippet.language] ?? '',
        bodies:               initialBodies,
        folder_id:            editingSnippet.folder_id,
        language:             editingSnippet.language,
        pinned:               editingSnippet.pinned,
        alternative_queries:  editingSnippet.alternative_queries,
        enable_urgency_timer: editingSnippet.enable_urgency_timer,
        timer_duration_ms:    editingSnippet.timer_duration_ms,
        scarcity_count:       editingSnippet.scarcity_count,
      });
      // Read once on open: the picker owns the draft from here, so a
      // background refresh can't stomp an in-progress edit.
      setLabelIds(useLabelStore.getState().snippetLabels.get(editingSnippet.id) ?? []);
    } else {
      setForm(EMPTY_FORM);
      setLabelIds([]);
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
    setCaret(start + value.length);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + value.length;
      el.setSelectionRange(pos, pos);
    });
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
  }

  // Swap the text between `start` and `end` for `value` — the edit path for a
  // token already in the body. Mirrors insertAtCursor's state update and caret
  // restore, so an edit and an insert leave the editor in the same shape.
  function replaceRange(start: number, end: number, value: string) {
    const el = contentRef.current;
    const source = el ? el.value : form.content;
    const next = source.slice(0, start) + value + source.slice(end);
    setForm((prev) => ({
      ...prev,
      content: next,
      bodies: { ...prev.bodies, [prev.language]: next },
    }));
    setCaret(start + value.length);
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + value.length;
        el.setSelectionRange(pos, pos);
      });
    }
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
  }

  // The {formmenu:} token the caret is sitting in, if any — this is what turns
  // the chip from "insert a menu" into "edit this menu".
  const menuAtCaret = useMemo(() => findMenuTokenAt(form.content, caret), [form.content, caret]);

  function openMenuBuilder() {
    const cfg = menuAtCaret ? parseFormMenuToken(menuAtCaret.raw) : null;
    setMenuEdit(menuAtCaret && cfg ? { range: menuAtCaret, cfg } : null);
    setMenuFieldOpen(true);
  }

  function submitMenuToken(token: string) {
    if (menuEdit) {
      const { start, end, raw } = menuEdit.range;
      // The body can't change behind a modal, but replacing a stale range would
      // overwrite unrelated text — confirm the range still holds that token.
      if (form.content.slice(start, end) === raw) {
        replaceRange(start, end, token);
        return;
      }
    }
    insertAtCursor(token);
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

  /**
   * Typing a name fills the trigger in, the way ACF fills Field Name from Field
   * Label — but only until the user takes the trigger over, and only on a new
   * snippet. An existing trigger is muscle memory and the grouping key for
   * language variants; renaming it because someone fixed a typo in the title
   * would silently break both.
   *
   * Clearing the trigger hands it back to the name, so there is a way out that
   * isn't "reopen the dialog".
   */
  function handleNameChange(value: string) {
    const syncing =
      mode === 'create' &&
      (form.trigger === '' || form.trigger === autoTriggerRef.current);
    const derived = syncing ? deriveTriggerFromName(value) : null;
    if (derived !== null) autoTriggerRef.current = derived;

    setForm((prev) => ({
      ...prev,
      name: value,
      ...(derived !== null ? { trigger: derived } : {}),
    }));
    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
    if (derived !== null && errors.trigger) {
      setErrors((prev) => ({ ...prev, trigger: undefined }));
    }
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

    // Guard the language flag before the body reaches a guest. `content` is the
    // active slot's live text and may be ahead of `bodies`, so check the merged
    // view — the same shape snippetsApi persists.
    const mismatch = findLanguageMismatch({
      ...parsed.data.bodies,
      [parsed.data.language]: parsed.data.content,
    });
    if (mismatch !== null) {
      // Bring the offending slot on screen. Saving writes every language at
      // once, so the fault can sit in a variant the user isn't looking at, and
      // an error about text they cannot see is not an error they can fix.
      if (mismatch.slot !== form.language) changeLanguage(mismatch.slot);
      setErrors({ content: mismatch.message });
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
        await setSnippetLabels(editingSnippet.id, labelIds);
        closeEdit();
      } else {
        const created = await addSnippet(parsed.data);
        // Only after the row exists — the link table has an FK to snippets.
        await setSnippetLabels(created.id, labelIds);
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
          max-w-lg  → max-w-[min(94vw,1100px)]
          p-6       → p-0
          gap-4     → gap-0
          grid      → flex flex-col

        Height is FIXED (not max-) so the flex column always fills it and the
        body textarea absorbs the slack — on target desktop viewports the left
        panel then has nothing to scroll. The panel keeps overflow-y as the
        safety valve for short windows, with the scrollbar chrome hidden
        (no-scrollbar) like the options rail (v2.129.0).
      */}
      <DialogContent className="max-w-[min(94vw,1100px)] p-0 gap-0 flex flex-col overflow-hidden h-[min(94vh,1020px)]">

        {/* ── Dialog header ── */}
        {/* Title and description share one line — the description is a short
            aside, and stacking it cost a full row of dialog height. */}
        <DialogHeader className="shrink-0 flex-row items-baseline gap-3 px-6 pt-4 pb-3 pr-14 border-b border-line">
          <DialogTitle className="shrink-0">
            {mode === 'edit' ? 'Edit snippet' : 'Create snippet'}
          </DialogTitle>
          <DialogDescription className="min-w-0 truncate">
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
          <div className="flex-1 overflow-y-auto no-scrollbar p-6 flex flex-col gap-3 min-w-0">

            {/* Name + Trigger + Folder — one row. None of the three needs the
                full panel width, and pairing them keeps the editor's vertical
                budget inside the dialog on a 1280×800 screen. */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="snippet-name" className={FIELD_LABEL}>Name</label>
                <Input
                  id="snippet-name"
                  value={form.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Quote — English"
                  autoFocus
                  disabled={saving}
                  className={errors.name ? 'border-danger focus:border-danger focus:ring-danger/20' : ''}
                />
                {errors.name && <FieldError message={errors.name} />}
              </div>
              <div>
                <label htmlFor="snippet-trigger" className={FIELD_LABEL}>Trigger</label>
                {/*
                  Input group: a leading affix box shows the configured prefix
                  (e.g. "::") so the full shortcut reads as prefix + token. The
                  border and focus ring live on the wrapper so the affix and the
                  input read as one control. The stored value stays a bare token.
                */}
                <div
                  className={cn(
                    'flex h-10 items-stretch overflow-hidden rounded-[12px] border border-line bg-card',
                    'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
                    errors.trigger && 'border-danger focus-within:border-danger focus-within:ring-danger/20',
                    saving && 'opacity-50',
                  )}
                >
                  <span
                    aria-hidden
                    title={`Your snippet prefix is "${snippetPrefix}". Full shortcut: ${snippetPrefix}${form.trigger || 'quoteEN'}`}
                    className="flex select-none items-center border-r border-line bg-bg-alt px-3 font-mono text-sm font-semibold text-ink-muted"
                  >
                    {snippetPrefix}
                  </span>
                  <input
                    id="snippet-trigger"
                    value={form.trigger}
                    onChange={(e) => updateField('trigger', sanitizeTrigger(e.target.value))}
                    placeholder="quoteEN"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoCorrect="off"
                    disabled={saving}
                    className="min-w-0 flex-1 bg-transparent px-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none disabled:cursor-not-allowed"
                  />
                </div>
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
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Labels — the shared snippet/prompt vocabulary (LABELS-001) */}
            <div>
              <label htmlFor="snippet-labels" className={FIELD_LABEL}>
                Labels{' '}
                <span className="font-normal text-ink-subtle">— shared with prompts</span>
              </label>
              <div className="max-w-md">
                <LabelPicker
                  id="snippet-labels"
                  value={labelIds}
                  onChange={setLabelIds}
                  disabled={saving}
                />
              </div>
            </div>

            {/* Alternative Queries */}
            <div>
              <label className={FIELD_LABEL}>
                Alternative queries{' '}
                <span className="font-normal text-ink-subtle">— synonyms for context matching</span>
                {mode === 'edit' && (
                  <span
                    className="ml-1.5 font-normal text-ink-subtle"
                    title="This field is per-language variant. To apply the same queries to EN, IT, ES versions of this snippet, open each variant and save — the extension's language picker will fire automatically once any variant matches."
                  >
                    ⓘ per variant
                  </span>
                )}
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
                className="max-w-md"
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

            {/* Body — the panel's flexible element: it absorbs whatever height
                the fixed-size dialog has to spare, and shrinks (never below
                min-h) before the panel resorts to scrolling. The wrapper's
                min-h must cover label + gap + the textarea's own 200px floor,
                or the textarea escapes the wrapper and runs under the chips. */}
            <div className="flex flex-col gap-1.5 flex-1 min-h-[190px]">
              <label htmlFor="snippet-content" className={FIELD_LABEL}>
                Body
              </label>
              <textarea
                id="snippet-content"
                ref={contentRef}
                rows={12}
                value={form.content}
                onChange={(e) => {
                  updateBody(e.target.value);
                  setCaret(e.currentTarget.selectionStart);
                }}
                // Caret position decides whether the menu chip inserts or edits.
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                disabled={saving}
                className={cn(
                  'w-full flex-1 min-h-[160px] resize-none rounded-[10px] border border-line bg-card px-3.5 py-3 text-sm text-ink font-mono leading-relaxed placeholder:text-ink-subtle focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-50',
                  errors.content && 'border-danger focus:border-danger focus:ring-danger/20',
                )}
                placeholder="Dear {guest_name}, …"
              />
              {errors.content && <FieldError message={errors.content} />}
            </div>

            {/* Quick insert — split so the rail says what each half does */}
            <div className="flex flex-col gap-3">
              <div>
                <span className={CHIP_GROUP_LABEL}>
                  Fields{' '}
                  <span className="font-normal text-ink-subtle">
                    — filled in when the snippet expands · type{' '}
                    <code className="font-mono text-primary/80">{'{any_name}'}</code> for your own
                  </span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_INSERTS.filter((qi) => qi.group === 'field').map((qi) => (
                    <QuickChip key={qi.label} item={qi} disabled={saving} onInsert={insertAtCursor} />
                  ))}

                  {/* Field builders open a dialog instead of pasting a literal —
                      a menu needs its options before the token means anything.
                      With the caret inside a menu the same chip edits it, so
                      changing the choices never means retyping raw token text. */}
                  <button
                    type="button"
                    onClick={openMenuBuilder}
                    disabled={saving}
                    title={
                      menuAtCaret
                        ? 'Edit the menu the cursor is in — its choices load into the builder'
                        : 'A list of choices to pick from — opens the builder. Put the cursor inside an existing menu to edit it.'
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-primary/30 bg-primary-light px-2.5 font-mono text-[11px] text-primary transition-colors hover:border-primary/50 disabled:opacity-50"
                  >
                    {menuAtCaret ? (
                      <Pencil className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                    {menuAtCaret ? 'Edit menu' : '{formmenu}'}
                  </button>
                </div>
              </div>

              {/* Actions and Logic are one and two chips — side by side they
                  cost one row instead of two, which is what lets the whole
                  panel fit without scrolling on target viewports. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className={CHIP_GROUP_LABEL}>
                    Actions{' '}
                    <span className="font-normal text-ink-subtle">
                      — clicked while filling; never print
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setActionButtonOpen(true)}
                      disabled={saving}
                      title="Build an action button — changes field values when clicked"
                      className="inline-flex h-7 items-center gap-1 rounded-[8px] border border-primary/30 bg-primary-light px-2.5 font-mono text-[11px] text-primary transition-colors hover:border-primary/50 disabled:opacity-50"
                    >
                      <MousePointerClick className="h-3 w-3" />
                      {'{button}'}
                    </button>
                  </div>
                </div>

                <div>
                  <span className={CHIP_GROUP_LABEL}>
                    Logic{' '}
                    <span className="font-normal text-ink-subtle">
                      — worked out on its own
                    </span>
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_INSERTS.filter((qi) => qi.group === 'logic').map((qi) => (
                      <QuickChip key={qi.label} item={qi} disabled={saving} onInsert={insertAtCursor} />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <FormMenuDialog
              open={menuFieldOpen}
              onOpenChange={setMenuFieldOpen}
              suggestedName={nextMenuName(form.content)}
              initial={menuEdit?.cfg ?? null}
              onSubmit={submitMenuToken}
            />

            <FormButtonDialog
              open={actionButtonOpen}
              onOpenChange={setActionButtonOpen}
              onInsert={insertAtCursor}
            />

          </div>

          {/* ── PANEL DIVIDER ── */}
          <div className="w-px bg-line shrink-0" />

          {/* ── RIGHT PANEL: language + options ── */}
          <div className="w-[260px] shrink-0 overflow-y-auto no-scrollbar flex flex-col bg-bg">

            {/* Language picker — visual pill tabs matching the extension popup */}
            <div className="p-4 border-b border-line">
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
                        // Multi is the odd one out — span both columns so it fills the row.
                        lang === 'MULTI' && 'col-span-2',
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
            <div className="flex-1 p-4 flex flex-col gap-2.5">
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
                id="snippet-pin"
                icon={<Pin className="h-3.5 w-3.5" />}
                title="Pin to top"
                description="Always shows first"
                checked={form.pinned}
                onChange={(v) => updateField('pinned', v)}
                disabled={saving}
              />
            </div>

            {/* Edit note — recorded in version history. Lives in the rail (not
                the editor panel) so the left column fits without scrolling on
                target viewports; the rail has the spare height. */}
            {mode === 'edit' && (
              <div className="shrink-0 border-t border-line p-4">
                <label
                  htmlFor="snippet-edit-note"
                  className="block text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-2.5"
                >
                  Edit note <span className="font-normal normal-case tracking-normal text-ink-subtle">(optional)</span>
                </label>
                <Input
                  id="snippet-edit-note"
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  placeholder={'What changed?'}
                  disabled={saving}
                  maxLength={200}
                  className="h-9 text-xs"
                />
              </div>
            )}

            {/* Attribution — who created / last touched this snippet */}
            {mode === 'edit' && editingSnippet && (
              <div className="shrink-0 border-t border-line p-4">
                <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-widest mb-2.5">
                  About
                </p>
                <AssetAttribution
                  createdBy={editingSnippet.user_id}
                  updatedBy={editingSnippet.updated_by}
                  updatedAt={editingSnippet.updated_at}
                />
              </div>
            )}
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

function QuickChip({
  item,
  disabled,
  onInsert,
}: {
  item: QuickInsert;
  disabled: boolean;
  onInsert: (value: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onInsert(item.value)}
      disabled={disabled}
      title={item.hint}
      className={cn(
        'inline-flex h-7 items-center rounded-[8px] border px-2.5 font-mono text-[11px] transition-colors disabled:opacity-50',
        item.variant === 'formula' && 'border-[#BED0FF] bg-[#EEF2FF] text-[#1B4FD8] hover:bg-[#E0EAFF]',
        item.variant === 'cond'    && 'border-[#B6E2F5] bg-[#E6F6FD] text-[#0E6F94] hover:bg-[#D2EEFA]',
        item.variant === 'default' && 'border-line bg-bg-alt text-ink-muted hover:bg-line/60 hover:text-ink',
      )}
    >
      {item.label}
    </button>
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
      <Switch
        id={id}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="mt-0.5"
      />
    </div>
  );
}
