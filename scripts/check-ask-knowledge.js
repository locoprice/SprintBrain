// Ask SprintBrain gate (AI-KNOWLEDGE P1, docs/AI_KNOWLEDGE_PLAN.md).
//
// Ask SprintBrain lives on two surfaces that cannot share code: the dashboard
// (app/src/features/search/AskAnswer.tsx over app/src/lib/askKnowledge.ts) and
// the phone page (app/public/mobile/index.html, a single file that cannot load
// either). The database decides which feedback verdicts exist. This pins the
// things that must agree, and the guarantees the server function makes:
//
//   1. The verdict list, values and labels and order, is identical in the
//      migration's check, the dashboard and the phone.
//   2. The edge function never reads with more rights than the caller: no
//      service-role key, every read through the caller's JWT.
//   3. The edge function only answers from what it found: no sources means no
//      model call, and an answer that cites nothing is not an answer.
//   4. Both surfaces call the same function and write the same table.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const MIGRATION = read('services/supabase/migrations/20261004120000_knowledge_feedback.sql');
const APP = read('app/src/lib/askKnowledge.ts');
const MOBILE = read('app/public/mobile/index.html');
const FN = read('services/supabase/functions/ask-sprintbrain/index.ts');
const API = read('app/src/lib/api/askApi.ts');

let failed = 0;
function check(name, ok, detail) {
  if (!ok) {
    console.error('X ' + name + (detail ? '\n    ' + detail : ''));
    failed++;
    return;
  }
  console.log('  ok  ' + name);
}

// ── 1. Verdicts ────────────────────────────────────────────────────────────
const sqlMatch = MIGRATION.match(/verdict in \(([^)]*)\)/);
const sqlVerdicts = sqlMatch ? [...sqlMatch[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) : [];

function pairs(source, start) {
  const at = source.indexOf(start);
  if (at === -1) return [];
  const end = source.indexOf(']', at);
  const block = source.slice(at, end);
  return [...block.matchAll(/value:\s*'([a-z_]+)',\s*label:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);
}

const appVerdicts = pairs(APP, 'export const ASK_VERDICTS');
const mobileVerdicts = pairs(MOBILE, 'var ASK_VERDICTS=');

check('the migration lists the feedback verdicts', sqlVerdicts.length === 6, JSON.stringify(sqlVerdicts));
check(
  'the dashboard offers exactly the verdicts the database accepts, in its order',
  JSON.stringify(appVerdicts.map((p) => p[0])) === JSON.stringify(sqlVerdicts),
  'dashboard ' + JSON.stringify(appVerdicts.map((p) => p[0])) + ' vs database ' + JSON.stringify(sqlVerdicts),
);
check(
  'the phone offers the same verdicts with the same words as the dashboard',
  JSON.stringify(mobileVerdicts) === JSON.stringify(appVerdicts),
  'phone ' + JSON.stringify(mobileVerdicts) + ' vs dashboard ' + JSON.stringify(appVerdicts),
);

// ── 2. Reads as the caller ─────────────────────────────────────────────────
check('the function never touches the service-role key', !/SERVICE_ROLE/i.test(FN));
check(
  'the function builds its one client from the caller\'s Authorization header',
  (FN.match(/createClient\(/g) || []).length === 1 && /headers:\s*\{\s*Authorization:\s*authHeader\s*\}/.test(FN),
);
check('the function searches through knowledge_search', /userClient\.rpc\('knowledge_search'/.test(FN));

// ── 3. Only answers from what it found ─────────────────────────────────────
const noSources = FN.indexOf("status: 'no_sources'");
const modelCall = FN.indexOf('anthropic.messages.create');
check('the function returns "no sources" before any model call', noSources !== -1 && modelCall !== -1 && noSources < modelCall);
check('a browse result (rank 0) is not evidence', /h\.rank > 0/.test(FN));
check('an answer that cites no source is downgraded', /used\.size > 0/.test(FN));
check('citations are checked against the sources actually sent', /known\.has\(ref\)/.test(FN));

// ── 4. One function, one table ─────────────────────────────────────────────
check('the dashboard calls ask-sprintbrain', /'ask-sprintbrain'/.test(API));
check('the phone calls ask-sprintbrain', /\/functions\/v1\/ask-sprintbrain/.test(MOBILE));
check('the dashboard writes feedback to knowledge_feedback', /from\('knowledge_feedback'\)/.test(API));
check('the phone writes feedback to knowledge_feedback', /\/rest\/v1\/knowledge_feedback/.test(MOBILE));
check(
  'the phone offers Ask under all three search fields',
  ['srch', 'prompt-srch', 'mem-srch'].every((id) => MOBILE.includes('class="ask-row sb-hidden" data-ask-for="' + id + '"')),
);

if (failed > 0) {
  console.error('\n' + failed + ' Ask SprintBrain check(s) failed.');
  process.exit(1);
}
console.log('\nAsk SprintBrain checks passed.');
