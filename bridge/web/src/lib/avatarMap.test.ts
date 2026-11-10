import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/settings', () => ({
  getGlobalSettings: vi.fn(async () => ({ avatar_style: 'chibi' })),
  updateGlobalSettings: vi.fn(async () => ({})),
}));

import { DEFAULT_AVATAR_STYLE, normalizeAvatarStyle, resolveRoleAvatar, useAvatarStyleStore } from './avatarMap';
import { updateGlobalSettings } from '@/api/settings';

// Two sets, default the vendors' own icons (user 2026-11-10「默认是各家原本的图标，内置另一套娘化图标」).
describe('role avatar sets', () => {
  beforeEach(() => useAvatarStyleStore.setState({ style: DEFAULT_AVATAR_STYLE, loaded: false }));

  it('defaults to the vendor icon set', () => {
    expect(DEFAULT_AVATAR_STYLE).toBe('brand');
    expect(normalizeAvatarStyle(undefined)).toBe('brand');
    expect(normalizeAvatarStyle('pixel')).toBe('brand');
    expect(resolveRoleAvatar({ model: 'claude-opus-5-5' })).toMatch(/\/avatars\/brand-claude\.png$/);
  });

  it('maps each family in the brand set', () => {
    expect(resolveRoleAvatar({ model: 'gpt-6.1-sol' }, 'brand')).toMatch(/brand-openai\.png$/);
    expect(resolveRoleAvatar({ agentType: 'dsh' }, 'brand')).toMatch(/brand-deepseek\.png$/);
    expect(resolveRoleAvatar({ model: 'gemini-3-pro' }, 'brand')).toMatch(/brand-gemini\.png$/);
    expect(resolveRoleAvatar({ model: 'grok-4' }, 'brand')).toMatch(/brand-grok\.png$/);
    expect(resolveRoleAvatar({ name: 'minimax' }, 'brand')).toMatch(/brand-minimax\.png$/);
  });

  it('maps each family in the chibi set', () => {
    expect(resolveRoleAvatar({ model: 'claude-opus-5-5' }, 'chibi')).toMatch(/\/avatars\/orange\.png$/);
    expect(resolveRoleAvatar({ name: 'G哥' }, 'chibi')).toMatch(/dragon\.png$/);
    expect(resolveRoleAvatar({ name: '肥鱼' }, 'chibi')).toMatch(/whale\.png$/);
    expect(resolveRoleAvatar({ agentType: 'gemini' }, 'chibi')).toMatch(/rainbow\.png$/);
    expect(resolveRoleAvatar({ model: 'grok-4' }, 'chibi')).toMatch(/grok\.png$/);
    expect(resolveRoleAvatar({ name: 'lanxi' }, 'chibi')).toMatch(/lanxi\.png$/);
  });

  it('keeps a user-chosen avatar above either set', () => {
    for (const style of ['brand', 'chibi'] as const) {
      expect(resolveRoleAvatar({ avatar: 'https://x.test/a.png', model: 'claude' }, style)).toBe('https://x.test/a.png');
      expect(resolveRoleAvatar({ avatar: 'whale', model: 'claude' }, style)).toMatch(/\/avatars\/whale\.png$/);
      expect(resolveRoleAvatar({ avatar: 'brand-gemini', model: 'claude' }, style)).toMatch(/\/avatars\/brand-gemini\.png$/);
      expect(resolveRoleAvatar({ avatar: 'mine', model: 'claude' }, style)).toMatch(/avatar-image\/mine$/);
    }
    expect(resolveRoleAvatar({ name: 'nobody' }, 'brand')).toBeUndefined();
  });

  it('follows the stored setting and saves a switch', async () => {
    await useAvatarStyleStore.getState().load();
    expect(useAvatarStyleStore.getState().style).toBe('chibi');
    expect(resolveRoleAvatar({ model: 'claude' })).toMatch(/orange\.png$/);
    await useAvatarStyleStore.getState().setStyle('brand');
    expect(updateGlobalSettings).toHaveBeenCalledWith({ avatar_style: 'brand' });
    expect(resolveRoleAvatar({ model: 'claude' })).toMatch(/brand-claude\.png$/);
  });
});
