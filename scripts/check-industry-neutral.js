// Gate for the server functions in services/supabase/functions/, including the
// instructions they send to the AI model.
//
// SprintBrain ships to every industry (root CLAUDE.md, Industry-Neutral). The
// suggest-labels prompt once told the model it worked for a hospitality team
// and gave {guest_name} as its example placeholder. This keeps the words the
// user manual already bans (vertical-words.js) out of every function.
//
// The extension and the phone page are not scanned yet: CLAUDE.md lists known
// gaps there (the extension's selection keywords, the phone's numeric
// heuristic) that are separate work.
//
// Run from the repository root: node scripts/check-industry-neutral.js

const fs = require('fs');
const path = require('path');
const { VERTICAL } = require('./vertical-words');

const FUNCTIONS = 'services/supabase/functions';
const ROOT = path.join(__dirname, '..', FUNCTIONS);

const files = fs.existsSync(ROOT)
  ? fs.readdirSync(ROOT, { recursive: true })
    .map((f) => f.split(path.sep).join('/'))
    .filter((f) => f.endsWith('.ts'))
    .sort()
  : [];

// A scan that finds nothing would pass while checking nothing.
if (files.length === 0) {
  console.error(`X no .ts files in ${FUNCTIONS}/: the gate would check nothing`);
  process.exit(1);
}

const problems = [];
for (const file of files) {
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const word = line.match(VERTICAL);
    if (word) problems.push(`${FUNCTIONS}/${file}:${i + 1} says "${word[0]}": server functions must fit every industry`);
  });
}

if (problems.length > 0) {
  for (const p of problems) console.error(`X ${p}`);
  console.error(`\n${problems.length} problem(s) in ${FUNCTIONS}/.`);
  process.exit(1);
}

console.log(`OK server functions: ${files.length} files, no hospitality words`);
