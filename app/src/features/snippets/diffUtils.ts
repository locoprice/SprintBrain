export type DiffLine = { type: 'context' | 'added' | 'removed'; text: string };

// LCS-based line diff. Uses a flat (row-major) Int32Array to avoid the
// `noUncheckedIndexedAccess` issues that arise with number[][] in strict mode.
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];

  if (a.length === 0 && b.length === 0) return [];

  const m = a.length;
  const n = b.length;

  // Flat row-major DP table: dp[i*(n+1)+j] = LCS length of a[0..i) vs b[0..j)
  const dp = new Int32Array((m + 1) * (n + 1));
  const W = n + 1;

  function cell(r: number, c: number): number {
    return dp[r * W + c] ?? 0;
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * W + j] =
        a[i - 1] === b[j - 1]
          ? cell(i - 1, j - 1) + 1
          : Math.max(cell(i - 1, j), cell(i, j - 1));
    }
  }

  // Traceback (produces ops in reverse order, then reversed below)
  const ops: DiffLine[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    const aLine = a[i - 1] ?? '';
    const bLine = b[j - 1] ?? '';
    if (i > 0 && j > 0 && aLine === bLine) {
      ops.push({ type: 'context', text: aLine });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || cell(i, j - 1) >= cell(i - 1, j))) {
      ops.push({ type: 'added', text: bLine });
      j--;
    } else {
      ops.push({ type: 'removed', text: aLine });
      i--;
    }
  }
  return ops.reverse();
}

export function hasDiff(lines: DiffLine[]): boolean {
  return lines.some((l) => l.type !== 'context');
}

/** Extract a readable first name from an email address or display string. */
export function toDisplayName(raw: string): string {
  const emailMatch = raw.match(/^([^@]+)@/);
  if (emailMatch) {
    const local = emailMatch[1] ?? '';
    return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return raw;
}
