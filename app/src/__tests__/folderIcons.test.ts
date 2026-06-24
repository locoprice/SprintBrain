import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOLDER_ICON,
  FOLDER_ICON_KEYS,
  resolveFolderIconKey,
} from '@/lib/folderIcons';

describe('resolveFolderIconKey', () => {
  it('returns every canonical keyword unchanged', () => {
    for (const key of FOLDER_ICON_KEYS) {
      expect(resolveFolderIconKey(key)).toBe(key);
    }
  });

  it('maps legacy dashboard emoji to their nearest canonical key', () => {
    expect(resolveFolderIconKey('🏠')).toBe('home');
    expect(resolveFolderIconKey('🌍')).toBe('globe');
    expect(resolveFolderIconKey('📋')).toBe('clipboard');
    expect(resolveFolderIconKey('💬')).toBe('message');
    expect(resolveFolderIconKey('📝')).toBe('file-text');
    expect(resolveFolderIconKey('⭐')).toBe('star');
    expect(resolveFolderIconKey('🔧')).toBe('key');
  });

  it('falls back to the default folder glyph for legacy emoji with no equivalent', () => {
    expect(resolveFolderIconKey('🏢')).toBe('folder');
    expect(resolveFolderIconKey('📊')).toBe('folder');
    expect(resolveFolderIconKey('✈️')).toBe('folder');
  });

  it('falls back to the default for unknown, empty, or missing values', () => {
    expect(resolveFolderIconKey('not-a-key')).toBe(DEFAULT_FOLDER_ICON);
    expect(resolveFolderIconKey('🎉')).toBe(DEFAULT_FOLDER_ICON);
    expect(resolveFolderIconKey('')).toBe(DEFAULT_FOLDER_ICON);
    expect(resolveFolderIconKey(null)).toBe(DEFAULT_FOLDER_ICON);
    expect(resolveFolderIconKey(undefined)).toBe(DEFAULT_FOLDER_ICON);
  });
});
