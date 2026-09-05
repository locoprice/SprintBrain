import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CalendarClock,
  Eye,
  History,
  Info,
  Languages,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
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
import { Toggle, ToggleGroup } from '@/components/ui/toggle';
import { AssetAttribution } from '@/components/shared/AssetAttribution';
import { LabelPicker } from '@/features/labels/LabelPicker';
import {
  LABEL_SUGGESTIONS_ENABLED,
  LabelSuggestions,
} from '@/features/labels/LabelSuggestions';
import { FormButtonDialog } from '@/features/snippets/FormButtonDialog';
import { FormMenuDialog } from '@/features/snippets/FormMenuDialog';
import { FormNumberDialog } from '@/features/snippets/FormNumberDialog';
import { FormTextDialog } from '@/features/snippets/FormTextDialog';
import { FormTimeDialog } from '@/features/snippets/FormTimeDialog';
import { SnippetPreview } from '@/features/snippets/SnippetPreview';
import { cn, countWords } from '@/lib/utils';
import {
  findMenuTokenAt,
  nextMenuName,
  parseFormMenuToken,
  type FormMenuConfig,
  type MenuTokenRange,
} from '@/lib/formMenuToken';
import { nextTextName } from '@/lib/formTextToken';
import { nextNumberName } from '@/lib/formNumberToken';
import {
  buildFormDateToken,
  DATE_FORMAT_OPTIONS,
  DEFAULT_DATE_FORMAT,
  DEFAULT_TIME_FORMAT,
  nextDateName,
  TIME_FORMAT_OPTIONS,
  type DateFormat,
  type TimeFormat,
} from '@/lib/formDateToken';
import { clearBodySlot, setBodySlot } from '@/lib/snippetBodies';
import { translateApi, type TranslateTarget } from '@/lib/api/translateApi';
import { DEFAULT_TRIGGER_CONFIG, deriveTriggerFromName } from '@/lib/triggerUtils';
import { slotMismatchMessage, snippetMismatch } from '@/lib/languageDetect';
import { useSnippetStore } from '@/stores/snippetStore';
import { useUiStore } from '@/stores/uiStore';
import { useMinWidth } from '@/lib/useViewportGate';
import { useLabelStore } from '@/stores/labelStore';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  snippetFormSchema,
  type SnippetFormValues,
} from '@/types/schemas';

// Each language is a first-class picker option with its own color (FR re-added v2.88.0).
const LANG_PICKER: SnippetFormValues['language'][] = ['EN', 'IT', 'ES', 'FR', 'MULTI'];

// The width at which the dialog can afford its third panel: 839px of rail and
// editor plus the preview's 321px, with 94vw to spare for the backdrop.
const PREVIEW_MIN_WIDTH = 1280;

/**
 * A snippet name is read back as plain text everywhere else: the extension
 * picker, the popup list, the mobile rows, each of which lays the name out in
 * a fixed-height line that a pictograph breaks. Emoji and the joiners, keycaps,
 * flags and skin tones that build them are dropped as they are typed or
 * pasted. Letters in any script, digits, spaces and punctuation pass through.
 */
const NAME_EMOJI =
  /[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Emoji_Modifier}\u{FE0F}\u{20E3}\u{200D}]/gu;

function sanitizeName(value: string): string {
  return value.replace(NAME_EMOJI, '');
}

/**
 * Alternative queries are stored on the row being edited, not on the language
 * group, which is the one thing about the field a user cannot see.
 */
const VARIANT_HINT =
  'These queries belong to this language variant only. To use the same ones in ' +
  'EN, IT or ES, open each variant and save. The language picker fires as soon ' +
  'as any variant matches.';

/**
 * What Multi is for, on the button itself. The four language slots explain
 * themselves; Multi does not, and the two things a user cannot guess are that
 * it holds a single mixed body and that no language check runs on it.
 */
const MULTI_HINT =
  'One body, any mix of languages. No language check here. ' +
  'Use EN, IT, ES or FR for separate translations.';

// The body placeholder's opening word in the language the tab is set to, so an
// empty EN slot doesn't sit there suggesting "Dear" for an Italian message.
// Same address words as GENDER_WORDS' unmarked (masculine) form in
// extension/formula-engine.js (Caro / Querido / Cher) — reused, not invented,
// so the placeholder and the {gender:} chip never disagree on the word.
// MULTI carries no single language, so it falls back to English like
// {greeting} does for the same slot.
const BODY_PLACEHOLDER: Record<SnippetFormValues['language'], string> = {
  EN:    'Dear {first_name}, …',
  IT:    'Caro {first_name}, …',
  ES:    'Querido {first_name}, …',
  FR:    'Cher {first_name}, …',
  MULTI: 'Dear / Caro / Querido {first_name}, …',
};

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
 * How long the body must sit still before the language check gives a verdict.
 *
 * The check needs a few words before it says anything, so running it per
 * keystroke would judge half-typed sentences and flash a message the next
 * letter retracts. Waiting for a pause means the verdict lands between
 * thoughts rather than mid-word.
 */
const LANGUAGE_CHECK_DELAY_MS = 500;

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

// The rail was a row of Quick Insert chips until v3.14.4: one token per chip,
// its whole explanation in a hover title. Every one of them is now a toggle
// that says what the token does before it writes it, which is why no chip list
// survives here. Note this no longer mirrors the Sprintbrain.html chip rail:
// that surface still shows the five original field chips.
//
// Everything the rail offers has to read as built for the reader's own trade,
// whichever that is: a clinic, a repair shop and a law firm each open it and
// find their own words. So nothing here names an industry (see the root
// CLAUDE.md).
//
// Names the chip rail once shipped and no longer does: guest_name and
// property_name went in v2.150.0, then `nights`, `phone` and `review_link`.
// None of them meant anything to the engine — each resolved to a plain text
// field the {formtext} builder writes by name — and bodies already holding
// {phone_number} or {review_link} keep working untouched, since an unrecognised
// name has always fallen through to a text field.

const SIDEBAR_LABEL = 'text-[10px] font-semibold text-ink-muted uppercase tracking-widest';

// Avada centres tooltip text inside 200px, so this says what a field IS and
// sends the reader to the group for the rest. Each group already carries its
// own description and per-input instructions; repeating them here would give
// us two copies to keep in step and an unreadable wall of centred text.
const FIELDS_HINT =
  'A field is a blank you fill in when the snippet expands. Insert one from a group below and it becomes a box in the fill form. Open a group to see what it does.';

// The other two groups answer the same question about themselves, in the same
// three beats: what the thing is, what it does to the message, and where to
// look next. Each opens with the line that used to sit under the heading in
// the rail itself — the rail is 260px wide and every line spent explaining it
// is a line the toggles do not get, so the explanation lives on hover and the
// column stays a column of things you can click.
const ACTIONS_HINT =
  'Clicked while filling. Never printed. An action changes the values in the form as you work, so a figure you would otherwise reach for a calculator to get lands in one click. Open one below to see what it does.';
const LOGIC_HINT =
  'Worked out on its own. A total, a line that only shows sometimes, the greeting the hour calls for: logic resolves as the snippet expands, with nothing for anyone to fill in. Open one below to see what it does.';

// The four inputs the menu builder actually offers, so the rail explains the
// dialog before it opens rather than after.
// A number field is the one type that carries a guarantee rather than a
// picker: whatever is typed is a number by the time a formula reads it, or the
// formula refuses to answer instead of quietly treating it as zero.
const NUMBER_FIELDS: { label: string; hint: string }[] = [
  { label: 'Name',
    hint: 'What the field is called in the fill form, and how a formula refers to it. Arrives prefilled with the next free NUM_n.' },
  { label: 'Format',
    hint: 'Plain, Currency or Percent. It changes how the value prints, never the number a formula reads.' },
  { label: 'Default',
    hint: 'Optional. Left blank the field opens empty, which is not the same as starting at 0.' },
];

// The three inputs FormButtonDialog offers, named as it names them, so opening
// the builder holds no surprises. `What it does` keeps the builder's own
// wording rather than a tidier one-word label: it is the input that decides
// whether the button does anything at all.
const BUTTON_FIELDS: { label: string; hint: string }[] = [
  { label: 'Label',
    hint: 'The text on the button. Left blank it reads Run.' },
  { label: 'What it does',
    hint: 'Each line sets one field to the result of an expression. Later lines see the earlier results, so one can feed the next.' },
  { label: 'Spacing',
    hint: 'Whether the button trims the space around it. On a line of its own it leaves a blank line behind unless it does.' },
];

// The urgency timer is the one entry in the rail that carries a value rather
// than inserting something, so its panel explains a mechanism instead of a
// token. All three lines describe what extension/content/content.js actually
// does: the expiry is held per snippet in sessionStorage (reopening does not
// restart it), the scarcity chip is hidden at 0, and on expiry the bar and the
// Insert button both go dead.
const URGENCY_FIELDS: { label: string; hint: string }[] = [
  { label: 'Duration',
    hint: 'How long the countdown runs, in minutes. It starts the first time the snippet is opened, and reopening it does not restart the clock.' },
  { label: 'Scarcity count',
    hint: 'Optional. Shown beside the timer as how many are left. Left at 0, nothing is shown.' },
  { label: 'Expiry',
    hint: 'When it runs out the bar marks the snippet expired and the Insert button stops working, so nothing goes out on terms that have lapsed.' },
];

const MENU_FIELDS: { label: string; hint: string }[] = [
  { label: 'Values',
    hint: 'The options the menu offers. Tick one to preselect it.' },
  { label: 'Selection',
    hint: 'Single Choice fills as radio buttons, Multiple Choice as checkboxes.' },
  { label: 'Name',
    hint: 'Optional. Only needed if the body reads the choice back; leave it blank and the menu still works.' },
];

// One date and one time, each with the format it prints in. The group used to
// offer a fixed {start_date} and {end_date} instead, which answered the wrong
// question twice: both were plain calendars, neither could say how the date
// should read, and a snippet needing three dates had nothing to insert. A range
// is now what it always was underneath — the same field inserted twice, DATE_1
// opening it and DATE_2 closing it.
//
// The formats are the engine's own DATE_FORMATS / TIME_FORMATS. Samples rather
// than pattern strings do the explaining: the two numeric orders are
// indistinguishable on paper until you see a day past the twelfth in the first
// slot, which is exactly the mistake this dropdown exists to prevent.
const DATE_TIME_FIELDS: { label: string; hint: string }[] = [
  { label: 'Date',
    hint: 'Opens a calendar when the snippet expands. Insert it twice for a range — the second one arrives as DATE_2.' },
  { label: 'Time',
    hint: 'Opens a clock. 12-hour prints the AM or PM alongside, so a time can never be read as the wrong half of the day.' },
  { label: 'Format',
    hint: 'How the value prints. It changes the reading, never the value: a formula and {datetimediff} still see the date the picker set.' },
  { label: 'Automatic',
    hint: 'Not a field — a date worked out at expansion, with the time pinned. Count forward from today, or land on a named day like next Monday.' },
];

// What the Formula toggle writes. A and B are deliberately meaningless: the
// author replaces them with their own field names, and a placeholder that
// looked like a real name would invite leaving it there.
const FORMULA_TOKEN = '{=A - B}';

// The parts of a formula, in the order the author meets them. There is no
// builder dialog behind this one — the token lands in the body ready to edit —
// so this list is the only place the rail can say what an expression may hold.
// Everything here is the engine's own vocabulary (extension/formula-engine.js:
// FUNS, safeEval, evalFormula), not a superset of it.
const FORMULA_FIELDS: { label: string; hint: string }[] = [
  { label: 'Fields',
    hint: 'Refer to a field by its name. Number fields are the ones a formula can always read, since a text field may hold anything.' },
  { label: 'Operators',
    hint: '+, -, * and / with brackets, plus round(), floor(), ceil(), abs(), min() and max(). The answer is rounded to two decimals.' },
  { label: 'Result',
    hint: 'Prints where the token sits. A field holding something that is not a number prints nothing at all, rather than a wrong total.' },
];

// A > 0 is the safest opening condition to hand someone: it is true of any
// filled number field, so the inserted block prints its text rather than
// vanishing while the author is still reading it.
const CONDITION_TOKEN = '{if:A > 0}text{endif}';

// The parts of a conditional block. The nesting note is not a style
// preference: resolveBody closes a block at the FIRST {endif} it finds
// (extension/formula-engine.js), so an inner block ends the outer one early.
const CONDITION_FIELDS: { label: string; hint: string }[] = [
  { label: 'Condition',
    hint: 'What has to be true. Numbers compare with >, <, >=, <=, == and !=; text with = or != against a value in quotes, like PLAN = "annual".' },
  { label: 'Branches',
    hint: 'Optional. {elseif: …} adds another case and {else} covers the rest. The first one that is true prints, and the others are dropped.' },
  { label: 'End',
    hint: '{endif} closes the block, and the first one found closes it — so a block cannot sit inside another. Leave it out and the text never prints.' },
];

const GREETING_TOKEN = '{greeting}';

// Hours, languages and options are the engine's own (GREETING_WORDS,
// sbGreetingSlot, sbResolveGreetingToken). The four thresholds are worth
// printing rather than summarising as "the time of day": whether 18:00 reads as
// afternoon or evening is exactly what an author checking this wants to know.
const GREETING_FIELDS: { label: string; hint: string }[] = [
  { label: 'Time',
    hint: 'Read from the clock where the snippet expands: morning from 5, afternoon from 12, evening from 18, night from 22.' },
  { label: 'Language',
    hint: 'Follows the snippet’s own language — English, Italian, Spanish or French. Force one with {greeting: lang=ES}.' },
  { label: 'Wording',
    hint: 'Optional. Replace any of the four with your own, like {greeting: morning=Hi there}. Declared empty, it prints nothing.' },
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
  const setSnippetLabels        = useLabelStore((s) => s.setSnippetLabels);

  const openHistory = useUiStore((s) => s.openHistory);

  // Live preview panel — remembered per device, so closing it makes it stay closed.
  const previewWanted  = useUiStore((s) => s.snippetPreviewOpen);
  // Three panels need 1156px and a 1024px screen gives the dialog 963, which
  // left the editor 439px — the panel being edited, squeezed by the two that
  // frame it. Below 1280 the preview stands down. The stored preference is
  // untouched, so it comes back the moment the window is wide enough.
  const previewFits    = useMinWidth(PREVIEW_MIN_WIDTH);
  const previewOpen    = previewWanted && previewFits;
  const setPreviewOpen = useUiStore((s) => s.setSnippetPreviewOpen);

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
  // Language verdict for the slot currently on screen, recomputed as the user
  // types. Separate from `errors` because nothing here came from a submit: it
  // must not survive a language switch or block anything on its own.
  const [liveLanguageError, setLiveLanguageError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Clear is armed by the first click and fires on the second, the same
  // two-step Delete uses. Wiping a translation is not undoable from here.
  const [confirmClear, setConfirmClear] = useState(false);
  // Translate: in flight, and the last failure. Overwriting a translation that
  // already has text is armed by a first click the same way Clear is, since it
  // replaces work the user may have written by hand.
  const [translating, setTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [confirmTranslate, setConfirmTranslate] = useState(false);
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
  // Automatic-date builder — writes a {time:} token at the cursor. A dialog and
  // not a rail control: the day and the time are two independent decisions and
  // want two columns, which 260px cannot give them.
  const [autoDateOpen, setAutoDateOpen] = useState(false);
  // Date/Time builder — the format each of the two tokens is written with.
  // Inline state rather than a dialog: one dropdown is not worth a modal, and
  // seeing the choice next to the button is the whole point of it.
  const [dateFormat, setDateFormat] = useState<DateFormat>(DEFAULT_DATE_FORMAT);
  const [timeFormat, setTimeFormat] = useState<TimeFormat>(DEFAULT_TIME_FORMAT);
  // Text-field builder — writes a {formtext:} token at the cursor.
  const [textFieldOpen, setTextFieldOpen] = useState(false);
  // Number-field builder — writes a number token at the cursor. Its own type in
  // the rail; that it shares {formtext:}'s spelling is an engine constraint.
  const [numberFieldOpen, setNumberFieldOpen] = useState(false);
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
    setConfirmClear(false);
    setEditNote('');
    setAltQueryDraft('');
    // A new form starts with the trigger unclaimed, so the name may fill it.
    autoTriggerRef.current = '';
    if (editingSnippet) {
      // Bodies map drives the textarea — start by trusting the snippet's
      // per-language map, with a fallback so legacy rows (no `bodies` yet)
      // still surface their existing single body under the active language.
      const initialBodies: SnippetFormValues['bodies'] = { ...editingSnippet.bodies };
      // Guarded on a non-empty body: a row whose active language is blank must
      // open with that slot absent, not seeded with an empty string.
      if (!initialBodies[editingSnippet.language] && editingSnippet.content.length > 0) {
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

  // Check the body against its own flag while it is being written, so a wrong
  // language is caught in the sentence that caused it rather than sprung at
  // save time — by then the user has finished, and the fix is a re-read of
  // text they thought was done.
  //
  // Only the slot on screen is judged here: an error about a variant the user
  // cannot see has nothing to act on, so the other slots stay with the submit
  // guard, which can switch the picker to them.
  const bodyText = form.content;
  const bodyLanguage = form.language;
  useEffect(() => {
    const pending = slotMismatchMessage(bodyText, bodyLanguage);
    // Only a complaint waits for the pause. Clearing is immediate, so text
    // that stops being wrong — reworded, emptied, or a language switch landing
    // on a slot whose body already fits — drops the message on the spot rather
    // than half a second later.
    if (pending === null) {
      setLiveLanguageError(null);
      return;
    }
    const timer = window.setTimeout(() => setLiveLanguageError(pending), LANGUAGE_CHECK_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [bodyText, bodyLanguage]);

  // One fault, one presentation. A submit error wins because it can be a
  // schema complaint the live check knows nothing about (an empty body); with
  // none pending, the live verdict speaks. Both render the same — a wrong
  // language blocks the save whether it was noticed while typing or at submit.
  const contentError = errors.content ?? liveLanguageError;

  // Derived, not state: recomputing a split on every keystroke is cheaper than
  // keeping a second copy of the body in sync with it. Counts the active
  // language's body, so it follows the language pill on a translated snippet.
  const bodyWordCount = countWords(form.content);

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

  // What the Date button will write next. Shown under the two dropdowns so the
  // author reads the token, and the name it claims, before it is in the body.
  const dateTokenPreview = useMemo(
    () =>
      buildFormDateToken({
        name: nextDateName(form.content, 'date'),
        kind: 'date',
        format: dateFormat,
      }),
    [form.content, dateFormat],
  );

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
  function handleNameChange(raw: string) {
    const value = sanitizeName(raw);
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
      bodies: setBodySlot(prev.bodies, prev.language, value),
    }));
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
    // Typing disarms Clear: one left armed from before the edit would otherwise
    // wipe text the user has just written on a single click.
    if (confirmClear) setConfirmClear(false);
    // Same reasoning for Translate, which also overwrites the slot.
    if (confirmTranslate) setConfirmTranslate(false);
    if (translateError) setTranslateError(null);
  }

  // Switching language: snapshot the current textarea into the OLD language's
  // slot, then load the NEW language's slot into the textarea. Untouched
  // languages keep whatever they had — no silent overwrites.
  function changeLanguage(nextLang: SnippetFormValues['language']) {
    setForm((prev) => {
      if (prev.language === nextLang) return prev;
      // setBodySlot, not a spread: a slot the user emptied must leave the map
      // rather than travel with it as '' and come back as a blank translation.
      const snapshot = setBodySlot(prev.bodies, prev.language, prev.content);
      return {
        ...prev,
        language: nextLang,
        bodies: snapshot,
        content: snapshot[nextLang] ?? '',
      };
    });
    if (errors.language) setErrors((prev) => ({ ...prev, language: undefined }));
    if (errors.content) setErrors((prev) => ({ ...prev, content: undefined }));
    setConfirmClear(false);
    setConfirmTranslate(false);
    setTranslateError(null);
  }

  /**
   * Wipe the language currently on screen. The slot is deleted from `bodies`,
   * not blanked, so the save writes a row that never carried the translation
   * and every reader (extension, mobile, Notion push) sees one fewer language.
   * Other languages are untouched, and nothing is written until Save.
   */
  function clearActiveLanguage() {
    setForm((prev) => ({
      ...prev,
      content: '',
      bodies: clearBodySlot(prev.bodies, prev.language),
    }));
    setErrors((prev) => ({ ...prev, content: undefined }));
    setLiveLanguageError(null);
    setConfirmClear(false);
    setConfirmTranslate(false);
    setTranslateError(null);
    contentRef.current?.focus();
  }

  /**
   * Fill the language on screen by translating the English body (TRANSLATE-001).
   *
   * English is the source, always: it is the language the product treats as
   * primary, and translating a translation compounds whatever the first pass
   * got wrong. So the button reads from `bodies.EN` rather than from whatever
   * happens to be in the textarea.
   *
   * Placeholders are protected server-side — the model never sees a
   * SprintBrain token, and a reply that altered one is refused before it
   * reaches this function. That is why the result can be written straight into
   * the slot with no further checking here.
   *
   * Nothing is saved. The translation lands in the textarea as a draft the user
   * reads, edits and then saves, exactly as if they had typed it.
   */
  async function translateFromEnglish() {
    const target = form.language;
    if (target === 'EN' || target === 'MULTI') return;

    const source = (form.bodies.EN ?? '').trim();
    if (source.length === 0) return;

    // Overwriting existing text takes two clicks, the same as Clear. The first
    // click only arms it.
    if (form.content.length > 0 && !confirmTranslate) {
      setConfirmTranslate(true);
      return;
    }

    setTranslating(true);
    setTranslateError(null);
    setConfirmTranslate(false);
    try {
      const translated = await translateApi.translateBody(source, target as TranslateTarget);
      updateBody(translated);
      contentRef.current?.focus();
    } catch (err) {
      setTranslateError(err instanceof Error ? err.message : 'Translation failed. Try again.');
    } finally {
      setTranslating(false);
    }
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

    // Guard the language flag before the body reaches a reader. Returns null
    // for a MULTI snippet, which is a deliberate mix and has no single correct
    // language — see snippetMismatch.
    const mismatch = snippetMismatch(
      parsed.data.language,
      parsed.data.bodies,
      parsed.data.content,
    );
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
        Override the component defaults: p-6 → p-0, gap-4 → gap-0, grid → flex
        flex-col, and max-w-lg via the inline maxWidth below.

        Height is FIXED (not max-) so the flex column always fills it and the
        body textarea absorbs the slack. The left rail scrolls when it has to:
        Edit mode adds Edit note and About to it, and with the urgency fields
        expanded that overflows even a full-height dialog.

        Opening the preview grows the dialog by 321px while the preview panel
        itself takes only 261px (it matches the 260px insert rail), so the 60px
        difference falls to the editor: opening the preview costs the body
        textarea nothing and the two rails frame it evenly.
        Both widths stay under 94vw; on a screen too narrow to hold the third
        panel the center panel gives up the difference, which is what the
        toggle is for — and the choice is remembered per device.
      */}
      <DialogContent
        className="p-0 gap-0 flex flex-col overflow-hidden h-[min(94vh,1020px)]"
        // Width = the panels actually on screen: the 260px insert rail, the
        // editor, and 321px more when the preview is open (see above: the
        // preview itself is 261px of that). An inline value rather than two
        // Tailwind classes: it is one sum, and it beats the component's own
        // max-w default without a cn() override.
        style={{ maxWidth: `min(94vw, ${839 + (previewOpen ? 321 : 0)}px)` }}
      >

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

          {/* Preview toggle. Sits before the dialog's own close button, which
              the header's pr-14 already reserves room for. */}
          <button
            type="button"
            onClick={() => setPreviewOpen(!previewWanted)}
            aria-pressed={previewOpen}
            disabled={!previewFits}
            title={previewFits ? undefined : 'The window is too narrow for the preview panel'}
            className="ml-auto self-center shrink-0 inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 text-xs font-medium text-ink-muted transition-colors hover:border-primary/30 hover:text-primary"
          >
            {previewOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
            )}
            Preview
          </button>
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
          {/* ── LEFT PANEL: insert chips ── */}
          {/* The three groups sit here rather than under the body. At 260px
              they stack in one column, and the editor keeps the vertical space
              they used to take from it. Edit note and About join them at the
              foot in Edit mode, which is why this rail shows its scrollbar:
              with the urgency fields expanded it can genuinely overflow, and
              hidden chrome would leave About silently out of reach. */}
          <ToggleGroup className="w-[260px] shrink-0 overflow-y-auto flex flex-col bg-bg">

            {/* Fields */}
            <div className="p-4 border-b border-line">
              <div className="flex items-center gap-1.5">
                <p className={SIDEBAR_LABEL}>Fields</p>
                <Tooltip
                  label={FIELDS_HINT}
                  placement="right"
                  className="flex items-center text-ink-subtle hover:text-ink transition-colors"
                >
                  <Info className="h-3 w-3" aria-hidden />
                </Tooltip>
              </div>

              <Toggle
                label="Date/Time"
                className="mb-2.5 mt-2.5"
                footer={
                  <div className="flex flex-col gap-2">
                    {/* Two rows, each a format and the button that inserts it.
                        The format sits beside the button rather than behind a
                        second dialog: there is one decision to make here, and it
                        is worth seeing before the token lands in the body.

                        The row wraps rather than squeezing. What a format option
                        says is its sample — "Month / Day / Year · 09/04/2026" —
                        and the two numeric orders are indistinguishable until you
                        read one, so a select narrow enough to clip it is worse
                        than a button on its own line. 260px of rail wraps; the
                        wider surface keeps both on one line. */}
                    <div className="flex flex-wrap items-end gap-1.5">
                      <div className="min-w-[180px] flex-1">
                        <label htmlFor="sb-date-format" className={FIELD_LABEL}>
                          Date format
                        </label>
                        <select
                          id="sb-date-format"
                          value={dateFormat}
                          disabled={saving}
                          onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                          className={cn(SELECT_CLASS, 'h-8 px-1.5 text-[11px]')}
                        >
                          {DATE_FORMAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label} · {o.sample}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={saving}
                        onClick={() =>
                          insertAtCursor(
                            buildFormDateToken({
                              name: nextDateName(form.content, 'date'),
                              kind: 'date',
                              format: dateFormat,
                            }),
                          )
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Date
                      </Button>
                    </div>

                    <div className="flex flex-wrap items-end gap-1.5">
                      <div className="min-w-[180px] flex-1">
                        <label htmlFor="sb-time-format" className={FIELD_LABEL}>
                          Time format
                        </label>
                        <select
                          id="sb-time-format"
                          value={timeFormat}
                          disabled={saving}
                          onChange={(e) => setTimeFormat(e.target.value as TimeFormat)}
                          className={cn(SELECT_CLASS, 'h-8 px-1.5 text-[11px]')}
                        >
                          {TIME_FORMAT_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label} · {o.sample}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={saving}
                        onClick={() =>
                          insertAtCursor(
                            buildFormDateToken({
                              name: nextDateName(form.content, 'time'),
                              kind: 'time',
                              format: timeFormat,
                            }),
                          )
                        }
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Time
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={saving}
                        onClick={() => setAutoDateOpen(true)}
                      >
                        <CalendarClock className="mr-1 h-3 w-3" />
                        Automatic
                      </Button>
                    </div>

                    {/* What the next Date button will write. The author sees the
                        token before it is in the body, the same promise the
                        number and menu builders make in their own dialogs. */}
                    <p className="font-mono text-[10px] leading-tight text-ink-subtle break-all">
                      {dateTokenPreview}
                    </p>
                  </div>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  A date fills as a calendar and a time as a clock, then prints in the
                  format you pick here. Formatting is what the reader sees and nothing
                  more: a formula and{' '}
                  <code className="font-mono text-primary/80">{'{datetimediff}'}</code>{' '}
                  still read the value the picker set. For a range, insert Date twice —
                  the second one arrives as{' '}
                  <code className="font-mono text-primary/80">DATE_2</code>.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {DATE_TIME_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>

              <Toggle
                label="Text"
                className="mb-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={() => setTextFieldOpen(true)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Name and insert
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  One line someone types in when the snippet expands. Unlike a date, a
                  text field is nothing without a name: an unnamed{' '}
                  <code className="font-mono text-primary/80">{'{formtext:}'}</code> is
                  dropped when the snippet runs, which is why the button below asks for
                  the name first instead of pasting a bare token.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  <div>
                    <dt className="font-mono text-[10px] text-ink">Name</dt>
                    <dd className="text-[11px] text-ink-subtle leading-tight">
                      What the field is called in the fill form. Arrives prefilled with the
                      next free TEXT_n, so you can accept it or type your own.
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[10px] text-ink">Default</dt>
                    <dd className="text-[11px] text-ink-subtle leading-tight">
                      Optional. Prefills the box, so the common answer is already there and
                      only the exception needs typing.
                    </dd>
                  </div>
                </dl>
              </Toggle>

              {/* Number is its own field type, not a setting inside Text. The
                  two share a token spelling underneath because the engine reads
                  a fixed nine-character prefix and could not take a new one
                  without 24 call sites moving together — an engine constraint,
                  and not something an author should ever have to think about. */}
              <Toggle
                label="Number"
                className="mb-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={() => setNumberFieldOpen(true)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Name and insert
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  A quantity — a price, a count, a duration. Unlike a text field it is
                  guaranteed to be a number by the time a formula reads it, so{' '}
                  <code className="font-mono text-primary/80">{'{=TOTAL * 2}'}</code>{' '}
                  either works or says why. Typed as{' '}
                  <code className="font-mono text-primary/80">1.200,50</code> or{' '}
                  <code className="font-mono text-primary/80">1,200.50</code>, it reads the
                  same either way.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {NUMBER_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>

              {/* The builder opens a dialog instead of pasting a literal: the
                  options have to exist before the token means anything. With the
                  caret inside a menu the same button edits it, so changing the
                  choices never means retyping raw token text. */}
              <Toggle
                label="Choice"
                className="mb-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={openMenuBuilder}
                  >
                    {menuAtCaret ? (
                      <Pencil className="mr-1 h-3 w-3" />
                    ) : (
                      <Plus className="mr-1 h-3 w-3" />
                    )}
                    {menuAtCaret ? 'Edit this menu' : 'Build the menu'}
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  A list of options, picked when the snippet expands. Every option is
                  listed in the fill form rather than hidden behind a dropdown, so the
                  choice is visible without opening anything.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {MENU_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>

            </div>

            {/* Actions */}
            <div className="p-4 border-b border-line">
              <div className="flex items-center gap-1.5">
                <p className={SIDEBAR_LABEL}>Actions</p>
                <Tooltip
                  label={ACTIONS_HINT}
                  placement="right"
                  className="flex items-center text-ink-subtle hover:text-ink transition-colors"
                >
                  <Info className="h-3 w-3" aria-hidden />
                </Tooltip>
              </div>
              {/* Like Choice, this one opens a builder rather than pasting a
                  literal: a button that sets nothing is not a shorter version
                  of a button, it is an inert one. */}
              <Toggle
                label="Button"
                className="mb-2.5 mt-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={() => setActionButtonOpen(true)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Build the button
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  Something the person filling the form clicks, never something the reader
                  sees. It sets fields to values you decide, so a discount or a revised
                  total lands in one click instead of being worked out by hand. The button
                  itself drops out of the message when the snippet is sent.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {BUTTON_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>

              {/* Urgency Timer belongs with the actions: it is the other thing
                  the snippet does at fill time, not a list-level preference
                  like Pin to top.

                  It is the only toggle in the rail holding a value rather than
                  inserting something, and a shut panel would hide whether that
                  value is on — so the label says so. Everything else about the
                  row is what the other seven are. */}
              <Toggle
                label={form.enable_urgency_timer ? 'Urgency Timer · On' : 'Urgency Timer'}
                className="mb-2.5"
                footer={
                  <div className="flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2.5">
                      <label htmlFor="snippet-urgency" className="text-[11px] text-ink-muted">
                        Countdown + scarcity
                      </label>
                      <Switch
                        id="snippet-urgency"
                        checked={form.enable_urgency_timer}
                        onChange={(v) => updateField('enable_urgency_timer', v)}
                        disabled={saving}
                      />
                    </div>

                    {form.enable_urgency_timer && (
                      <div className="grid gap-2">
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
                  </div>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  A countdown shown in the fill window while you work, never in the
                  message. It starts the moment the snippet is first opened and runs down
                  from there, and it can take the snippet out of use when it reaches zero.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {URGENCY_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>
            </div>

            {/* Logic */}
            <div className="flex-1 p-4">
              <div className="flex items-center gap-1.5">
                <p className={SIDEBAR_LABEL}>Logic</p>
                <Tooltip
                  label={LOGIC_HINT}
                  placement="right"
                  className="flex items-center text-ink-subtle hover:text-ink transition-colors"
                >
                  <Info className="h-3 w-3" aria-hidden />
                </Tooltip>
              </div>
              {/* The three read as the field toggles above them read: what the
                  token is, what it may contain, then the button that writes it.
                  Each replaces a chip that carried its whole explanation in a
                  hover title, which no one hovers before clicking — and these
                  three needed the explanation most, since a condition and a
                  formula are the only tokens that can silently print nothing. */}
              <Toggle
                label="Formula"
                className="mb-2.5 mt-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={() => insertAtCursor(FORMULA_TOKEN)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Insert formula
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  Works out a number from the fields around it and prints the answer, so
                  nobody does the arithmetic by hand.{' '}
                  <code className="font-mono text-primary/80">{'{=LIST_PRICE - DISCOUNT}'}</code>{' '}
                  reads both fields as they are filled and writes the result. Nothing is
                  asked of the person filling the form: a formula is worked out, never
                  typed in.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {FORMULA_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>

              <Toggle
                label="Condition"
                className="mb-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={() => insertAtCursor(CONDITION_TOKEN)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Insert condition
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  Prints a piece of text only when something is true, and nothing at all
                  when it is not.{' '}
                  <code className="font-mono text-primary/80">{'{if:TOTAL > 100}text{endif}'}</code>{' '}
                  keeps that text while the total is over 100 and drops it when it is not,
                  so one snippet covers both cases instead of two. Type your text between
                  the two halves of what the button inserts.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {CONDITION_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>

              <Toggle
                label="Greeting"
                className="mb-2.5"
                footer={
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={saving}
                    onClick={() => insertAtCursor(GREETING_TOKEN)}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Insert greeting
                  </Button>
                }
              >
                <p className="text-[11px] text-ink-subtle leading-tight">
                  Good morning, Good afternoon, Good evening or Good night, picked from the
                  clock at the moment the snippet expands. There is nothing to fill in and
                  nothing to remember to change: the line is right whenever it is sent.
                </p>
                <dl className="mt-2 flex flex-col gap-1.5">
                  {GREETING_FIELDS.map((f) => (
                    <div key={f.label}>
                      <dt className="font-mono text-[10px] text-ink">{f.label}</dt>
                      <dd className="text-[11px] text-ink-subtle leading-tight">{f.hint}</dd>
                    </div>
                  ))}
                </dl>
              </Toggle>
            </div>

            {/* Edit note — recorded in version history. Sits below Logic, which
                keeps flex-1 and so pushes both edit-only blocks to the foot of
                the rail, away from the insert chips. */}
            {mode === 'edit' && (
              <div className="shrink-0 border-t border-line p-4">
                <label htmlFor="snippet-edit-note" className={cn(SIDEBAR_LABEL, 'block mb-2.5')}>
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
                <p className={cn(SIDEBAR_LABEL, 'mb-2.5')}>About</p>
                <AssetAttribution
                  assetId={editingSnippet.id}
                  createdBy={editingSnippet.user_id}
                  updatedBy={editingSnippet.updated_by}
                  updatedAt={editingSnippet.updated_at}
                />
              </div>
            )}
          </ToggleGroup>

          {/* ── PANEL DIVIDER ── */}
          <div className="w-px bg-line shrink-0" />

          {/* ── CENTER PANEL: main editor ── */}
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

            {/* Labels + Alternative queries share one row. Neither needs the
                full panel width, and pairing them hands the body the vertical
                space the second row used to cost it. */}
            <div className="grid grid-cols-2 gap-3">
              {/* Labels — the shared snippet/prompt vocabulary (LABELS-001) */}
              <div>
                <label htmlFor="snippet-labels" className={FIELD_LABEL}>
                  Labels{' '}
                  <span className="font-normal text-ink-subtle">(shared with prompts)</span>
                </label>
                <div>
                  <LabelPicker
                    id="snippet-labels"
                    value={labelIds}
                    onChange={setLabelIds}
                    disabled={saving}
                  />
                  {LABEL_SUGGESTIONS_ENABLED && (
                    <LabelSuggestions
                      draft={{
                        name: form.name,
                        body: form.content,
                        folderName: folders.find((f) => f.id === form.folder_id)?.name ?? null,
                        language: form.language,
                      }}
                      value={labelIds}
                      onChange={setLabelIds}
                      disabled={saving}
                    />
                  )}
                </div>
              </div>

              {/* Alternative Queries */}
              <div>
                <label className={FIELD_LABEL}>
                  Alternative queries{' '}
                  <span className="font-normal text-ink-subtle">(synonyms)</span>
                  {mode === 'edit' && (
                    <Tooltip
                      label={VARIANT_HINT}
                      placement="top"
                      className="ml-1.5 font-normal text-ink-subtle hover:text-ink transition-colors"
                    >
                      ⓘ per variant
                    </Tooltip>
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
            </div>

            {/* Body — the panel's flexible element: it absorbs whatever height
                the fixed-size dialog has to spare, and shrinks (never below
                min-h) before the panel resorts to scrolling. The wrapper's
                min-h must cover the label/language row + gap + the textarea's
                own floor + the footer row, or the textarea escapes the wrapper.
                Measured need is ~216.5px: header row 28 (the language pills
                set its height) + 6 gap + textarea 160 + 6 gap + footer 16.5.
                Raised 216 -> 224 when the pills moved onto the label row; the
                spare ~7px is deliberate, since those heights come from font
                metrics that differ per platform and a floor tuned to the exact
                number would overflow somewhere else. */}
            <div className="flex flex-col gap-1.5 flex-1 min-h-[224px]">
              {/* Label and language pills share the row: the language a body is
                  written in belongs next to that body, not in a far panel, and
                  putting them side by side costs no extra height. */}
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="snippet-content" className={cn(FIELD_LABEL, 'mb-0')}>
                  Body
                </label>
                <div className="flex items-center gap-1.5">
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
                          'relative inline-flex h-7 items-center gap-1 rounded-[8px] border px-3 text-xs font-semibold transition-all disabled:opacity-50',
                          isActive
                            ? 'shadow-sm'
                            : 'border-line bg-card text-ink-muted hover:bg-bg-alt hover:text-ink',
                        )}
                      >
                        {/* Multi carries its own hint: the only slot whose
                            meaning isn't given away by its label. */}
                        {lang === 'MULTI' && (
                          <Tooltip
                            label={MULTI_HINT}
                            placement="top"
                            className="inline-flex items-center text-ink-subtle hover:text-ink transition-colors"
                          >
                            <Eye className="h-3.5 w-3.5" aria-hidden />
                          </Tooltip>
                        )}
                        {cfg.label}
                        {showDot && (
                          <span
                            aria-hidden
                            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary"
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
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
                  contentError && 'border-danger focus:border-danger focus:ring-danger/20',
                )}
                placeholder={BODY_PLACEHOLDER[form.language]}
              />
              {/* Footer: the error and the count share one line. Stacking them
                  would cost the textarea a second row of height for something
                  that is only ever a few words wide. */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {contentError && <FieldError message={contentError} />}
                  {!contentError && translateError && <FieldError message={translateError} />}
                </div>
                <div className="flex shrink-0 items-center gap-2.5">
                  {/* Translate fills this slot from the English body. Shown only
                      on IT/ES/FR: EN is the source, and MULTI is a deliberate
                      mix with no single target language. Disabled when there is
                      no English to translate — the title says so, since a
                      button that does nothing reads as broken. */}
                  {(form.language === 'IT' ||
                    form.language === 'ES' ||
                    form.language === 'FR') && (
                    <button
                      type="button"
                      onClick={() => void translateFromEnglish()}
                      disabled={saving || translating || (form.bodies.EN ?? '').trim().length === 0}
                      title={
                        (form.bodies.EN ?? '').trim().length === 0
                          ? 'Write the English body first — it is what gets translated.'
                          : `Translate the English body into ${form.language}. Fields and formulas are kept exactly as they are. Nothing is saved until you press Save.`
                      }
                      className={cn(
                        'inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
                        confirmTranslate
                          ? 'border-primary/40 bg-primary-bg text-primary'
                          : 'border-line bg-card text-ink-subtle hover:border-primary/40 hover:bg-primary-bg hover:text-primary',
                      )}
                    >
                      <Languages className="h-3 w-3" aria-hidden />
                      {translating
                        ? 'Translating…'
                        : confirmTranslate
                          ? 'Click again to replace'
                          : 'Translate from EN'}
                    </button>
                  )}
                  {/* Clear sits left of the count so the count keeps the right
                      edge it has always had. Disabled on an already-empty slot:
                      there is nothing to delete and an armable button that does
                      nothing reads as broken. */}
                  <button
                    type="button"
                    onClick={() => (confirmClear ? clearActiveLanguage() : setConfirmClear(true))}
                    disabled={saving || form.content.length === 0}
                    title={`Delete the ${form.language} body. The snippet is saved without that language, not with an empty one.`}
                    className={cn(
                      'rounded-[6px] border px-2 py-0.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40',
                      // Same danger vocabulary as the footer's Delete.
                      confirmClear
                        ? 'border-danger/30 bg-danger/5 text-danger'
                        : 'border-line bg-card text-ink-subtle hover:border-danger/30 hover:bg-danger/5 hover:text-danger',
                    )}
                  >
                    {confirmClear ? 'Click again to clear' : 'Clear'}
                  </button>
                  <span className="text-[11px] tabular-nums text-ink-subtle">
                    {bodyWordCount} {bodyWordCount === 1 ? 'word' : 'words'}
                  </span>
                </div>
              </div>
            </div>

            <FormTextDialog
              open={textFieldOpen}
              onOpenChange={setTextFieldOpen}
              suggestedName={nextTextName(form.content)}
              onInsert={insertAtCursor}
            />

            <FormNumberDialog
              open={numberFieldOpen}
              onOpenChange={setNumberFieldOpen}
              suggestedName={nextNumberName(form.content)}
              onInsert={insertAtCursor}
            />

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

            <FormTimeDialog
              open={autoDateOpen}
              onOpenChange={setAutoDateOpen}
              onInsert={insertAtCursor}
            />

          </div>

          {/* ── PREVIEW PANEL: the body, resolved ── */}
          {/* Sits next to the textarea rather than in a page of its own: the
              whole point is seeing the result of the edit you just made. Reads
              the active language slot, so switching language previews that
              translation. Runs on extension/shared/fill-form.js — the same code
              that expands the snippet in Gmail — so it cannot disagree with
              what the extension produces. */}
          {previewOpen && (
            <>
              <div className="w-px bg-line shrink-0" />
              <SnippetPreview
                body={form.content}
                lang={form.language === 'MULTI' ? '' : form.language}
              />
            </>
          )}

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

