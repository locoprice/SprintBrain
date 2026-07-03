import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, LogOut, Monitor, ShieldCheck, Smartphone } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/layout/EmptyState';
import { securityApi, type DeviceSession, type LoginEvent } from '@/lib/api/securityApi';
import { formatLocation, parseUserAgent } from '@/lib/deviceInfo';
import { useAuthStore } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

const METHOD_LABELS: Record<string, string> = {
  password: 'Password',
  magic_link: 'Magic link',
  email_otp: 'Email code',
};

function DeviceIcon({ userAgent }: { userAgent: string | null }) {
  const { kind } = parseUserAgent(userAgent);
  const Icon = kind === 'mobile' ? Smartphone : Monitor;
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-bg-alt text-ink-muted">
      <Icon className="h-4 w-4" />
    </div>
  );
}

function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

export function SecurityPanel() {
  const signOut = useAuthStore((s) => s.signOut);
  const signOutAllDevices = useAuthStore((s) => s.signOutAllDevices);
  const showToast = useUiStore((s) => s.showToast);

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [activity, setActivity] = useState<LoginEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sessionRows, activityRows] = await Promise.all([
        securityApi.listSessions(),
        securityApi.listLoginActivity(),
      ]);
      setSessions(sessionRows);
      setActivity(activityRows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load security data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRevoke(session: DeviceSession) {
    if (session.isCurrent) {
      // Signing out the current device is a normal local sign-out — it also
      // deletes this session server-side and AuthGate redirects to /login.
      await signOut();
      return;
    }
    setRevokingId(session.id);
    try {
      await securityApi.revokeSession(session.id);
      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      showToast('Device signed out');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not sign out device', 'error');
    } finally {
      setRevokingId(null);
    }
  }

  async function onConfirmSignOutAll() {
    setSigningOutAll(true);
    // Ends this session too — AuthGate redirects to /login on SIGNED_OUT,
    // so there is no local state to restore afterwards.
    await signOutAllDevices();
  }

  const busy = revokingId !== null || signingOutAll;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your devices</CardTitle>
          <CardDescription>
            Sessions signed in to your account over the last 60 days.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-3 py-2 text-sm text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading sessions…
            </div>
          ) : loadError ? (
            <div className="flex items-center justify-between gap-3 rounded-[10px] border border-danger/30 bg-danger/5 p-3">
              <div className="flex items-center gap-2 text-xs text-danger">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {loadError}
              </div>
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : sessions.length === 0 ? (
            <p className="text-sm text-ink-muted">No session data available.</p>
          ) : (
            <div className="divide-y divide-line">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <DeviceIcon userAgent={session.userAgent} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {parseUserAgent(session.userAgent).label}
                      </span>
                      {session.isCurrent && <Badge variant="primary">This device</Badge>}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {formatLocation(session.country, session.ip)} · Last active{' '}
                      {relativeTime(session.lastActiveAt)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void onRevoke(session)}
                  >
                    {revokingId === session.id ? 'Signing out…' : 'Sign out'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <CardFooter className="justify-between gap-4">
          <p className="text-xs text-ink-muted">
            Ends every session — this browser, other computers, the mobile companion,
            and the Chrome extension.
          </p>
          <Button
            variant="ghost"
            className="shrink-0 border-danger/30 text-danger hover:border-danger/50 hover:bg-danger/5"
            disabled={loading || busy}
            onClick={() => setConfirmOpen(true)}
          >
            <LogOut className="h-4 w-4" />
            Sign out from all devices
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent login activity</CardTitle>
          <CardDescription>
            The last sign-ins to your account, with device and approximate location.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-3 py-2 text-sm text-ink-muted">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              Loading activity…
            </div>
          ) : activity.length === 0 && !loadError ? (
            <EmptyState
              icon={ShieldCheck}
              title="No login activity yet"
              description="Sign-ins are recorded from now on — your next login will appear here."
            />
          ) : (
            <div className="divide-y divide-line">
              {activity.map((event) => (
                <div
                  key={event.id}
                  className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <DeviceIcon userAgent={event.userAgent} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">
                        {parseUserAgent(event.userAgent).label}
                      </span>
                      <Badge variant="neutral">
                        {(event.method && METHOD_LABELS[event.method]) || 'Sign-in'}
                      </Badge>
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {formatLocation(event.country, event.ipAddress)} ·{' '}
                      {relativeTime(event.createdAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!signingOutAll) setConfirmOpen(open);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign out from all devices?</DialogTitle>
            <DialogDescription>
              Every session ends now: this browser, other computers, the mobile
              companion, and the Chrome extension. You'll need to sign in again
              everywhere.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={signingOutAll}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              className="bg-danger text-white hover:bg-danger/90"
              disabled={signingOutAll}
              onClick={() => void onConfirmSignOutAll()}
            >
              {signingOutAll ? 'Signing out…' : 'Sign out everywhere'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
