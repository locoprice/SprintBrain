import { supabase } from '@/lib/supabase';
import type { OrgMember, OrgRole, OrganizationSummary } from '@/types/database';

// Organization reads for the dashboard. The folder-sharing UI (Phase B) needs
// to know the signed-in user's active organization and its member directory.
//
// RLS does the scoping: `organization_members` / `organizations` only return
// rows for orgs the user belongs to, and `org_member_directory` is a guarded
// SECURITY DEFINER function that returns teammate identity to co-members only.

type OrgRel = { id: string; name: string; slug: string | null };
type MembershipRow = {
  role: OrgRole;
  // supabase-js may surface an embedded to-one relation as an object or a
  // single-element array depending on how it infers cardinality — handle both.
  organizations: OrgRel | OrgRel[] | null;
};

type DirectoryRow = {
  user_id: string;
  email: string;
  display_name: string;
  role: OrgRole;
};

export interface OrgApi {
  /**
   * The signed-in user's active organization (their earliest membership), or
   * null when they belong to no org. Multi-org membership is supported in the
   * DB; a future org switcher will let users change the active one.
   */
  getActiveOrg(): Promise<OrganizationSummary | null>;
  /** The member directory for an org the caller belongs to. */
  listMembers(orgId: string): Promise<OrgMember[]>;
}

export const orgApi: OrgApi = {
  async getActiveOrg() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return null;

    const { data, error } = await supabase
      .from('organization_members')
      .select('role, organizations(id, name, slug)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true })
      .limit(1);
    if (error) throw error;

    const row = (data ?? [])[0] as MembershipRow | undefined;
    if (!row || !row.organizations) return null;
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!org) return null;
    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      myRole: row.role,
    };
  },

  async listMembers(orgId) {
    const { data, error } = await supabase.rpc('org_member_directory', { p_org: orgId });
    if (error) throw error;
    return ((data ?? []) as DirectoryRow[]).map((r) => ({
      user_id: r.user_id,
      email: r.email,
      display_name: r.display_name,
      role: r.role,
    }));
  },
};
