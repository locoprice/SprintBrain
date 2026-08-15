import { supabase } from '@/lib/supabase';
import type {
  InviteResult,
  OrgInvitation,
  OrgRole,
  PendingInvitation,
} from '@/types/database';

// Team invitations (INVITE-001) — the only path into an organization.
//
// Sending runs through the `invite-member` edge function, not straight to the
// table: the invitation email has to be requested server-side. The dashboard
// client is PKCE, so a link requested here would carry a code verifier that
// only exists in the INVITER's browser and would fail to open in anyone else's.
//
// Accept/decline run through SECURITY DEFINER RPCs because an invitee is not a
// member yet — RLS on organization_invitations and organization_members admits
// admins and managers only. Those RPCs match invitations against the caller's
// verified email, so no invitation token is ever exposed to the client.

/** Human copy for each error code the edge function can return. */
const SEND_ERRORS: Record<string, string> = {
  invalid_email: 'That doesn’t look like a valid email address.',
  invalid_role: 'Pick a valid role.',
  self_invite: 'That’s your own address — you’re already in this team.',
  already_member: 'That person is already in your team.',
  not_authorized: 'Only a team admin or manager can invite people.',
  admin_role_requires_admin: 'Only an admin can invite someone as an admin.',
  no_organization: 'You’re not part of a team yet.',
};

export interface InvitationsApi {
  /** Invite an email address to the caller's organization. */
  send(email: string, role: OrgRole): Promise<InviteResult>;
  /** Open and declined invitations for an org (admins and managers only). */
  listForOrg(orgId: string): Promise<OrgInvitation[]>;
  /** Invitations waiting on the signed-in user, matched on their verified email. */
  listMine(): Promise<PendingInvitation[]>;
  /** Join the team. Returns the organization id. */
  accept(invitationId: string): Promise<string>;
  /** Turn the invitation down. No membership is created. */
  decline(invitationId: string): Promise<void>;
  /** Withdraw an invitation you sent. */
  revoke(invitationId: string): Promise<void>;
}

/**
 * Pull the error code out of a FunctionsHttpError. supabase-js puts the failed
 * Response on `context` and leaves `message` as a generic status line, so the
 * body is the only place the code lives.
 */
async function readErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: Response }).context;
  if (!context || typeof context.json !== 'function') return '';
  try {
    const body = (await context.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : '';
  } catch {
    return '';
  }
}

export const invitationsApi: InvitationsApi = {
  async send(email, role) {
    const { data, error } = await supabase.functions.invoke<InviteResult>('invite-member', {
      body: { email: email.trim().toLowerCase(), role },
    });

    if (error) {
      const code = await readErrorCode(error);
      throw new Error(SEND_ERRORS[code] ?? 'Could not send the invitation. Try again.');
    }
    if (!data) {
      throw new Error('Could not send the invitation. Try again.');
    }
    return data;
  },

  async listForOrg(orgId) {
    const { data, error } = await supabase.rpc('org_invitations', { p_org: orgId });
    if (error) throw error;
    return (data ?? []) as OrgInvitation[];
  },

  async listMine() {
    const { data, error } = await supabase.rpc('my_pending_invitations');
    if (error) throw error;
    return (data ?? []) as PendingInvitation[];
  },

  async accept(invitationId) {
    const { data, error } = await supabase.rpc('accept_org_invitation', {
      p_invitation: invitationId,
    });
    if (error) throw error;
    return data as string;
  },

  async decline(invitationId) {
    const { error } = await supabase.rpc('decline_org_invitation', {
      p_invitation: invitationId,
    });
    if (error) throw error;
  },

  async revoke(invitationId) {
    // RLS (orginv_write) restricts this to the org's admins and managers, and
    // matches no row for anyone else — surface that instead of a silent no-op.
    const { data, error } = await supabase
      .from('organization_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) {
      throw new Error('Only a team admin or manager can withdraw an invitation.');
    }
  },
};
