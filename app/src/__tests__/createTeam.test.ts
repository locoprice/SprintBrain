import { beforeEach, describe, expect, it, vi } from 'vitest';

// `create_team` is a SECURITY DEFINER RPC because org_insert and orgmem_write
// deadlock a client-side create (see the migration). These tests cover the
// client wrapper's contract: what it sends, what it returns, and how it
// surfaces the RPC's human-readable errors.

interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

const calls: RpcCall[] = [];
let rpcResult: { data: unknown; error: { message: string } | null } = {
  data: 'org-1',
  error: null,
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      return Promise.resolve(rpcResult);
    },
  },
}));

const { orgApi } = await import('@/lib/api/orgApi');

beforeEach(() => {
  calls.length = 0;
  rpcResult = { data: 'org-1', error: null };
});

describe('orgApi.createTeam', () => {
  it('calls the create_team RPC with the trimmed name', async () => {
    await orgApi.createTeam('  Club Automotive  ');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ fn: 'create_team', args: { p_name: 'Club Automotive' } });
  });

  it('returns the caller as admin of the new org', async () => {
    const org = await orgApi.createTeam('Club Automotive');

    // The creator is the only member, so the summary is fully determined by
    // the RPC's return value — no follow-up read.
    expect(org).toEqual({
      id: 'org-1',
      name: 'Club Automotive',
      slug: null,
      myRole: 'admin',
      cover: null,
    });
  });

  it('stores the trimmed name, matching the RPC btrim', async () => {
    const org = await orgApi.createTeam('\t Acme Ltd \n');
    expect(org.name).toBe('Acme Ltd');
  });

  it('surfaces the RPC message verbatim so the guard copy reaches the user', async () => {
    rpcResult = {
      data: null,
      error: { message: 'You are already in a team. One team per account for now.' },
    };

    await expect(orgApi.createTeam('Second Team')).rejects.toThrow(
      'You are already in a team. One team per account for now.',
    );
  });

  it('surfaces a name-guard message verbatim', async () => {
    rpcResult = { data: null, error: { message: 'Give your team a name' } };
    await expect(orgApi.createTeam('   ')).rejects.toThrow('Give your team a name');
  });

  it('fails loudly when the RPC returns no id', async () => {
    // A silent success here would leave the UI believing it has a team.
    rpcResult = { data: null, error: null };
    await expect(orgApi.createTeam('Club Automotive')).rejects.toThrow(
      'Could not create the team. Try again.',
    );
  });
});
