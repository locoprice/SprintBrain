import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { execSync } from 'node:child_process';

// ── Build-time changelog generator ──────────────────────────────────────────
// Parses `git log` at every build/dev-server start. No manual updates needed:
// any commit with a conventional-commit prefix (feat/fix/refactor/perf) and an
// optional "— vX.Y.Z" suffix is picked up automatically.

interface RawChange { type: string; text: string; }
interface RawEntry  { version: string; date: string; label: string; changes: RawChange[]; }

function buildChangelog(): RawEntry[] {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const raw = execSync(
      'git log --pretty=format:"%s%x09%ad" --date=short --no-merges',
      { encoding: 'utf-8', cwd: repoRoot },
    ).trim();

    if (!raw) return [];

    // Types to surface; everything else is skipped (chore, docs, test, build…)
    const TYPE_MAP: Record<string, string> = {
      feat: 'feat', fix: 'fix', refactor: 'refactor', perf: 'feat', new: 'new',
    };

    const versions = new Map<string, RawEntry>();
    const unreleased: RawChange[] = [];
    let unreleasedDate = '';

    for (const line of raw.split('\n')) {
      const sep = line.lastIndexOf('\t');
      if (sep === -1) continue;
      const subject = line.slice(0, sep).trim();
      const date    = line.slice(sep + 1).trim();

      // Extract optional "— v2.36.0" version marker at the end of the subject
      const vMatch  = subject.match(/[—\-–]\s*(v\d+[\d.]*)\s*$/);
      const version = vMatch?.[1] ?? null;
      const clean   = version
        ? subject.replace(/\s*[—\-–]\s*v[\d.]+\s*$/, '').trim()
        : subject;

      // Parse conventional commit: type[(scope)][!]: description
      const cc = clean.match(/^(\w+)(?:\([^)]+\))?!?:\s*(.+)$/);
      if (!cc) continue;
      const [, rawType, text] = cc;
      const type = TYPE_MAP[rawType];
      if (!type) continue; // skip chore / docs / test / build etc.

      if (version) {
        if (!versions.has(version)) {
          versions.set(version, { version, date, label: text, changes: [] });
        }
        versions.get(version)!.changes.push({ type, text });
      } else {
        if (!unreleasedDate) unreleasedDate = date;
        unreleased.push({ type, text });
      }
    }

    // Sort versions semantically descending (v2.37.0 before v2.36.0)
    const sorted = [...versions.values()].sort((a, b) => {
      const n = (v: string) => v.replace(/^v/, '').split('.').map(Number);
      const [aM, am = 0, ap = 0] = n(a.version);
      const [bM, bm = 0, bp = 0] = n(b.version);
      return bM - aM || bm - am || bp - ap;
    });

    const result: RawEntry[] = [];
    if (unreleased.length > 0) {
      result.push({
        version: 'Unreleased',
        date: unreleasedDate,
        label: unreleased[0]?.text ?? 'Latest changes',
        changes: unreleased,
      });
    }
    result.push(...sorted);
    return result;
  } catch {
    return [];
  }
}

const CHANGELOG    = buildChangelog();
const latestTagged = CHANGELOG.find((e) => e.version !== 'Unreleased');
const APP_VERSION  = latestTagged?.version ?? 'v0.0.0';
const RELEASE_DATE = latestTagged?.date    ?? '';
// ────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react()],
  define: {
    // Injected at build time — components read these as plain constants.
    __APP_CHANGELOG__:    JSON.stringify(CHANGELOG),
    __APP_VERSION__:      JSON.stringify(APP_VERSION),
    __APP_RELEASE_DATE__: JSON.stringify(RELEASE_DATE),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
