// Review status gate (AI-KNOWLEDGE P2, docs/AI_KNOWLEDGE_PLAN.md).
//
// Four places speak about review status and cannot share code: the database
// (the rules), the dashboard (lib/reviewStatus.ts), the extension (popup and
// content script, vanilla JS) and the phone page (one self-contained file).
// This pins what must agree:
//
//   1. The six statuses, values and words, in the same order everywhere.
//   2. The database guard is attached to all three tables, and fires after the
//      tenancy trigger that sets organization_id (Postgres runs BEFORE
//      triggers in name order).
//   3. Archived content stops: every fetch that feeds expansion, the Context
//      panel, the phone, the MCP server or Ask leaves it out.
//   4. A deprecated snippet warns with the same sentence on every surface.
//   5. Search still runs with the caller's own rights.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION = read('services/supabase/migrations/20261005120000_review_status.sql');
const APP = read('app/src/lib/reviewStatus.ts');
const MOBILE = read('app/public/mobile/index.html');
const POPUP = read('extension/popup/popup.js');
const CONTENT = read('extension/content/content.js');
const BACKGROUND = read('extension/background/background.js');
const PICKER = read('extension/content/memory-picker.js');
const ASK = read('services/supabase/functions/ask-sprintbrain/index.ts');

let failed = 0;
function check(name, ok, detail) {
  if (!ok) {
    console.error('X ' + name + (detail ? '\n    ' + detail : ''));
    failed++;
    return;
  }
  console.log('  ok  ' + name);
}

// ── 1. Statuses ────────────────────────────────────────────────────────────
function pairs(source, start) {
  const at = source.indexOf(start);
  if (at === -1) return [];
  const block = source.slice(at, source.indexOf(']', at));
  return [...block.matchAll(/value:\s*'([a-z_]+)',\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
}

const checks = [...MIGRATION.matchAll(/review_status in \(([^)]*)\)/g)].map((m) =>
  [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]),
);
const app = pairs(APP, 'export const REVIEW_STATUSES');
const mobile = pairs(MOBILE, 'var REVIEW_STATUSES=');
const popup = pairs(POPUP, 'var REVIEW_STATUSES=');

check('the migration constrains all three tables', checks.length === 3, String(checks.length));
check(
  'the three table checks list the same statuses',
  checks.every((c) => JSON.stringify(c) === JSON.stringify(checks[0])),
);
check(
  'the dashboard offers exactly the statuses the database accepts, in its order',
  JSON.stringify(app.map((p) => p[0])) === JSON.stringify(checks[0]),
  'dashboard ' + JSON.stringify(app.map((p) => p[0])) + ' vs database ' + JSON.stringify(checks[0]),
);
check('the phone uses the dashboard\'s words', JSON.stringify(mobile) === JSON.stringify(app), JSON.stringify(mobile));
check('the popup uses the dashboard\'s words', JSON.stringify(popup) === JSON.stringify(app), JSON.stringify(popup));

// ── 2. The guard ───────────────────────────────────────────────────────────
for (const [table, tenancy] of [['snippets', 'trg_snippets_tenancy'], ['prompts', 'trg_prompts_tenancy'], ['memory_shards', null]]) {
  const m = MIGRATION.match(new RegExp('create trigger (\\w+)\\s+before insert or update on public\\.' + table + '\\s+for each row execute function app\\.review_status_guard\\(\\)'));
  check('the review guard is attached to ' + table, m !== null);
  if (m && tenancy) check('the ' + table + ' guard fires after the tenancy trigger', m[1] > tenancy, m[1]);
}

// ── 3. Archived stops ──────────────────────────────────────────────────────
const ARCHIVED = 'review_status=neq.archived';
check('the knowledge view leaves archived snippets out', /s\.review_status <> 'archived'/.test(MIGRATION));
check('the knowledge view leaves archived Brain items out', /m\.review_status <> 'archived'/.test(MIGRATION));
check('the MCP index and bodies leave archived items out', (MIGRATION.match(/and m\.review_status <> 'archived'/g) || []).length >= 3);
check('the worker\'s expansion cache leaves archived snippets out', BACKGROUND.includes("'&is_active=eq.true&" + ARCHIVED));
check('the Context panel leaves archived Brain items out', (BACKGROUND.match(/memory_shards'[\s\S]{0,200}?review_status=neq\.archived/g) || []).length >= 2);
check('the Context panel leaves archived snippets out', BACKGROUND.includes('is_active=is.true&' + ARCHIVED));
check('the popup leaves archived snippets out', POPUP.includes("is_active=eq.true&" + ARCHIVED));
check('the popup leaves archived prompts out', POPUP.includes("'&" + ARCHIVED + "&order=updated_at.desc'"));
check('the phone leaves archived snippets out', MOBILE.includes('accessible_snippets?select=*&' + ARCHIVED));
check('the phone leaves archived prompts out', MOBILE.includes("'&" + ARCHIVED + "&order=updated_at.desc'"));
check('the phone leaves archived Brain items out', MOBILE.includes("it.review_status!=='archived'"));
check('Ask never uses an archived source', ASK.includes("x.found.review_status !== 'archived'"));

// ── 4. Deprecated warns, in one sentence ───────────────────────────────────
const SENTENCE = 'This snippet is deprecated. Check it is still right before you send it.';
check('the in-page card warns with the shared sentence', CONTENT.includes("'" + SENTENCE + "'"));
check('the popup warns with the shared sentence', POPUP.includes("'" + SENTENCE + "'"));
check(
  'the phone builds the same sentence',
  MOBILE.includes("'This '+noun+' is deprecated. Check it is still right before you '+(noun==='snippet'?'send':'use')+' it.'"),
);
check('the worker carries the status into the expansion cache', /review_status: s\.review_status \|\| 'approved'/.test(BACKGROUND));
check('the Context panel marks deprecated rows', PICKER.includes("rows[r].review_status === 'deprecated'"));
check('Ask tells the model a deprecated source is out of date', /deprecated, out of date/.test(ASK));

// ── 5. Search keeps the caller's rights ────────────────────────────────────
const ks = MIGRATION.slice(MIGRATION.indexOf('create function public.knowledge_search('));
const ksBody = ks.slice(0, ks.indexOf('$$;'));
check('knowledge_search is recreated', ksBody.length > 0);
check('knowledge_search stays SECURITY INVOKER', !/security definer/i.test(ksBody.replace(/--.*$/gm, '')));
check('knowledge_search is granted to signed-in users only', /grant execute on function public\.knowledge_search\([^)]*\) to authenticated;/.test(MIGRATION));

if (failed > 0) {
  console.error('\n' + failed + ' review status check(s) failed.');
  process.exit(1);
}
console.log('\nReview status checks passed.');
