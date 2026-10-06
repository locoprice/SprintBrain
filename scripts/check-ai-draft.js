// Draft with AI gate (AI-KNOWLEDGE P3, docs/AI_KNOWLEDGE_PLAN.md).
//
// The edge function (Deno), the dashboard (TypeScript) and the database cannot
// share code, so this pins what must agree between them:
//
//   1. The text limits, languages and Brain item kinds are the same on both
//      sides of the wire.
//   2. The function drafts with the caller's own rights, keeps a new Brain
//      item's text exactly as pasted, and only files under folders and labels
//      the caller sent.
//   3. The drafting rules keep the owners' decisions: details that change
//      become fields, numbers never do, nothing is invented, no industry is
//      assumed.
//   4. All three editors carry the same two pieces, and a new item saved from
//      a draft is created as ai_generated, never approved.
//   5. memory_save_shard takes the status in the same call, and only one that
//      waits for a person.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const FN = read('services/supabase/functions/draft-with-ai/index.ts');
const LIB = read('app/src/lib/aiDraft.ts');
const MIGRATION = read('services/supabase/migrations/20261006120000_memory_save_review_status.sql');
const SNIPPET_EDITOR = read('app/src/features/snippets/NewSnippetDialog.tsx');
const PROMPT_EDITOR = read('app/src/features/prompts/PromptBlockEditor.tsx');
const ITEM_EDITOR = read('app/src/features/memory/ItemEditor.tsx');
const SNIPPETS_API = read('app/src/lib/api/snippetsApi.ts');
const PROMPTS_API = read('app/src/lib/api/promptsApi.ts');
const MEMORY_API = read('app/src/lib/api/memoryApi.ts');

let failed = 0;
function check(name, ok, detail) {
  if (!ok) {
    console.error('X ' + name + (detail ? '\n    ' + detail : ''));
    failed++;
    return;
  }
  console.log('  ok  ' + name);
}

const constant = (source, name) => {
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*(\\d+);'));
  return m ? Number(m[1]) : null;
};
const list = (source, name) => {
  const m = source.match(new RegExp('const ' + name + '\\s*=\\s*\\[([^\\]]*)\\]'));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null;
};

// ── 1. Both sides of the wire ──────────────────────────────────────────────
check('the minimum text length matches', constant(FN, 'MIN_TEXT_CHARS') === constant(LIB, 'DRAFT_TEXT_MIN'),
  constant(FN, 'MIN_TEXT_CHARS') + ' vs ' + constant(LIB, 'DRAFT_TEXT_MIN'));
check('the maximum text length matches', constant(FN, 'MAX_TEXT_CHARS') === constant(LIB, 'DRAFT_TEXT_MAX'),
  constant(FN, 'MAX_TEXT_CHARS') + ' vs ' + constant(LIB, 'DRAFT_TEXT_MAX'));
check('the maximum is the Brain item body limit', constant(FN, 'MAX_TEXT_CHARS') === constant(ITEM_EDITOR, 'BODY_MAX'));
check('the snippet languages match', JSON.stringify(list(FN, 'LANGUAGES')) === JSON.stringify(list(LIB, 'LANGUAGES')),
  JSON.stringify(list(FN, 'LANGUAGES')) + ' vs ' + JSON.stringify(list(LIB, 'LANGUAGES')));
check('the Brain item kinds match', JSON.stringify(list(FN, 'MEMORY_KINDS')) === JSON.stringify(list(LIB, 'MEMORY_KINDS')));
check('a drafted Brain item kind is one the editor offers',
  JSON.stringify(list(FN, 'MEMORY_KINDS')) === JSON.stringify(["fact", "note", "conversation"]) &&
  /AUTHORABLE_KINDS: MemoryItemKind\[\] = \['fact', 'note', 'conversation'\]/.test(ITEM_EDITOR));

// ── 2. Rights and guarantees ───────────────────────────────────────────────
check('the function never uses the service role', !/SERVICE_ROLE/.test(FN));
check('the function reads as the caller', /createClient\(SUPABASE_URL, SUPABASE_ANON_KEY, \{\s*global: \{ headers: \{ Authorization: authHeader \} \}/.test(FN));
check('a new Brain item keeps the pasted text', FN.includes("const body = mode === 'new' ? pasted : text(parsed.body);"));
check('folders and labels come only from what the caller sent',
  FN.includes('folder: pickOne(parsed.folder, folders)') && FN.includes('labels: pickMany(parsed.labels, labels)'));
check('the function handles a refusal before reading the reply', FN.includes("message.stop_reason === 'refusal'"));

// ── 3. The drafting rules ──────────────────────────────────────────────────
check('nothing is invented', FN.includes('Never add a fact, price, policy, date, promise, contact detail or step that is not in it.'));
check('numbers never become fields', FN.includes('Never make a field out of an amount, price, total, count, quantity, duration or any other number'));
check('details that change become fields', /\{formtext: name=CLIENT_NAME\}/.test(FN) && /\{formdate: name=START_DATE; format=DD\/MM\/YYYY\}/.test(FN) && /\{formmenu: First option,Second option; name=PLAN\}/.test(FN));
check('no other tokens are allowed', FN.includes('Use no other braces, formulas or tokens.'));
check('no industry is assumed', FN.includes('assume no industry'));
const prompts = (FN.match(/const [A-Z_]+_PROMPT = `[\s\S]*?`;/g) || []).join('\n');
const vertical = prompts.match(/\b(guests?|booking|reservations?|check-?in|check-?out|nights?|property|properties|stay)\b/i);
check('the drafting prompts carry no vertical vocabulary', vertical === null, vertical && vertical[0]);

// ── 4. The three editors ───────────────────────────────────────────────────
for (const [name, source, kind] of [
  ['snippet', SNIPPET_EDITOR, 'snippet'],
  ['prompt', PROMPT_EDITOR, 'prompt'],
  ['Brain item', ITEM_EDITOR, 'memory'],
]) {
  check('the ' + name + ' editor offers Draft from text', new RegExp('<DraftFromTextButton[\\s\\S]{0,120}kind="' + kind + '"').test(source));
  check('the ' + name + ' editor shows the draft notice', new RegExp('<DraftNotice[\\s\\S]{0,120}kind="' + kind + '"').test(source));
  check('the ' + name + ' editor takes an update handed to it', source.includes("useDraftStore.getState().take('" + kind + "'"));
  check('a new ' + name + ' from a draft is saved as ai_generated', /aiDrafted[^\n]*\{ reviewStatus: 'ai_generated'/.test(source));
}
check('the snippet insert carries the status', SNIPPETS_API.includes('...(options?.reviewStatus ? { review_status: options.reviewStatus } : {})'));
check('the prompt insert carries the status', PROMPTS_API.includes('...(options?.reviewStatus ? { review_status: options.reviewStatus } : {})'));
check('the Brain item save carries the status', MEMORY_API.includes('...(input.reviewStatus ? { p_review_status: input.reviewStatus } : {})'));

// ── 5. memory_save_shard ───────────────────────────────────────────────────
check('the old signature is dropped first', /drop function if exists public\.memory_save_shard\(uuid, text, text, text, text, uuid, text, jsonb, boolean, smallint, text, text\);/.test(MIGRATION));
check('the status is a defaulted last parameter', /p_review_status\s+text\s+default null\s*\n\)/.test(MIGRATION));
check('only a waiting status can be asked for', MIGRATION.includes("p_review_status not in ('draft', 'ai_generated', 'under_review')"));
check('it is granted to signed-in users only',
  /revoke all on function public\.memory_save_shard\([^)]*\) from public, anon;/.test(MIGRATION) &&
  /grant execute on function public\.memory_save_shard\([^)]*\) to authenticated;/.test(MIGRATION));

// The manual page follows the switch, not this gate: scripts/check-pro-gate.js.

if (failed > 0) {
  console.error('\n' + failed + ' Draft with AI check(s) failed.');
  process.exit(1);
}
console.log('\nDraft with AI checks passed.');
