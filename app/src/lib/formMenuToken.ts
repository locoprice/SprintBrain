/**
 * {formmenu:} token writer for the snippet body editor.
 *
 * A dropdown-menu field is stored inline in the body as
 *   `{formmenu: A,B,C; name=MENU_1; default=B; multiple=yes; cols=20}`
 * and read back by the formula engine when the snippet expands.
 *
 * MIRRORED in `extension/formula-engine.js` (`buildFormMenuToken`,
 * `formMenuPicks`, and the formmenu branch of `buildFormFieldCfg`) — the React
 * dashboard cannot import extension source (see app/CLAUDE.md §6), and the
 * engine is the parser these tokens must satisfy. Change both together;
 * `src/__tests__/formMenuField.test.ts` pins the round-trip across the two.
 */

export interface FormMenuConfig {
  /** Menu options, in the order they are offered. */
  options: string[];
  /** Preselected option labels. Trimmed to one unless `multiple`. */
  selected: string[];
  /** Field name — how the rest of the body refers to the value. */
  name: string;
  /** Whether the user may pick several options. */
  multiple: boolean;
  /** Field width in characters, or null to leave it to the surface. */
  cols: number | null;
}

/**
 * `,` `;` `{` `}` are the token grammar's own delimiters, so they collapse to a
 * space inside an option label rather than breaking the snippet body.
 */
export function sanitizeMenuOption(raw: string): string {
  return raw.replace(/[,;{}]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Engine identifier rules: a letter or underscore, then word characters. */
export function isValidMenuName(raw: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(raw);
}

/**
 * Forces a name the engine accepts. A token whose name it rejects resolves to
 * nothing at expansion time, which reads to the user as a vanished field.
 */
export function sanitizeMenuName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, '');
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `MENU_${cleaned}`;
}

/** Reads a `default=` value ("A, B") back into its picked options. */
export function formMenuPicks(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '');
}

export function buildFormMenuToken(cfg: FormMenuConfig): string {
  const options: string[] = [];
  for (const raw of cfg.options) {
    const option = sanitizeMenuOption(raw);
    if (option !== '' && !options.includes(option)) options.push(option);
  }

  const picked: string[] = [];
  for (const raw of cfg.selected) {
    const option = sanitizeMenuOption(raw);
    if (options.includes(option) && !picked.includes(option)) picked.push(option);
  }
  const picks = cfg.multiple ? picked : picked.slice(0, 1);

  let out = `{formmenu: ${options.join(',')}; name=${sanitizeMenuName(cfg.name)}`;
  if (picks.length) out += `; default=${picks.join(',')}`;
  if (cfg.multiple) out += '; multiple=yes';
  if (cfg.cols !== null && cfg.cols > 0) out += `; cols=${Math.floor(cfg.cols)}`;
  return `${out}}`;
}

/**
 * The next unused `MENU_n` for a body. The dialog prefills this so an inserted
 * menu always carries a working name without the author having to invent one.
 */
export function nextMenuName(body: string): string {
  const used = new Set<string>();
  const re = /name\s*=\s*(MENU_\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body)) !== null) {
    const found = match[1];
    if (found) used.add(found.toUpperCase());
  }
  let n = 1;
  while (used.has(`MENU_${n}`)) n += 1;
  return `MENU_${n}`;
}
