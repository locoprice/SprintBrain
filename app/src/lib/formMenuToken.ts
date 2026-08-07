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

  // A blank name is written as no `name=` at all, matching Text Blaze — the
  // engine then keys the menu from the token itself.
  const named = cfg.name.trim() === '' ? '' : `; name=${sanitizeMenuName(cfg.name)}`;
  let out = `{formmenu: ${options.join(',')}${named}`;
  if (picks.length) out += `; default=${picks.join(',')}`;
  if (cfg.multiple) out += '; multiple=yes';
  if (cfg.cols !== null && cfg.cols > 0) out += `; cols=${Math.floor(cfg.cols)}`;
  return `${out}}`;
}

/** Named settings a menu token carries; every other segment is an option. */
const MENU_KEYS = /^\s*(name|default|multiple|cols)\s*=/i;
const MENU_HEAD = /^\{\s*formmenu\s*:/i;

/**
 * Splits a token's settings into its options and its named settings. Options
 * may be `;`-separated (Text Blaze) or comma-separated in one segment (what
 * `buildFormMenuToken` writes), and named settings may sit anywhere among them.
 * Mirrors `_parseMenuSettings` in the engine.
 */
function parseMenuSettings(rest: string): { options: string[]; attrs: string } {
  const options: string[] = [];
  let attrs = '';
  for (const segment of rest.split(';')) {
    if (MENU_KEYS.test(segment)) {
      attrs += `;${segment}`;
      continue;
    }
    for (const part of segment.split(',')) {
      const option = part.trim();
      if (option !== '' && !options.includes(option)) options.push(option);
    }
  }
  return { options, attrs };
}

/**
 * The inverse of `buildFormMenuToken` — turns a token already in a body back
 * into the config the dialog can load, so changing a menu's options is an edit
 * rather than hand-surgery on raw token text. Returns null for anything that
 * isn't a complete `{formmenu: …}`.
 *
 * The name is read straight from `name=` rather than derived: an unnamed menu
 * must stay unnamed, or re-saving would bake in the key the engine hashes.
 */
export function parseFormMenuToken(raw: string): FormMenuConfig | null {
  const src = raw.trim();
  const head = MENU_HEAD.exec(src);
  if (!head || !src.endsWith('}')) return null;

  const { options, attrs } = parseMenuSettings(src.slice(head[0].length, src.length - 1));
  const multiple = /(?:^|;)\s*multiple\s*=\s*(?:yes|true|1)\s*(?:;|$)/i.test(attrs);
  const nameMatch = /(?:^|;)\s*name\s*=\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(attrs);
  const colsMatch = /(?:^|;)\s*cols\s*=\s*(\d+)/i.exec(attrs);
  const defaultMatch = /(?:^|;)\s*default\s*=\s*([^;]+)/i.exec(attrs);

  // Only declared options can be preselected, and a single-choice menu holds
  // one — the same rules the fill form applies, so the dialog opens on exactly
  // the selection that would expand.
  const picked = defaultMatch
    ? formMenuPicks(defaultMatch[1] ?? '').filter((option) => options.includes(option))
    : [];
  const cols = colsMatch ? Number.parseInt(colsMatch[1] ?? '', 10) : 0;

  return {
    options,
    selected: multiple ? picked : picked.slice(0, 1),
    name: nameMatch?.[1] ?? '',
    multiple,
    cols: cols > 0 ? cols : null,
  };
}

/** Where a `{formmenu:}` token sits in a body. `end` is exclusive. */
export interface MenuTokenRange {
  start: number;
  end: number;
  raw: string;
}

/**
 * The `{formmenu:}` token containing `caret`, or null. A caret on either brace
 * counts as inside, so clicking at the very end of a token still finds it.
 * Between two touching menus the earlier one wins — deterministic, and the
 * caret is visually at its closing brace.
 */
export function findMenuTokenAt(body: string, caret: number): MenuTokenRange | null {
  const pos = Math.min(Math.max(Number.isFinite(caret) ? caret : 0, 0), body.length);
  let i = 0;
  while (i < body.length) {
    const open = body.indexOf('{', i);
    if (open === -1) break;
    const close = body.indexOf('}', open + 1);
    if (close === -1) break;
    const raw = body.slice(open, close + 1);
    if (!MENU_HEAD.test(raw)) {
      i = open + 1;
      continue;
    }
    if (pos >= open && pos <= close + 1) return { start: open, end: close + 1, raw };
    i = close + 1;
  }
  return null;
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
