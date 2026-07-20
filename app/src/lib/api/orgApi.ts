import { supabase } from '@/lib/supabase';
import {
  buildTeamCoverPath,
  COVER_MAX_BYTES,
  objectPathFromPublicUrl,
  TEAM_COVER_BUCKET,
  validateCoverSource,
  validateImageFile,
} from '@/lib/branding';
import { COVER_MAX_WIDTH, downscaleImage } from '@/lib/imageResize';
import { isImageCover } from '@/lib/teamCoverPresets';
import type { OrgMember, OrgRole, OrganizationSummary } from '@/types/database';

// Organization reads for the dashboard. The folder-sharing UI (Phase B) needs
// to know the signed-in user's active organization and its member directory.
//
// RLS does the scoping: `organization_members` / `organizations` only return
// rows for orgs the user belongs to, and `org_member_directory` is a guarded
// SECURITY DEFINER function that returns teammate identity to co-members only.

type OrgRel = { id: string; name: string; slug: string | null; cover: string | null };
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
  /**
   * Set the team cover to a preset key or null (remove). Admin-only — enforced
   * by the `org_update` RLS policy, which matches 0 rows for non-admins; we
   * surface that as a clear error rather than a silent no-op. Pass the previous
   * cover so a replaced/removed uploaded image gets cleaned out of storage.
   */
  setCover(orgId: string, cover: string | null, previousCover?: string | null): Promise<void>;
  /** Upload a cover image, point the org at its public URL, drop the previous upload. */
  uploadCover(orgId: string, currentCover: string | null, file: File): Promise<string>;
}

export const orgApi: OrgApi = {
  async getActiveOrg() {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) return null;

    const { data, error } = await supabase
      .from('organization_members')
      .select('role, organizations(id, name, slug, cover)')
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
      cover: org.cover,
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

  async setCover(orgId, cover, previousCover = null) {
    const { data, error } = await supabase
      .from('organizations')
      .update({ cover })
      .eq('id', orgId)
      .select('id');
    if (error) throw error;
    // RLS (org_update, admin-only) matches 0 rows for non-admins — make that explicit.
    if (!data || data.length === 0) {
      throw new Error('Only a team admin can change the cover.');
    }
    // Drop a replaced or removed uploaded image (best-effort; a leftover is harmless).
    if (isImageCover(previousCover) && previousCover !== cover) {
      const prevPath = objectPathFromPublicUrl(previousCover, TEAM_COVER_BUCKET);
      if (prevPath) void supabase.storage.from(TEAM_COVER_BUCKET).remove([prevPath]);
    }
  },

  async uploadCover(orgId, currentCover, file) {
    const badSource = validateCoverSource(file);
    if (badSource) throw new Error(badSource);

    // Resize before upload: a phone photo is far larger than the cover renders,
    // so the storage cap applies to the processed image, not the original.
    const prepared = await downscaleImage(file, {
      maxWidth: COVER_MAX_WIDTH,
      maxBytes: COVER_MAX_BYTES,
    });
    const invalid = validateImageFile(prepared, COVER_MAX_BYTES);
    if (invalid) throw new Error(invalid);

    // Timestamped per-org key — a replacement gets a fresh URL, so no
    // CDN/browser cache can keep serving the old image.
    const path = buildTeamCoverPath(orgId, prepared.type, Date.now());
    const { error: uploadErr } = await supabase.storage
      .from(TEAM_COVER_BUCKET)
      .upload(path, prepared, { contentType: prepared.type, cacheControl: '3600' });
    if (uploadErr) throw uploadErr;

    const { publicUrl } = supabase.storage.from(TEAM_COVER_BUCKET).getPublicUrl(path).data;

    try {
      // setCover also drops the previously uploaded image once the pointer moves.
      await this.setCover(orgId, publicUrl, currentCover);
    } catch (err) {
      // The pointer never landed (e.g. not an admin) — drop the orphaned object.
      void supabase.storage.from(TEAM_COVER_BUCKET).remove([path]);
      throw err;
    }
    return publicUrl;
  },
};
