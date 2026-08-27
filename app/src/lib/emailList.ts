/**
 * Parsing for the multi-address invite field (TEAM-INVITE-002).
 *
 * People paste contacts from wherever they keep them: a spreadsheet column, a
 * mail client's "To" line, a chat message. Those arrive comma separated, tab
 * separated, newline separated, semicolon separated, or wrapped in display
 * names. Accepting only one clean address per submit is what made adding a
 * handful of colleagues feel like data entry.
 */

/** Mirrors the EMAIL_RE the invite-member edge function validates against. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Pull the address out of one token, unwrapping the `Name <a@b.com>` form that
 * every mail client produces on copy.
 */
function unwrap(token: string): string {
  const angled = token.match(/<([^>]+)>/);
  const raw = angled?.[1] ?? token;
  return raw.trim().replace(/^["'<]+|["'>]+$/g, '').toLowerCase();
}

export interface ParsedEmails {
  /** Valid, deduplicated, in first-seen order. */
  valid: string[];
  /** Tokens that are not addresses, in first-seen order, deduplicated. */
  invalid: string[];
}

/**
 * Split a pasted blob into addresses. Never throws, and never silently drops a
 * token: anything unrecognized comes back in `invalid` so the UI can say which
 * entry it could not read rather than failing the whole paste.
 */
export function parseEmailList(input: string): ParsedEmails {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();

  for (const token of input.split(/[\s,;]+/)) {
    if (token.trim() === '') continue;
    const candidate = unwrap(token);
    if (candidate === '') continue;

    if (EMAIL_RE.test(candidate)) {
      if (!seenValid.has(candidate)) {
        seenValid.add(candidate);
        valid.push(candidate);
      }
    } else if (!seenInvalid.has(token.trim())) {
      seenInvalid.add(token.trim());
      invalid.push(token.trim());
    }
  }

  return { valid, invalid };
}

/** True when the keystroke should commit whatever is typed into a chip. */
export function isCommitKey(key: string): boolean {
  return key === 'Enter' || key === 'Tab' || key === ',' || key === ';' || key === ' ';
}

export interface InviteOutcome {
  email: string;
  ok: boolean;
  /** Why it failed, already human-readable. Empty when `ok`. */
  reason: string;
}

/**
 * One sentence covering a batch, so a partial success reads as a partial
 * success instead of a generic failure. Named addresses are capped so a paste
 * of thirty does not produce a paragraph.
 */
export function summarizeInvites(outcomes: InviteOutcome[]): string {
  const sent = outcomes.filter((o) => o.ok);
  const failed = outcomes.filter((o) => !o.ok);

  const first = sent[0];
  const sentPart =
    sent.length === 0 || first === undefined
      ? ''
      : sent.length === 1
        ? `Invitation sent to ${first.email}.`
        : `${sent.length} invitations sent.`;

  const firstFail = failed[0];
  if (firstFail === undefined) return sentPart;

  // A single failure is worth naming precisely; several are worth counting,
  // with the first reason as the example.
  const failPart =
    failed.length === 1
      ? `${firstFail.email} was not invited: ${firstFail.reason}`
      : `${failed.length} were not invited. First problem: ${firstFail.email}, ${firstFail.reason}`;

  return sentPart === '' ? failPart : `${sentPart} ${failPart}`;
}
