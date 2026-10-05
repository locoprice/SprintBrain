// Review status (AI-KNOWLEDGE P2, docs/AI_KNOWLEDGE_PLAN.md).
//
// Where a snippet, prompt or Brain item stands: draft, AI generated, under
// review, approved, deprecated or archived. The database enforces the rules
// (app.review_status_guard in 20261005120000_review_status.sql); this module
// mirrors them so the dashboard only offers choices that will be accepted, and
// words them the same way everywhere.

/**
 * Every status, in the order they are offered.
 *
 * Keep in step with the review_status checks in the migration and with the
 * phone page's REVIEW_STATUSES; scripts/check-review-status.js fails CI if the
 * lists differ.
 */
export const REVIEW_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'ai_generated', label: 'AI generated' },
  { value: 'under_review', label: 'Under review' },
  { value: 'approved', label: 'Approved' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'archived', label: 'Archived' },
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]['value'];

/** Only an approver may set these, or move an item out of them. */
const REVIEWED: readonly ReviewStatus[] = ['approved', 'deprecated', 'archived'];

/** Waiting for a person: what the Review page lists by default. */
export const WAITING_STATUSES: readonly ReviewStatus[] = ['under_review', 'ai_generated', 'draft'];

/** A status anyone may create an item with: one that waits for a person. */
export type WaitingStatus = 'under_review' | 'ai_generated' | 'draft';

/** How a new item starts. An item saved from an AI draft starts as ai_generated. */
export interface NewItemOptions {
  reviewStatus?: WaitingStatus;
}

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return REVIEW_STATUSES.some((s) => s.value === value);
}

/** A status from the database, or approved when a row predates the column. */
export function toReviewStatus(value: unknown): ReviewStatus {
  return isReviewStatus(value) ? value : 'approved';
}

export function reviewStatusLabel(status: ReviewStatus): string {
  return REVIEW_STATUSES.find((s) => s.value === status)?.label ?? status;
}

/** One line on what a status means for the people using the item. */
export function reviewStatusHint(status: ReviewStatus): string {
  switch (status) {
    case 'draft':
      return 'Still being written. It works, but nobody has approved it.';
    case 'ai_generated':
      return 'Written by an AI. It works, but a person has not approved it yet.';
    case 'under_review':
      return 'Waiting for an approver. It works in the meantime.';
    case 'approved':
      return 'Approved. Ask SprintBrain prefers approved items.';
    case 'deprecated':
      return 'Out of date. It still works, with a warning, and Ask treats it as outdated.';
    case 'archived':
      return 'Archived. It does not expand and Ask ignores it. Restore it by choosing another status.';
  }
}

/** Archived content never expands and is left out of Ask. */
export function isArchived(status: ReviewStatus): boolean {
  return status === 'archived';
}

/** What an approver is. The database decides the same way. */
export interface ApproverInput {
  /** The row's team, or null for personal content. Brain items are always personal. */
  organizationId: string | null;
  ownerId: string;
  userId: string | null;
  /** The signed-in user's role in each team they belong to. */
  rolesByOrg: ReadonlyMap<string, string>;
}

export function isApprover({ organizationId, ownerId, userId, rolesByOrg }: ApproverInput): boolean {
  if (!userId) return false;
  if (organizationId) return rolesByOrg.get(organizationId) === 'admin';
  return ownerId === userId;
}

/**
 * The statuses this person may move an item to, current one included.
 *
 * An approver may choose any status. Anyone else may only move between the
 * waiting statuses, and only while the item is in one of them: an approved,
 * deprecated or archived item is an approver's to change.
 */
export function allowedStatuses(current: ReviewStatus, approver: boolean): ReviewStatus[] {
  if (approver) return REVIEW_STATUSES.map((s) => s.value);
  if (REVIEWED.includes(current)) return [current];
  return REVIEW_STATUSES.map((s) => s.value).filter((s) => !REVIEWED.includes(s));
}

/** Badge tone per status. Approved draws no badge: it is the normal state. */
export type ReviewTone = 'muted' | 'info' | 'warning' | 'danger';

export function reviewTone(status: ReviewStatus): ReviewTone | null {
  switch (status) {
    case 'approved':
      return null;
    case 'draft':
      return 'muted';
    case 'ai_generated':
    case 'under_review':
      return 'info';
    case 'deprecated':
      return 'warning';
    case 'archived':
      return 'danger';
  }
}
