import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useThemeStore } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
  window.history.replaceState({}, '', '/setup');
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
});

describe('wizard style preference', () => {
  it('starts a fresh setup in light style even on a dark OS', () => {
    useThemeStore.getState().init();
    expect(useThemeStore.getState().resolved).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('starts the first-run login link in light style', () => {
    window.history.replaceState({}, '', '/login?next=/setup');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().resolved).toBe('light');
  });

  it.each(['light', 'dark'] as const)('keeps the selected %s style after reinitializing', (theme) => {
    useThemeStore.getState().setTheme(theme);
    expect(localStorage.getItem('cc_theme')).toBe(theme);
    useThemeStore.getState().init();
    expect(useThemeStore.getState().resolved).toBe(theme);
    expect(document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
  });

  it('honors a previously saved system preference', () => {
    localStorage.setItem('cc_theme', 'system');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().theme).toBe('system');
    expect(useThemeStore.getState().resolved).toBe('dark');
  });

  it('recovers from invalid storage', () => {
    localStorage.setItem('cc_theme', 'invalid');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().resolved).toBe('light');
  });

  it('preserves the default on management pages', () => {
    window.history.replaceState({}, '', '/projects');
    useThemeStore.getState().init();
    expect(useThemeStore.getState().resolved).toBe('dark');
  });
});
