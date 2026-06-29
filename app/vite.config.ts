import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
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

// ── Landing page version stamp ──────────────────────────────────────────────
// The marketing landing is static HTML served verbatim from public/, so it
// can't read the `define` constants below. This plugin replaces the
// `{{EXT_VERSION}}` token with the extension version (single source of truth:
// extension/manifest.json) — in dev via middleware, in prod by rewriting the
// emitted file. The badge can never drift from a release again.

const EXT_VERSION_TOKEN    = '{{EXT_VERSION}}';
const RELEASE_DATE_TOKEN   = '{{RELEASE_DATE}}';
const RELEASE_MONTH_TOKEN  = '{{RELEASE_MONTH}}';

function readExtensionVersion(): string {
  try {
    const manifestPath = path.resolve(__dirname, '../extension/manifest.json');
    const { version } = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
      version: string;
    };
    return `v${version}`;
  } catch {
    return APP_VERSION;
  }
}

function formatReleaseDate(iso: string): string {
  if (!iso) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [year, month, day] = iso.split('-').map(Number);
  return `${months[month - 1]} ${day}, ${year}`;
}

function formatReleaseMonth(iso: string): string {
  if (!iso) return '';
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const [year, month] = iso.split('-').map(Number);
  return `${months[month - 1]} ${year}`;
}

function landingVersionPlugin(): Plugin {
  const version      = readExtensionVersion();
  const releaseDate  = formatReleaseDate(RELEASE_DATE);
  const releaseMonth = formatReleaseMonth(RELEASE_DATE);
  const sourceFile   = path.resolve(__dirname, 'public/landing/index.html');
  const distFile     = path.resolve(__dirname, 'dist/landing/index.html');
  const stamp = (html: string): string =>
    html.split(EXT_VERSION_TOKEN).join(version)
        .split(RELEASE_DATE_TOKEN).join(releaseDate)
        .split(RELEASE_MONTH_TOKEN).join(releaseMonth);

  return {
    name: 'sprintbrain-landing-version',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        if (
          pathname === '/landing' ||
          pathname === '/landing/' ||
          pathname === '/landing/index.html'
        ) {
          try {
            const html = stamp(fs.readFileSync(sourceFile, 'utf-8'));
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
            return;
          } catch {
            // Fall through to Vite's default static handling.
          }
        }
        next();
      });
    },
    closeBundle() {
      try {
        fs.writeFileSync(distFile, stamp(fs.readFileSync(distFile, 'utf-8')));
      } catch {
        // Landing page absent from this build — nothing to stamp.
      }
    },
  };
}
// ────────────────────────────────────────────────────────────────────────────

// ── Mobile page version stamp ────────────────────────────────────────────────
// Same pattern as landingVersionPlugin: replaces {{APP_VERSION}} in the static
// mobile HTML with the app version derived from git tags at build time.

const APP_VERSION_TOKEN = '{{APP_VERSION}}';

function mobileVersionPlugin(): Plugin {
  const version      = APP_VERSION;
  const releaseMonth = formatReleaseMonth(RELEASE_DATE);
  const sourceFile   = path.resolve(__dirname, 'public/mobile/index.html');
  const distFile     = path.resolve(__dirname, 'dist/mobile/index.html');
  const stamp = (html: string): string =>
    html.split(APP_VERSION_TOKEN).join(version)
        .split(RELEASE_MONTH_TOKEN).join(releaseMonth);

  return {
    name: 'sprintbrain-mobile-version',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url ?? '').split('?')[0];
        if (
          pathname === '/mobile' ||
          pathname === '/mobile/' ||
          pathname === '/mobile/index.html'
        ) {
          try {
            const html = stamp(fs.readFileSync(sourceFile, 'utf-8'));
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(html);
            return;
          } catch {
            // Fall through to Vite's default static handling.
          }
        }
        next();
      });
    },
    closeBundle() {
      try {
        fs.writeFileSync(distFile, stamp(fs.readFileSync(distFile, 'utf-8')));
      } catch {
        // Mobile page absent from this build — nothing to stamp.
      }
    },
  };
}
// ────────────────────────────────────────────────────────────────────────────

// ── Native dashboard (Sprintbrain.html) deploy plugin ───────────────────────
// The vanilla shared-core dashboard lives at the repo root (Sprintbrain.html) and
// loads the extension/* scripts by relative path. Neither is part of the app/ tree
// Vite builds, so copy both into dist/ after the bundle is written — single source
// preserved (no committed duplication of the extension code). Served at
// /Sprintbrain.html with its deps under /extension/*; real files take precedence
// over the SPA fallback, so they resolve directly.

function nativeDashboardPlugin(): Plugin {
  const repoRoot = path.resolve(__dirname, '..');
  const htmlSrc  = path.join(repoRoot, 'Sprintbrain.html');
  const extSrc   = path.join(repoRoot, 'extension');
  const distDir  = path.resolve(__dirname, 'dist');

  return {
    name: 'sprintbrain-native-dashboard',
    apply: 'build',
    closeBundle() {
      fs.copyFileSync(htmlSrc, path.join(distDir, 'Sprintbrain.html'));
      fs.cpSync(extSrc, path.join(distDir, 'extension'), { recursive: true });
    },
  };
}
// ────────────────────────────────────────────────────────────────────────────

export default defineConfig({
  plugins: [react(), landingVersionPlugin(), mobileVersionPlugin(), nativeDashboardPlugin()],
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
    rollupOptions: {
      output: {
        // Split heavy vendors into their own cached chunks so no single chunk
        // blows past Vite's 500 kB advisory and repeat visits re-use them.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
});
