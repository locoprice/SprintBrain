import type { NotionSyncState, Profile } from '@/types/database';
import { mockNotionSync, mockProfile } from '@/mock/fixtures';
import { delay } from './_delay';

export interface SettingsApi {
  getProfile(): Promise<Profile>;
  getNotionSync(): Promise<NotionSyncState>;
}

export const settingsApi: SettingsApi = {
  getProfile: () => delay(mockProfile),
  getNotionSync: () => delay(mockNotionSync),
};
