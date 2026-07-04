import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Settings → Security: session invalidation contracts.
//
// • authStore sign-out scopes — the normal "Sign out" ends ONLY this browser
//   (scope 'local'); "Sign out from all devices" is the explicit global action
//   and must always end the local session even when the global call fails.
// • securityApi — RPC wiring for listing sessions, revoking one, the liveness
//   heartbeat (fail-open: only an explicit `false` is fatal) and login-event
//   logging (never throws — a failed log must not break login).
// ─────────────────────────────────────────────────────────────────────────────

const sb = vi.hoisted(() => {
  interface RecordedQuery {
    table: string;
    methods: string[];
    filters: Record<string, unknown>;
  }
  const state = {
    rpcResult: { data: null as unknown, error: null as unknown },
    rpcReject: null as Error | null,
    queryResult: { data: null as unknown, error: null as unknown },
    lastRpc: null as { fn: string; args: unknown } | null,
    lastQuery: null as RecordedQuery | null,
    // One entry consumed per auth.signOut call; empty → { error: null }.
    signOutResults: [] as { error: unknown }[],
  };

  function builder(table: string) {
    const q: RecordedQuery = { table, methods: [], filters: {} };
    state.lastQuery = q;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        q.methods.push(name);
        if (name === 'eq' && typeof args[0] === 'string') {
          q.filters[args[0]] = args[1];
        }
        return b;
      };
    for (const m of ['select', 'eq', 'order', 'limit']) {
      b[m] = record(m);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(state.queryResult).then(onFulfilled, onRejected);
    return b;
  }

  return { state, builder };
});

const authMocks = vi.hoisted(() => ({
  signOut: vi.fn((opts?: { scope?: string }) => {
    void opts;
    return Promise.resolve(sb.state.signOutResults.shift() ?? { error: null });
  }),
  clearRememberMe: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { signOut: authMocks.signOut },
    from: vi.fn((table: string) => sb.builder(table)),
    rpc: vi.fn((fn: string, args?: unknown) => {
      sb.state.lastRpc = { fn, args };
      if (sb.state.rpcReject) return Promise.reject(sb.state.rpcReject);
      return Promise.resolve(sb.state.rpcResult);
    }),
  },
  clearRememberMe: authMocks.clearRememberMe,
}));

import { useAuthStore } from '@/stores/authStore';
import { securityApi } from '@/lib/api/securityApi';

const SESSION_ROW = {
  id: 'sess-1',
  created_at: '2026-07-01T10:00:00Z',
  last_active_at: '2026-07-02T09:00:00Z',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0 Safari/537.36',
  ip: '88.18.132.160',
  country: 'ES',
  is_current: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  sb.state.rpcResult = { data: null, error: null };
  sb.state.rpcReject = null;
  sb.state.queryResult = { data: null, error: null };
  sb.state.lastRpc = null;
  sb.state.lastQuery = null;
  sb.state.signOutResults = [];
});

// ─────────────────────────────────────────────────────────────────────────────
// authStore — sign-out scopes (the invalidation core).
// ─────────────────────────────────────────────────────────────────────────────

describe('authStore · sign-out scopes', () => {
  it('normal signOut ends this device only (scope local) and clears remember-me', async () => {
    await useAuthStore.getState().signOut();

    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(authMocks.clearRememberMe).toHaveBeenCalledTimes(1);
  });

  it('signOutAllDevices revokes every session (scope global)', async () => {
    await useAuthStore.getState().signOutAllDevices();

    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
    expect(authMocks.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(authMocks.clearRememberMe).toHaveBeenCalledTimes(1);
  });

  it('signOutAllDevices falls back to a local sign-out when the global call fails', async () => {
    sb.state.signOutResults = [{ error: new Error('server unreachable') }, { error: null }];

    await useAuthStore.getState().signOutAllDevices();

    expect(authMocks.signOut).toHaveBeenCalledTimes(2);
    expect(authMocks.signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
    expect(authMocks.signOut).toHaveBeenNthCalledWith(2, { scope: 'local' });
    // The login-flow contract survives the failure: remember-me is cleared.
    expect(authMocks.clearRememberMe).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// securityApi — RPC wiring.
// ─────────────────────────────────────────────────────────────────────────────

describe('securityApi · listSessions', () => {
  it('maps RPC rows to DeviceSession', async () => {
    sb.state.rpcResult = { data: [SESSION_ROW], error: null };

    const sessions = await securityApi.listSessions();

    expect(sb.state.lastRpc?.fn).toBe('list_user_sessions');
    expect(sessions).toEqual([
      {
        id: 'sess-1',
        createdAt: '2026-07-01T10:00:00Z',
        lastActiveAt: '2026-07-02T09:00:00Z',
        userAgent: SESSION_ROW.user_agent,
        ip: '88.18.132.160',
        country: 'ES',
        isCurrent: true,
      },
    ]);
  });

  it('throws on RPC error', async () => {
    sb.state.rpcResult = { data: null, error: new Error('boom') };
    await expect(securityApi.listSessions()).rejects.toThrow('boom');
  });
});

describe('securityApi · revokeSession', () => {
  it('passes the session id and resolves to whether a row was deleted', async () => {
    sb.state.rpcResult = { data: true, error: null };

    await expect(securityApi.revokeSession('sess-2')).resolves.toBe(true);
    expect(sb.state.lastRpc).toEqual({
      fn: 'revoke_session',
      args: { p_session_id: 'sess-2' },
    });

    sb.state.rpcResult = { data: false, error: null };
    await expect(securityApi.revokeSession('sess-2')).resolves.toBe(false);
  });
});

describe('securityApi · listLoginActivity', () => {
  it('reads the newest login rows and extracts the country from metadata', async () => {
    sb.state.queryResult = {
      data: [
        {
          id: 'evt-1',
          method: 'password',
          ip_address: '88.18.132.160',
          user_agent: 'ua',
          metadata: { session_id: 'sess-1', country: 'IT' },
          created_at: '2026-07-02T08:00:00Z',
        },
        {
          id: 'evt-2',
          method: 'magic_link',
          ip_address: null,
          user_agent: null,
          metadata: { session_id: 'sess-2' },
          created_at: '2026-07-01T08:00:00Z',
        },
      ],
      error: null,
    };

    const events = await securityApi.listLoginActivity(20);

    const q = sb.state.lastQuery;
    expect(q?.table).toBe('auth_audit_log');
    expect(q?.methods).toEqual(expect.arrayContaining(['select', 'eq', 'order', 'limit']));
    expect(q?.filters).toMatchObject({ event: 'login' });
    expect(events.map((e) => e.country)).toEqual(['IT', null]);
    expect(events[0]).toMatchObject({ id: 'evt-1', method: 'password', ipAddress: '88.18.132.160' });
  });

  it('throws on query error', async () => {
    sb.state.queryResult = { data: null, error: new Error('rls denied') };
    await expect(securityApi.listLoginActivity()).rejects.toThrow('rls denied');
  });
});

describe('securityApi · sessionAlive (fail-open heartbeat)', () => {
  it('returns true when the backend says the session is alive', async () => {
    sb.state.rpcResult = { data: true, error: null };
    await expect(securityApi.sessionAlive()).resolves.toBe(true);
  });

  it('returns false ONLY on an explicit backend false', async () => {
    sb.state.rpcResult = { data: false, error: null };
    await expect(securityApi.sessionAlive()).resolves.toBe(false);
  });

  it('treats an RPC error as alive — an outage must never sign users out', async () => {
    sb.state.rpcResult = { data: null, error: new Error('503') };
    await expect(securityApi.sessionAlive()).resolves.toBe(true);
  });

  it('treats a rejected call as alive', async () => {
    sb.state.rpcReject = new Error('network down');
    await expect(securityApi.sessionAlive()).resolves.toBe(true);
  });
});

describe('securityApi · logLoginEvent', () => {
  it('passes the method label to the RPC', async () => {
    await securityApi.logLoginEvent('password');
    expect(sb.state.lastRpc).toEqual({
      fn: 'log_login_event',
      args: { p_method: 'password' },
    });
  });

  it('resolves without throwing when the RPC fails — login must not break', async () => {
    sb.state.rpcReject = new Error('offline');
    await expect(securityApi.logLoginEvent('email_otp')).resolves.toBeUndefined();

    sb.state.rpcReject = null;
    sb.state.rpcResult = { data: null, error: new Error('denied') };
    await expect(securityApi.logLoginEvent('magic_link')).resolves.toBeUndefined();
  });
});
