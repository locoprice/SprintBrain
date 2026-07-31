/**
 * {button} token writer for the snippet body editor.
 *
 * An action button is stored inline in the body as
 *   `{button label="10% off" trim=left}PRICE = PRICE * 0.9{/button}`
 * and read back by the formula engine, which renders it in the fill form and
 * runs its assignments when clicked. It never contributes text to the message.
 *
 * MIRRORED in `extension/formula-engine.js` (`buildFormButtonToken`, and the
 * button branch of `extractButtons`) — the React dashboard cannot import
 * extension source (see app/CLAUDE.md §6), and the engine is the parser these
 * tokens must satisfy. Change both together;
 * `src/__tests__/buttonCommand.test.ts` pins the round-trip across the two.
 */

export type ButtonTrim = 'no' | 'yes' | 'left' | 'right';

export const BUTTON_TRIMS: ButtonTrim[] = ['no', 'left', 'right', 'yes'];

/** One `FIELD = expression` line of a button's code block. */
export interface FormButtonLine {
  field: string;
  expr: string;
}

export interface FormButtonConfig {
  /** Text shown on the button. Blank falls back to the engine's "Run". */
  label: string;
  trim: ButtonTrim;
  lines: FormButtonLine[];
}

/** `"` would close the attribute; braces would end the token early. */
export function sanitizeButtonLabel(raw: string): string {
  return raw.replace(/["{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** `;` and newlines separate statements; braces end the token. */
export function sanitizeButtonExpr(raw: string): string {
  return raw.replace(/[;{}\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Engine identifier rules: a letter or underscore, then word characters. */
export function isValidButtonField(raw: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw);
}

/** Forces a field name the engine accepts, matching the engine-side writer. */
export function sanitizeButtonField(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  if (!cleaned) return '';
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `F${cleaned}`;
}

export function buildFormButtonToken(cfg: FormButtonConfig): string {
  const statements: string[] = [];
  for (const line of cfg.lines) {
    const field = sanitizeButtonField(line.field);
    const expr = sanitizeButtonExpr(line.expr);
    if (!field || !expr) continue;
    statements.push(`${field} = ${expr}`);
  }

  let head = '{button';
  const label = sanitizeButtonLabel(cfg.label);
  if (label) head += ` label="${label}"`;
  if (cfg.trim !== 'no') head += ` trim=${cfg.trim}`;
  return `${head}}${statements.join('; ')}{/button}`;
}
