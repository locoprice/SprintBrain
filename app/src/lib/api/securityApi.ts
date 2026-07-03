import { supabase } from '@/lib/supabase';

// Security surface: active sessions, per-session revocation, session liveness
// (heartbeat) and login activity. Sessions live in GoTrue's auth.sessions and
// are reached through SECURITY DEFINER RPCs (migration
// 20260702000000_security_sessions_and_login_activity.sql); login activity is
// a plain RLS-scoped read of public.auth_audit_log.

export type LoginMethod = 'password' | 'magic_link' | 'email_otp';

export interface DeviceSession {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  userAgent: string | null;
  ip: string | null;
  country: string | null;
  isCurrent: boolean;
}

export interface LoginEvent {
  id: string;
  method: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  country: string | null;
  createdAt: string;
}

interface SessionRow {
  id: string;
  created_at: string;
  last_active_at: string;
  user_agent: string | null;
  ip: string | null;
  country: string | null;
  is_current: boolean;
}

interface ActivityRow {
  id: string;
  method: string | null;
  ip_address: string | null;
  user_agent: string | null;
  metadata: { country?: string } | null;
  created_at: string;
}

export const securityApi = {
  /** Active sessions for the signed-in user, current session first. */
  async listSessions(): Promise<DeviceSession[]> {
    const { data, error } = await supabase.rpc('list_user_sessions');
    if (error) throw error;
    return ((data ?? []) as SessionRow[]).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
      userAgent: row.user_agent,
      ip: row.ip,
      country: row.country,
      isCurrent: row.is_current,
    }));
  },

  /**
   * Sign out one device by deleting its session row. Its refresh token dies
   * immediately; the device's UI converges via the session_alive heartbeat.
   * Resolves to whether a session was actually deleted.
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    const { data, error } = await supabase.rpc('revoke_session', {
      p_session_id: sessionId,
    });
    if (error) throw error;
    return data === true;
  },

  /** Most recent login events (RLS limits rows to the calling user). */
  async listLoginActivity(limit = 20): Promise<LoginEvent[]> {
    const { data, error } = await supabase
      .from('auth_audit_log')
      .select('id, method, ip_address, user_agent, metadata, created_at')
      .eq('event', 'login')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return ((data ?? []) as ActivityRow[]).map((row) => ({
      id: row.id,
      method: row.method,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      country: row.metadata?.country ?? null,
      createdAt: row.created_at,
    }));
  },

  /**
   * Heartbeat: is the current session still alive server-side?
   * Fail-open — ONLY an explicit `false` from the backend means the session
   * was revoked. Errors (offline, outage, expired token mid-refresh) must
   * never sign the user out; supabase-js's own refresh failure already covers
   * genuinely dead tokens.
   */
  async sessionAlive(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('session_alive');
      if (error) return true;
      return data !== false;
    } catch {
      return true;
    }
  },

  /**
   * Record a login in the activity log. IP, user-agent, country and timestamp
   * are derived server-side; repeat calls for the same session are no-ops.
   * Never throws — a failed log write must not break the login flow.
   */
  async logLoginEvent(method: LoginMethod): Promise<void> {
    try {
      const { error } = await supabase.rpc('log_login_event', { p_method: method });
      if (error) console.warn('securityApi: login event not recorded', error);
    } catch (err) {
      console.warn('securityApi: login event not recorded', err);
    }
  },
};
