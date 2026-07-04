import { beforeEach, describe, expect, it, vi } from 'vitest';

// Heartbeat contract: a session revoked server-side (Settings → Security on
// another device) triggers exactly ONE local sign-out; anything else — alive
// session, overlapping checks, repeated ticks after death — must not.

const mocks = vi.hoisted(() => ({
  sessionAlive: vi.fn(() => Promise.resolve(true)),
  signOut: vi.fn(() => Promise.resolve({ error: null })),
}));

vi.mock('@/lib/api/securityApi', () => ({
  securityApi: { sessionAlive: mocks.sessionAlive },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { signOut: mocks.signOut } },
}));

import { heartbeatTick, startSessionHeartbeat } from '@/lib/sessionHeartbeat';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sessionAlive.mockImplementation(() => Promise.resolve(true));
  // Re-arms the module's dead-session latch (the environment guard makes this
  // a state-only reset under the node test environment — no timers attach).
  startSessionHeartbeat();
});

describe('sessionHeartbeat · heartbeatTick', () => {
  it('does nothing while the session is alive', async () => {
    await heartbeatTick();
    await heartbeatTick();

    expect(mocks.sessionAlive).toHaveBeenCalledTimes(2);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it('signs out locally exactly once when the session is revoked', async () => {
    mocks.sessionAlive.mockImplementation(() => Promise.resolve(false));

    await heartbeatTick();

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });

    // Dead-session latch: further ticks neither re-check nor re-sign-out.
    await heartbeatTick();
    expect(mocks.sessionAlive).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it('re-arms after a restart (new login) and can fire again', async () => {
    mocks.sessionAlive.mockImplementation(() => Promise.resolve(false));
    await heartbeatTick();
    expect(mocks.signOut).toHaveBeenCalledTimes(1);

    startSessionHeartbeat(); // user signed back in
    await heartbeatTick();
    expect(mocks.signOut).toHaveBeenCalledTimes(2);
  });

  it('collapses overlapping ticks into one liveness check', async () => {
    let release: (alive: boolean) => void = () => {};
    mocks.sessionAlive.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );

    const first = heartbeatTick();
    const second = heartbeatTick(); // in-flight guard → immediate no-op
    release(true);
    await Promise.all([first, second]);

    expect(mocks.sessionAlive).toHaveBeenCalledTimes(1);
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});
