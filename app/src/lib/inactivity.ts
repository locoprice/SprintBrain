// Unused-asset rules behind the "you have not used this since ..." banner
// (INACTIVE-001).
//
// MIRRORED from `extension/shared/inactivity.js`. The dashboard cannot import
// extension source (app/CLAUDE.md §6), the same constraint that forces
// `validateTemplate` to exist twice. Change both together;
// `scripts/check-inactivity-parity.js` runs one assertion set against both and
// fails the build when they disagree.
//
// Staleness is measured in CALENDAR months, not a day count: "six months ago"
// from 15 August is 15 February, which a fixed 183 days gets wrong by up to
// three days across a leap year. setMonth overflows a short month rather than
// clamping (six months back from 31 August is 3 March); see the extension copy
// for why that is left alone.
//
// Pure and side-effect free so the thresholds stay testable in isolation. The
// snooze store below is the one stateful part, and it is per browser on purpose
// (the extension keeps its own in chrome.storage.local).

export const MIN_MONTHS = 6;
export const MAX_MONTHS = 9;
export const DEFAULT_MONTHS = 6;

/** How long "Keep" silences one asset. Not forever: see the extension module. */
export const KEEP_DAYS = 90;

const DAY_MS = 86_400_000;
const SNOOZE_KEY = 'sb_inactivity_kept';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** What a surface hands in: anything with an id, a name and two dates. */
export interface InactivityCandidate {
  id: string;
  name: string;
  trigger: string;
  /** Last recorded use. Null when the asset has never been used. */
  lastUsedAt: string | Date | number | null;
  /** The fallback anchor for a never-used asset. */
  createdAt: string | Date | number | null;
}

export interface InactiveEntry {
  id: string;
  name: string;
  trigger: string;
  /** The date the sentence quotes: the last use, or the creation date. */
  at: number;
  everUsed: boolean;
  monthsIdle: number;
}

function toMs(value: string | Date | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * 6 is the floor and 9 the ceiling; anything unreadable lands on 6. Clamps
 * rather than rejects, so a stored value from a build that widened the range
 * can never silently become "never warn".
 */
export function clampMonths(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_MONTHS;
  if (n < MIN_MONTHS) return MIN_MONTHS;
  if (n > MAX_MONTHS) return MAX_MONTHS;
  return n;
}

/** The instant an asset becomes stale: used before this and it is due. */
export function cutoffMs(nowMs: number, months: number): number {
  const d = new Date(nowMs);
  d.setMonth(d.getMonth() - clampMonths(months));
  return d.getTime();
}

/** Whole calendar months between two instants, floored at zero. */
export function monthsBetween(fromMs: number, toMsValue: number): number {
  const a = new Date(fromMs);
  const b = new Date(toMsValue);
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) months -= 1;
  return months < 0 ? 0 : months;
}

/**
 * "12 March 2026". Hand-rolled to match the extension exactly: a date that read
 * differently in the popup and here would break the one-product rule, and Intl
 * is not used by the shipped surfaces.
 */
export function formatDate(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The sentence. One wording, every surface.
 *
 * A never-used asset gets its own shape rather than a last-used date that would
 * silently be its creation date and read as a lie.
 */
export function message(entry: InactiveEntry): string {
  if (!entry.everUsed) {
    const made = formatDate(entry.at);
    return made ? `You have never used ${entry.name}. Added ${made}.` : `You have never used ${entry.name}.`;
  }
  return `You have not used ${entry.name} since ${formatDate(entry.at)}.`;
}

/**
 * The stale assets, oldest first.
 *
 * `keptUntil` suppresses an asset the user chose to keep, until that snooze
 * expires. An asset with neither a use nor a creation date is skipped: no
 * evidence is not evidence of staleness.
 */
export function findInactive(
  items: InactivityCandidate[],
  keptUntil: Record<string, number>,
  months: number,
  nowMs: number,
): InactiveEntry[] {
  const cutoff = cutoffMs(nowMs, months);
  const out: InactiveEntry[] = [];

  for (const item of items) {
    if (!item?.id) continue;
    const kept = keptUntil[item.id];
    if (kept !== undefined && kept > nowMs) continue;

    const used = toMs(item.lastUsedAt);
    const at = used ?? toMs(item.createdAt);
    if (at === null || at >= cutoff) continue;

    out.push({
      id: item.id,
      name: item.name.trim() || item.trigger.trim() || 'Untitled',
      trigger: item.trigger,
      at,
      everUsed: used !== null,
      monthsIdle: monthsBetween(at, nowMs),
    });
  }

  return out.sort((a, b) => a.at - b.at);
}

// ── Snooze store ─────────────────────────────────────────────────────────────
//
// Per browser, in localStorage. The extension keeps the equivalent in
// chrome.storage.local, and the two deliberately do not share: "hide this for
// me, here" is a per-device decision, and syncing it would need a new column
// for no behaviour the user asked for.
//
// Every access is wrapped: localStorage throws outright in a private window
// with site data blocked, and a banner must never take the page down.

export function readKept(): Record<string, number> {
  try {
    const raw = window.localStorage.getItem(SNOOZE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [id, until] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(until);
      if (Number.isFinite(n)) out[id] = n;
    }
    return out;
  } catch {
    return {};
  }
}

function writeKept(next: Record<string, number>): void {
  try {
    window.localStorage.setItem(SNOOZE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable, the banner reappears on the next load */
  }
}

/** Silence one asset for KEEP_DAYS and return the new map. */
export function keepAsset(id: string, nowMs: number): Record<string, number> {
  const next = { ...readKept(), [id]: nowMs + KEEP_DAYS * DAY_MS };
  writeKept(next);
  return next;
}

/**
 * Drop snoozes for assets that are gone or whose snooze has lapsed, so the map
 * cannot grow without bound and a reused id cannot inherit a stranger's snooze.
 */
export function pruneKept(liveIds: string[], nowMs: number): Record<string, number> {
  const live = new Set(liveIds);
  const next: Record<string, number> = {};
  for (const [id, until] of Object.entries(readKept())) {
    if (live.has(id) && until > nowMs) next[id] = until;
  }
  writeKept(next);
  return next;
}
