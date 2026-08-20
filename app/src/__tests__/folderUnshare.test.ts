import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal Supabase query-builder stand-in. Every method returns `this`, and the
// builder is thenable, so both `await from(..).delete().eq(..)` and
// `await from(..).select(..).eq(..).maybeSingle()` resolve.
interface Call {
  table: string;
  op: string;
  payload?: Record<string, unknown>;
  filters: Record<string, unknown>;
}

const calls: Call[] = [];
/** folder_id -> how many grants remain after the delete. */
let remainingGrants = 0;
/** What the pre-delete lookup returns; null models a grant that was already gone. */
let grantLookup: { folder_id: string } | null = { folder_id: 'folder-1' };

function builder(table: string) {
  const call: Call = { table, op: 'select', filters: {} };
  calls.push(call);

  const api = {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      call.op = opts?.head === true ? 'count' : 'select';
      return api;
    },
    update(payload: Record<string, unknown>) {
      call.op = 'update';
      call.payload = payload;
      return api;
    },
    delete() {
      call.op = 'delete';
      return api;
    },
    eq(col: string, val: unknown) {
      call.filters[col] = val;
      return api;
    },
    maybeSingle() {
      return Promise.resolve({ data: grantLookup, error: null });
    },
    then(resolve: (v: unknown) => unknown) {
      if (call.op === 'count') return resolve({ count: remainingGrants, error: null });
      return resolve({ data: null, error: null });
    },
  };
  return api;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn((table: string) => builder(table)) },
}));

import { permissionsApi } from '@/lib/api/permissionsApi';

const folderUpdates = (): Call[] =>
  calls.filter((c) => c.table === 'folders' && c.op === 'update');

beforeEach(() => {
  calls.length = 0;
  remainingGrants = 0;
  grantLookup = { folder_id: 'folder-1' };
});

// Regression: revoking a share used to delete only the folder_permissions row.
// `organization_id` stayed on the folder, and app.folder_level hands every org
// ADMIN 'owner' whenever that column is set — before it looks at any grant. So
// the folder stayed fully readable and writable by every admin while the UI
// reported it as private. CLASS RENT A CAR sat in that state on production.
describe('revokeGrant', () => {
  it('clears organization_id when the last grant is revoked', async () => {
    remainingGrants = 0;
    await permissionsApi.revokeGrant('grant-1');

    const updates = folderUpdates();
    expect(updates).toHaveLength(1);
    expect(updates[0]!.payload).toEqual({ organization_id: null });
    expect(updates[0]!.filters).toEqual({ id: 'folder-1' });
  });

  it('leaves organization_id alone while other grants remain', async () => {
    remainingGrants = 2;
    await permissionsApi.revokeGrant('grant-1');

    // The stamp is what the surviving grants hang on. Clearing it here would
    // revoke everyone, not just the principal being removed.
    expect(folderUpdates()).toHaveLength(0);
  });

  it('still deletes the grant row', async () => {
    await permissionsApi.revokeGrant('grant-1');

    const deletes = calls.filter((c) => c.table === 'folder_permissions' && c.op === 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.filters).toEqual({ id: 'grant-1' });
  });

  it('counts the remaining grants for the right folder', async () => {
    await permissionsApi.revokeGrant('grant-1');

    const counts = calls.filter((c) => c.table === 'folder_permissions' && c.op === 'count');
    expect(counts).toHaveLength(1);
    expect(counts[0]!.filters).toEqual({ folder_id: 'folder-1' });
  });

  it('does nothing extra when the grant was already gone', async () => {
    grantLookup = null;
    await permissionsApi.revokeGrant('grant-1');

    expect(folderUpdates()).toHaveLength(0);
  });
});
