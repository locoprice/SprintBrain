import { describe, expect, it } from 'vitest';
import {
  REVIEW_STATUSES,
  allowedStatuses,
  isApprover,
  reviewStatusLabel,
  reviewTone,
  toReviewStatus,
} from '@/lib/reviewStatus';

const TEAM = 'team-1';
const ME = 'user-me';
const OTHER = 'user-other';

describe('isApprover', () => {
  const roles = new Map([[TEAM, 'admin']]);

  it('lets a team admin approve team content', () => {
    expect(isApprover({ organizationId: TEAM, ownerId: OTHER, userId: ME, rolesByOrg: roles })).toBe(true);
  });

  it('does not let a team member approve team content, even their own', () => {
    const member = new Map([[TEAM, 'member']]);
    expect(isApprover({ organizationId: TEAM, ownerId: ME, userId: ME, rolesByOrg: member })).toBe(false);
  });

  it('lets the owner approve personal content, and nobody else', () => {
    expect(isApprover({ organizationId: null, ownerId: ME, userId: ME, rolesByOrg: new Map() })).toBe(true);
    expect(isApprover({ organizationId: null, ownerId: OTHER, userId: ME, rolesByOrg: roles })).toBe(false);
  });

  it('never approves for a signed-out user', () => {
    expect(isApprover({ organizationId: null, ownerId: ME, userId: null, rolesByOrg: roles })).toBe(false);
  });
});

describe('allowedStatuses', () => {
  it('offers an approver every status', () => {
    expect(allowedStatuses('under_review', true)).toEqual(REVIEW_STATUSES.map((s) => s.value));
  });

  it('offers anyone else only the waiting statuses while the item is waiting', () => {
    expect(allowedStatuses('under_review', false)).toEqual(['draft', 'ai_generated', 'under_review']);
  });

  it('leaves an approved, deprecated or archived item to an approver', () => {
    expect(allowedStatuses('approved', false)).toEqual(['approved']);
    expect(allowedStatuses('deprecated', false)).toEqual(['deprecated']);
    expect(allowedStatuses('archived', false)).toEqual(['archived']);
  });
});

describe('wording and tone', () => {
  it('reads a row that predates the column as approved', () => {
    expect(toReviewStatus(undefined)).toBe('approved');
    expect(toReviewStatus('nonsense')).toBe('approved');
    expect(toReviewStatus('deprecated')).toBe('deprecated');
  });

  it('labels every status and draws no badge for approved', () => {
    expect(reviewStatusLabel('ai_generated')).toBe('AI generated');
    expect(reviewTone('approved')).toBeNull();
    expect(reviewTone('deprecated')).toBe('warning');
    expect(reviewTone('archived')).toBe('danger');
  });
});
