import { create } from 'zustand';
import type { OrgMember, OrganizationSummary } from '@/types/database';
import { orgApi } from '@/lib/api/orgApi';

/**
 * Organization store — the signed-in user's active org + member directory.
 *
 * Loaded lazily (the folder-sharing modal calls `load()` the first time it
 * opens) so personal-only users never pay for an org round-trip. `load()` is
 * idempotent: it no-ops once `loaded` is true.
 */
interface OrgStore {
  activeOrg: OrganizationSummary | null;
  members: OrgMember[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  /** Force a re-fetch (e.g. after membership changes). */
  refresh: () => Promise<void>;
  /** Set the team cover to a preset key or null (remove); updates activeOrg in place. */
  setCover: (cover: string | null) => Promise<void>;
  /** Upload a cover image for the active org; updates activeOrg in place. */
  uploadCover: (file: File) => Promise<void>;
}

async function fetchOrg(): Promise<{ org: OrganizationSummary | null; members: OrgMember[] }> {
  const org = await orgApi.getActiveOrg();
  const members = org ? await orgApi.listMembers(org.id) : [];
  return { org, members };
}

export const useOrgStore = create<OrgStore>((set, get) => ({
  activeOrg: null,
  members: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loaded || get().loading) return;
    await get().refresh();
  },

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const { org, members } = await fetchOrg();
      set({ activeOrg: org, members, loaded: true, loading: false });
    } catch (err) {
      set({
        loading: false,
        loaded: true,
        error: err instanceof Error ? err.message : 'Failed to load organization',
      });
    }
  },

  setCover: async (cover) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    // Pass the current cover so a replaced/removed uploaded image is cleaned up.
    await orgApi.setCover(org.id, cover, org.cover);
    set((s) => (s.activeOrg ? { activeOrg: { ...s.activeOrg, cover } } : {}));
  },

  uploadCover: async (file) => {
    const org = get().activeOrg;
    if (!org) throw new Error('No active team');
    const url = await orgApi.uploadCover(org.id, org.cover, file);
    set((s) => (s.activeOrg ? { activeOrg: { ...s.activeOrg, cover: url } } : {}));
  },
}));
