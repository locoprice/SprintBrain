import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Pins the contract of save_prompt_with_version, the prompt editor's save
// (HISTORY-001), as the newest migration that defines it.
//
// The first version declared the folder id as uuid. Folder ids are TEXT (the
// LeibTour team folder is 'leibtour_team_shared'), so PostgREST rejected every
// save of a prompt in that folder with a 400 before the function ran. It also
// let only the owner save, where the prompts table lets an editor of the shared
// folder write too. Both shipped because nothing read the SQL.

const MIGRATIONS = resolve(process.cwd(), '..', 'services', 'supabase', 'migrations');

/** The newest migration's text from the first match of `marker` onwards. */
function newestDefinition(marker: RegExp): string {
  const files = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse();
  for (const name of files) {
    const sql = readFileSync(resolve(MIGRATIONS, name), 'utf8');
    const at = sql.search(marker);
    if (at !== -1) return sql.slice(at).replace(/\s+/g, ' ').toLowerCase();
  }
  throw new Error(`No migration matches ${marker}`);
}

const saveFn = newestDefinition(/create or replace function public\.save_prompt_with_version\(/i);
const parameters = saveFn.slice(0, saveFn.indexOf(')'));
const body = saveFn.slice(0, saveFn.indexOf('$$;'));

describe('save_prompt_with_version', () => {
  it('takes the folder id as text, like every other function that takes one', () => {
    expect(parameters).toContain('p_folder_id text');
    expect(parameters).not.toContain('p_folder_id uuid');
  });

  it('lets an editor of the shared folder save, not only the owner', () => {
    expect(body).toContain('user_id = v_uid');
    expect(body).toContain('app.can_write_folder(folder_id)');
  });
});

describe('promptver_select', () => {
  it('shows the history to anyone who can open the prompt', () => {
    const policy = newestDefinition(/create policy promptver_select/i);
    const using = policy.slice(0, policy.indexOf(';'));
    expect(using).toContain('p.user_id = auth.uid()');
    expect(using).toContain('app.can_read_folder(p.folder_id)');
  });
});
