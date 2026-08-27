import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Loader2, Mail, RotateCw, Send, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { invitationsApi } from '@/lib/api/invitationsApi';
import {
  isCommitKey,
  parseEmailList,
  summarizeInvites,
  type InviteOutcome,
} from '@/lib/emailList';
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

// Describes SHARING power, because that is what this chooser actually decides.
// The manager line used to read "Can invite people and share folders", which
// promised authority the code does not grant: `app.folder_level` returns
// 'owner' to org ADMINS only, so a manager manages sharing on exactly the
// folders they own, same as any member.
const ROLE_HELP: Record<OrgRole, string> = {
  member: 'Uses everything shared with them. Can share folders they own.',
  manager: 'Everything a member can do, plus inviting people.',
  admin: 'Full control, including sharing on every folder in the team.',
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

  /** Committed addresses, shown as chips. */
  const [emails, setEmails] = useState<string[]>([]);
  /** What is still being typed, not yet committed to a chip. */
  const [draft, setDraft] = useState('');
  const [role, setRole] = useState<OrgRole>('member');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

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

  /** Send one invitation into THIS org. Never throws; reports its own outcome. */
  async function sendOne(target: string, targetRole: OrgRole): Promise<InviteOutcome> {
    try {
      const result = await invitationsApi.send(target, targetRole, org.id);
      if (!result.emailed) {
        return {
          email: target,
          ok: false,
          reason: `saved, but the email didn’t go out (${result.emailError ?? 'unknown error'}).`,
        };
      }
      return { email: target, ok: true, reason: '' };
    } catch (err) {
      return {
        email: target,
        ok: false,
        reason: err instanceof Error ? err.message : 'could not be sent.',
      };
    }
  }

  /** Move whatever is in the draft into chips. Returns the resulting list. */
  function commitDraft(text: string, current: string[]): string[] {
    const { valid, invalid } = parseEmailList(text);
    setError(
      invalid.length === 0
        ? null
        : invalid.length === 1
          ? `“${invalid[0]}” is not an email address.`
          : `${invalid.length} entries are not email addresses, starting with “${invalid[0]}”.`,
    );
    if (valid.length === 0) return current;
    const merged = [...current];
    for (const address of valid) if (!merged.includes(address)) merged.push(address);
    return merged;
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (isCommitKey(e.key)) {
      // Space and comma are separators here, never characters in an address.
      if (draft.trim() === '') {
        if (e.key !== 'Tab') e.preventDefault();
        return;
      }
      e.preventDefault();
      setEmails((prev) => commitDraft(draft, prev));
      setDraft('');
      return;
    }
    // Backspace on an empty field pulls the last chip back for editing, which
    // is what every chip input does and what a typo correction needs.
    if (e.key === 'Backspace' && draft === '' && emails.length > 0) {
      e.preventDefault();
      setDraft(emails[emails.length - 1] ?? '');
      setEmails((prev) => prev.slice(0, -1));
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text');
    if (!/[\s,;]/.test(text)) return; // a single address: let it type normally
    e.preventDefault();
    setEmails((prev) => commitDraft(draft + ' ' + text, prev));
    setDraft('');
  }

  function removeEmail(target: string) {
    setEmails((prev) => prev.filter((a) => a !== target));
  }

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    // Anything still in the box counts: nobody expects Send to ignore what
    // they just typed because they did not press comma first.
    const targets = commitDraft(draft, emails);
    if (targets.length === 0) return;
    setEmails(targets);
    setDraft('');

    setSending(true);
    const outcomes: InviteOutcome[] = [];
    for (const target of targets) {
      outcomes.push(await sendOne(target, role));
    }
    await refresh();
    setSending(false);

    const failed = outcomes.filter((o) => !o.ok);
    showToast(summarizeInvites(outcomes), failed.length > 0 ? 'error' : 'success');
    // Keep only what failed, so a retry does not re-invite everyone who worked.
    setEmails(failed.map((o) => o.email));
    setError(failed.length > 0 ? summarizeInvites(outcomes) : null);
    if (failed.length === 0) setRole('member');
  }

  async function handleResend(invitation: OrgInvitation) {
    setBusyId(invitation.id);
    setError(null);
    const outcome = await sendOne(invitation.email, invitation.role);
    showToast(
      outcome.ok
        ? `Invitation resent to ${invitation.email}.`
        : `${invitation.email}: ${outcome.reason}`,
      outcome.ok ? 'success' : 'error',
    );
    await refresh();
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
          {/* Chip field. Clicking anywhere in it focuses the input, so the
              whole box behaves like one control rather than a box with an
              input hiding at the end of it. */}
          <div
            onClick={() => inputRef.current?.focus()}
            className={cn(
              'flex flex-1 flex-wrap items-center gap-1.5 rounded-[10px] border border-line bg-card px-2.5 py-2',
              'focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20',
              sending && 'opacity-60',
            )}
          >
            {emails.map((address) => (
              <span
                key={address}
                className="inline-flex items-center gap-1 rounded-full bg-bg-alt py-1 pl-2.5 pr-1 text-xs text-ink-muted"
              >
                {address}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeEmail(address);
                  }}
                  disabled={sending}
                  aria-label={`Remove ${address}`}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder={emails.length === 0 ? 'teammate@company.com' : 'Add another'}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={() => {
                if (draft.trim() === '') return;
                setEmails((prev) => commitDraft(draft, prev));
                setDraft('');
              }}
              disabled={sending}
              aria-label="Email addresses to invite"
              className="min-w-[180px] flex-1 border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-ink-subtle"
            />
          </div>
          <Button type="submit" disabled={sending || (emails.length === 0 && draft.trim() === '')}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {emails.length > 1 ? `Send ${emails.length} invites` : 'Send invite'}
          </Button>
        </div>
        <p className="text-[11px] text-ink-subtle">
          Paste a whole list. Commas, spaces, and line breaks all separate addresses.
        </p>

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
