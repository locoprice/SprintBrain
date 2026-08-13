import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Users } from 'lucide-react';
import { invitationsApi } from '@/lib/api/invitationsApi';
import type { PendingInvitation } from '@/types/database';

/**
 * Standing notice that someone is waiting on an answer (INVITE-001).
 *
 * The invitation email is the delivery mechanism, not the dependency: a person
 * already signed in — or one whose email bounced, landed in spam, or opened on
 * a device they no longer use — still finds the invitation here. Disappears on
 * its own once every pending invitation has been accepted or declined.
 */
export function PendingInviteBanner() {
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);

  useEffect(() => {
    let cancelled = false;
    invitationsApi
      .listMine()
      .then((rows) => {
        if (!cancelled) setInvitations(rows);
      })
      // Non-fatal: a failed check just means no banner, never a broken shell.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [first] = invitations;
  if (!first) return null;

  const extra = invitations.length - 1;

  return (
    <Link
      to="/invite"
      className="flex items-center gap-2.5 border-b border-line bg-primary-light px-8 py-2 text-sm text-primary transition-colors hover:bg-primary-light/70"
    >
      <Users className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">
          {first.invited_by_name ?? 'Someone'} invited you to join {first.org_name}
        </span>
        {extra > 0 && ` · ${extra} more invitation${extra > 1 ? 's' : ''}`}
      </span>
      <span className="flex shrink-0 items-center gap-1 font-semibold">
        Accept or decline
        <ArrowRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
