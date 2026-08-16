#!/usr/bin/env node
// Generates the translated landing pages from the English source plus one
// locale file per language. Same shape as scripts/sync-tooltip.js: run without
// arguments to write the pages, or with --check to assert the committed output
// matches what the source would produce right now (used as a CI gate).
//
// Why generate instead of hand-maintaining a copy per language: the landing
// page carries its CSS and JS inline, so a copy is ~2000 lines of which only
// the prose differs. Copies drift on the first design change. Here the English
// file stays the single source and each locale is a list of exact string
// swaps, so a copy that has fallen behind cannot be committed.
//
// A locale entry is {find, replace, count}. `count` defaults to 1 and is
// asserted, so an English string that gets reworded fails the build with the
// stale key named rather than silently leaving English text on a translated
// page.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LANDING = path.join(ROOT, 'app', 'public', 'landing');
const SOURCE = path.join(LANDING, 'index.html');
const LOCALES = path.join(LANDING, 'locales');

// Assets are referenced relatively so the page works both at sprintbrain.com
// (Netlify site rooted at this folder) and at app.sprintbrain.com/landing/.
// A page one level down needs those same refs prefixed, which keeps both
// deployments working.
const RELATIVE_ASSETS = [
  'leib-tour-icon.png',
  'leibtour-logo.png',
  'locoprice-logo.png',
  'supported-aws-startups.png',
  'supported-nvidia-inception.png',
  'supported-google-for-startups.png',
];

const CANONICAL = 'https://sprintbrain.com/';

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join('/');
}

// Windows checkouts (core.autocrlf=true) can materialize these files with
// CRLF even though the committed blob and every string in this file are LF.
// Normalize on read so a fresh `git checkout` doesn't read as spurious drift
// or defeat the hreflang dedup below; every write stays pure LF regardless.
function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function listLocales() {
  if (!fs.existsSync(LOCALES)) return [];
  return fs
    .readdirSync(LOCALES)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.basename(f, '.json'))
    .sort();
}

function hreflangBlock(langs) {
  const lines = [`<link rel="alternate" hreflang="en" href="${CANONICAL}">`];
  for (const lang of langs) {
    lines.push(`<link rel="alternate" hreflang="${lang}" href="${CANONICAL}${lang}/">`);
  }
  lines.push(`<link rel="alternate" hreflang="x-default" href="${CANONICAL}">`);
  return lines.join('\n');
}

function translate(html, locale, lang) {
  let out = html;

  for (const entry of locale.entries) {
    const expected = entry.count == null ? 1 : entry.count;
    const parts = out.split(entry.find);
    const found = parts.length - 1;
    if (found !== expected) {
      throw new Error(
        `[${lang}] expected ${expected} occurrence(s) of:\n    ` +
          JSON.stringify(entry.find.slice(0, 90)) +
          `\n  but found ${found}. The English source likely changed; ` +
          `update app/public/landing/locales/${lang}.json.`,
      );
    }
    out = parts.join(entry.replace);
  }

  out = out.replace('<html lang="en">', `<html lang="${lang}">`);
  if (!out.includes(`<html lang="${lang}">`)) {
    throw new Error(`[${lang}] could not set the <html lang> attribute`);
  }

  for (const asset of RELATIVE_ASSETS) {
    out = out.split(`src="${asset}"`).join(`src="../${asset}"`);
  }

  return out;
}

function withHreflang(html, langs) {
  const block = hreflangBlock(langs);
  const marker = '<link rel="icon" type="image/png" sizes="128x128"';
  const at = html.indexOf(marker);
  if (at === -1) throw new Error('could not find the icon links to anchor hreflang to');
  return html.slice(0, at) + block + '\n' + html.slice(at);
}

function main() {
  const check = process.argv.includes('--check');
  const langs = listLocales();

  if (langs.length === 0) {
    console.log('OK   no locales to build');
    return;
  }

  const source = readText(SOURCE);
  let failed = false;

  // The English source carries the same hreflang set, so search engines see a
  // reciprocal cluster. It is written in place rather than generated.
  const englishWanted = withHreflang(
    source.split(hreflangBlock(langs) + '\n').join(''),
    langs,
  );
  if (source !== englishWanted) {
    if (check) {
      console.error(`X    ${rel(SOURCE)} hreflang block is missing or stale -> run: node scripts/build-landing-i18n.js`);
      failed = true;
    } else {
      fs.writeFileSync(SOURCE, englishWanted);
      console.log(`SYNC ${rel(SOURCE)} hreflang updated`);
    }
  } else {
    console.log(`OK   ${rel(SOURCE)} hreflang in sync`);
  }

  const base = readText(SOURCE);

  for (const lang of langs) {
    const locale = JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8'));
    const target = path.join(LANDING, lang, 'index.html');
    const desired = translate(base, locale, lang);

    const existing = fs.existsSync(target) ? readText(target) : null;
    if (existing === desired) {
      console.log(`OK   ${rel(target)} in sync`);
      continue;
    }
    if (check) {
      const why = existing === null ? 'has not been generated' : 'has drifted from the source';
      console.error(`X    ${rel(target)} ${why} -> run: node scripts/build-landing-i18n.js`);
      failed = true;
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, desired);
    console.log(`SYNC ${rel(target)} written`);
  }

  if (failed) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('X    ' + err.message);
  process.exit(1);
}
