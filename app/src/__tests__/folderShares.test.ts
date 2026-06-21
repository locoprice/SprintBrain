import { describe, it, expect } from 'vitest';
import { buildFolderShares } from '@/lib/folderShares';
import type { FolderPermission } from '@/types/database';

let seq = 0;
function grant(p: Partial<FolderPermission> = {}): FolderPermission {
  seq += 1;
  return {
    id: `g${seq}`,
    folder_id: 'f1',
    principal_type: 'user',
    principal_id: `p${seq}`,
    level: 'view',
    created_at: '2026-06-13T00:00:00Z',
    granted_by: null,
    ...p,
  };
}

describe('buildFolderShares', () => {
  it('marks a folder with an organization grant as team-wide', () => {
    const map = buildFolderShares([
      grant({ folder_id: 'team', principal_type: 'organization', principal_id: 'org1' }),
    ]);
    expect(map.get('team')).toEqual({ scope: 'team', memberCount: 0 });
  });

  it('counts distinct user grantees for a shared folder', () => {
    const map = buildFolderShares([
      grant({ folder_id: 'mkt', principal_type: 'user', principal_id: 'u1' }),
      grant({ folder_id: 'mkt', principal_type: 'user', principal_id: 'u2' }),
      grant({ folder_id: 'mkt', principal_type: 'user', principal_id: 'u2' }), // duplicate principal
    ]);
    expect(map.get('mkt')).toEqual({ scope: 'shared', memberCount: 2 });
  });

  it('treats an org grant as team even when user grants also exist', () => {
    const map = buildFolderShares([
      grant({ folder_id: 'mix', principal_type: 'user', principal_id: 'u1' }),
      grant({ folder_id: 'mix', principal_type: 'organization', principal_id: 'org1' }),
    ]);
    expect(map.get('mix')?.scope).toBe('team');
  });

  it('omits folders with no grants (caller treats as private)', () => {
    const map = buildFolderShares([]);
    expect(map.has('whatever')).toBe(false);
  });

  it('classifies multiple folders independently', () => {
    const map = buildFolderShares([
      grant({ folder_id: 'a', principal_type: 'organization', principal_id: 'org1' }),
      grant({ folder_id: 'b', principal_type: 'user', principal_id: 'u1' }),
    ]);
    expect(map.get('a')?.scope).toBe('team');
    expect(map.get('b')?.scope).toBe('shared');
    expect(map.size).toBe(2);
  });
});
