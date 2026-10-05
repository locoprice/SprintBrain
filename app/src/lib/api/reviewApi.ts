import { supabase } from '@/lib/supabase';
import { toApiError } from '@/lib/api/apiError';
import { toReviewStatus, type ReviewStatus } from '@/lib/reviewStatus';

// Review status reads and writes (AI-KNOWLEDGE P2).
//
// One write for all three kinds: the row's review_status column. Who may set
// what is decided by app.review_status_guard in the database, which also
// stamps reviewed_by / reviewed_at; the dashboard only offers what it allows.

export type ReviewKind = 'snippet' | 'prompt' | 'memory';

const TABLE: Record<ReviewKind, 'snippets' | 'prompts' | 'memory_shards'> = {
  snippet: 'snippets',
  prompt: 'prompts',
  memory: 'memory_shards',
};

export interface ReviewStamp {
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
}

/** One row of the Review page: any of the three kinds, in one shape. */
export interface ReviewItem extends ReviewStamp {
  kind: ReviewKind;
  id: string;
  title: string;
  ownerId: string;
  /** The team a snippet or prompt belongs to; always null for Brain items. */
  organizationId: string | null;
  /** The Brain a memory item lives in; null for snippets and prompts. */
  spaceId: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

/** Enough for a library of thousands: the page lists what is not approved. */
const LIST_LIMIT = 500;

type StampRow = { review_status: string | null; reviewed_by: string | null; reviewed_at: string | null };

function toStamp(row: StampRow): ReviewStamp {
  return {
    review_status: toReviewStatus(row.review_status),
    reviewed_by: row.reviewed_by ?? null,
    reviewed_at: row.reviewed_at ?? null,
  };
}

export interface ReviewApi {
  setStatus(kind: ReviewKind, id: string, status: ReviewStatus): Promise<ReviewStamp>;
  /** Everything not approved that the caller can see, newest first. RLS decides what that is. */
  listNotApproved(): Promise<ReviewItem[]>;
}

export const reviewApi: ReviewApi = {
  async setStatus(kind, id, status) {
    const { data, error } = await supabase
      .from(TABLE[kind])
      .update({ review_status: status })
      .eq('id', id)
      .select('review_status, reviewed_by, reviewed_at');
    if (error) {
      throw toApiError(
        error,
        error.code === '42501' ? 'Only a team admin can change this status.' : undefined,
      );
    }
    const row = (data as StampRow[] | null)?.[0];
    if (!row) throw new Error("That item no longer exists, or you can't change it.");
    return toStamp(row);
  },

  async listNotApproved() {
    const [snippets, prompts, items] = await Promise.all([
      supabase
        .from('snippets')
        .select('id, title, user_id, organization_id, updated_at, updated_by, review_status, reviewed_by, reviewed_at')
        .neq('review_status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(LIST_LIMIT),
      supabase
        .from('prompts')
        .select('id, name, user_id, organization_id, updated_at, updated_by, review_status, reviewed_by, reviewed_at')
        .neq('review_status', 'approved')
        .order('updated_at', { ascending: false })
        .limit(LIST_LIMIT),
      supabase
        .from('memory_shards')
        .select('id, name, user_id, space_id, updated_at, review_status, reviewed_by, reviewed_at')
        .neq('review_status', 'approved')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(LIST_LIMIT),
    ]);
    if (snippets.error) throw toApiError(snippets.error);
    if (prompts.error) throw toApiError(prompts.error);
    if (items.error) throw toApiError(items.error);

    type TeamRow = StampRow & {
      id: string;
      user_id: string;
      organization_id: string | null;
      updated_at: string;
      updated_by: string | null;
    };
    type MemoryRow = StampRow & { id: string; name: string; user_id: string; space_id: string; updated_at: string };

    const out: ReviewItem[] = [
      ...((snippets.data ?? []) as Array<TeamRow & { title: string }>).map((r) => ({
        kind: 'snippet' as const,
        id: r.id,
        title: r.title,
        ownerId: r.user_id,
        organizationId: r.organization_id,
        spaceId: null,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
        ...toStamp(r),
      })),
      ...((prompts.data ?? []) as Array<TeamRow & { name: string }>).map((r) => ({
        kind: 'prompt' as const,
        id: r.id,
        title: r.name,
        ownerId: r.user_id,
        organizationId: r.organization_id,
        spaceId: null,
        updatedAt: r.updated_at,
        updatedBy: r.updated_by,
        ...toStamp(r),
      })),
      ...((items.data ?? []) as MemoryRow[]).map((r) => ({
        kind: 'memory' as const,
        id: r.id,
        title: r.name,
        ownerId: r.user_id,
        organizationId: null,
        spaceId: r.space_id,
        updatedAt: r.updated_at,
        updatedBy: r.user_id,
        ...toStamp(r),
      })),
    ];
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
};
