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
  'assets/platforms/chrome-extension-2346f49352.webp',
  'assets/platforms/web-dashboard-f279d50f4a.webp',
  'assets/platforms/mobile-app-2be08c95f8.jpg',
  'assets/platforms/security-b15d62fdd2.webp',
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

function hreflangBlock(langs, page = '') {
  const lines = [`<link rel="alternate" hreflang="en" href="${CANONICAL}${page}">`];
  for (const lang of langs) {
    lines.push(`<link rel="alternate" hreflang="${lang}" href="${CANONICAL}${lang}/${page}">`);
  }
  lines.push(`<link rel="alternate" hreflang="x-default" href="${CANONICAL}${page}">`);
  return lines.join('\n');
}

// Matches any run of hreflang <link> tags regardless of which languages they
// list, so adding or removing a locale replaces the old block instead of
// stacking a second one next to it (an exact-string match on the *new* block
// can't find the *old* one once the language set has changed).
const HREFLANG_RUN = /(?:<link rel="alternate" hreflang="[^"]*" href="[^"]*">\n)+/;

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

function withHreflang(html, langs, page = '') {
  const block = hreflangBlock(langs, page);
  const stripped = html.replace(HREFLANG_RUN, '');
  const marker = '<link rel="icon" type="image/png" sizes="128x128"';
  const at = stripped.indexOf(marker);
  if (at === -1) throw new Error('could not find the icon links to anchor hreflang to');
  return stripped.slice(0, at) + block + '\n' + stripped.slice(at);
}

// Reuse the homepage shell after translation so navigation, contact and footer
// copy have one source of truth. Missing/duplicate markers fail the parity check.
function sharedPart(html, name) {
  const pattern = new RegExp('(?:/\\*|<!--|//) SHARED:' + name + ':BEGIN[^\\n]*\\n([\\s\\S]*?)\\n(?:/\\*|<!--|//) SHARED:' + name + ':END', 'g');
  const matches = Array.from(html.matchAll(pattern));
  if (matches.length !== 1) throw new Error(`Expected one shared ${name} fragment`);
  return matches[0][1].trim();
}

function pricingShell(home, lang) {
  const rootPrefix = lang === 'en' ? '../' : '../../';
  const currentDir = lang === 'en' ? 'pricing' : `${lang}/pricing`;
  const rebase = html => html.replace(/src="([^"]+)"/g, (match, src) =>
    /^(?:https?:|data:|\/)/.test(src) ? match : `src="../${src}"`)
    .replaceAll('href="/"', 'href="../"')
    .replaceAll('href="#features"', 'href="../#features"')
    .replaceAll('href="pricing/"', 'href="./"')
    .replaceAll('href="/legal/', `href="${rootPrefix}legal/`);
  let header = rebase(sharedPart(home, 'header'));
  header = header.replaceAll('href="./" class="nav-link"', 'href="./" class="nav-link" aria-current="page"');
  let footer = sharedPart(home, 'footer');
  footer = footer.replace(/<nav class="foot-lang"[\s\S]*?<\/nav>/, block =>
    block.replace(/href="[^"]*" hreflang="([^"]+)"/g, (_, code) => {
      const target = code === 'en' ? 'pricing' : `${code}/pricing`;
      const href = (path.posix.relative(currentDir, target) || '.') + '/';
      return `href="${href}" hreflang="${code}"`;
    }));
  return {
    PRICING_ARTWORK: rootPrefix + 'assets/pricing/lifetime-credit-v1.jpg',
    SITE_HEADER: header,
    SITE_FOOTER: rebase(footer),
    SITE_CONTACT: sharedPart(home, 'contact'),
    SITE_CSS: ['base-css', 'hero-css', 'footer-css', 'contact-css', 'mobile-nav-css']
      .map(name => sharedPart(home, name)).join('\n\n') +
      '\n@media(max-width:640px){\n' + sharedPart(home, 'mobile-hero-css') + '\n' + sharedPart(home, 'mobile-footer-css') + '\n}',
    SITE_JS: sharedPart(home, 'controls-js') + '\n\n' + sharedPart(home, 'footer-js'),
  };
}

function buildPricing(langs, check) {
  const template = withHreflang(readText(path.join(ROOT, 'scripts', 'templates', 'pricing.html')), langs, 'pricing/');
  const homeSource = readText(SOURCE);
  let failed = false;
  for (const lang of ['en', ...langs]) {
    let html = template;
    let home = homeSource;
    if (lang !== 'en') {
      const locale = JSON.parse(fs.readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8'));
      if (!Array.isArray(locale.pricingEntries)) throw new Error(`[${lang}] missing pricing translations`);
      html = translate(template, { entries: locale.pricingEntries }, lang)
        .replace('href="../icon128.png"', 'href="../../icon128.png"')
        .replace(`<link rel="canonical" href="${CANONICAL}pricing/">`,
          `<link rel="canonical" href="${CANONICAL}${lang}/pricing/">`);
      home = translate(homeSource, locale, lang);
    }
    const fragments = pricingShell(home, lang);
    for (const [name, content] of Object.entries(fragments)) {
      const marker = `{{${name}}}`;
      if (html.split(marker).length !== 2) throw new Error(`Expected one ${marker} in pricing template`);
      html = html.replace(marker, () => content);
    }
    const target = path.join(LANDING, lang === 'en' ? '' : lang, 'pricing', 'index.html');
    if (fs.existsSync(target) && readText(target) === html) {
      console.log(`OK   ${rel(target)} in sync`);
    } else if (check) {
      console.error(`X    ${rel(target)} has drifted -> run: node scripts/build-landing-i18n.js`);
      failed = true;
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, html);
      console.log(`SYNC ${rel(target)} written`);
    }
  }
  return failed;
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
  const englishWanted = withHreflang(source, langs);
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

  const pricingFailed = buildPricing(langs, check);
  if (failed || pricingFailed) process.exit(1);
}

try {
  main();
} catch (err) {
  console.error('X    ' + err.message);
  process.exit(1);
}
