import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { AlertCircle, CheckCircle2, Loader2, MailOpen, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { invitationsApi } from '@/lib/api/invitationsApi';
import { useAuthStore } from '@/stores/authStore';
import { useOrgStore } from '@/stores/orgStore';
import type { OrgRole, PendingInvitation } from '@/types/database';

type Outcome = { kind: 'accepted' | 'declined'; org: string };

const ROLE_LABEL: Record<OrgRole, string> = {
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
};

const ROLE_HELP: Record<OrgRole, string> = {
  member: 'You’ll be able to use everything the team shares with you.',
  manager: 'You’ll be able to invite people and share folders.',
  admin: 'You’ll have full control of the team.',
};

/**
 * Where an invitation is answered (INVITE-001). The email signs the person in
 * and lands them here; `my_pending_invitations` matches on their VERIFIED
 * email, so nothing in the URL grants access and a stale link gives nobody
 * anyone else's invitation.
 *
 * Standalone (no dashboard chrome) and served on mobile too — an invite gets
 * opened on a phone more often than not.
 */
export function InvitePage() {
  const email = useAuthStore((s) => s.user?.email ?? null);
  const refreshOrg = useOrgStore((s) => s.refresh);

  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInvitations(await invitationsApi.listMine());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your invitations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAccept(invitation: PendingInvitation) {
    setBusyId(invitation.id);
    setError(null);
    try {
      await invitationsApi.accept(invitation.id);
      // The roster and the share picker read from this store — pull the new
      // membership in before the dashboard renders.
      await refreshOrg();
      setOutcome({ kind: 'accepted', org: invitation.org_name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not accept the invitation.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDecline(invitation: PendingInvitation) {
    setBusyId(invitation.id);
    setError(null);
    try {
      await invitationsApi.decline(invitation.id);
      setOutcome({ kind: 'declined', org: invitation.org_name });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not decline the invitation.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-bg p-6">
      <div className="w-full max-w-md">
        {loading ? (
          <div className="rounded-[16px] border border-line bg-card p-8 text-center shadow-md">
            <Loader2 className="mx-auto h-6 w-6 animate-spin text-primary" />
            <p className="mt-4 text-sm text-ink-muted">Checking your invitations…</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {outcome && (
              <div className="rounded-[16px] border border-line bg-card p-5 text-center shadow-md">
                {outcome.kind === 'accepted' ? (
                  <>
                    <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-success" />
                    <h1 className="text-lg font-semibold text-ink">
                      You’re in — welcome to {outcome.org}
                    </h1>
                    <p className="mt-2 text-sm text-ink-muted">
                      Everything the team has shared is already in your dashboard and your Chrome
                      extension.
                    </p>
                    <Button asChild className="mt-5">
                      <Link to="/team">Go to the team</Link>
                    </Button>
                  </>
                ) : (
                  <>
                    <MailOpen className="mx-auto mb-3 h-10 w-10 text-ink-subtle" />
                    <h1 className="text-lg font-semibold text-ink">Invitation declined</h1>
                    <p className="mt-2 text-sm text-ink-muted">
                      You have not joined {outcome.org}, and nothing has been shared with you. Your
                      own snippets are untouched.
                    </p>
                    <Button asChild variant="ghost" className="mt-5">
                      <Link to="/">Go to your dashboard</Link>
                    </Button>
                  </>
                )}
              </div>
            )}

            {invitations.map((invitation) => (
              <section
                key={invitation.id}
                className="rounded-[16px] border border-line bg-card p-6 shadow-md"
              >
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[12px] bg-primary-light text-primary">
                  <Users className="h-6 w-6" />
                </div>

                <h1 className="text-center text-lg font-semibold text-ink">
                  Join {invitation.org_name}
                </h1>
                <p className="mt-2 text-center text-sm text-ink-muted">
                  {invitation.invited_by_name
                    ? `${invitation.invited_by_name} invited you`
                    : 'You were invited'}{' '}
                  as a {ROLE_LABEL[invitation.role].toLowerCase()}. {ROLE_HELP[invitation.role]}
                </p>

                <div className="mt-5 flex flex-col gap-2">
                  <Button
                    onClick={() => void handleAccept(invitation)}
                    disabled={busyId !== null}
                    className="w-full"
                  >
                    {busyId === invitation.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Accept and join
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void handleDecline(invitation)}
                    disabled={busyId !== null}
                    className="w-full"
                  >
                    Decline
                  </Button>
                </div>

                <p className="mt-4 text-center text-[11px] text-ink-subtle">
                  Expires{' '}
                  {formatDistanceToNow(new Date(invitation.expires_at), { addSuffix: true })}
                </p>
              </section>
            ))}

            {invitations.length === 0 && !outcome && (
              <div className="rounded-[16px] border border-line bg-card p-8 text-center shadow-md">
                <MailOpen className="mx-auto mb-3 h-10 w-10 text-ink-subtle" />
                <h1 className="text-lg font-semibold text-ink">No invitations waiting</h1>
                <p className="mt-2 text-sm text-ink-muted">
                  You’re signed in as{' '}
                  <span className="font-medium text-ink">{email ?? 'this account'}</span>. If the
                  invitation went to a different address, sign out and sign back in with that one.
                </p>
                <Button asChild variant="ghost" className="mt-5">
                  <Link to="/">Go to your dashboard</Link>
                </Button>
              </div>
            )}

            {error && (
              <p className="flex items-center justify-center gap-1.5 text-center text-xs text-danger">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
