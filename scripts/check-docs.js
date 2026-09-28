// Gate for the user manual in user-docs/, which Mintlify publishes to
// docs.sprintbrain.com on every push to main.
//
// Mintlify's own `mint validate` and `mint broken-links` check the build. This
// checks what they cannot know: the house rules, and the one folder name that
// makes Mintlify drop pages without failing the deploy. A snippet section kept
// in user-docs/snippets/ is treated as reusable text blocks, never as pages, so
// every /snippets/... address was a 404 for weeks while the site looked fine.
//
// Run from the repository root: node scripts/check-docs.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'user-docs');
const PAGE_EXT = /\.mdx?$/;
const LONG_DASH = /[–—]/;
// Hospitality words the product must not ship (root CLAUDE.md, Industry-Neutral).
// "stay" is left out on purpose: as a verb it is ordinary English.
const VERTICAL = /\b(guests?|bookings?|reservations?|check-?ins?|check-?outs?|hotels?|nights)\b/i;

const problems = [];
const fail = (msg) => problems.push(msg);

function walk(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), relPath));
    else out.push(relPath);
  }
  return out;
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8').replace(/^﻿/, '');
}

if (!fs.existsSync(path.join(ROOT, 'docs.json'))) {
  console.error('X user-docs/docs.json not found');
  process.exit(1);
}

let config;
try {
  config = JSON.parse(read('docs.json'));
} catch (err) {
  console.error(`X user-docs/docs.json is not valid JSON: ${err.message}`);
  process.exit(1);
}
for (const key of ['name', 'theme', 'colors', 'navigation']) {
  if (!config[key]) fail(`docs.json has no "${key}", which Mintlify requires`);
}

// Page paths are the strings inside navigation; group, tab and anchor names are
// object properties and never collected.
function collectPages(node, out) {
  if (typeof node === 'string') out.push(node);
  else if (Array.isArray(node)) node.forEach((child) => collectPages(child, out));
  else if (node && typeof node === 'object') {
    for (const key of ['pages', 'groups', 'tabs', 'anchors', 'dropdowns', 'versions', 'languages', 'products']) {
      if (node[key]) collectPages(node[key], out);
    }
  }
  return out;
}

const navPages = collectPages(config.navigation, []);
const seen = new Set();
for (const page of navPages) {
  if (seen.has(page)) fail(`docs.json lists "${page}" twice`);
  seen.add(page);
}

const files = walk(ROOT);
const pageFiles = files.filter((f) => PAGE_EXT.test(f));
const pageSet = new Set(pageFiles.map((f) => f.replace(PAGE_EXT, '')));

for (const page of navPages) {
  if (page.startsWith('snippets/')) {
    fail(`"${page}" is in snippets/, a folder name Mintlify reserves: its files never become pages. Use text-snippets/.`);
  } else if (!pageSet.has(page)) {
    fail(`docs.json lists "${page}" but user-docs/${page}.mdx does not exist`);
  }
}

for (const file of pageFiles) {
  const page = file.replace(PAGE_EXT, '');
  if (file.startsWith('snippets/')) {
    fail(`user-docs/${file} is in snippets/, a folder name Mintlify reserves: it will never be published as a page`);
  } else if (page !== 'index' && !seen.has(page)) {
    fail(`user-docs/${file} is not in the docs.json navigation. Mintlify publishes it anyway: add it to the menu or move it out of user-docs/`);
  }
}

// A link must reach a real page. A redirect is for addresses people already
// have; a link written today should name the page itself.
const redirectSources = (config.redirects || []).map((r) => String(r.source || ''));
function isRedirectSource(link) {
  return redirectSources.some((src) => {
    const wild = src.indexOf('/:');
    return wild === -1 ? src === link : link.startsWith(src.slice(0, wild + 1));
  });
}

const LINK = /\]\((\/[^)\s#?]*)[^)\s]*\)|href="(\/[^"#?]*)[^"]*"/g;
let linkCount = 0;

for (const file of pageFiles) {
  const text = read(file);
  const lines = text.split(/\r?\n/);

  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front || !/^title:\s*\S/m.test(front[1]) || !/^description:\s*\S/m.test(front[1])) {
    fail(`user-docs/${file} needs a frontmatter block with a title and a description`);
  }

  lines.forEach((line, i) => {
    const where = `user-docs/${file}:${i + 1}`;
    if (LONG_DASH.test(line)) fail(`${where} has a long dash; use a comma, a colon or a full stop`);
    const word = line.match(VERTICAL);
    if (word) fail(`${where} says "${word[0]}": examples must fit every industry`);
  });

  for (const match of text.matchAll(LINK)) {
    const raw = (match[1] || match[2]).replace(/\/+$/, '');
    const target = raw === '' ? 'index' : raw.slice(1);
    linkCount += 1;
    if (pageSet.has(target) && (target === 'index' || seen.has(target))) continue;
    if (isRedirectSource(raw)) fail(`user-docs/${file} links to ${raw}, which only redirects: link the page itself`);
    else fail(`user-docs/${file} links to ${raw}, which is not a page`);
  }
}

const configLines = read('docs.json').split(/\r?\n/);
configLines.forEach((line, i) => {
  if (LONG_DASH.test(line)) fail(`user-docs/docs.json:${i + 1} has a long dash`);
});

if (problems.length > 0) {
  for (const p of problems) console.error(`X ${p}`);
  console.error(`\n${problems.length} problem(s) in user-docs/.`);
  process.exit(1);
}

console.log(`OK user-docs: ${pageFiles.length} pages, ${navPages.length} in the menu, ${linkCount} internal links`);
