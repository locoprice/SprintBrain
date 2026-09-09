/**
 * Bridge to the SHARED fill-form core, so the dashboard's live preview resolves
 * a snippet through exactly the code that expands it in Gmail or WhatsApp.
 *
 * `extension/formula-engine.js` and `extension/shared/fill-form.js` are UMD and
 * already shipped as plain scripts to every other surface (the popup, the
 * in-page overlay, `Sprintbrain.html`). This module loads those same two files
 * and reads the globals they install — it does NOT re-implement or re-bundle
 * them, so the preview can never disagree with what the extension produces.
 * `scripts/check-fill-form.js` guards the shape both sides depend on.
 *
 * Serving: `nativeDashboardPlugin` in vite.config.ts copies `extension/` into
 * dist at build and serves it from the repo root in dev, so `/extension/*`
 * resolves on both.
 */

/** A field's kind, as decided by `fill-form.js` (token declaration, then name). */
export type SbFieldType = 'text' | 'date' | 'time' | 'datetime' | 'number' | 'dd';

/** One choice in the Adjust panel's Format list, sampled against the value. */
export interface SbFormatChoice {
  /** An engine format, or '' for "print what the picker holds". */
  value: string;
  label: string;
  sample: string;
}

/** A labelled value in one of the Adjust panel's other lists. */
export interface SbAdjustChoice {
  value: string;
  label: string;
}

/**
 * The Date/Time builder's three decisions — which format, which day, what time
 * on it — offered again while the form is open. Every surface draws its own
 * controls from this one description. A list is empty when it does not apply:
 * a clock has no day to jump to, a calendar has no clock to set, and a datetime
 * has no format list because neither of the engine's lists prints it whole.
 */
export interface SbFieldAdjust {
  formats: SbFormatChoice[];
  modes: SbAdjustChoice[];
  units: SbAdjustChoice[];
  days: SbAdjustChoice[];
  hours: string[];
  minutes: string[];
  /** What the clock controls open on: the time already in the field. */
  hour: string;
  minute: string;
}

/** One row of the fill form. Mirrors FIELD_SHAPE in scripts/check-fill-form.js. */
export interface SbFillField {
  key: string;
  /**
   * Display name from a stored field_cfg, or '' when none is set — the renderer
   * decides how to title an unnamed field, and they deliberately differ (the
   * overlay prints {KEY}, the phone and this panel humanise it).
   */
  label: string;
  type: SbFieldType;
  /**
   * How the value prints once it leaves the form: one of the engine's date or
   * time formats, or `''` for the picker's own value. A number carries
   * 'plain' | 'currency' | 'percent'. Output only — a formula still reads the
   * raw value.
   */
  format: string;
  /** ISO code behind a currency field; '' for everything else. */
  currency: string;
  /** Choices, for `dd` only. */
  options: string[];
  /** Which choices are currently selected, for `dd` only. */
  picks: string[];
  multiple: boolean;
  /** Author-requested width in characters; 0 when unset. */
  cols: number;
  default: string;
  value: string;
  /** The prose immediately before/after the token, so a row reads like the body. */
  before: string;
  after: string;
  /**
   * The field this one may not open before, or '' for no ordering. Distinct
   * from `after` above, which is prose: this names another field.
   */
  notBefore: string;
  /** The earliest value the picker may offer, resolved from that field. */
  min: string;
  /** A choice list is block level: its context goes above and below, not beside. */
  block: boolean;
  /** What the Adjust panel offers this field; null for anything but a date. */
  adjust: SbFieldAdjust | null;
  visible: boolean;
}

/** A `{button}` control: sets field values when clicked, never prints. */
export interface SbFillButton {
  id: string;
  label: string;
  trim: string;
  code: string;
  statements: Array<{ name: string; expr: string }>;
  errors: string[];
}

/** The view model every fill surface renders. Mirrors SHAPE in the gate. */
export interface SbFillFormViewModel {
  fields: SbFillField[];
  buttons: SbFillButton[];
  preview: string;
  /**
   * How each date and time field prints, ready to hand straight to
   * `resolveBody`. A surface that resolves the body itself must pass this too,
   * or what it produces prints differently from the preview it just showed.
   */
  fmtOverride: Record<string, string>;
  layout: 'flat' | 'steps';
  steps: string[][];
}

export interface SbFillFormOptions {
  /** Stored per-field overrides; wins over whatever the body declares. */
  fieldCfg?: Record<string, unknown>;
  /**
   * Formats picked in the Adjust panel while the form is open, keyed by field.
   * Beside `values` because it is the same kind of thing: an answer given now
   * and never saved back to the snippet.
   */
  fieldFmt?: Record<string, string>;
  /** Snippet language — genders ambiguous names and picks the greeting. */
  lang?: string;
  now?: Date;
}

/** Which of the three ways the Adjust panel's Day row chooses a date. */
export type SbDayMode = 'none' | 'fixed' | 'named';

export interface SbDayChoice {
  mode: SbDayMode;
  /** How many units to count, for `fixed`. */
  amount?: string | number;
  /** Which unit to count in ('D' | 'W' | 'Mo' | 'Y', plus 'H' | 'M' on a datetime). */
  unit?: string;
  /** Count backwards instead of forwards. */
  back?: boolean;
  /** One of the engine's named anchors, for `named`. */
  named?: string;
}

interface SbFillFormApi {
  fillForm(
    text: string,
    values: Record<string, string>,
    opts: SbFillFormOptions,
  ): SbFillFormViewModel;
  /** The picker value a Day choice lands on, in the picker's own spelling. */
  dayValue(type: SbFieldType, choice: SbDayChoice, current: string, now?: Date): string;
  /** The picker value a Clock choice lands on; '' for a field with no clock. */
  clockValue(
    type: SbFieldType,
    hour: string,
    minute: string,
    current: string,
    now?: Date,
  ): string;
}

interface SbFormulaEngineApi {
  extractButtons(body: string): SbFillButton[];
  applyButtonCode(
    statements: Array<{ name: string; expr: string }>,
    values: Record<string, string>,
  ): { values: Record<string, number>; errors: string[] };
  /**
   * The date formatter every surface prints through. Exposed so the Date/Time
   * builder can preview a {time:} token against the real one rather than
   * carrying a third copy of the token table — the dialog would be the only
   * place in the product where a date could be formatted a different way.
   */
  sbFormatDate(d: Date, fmt: string): string;
}

/** The engine's date formatter, or null until the scripts have loaded. */
export function formulaEngine(): SbFormulaEngineApi | null {
  return window.SBFormulaEngine ?? null;
}

/**
 * The shared fill-form module, or null until the scripts have loaded. Exposed so
 * a builder can ask what fields a body already holds through the same decider
 * every fill surface uses, rather than re-deriving the rule from the text.
 */
export function fillFormApi(): SbFillFormApi | null {
  return window.SBFillForm ?? null;
}

declare global {
  interface Window {
    SBFillForm?: SbFillFormApi;
    SBFormulaEngine?: SbFormulaEngineApi;
  }
}

/** Load order matters only for clarity — fill-form reads the engine lazily. */
const ENGINE_SCRIPTS = [
  '/extension/formula-engine.js',
  '/extension/shared/fill-form.js',
] as const;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-sb-engine="${src}"]`,
    );
    if (existing) {
      if (existing.dataset.sbLoaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener(
        'error',
        () => reject(new Error(`Could not load ${src}`)),
        { once: true },
      );
      return;
    }

    const el = document.createElement('script');
    el.src = src;
    el.async = false;
    el.dataset.sbEngine = src;
    el.addEventListener(
      'load',
      () => {
        el.dataset.sbLoaded = 'true';
        resolve();
      },
      { once: true },
    );
    el.addEventListener(
      'error',
      () => reject(new Error(`Could not load ${src}`)),
      { once: true },
    );
    document.head.appendChild(el);
  });
}

/** One in-flight load shared by every caller; retried only after a failure. */
let pending: Promise<SbFillFormApi> | null = null;

/**
 * Resolves once both shared scripts have installed their globals. Rejects with
 * an actionable message if they cannot be served, so the caller can say so
 * rather than rendering an empty form that looks like a broken snippet.
 */
export function loadFillFormEngine(): Promise<SbFillFormApi> {
  if (window.SBFillForm && window.SBFormulaEngine) {
    return Promise.resolve(window.SBFillForm);
  }
  if (pending) return pending;

  pending = (async () => {
    for (const src of ENGINE_SCRIPTS) {
      await loadScript(src);
    }
    const api = window.SBFillForm;
    if (!api || !window.SBFormulaEngine) {
      throw new Error('Snippet engine loaded but installed no interface');
    }
    return api;
  })().catch((error: unknown) => {
    // Clear the cache so a later open retries rather than repeating a stale
    // failure for the rest of the session.
    pending = null;
    throw error;
  });

  return pending;
}

/** The engine globals, once `loadFillFormEngine` has resolved. */
export function fillForm(
  body: string,
  values: Record<string, string>,
  opts: SbFillFormOptions = {},
): SbFillFormViewModel | null {
  const api = window.SBFillForm;
  if (!api) return null;
  return api.fillForm(body, values, opts);
}

/**
 * The picker value one Adjust panel choice lands on. Both answer '' when the
 * engine has not loaded or the field has no such control, and the caller writes
 * nothing rather than clearing a date the operator already set.
 */
export function dayValue(
  type: SbFieldType,
  choice: SbDayChoice,
  current: string,
): string {
  return window.SBFillForm?.dayValue(type, choice, current) ?? '';
}

export function clockValue(
  type: SbFieldType,
  hour: string,
  minute: string,
  current: string,
): string {
  return window.SBFillForm?.clockValue(type, hour, minute, current) ?? '';
}

/**
 * Applies one `{button}`'s statements to the current values. Returns the fields
 * it wrote plus anything it could not work out, exactly as the overlay, the
 * popup detail and the composer already do.
 */
export function runFormButton(
  body: string,
  buttonId: string,
  values: Record<string, string>,
): { values: Record<string, string>; errors: string[] } {
  const engine = window.SBFormulaEngine;
  if (!engine) return { values: {}, errors: [] };

  const spec = engine.extractButtons(body).find((b) => b.id === buttonId);
  if (!spec) return { values: {}, errors: [] };

  const result = engine.applyButtonCode(spec.statements, values);
  const written: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.values)) {
    written[name] = String(value);
  }
  return { values: written, errors: [...spec.errors, ...result.errors] };
}
