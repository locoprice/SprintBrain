import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Mail, RotateCw, Send, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invitationsApi } from '@/lib/api/invitationsApi';
import { useUiStore } from '@/stores/uiStore';
import type { OrganizationSummary, OrgInvitation, OrgRole } from '@/types/database';

interface InviteMemberPanelProps {
  org: OrganizationSummary;
}

const ROLE_LABEL: Record<OrgRole, string> = {
  member: 'Member',
  manager: 'Manager',
  admin: 'Admin',
};

const ROLE_HELP: Record<OrgRole, string> = {
  member: 'Uses everything shared with them',
  manager: 'Can invite people and share folders',
  admin: 'Full control of the team',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'bg-primary-light text-primary',
  declined: 'bg-danger-bg text-danger',
  expired: 'bg-warning-bg text-warning-deep',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  declined: 'Declined',
  expired: 'Expired',
};

/**
 * Invite people to the organization by email (INVITE-001). Admins and managers
 * only — the same bar the `orginv_write` policy and the `invite-member` edge
 * function enforce, so a member never sees a control that would fail.
 *
 * An invitation is not a membership: the person accepts or declines from
 * /invite, and only accepting puts them in the roster.
 */
export function InviteMemberPanel({ org }: InviteMemberPanelProps) {
  const showToast = useUiStore((s) => s.showToast);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [invitations, setInvitations] = useState<OrgInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // An admin can hand out any role; a manager cannot mint an admin (the edge
  // function rejects it either way — this keeps the impossible option hidden).
  const roles: OrgRole[] =
    org.myRole === 'admin' ? ['member', 'manager', 'admin'] : ['member', 'manager'];

  const refresh = useCallback(async () => {
    try {
      const rows = await invitationsApi.listForOrg(org.id);
      setInvitations(rows);
    } catch {
      // Non-fatal: the panel still sends. The list simply stays as it was.
      setInvitations([]);
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingCount = useMemo(
    () => invitations.filter((i) => i.status === 'pending').length,
    [invitations],
  );

  async function dispatch(target: string, targetRole: OrgRole, resend: boolean) {
    setError(null);
    try {
      const result = await invitationsApi.send(target, targetRole);
      if (result.emailed) {
        showToast(resend ? `Invitation resent to ${target}.` : `Invitation sent to ${target}.`);
      } else {
        showToast(
          `Invitation saved, but the email didn’t go out: ${result.emailError ?? 'unknown error'}`,
          'error',
        );
      }
      await refresh();
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not send the invitation.';
      setError(message);
      if (resend) showToast(message, 'error');
      return false;
    }
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const target = email.trim().toLowerCase();
    if (!target) return;

    setSending(true);
    const ok = await dispatch(target, role, false);
    if (ok) {
      setEmail('');
      setRole('member');
    }
    setSending(false);
  }

  async function handleResend(invitation: OrgInvitation) {
    setBusyId(invitation.id);
    await dispatch(invitation.email, invitation.role, true);
    setBusyId(null);
  }

  async function handleRevoke(invitation: OrgInvitation) {
    setBusyId(invitation.id);
    try {
      await invitationsApi.revoke(invitation.id);
      showToast(`Invitation to ${invitation.email} withdrawn.`);
      await refresh();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Could not withdraw the invitation.',
        'error',
      );
    }
    setBusyId(null);
  }

  return (
    <section className="rounded-[16px] border border-line bg-card p-5">
      <header className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-light text-primary">
          <Mail className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">Invite people to {org.name}</h2>
          <p className="text-xs text-ink-muted">
            They get an email and choose whether to join. Nothing is shared until they accept.
          </p>
        </div>
      </header>

      <form onSubmit={handleSend} noValidate className="flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <Input
              type="email"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="teammate@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={sending}
              aria-label="Email address to invite"
            />
          </div>
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send invite
          </Button>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Join as
          </span>
          <div className="flex gap-1.5">
            {roles.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={cn(
                  'flex-1 rounded-[8px] border px-2 py-1.5 text-xs font-semibold transition-colors',
                  role === r
                    ? 'border-primary bg-primary-light text-primary'
                    : 'border-line text-ink-muted hover:bg-bg-alt',
                )}
                title={ROLE_HELP[r]}
              >
                {ROLE_LABEL[r]}
              </button>
            ))}
          </div>
          <span className="text-[11px] text-ink-subtle">{ROLE_HELP[role]}</span>
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
      </form>

      {/* Sent invitations — open ones first, then anything that came back declined. */}
      {!loading && invitations.length > 0 && (
        <div className="mt-5 flex flex-col gap-1.5 border-t border-line pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Invitations · {pendingCount} waiting
          </span>
          <ul className="flex flex-col gap-1.5">
            {invitations.map((invitation) => {
              const busy = busyId === invitation.id;
              return (
                <li
                  key={invitation.id}
                  className="flex items-center justify-between gap-2 rounded-[10px] border border-line px-3 py-2"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-ink">{invitation.email}</span>
                    <span className="truncate text-[11px] text-ink-subtle">
                      {ROLE_LABEL[invitation.role]} ·{' '}
                      {invitation.invited_by_name
                        ? `invited by ${invitation.invited_by_name} · `
                        : ''}
                      {formatDistanceToNow(new Date(invitation.created_at), { addSuffix: true })}
                    </span>
                  </span>

                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        STATUS_STYLE[invitation.status] ?? 'bg-bg-alt text-ink-subtle',
                      )}
                    >
                      {STATUS_LABEL[invitation.status] ?? invitation.status}
                    </span>
                    <button
                      type="button"
                      onClick={() => void handleResend(invitation)}
                      disabled={busy}
                      aria-label={`Resend the invitation to ${invitation.email}`}
                      title="Send it again"
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-bg-alt hover:text-primary disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {invitation.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => void handleRevoke(invitation)}
                        disabled={busy}
                        aria-label={`Withdraw the invitation to ${invitation.email}`}
                        title="Withdraw"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
